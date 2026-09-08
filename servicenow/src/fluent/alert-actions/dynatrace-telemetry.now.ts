import { Record } from '@servicenow/sdk/core'
import '../flows/dynatrace-fetch-logs-subflow.now'
import '../flows/dynatrace-fetch-metrics-subflow.now'

// Task 13: deterministic, non-AI operator actions on a Dynatrace-sourced
// em_alert -- open the problem in Dynatrace, fetch logs for the bound
// entity, fetch related metrics. Built before the AI/Now-Assist layer
// (Task 14), which will wrap these rather than reimplement them.
//
// --- Step 2b finding: can `${field}` substitution reach dt_problem_url? ---
// `em_launch_application.url` substitution (verified example:
// `/$ngbsm.do?&id=${cmdb_ci.sys_id}&mapScriptID=...&level=20`, from a live
// active rule) only resolves plain em_alert columns (dot-walking into a
// *reference* field's own columns, as with cmdb_ci.sys_id -- not into JSON
// keys inside a string field). dt_problem_url and dt_entity_id live inside
// em_alert.additional_info, and worse, additional_info is not even valid
// JSON: it's a Groovy/Java map toString() embedded as a string value inside
// a JSON wrapper (confirmed live, e.g. Alert0012240:
// '{"additional_content" : "{event.id=..., dt_problem_url=https://..., ...}"}').
// `${additional_info}` would substitute that whole blob, not extract one key
// -- unusable for a launch URL.
//
// A `sys_dictionary` query against em_alert (58 columns, see task-13-report.md
// for the full list) turned up no existing column suited to carrying a
// clean URL: the only URL-typed column, `kb_url` ("View Knowledge Article"),
// is not actually empty -- live alerts already carry an OOB computed default
// (`/kb_view.do?sysparm_article=`) rather than nothing, so at first glance
// this looked like neither of the brief's two outcomes cleanly applied.
// Resolution: that default only applies when nothing else sets the field
// explicitly at insert time. The Dynatrace ingestion workflow
// (dynatrace/workflows/dt-problems-to-snow-itom.yaml) already explicitly
// maps a dozen other em_alert columns this same way (message_key, source,
// resource, node, type, ...), so adding one more explicit mapping
// (`kb_url: dt_problem_url`, added in this task) overrides the default on
// every future alert exactly like Outcome A describes ("If the column
// exists but is empty, amend the Dynatrace workflow to populate it").
// This was preferred over adding a brand-new custom column via `Table({
// augments: 'em_alert', ... })` -- a mechanism unused anywhere else in this
// project and with more moving parts (build-time schema validation, an
// unfamiliar Column-type API) for no behavioral benefit over reusing an
// existing, if cosmetically mislabeled, URL column that operators only ever
// see via the named "Open problem in Dynatrace" button, never the raw field
// label. Net effect: Outcome A applies. `em_launch_application` is used for
// action 1, and it is the only one of the three actions verified end-to-end
// this session (see task-13-report.md) -- it needs no Dynatrace credential.
//
// Actions 2 and 3 (fetch logs / fetch metrics) both need the DQL execution
// API, which needs the connection alias + read-only API token that
// docs/USER-SETUP.md reserves for the user to create (spec section 13).
// Per the brief, both are em_alert_man_m2m_rule_flow records regardless of
// the action-1 outcome -- a subflow is where the connection alias is
// usable. See ../flows/dynatrace-fetch-logs-subflow.now.ts and
// ../flows/dynatrace-fetch-metrics-subflow.now.ts for that logic and its
// (also credential-blocked, also unverified-this-session) assumptions.
Record({
    $id: Now.ID['dt-telemetry-rule'],
    table: 'em_alert_management_rule',
    data: {
        name: 'Dynatrace - operator telemetry actions',
        active: true,
        // Order band 8000-8099 also holds Task 9's em_match_rule records --
        // a different table, so no collision risk there. On this rule's own
        // table (em_alert_management_rule), the only other row in the band is
        // Task 11's dt-promote-primary-to-incident at order 8010 (confirmed
        // via a live query of every em_alert_management_rule row on tacocorp
        // -- see task-13-report.md); 8100 does not collide with it or with
        // any other row (all OOB samples sit at order 10-200).
        order: 8100,
        // Checked every row of `em_alert_management_rule.type` on tacocorp+pdi
        // (21 rows, live query): all 21 are 'incident', including the ones
        // whose only child action is an em_launch_application with no
        // incident-creation behavior at all (e.g. "SGO-Dynatrace",
        // "Search Google for description", "Show Trigger in Honeycomb").
        // sys_choice for this element/table combination returned no rows, so
        // there's no OOB choice list to check the meaning against -- 'incident'
        // is used here purely because it's the only value ever observed on
        // this table, not because its label describes what this rule does.
        type: 'incident',
        // "Alert matches filter" (2), not "Alert changes to filter" (1):
        // these are operator-invoked actions offered whenever a Dynatrace
        // alert is open in Service Operations Workspace, not one-time
        // automated transitions like Task 11's incident promotion. Matches
        // the live convention of every other launch-application-style rule
        // on this instance (e.g. "SGO-Dynatrace", "Search Google for
        // description").
        automatic_execution_setting: 2,
        multiple_alert_rules: 1, // "Search for additional rules" -- does not block Task 11's rule from also evaluating the same alert
        // Verified against sys_dictionary that `alert_filter` (internal_type
        // "conditions") is the only filter-like column on this table -- there
        // is no separate "advanced_filter". Encoding confirmed by querying
        // every active em_alert_management_rule's alert_filter live: every
        // rule that scopes by source uses the bare `source=<value>` form with
        // no trailing `^EQ` -- e.g. "SGO-Dynatrace" -> `source=SGO-Dynatrace`,
        // "Open sensor dashboard in PRTG" -> `source=PRTG`, and Task 11's own
        // `dt-promote-primary-to-incident` -> `source=Dynatrace^correlation_
        // rule_group=1^incidentISEMPTY`. `source=Dynatrace` here matches that
        // convention exactly (same field, same literal value Task 11 already
        // used, same no-^EQ encoding) -- copied from a live rule, not
        // hand-composed.
        alert_filter: 'source=Dynatrace',
        description: 'Pull Dynatrace logs and metrics for the alert bound entity, and open the source problem in Dynatrace.',
    },
})

