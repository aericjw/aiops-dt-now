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
- **Four Dynatrace lookup tables**: `dt_to_snow_cmdb_mapping`, `_v2`, `_v3`,
  `_v4` all exist on tacocorp. Only **`_v4`** is authoritative -- it's the
  one `extract_events.dql` and `lookup-coverage.dql` actually load. The
  other three are undeletable leftovers (the auth token lacks
  `storage:files:delete`) and can be ignored. If you publish a new mapping
  version, update BOTH `scripts/upload-lookup.sh`'s default path AND
  `extract_events.dql`'s load path together in the same change -- these two
  drifted apart once already (fixed in this review) and must not again.
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
  it silently no-opped. Fixed: a `sys_script` Business Rule on `em_alert`
  (before insert, `source=Dynatrace`, see
  `servicenow/src/fluent/alert-actions/dynatrace-telemetry.now.ts`,
  `dt-rule-populate-kb-url`) now parses `dt_problem_url` out of the alert's
  own `additional_info` and sets `kb_url` directly at insert time. Deployed
  and confirmed live (the business rule exists with the right
  collection/when/condition, and its regex is correctly escaped) -- but no
  new Dynatrace alert arrived in the ~20 minutes after this fix was
  deployed to observe a freshly-created record's `kb_url` value live. The
  regex logic itself was independently run against a real captured
  `additional_info` payload and correctly extracted the URL, so this is
  fixed-by-inspection-and-unit-check but not yet live-observed on a brand
  new alert -- worth a spot-check next time a Dynatrace problem fires.

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
- **Whether the correlation rule's fixes actually flip `correlation_rule_group`
  live is unconfirmed** (spec section 16, V6/V7): this review fixed two real
  bugs in the correlation script (a broken regex escape that meant grouping
  never worked at all, and a gating bug that would have caused duplicate
  incidents once the regex was fixed) and unit-tested the fixed logic
  against a real captured payload (`tests/test_correlation_grouping.js`).
  But live-observing this instance after the fix, a solo root-cause Davis
  problem's alert -- exactly the case now expected to self-promote to
  PRIMARY -- stayed at `correlation_rule_group=0` at least 15 minutes after
  creation, and `em_agg_group` shows **zero groups created for ANY alert
  source since 2026-06-24** on this whole PDI, not just Dynatrace. This
  suggests either a longer async processing delay than observed, or a
  platform/entitlement gap in whether "advanced" (script-based)
  `em_alert_correlation_rule` records are invoked at all here, independent
  of the script's own correctness -- `evt_mgmt.enable_alert_correlation` is
  `true` and the relevant plugins are active, so it isn't an obviously
  disabled feature. Treat V6/V7 as "script-level fix complete and
  unit-verified; engine-level live effect not confirmed," not as a clean
  PASS, until someone with platform-log access (a `syslog` query for
  correlation-engine activity hit this session's 30-second API timeout) or
  a ServiceNow support case resolves the open question.
