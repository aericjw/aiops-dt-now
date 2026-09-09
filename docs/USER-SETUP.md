# User setup steps

These require your action. Claude cannot and should not do them.

## 1. Dynatrace API token

Create a token at Settings > Access Tokens with **only** these scopes:

- `storage:logs:read`
- `storage:metrics:read`
- `storage:events:read`

Do not grant write scopes. This integration only reads.

## 2. ServiceNow credential record

Store the token as a credential on `dev285073`. Do not paste it into any file in
this repository.

## 3. Connection alias

Point a connection alias at `https://bwm98081.apps.dynatrace.com/` using the
credential from step 2. The alias name must be exactly:

```
Dynatrace DQL Read-Only
```

This must match the `CONNECTION_ALIAS_NAME` constant referenced in
`servicenow/src/fluent/flows/dynatrace-fetch-logs-subflow.now.ts` and
`servicenow/src/fluent/flows/dynatrace-fetch-metrics-subflow.now.ts`.

Once this alias exists, the two credential-dependent operator actions ("Fetch
Dynatrace logs" and "Fetch Dynatrace metrics") can run. They are already
deployed as `em_alert_man_m2m_rule_flow` records but cannot execute
successfully until this step is done -- see `.superpowers/sdd/2026-09-05-dynatrace-servicenow-aiops/task-13-report.md`
for what has and hasn't been verified.

## 4. Confirm the event rule order band

Rules deploy into order band 8000-8099. Confirm nothing you depend on occupies it.

## 5. Publish the Now Assist skill (Task 14)

Skill publication is a licensed, UI-gated flow. The skill logic is delivered as
source (`servicenow/src/fluent/alert-actions/dynatrace-now-assist-skill.now.ts`,
an `AiAgent` named "Dynatrace Alert Telemetry Skill" with three tools: look up
a Dynatrace-sourced alert, fetch its logs, fetch its metrics); you publish it.

**Before you can do this, confirm AI Agent Studio is actually installed on
dev285073.** During this task, `sn_aia_agent` and the other `sn_aia_*` tables
(`sn_aia_tool`, `sn_aia_version`, `sn_aia_agent_tool_m2m`,
`sys_agent_access_role_configuration`) did not exist on this instance -- a
`sys_db_object` query for each returned no rows, and no plugin named "AI Agent
Studio", "Agentic", "Orchestrat", or "AIA" appears anywhere in `sys_plugins`
(only "Now Assist Core" and "Mobile Now Assist Search" are active). `npx
@servicenow/sdk build` and `npx @servicenow/sdk deploy --auth pdi` both
reported success, and the skill's supporting `sys_security_acl` and
`sys_security_acl_role` records (scoped to the `itil` role) are confirmed
live -- but the core `sn_aia_agent` record itself could not be confirmed to
exist afterward (`sn_aia_agent` query: "Invalid table sn_aia_agent"). If AI
Agent Studio isn't entitled/installed on this instance, activate it first
(System Applications > All Available Applications, or your ServiceNow
account team, for the Now Assist / AI Agent Studio entitlement), then
re-run `npx @servicenow/sdk deploy --auth pdi` from `servicenow/` so the
agent record actually lands before continuing.

Once the agent record exists, publish it: **All menu > AI Agent Studio >
Agents > "Dynatrace Alert Telemetry Skill" > open version V1 > Publish.**

Until published, the Task 13 actions ("Open problem in Dynatrace", the fetch-
logs and fetch-metrics alert actions) remain available directly from the
alert form / Service Operations Workspace exactly as before -- publishing
this skill only adds a natural-language entry point on top of them, it does
not replace them.

## Known issues and current-state inventory (final whole-branch review, 2026-09-08)

All 14 plan tasks, Task 9b, and two follow-up fix rounds are complete. This
section is the authoritative "what's actually true right now" reference --
if anything elsewhere in this repo's docs contradicts it, this section wins
(it was written last, specifically to correct stale claims found in an
earlier draft of `docs/execution/RESUME.md`).

### Resolved, no action needed

- **v1 Dynatrace workflow**: `68577e86-3a50-4dc6-ad94-750d4d6d4990` still
  exists on tacocorp. Its trigger was disabled (not the workflow deleted),
  deliberately preserved as a rollback path. Leave it alone; the live
  pipeline runs on v3 (`7c35a230-d8bf-4379-8137-43b8ad000f3d`).
- **k8s cluster scope**: the plan's open question ("widen the k8s-cluster
  filter?") is resolved -- `dynatrace/dql/extract_events.dql` has no
  `k8s.cluster.name` filter; the decision made was tenant-wide, not narrowed
  to a single cluster. This is final, not a pending decision.
- **Five Dynatrace lookup tables**: `dt_to_snow_cmdb_mapping`, `_v2`, `_v3`,
  `_v4`, `_v5` all exist on tacocorp. Only **`_v5`** is authoritative -- it's
  the one `extract_events.dql`, `lookup-coverage.dql`, and the deployed
  workflow actually load. The other four are undeletable leftovers (the auth
  token lacks `storage:files:delete`) and can be ignored.

## Keeping the lookup table current (this is an ongoing process, not one-time)

`mapping/dt_to_snow_cmdb_mapping.csv` covers three separate entity-type
vocabularies, ground-truthed from three sources:

1. **Classic Smartscape** (`ground-truth/dt-entity-keys.csv`, 533 keys) --
   Dynatrace's original, closed entity-type API.
2. **Built-in Smartscape-on-Grail** (`ground-truth/dt-smartscape-types.csv`,
   23 keys) -- Dynatrace's own native Grail topology node types (k8s_pod,
   host, process, etc.), discovered mid-build as a *separate* vocabulary
   from classic (see the T4-F-GRAIL ruling in the execution ledger).
