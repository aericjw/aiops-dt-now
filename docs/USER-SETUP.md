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
source; you publish it.
