# Task 5 Report: Upload the mapping table to Dynatrace Grail

## Summary

Uploaded the 553-row `dt_to_snow_cmdb_mapping.csv` to Grail. Two blockers were hit
and resolved along the way; both are recorded in full below because they changed
the shape of the deliverable (new path, no delete-then-create).

**Note on the brief:** the brief text says 534 rows; per the dispatch instructions
this is stale. The correct, verified count is 553 (533 classic entity types + 19
Grail/Smartscape types + `__unknown__`). The mapping file was not altered to match
the stale number.

## Correction from the original brief

The brief's `scripts/upload-lookup.sh` does delete-then-create against the same
path (`/lookups/dt_to_snow_cmdb_mapping`). That approach failed (see Block 1) and
was replaced, by controller ruling, with create-at-a-new-path
(`/lookups/dt_to_snow_cmdb_mapping_v2`), with no delete at all. The old table is
kept in place as a rollback artifact.

## Timeline

### Attempt 1: brief's script as written (delete-then-create) — BLOCKED

Ran `./scripts/upload-lookup.sh` as specified in the brief:

```
==> context: tacocorp
==> validating mapping/dt_to_snow_cmdb_mapping.csv
PASS: 553 rows valid, 553 keys covered, all classes exist
==> deleting existing /lookups/dt_to_snow_cmdb_mapping (ignored if absent)
{"ok":false,"result":null,"error":{"code":"insufficient_scope","message":"missing 1 required scope(s) for \"delete lookup\": storage:files:delete", ...
"granted_scopes":[...,"storage:files:write",...],
"missing_scopes":["storage:files:delete"], ...}}
==> creating /lookups/dt_to_snow_cmdb_mapping
{"ok":false,"result":null,"error":{"code":"error","message":"failed to create lookup table: lookup table \"/lookups/dt_to_snow_cmdb_mapping\" already exists. Use 'dtctl apply' to update or add --overwrite flag"}}
```

Diagnosis: the `tacocorp-oauth` token has `storage:files:write` but not
`storage:files:delete`. The CLI-configured safety level (`readwrite-all`) is a
separate, CLI-side guard and does not imply the OAuth token actually carries the
scope. Verified with `dtctl delete lookup --check-scopes`.

No destructive action occurred — the old 22-record table was never touched. I did
not attempt the two workarounds the API error suggested (`--overwrite` flag,
`dtctl apply`) without sign-off, because the brief mandates the validate-then-
delete-then-create ordering explicitly. I escalated and stopped.

### Controller ruling

The controller independently verified:
- `storage:files:write` is granted, `storage:files:delete` is not.
- `--overwrite` does not exist in dtctl 0.14.4 (`Error: unknown flag --overwrite`).
- `dtctl apply` does not support lookups as a resource type.

Ruling: do not delete anything; create the table at a new path,
`/lookups/dt_to_snow_cmdb_mapping_v2`, which only requires `storage:files:write`.
This avoids any window where the lookup does not exist, and preserves the old
table as a rollback artifact until the new one is proven.

`scripts/upload-lookup.sh` was rewritten accordingly:
- `LOOKUP_PATH` is now a parameter with default `/lookups/dt_to_snow_cmdb_mapping_v2`.
- The `dtctl delete lookup ... || true` line was removed entirely, replaced with a
  comment explaining why (missing `storage:files:delete` scope).
- Validate-first ordering preserved: `validate_mapping.py` still runs before any
  write, and a validation failure still aborts before creation.
- `--display-name`, `--description`, `--skip-records 1`, `--plain` kept as
  specified. No em dashes in display name or description.

Dry run against the new path succeeded:

```
Dry run: would create lookup table
Path: /lookups/dt_to_snow_cmdb_mapping_v2
Lookup Field: dt_entity_key
Parse Pattern: (auto-detect from CSV)
File Size: 37158 bytes
```

### Attempt 2: create at new path — BLOCKED by local classifier

Running the write (both via the script and via the raw `dtctl create lookup`
command) was denied by the Claude Code auto-mode classifier before it ever
reached `dtctl`/the tenant:

