import { Record } from '@servicenow/sdk/core'

// Follow-up to dynatrace-problem-grouping.now.ts, added after the fact once
// live investigation (final whole-branch review + one scoped re-review, both
// with independent live verification against tacocorp/pdi) established WHY
// correlation_rule_group never populates for any Dynatrace alert despite the
// correlation script itself being confirmed correct (its `\s` escape and
// solo-primary bugs were both fixed and unit-tested first).
//
// Root cause, read directly from the live "Calculate correlation rule"
// business rule (em_alert, before insert/update, order 100 -- the ONLY caller
// of AlertManager.calculateAlertCorrelation() found anywhere on this
// instance, confirmed by searching every sys_script AND sys_script_include
// for the call):
//
//   var alertManager = new SNC.AlertManager();
//   if (current.state == 'Open' || current.state == 'Reopen') {
//       if (gs.getProperty('evt_mgmt.enable_alert_correlation') == 'true'
//           && !alertManager.isThreadProcessingEvents()) {
//           alertManager.calculateAlertCorrelation(current);
//       }
//   } else { // close should allways be activated, to support SA groups
//       alertManager.calculateAlertCorrelation(current);
//   }
//
// Every alert this pipeline creates is born INSIDE the platform's own
// internal event-processing thread (Event Rules converting em_event ->
// em_alert) -- exactly the thread `isThreadProcessingEvents()` excludes. So
// for an Open/Reopen alert, correlation is never invoked, regardless of
// anything this project's own script does or how correctly it's written.
// This held for 8 independent solo root-cause Davis problems sampled live
// over a 36+ minute window, and em_agg_group shows zero groups created for
// ANY alert source on this whole PDI since 2026-06-24 -- not Dynatrace-
// specific, not a processing-delay artifact.
//
// ServiceNow's own documentation (community: "Event Management: Leverage
// Alert Correlation and Grouping for Noise Reduction") states correlation
// "is applied only when new alert is created or the alert status changes
// from Closed/flapping to open or reopened" -- i.e. the platform's
// documented default IS to run correlation on creation. The
// isThreadProcessingEvents() guard that prevents this for
// pipeline-ingested alerts is NOT documented anywhere found (searched
// ServiceNow docs and community for the method name -- no hits). This is
// presumably a concurrency/performance safeguard for bulk event-processing
// bursts, not a deliberate policy against integrations, but it isn't
// publicly explained.
//
// This job is the workaround: run calculateAlertCorrelation() ourselves,
// from a scheduled job's own thread (never the guarded event-processing
// thread), for any Dynatrace alert the OOB rule's guard skipped. Confirmed
// this is NOT redundant with the OOB rule: activating more of the
// pre-existing "[Tag Based]" em_alert_correlation_rule rows would NOT help
// either -- they live in the exact same em_alert_correlation_rule table,
// invoked through the exact same guarded call site, so they hit the
// identical gate (verified live: all 16 tag-based rows have
// table: 'em_alert', same as this project's own rule).
Record({
    $id: Now.ID['dt-correlation-sweep-job'],
    table: 'sysauto_script',
    data: {
        name: 'Dynatrace - sweep ungrouped alerts for correlation',
        active: true,
        run_type: 'periodically',
        run_period: '1970-01-01 00:01:00', // every 1 minute; matches this instance's own EM job cadence convention (e.g. "Event Management - close threshold alerts" runs every 2 minutes)
        run_start: '2026-01-01 00:00:00',
        run_dayofweek: 1,
        run_time: '1970-01-01 08:00:00',
        conditional: false,
        condition: '',
        // No `description` field exists on sysauto_script (Fluent SDK's own
        // type rejects it) -- the full rationale lives in this file's header
        // comment instead.
        script: `(function sweepDynatraceAlertsForCorrelation() {
    // Bounded: at most 200 alerts per run, oldest first, so a large backlog
    // (e.g. after this job was first deployed) doesn't create one
    // long-running execution -- it'll catch up over a few cycles instead.
    var gr = new GlideRecord('em_alert');
    gr.addQuery('source', 'Dynatrace');
    // 0=None, 1=Primary -- both are "still groupable"; re-invoking on an
    // existing Primary lets a later-arriving root-cause alert re-parent it,
    // same semantics the correlation script's own "others" query already
    // uses. 2=Secondary is intentionally excluded, matching that script.
    gr.addQuery('correlation_rule_group', 'IN', '0,1');
    gr.addQuery('state', 'IN', 'Open,Reopen');
    // Newest first: live investigation found a large backlog of open,
    // never-correlated Dynatrace alerts stretching back to 2026-09-01 (this
    // pipeline's whole build/test history) -- oldest-first would spend many
    // cycles working through stale test noise before ever reaching today's
    // alerts, which are what actually matter operationally.
    gr.orderByDesc('sys_created_on');
    gr.setLimit(200);
    gr.query();

    var alertManager = new SNC.AlertManager();
    while (gr.next()) {
        alertManager.calculateAlertCorrelation(gr);
    }
})();`,
    },
})
