import { Record } from '@servicenow/sdk/core'

// Runs BEFORE dynatrace-problem-grouping.now.ts's CI-based rule (order 90).
// The correlation engine evaluates active em_alert_correlation_rule rows in
// ascending order and stops at the first one that returns a non-empty
// result for a given alert, so this rule's job is to claim -- ahead of the
// CI-based rule -- exactly the alerts where Davis has ALREADY done
// topology-aware root-cause correlation across multiple events, and to
// otherwise get out of the way.
//
// --- Why this exists alongside the CI-based rule, not instead of it ------
// Dynatrace's own Davis AI groups raw events into one Problem using its
// Smartscape topology and root-cause/impact graph -- work ServiceNow has no
// way to redo and shouldn't try to. Every em_alert this pipeline creates
// carries that problem's display_id (e.g. "P-26091453") verbatim in
// additional_info. When two or more em_alerts share the same display_id,
// Davis has already decided they're the same incident; grouping them by
// display_id here preserves that decision exactly, rather than re-deriving
// it from whatever CI each alert happens to bind to.
//
// The CI-based rule at order 90 remains the correlation mechanism for
// everything Davis's own grouping doesn't cover: a solo Dynatrace alert (no
// sibling sharing its display_id yet) still needs to be able to join a
// group with a DIFFERENT source's alert bound to the same CI -- that's the
// entire point of the 2026-09-11 generalization (see
// dynatrace-problem-grouping.now.ts). If this rule self-promoted a solo
// display_id alert to PRIMARY outright, it would claim that alert
// permanently and the CI-based rule would never see it again, silently
// closing off the cross-source case for every Dynatrace alert that happens
// to arrive as a group of one. So: this rule only ever produces a result
// when it finds an ACTUAL sibling (others.length > 0) -- otherwise it
// returns {} and falls through to order 90, which already has its own,
// independently-reviewed logic for solo-alert primary assignment (gated on
// the same Davis root-cause flag, just keyed by CI instead of display_id).
//
// --- Parsing shape (same as dynatrace-problem-grouping.now.ts) -----------
// additional_info on this pipeline is
// {"additional_content": "event.id=..., dt_problem_display_id=P-NNNN, dt.davis.is_rootcause_relevant=true"}
// -- a Java Map#toString string embedded in a JSON wrapper, not nested JSON.
// Regexes are anchored to a key boundary (start of string, "{", or ", ") so
// a hypothetical future key merely ending in the same suffix can't
// false-match, and template-literal backslashes are doubled (`\\s`, `\\.`)
// so the deployed script contains a real `\s`/`\.` regex token rather than
// a literal "s"/"." -- the exact escaping bug (C1) that broke this same
// logic once before generalization.
Record({
    $id: Now.ID['dt-correlate-by-display-id'],
    table: 'em_alert_correlation_rule',
    data: {
        name: 'Group Dynatrace alerts by Davis problem display_id',
        active: true,
        advanced: true,
        table: 'em_alert',
        order: 85,
        time_difference: 60,
        description:
            'Preserves Davis\'s own topology-aware root-cause grouping: any em_alert sharing the same dt_problem_display_id as another still-groupable Dynatrace alert is grouped with it, primary chosen by dt.davis.is_rootcause_relevant. Runs before the CI-based rule (order 90) so Davis\'s own multi-event grouping decision is not overridden by a coarser same-CI match. Deliberately produces no result for a solo Dynatrace alert (no sibling sharing its display_id yet) so it falls through to order 90, which can still group it with a different source\'s alert on the same bound CI. See dynatrace-problem-grouping.now.ts for the CI-based rule this complements.',
        advanced_filter: 'source=Dynatrace^EQ',
        relationship: '',
        relationship_type: 1,
        override_group_description: false,
        custom_group_description: '',
        generate_virtual_alerts: false,
        script: `(function findAlertsForSameDavisProblem(currentAlert) {
    function extractProblemAndRootCause(additionalInfoRaw) {
        var parsed;
        try {
            parsed = JSON.parse(additionalInfoRaw);
        } catch (e) {
            return null;
        }
        var content = (parsed && parsed.additional_content) ? String(parsed.additional_content) : '';
        var problemMatch = content.match(/(?:^|[{,]\\s*)dt_problem_display_id=(P-[0-9]+)/);
        if (!problemMatch) {
            return null;
        }
        // FIX (2026-09-15, P-26092999 investigation): reads dt_is_root_cause,
        // not the per-event dt.davis.is_rootcause_relevant flag -- Davis was
        // observed setting that flag true on multiple events of the same
        // multi-entity problem at once, which is not an exclusive signal.
        // dt_is_root_cause compares each event's entity id against the
        // Davis PROBLEM's own single root_cause_entity_id (see
        // dynatrace-problem-grouping.now.ts's isDavisRootCause for the full
        // rationale, and dynatrace/dql/extract_events.dql for where it's set).
        var rootCauseMatch = content.match(/(?:^|[{,]\\s*)dt_is_root_cause=(true|false)/);
        return {
            problemId: problemMatch[1],
            isRootCause: rootCauseMatch ? (rootCauseMatch[1] === 'true') : false,
        };
    }

    var current = extractProblemAndRootCause(currentAlert.getValue('additional_info'));
    if (!current) {
        // Not a Dynatrace-shaped alert (or additional_info doesn't carry a
        // display_id yet) -- nothing for this rule to do. Fall through to
        // order 90.
        return JSON.stringify({});
    }

    // Keep in sync with this rule record's own time_difference field (60) --
    // the advanced-rule script has no handle back to its own
    // em_alert_correlation_rule record, so this can't be read live; it's a
    // plain duplicate that must be edited in both places.
    var timeDifferenceInMinutes = 60;
    var windowStart = new GlideDateTime(currentAlert.getValue('initial_remote_time'));
    windowStart.subtract(Number(timeDifferenceInMinutes) * 1000 * 60);

    // Gather every other still-groupable alert (0=None or 1=Primary; a
    // 2=Secondary alert already belongs to a group and is left alone) for
    // the same Davis problem, within the window.
    var gr = new GlideRecord('em_alert');
    gr.addQuery('additional_info', 'CONTAINS', 'dt_problem_display_id=' + current.problemId);
    gr.addQuery('sys_id', '!=', currentAlert.getValue('sys_id'));
    gr.addQuery('correlation_rule_group', 'IN', '0,1');
    gr.addQuery('initial_remote_time', '>=', windowStart);
    gr.orderBy('initial_remote_time');
    gr.query();

    var others = [];
    var existingRootCauseSysId = null;
    while (gr.next()) {
        var otherSysId = gr.getUniqueValue();
        others.push(otherSysId);
        var other = extractProblemAndRootCause(gr.getValue('additional_info'));
        if (other && other.isRootCause && existingRootCauseSysId === null) {
            existingRootCauseSysId = otherSysId;
        }
    }

    if (others.length === 0) {
        // No sibling for this Davis problem seen yet -- whether or not
        // currentAlert is itself the root cause, do NOT self-promote here.
        // A solo alert (by definition, since there's no sibling to preserve
        // Davis's grouping against) is exactly the case order 90's CI-based
        // rule exists to handle, including the possibility of it joining a
        // different source's alert on the same CI. Self-promoting here
        // would permanently claim it and foreclose that.
        return JSON.stringify({});
    }

    var result;
    if (current.isRootCause) {
        // currentAlert is the Davis root-cause event: primary over every
        // other alert already seen for this problem, even ones
        // provisionally (mis)assigned primary before this one arrived.
        result = {
            'PRIMARY': [currentAlert.getValue('sys_id')],
            'SECONDARY': others,
        };
    } else {
        // Prefer an already-seen root-cause alert as primary; fall back to
        // the earliest-arrived alert for this problem if the root-cause
        // event hasn't shown up yet (it will re-parent everything above
        // when it does).
        var primarySysId = existingRootCauseSysId !== null ? existingRootCauseSysId : others[0];
        result = {
            'PRIMARY': [primarySysId],
            'SECONDARY': [currentAlert.getValue('sys_id')],
        };
    }
    return JSON.stringify(result);
})(currentAlert);`,
    },
})
