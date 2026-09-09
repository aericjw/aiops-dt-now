# Resuming this build on another machine

All 14 numbered plan tasks, Task 9b, and two out-of-plan follow-ups (the
single-alert correlation gap fix, and this final whole-branch review's fix
wave) are complete. This file is the "how do I pick this repo up cold"
reference; see `docs/USER-SETUP.md` for what still requires the user's own
action, and `docs/superpowers/specs/2026-09-05-dynatrace-servicenow-aiops-design.md`
section 16 for the authoritative, most recently updated verification-results
table (V1-V8).

## 1. Local prerequisites

| Requirement | Check | Notes |
|---|---|---|
| `dtctl` with context `tacocorp` | `dtctl config current-context --plain` | Must print `tacocorp`. Safety level `readwrite-all`. |
| `now-sdk` auth alias `pdi` | `npx --yes @servicenow/sdk@4.11.2 auth --list` | Points at `https://dev285073.service-now.com/` |
| Python 3 with pytest | `python3 -m pytest tests/ -v` | Should be 21 passing (20 Python CLI/unit tests + 1 Node-backed correlation-script regression test, see `tests/test_correlation_grouping.py`) |
| Node (for the correlation-script test only) | `node --version` | `tests/test_correlation_grouping.py` is skipped, not failed, if node is absent |
| `gh` authenticated | `gh auth status` | Only needed for pushing |

### Dynatrace token scope gap

The `tacocorp-oauth` token has `storage:files:write` but NOT `storage:files:delete`.
Lookup tables therefore cannot be replaced in place - each revision is uploaded to a
new path. Four now exist (`dt_to_snow_cmdb_mapping`, `_v2`, `_v3`, `_v4`); only
`_v4` is authoritative and it is the one actually loaded by
`dynatrace/dql/extract_events.dql` and `dynatrace/dql/checks/lookup-coverage.dql`.
If you publish a new mapping version, update BOTH `scripts/upload-lookup.sh`'s
default path AND `extract_events.dql`'s load path together - see that script's
header comment (fixed after they drifted apart once, in the final review fix
wave).

### Claude Code permission rules

Live writes are blocked by the auto-mode classifier without these. Recreate
`.claude/settings.local.json` (deliberately not committed - it is machine-local):

```json
{
  "permissions": {
    "allow": [
      "Bash(dtctl create lookup:*)",
      "Bash(dtctl delete lookup:*)",
      "Bash(dtctl apply:*)",
      "Bash(dtctl exec workflow:*)",
      "Bash(bash scripts/upload-lookup.sh:*)",
      "Bash(npx --yes @servicenow/sdk@4.11.2 init:*)",
      "Bash(npx --yes @servicenow/sdk@4.11.2 build:*)",
      "Bash(npx --yes @servicenow/sdk@4.11.2 deploy:*)",
      "Bash(npx --yes @servicenow/sdk@4.11.2 install:*)"
    ]
  }
}
```

## 2. Restore the execution ledger

The subagent-driven-development skill reads its ledger from a git-ignored
scratch directory. Restore it so the process can resume rather than
re-dispatching completed tasks:

```bash
mkdir -p .superpowers/sdd/2026-09-05-dynatrace-servicenow-aiops
cp docs/execution/execution-ledger.md \
   .superpowers/sdd/2026-09-05-dynatrace-servicenow-aiops/progress.md
cp docs/execution/task-reports/*.md \
   .superpowers/sdd/2026-09-05-dynatrace-servicenow-aiops/
```

Task briefs regenerate from the plan; review diffs regenerate from git history.
Neither is committed.

## 3. Live state already deployed

Do not rebuild these - they exist and are working (or, where noted, exist and
are deployed but have an open question about whether the platform actually
exercises them - see section 4).

| System | Object | State |
|---|---|---|
| Dynatrace | `/lookups/dt_to_snow_cmdb_mapping_v4` | 553 rows, authoritative |
| Dynatrace | `/lookups/dt_to_snow_cmdb_mapping`, `_v2`, `_v3` | stale, undeletable (token lacks `storage:files:delete`), ignore |
| Dynatrace | Workflow `7c35a230-d8bf-4379-8137-43b8ad000f3d` | v3, tenant-wide (this scope decision is final - see `docs/USER-SETUP.md`), per-event fan-out |
| Dynatrace | Workflow `68577e86-3a50-4dc6-ad94-750d4d6d4990` | v1, trigger disabled (not deleted), preserved for rollback |
| ServiceNow | App scope `x_1906732_dtaiops` | "Dynatrace AIOps Event Pipeline" v0.0.1 |
| ServiceNow | 4 `em_match_rule` records, order band 8000-8099 | host 8010, service 8020, process 8030, catch-all 8090 |
| ServiceNow | `em_alert_correlation_rule` "Dynatrace - group alerts by Davis problem id" (order 90) | Script logic fixed and unit-tested this review (see section 4); live end-to-end effect unconfirmed |
| ServiceNow | `em_alert_management_rule` "Dynatrace - operator telemetry actions" (order 8100) + 3 child actions | Open problem (kb_url via `sys_script` Business Rule, this review's I1 fix), fetch logs, fetch metrics (per-entity-class metric, this review's I5 fix) - all credential-gated per `docs/USER-SETUP.md` steps 1-3 except "Open problem" |
| ServiceNow | `sys_script` "Dynatrace - populate alert kb_url" | Before-insert Business Rule on `em_alert`, deployed and content-verified this review (I1 fix) |
| ServiceNow | Now Assist skill "Dynatrace Alert Telemetry Skill" | Source deployed (Task 14); publishing is a licensed, UI-gated user action - see `docs/USER-SETUP.md` step 5 |
| ServiceNow | ~48 permanent synthetic CMDB CI records, `discovery_source=SIM-Dynatrace-Test` | Backfilled by Task 9b; confirmed non-deletable, non-renamable via any available write path (platform limitation, not a bug) - see `docs/USER-SETUP.md` |

