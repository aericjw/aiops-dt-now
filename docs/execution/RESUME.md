# Resuming this build on another machine

Everything needed to continue is in this repo plus four local prerequisites.

## 1. Local prerequisites

| Requirement | Check | Notes |
|---|---|---|
| `dtctl` with context `tacocorp` | `dtctl config current-context --plain` | Must print `tacocorp`. Safety level `readwrite-all`. |
| `now-sdk` auth alias `pdi` | `npx --yes @servicenow/sdk@4.11.2 auth --list` | Points at `https://dev285073.service-now.com/` |
| Python 3 with pytest | `python3 -m pytest tests/ -v` | Should be 20 passing |
| `gh` authenticated | `gh auth status` | Only needed for pushing |

### Dynatrace token scope gap

The `tacocorp-oauth` token has `storage:files:write` but NOT `storage:files:delete`.
Lookup tables therefore cannot be replaced in place - each revision is uploaded to a
new path. Four now exist; only the newest is authoritative. Granting
`storage:files:delete` would allow consolidating back to a single path.

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

Do not rebuild these - they exist and are working.

| System | Object | State |
|---|---|---|
| Dynatrace | `/lookups/dt_to_snow_cmdb_mapping_v4` | 553 rows, authoritative |
| Dynatrace | `/lookups/dt_to_snow_cmdb_mapping`, `_v2`, `_v3` | stale, undeletable, ignore |
| Dynatrace | Workflow `7c35a230-d8bf-4379-8137-43b8ad000f3d` | v3, tenant-wide, per-event fan-out |
| Dynatrace | Workflow `68577e86-3a50-4dc6-ad94-750d4d6d4990` | v1, trigger disabled, preserved for rollback |
| ServiceNow | App scope `x_1906732_dtaiops` | "Dynatrace AIOps Event Pipeline" v0.0.1 |
| ServiceNow | 4 `em_match_rule` records, order band 8000-8099 | host 8010, service 8020, process 8030, catch-all 8090 |

## 4. Where the build stopped

Tasks 1 through 9 are complete and reviewed. Task 9b was added mid-run and has
not been implemented.

**Measured result at stop:** bindable bind rate 8/15 = 53%, against a measured
baseline of 0/100. `service` binds at 8/12. Rule scoping is confirmed working -
each event now matches its own strategy's rule.

### Immediate next steps, in order

1. **Fix `scripts/bind-rate-report.sh` - it measures the wrong table.** It reads
   `em_event.cmdb_ci`. Binding lands on `em_alert.cmdb_ci`. The script must join
   event to alert and measure the alert's value. Every bind-rate number in the
   task reports predates this discovery and understates reality.

2. **Task 9b - backfill CMDB CIs.** Smaller than originally scoped. Already
   verified present with exact name matches: `host` 3/3, `service` 8/8. Needs
   backfill: `process` (1 of 5 sampled exist), all `k8s_*` classes, `frontend`.
   Generate names from live Dynatrace topology so they match byte-for-byte what
   the rules search for. Mark with `discovery_source = SIM-Dynatrace-Test` and
   ship a teardown script.

3. **Tasks 10 through 14** as written in the plan: alert correlation by Davis
   problem id, incident promotion from the root-cause alert only, close-path
   verification, operator telemetry actions, Now Assist skill.

### Open questions carried forward

- Does ServiceNow fall through to the catch-all rule (order 8090) when a scoped
  rule matches on `filter` but fails identification? Determines whether
  host/service/process get a second binding attempt. The backfill will answer it.
- The frequent-event filter is correct by inspection but has never been observed
  removing a row, because no frequent events appeared in any sampled window.

## 5. Deferred minor findings

Collected across task reviews, none blocking. See the ledger for the full list -
search for `minor (deferred)`. The final whole-branch review should triage them.