```
Permission for this action was denied by the Claude Code auto mode classifier.
Reason: Blocked by classifier.
```

This is a local guardrail, independent of the Dynatrace OAuth scope issue in
Attempt 1. I did not try alternate phrasings or tool paths to route around it,
per instructions not to work around a denial in ways that bypass its intent. I
stopped and reported back, asking for a permission grant or manual execution.

### Permission grant and successful upload

The user added Bash permission rules to `.claude/settings.local.json` allowing
`dtctl create lookup` and `bash scripts/upload-lookup.sh`. The controller
confirmed the grant took effect by running the script from the controller
session:

```
==> context: tacocorp
==> validating mapping/dt_to_snow_cmdb_mapping.csv
PASS: 553 rows valid, 553 keys covered, all classes exist
==> creating /lookups/dt_to_snow_cmdb_mapping_v2
OK Lookup table "/lookups/dt_to_snow_cmdb_mapping_v2" created
  Records: 553
  File Size: 47743 bytes
```

I then independently re-ran both verification queries myself (not taking the
controller's word for it) against the newly created table.

## Verification 1: brief's step 4 query (join against live Davis events)

Query (pointed at `/lookups/dt_to_snow_cmdb_mapping_v2`):

```
fetch dt.davis.events, from:-24h
| fieldsAdd raw = coalesce(smartscape.affected_entity.types, affected_entity_types)
| expand raw
| fieldsAdd dt_entity_key = if(isNull(raw), "__unknown__", else: lower(if(startsWith(raw, "dt.entity."), substring(raw, from: 10), else: raw)))
| lookup [load "/lookups/dt_to_snow_cmdb_mapping_v2"], sourceField: dt_entity_key, lookupField: dt_entity_key, fields: {now_ci_class, bind_strategy, sgc_managed}
| summarize events = count(), by: {dt_entity_key, now_ci_class, bind_strategy}
| sort events desc | limit 20
```

Result (15 rows returned, all with non-null `now_ci_class`):

| dt_entity_key | now_ci_class | bind_strategy | events |
|---|---|---|---|
| process | cmdb_ci_appl | sgc_process | 14053 |
| k8s_pod | cmdb_ci_kubernetes_pod | ire_correlated | 2657 |
| __unknown__ | cmdb_ci | ire_correlated | 293 |
| service | cmdb_ci_service_calculated | sgc_service | 198 |
| k8s_namespace | cmdb_ci_kubernetes_namespace | ire_correlated | 147 |
| k8s_deployment | cmdb_ci_kubernetes_deployment | ire_correlated | 139 |
| environment | cmdb_ci_environment | ire_correlated | 114 |
| k8s_node | cmdb_ci_kubernetes_node | ire_correlated | 73 |
| host | cmdb_ci_computer | sgc_host | 23 |
| k8s_cluster | cmdb_ci_kubernetes_cluster | ire_correlated | 22 |
| k8s_daemonset | cmdb_ci_kubernetes_daemonset | ire_correlated | 22 |
| application | cmdb_ci_web_application | ire_correlated | 14 |
| k8s_statefulset | cmdb_ci_kubernetes_statefulset | ire_correlated | 7 |
| frontend | cmdb_ci_web_application | ire_correlated | 2 |
| browser_monitor | cmdb_ci | ire_correlated | 1 |

**Zero rows with a null `now_ci_class`.**

## Verification 2: high-volume regression query (from original dispatch)

Query (pointed at `/lookups/dt_to_snow_cmdb_mapping_v2`, `sgc_managed` included):

```
fetch dt.davis.events, from:-24h
| fieldsAdd raw = coalesce(smartscape.affected_entity.types, affected_entity_types)
| expand raw
| fieldsAdd dt_entity_key = if(isNull(raw), "__unknown__", else: lower(if(startsWith(raw, "dt.entity."), substring(raw, from: 10), else: raw)))
| lookup [load "/lookups/dt_to_snow_cmdb_mapping_v2"], sourceField: dt_entity_key, lookupField: dt_entity_key, fields: {now_ci_class, bind_strategy, sgc_managed}
| summarize events = count(), by: {dt_entity_key, now_ci_class, bind_strategy, sgc_managed}
| sort events desc | limit 25
```

Result (15 rows, all non-null):

| dt_entity_key | now_ci_class | bind_strategy | sgc_managed | events |
|---|---|---|---|---|
| process | cmdb_ci_appl | sgc_process | true | 14051 |
| k8s_pod | cmdb_ci_kubernetes_pod | ire_correlated | false | 2657 |
| __unknown__ | cmdb_ci | ire_correlated | false | 293 |
| service | cmdb_ci_service_calculated | sgc_service | true | 198 |
| k8s_namespace | cmdb_ci_kubernetes_namespace | ire_correlated | false | 147 |
| k8s_deployment | cmdb_ci_kubernetes_deployment | ire_correlated | false | 139 |
| environment | cmdb_ci_environment | ire_correlated | false | 114 |
| k8s_node | cmdb_ci_kubernetes_node | ire_correlated | false | 73 |
| host | cmdb_ci_computer | sgc_host | true | 23 |
| k8s_cluster | cmdb_ci_kubernetes_cluster | ire_correlated | false | 22 |
| k8s_daemonset | cmdb_ci_kubernetes_daemonset | ire_correlated | false | 22 |
| application | cmdb_ci_web_application | ire_correlated | false | 14 |
| k8s_statefulset | cmdb_ci_kubernetes_statefulset | ire_correlated | false | 7 |
| frontend | cmdb_ci_web_application | ire_correlated | false | 2 |
| browser_monitor | cmdb_ci | ire_correlated | false | 1 |

Confirms the specific Task 4 regression check:
- `process` -> `cmdb_ci_appl` / `sgc_process` / `true` — matches expected.
- `host` -> `cmdb_ci_computer` / `sgc_host` / `true` — matches expected.
- `service` -> `cmdb_ci_service_calculated` / `sgc_service` / `true` — matches expected.
- All `k8s_*` keys -> their exact `cmdb_ci_kubernetes_*` classes — matches expected.

**Zero rows with a null `now_ci_class` in either query.**

## `dtctl get lookups` — both tables present

```
/lookups/dt_to_snow_cmdb_mapping        displayName: "Dynatrace to ServiceNow CMDB Mapping"  fileSize: 1445   records: 22   modified: 1d ago
/lookups/dt_to_snow_cmdb_mapping_v2     displayName: "Dynatrace to ServiceNow CMDB Mapping"  description: "Canonical entity key to CMDB CI class and CI binding strategy"  fileSize: 47743  records: 553  modified: just now
```

(other unrelated lookups in the tenant omitted from this excerpt — full JSON output
was captured during the session)

Old table `/lookups/dt_to_snow_cmdb_mapping`: **untouched, still 22 records.**
New table `/lookups/dt_to_snow_cmdb_mapping_v2`: **553 records, matches source CSV.**

## Files changed

- `scripts/upload-lookup.sh` (new file) — final version:
  - Creates at `/lookups/dt_to_snow_cmdb_mapping_v2` by default (path 2 overridable).
  - No delete call. Comment explains the missing `storage:files:delete` scope.
  - Validates via `scripts/validate_mapping.py` before any write; abort on failure.
  - `--display-name "Dynatrace to ServiceNow CMDB Mapping"`,
    `--description "Canonical entity key to CMDB CI class and CI binding strategy"` —
    no em dashes.
  - `--skip-records 1`, `--plain` kept.

## Self-review

- Ordering preserved exactly as required: validate before any tenant write.
- No destructive action taken anywhere in this task; old table is fully intact.
- Did not use `--overwrite` or `dtctl apply` workarounds hinted at by the API
  error — those are dead ends per controller's own verification, and would have
  deviated from the mandated contract without sign-off regardless.
- Did not attempt to route around either the OAuth scope denial or the local
  classifier denial by trying different tool invocations — escalated both times.
- Independently re-ran both verification queries myself against the live table
  rather than trusting the controller's report of them.
- Row count matches source file exactly (553 data rows in CSV, 553 records in
  the tenant's lookup table).

## Concerns

1. **Naming deviates from the brief and from Task 6's stated interface.** The
   brief and Task 6 expect the lookup at `/lookups/dt_to_snow_cmdb_mapping`. Task
   6's DQL (and the production workflow) will need to be pointed at
   `/lookups/dt_to_snow_cmdb_mapping_v2` instead, or the `_v2` table needs to be
   promoted/renamed once the delete scope is available. This is a follow-up
   dependency for whoever picks up Task 6.
2. **The token used for this tenant lacks `storage:files:delete`.** If a future
   task needs to remove the old 22-record table or otherwise delete Grail
   documents, the token will need re-issuing with that scope. Flagging this now
   so it doesn't surprise a later task.
3. The old `/lookups/dt_to_snow_cmdb_mapping` table (22 records) remains live and
   joinable. Any existing workflow still pointed at it will keep getting the
   stale, hand-made mapping until it's repointed or the table is retired.

## Report file

`/Users/aeric/Projects/aiops-dt-now/.superpowers/sdd/2026-09-05-dynatrace-servicenow-aiops/task-5-report.md`

---

## Fix round 1 (post-review)

### Finding addressed

Review Finding 1 (Important): line 30 of the original script echoed
`dtctl config current-context --plain` but never checked the value against the
mandated context (`tacocorp`). This came verbatim from the brief's script text —
a plan defect, not something introduced during implementation — but for a script
whose purpose is a live write, asserting the target environment is a real safety
property: a misconfigured or switched context would have silently published the
mapping into the wrong Dynatrace tenant.

### Fix

`scripts/upload-lookup.sh` now captures the context into a variable and asserts
it against `EXPECTED_CONTEXT` (env-overridable, default `tacocorp`) before the
validator runs and before any create call:

```bash
EXPECTED_CONTEXT="${EXPECTED_CONTEXT:-tacocorp}"

CONTEXT="$(dtctl config current-context --plain)"
echo "==> context: $CONTEXT"
if [ "$CONTEXT" != "$EXPECTED_CONTEXT" ]; then
  echo "ERROR: context is '$CONTEXT', expected '$EXPECTED_CONTEXT'" >&2
  exit 1
fi
```

Deferred per instruction, not touched: the post-create verification query's JSON
response is still unparsed/unvalidated.

### Guard-fires demonstration

Command:
```
EXPECTED_CONTEXT=not-a-real-context bash scripts/upload-lookup.sh
```

Output:
```
==> context: tacocorp
ERROR: context is 'tacocorp', expected 'not-a-real-context'
exit code: 1
```

Confirmed: the script exited non-zero immediately after the context check,
before reaching `python3 scripts/validate_mapping.py` or `dtctl create lookup`.

### Guard-passes demonstration

Command:
```
bash scripts/upload-lookup.sh
```

Output:
```
==> context: tacocorp
==> validating mapping/dt_to_snow_cmdb_mapping.csv
PASS: 553 rows valid, 553 keys covered, all classes exist
==> creating /lookups/dt_to_snow_cmdb_mapping_v2
{"ok":false,"result":null,"error":{"code":"error","message":"failed to create lookup table: lookup table \"/lookups/dt_to_snow_cmdb_mapping_v2\" already exists. Use 'dtctl apply' to update or add --overwrite flag"}}
exit code: 1
```

The context check passed (default `tacocorp` matched) and did not block
execution; the script proceeded through validation and reached the create call,
which failed only because the table already exists from the successful upload
run earlier in this task — expected and fine. No re-upload was attempted, and
none occurred; the live table at `/lookups/dt_to_snow_cmdb_mapping_v2` (553
records) is unchanged.

### Diff scope

`git diff --stat` confirmed only `scripts/upload-lookup.sh` changed (8 insertions,
1 deletion).

### Commit

`c1d4ed4` — fix: verify Dynatrace context before writing, not just echo it
