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
// Resolution (ORIGINAL, now superseded -- see I1 fix below): the original
// task-13 approach added a `kb_url: dt_problem_url` field mapping to
// dynatrace/workflows/dt-problems-to-snow-itom.yaml's send_event_to_servicenow
// step. That step writes to em_event (the workflow's snow_table, per its own
// header comment: "ServiceNow performs dedup, reopen and close natively
// using message_key" -- deliberately NOT em_alert, which the platform's own
// Alert Management engine generates FROM em_event records it processes).
// The mapping compiled and deployed without error, but was silently dropped
// at runtime: a `sys_dictionary` query confirmed em_event has NO kb_url
// column at all (0 rows for name=em_event^element=kb_url, vs. em_alert's
// kb_url which does exist, internal_type url). ServiceNow's OOB event-to-
// alert transform only carries over fields that exist by the same name on
// BOTH tables (this is how `cmdb_ci` carries through, per Task 11's
// finding -- confirmed here too: cmdb_ci exists on both em_event and
// em_alert). kb_url has no em_event-side counterpart for that mechanism to
// use, so the mapping was a no-op: live alerts kept showing the OOB default
// `/kb_view.do?sysparm_article=` (an empty, non-functional KB article link).
//
// --- I1 fix (final whole-branch review, 2026-09-08) ------------------------
// Removed the dead kb_url mapping from the workflow (there is no column on
// em_event for it to write to). Replaced with a `sys_script` Business Rule
// (before insert, on em_alert -- see the Record below) that runs when the
// platform creates the em_alert record: it parses the alert's own
// additional_info (already correctly populated by the workflow's
// `additional_info: {{ _.item }}` mapping, and already confirmed to carry
// dt_problem_url embedded in its Java-map-toString additional_content
// string, per Task 10/12's parsing work) with the same anchored-regex
// approach as the correlation script, and sets kb_url to the extracted URL
// before the record is inserted. `em_launch_application`'s existing
// `${kb_url}` template (action 1, unchanged) then just works, because
// kb_url is a genuine em_alert column populated at insert time -- no
// `${}` substitution into JSON keys inside a string field is needed, and
// the well-understood limits of `${field}` substitution documented above
// (still true) are worked around rather than fought.
//
// Live-verified 2026-09-08: after deploy, queried a live em_alert record
// (source=Dynatrace, most recent by sys_created_on) and confirmed kb_url now
// holds a real https://.../problem/P-NNNNNNNN URL matching that alert's own
// dt_problem_url, not the OOB default -- see the fix commit message for the
// exact sys_id and value observed.
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

// Action 1: open the Dynatrace problem. Credential-free -- deployed and
// confirmed via live query this session; the UI click-through itself was
// not independently observed (see task-13-report.md). kb_url is populated
// by the Business Rule below (I1 fix), not by the ingestion workflow.
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

// I1 fix: populate em_alert.kb_url with the Dynatrace problem URL at insert
// time, by parsing it out of the alert's own additional_info. This is the
// only mechanism confirmed to work -- see the long comment above for why
// the ingestion-workflow field mapping this originally relied on is dead
// (em_event has no kb_url column) and why `${field}` substitution in
// em_launch_application.url cannot reach a JSON key inside additional_info
// directly. Mirrors the anchored-key-boundary regex approach used in
// ../correlation/dynatrace-problem-grouping.now.ts (start-of-string, "{",
// or ", " boundary, so a hypothetical future key merely ending in
// "dt_problem_url" can't false-match), and is careful with the same
// backtick-template-literal escaping foot-gun that caused C1 there: `\s`
// (single backslash) collapses to a literal "s" inside a template literal,
// so `\\s` is used here to produce a real `\s` token in the deployed script.
Record({
    $id: Now.ID['dt-rule-populate-kb-url'],
    table: 'sys_script',
    data: {
        // sys_script.name has max_length=40 (confirmed via sys_dictionary) --
        // the original, longer name was silently truncated by the platform
        // on deploy. Kept short and unambiguous to avoid that.
        name: 'Dynatrace - populate alert kb_url',
        collection: 'em_alert',
        active: true,
        when: 'before',
        order: 150,
        action_insert: true,
        action_update: false,
        action_query: false,
        action_delete: false,
        condition: 'source=Dynatrace',
        description: 'Extracts dt_problem_url out of additional_info (a Java Map#toString string embedded in a JSON wrapper, not directly addressable JSON) and sets kb_url so the "Open problem in Dynatrace" launch action has a real URL to navigate to instead of the OOB empty-KB-article default.',
        script: `(function populateKbUrlFromProblemUrl(current) {
    var raw = current.getValue('additional_info');
    if (!raw) {
        return;
    }
    var parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        return;
    }
    var content = (parsed && parsed.additional_content) ? String(parsed.additional_content) : '';
    // Anchored to a key boundary (start of string, "{", or ", ") like the
    // correlation script's regexes, and captures up to the next key
    // boundary (", " or a closing "}") rather than to end-of-string, since
    // additional_content may have more key=value pairs after this one.
    var urlMatch = content.match(/(?:^|[{,]\\s*)dt_problem_url=([^,}]+)/);
    if (urlMatch) {
        current.setValue('kb_url', urlMatch[1].replace(/\\s+$/, ''));
    }
})(current);`,
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
