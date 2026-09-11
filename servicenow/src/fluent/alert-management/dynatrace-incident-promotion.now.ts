import { Record } from '@servicenow/sdk/core'

// Spec section 11: N alerts -> exactly one incident, from the aggregation
// group's primary (root-cause) alert only.
//
// --- Deviations from the task-11 brief, and why -----------------------------
// The brief calls for the em_incident_template to "carry the Davis problem
// ID, the dt_problem_url deep link, the bound CI, and the impacted service".
// Live inspection of this instance shows that is not how em_incident_template
// works, and that most of that data does not need to be carried by it at
// all:
//
//   - em_incident_template.template (internal_type template_value) is a
//     static "field=value^field2=value2^EQ" string applied at creation time.
//     The only two non-trivial live examples on this PDI are
//     "state=2^active=true^EQ" (OOB "Incident Template for Event
//     Management") and "short_description=...^caller_id=javascript:gs.getUserID();^impact=1^urgency=1^EQ"
//     ("Major Incident") -- so a `javascript:` value IS supported, but it
//     evaluates against the new incident record itself (`current`), which
//     has no handle back to the source em_alert. There is no per-alert
//     scripting hook anywhere in this pipeline: em_alert_management_rule's
//     own column list (verified against sys_dictionary, see brief) has no
//     `script` field, unlike em_alert_correlation_rule. So the template
//     cannot inject a value that varies per alert (the Davis problem ID, the
//     dt_problem_url deep link) -- there is no live example anywhere on this
//     instance of a template doing that, and hand-composing an unverified
//     encoding is exactly the mistake task-9-report.md's Defect A already
//     documents the cost of.
//   - It turns out most of what the brief wants carried does not need the
//     template's help, because the platform's built-in alert-to-incident
//     promotion (fired by em_alert_management_rule type=incident) already
//     copies the relevant fields straight off the alert, independent of the
//     template:
//       - cmdb_ci: em_alert.cmdb_ci is already the CI Task 9's match rules
//         bind (confirmed live, e.g. sys_id fe3f230883d3cf900b9fffefeeaad3c7
//         has cmdb_ci=34311fd49035cb509dd8975220a50a83), and task.cmdb_ci is
//         copied from the promoting alert as core ITOM Event Management
//         behavior.
//       - Davis problem ID: em_alert.short_description already embeds it
//         verbatim, e.g. "...- [P-26091489] Failure rate increase - The
//         error rate increased to 8.27 %." -- set by the workflow's
//         f-description mapping (dynatrace/workflows/dt-problems-to-snow-itom.yaml),
//         and copied through the same way.
//       - impacted service: em_alert has no direct business_service column
//         to copy (only the OOB "Impacted Services" *count*, `sn_services`);
//         "impacted service" is the CI's existing CMDB business-service
//         relationship, surfaced on the incident once cmdb_ci is set -- not
//         a value any rule or template sets directly.
//     task.correlation_id / correlation_display (base `task` table columns)
//     are the platform's own alert<->incident linkage, so the created
//     incident is always traceable back to the source em_alert and from
//     there to dt_problem_url in that alert's additional_info -- the deep
//     link is one hop away, not duplicated onto the incident.
//   - Net effect: this template intentionally mirrors the OOB "Incident
//     Template for Event Management" (state=2 New, active=true) rather than
//     inventing new template syntax. It exists mainly to give this rule its
//     own named, Dynatrace-scoped em_incident_template row (so it isn't
//     silently sharing config with the OOB Event Management template and
//     can be changed independently later) plus a plain-language
//     short_description for anyone auditing config.
Record({
    $id: Now.ID['dt-incident-template'],
    table: 'em_incident_template',
    data: {
        name: 'Incident Template for Event Management (multi-source)',
        short_description: 'Create incident from an aggregation group\'s primary alert, any source',
        table: 'incident',
        active: true,
        template: 'state=2^active=true^EQ',
    },
})