## 4. Current status and known open items

Everything the plan asked for is implemented and deployed. Two things remain
open, both discovered/re-confirmed during the final whole-branch review
(2026-09-08) and neither blocking further use of the pipeline day to day:

### 4.1 Correlation script is fixed and unit-tested; live engine behavior is unconfirmed

The correlation script (`servicenow/src/fluent/correlation/dynatrace-problem-grouping.now.ts`)
had two real bugs, both fixed and deployed this review:

- **C1**: a `\s` inside the script's backtick template literal collapsed to a
  literal `s` at parse time (a JS template-literal escaping rule), so the
  deployed regex was `[{,]s*` instead of `[{,]\s*` and never matched the real
  `, ` separator in `additional_content`. Fixed (`\\s` in source), and
  confirmed via a live `now-sdk query` of the deployed `script` field that it
  now contains a real `\s` token.
- **C2**: the fix for the single-alert gap (a prior follow-up) made ANY solo
  alert PRIMARY regardless of root-cause status, which would have caused
  duplicate incidents once C1 made grouping actually work (a non-root-cause
  alert arriving first becomes PRIMARY and gets promoted to an incident; the
  real root-cause alert then arrives, re-parents it, and gets its OWN
  incident too). Fixed by gating the solo-primary branch on
  `current.isRootCause`.
- Both fixes are covered by `tests/test_correlation_grouping.js` (I7), which
  extracts the live script text out of the `.now.ts` source and runs it
  against stub `GlideRecord`/`GlideDateTime` for all four
  solo/multi x rootcause/not-rootcause cases, plus a direct check that the
  deployed regex text contains `\s`, not the broken `s`.

**What is NOT yet confirmed**: whether ServiceNow's correlation *engine*
actually applies the script's PRIMARY/SECONDARY result to `em_alert.correlation_rule_group`
and creates an `em_agg_group` for it. After deploying the fix, a live Davis
problem (P-26091519, a solo alert already marked
`dt.davis.is_rootcause_relevant=true` - exactly the case the fix targets)
arrived and was independently confirmed, via the same extraction-and-run
technique used in the test harness, to compute the correct PRIMARY result for
itself - but its live `correlation_rule_group` stayed `0` (None) at least 15+
minutes after creation, and querying `em_agg_group` instance-wide shows **zero
groups of any kind have been created since 2026-06-24**, for any alert source,
not just Dynatrace. This suggests either a much longer async processing delay
than observed, or a platform/entitlement gap in whether "advanced"
(script-based) `em_alert_correlation_rule` records are invoked at all on this
PDI, independent of the script's own correctness. `evt_mgmt.enable_alert_correlation`
is `true` and all Event/Alert Management plugins queried are active, so the
cause (if any) is not an obviously-disabled feature flag or plugin. **This is
a new finding from this review, not something the original C1/C2 defects
predicted, and is worth investigating further** - ideally with ServiceNow
platform-log access (a `syslog` query for correlation-engine activity timed
out in this session at the 30s API limit) or a support case, before treating
spec section 16's V6/V7 checks as fully resolved. Until then, V6/V7 should be
read as "script-level fix complete and unit-verified; engine-level effect
not live-confirmed" rather than "PASS."

### 4.2 kb_url ("Open problem in Dynatrace") - fixed and deployed, live confirmation pending a new alert

Task 13's original mechanism (a field mapping in the ingestion workflow
writing `kb_url` on `em_event`) was dead code: `em_event` has no `kb_url`
column at all, so the mapping silently dropped. Fixed this review (I1) by
removing that mapping and adding a `sys_script` Business Rule on `em_alert`
(before insert) that parses `dt_problem_url` back out of the alert's own
`additional_info` and sets `kb_url` directly. Deployed and confirmed via live
query that the business rule exists with the correct collection/when/condition
and that its script's regex is correctly escaped (same `\s` care as C1). No
new Dynatrace alert arrived in the ~20 minutes after this deploy to observe a
fresh `kb_url` value live, so the click-through / final populated value on a
brand-new alert is fixed-by-inspection and unit-checked (the regex logic was
run standalone against a real captured `additional_info` payload and correctly
extracted the URL) but not yet observed on a freshly-created live record.

## 5. Deferred minor findings

Collected across task reviews and the final whole-branch review, none
blocking. See the ledger for the full list - search for `minor (deferred)`.
The close-path race condition (spec section 16, ~60 second raw-event
ingestion lag that can cause a missed severity-0 close event on some closes)
remains open by design - see `docs/USER-SETUP.md`.
