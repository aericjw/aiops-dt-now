import { AiAgent } from '@servicenow/sdk/core'
import '../flows/dynatrace-fetch-logs-subflow.now'
import '../flows/dynatrace-fetch-metrics-subflow.now'

// Task 14: Now Assist / Otto AI skill wrapping Task 13's three deterministic
// operator telemetry actions, so an operator can ask in natural language
// ("show me the logs for this alert") instead of clicking the corresponding
// em_alert form button. Per the brief, this file is delivered as source only
// -- activation/publication of the resulting skill in AI Agent Studio is the
// user's step (docs/USER-SETUP.md step 5) and is not attempted here.
//
// Tool mapping to the three Task 13 actions (../alert-actions/dynatrace-telemetry.now.ts):
//   1. "Open problem in Dynatrace" (em_launch_application) has no AiAgent
//      tool `type` that wraps an em_launch_application record directly --
//      the reference-based tool types are only action/capability/subflow/
//      catalog/topic/topic_block (building-ai-agents-tools-guide.md,
//      "Reference-Based Tools"), none of which target em_launch_application.
//      That action is just a URL template (`${kb_url}`) against a single
//      em_alert column, so it is wrapped here as a `crud` `lookup` tool that
//      returns the same `kb_url` field Task 13 already populates from
//      dt_problem_url -- the agent reports that URL back to the operator
//      instead of clicking the button. Verified `kb_url` (internal_type
//      `url`) live via sys_dictionary against em_alert on tacocorp+pdi.
//   2 & 3. The two em_alert_man_m2m_rule_flow actions both point at
//      Subflows (../flows/dynatrace-fetch-logs-subflow.now.ts and
//      ../flows/dynatrace-fetch-metrics-subflow.now.ts), which is exactly
//      the `subflow` reference-based tool type
//      (`subflowId` -> sys_hub_flow). Per the tools guide, reference-based
//      tools take no `inputs` -- the platform resolves the subflow's
//      mandatory `alertGR` input from the record in context at runtime, the
//      same way em_alert_man_m2m_rule_flow invocation already does; this
//      file does not re-implement or re-verify that resolution.
//
// Both subflow tools have a side effect (they write the retrieved logs/
// metrics to the alert's work_notes and consume a live DQL query), so they
// use `executionMode: 'copilot'` (operator confirmation before running)
// rather than `autopilot`. The lookup tool is read-only and uses
// `autopilot`.
//
// Neither fetch tool can be functionally exercised yet -- same credential
// gap as Task 13 (docs/USER-SETUP.md steps 1-3, still outstanding). This
// skill can be built and deployed as a definition without that credential,
// exactly as Task 13's actions 2 and 3 were.
//
// PLUGIN GAP FOUND THIS SESSION (see docs/USER-SETUP.md step 5 for the full
// detail and the required remediation): `npx @servicenow/sdk build` and
// `npx @servicenow/sdk deploy --auth pdi` both succeeded, and this record's
// generated `securityAcl` side records (`sys_security_acl`,
// `sys_security_acl_role`) are confirmed live on tacocorp+pdi -- but
// `sn_aia_agent` and every other `sn_aia_*` table this API targets do not
// exist on dev285073 (no matching `sys_db_object` row, no "AI Agent
// Studio"/"Agentic"/"AIA"-named plugin anywhere in `sys_plugins`; only "Now
// Assist Core" and "Mobile Now Assist Search" are active). The core
// `sn_aia_agent` record for this agent could therefore NOT be confirmed to
// exist after deploy -- AI Agent Studio itself appears to need a separate
// activation/entitlement beyond Now Assist Core before this file's deploy
// output is more than the ACL scaffolding.
export const dtNowAssistSkill = AiAgent({
    $id: Now.ID['dt-now-assist-skill'],
    name: 'Dynatrace Alert Telemetry Skill',
    description:
        'Lets an operator ask in natural language for a Dynatrace-sourced alert\'s problem link, logs, or metrics, instead of clicking the corresponding operator action on the alert form.',
    agentRole: 'Dynatrace alert telemetry assistant',
    recordType: 'custom',
    channel: 'nap',
    processingMessage: 'Working on your Dynatrace alert request...',
    postProcessingMessage: 'Done.',

    securityAcl: {
        $id: Now.ID['dt-now-assist-skill-acl'],
        type: 'Specific role',
        // itil, sys_id verified live against sys_user_role on tacocorp+pdi.
        roles: ['282bf1fac6112285017366cb5f867469'],
    },

    dataAccess: {
        roleMap: ['itil'],
        description: 'Role-based access matching the alert-facing itil role used elsewhere on this instance.',
    },

    versionDetails: [
        {
            name: 'V1',
            number: 1,
            state: 'draft',
            instructions: `You help operators investigate Dynatrace-sourced ServiceNow alerts (em_alert records with source=Dynatrace).

When the operator names or references an alert (by number, e.g. Alert0012240, or by sys_id), first use the "Look Up Dynatrace Alert" tool to resolve it.

- If the operator asks to open, view, or link to the alert's Dynatrace problem, report back the kb_url field from the lookup -- that is the Dynatrace problem URL.
- If the operator asks for logs (e.g. "show me the logs for this alert"), use the "Fetch Dynatrace Logs" tool. It resolves the alert's bound Dynatrace entity automatically and writes the retrieved logs to the alert's work notes -- tell the operator to check the alert's work notes for the result.
- If the operator asks for metrics, performance data, or telemetry (e.g. "what does CPU look like around this alert"), use the "Fetch Dynatrace Metrics" tool the same way, and point the operator to the alert's work notes for the result.

Do not fabricate Dynatrace log or metric content yourself -- only report what these tools actually return.`,
        },
    ],

    tools: [
        {
            name: 'Look Up Dynatrace Alert',
            description: "Looks up a Dynatrace-sourced em_alert record by number or sys_id and returns its Dynatrace problem link and other identifying fields.",
            type: 'crud',
            recordType: 'custom',
            executionMode: 'autopilot',
            preMessage: 'Looking up the alert...',
            postMessage: 'Alert details retrieved.',
            inputs: {
                operationName: 'lookup',
                table: 'em_alert',
                queryCondition: 'number={{alert_number}}^ORsys_id={{alert_number}}',
                inputFields: [
                    {
                        name: 'alert_number',
                        description: 'The em_alert number (e.g. Alert0012240) or sys_id to look up.',
                        mandatory: true,
                    },
                ],
                returnFields: [
                    { name: 'sys_id' },
                    { name: 'number' },
                    { name: 'short_description' },
                    { name: 'kb_url' },
                    { name: 'additional_info' },
                ],
            },
        },
        {
            name: 'Fetch Dynatrace Logs',
            description:
                "Runs a Dynatrace DQL logs query scoped to the alert's bound entity and writes the result to the alert's work notes.",
            type: 'subflow',
            subflowId: Now.ref('sys_hub_flow', 'dt-fetch-logs-subflow'),
            executionMode: 'copilot',
            preMessage: 'Fetching Dynatrace logs for this alert...',
            postMessage: 'Dynatrace logs fetched and added to the alert work notes.',
        },
        {
            name: 'Fetch Dynatrace Metrics',
            description:
                "Runs a Dynatrace DQL timeseries query scoped to the alert's bound entity and writes the result to the alert's work notes.",
            type: 'subflow',
            subflowId: Now.ref('sys_hub_flow', 'dt-fetch-metrics-subflow'),
            executionMode: 'copilot',
            preMessage: 'Fetching Dynatrace metrics for this alert...',
            postMessage: 'Dynatrace metrics fetched and added to the alert work notes.',
        },
    ],
})