3. **Extension-defined entity types** (`ground-truth/dt-extension-entity-types.csv`,
   73 keys as of 2026-09-09) -- entity types created by installed Extensions
   2.0 packages via OpenPipeline `smartscapeNodeExtraction`/
   `smartscapeEdgeExtraction` processors. **This one is open-ended, unlike
   the first two** -- a new extension, or a new version of an existing one,
   can define a type this table has never seen. It cannot be ground-truthed
   once and forgotten.

**When to re-run this process**: whenever a new extension is installed on
the tenant, or periodically as a health check (e.g. quarterly).

1. `python3 scripts/sweep-extension-entity-types.py` -- queries every
   installed extension (`dtctl get extensions`) and pulls each one's
   `smartscapeNode` definitions (`dtctl describe extension <name> --assets
   smartscape`), writing results to `/tmp/extension-node-types-raw.tsv`.
2. Diff the node types found against `ground-truth/dt-extension-entity-types.csv`'s
   existing `smartscape_type` column (case-insensitively against
   `dt_entity_key` in all three ground-truth files, since a type can already
   be covered by classic or built-in Grail under a different literal string
   -- see the merge logic used when this file was first built).
3. For each genuinely new type, add a row to
   `ground-truth/dt-extension-entity-types.csv` and a matching row to
   `mapping/dt_to_snow_cmdb_mapping.csv`. Pick `now_ci_class` by checking
   `ground-truth/snow-ci-classes.csv` for a real match (never invent a class
   name); fall back to `cmdb_ci_appl` or generic `cmdb_ci` per spec section
   7.2's tier-3 rule when nothing specific exists. `bind_strategy` should be
   `ire_correlated` unless the new type has a deterministic, SGC-verified
   name-composition rule the way host/service/process do (unlikely for a
   third-party extension's custom entities).
4. `python3 scripts/validate_mapping.py mapping/dt_to_snow_cmdb_mapping.csv`
   must pass (exit 0) before publishing.
5. `bash scripts/upload-lookup.sh` (creates the next version, e.g. `_v6`) --
   then update `dynatrace/dql/extract_events.dql`, `dynatrace/dql/checks/lookup-coverage.dql`,
   AND the script's own default path, all in the same change (they drifted
   apart once already, see the I2 finding below), and `dtctl apply` the
   workflow YAML so the live deployed workflow actually picks up the new
   path (a `dtctl apply` also re-syncs the workflow's `title` field from
   this repo's YAML -- if the title was ever renamed live in the Dynatrace
   UI, sync that rename into the YAML *before* running apply, or the apply
   will silently revert it, which happened once during this exact process).
