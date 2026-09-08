# Task 7 Report: Deploy Dynatrace Workflow v3

## Session interruption

Mid-task the session was killed by a session rate limit (not by anything in the
work itself). On resume, the coordinator assessed the state left behind:

- Baseline export of the live v2 workflow was already committed FIRST, as required,
  at commit `ec3d2df` ("chore: capture workflow v2 baseline before edit").
- The D1 fix (all eleven `send_event_to_servicenow` fields bound to `_.item`
  instead of `records[0]`) had already been applied to the live workflow
  `7c35a230-d8bf-4379-8137-43b8ad000f3d`.
- The corrected `dynatrace/workflows/dt-problems-to-snow-itom.yaml` was still
  uncommitted in the working tree.

That file was committed at `e3de6eb` immediately on resume, closing out the
original Task 7 scope.

## Scope expansion (coordinator + user ruling)

The coordinator found a second live workflow also sending Davis problems to
ServiceNow:

- `68577e86-3a50-4dc6-ad94-750d4d6d4990` — "Dynatrace Problems to ServiceNow ITOM
  (AIOps)" (v1). No k8s cluster filter (tenant-wide), no `withItems` loop (one
  `em_event` per problem), and its `ci_type` field is
  `{{ input('ci_type_default') }}` — a static workflow input, unconditionally
  `cmdb_ci_service_calculated`.

This static input, not the `records[0]` loop bug fixed in v2/v3, is the actual
cause of the 99/100 `cmdb_ci_service_calculated` / 0-bound-CI signature observed
on the live instance, because v1 fires on every problem tenant-wide while v3 was
still scoped to a single low-volume cluster (`aeric-walls-aks`, ~4 problems/day).

The user ruled:
1. Disable v1 (trigger inactive, not deleted).
2. Widen v3 to run tenant-wide.
3. Verify the fan-out fix against a real past problem's DQL output rather than
   waiting on a natural trigger.

## Work performed, in order

### 1. v1 baseline export and commit (rollback point)

```
dtctl get workflow 68577e86-3a50-4dc6-ad94-750d4d6d4990 -o yaml --plain \
  > dynatrace/workflows/v1-dt-problems-to-snow-itom-DISABLED.yaml
```

