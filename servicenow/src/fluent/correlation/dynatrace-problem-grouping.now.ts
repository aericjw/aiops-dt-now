import { Record } from '@servicenow/sdk/core'

// Spec DEC-4: Davis grouping arrives intact, then ServiceNow refines.
// Groups every em_alert originating from one Dynatrace Davis problem into a
// single em_agg_group, with the alert whose event carried
// dt.davis.is_rootcause_relevant=true set as primary.
//
// --- Deviation from the task-10 brief, and why -----------------------------
// The brief calls for expressing this via filter_parent/filter_child (the
// non-advanced grouping mechanism). That was not possible to verify: every
// em_alert_correlation_rule that exists on this instance -- all twelve
// "[Tag Based]" rules, the sample rule, and the two rules that are already
// active ("[Tag Based] Azure Monitor Correlation" and "Dynatrace alert
// correlation rule") -- has advanced=true with filter_parent and
// filter_child both empty. There is no live example of the filter_parent/
// filter_child encoding anywhere on this PDI to copy field-shape from, so
// (per this project's own precedent of not hand-composing unverified
// encodings -- see task-9-report.md Defect A) this rule uses `script`
// instead, the alternative the brief itself names for when advanced=true.
//
// The brief also names the grouping key as additional_info.dynatrace_problem_id
// and expects additional_info to carry directly-addressable JSON keys. Live
// em_alert data (queried 2026-09-08) shows neither is true:
//   - additional_info is `{"additional_content": "<string>"}` where the
//     string is a Java Map#toString rendering (`key=value, key2=value2`,
//     unquoted, comma-delimited) -- not nested JSON, so no additional_info.*
//     key path resolves at all.
//   - the key that actually carries the Davis problem identifier is
//     dt_problem_display_id (e.g. "P-26091453"), confirmed shared across
//     multiple em_alert records for the same problem. There is no
//     dynatrace_problem_id key anywhere in the payload.
//   - dt.davis.is_rootcause_relevant *is* present verbatim as named in the
//     brief, embedded in that same key=value string.
// The script below parses additional_content accordingly.
//
// --- Pre-existing active rule risk (reportable finding) --------------------
// "Dynatrace alert correlation rule" (sys_id ac1921d1db68c410470990e5db961925,
// order 100, active=true, OOB from 2019) already matches source=Dynatrace and
// runs a script that reads additional_info_json['problem_id'] -- a key that
// has never existed in this pipeline's additional_info shape (see above), so
// problem_id is always undefined. Its GlideRecord query
// `addQuery('additional_info', 'CONTAINS', problem_id)` with an undefined
// value is a latent bug: if the platform coerces that to an empty-string
// CONTAINS, every em_alert record satisfies it, which would pair unrelated
// alerts within the 60-minute window. This rule is set to order 90 --
// strictly before that legacy rule -- specifically so it claims every
// Dynatrace alert's grouping outcome first; the correlation engine does not
// re-run later rules once a rule has produced a grouping result for an
// alert, so the legacy rule's latent bug never gets a chance to fire against
// our events. The legacy rule itself was left untouched (out of scope for
// this task, and not risk-free to alter blind).
Record({
    $id: Now.ID['dt-correlate-by-problem'],
    table: 'em_alert_correlation_rule',
    data: {
        name: 'Dynatrace - group alerts by Davis problem id',
        active: true,
        advanced: true,
        table: 'em_alert',
        order: 90,
        time_difference: 60,
        description:
            'Groups all alerts originating from one Dynatrace Davis problem into a single aggregation group, preserving Davis root cause analysis. Advanced (script-based) rule -- see dynatrace-problem-grouping.now.ts for why filter_parent/filter_child could not be used, and for the actual shape of Dynatrace additional_info on this instance.',
        advanced_filter: 'source=Dynatrace^EQ',
        relationship: '',
        relationship_type: 1,
        override_group_description: false,
        custom_group_description: '',
        generate_virtual_alerts: false,
        script: `(function findCorrelatedAlerts(currentAlert) {
    // Dynatrace additional_info on this pipeline is
    // {"additional_content": "event.id=..., dt_problem_display_id=P-NNNN, dt.davis.is_rootcause_relevant=true"}
    // -- a Java Map#toString string, not nested JSON. Extract the two
    // fields we need by regex rather than JSON.parse-ing that string.
    function extractProblemAndRootCause(additionalInfoRaw) {
        var parsed;
        try {
            parsed = JSON.parse(additionalInfoRaw);
        } catch (e) {
            return null;
        }
        var content = (parsed && parsed.additional_content) ? String(parsed.additional_content) : '';
        var problemMatch = content.match(/dt_problem_display_id=(P-[0-9]+)/);
        if (!problemMatch) {
            return null;
        }
        var rootCauseMatch = content.match(/dt\\.davis\\.is_rootcause_relevant=(true|false)/);
        return {
            problemId: problemMatch[1],
            isRootCause: rootCauseMatch ? (rootCauseMatch[1] === 'true') : false,
        };
    }

    var current = extractProblemAndRootCause(currentAlert.getValue('additional_info'));
    if (!current) {
        return JSON.stringify({});
    }

    var timeDifferenceInMinutes = 60;
    var timeDifferenceBetweenAlerts = new GlideDateTime(currentAlert.getValue('initial_remote_time'));
    timeDifferenceBetweenAlerts.subtract(Number(timeDifferenceInMinutes) * 1000 * 60);

    // Gather every other still-groupable alert (correlation_rule_group
    // 0=None or 1=Primary; a 2=Secondary alert already belongs to a group
    // and is left alone) for the same Davis problem, within the window.
    var gr = new GlideRecord('em_alert');
    gr.addQuery('additional_info', 'CONTAINS', 'dt_problem_display_id=' + current.problemId);
    gr.addQuery('sys_id', '!=', currentAlert.getValue('sys_id'));
    gr.addQuery('correlation_rule_group', 'IN', '0,1');
    gr.addQuery('initial_remote_time', '>=', timeDifferenceBetweenAlerts);
    gr.orderBy('initial_remote_time');
    gr.query();

    var others = [];
    var existingRootCauseSysId = null;
    while (gr._next()) {
        var otherSysId = gr.getUniqueValue();
        others.push(otherSysId);
        var other = extractProblemAndRootCause(gr.getValue('additional_info'));
        if (other && other.isRootCause && existingRootCauseSysId === null) {
            existingRootCauseSysId = otherSysId;
        }
    }

    var result = {};
    if (current.isRootCause) {
        // currentAlert is the Davis root-cause event: it is primary over
        // every other alert already seen for this problem, even ones
        // provisionally (mis)assigned primary before this one arrived.
        if (others.length > 0) {
            result = {
                'PRIMARY': [currentAlert.getValue('sys_id')],
                'SECONDARY': others,
            };
        }
    } else if (others.length > 0) {
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