6. Re-run `dynatrace/dql/checks/lookup-coverage.dql` against live traffic to
   confirm zero coverage gaps.
- **~48 synthetic CMDB CI records**: Task 9b backfilled these on the
  ServiceNow PDI, tagged `discovery_source=SIM-Dynatrace-Test`. They are
  confirmed non-deletable and non-renamable via any write path available in
  this environment (a Fluent-managed CMDB write, once created, is silently
  protected from further mutation by this platform -- a confirmed platform
  limitation, not a bug in this project's code). `scripts/neutralize_cmdb_backfill.py`
  exists to attempt a rename-based "soft retirement" if this protection is
  ever lifted; as of this review it correctly detects when the rename
  didn't land and reverts its own source-code changes rather than leaving
  the repo in a mutated-but-not-applied state (see the I6 fix below).
- **`em_alert.kb_url`**: repurposed to carry a Dynatrace problem URL rather
  than its OOB "KB article" meaning. The original mechanism (a field
  mapping in the ingestion workflow) was dead code -- it wrote to
  `em_event.kb_url`, a column that does not exist on `em_event` at all, so
  it silently no-opped. That part is fixed and confirmed removed live.
  **The replacement is still broken, and the exact bug is known**: the new
  `sys_script` Business Rule (`servicenow/src/fluent/alert-actions/dynatrace-telemetry.now.ts`,
  `dt-rule-populate-kb-url`) sets `condition: 'source=Dynatrace'`, but
  `sys_script.condition` is a JavaScript boolean *expression* field
  (`internal_type: condition_string`), not the encoded-query field --
  `source=Dynatrace` throws a `ReferenceError` on the undefined identifier
  `Dynatrace` every time it's evaluated, so the rule never runs, on every
  `em_alert` insert instance-wide. **One-line fix, not yet applied**: change
  `condition: 'source=Dynatrace'` to `filter_condition: 'source=Dynatrace^EQ'`
  (the actual encoded-query field, matching every other rule on this
  instance's own convention -- verified against `sys_dictionary` and 0/N
  instance-wide precedent for encoded syntax in `condition`). Until this is
  applied, "Open problem in Dynatrace" continues to show the OOB default
  empty KB article link.

### Open / accepted, not fixed

- **`extract_events.dql` close-path race condition** (spec section 16): the
  DAVIS_PROBLEM close trigger can fire before the raw event snapshot the
  DQL reads has caught up in Grail -- observed gap ~60 seconds in one
  sampled case, which is enough to make a close event evaluate as the
  alert's *open* severity rather than 0 (Clear) for that one problem. This
  can cause a missed/incorrect severity-0 close on some closes. Documented,
  not fixed -- a wider window or a short delay before `extract_events` runs
  would likely close the gap, but that's untested. Accepted for a future
  iteration.
- **Metric selection in the fetch-metrics action is a representative
  default, not exhaustive**: fixed this review (I5) to select a metric per
  `dt_entity_key` (process, service, k8s_pod, k8s_node, frontend each have a
  dedicated metric; everything else falls back to `dt.host.cpu.usage`, the
  original default) instead of always querying `dt.host.cpu.usage`
  regardless of what the alert is actually about. Each metric name was
  checked with `dtctl verify query` (syntactically valid) and, where the
  entity class has any live data on this tenant, with a real `dtctl query`
  execution returning records. Exception: **this tenant has no RUM data at
  all** -- the `frontend` metric (`dt.rum.frontend.action.count`) is
  syntactically valid but returns zero records here, so a `frontend`-class
  alert's "fetch metrics" action will return empty results until this
  instance has actual RUM-instrumented traffic, through no fault of the
  query. If you add a new entity class this pipeline alerts on, extend the
  `byEntityKey` mapping in
  `servicenow/src/fluent/flows/dynatrace-fetch-metrics-subflow.now.ts`
  rather than assuming the fallback is good enough.
  **Residual, not yet fixed**: the `service` class's metric
  (`dt.service.request.count`) is filtered on `dt.smartscape_source.id`,
  a dimension that metric doesn't carry -- confirmed live, a real service
  entity id returns zero records. Since `service` is this pipeline's
  dominant alert class, the fetch-metrics action currently returns empty
  for most alerts it'll actually be invoked on. Fix: use the
  `dt.entity.service` dimension instead for the `service` case;
  `k8s_pod`'s metric likely has the same kind of dimension mismatch
  (`CONTAINER-*` vs. the `CLOUD_APPLICATION_INSTANCE-*` entity pods are
  actually exposed as) and should be checked the same way before relying
  on it.
- **RESOLVED: correlation was structurally never invoked for any alert this
  pipeline creates -- now fixed, and V6/V7 are confirmed passing live.**
  (spec section 16, V6/V7). Root cause, identified and confirmed by reading
  the live OOB business rule: ServiceNow's own "Calculate correlation rule"
  (`sys_script` on `em_alert`) only calls
  `alertManager.calculateAlertCorrelation(current)` for an Open/Reopen alert
  when `!alertManager.isThreadProcessingEvents()` is true. Every alert this
  pipeline creates is created BY the Event Management event-processing
  thread converting `em_event` -> `em_alert` -- exactly the thread this
  guard excludes. So correlation was never invoked for this alert-creation
  path, independent of the correlation script's own correctness (which had
  two real, separately-fixed bugs of its own along the way -- a broken
  regex escape and a solo-alert gating gap, both unit-tested in
  `tests/test_correlation_grouping.js`).

  **Fix**: `servicenow/src/fluent/correlation/dynatrace-correlation-sweep-job.now.ts`,
  a scheduled job (`sysauto_script`, runs every minute) that re-invokes
  `calculateAlertCorrelation()` directly for any still-groupable Dynatrace
  alert, from the job's own thread -- never the guarded one. This bypasses
  the OOB rule's guard entirely rather than needing ServiceNow to change
  anything.

  A second, unrelated bug was found and fixed alongside this: Task 11's
  incident-promotion rule was live-confirmed `active: false` ("No active
  actions") -- a completely separate OOB business rule force-deactivates
  any `em_alert_management_rule` with no active child action record,
  regardless of `type`/`incident_template`. Fixed in the same file by
  attaching an `em_alert_man_m2m_rule_flow` action pointing at the same OOB
  "Create Incident" subflow the one other working `type: 'incident'` rule
  on this instance ("Create Incident Manually") already uses.

  **Confirmed live, end to end, after both fixes**: `em_agg_group` now
  creates real groups (13 the first day, the first on this whole PDI since
  2026-06-24), and three real incidents were created from them --
  `INC0010001`, `INC0010002`, `INC0010003`, each with a populated `cmdb_ci`
  and its Davis problem ID in the short description. This is V6/V7 passing
  on live traffic, not by inspection.

  One caveat: alerts that reached `correlation_rule_group=1` *before* the
  incident-rule fix deployed won't retroactively create an incident (the
  rule's `automatic_execution_setting` is edge-triggered on the transition
  into the filter, and that transition already happened for them). This
  only affects a handful of alerts from the fix's first hour; every
  problem going forward flows through cleanly.