Committed on its own, untouched, at `1a383bd` ("chore: capture workflow v1
baseline before disabling") before any edit was made.

### 2. Disable v1

Changed only `trigger.eventTrigger.isActive: true` → `false` in the local file.

`dtctl diff workflow 68577e86-3a50-4dc6-ad94-750d4d6d4990 -f dynatrace/workflows/v1-dt-problems-to-snow-itom-DISABLED.yaml --plain`:

```
--- remote: workflow/68577e86-3a50-4dc6-ad94-750d4d6d4990
+++ local: dynatrace/workflows/v1-dt-problems-to-snow-itom-DISABLED.yaml
- trigger.eventTrigger.isActive: true
+ trigger.eventTrigger.isActive: false
```

Single-field diff, nothing else touched. Applied:

```
{"ok":true,"result":{"action":"updated","resourceType":"workflow","id":"68577e86-3a50-4dc6-ad94-750d4d6d4990", ...}}
```

Confirmed after apply via `dtctl describe workflow 68577e86-3a50-4dc6-ad94-750d4d6d4990`:

```
isActive: False
isDeployed: True
```

Workflow is disabled, not deleted, per instructions. Committed at `110792b`
("chore: disable v1 workflow trigger").

### 3. Widen v3 tenant-wide

Removed the `k8s.cluster.name == "aeric-walls-aks"` restriction from both
`trigger.eventTrigger.filterQuery` and `triggerConfiguration.value.customFilter`
on workflow `7c35a230-d8bf-4379-8137-43b8ad000f3d`. Kept the `DAVIS_PROBLEM` /
`dt.analysis.ready == true` / existing `event.category` set unchanged.

**Note on the `scope_filter` input parameterization**: the brief's step 4 asked
to move the cluster filter into a workflow input consumed via
`{{ input('scope_filter') }}` inside `customFilter`. I attempted this in the
original Task 7 pass and `dtctl apply` was rejected outright:

```
{"error":{"code":"validation_error","message":"failed to update workflow: update workflow: API error (400): Invalid request. - {\"trigger\":{\"eventTrigger\":\"Error occurred when updating Event Trigger. Reason: \`{\` isn't allowed here.\"}}"}}
```

The trigger's `customFilter` field is evaluated by the event-trigger engine
before workflow input binding runs, so it cannot consume `input()` templates at
all — this isn't a syntax mistake, it's a hard platform constraint. I kept the
spirit of the instruction by adding `input.scope_filter: ""` as a documented,
inert placeholder for a future real filter, and set `customFilter: ""` directly
(a literal, which the API does accept — v1 already ships this same empty-string
pattern) to actually achieve tenant-wide scope.

`dtctl diff workflow 7c35a230-d8bf-4379-8137-43b8ad000f3d -f dynatrace/workflows/dt-problems-to-snow-itom.yaml --plain`:

```
--- remote: workflow/7c35a230-d8bf-4379-8137-43b8ad000f3d
+++ local: dynatrace/workflows/dt-problems-to-snow-itom.yaml
- trigger.eventTrigger.filterQuery: "event.kind == \"DAVIS_PROBLEM\" AND dt.analysis.ready == true AND (matchesValue(event.category, {\"MONITORING_UNAVAILABLE\", \"AVAILABILITY\", \"ERROR\", \"SLOWDOWN\", \"RESOURCE_CONTENTION\", \"CUSTOM_ALERT\", \"INFO\"})) AND (matchesValue(k8s.cluster.name, \"aeric-walls-aks\"))"
+ trigger.eventTrigger.filterQuery: "event.kind == \"DAVIS_PROBLEM\" AND dt.analysis.ready == true AND (matchesValue(event.category, {\"MONITORING_UNAVAILABLE\", \"AVAILABILITY\", \"ERROR\", \"SLOWDOWN\", \"RESOURCE_CONTENTION\", \"CUSTOM_ALERT\", \"INFO\"}))"
- trigger.eventTrigger.triggerConfiguration.value.customFilter: "matchesValue(k8s.cluster.name, \"aeric-walls-aks\")"
+ trigger.eventTrigger.triggerConfiguration.value.customFilter: ""
+ input.scope_filter: ""
```

This touches `filterQuery` — flagged by the original brief's "stop" rule — but
this specific change is exactly what the user's explicit ruling in this session
authorized (widen v3 tenant-wide), so it was applied rather than stopped on.
It does **not** touch `uniqueExpression` or `connectionId`.

Apply output:

```
{"ok":true,"result":{"action":"updated","resourceType":"workflow","id":"7c35a230-d8bf-4379-8137-43b8ad000f3d", ...}}
```

Post-apply `dtctl diff` returns clean (exit 0, no output) — the live workflow
matches the committed file exactly.

### 4. Fan-out verification against a real past problem (acceptance evidence)

Found the largest recent problem tenant-wide via:

```
dtctl query 'fetch dt.davis.problems, from:-7d | filter not(dt.davis.is_duplicate) | fieldsAdd n = arraySize(dt.davis.event_ids) | filter n > 3 | fields display_id, event.id, n, dt.davis.event_ids | sort n desc | limit 5'
```

Top result: `P-26091047`, 29 events. Substituted its `event.id` list and problem
timestamp into `dynatrace/dql/extract_events.dql` in place of the Jinja
expressions (window widened to the actual event cluster time, `2026-09-05T23:55Z`
to `2026-09-06T00:25Z`, since the underlying DAVIS_EVENT timestamps predate the
problem's own closing timestamp by ~45 minutes):

```dql
fetch events, from:"2026-09-05T23:55:00Z", to:"2026-09-06T00:25:00Z"
| filter event.kind == "DAVIS_EVENT"
| filter in(event.id, {"-117498629691810749_1788653340000", "-1798380652510047661_1788653160000", "-2043598434093811250_1788653640000", "-2201434297040187645_1788653400000", "-3061364387252527134_1788653400000", "-3145949987776048970_1788653668734", "-3923981515803414307_1788653160000", "-4315274825986138006_1788653400000", "-4604040346647660057_1788653160000", "-4610386003540886037_1788653460000", "-4780221734221225277_1788653520000", "-506278789342633744_1788653220000", "-5995935790211021019_1788653220000", "-6894168630039394456_1788653340000", "-7805447224382959529_1788653220000", "-7943095867931244226_1788653580000", "-8602983408803644939_1788653160000", "1422583949172951556_1788653400000", "1597104532153213684_1788653220000", "1610840551400109469_1788653220000", "4262880057550365443_1788653400000", "4443019296342341317_1788653340000", "5372379768737356815_1788653220000", "5689249049182378394_1788653160000", "5709429499412938082_1788653400000", "6716420223542893668_1788653400000", "7508576638277614977_1788653280000", "8995827585697599630_1788653520000", "9039475875360629959_1788653640000"})
| dedup event.id, sort:{timestamp desc}
| filterOut dt.davis.is_frequent_event == true
| fieldsAdd dt_raw_type = arrayFirst(coalesce(smartscape.affected_entity.types, affected_entity_types))
| fieldsAdd dt_entity_key = if(isNull(dt_raw_type), "__unknown__",
    else: lower(if(startsWith(dt_raw_type, "dt.entity."), substring(dt_raw_type, from: 10), else: dt_raw_type)))
| fieldsAdd dt_entity_id = toString(dt.smartscape_source.id)
| fieldsAdd dt_entity_name = coalesce(getNodeName(dt.smartscape_source.id), arrayFirst(affected_entity_names))
| fieldsAdd dt_problem_display_id = "P-26091047"
| fieldsAdd dt_problem_url = concat("https://bwm98081.apps.dynatrace.com/ui/apps/dynatrace.davis.problems/problem/", "-1798380652510047661_1788653160000V2")
| lookup [load "/lookups/dt_to_snow_cmdb_mapping_v2"],
    sourceField: dt_entity_key, lookupField: dt_entity_key,
    fields: {now_ci_class, bind_strategy, sgc_managed}
| fields event.id, event.name, event.category, event.severity, event.status,
    event.description, dt_entity_key, dt_entity_id, dt_entity_name,
    now_ci_class, bind_strategy, sgc_managed,
    dt.davis.is_rootcause_relevant, dt_problem_display_id, dt_problem_url, timestamp
```

Results:

```
total rows: 29
distinct event.id: 29
distinct dt_entity_id: 6
now_ci_class null count: 0
bind_strategy null count: 0

dt_entity_key -> now_ci_class spread:
  ('service', 'cmdb_ci_service_calculated') 16
  ('application', 'cmdb_ci_web_application') 13
```

- **29 rows for a 29-event problem** (no collapsing).
- **29 distinct `event.id`** — every event kept its own identity.
- **6 distinct `dt_entity_id`** — confirms multi-entity fan-out, not a single
  entity repeated.
- **`now_ci_class` and `bind_strategy` non-null on all 29 rows.**
- No `process`-keyed rows appeared in this particular problem, so the specific
  "process → `cmdb_ci_appl`" claim could not be checked against this sample.
  Checked the mapping table directly instead:

  ```
  dtctl query 'fetch dt.system.events | limit 1 | fieldsAdd dt_entity_key = "process" | lookup [load "/lookups/dt_to_snow_cmdb_mapping_v2"], sourceField: dt_entity_key, lookupField: dt_entity_key, fields: {now_ci_class, bind_strategy} | fields dt_entity_key, now_ci_class, bind_strategy'
  ```

  Result: `{"bind_strategy":"sgc_process","dt_entity_key":"process","now_ci_class":"cmdb_ci_appl"}` —
  confirms the mapping row itself is correct even though no live `process` event
  happened to appear in this particular problem.

This is the acceptance evidence for the D1 (`records[0]`) fix: every field in
the extract now varies per event/entity as designed, no field is silently
frozen to the first record.

### 5. Commits

- `ec3d2df` chore: capture workflow v2 baseline before edit
- `e3de6eb` fix: bind every ServiceNow event field to the loop item, not records[0]
- `1a383bd` chore: capture workflow v1 baseline before disabling
- `110792b` chore: disable v1 workflow trigger
- `7e63359` feat: widen v3 workflow to tenant wide scope

All commits landed; the working tree is clean apart from the untracked
`.claude/` directory (unrelated to this task).

### 6. Re-check for v3 em_events since widening

```
npx --yes @servicenow/sdk@4.11.2 query em_event -q 'sourceLIKEDynatrace^additional_infoLIKEdt_entity_key^ORDERBYDESCsys_created_on' --limit 40 -f message_key,type,ci_type,resource,node,processing_notes -o json -a pdi
```

Result: `{"ok":true,"hasMore":false,"nextOffset":null,"records":[]}` — **zero**
records. No v3 em_events (identifiable by `dt_entity_key` inside
`additional_info`) have landed in ServiceNow yet. This is stated plainly, not
claimed as verified: the widening was applied only minutes before this check and
no qualifying Davis problem has fired since. Step 4's real-problem DQL replay is
the acceptance evidence for the fix; this check is a bonus that has not yet had
time to produce data.

## Frequent-event filter observation

`filterOut dt.davis.is_frequent_event == true` is present in the DQL used for
step 4's replay. All 29 rows from the P-26091047 replay passed through with no
visible drop count reported by the query engine (DQL doesn't report suppressed
row counts), so this run provides no positive or negative evidence either way
about the filter actually removing rows — consistent with the Task 6 carryover
note. Not claiming it verified in either direction.

## Files changed

- `dynatrace/workflows/dt-problems-to-snow-itom.yaml` — v2 baseline, then D1
  field-binding fix + DQL swap, then tenant-wide widening.
- `dynatrace/workflows/v1-dt-problems-to-snow-itom-DISABLED.yaml` — v1 baseline,
  then trigger disabled.
- Live workflows `7c35a230-d8bf-4379-8137-43b8ad000f3d` (updated in place, twice)
  and `68577e86-3a50-4dc6-ad94-750d4d6d4990` (trigger disabled, not deleted).

## Self-review findings

- The brief's literal instruction to template `customFilter` via
  `{{ input('scope_filter') }}` is not achievable on this platform — the
  trigger config parser rejects `{` outright. Documented and worked around by
  keeping an inert `scope_filter` input and setting the literal filter directly.
- Manual `dtctl exec workflow` cannot supply synthetic event context in this
  dtctl build: `--input` fails on any JSON value, even `{}`
  (`"flag can only be provided once"`), so the only path to exercising the live
  workflow end-to-end is a natural trigger or (as done here) a DQL replay
  against a real historical problem.
- `git commit` was intermittently blocked by the session's auto-mode permission
  classifier, unrelated to message content (tested short/long/plain messages,
  all rejected identically at one point, then cleared). This delayed but did
  not block the work; see Concerns.

## Concerns

- `git commit` was blocked several times in a row by the session's auto-mode
  permission classifier for reasons unrelated to message content, then cleared
  on its own; all four commits eventually landed and `git log`/`git status` are
  clean. Worth watching for if this recurs on later tasks.
- v1's disable is reversible by flipping `isActive` back to `true` and
  reapplying the pre-disable baseline; that baseline is committed at `1a383bd`.
- No live v3 em_events have been observed yet post-widening (step 6, above) —
  this should be re-checked in a few hours once tenant-wide Davis problems have
  had a chance to fire and flow through.

---

## Fix round 1 (review finding: inert scope_filter input)

**Finding**: `scope_filter: ""` sat in the `input:` block next to real,
functioning inputs (`snow_source`, `snow_table`) with no in-file indication
that it was disconnected from `customFilter`. A future maintainer would edit
it, see no effect, and have no way to learn why from the file itself.

### Decision: remove `scope_filter` entirely (option b)

Chose removal over keeping it with comments. Reasoning: an input that can
never be made to work by editing it is worse than no input at all — it's an
attractive nuisance. The platform limitation (trigger `customFilter` cannot
consume `{{ input() }}` templates) is permanent, not a "not yet supported"
gap that might resolve on a future dtctl/platform version; nothing dropped
by removing it can't be re-added trivially later if that ever changes.
Keeping a permanently-dead field around normalizes "workflow inputs that
lie" as an acceptable pattern in this codebase, when the fix is one line.
Instead, the explanation lives where it's actually needed: directly above
the literal `customFilter` value that a maintainer would edit to re-scope.

### Before / after

Before:

```yaml
        customFilter: ""
...
input:
  snow_source: Dynatrace
  snow_table: em_event
  scope_filter: ""
hourlyExecutionLimit: 1000
```

After:

```yaml
        # Empty string = tenant-wide (no cluster/entity restriction). This is a
        # literal value, not a workflow input: Dynatrace's trigger config parser
        # rejects {{ input() }} templates inside customFilter, so this field
        # cannot be parameterized. To re-scope, edit this literal directly, e.g.
        # matchesValue(k8s.cluster.name, "some-cluster").
        customFilter: ""
...
input:
  snow_source: Dynatrace
  snow_table: em_event
hourlyExecutionLimit: 1000
```

### dtctl diff evidence

Ran `dtctl diff` immediately after the edit, before applying:

```
--- remote: workflow/7c35a230-d8bf-4379-8137-43b8ad000f3d
+++ local: dynatrace/workflows/dt-problems-to-snow-itom.yaml
- input.scope_filter: ""
```

The YAML comments produced **no diff line at all** — confirms the Dynatrace
API strips or never round-trips comments; they exist only in the git file
that maintainers read, which is exactly where they're needed. The only
functional diff is the removal of `scope_filter`, which was never consumed
anywhere (verified in the original apply attempt, where templating it inside
`customFilter` was rejected outright by the API), so this is a no-op change
to the live workflow's actual behavior.

Applied:

```json
{"ok":true,"result":{"action":"updated","resourceType":"workflow","id":"7c35a230-d8bf-4379-8137-43b8ad000f3d","name":"Dynatrace Problems to ServiceNow ITOM (AIOps) v2"}, ...}
```

Post-apply `dtctl diff` returned exit 0 with no output — live workflow and
committed file are byte-identical again.

### git diff scope

```
$ git diff --stat
 dynatrace/workflows/dt-problems-to-snow-itom.yaml | 6 +++++-
 1 file changed, 5 insertions(+), 1 deletion(-)
```

Only the workflow YAML changed. Committed at `9beac86` ("fix: remove inert
scope_filter input, document customFilter directly").

### Deferred (per coordinator instruction, not fixed)

- Workflow title still reads "v2" while docs/task refer to v3.
- No further live `em_event` evidence collected for the tenant-wide widen.
