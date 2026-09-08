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
