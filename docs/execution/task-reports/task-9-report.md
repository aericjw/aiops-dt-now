# Task 9 Report: ServiceNow event rules and CI binding

## Summary

Deployed three `em_match_rule` records (order band 8000-8099) that bind Dynatrace-sourced
`em_event` records to CMDB CIs, plus the DQL/workflow changes needed to carry a correctly
shaped CI name (`dt_ci_name`) into ServiceNow. Two defects were found and fixed after an
external review of the first deploy (see "Defects found and fixed" below). The structural
fix is deployed and its JSON shape has been verified byte-for-byte against the confirmed
working template, but I was not able to observe a **new**, post-fix live event before
running out of session time — the tenant's Davis problem generation happens in bursts
roughly 90 minutes apart, and the last burst landed just before the second redeploy. This
is stated plainly in "Live re-verification" below; I have not adjusted the measurement to
hide it.

## Baseline (before any rule existed)

```
sampled 5 events
OVERALL BIND RATE: 0/5 (0%)
dt_entity_key                bound   total  rate
service                          0       5  0%
```

Isolated to our pipeline's events via `additional_infoLIKEdt_entity_key` (v1's leftover
`em_event` records lack that key and would otherwise pollute the sample).

## Transform template finding (Ruling 2)

Transformed the "Azure Metrics Virtual Machines" rule (`sys_id
8cbb229067250300998d35e457415acb`) — correct flag is `--table em_match_rule --id
<sys_id>` (the brief says `--sys-id`, which is not a real flag; `transform --help`
confirmed `--id`). The transform itself wrote nothing to `src/fluent` (its target must
already be tracked in `metadata/`), so I queried the live record directly instead and
cross-checked several other rules (`SCOM Metrics – Windows Server`, `AWS LB binding`,
`Azure WS binding`, `Nagios - IIS Short Name`) via `now-sdk query`.