// Action 1: open the Dynatrace problem. Credential-free -- verified
// end-to-end this session (see task-13-report.md).
Record({
    $id: Now.ID['dt-action-open-problem'],
    table: 'em_launch_application',
    data: {
        active: true,
        execution: 1,
        executions_limit: 1,
        management_rule: Now.ref('em_alert_management_rule', 'dt-telemetry-rule'),
        display_name: 'Open problem in Dynatrace',
        url: '${kb_url}',
    },
})

// Action 2: fetch logs for the bound entity. Deployed, not functionally
// verifiable until docs/USER-SETUP.md steps 1-3 are complete.
Record({
    $id: Now.ID['dt-action-fetch-logs'],
    table: 'em_alert_man_m2m_rule_flow',
    data: {
        active: true,
        execution: 2,
        executions_limit: 1,
        management_rule: Now.ref('em_alert_management_rule', 'dt-telemetry-rule'),
        sub_flow: Now.ref('sys_hub_flow', 'dt-fetch-logs-subflow'),
    },
})

// Action 3: fetch related metrics for the bound entity. Deployed, not
// functionally verifiable until docs/USER-SETUP.md steps 1-3 are complete.
Record({
    $id: Now.ID['dt-action-fetch-metrics'],
    table: 'em_alert_man_m2m_rule_flow',
    data: {
        active: true,
        execution: 3,
        executions_limit: 1,
        management_rule: Now.ref('em_alert_management_rule', 'dt-telemetry-rule'),
        sub_flow: Now.ref('sys_hub_flow', 'dt-fetch-metrics-subflow'),
    },
})