// --- The promotion rule ------------------------------------------------
// alert_filter mirrors the shape of the live (inactive) "Create Incident on
// Primary Critical Alert" rule (severity=1^correlation_group=1^incidentISEMPTY)
// -- confirming the encoded-query dialect for em_alert_management_rule.alert_filter
// takes no trailing ^EQ (unlike em_match_rule.filter in dynatrace-event-rules.now.ts,
// a different field/table with a different encoding).
//
// Condition breakdown:
//   - correlation_rule_group=1: "Primary" (verified against sys_choice for
//     em_alert.correlation_rule_group) -- the role
//     dynatrace-problem-grouping.now.ts's advanced correlation rule assigns.
//     This is deliberately correlation_rule_group (Role in User Defined
//     Group), not correlation_group (Role in Group, the OOB ML/Alert-Groups
//     engine that the "Create Incident on Primary Critical Alert" sample
//     rule targets and that this pipeline does not use) -- using the wrong
//     one would silently never fire, since our alerts are only ever grouped
//     via the em_alert_correlation_rule from task-10.
//   - incidentISEMPTY: without this, an alert already promoted to an
//     incident would re-fire this rule on every subsequent update the same
//     way an unguarded rule would, which is the exact "one incident per
//     event" noise problem this task exists to prevent -- a supporting
//     alert never sets correlation_rule_group=1 so it can never match this
//     rule regardless, but a primary alert legitimately updates many times
//     over a problem's life (state changes, correlated alerts joining the
//     group) and must only promote once.
//
// automatic_execution_setting=1 ("Alert changes to filter") matches every
// other active type=incident rule on this instance and fires the rule when
// an alert transitions into matching the filter -- consistent with task-10's
// finding that this instance's alert-side automation is transition-triggered,
// not evaluated continuously. multiple_alert_rules=1 ("Search for additional
// rules") also matches the prevailing convention among active rules, so this
// rule does not block any other, unrelated alert_management_rule from also
// evaluating the same alert.
//
// --- Generalized 2026-09-11 (dropped source=Dynatrace): -------------------
// dynatrace-problem-grouping.now.ts's correlation rule now groups by bound
// CI across sources, not just Dynatrace's. Leaving this rule scoped to
// source=Dynatrace would have meant a different source's alert could become
// a correlation group's primary but still never get promoted to an incident
// -- the exact same kind of half-generalization that would have made the
// correlation and sweep-job changes pointless for anyone but Dynatrace.
// Checked for collisions before widening: every other active,
// automatically-executing em_alert_management_rule on this instance either
// targets a different source explicitly (PRTG, Instana, Honeycomb, Oracle
// EM, OMi, Google Monitor, New Relic, Lightstep, EMSelfMonitoring, SGO-
// Dynatrace) or -- the one broad-looking exception, "Create Incident
// Manually" (alert_filter maintenance=false^incidentISEMPTY, order 100) --
// has its own action set to Manual execution (a person has to click it), so
// it never auto-creates an incident regardless of how broad its filter is.
// Nothing else on this instance can silently double-promote the same alert.
Record({
    $id: Now.ID['dt-promote-primary-to-incident'],
    table: 'em_alert_management_rule',
    data: {
        name: 'Create incident from aggregation group primary alert (multi-source)',
        active: true,
        order: 8010,
        type: 'incident',
        automatic_execution_setting: 1,
        multiple_alert_rules: 1,
        alert_filter: 'correlation_rule_group=1^incidentISEMPTY',
        // Now.ID['dt-incident-template'] (used elsewhere only as a $id) resolves to the raw
        // key string, not the referenced record's sys_id, when used as a data field value --
        // confirmed by a first deploy attempt that landed the literal string
        // "dt-incident-template" in this reference column instead of the em_incident_template
        // record's sys_id. Now.ref(table, key) is the documented API (sdk-core
        // global/ref.d.ts) for referencing another record by its Now.ID key, lazily resolved
        // to a sys_id at build time -- that is the correct call here.
        incident_template: Now.ref('em_incident_template', 'dt-incident-template'),
        description:
            'Creates one incident per aggregation group, from the primary alert only (correlation_rule_group=1, set by dynatrace-problem-grouping.now.ts\'s correlation rule). Source-agnostic: any alert that reaches Primary status, regardless of which integration created it, is promoted the same way. Supporting alerts never carry that role and so never create their own incidents.',
    },
})

// --- Follow-up fix: this rule was silently auto-deactivated -----------------
// Discovered live, well after Task 11 originally shipped: this rule had
// `active: true` in source on every deploy, but the live record read
// `active: false, error_msg: "No active actions"`. Root cause is a completely
// separate OOB business rule, "Deactive rule without actions" (before,
// em_alert_management_rule, order 100, unconditional):
//
//   if (!(evtMgmtAlertManagementCommons.activeActionsExist(current.getUniqueValue()))) {
//       current.active = false;
//       current.error_msg = "No active actions";
//   }
//
// Every em_alert_management_rule on this instance needs at least one active
// child `em_alert_management_action` row or the platform force-deactivates
// it, regardless of `type`/`incident_template`. This rule never had one --
// `type: 'incident'` plus `incident_template` alone was not sufficient, and
// no live example anywhere on this instance suggested otherwise until this
// was investigated directly.
//
// The actual mechanism: `type: 'incident'` rules on this instance create the
// incident via a Subflow action, not via `incident_template` (which appears
// vestigial/legacy) or `type` alone. Confirmed by inspecting the one other
// live `type: 'incident'` rule that genuinely creates incidents ("Create
// Incident Manually", sys_id fac1e85df3611300fba998d075612ba1, OOB,
// `incident_template` empty): its only action is an
// `em_alert_man_m2m_rule_flow` pointing at the OOB Subflow "Create Incident"
// (internal_name `create_incident`, sys_id
// 45454f6193330300415c74aff67ffbfb). That is the standard, working mechanism
// on this instance -- reused here rather than building a custom subflow,
// same as Task 13's precedent of preferring an existing verified pattern
// over an unverified new one.
Record({
    $id: Now.ID['dt-promote-primary-to-incident-action'],
    table: 'em_alert_man_m2m_rule_flow',
    data: {
        management_rule: Now.ref('em_alert_management_rule', 'dt-promote-primary-to-incident'),
        sub_flow: Now.ref('sys_hub_flow', '45454f6193330300415c74aff67ffbfb'),
        active: true,
        execution: 1,
        executions_limit: 1,
    },
})