**Finding:** `identification_rules[].attributes[].value` is a source-attribute name
resolved against the em_event record. It is **not exclusively** an em_event column or an
additional_info key — evidence for both:
- Azure VM rule: `value: "id"`, `"location"`, `"subscriptionId"` — none of these are real
  `em_event` columns; they only exist as additional_info keys (confirmed against the same
  rule's `additional_info_filter`, which filters on those same key names).
- `SCOM Metrics – Windows Server`: `value: "node"` — `node` **is** a real `em_event`
  column (confirmed against `sys_dictionary`).

Conclusion: the binding engine resolves `value` by checking the em_event record's own
column first, and falls back to the additional_info JSON key of the same name if no such
column exists. I used this by setting our host/service rules' `value` to `"node"`, since
the workflow now writes the correctly shaped CI name into that column directly (see
below), giving an exact-shape match with no extra indirection.

For scoping (`filter`/`simple_filter`/`additional_info_filter`), the same cross-check
showed both **plain em_event-column conditions** (e.g. `Azure WS binding`:
`type=microsoft.web/sites^...`; `Nagios - IIS Short Name`: `type=IIS Web
Server^nodeNOT LIKE.^EQ`) and **`@@EventRule@@_N` tokens** referencing
`additional_info_filter` conditions, both joined in the same encoded-query style ending
in `^EQ`. `em_match_rule.filter` and `.type`/`.node`/`.source` are all plain `string`
columns per `sys_dictionary` (not choice fields), consistent with plain literal
comparisons.

## Defects found and fixed (post-review)

The first deploy passed my own initial review but was wrong. An external review caught
two defects before I'd gathered enough live data to catch them myself:

**Defect A — host rule matched everything.** I scoped the host/service rules using a
hand-composed `@@EventRule@@_N` token in `additional_info_filter` keyed on
`bind_strategy`. Live events showed the host rule (order 8010) being applied to
`environment` and `browser_monitor` typed events, not just hosts — i.e. the scoping
condition was not actually restricting anything. Root cause, on inspection: my
`simple_filter` JSON had one extra level of `{compound_type:"and", subpredicates:[...]}`
wrapping compared to every confirmed-working reference rule (`Azure WS binding`, `Nagios -
IIS Short Name` — both have a single `and` group directly containing the field-condition
objects). Fix, in two parts:
1. Rescoped host/service using `type=host` / `type=service` — a plain `em_event.type`
   column condition. `type` already carries `dt_entity_key` verbatim (the workflow's
   `f-type` field sets it), so this is an exact, verified-pattern literal comparison and
   avoids the `additional_info_filter`/`@@EventRule@@` token scheme entirely for these two
   rules.
2. Removed the extra nesting level from all three rules' `simple_filter` so its shape now
   matches the reference rules exactly, field for field.

**Defect B — null entity names produced garbage CI identifiers.** The original
`dt_ci_name` expression concatenated unconditionally:
```
dt_ci_name = if(bind_strategy == "sgc_service", concat(dt_entity_name, " - ", dt_entity_id), else: dt_entity_name)
```
When `dt_entity_name` is null (Task 6 measured ~2.5% of rows), this produced the literal
string `" - "` as the CI identifier — a wrong-match risk, not a clean failure. Fixed to:
```
dt_ci_name = if(bind_strategy == "sgc_service" and isNotNull(dt_entity_name), concat(dt_entity_name, " - ", dt_entity_id), else: dt_entity_name)
```
Now a null name falls through to null (clean failure) instead of composing a bogus
string. Regenerated `/tmp/extract_literal.dql` from the current query (not reused) and
re-verified: `dtctl verify query -f /tmp/extract_literal.dql --plain` → `✔ Query is
valid`, both times this file changed. Re-applied the workflow both times
(`dtctl apply -f dynatrace/workflows/dt-problems-to-snow-itom.yaml --plain`).

Live evidence the concat fix took effect: post-fix `service` events show correctly
composed names (`frontendproxy - SERVICE-D850D315D333125C`,
`cartservice (oteldemo.CartService) - SERVICE-68EFD6A40BB7EA86`) — none of the raw `" -
"` garbage strings the coordinator flagged are present in the current sample.

## Smartscape traversal for `process` (brief step 3 / task dispatch)

```
dtctl verify query 'smartscapeNodes "PROCESS" | limit 5 | fieldsAdd host_name = getNodeName(getNodeField(id, "runsOn"))' --plain
```
**Result: it verifies syntactically** (`✔ Query is valid`), but I do not treat that as
"it works" — I ran it (and two relationship-name variants, `isProcessOf`,
`isHostedBy`) and **every returned row had `host_name: null`**, on process records that
already carry `host.name` as a plain direct field. The traversal is syntactically legal
DQL but produces no usable data in this tenant/DQL version — a case the "if it verifies,
use it" instruction did not anticipate literally, so I treated a null-only functional
result as a failed traversal rather than inventing further relationship names to try.

**Decision: `process` moved to `bind_strategy: ire_correlated`** in
`mapping/dt_to_snow_cmdb_mapping.csv` (was `sgc_process`). `sgc_managed` was left `true`
— that field documents whether SGC discovers/manages the CI type in CMDB (it does, for
processes), which is independent of which strategy *our* pipeline uses to bind to it. We
just can't reliably reconstruct SGC's `<proc>@<host>` name shape from Dynatrace data, so
we fall back to identifying by `correlation_id` (Davis's smartscape entity ID) instead of
by name. `process` is the highest-volume entity type in the tenant (459 of 553 keys start
after `process` alphabetically; more importantly it's the single largest event volume
per Task 6), so this is consequential: expect real-but-partial bind rates for `process`
under `ire_correlated`, gated by whether SGC's process CIs happen to carry a matching
`correlation_id` — that is legitimate CMDB-coverage information, not a defect.

## Lookup tables — which is authoritative

Three lookup tables now exist on the tenant:
- `/lookups/dt_to_snow_cmdb_mapping` (22 rows) — **original/stale**, pre-dates this
  project's 553-key mapping. Not referenced by any current query.
- `/lookups/dt_to_snow_cmdb_mapping_v2` (553 rows) — **stale**, created by an earlier
  task, still has `process` mapped to `sgc_process`. No longer referenced.
- `/lookups/dt_to_snow_cmdb_mapping_v3` (553 rows) — **authoritative**. Created this task
  (`./scripts/upload-lookup.sh mapping/dt_to_snow_cmdb_mapping.csv
  /lookups/dt_to_snow_cmdb_mapping_v3`) because the token cannot delete v2, and v2 already
  existed at the script's default path from a prior task run — so a new path (`v3`, not
  the script's default `v2`) was required to pick up the `process` → `ire_correlated`
  change. Both `dynatrace/dql/extract_events.dql` and the inline query in
  `dynatrace/workflows/dt-problems-to-snow-itom.yaml` now `load "/lookups/dt_to_snow_cmdb_mapping_v3"`.
  The two older tables are left untouched as rollback artifacts, per the no-delete
  constraint — do not delete them without explicit instruction.

## Deployed rules

| Order | Name | Scope (`filter`) | `ci_type` | Identification |
|---|---|---|---|---|
| 8010 | Dynatrace - bind host events to server CI | `source=Dynatrace^type=host^EQ` | `cmdb_ci_computer` | `name` = `node` |
| 8020 | Dynatrace - bind service events to calculated service CI | `source=Dynatrace^type=service^EQ` | `cmdb_ci_service_calculated` | `name` = `node` |
| 8090 | Dynatrace - bind remaining entity types via correlation id | `source=Dynatrace^EQ` | `cmdb_ci` | `correlation_id` = `dt_entity_id` |

Order band 8000-8099 confirmed empty both before the first deploy and again before
writing this report (`em_match_rule -q 'order>=8000^order<=8099'` → 0 records outside our
own three). Pre-existing v1 Dynatrace rules at order 100-101 gate on `classification=2`
and v1-era additional_info keys (`entityType`, `correlation_id starts with SERVICE`) that
our pipeline never sets, so running at order 8000+ (last) is safe — confirmed by their
continued absence from every "Event rule applied" note observed on our events.

`bind_fallbacks` was considered for the catch-all rule per the dispatch, but every
existing `em_match_rule` on the instance with non-empty `bind_fallbacks` values I could
query had `bind_fallbacks: []` — there was no working example to derive the shape from,
and per instruction I do not hand-compose an unverified encoding. Left unset; the
catch-all uses only its primary `correlation_id` identification.

## Live re-verification (honest state)

`scripts/bind-rate-report.sh 300`, run after both fixes were deployed:
```
sampled 45 events
OVERALL BIND RATE: 1/45 (2%)
dt_entity_key                bound   total  rate
environment                      0      22  0%
service                          1      21  4%
host                             0       1  0%
browser_monitor                  0       1  0%
```

**This sample predates the structural fix (Defect A's simple_filter nesting).** All 45
events were created before the second redeploy — the tenant generates Davis problems in
bursts roughly 90 minutes apart (observed clusters at ~21:40-22:02, ~22:27, ~23:57,
~01:27), and no new burst had landed by the time I stopped to write this report. I did
not sleep-loop waiting for one; I checked the live sample count several times over the
course of doing the two fixes and it stayed at 45 throughout — a materially different
outcome from waiting indefinitely.

What I can confirm from the current (pre-fix-two) sample:
- **Defect B is fixed and visibly working**: post-Defect-B-fix `service` events show
  correctly composed names (`frontendproxy - SERVICE-D850D315D333125C`, `cartservice
  (oteldemo.CartService) - SERVICE-68EFD6A40BB7EA86`) with no `" - "` garbage strings.
- **Defect A's root cause (extra JSON nesting) is real**: the deployed `simple_filter` I
  queried back from the instance after the first deploy had one more nesting level than
  every confirmed-working reference rule. The fix removes exactly that extra level and
  the corrected JSON, re-queried from the instance post-fix, matches the reference shape
  field-for-field.
- **I have not observed a live event processed against the corrected rules.** The single
  `host` event in the current sample and all 22 `environment` events predate the fix and
  still show the old (over-broad) host-rule match.

The one `service` event that shows `bound: true` by the script's text heuristic
(`ad - SERVICE-CE9CDC18A6EA11EC`) turned out, on inspection, to have an **empty**
`cmdb_ci` field despite passing the heuristic — its `processing_notes` was truncated to
just `"Event rule applied: Dynatrace - bind host events to server CI"` with no
success/failure detail, which the script's substring check treats as bound. This is a
false positive in the measurement, not a false positive in the CMDB (the CI was not
actually bound). I did not change the script's matching logic since it is the exact spec
given in the brief (spec check V5) and Tasks 10-12 reuse it verbatim; I'm flagging the
edge case here instead so it isn't mistaken for evidence of success.

**Honest conclusion: I cannot yet claim the "materially above baseline, host/service near
100%" pass condition is met by live data.** The mechanism is deployed, the JSON shape is
now verified correct against a working reference, and the one class of defect I could
fully verify live (Defect B, garbage names) is confirmed fixed. Defect A's fix is
verified structurally but not yet against a live post-fix binding. Re-running
`./scripts/bind-rate-report.sh 300` after the tenant's next Davis-problem burst (observed
cadence: roughly every 90 minutes) will confirm or refute it; Tasks 10-12, which reuse
this script, will do exactly that on their next run.

## Files changed

- `scripts/bind-rate-report.sh` (new) — spec check V5, isolates our events via
  `additional_infoLIKEdt_entity_key`.
- `servicenow/src/fluent/dynatrace-event-rules.now.ts` (new) — three `em_match_rule`
  records.
- `servicenow/src/fluent/generated/keys.ts` (modified, committed alongside) — three new
  explicit keys: `dt-bind-sgc-host`, `dt-bind-sgc-service`, `dt-bind-ire-correlated`.
- `dynatrace/dql/extract_events.dql` (modified) — adds `dt_ci_name` composition
  (null-guarded), switches lookup to `/lookups/dt_to_snow_cmdb_mapping_v3`.
- `dynatrace/workflows/dt-problems-to-snow-itom.yaml` (modified) — inline copy of the same
  DQL change; `f-node` field renamed to `f-ci-name`, now sources `dt_ci_name` instead of
  `dt_entity_name`.
- `mapping/dt_to_snow_cmdb_mapping.csv` (modified) — `process` row: `sgc_process` →
  `ire_correlated`.
- New Dynatrace lookup table `/lookups/dt_to_snow_cmdb_mapping_v3` (553 rows) — not a repo
  file, but a live artifact this task created; documented above.

## Self-review findings

- The brief's `transform --sys-id` flag doesn't exist; correct flag is `--id` (confirmed
  via `transform --help`). Documented so future tasks don't repeat the failed attempt.
- The brief's illustrative `identification_rules` JSON was correctly flagged as
  untrustworthy by Ruling 2 — it is neither purely em_event-column nor purely
  additional_info, and picking either interpretation in isolation would have been wrong.
- My first deploy passed my own read-back verification (I confirmed the JSON parsed and
  matched what I intended) but was still functionally broken — read-back of stored JSON is
  not the same as verifying it against a known-working reference shape field-for-field.
  I now do the latter for both `simple_filter` and `identification_rules`.
- Did not invent additional Smartscape relationship names beyond the one specified plus
  two reasonable variants (`isProcessOf`, `isHostedBy`) before falling back per
  instruction — stopped deliberately rather than continuing to guess.

## Concerns

1. **Numeric pass condition unconfirmed against fresh live data** — see "Live
   re-verification" above. This is the primary open item; it needs one more natural Davis
   problem burst (tenant cadence ~90 min) and a re-run of
   `./scripts/bind-rate-report.sh 300`.
2. **One host event has a null name** (`dt_entity_name` was null for that Davis entity),
   so it will fail to bind by design (clean failure, not a wrong match) — expected per
   Task 6's ~2.5% null-name measurement, not a rule defect.
3. **Three lookup tables now exist on the tenant**; only v3 is live/referenced. Documented
   above so a future task doesn't accidentally read v1 or v2.
4. **`bind_fallbacks` left unset** on the catch-all rule for lack of any working example to
   derive its shape from — noted above, not a blocker for the current pass condition but
   worth a follow-up if `ire_correlated` bind rates come back lower than CMDB coverage
   would suggest.

---

## Fix round 1 (post-review)

The controller's review of the first fix round caught three more problems. Fixed all
three; details below.

### FIX 1 + FIX 3 — `scripts/bind-rate-report.sh` was measuring the wrong thing

Rewrote the script:
- **Bound is now measured off `em_event.cmdb_ci`** (non-empty == bound), a real
  reference column, instead of inferring it from the absence of failure text in
  `processing_notes`. The controller's suspicion was correct: the one event the old
  text-heuristic called "bound" (`ad - SERVICE-CE9CDC18A6EA11EC`) has an **empty**
  `cmdb_ci`. Its `processing_notes` was truncated to just `"Event rule applied:
  Dynatrace - bind host events to server CI"` with no outcome detail, which the old
  substring check couldn't distinguish from success. True rate for that sample is
  **0/45**, not 1/45.
- **`environment` and `__unknown__` are now reported separately** as "entity-less" and
  excluded from the BINDABLE rate, per the controller's ruling and the tenant-wide
  24h name-resolution numbers they supplied (process 0% null, k8s_pod 0% null, service
  18% null, host 5% null, environment 100% null, __unknown__ 100% null — the two
  100%-null keys have no CMDB counterpart and never will). The script now prints three
  numbers: BINDABLE bind rate, entity-less count, and overall count for context. The
  per-key table tags entity-less rows explicitly.

Honest current baseline with the corrected measurement (same 45-record sample as
before — no new events landed between the two runs):
```
sampled 45 events
BINDABLE BIND RATE (excludes environment/__unknown__): 0/23 (0%)
ENTITY-LESS (environment + __unknown__, not counted as failures): 22/45
OVERALL BIND RATE (context only, includes entity-less): 0/45 (0%)

dt_entity_key                bound   total  rate
environment                      0      22  0% (entity-less, excluded from BINDABLE rate)
service                          0      21  0%
host                             0       1  0%
browser_monitor                  0       1  0%
```

### FIX 2 — Defect A (host rule scope) — status: fix deployed, live confirmation still pending

I could not get a fresh, post-fix live event to test against in this round either — see
"why I still can't confirm this live" below. Rather than claim it's fixed, here is
exactly what I found, what I changed, and why I believe it's correct, so the next task
(or the tenant's next Davis-problem burst) can verify it directly.

**The evidence cited is stale, not new.** Every `environment` event I can query
(including the three the controller quoted from, sys_ids `64c6e66f...`, `a0c66a2b...`,
`a4c6a6eb...`) has `sys_created_on = 2026-09-06 01:27:58` or `01:27:59`. My deploy that
introduced `type=host`/`type=service` scoping (replacing the broken
`additional_info.bind_strategy` token scheme) landed later than that, in the same
working session, confirmed by the `filter` values now stored on the instance
(`source=Dynatrace^type=host^EQ`, not the old token form) — but I have no independent
timestamp proof beyond "later in the same session" because `em_match_rule.sys_updated_on`
did not change across my successive deploys (it reads `2026-09-06 22:02:46` for all
three rules regardless of which deploy last touched their `filter`/`simple_filter`
content — the SDK's install evidently doesn't bump that field on redeploy, so it's not a
usable freshness signal). No event has been created at all since 01:27:59 as of writing
this — the tenant's Davis-problem generation runs in ~90-minute bursts and none has
landed. I checked once after this round's redeploy, as instructed, and the sample is
still the same 45 records.

**What I changed and why I believe it, absent live proof:**
1. Scoping is `source=Dynatrace^type=host^EQ` / `source=Dynatrace^type=service^EQ` (a
   plain `em_event` column condition on `type`, which the workflow sets to
   `dt_entity_key` verbatim) rather than an `additional_info.bind_strategy` token. This
   matches the pattern of two other rules I found and cross-checked, `Azure WS binding`
   (`type=microsoft.web/sites^...`) and `Nagios - IIS Short Name`
   (`type=IIS Web Server^...`), both plain multi-condition filters with no
   `@@EventRule@@` token.
2. `em_match_rule.filter` has `sys_dictionary.internal_type = "conditions"` — this is
   ServiceNow's standard generic encoded-query condition-builder field type, used
   platform-wide (e.g. business rule conditions, scheduled job conditions) and normally
   evaluated server-side the same way a `GlideRecord.addEncodedQuery()` call would be:
   `^`-joined conditions AND, `^OR` disjunction. I could not find the actual native
   binding-engine code (it isn't exposed as a customizable script include —
   `EventRuleUtil`, `FetchEventRuleJoinedData`, `EventRuleNonAdminAPIUtil` etc. are UI
   support code, not the matcher itself), so this is inference from the field's declared
   type, not a read of the matching implementation.
3. **New finding this round, directly relevant to my earlier "Defect A" theory:** I
   pulled `simple_filter` from every active `bind_type=1` rule with a plain (non-token)
   filter on the instance and found **inconsistent nesting depth across rules that are
   presumably all functioning** — e.g. `Nagios - IIS Short Name` and the original
   `Azure WS binding` have a 2-level `{or → and → [conditions]}` shape (matching what I
   have now), while `SCOM Metrics - Default`, `Nagios Fallback for metrics`, and several
   `Op5`/`OP5_V2` rules have a 3-level shape with an extra `{compound_type, subpredicates:
   [condition-or-conditions]}` wrapper in between. Since both shapes coexist among rules
   I have no reason to believe are broken, I now think `simple_filter`'s exact JSON
   nesting is very unlikely to be load-bearing for actual matching — it looks like a UI
   redraw cache, not the authority. That undercuts my prior fix-round-1 theory that the
   extra nesting I'd introduced was the root cause of Defect A. If `simple_filter` isn't
   authoritative, the real defect in the very first deploy was most likely the
   `additional_info.bind_strategy` `@@EventRule@@_N` token itself failing to restrict
   anything (an unverified, hand-composed encoding, exactly the thing Ruling 2 warned
   against) — which is also exactly what the type-based rewrite in fix round 1
   eliminated by not using that token scheme at all for the host/service rules.

**Explicit answer, restated for the record:** `identification_rules[].attributes[].value`
addresses a source-attribute name that the binding engine resolves against the em_event
record's own column first, and falls back to an `additional_info` JSON key of the same
name only if no such column exists — confirmed by cross-referencing `SCOM Metrics –
Windows Server` (`value: "node"`, a real `em_event` column) against the Azure VM
template (`value: "id"`/`"location"`/`"subscriptionId"`, which exist only in
`additional_info`). It is not exclusively one or the other. All three of our rules use
`value: "node"` (host/service) or `value: "dt_entity_id"` (catch-all, addressing
`additional_info.dt_entity_id` since there is no `dt_entity_id` em_event column) on this
same basis.

**I am not reporting this BLOCKED**, because I have a specific, reasoned, deployed fix
(standard field type, matches two independently-verified working reference rules,
removes the one confirmed-broken mechanism from the first deploy) rather than an
unverified hand-composed encoding. But I am also not claiming it is confirmed correct —
I have zero live post-fix events to point to. This is the single most important open
item for Tasks 10-12 to check on their first run once the tenant's next Davis-problem
burst lands.

### Smartscape traversal for `process` (recap, since asked again)

Restating from the first report: `dtctl verify query 'smartscapeNodes "PROCESS" | limit 5
| fieldsAdd host_name = getNodeName(getNodeField(id, "runsOn"))' --plain` **verifies
syntactically** (`✔ Query is valid`) but returns `host_name: null` on every sampled
process node, including nodes that already carry `host.name` as a plain direct field —
i.e. it is syntactically legal DQL that produces no usable data in this tenant. I tried
two additional relationship names (`isProcessOf`, `isHostedBy`); both also returned
null on every row. I stopped there rather than continuing to guess relationship names.
`process` was moved to `bind_strategy: ire_correlated` in
`mapping/dt_to_snow_cmdb_mapping.csv` as a result. `sgc_managed` was left `true` because
that field documents whether SGC discovers/manages the CI type in CMDB at all (it does,
for processes) — independent of which strategy *our* pipeline uses to identify the CI.
We just can't reconstruct SGC's `<proc>@<host>` name shape from Dynatrace data, so we
match by `correlation_id` instead of by name.

### Lookup tables (recap)

Three exist on the tenant; **`/lookups/dt_to_snow_cmdb_mapping_v3` (553 rows) is
authoritative** and is what both `dynatrace/dql/extract_events.dql` and the workflow's
inline query load. `/lookups/dt_to_snow_cmdb_mapping` (22 rows, pre-dates this project)
and `/lookups/dt_to_snow_cmdb_mapping_v2` (553 rows, superseded — still has `process` as
`sgc_process`) are stale rollback artifacts, left in place because the token cannot
delete them. Nothing currently references either.

### Files changed this round

- `scripts/bind-rate-report.sh` — cmdb_ci-based bound measurement, entity-less
  separation (FIX 1 + FIX 3).
- No `.now.ts`/DQL/workflow changes this round — the em_match_rule scoping and
  `dt_ci_name` null-guard were both already fixed and deployed in fix round 0
  (the same session, before this round's review); this round redeployed the Fluent app
  again as a clean confirmation step (no content changes) and re-verified the live
  `filter` values match what's intended.

### Concerns (updated)

1. **Defect A's live confirmation is still pending** — the fix is deployed and reasoned,
   not yet proven against a live event. This is the top item for the next task/run.
2. Corrected BINDABLE baseline is 0/23 (0%) on the current (stale, pre-fix) sample — the
   true test is the next sample taken after a fresh Davis-problem burst.
3. `simple_filter`'s exact nesting shape appears to vary across genuinely active rules on
   this instance and is probably not load-bearing; documenting this so nobody spends
   more effort trying to make the two shapes converge without evidence it matters.
4. Everything else from the original report's concerns list stands: one host event has a
   null Dynatrace entity name (expected, clean failure); three lookup tables exist,
   only v3 is live; `bind_fallbacks` left unset for lack of a working example to derive
   its shape from.

---

## Fix round 2 — process binds by name after all

The controller found the actual bug in my Smartscape traversal: the edge type is
`runs_on` (snake_case), not `runsOn`. `getNodeField(id, "runsOn")` silently returns
null for a nonexistent edge type rather than erroring, which is exactly why it "verified
but returned null" in my original attempt — I read that as "the traversal doesn't work"
when the real problem was one wrong string.

### What changed

1. **`mapping/dt_to_snow_cmdb_mapping.csv`**: `process` reverted to
   `bind_strategy: sgc_process` (was `ire_correlated`). `sgc_managed` stays `true`,
   unchanged.
2. **New lookup `/lookups/dt_to_snow_cmdb_mapping_v4`** (553 rows) — created via
   `./scripts/upload-lookup.sh mapping/dt_to_snow_cmdb_mapping.csv
   /lookups/dt_to_snow_cmdb_mapping_v4` since the token still cannot delete v3. **v4 is
   now authoritative.** v1 (`/lookups/dt_to_snow_cmdb_mapping`, 22 rows), v2 (553 rows),
   and v3 (553 rows) are all stale rollback artifacts; nothing references them.
3. **`dynatrace/dql/extract_events.dql`** — added a second `lookup` stage that joins
   `dt_entity_id` (for `process`-typed rows) against a `smartscapeEdges "runs_on"`
   traversal resolving each process's parent host name, then extended `dt_ci_name` with
   a third branch: `bind_strategy == "sgc_process" and dt_entity_name and host_name both
   non-null -> concat(dt_entity_name, "@", host_name)`, else fall through (no
   half-composed `"@host"` or `"proc@"` strings - same null-guard discipline as the
   `sgc_service` branch). Mirrored the identical change into the workflow's inline copy
   of this query. Switched both to load `v4`.
4. Regenerated `/tmp/extract_literal.dql` from the current query (not reused) and
   re-verified: `dtctl verify query -f /tmp/extract_literal.dql --plain` → `✔ Query is
   valid`. Re-applied the workflow.
5. **Added a fourth `em_match_rule`** (`dt-bind-sgc-process`, order 8030,
   `ci_type: cmdb_ci_appl`) to `servicenow/src/fluent/dynatrace-event-rules.now.ts`,
   scoped identically to host/service (`filter: source=Dynatrace^type=process^EQ`,
   `identification_rules` matching CI `name` against em_event `node`). Rebuilt and
   redeployed the Fluent app; confirmed all four rules (`order: 8010/8020/8030/8090`)
   live on the instance with the intended `filter`/`ci_type` values.

### Acceptance evidence (per instruction: verify against the DQL directly, not live em_events)

Ran the regenerated `/tmp/extract_literal.dql` live (`dtctl query -f /tmp/extract_literal.dql
-o json --plain`, 6h window, 1000-row cap). Of 1000 sampled rows, **871 were
`dt_entity_key = process`**, all with `bind_strategy = sgc_process` and a populated
`dt_ci_name` in the exact `<proc>@<host>` shape, e.g.:
```
'chrome' -> 'chrome@ace-box-hfvm'
'cartservice opentelemetry-demo-cartservice-*' -> 'cartservice opentelemetry-demo-cartservice-*@gke-salsa-cluster-basic-salsa-pool-092fc55d-j1ga'
'kafka.docker.KafkaDockerWrapper kafka-* kafka-* kafka' -> 'kafka.docker.KafkaDockerWrapper kafka-* kafka-* kafka@aks-agentpool-21707267-vmss00000k'
```
Zero rows had a null `dt_ci_name` and zero had a half-composed name (`@host` or
`proc@`) among the 871 process rows. This matches the shape the controller confirmed
against live CMDB CIs (`cart cart-75bdb64689-4jj6p@aks-agentpool-21707267-vmss00000n`
etc.).

I did **not** wait on live `em_event` records to demonstrate this, per instruction — no
new Davis-problem burst had landed since the round-1 check (still the same 45-record
sample from `sys_created_on` 2026-09-06 21:37 through 01:27:59), and I checked once,
not in a loop.

### Answers to the two questions carried over from round 1

**1. Which addressing does `identification_rules[].attributes[].value` use?**
Confirmed (not "could not determine"): it is a source-attribute name resolved against
the em_event record, checked as a direct `em_event` column first and falling back to an
`additional_info` JSON key of the same name if no such column exists. Evidence: the
Azure VM template's `value: "id"`/`"location"`/`"subscriptionId"` exist only in
`additional_info` (cross-checked against that same rule's `additional_info_filter`,
which filters on those identical key names), while `SCOM Metrics – Windows Server`'s
`value: "node"` is a real `em_event` column (confirmed via `sys_dictionary`). All four
of our rules use this basis: `value: "node"` for host/service/process (the workflow
writes the correctly shaped CI name into that column), `value: "dt_entity_id"` for the
catch-all (no `dt_entity_id` em_event column exists, so this resolves via the
`additional_info` fallback).

**2. Is the round-1 rule scoping fix confirmed by any post-fix event yet?**
**No. Still zero.** As of this round's check, the sample is still the same 45
pre-fix records (`sys_created_on` no later than 2026-09-07 01:27:59); no event has been
created since. I cannot confirm live that `type=host`/`type=service`/`type=process`
scoping stops the over-broad matching the controller originally caught (39 of 45 events
wrongly carrying "Event rule applied: Dynatrace - bind host events..."). The reasoning
for why it should work is unchanged from round 1 (standard `conditions`-type field,
matches two independently-existing working reference rules' plain-filter pattern, and
removes the one confirmed-broken mechanism — the hand-composed
`additional_info.bind_strategy` `@@EventRule@@_N` token — entirely). This remains the
single highest-priority thing for Tasks 10-12 to check on their first run once a fresh
Davis-problem burst lands.

### correlation_id limitation (documented per instruction, not fixed)

`correlation_id` is empty on every SGC-created CI in this CMDB (controller-verified).
The `ire_correlated` catch-all rule (order 8090) can therefore never bind any entity
type that depends on matching `correlation_id` alone — this is a real, structural gap
in the current CMDB data, not a rule defect, and writing `correlation_id` into CMDB is
explicitly out of scope for this task. Documented as a known limitation in the rule's
own code comment (`servicenow/src/fluent/dynatrace-event-rules.now.ts`) and here.
`ire_correlated` bind rates measured going forward should be read as a floor on CMDB
coverage for those entity types, not a true measure of pipeline correctness.

### Files changed this round

- `mapping/dt_to_snow_cmdb_mapping.csv` — `process`: `ire_correlated` → `sgc_process`.
- `dynatrace/dql/extract_events.dql` — `runs_on` edge lookup + `dt_ci_name` third branch,
  lookup source switched to `v4`.
- `dynatrace/workflows/dt-problems-to-snow-itom.yaml` — identical inline change.
- `servicenow/src/fluent/dynatrace-event-rules.now.ts` — new `dt-bind-sgc-process` rule
  (order 8030); updated comments on the catch-all rule for the correlation_id
  limitation and the reduced scope (process no longer routes through it).
- `servicenow/src/fluent/generated/keys.ts` — new explicit key `dt-bind-sgc-process`.
- New Dynatrace lookup table `/lookups/dt_to_snow_cmdb_mapping_v4` (553 rows,
  authoritative; v1/v2/v3 stale).

### Concerns (updated again)

1. **Live confirmation of the round-1 AND round-2 rule scoping is still pending** — same
   root cause as before (no fresh Davis-problem burst since 01:27:59). The `process`
   composition itself is now verified end-to-end against the DQL and against CMDB naming
   convention; what remains unverified live is purely whether the `em_match_rule.filter`
   scoping actually restricts matching the way the field's declared type implies.
2. `correlation_id` empty on all SGC CIs means `ire_correlated` bind rates will
   understate true CMDB coverage for every entity type routed there — documented as a
   known, out-of-scope limitation, not something to chase further in this task.
3. Four lookup tables now exist; only v4 is live. v1/v2/v3 are rollback artifacts, left
   untouched per the no-delete constraint.
4. Everything else from prior rounds' concerns stands (null-named host event; unset
   `bind_fallbacks`).
