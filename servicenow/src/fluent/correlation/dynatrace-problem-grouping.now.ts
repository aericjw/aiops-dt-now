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
//
// --- Single-alert gap (fixed 2026-09-08, see task-10-fix-single-alert-report.md) --
// Task 12's verification found V6/V7 both FAIL on live traffic and root-caused it
// here: both branches below were originally gated on `others.length > 0` (others =
// other still-groupable alerts already seen for the same Davis problem). Every
// Davis problem sampled on this tenant to date has produced exactly one alert, so
// `others.length` was always 0, neither branch's inner condition was ever true, and
// the script fell through to `return JSON.stringify({})` -- no alert was EVER
// assigned PRIMARY, not even a lone root-cause alert trivially grouping with
// itself. This is why correlation_rule_group never populated in practice despite
// the rule being deployed, active, and correctly ordered.
// Fix: an `others.length === 0` case now runs first and makes currentAlert PRIMARY
// of a group containing only itself (SECONDARY: [] -- empty array, not omitted;
// ServiceNow's own OOB "Alert correlation rule SAMPLE" script's header documents
// the result shape as PRIMARY (exactly 1 sys_id) + SECONDARY (an array, 1..n in
// its own worked example, but the field itself is never optional in any sample
// seen), so SECONDARY is kept present and typed as an array even when empty rather
// than omitted, to match that shape rather than guess at an undocumented
// omitted-key behavior). This applies regardless of current.isRootCause: a
// genuinely solo alert has no better primary candidate than itself either way. The
// pre-existing "demote to the real root-cause alert when it later arrives" logic
// (the `current.isRootCause` branch, which re-parents ALL of `others`) already
// covers the case where a second, root-cause alert for the same problem arrives
// after this one: by then `others.length` is 1 (this alert), so that branch fires
// as before -- no change was needed there.
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
        // Anchored to a key boundary (start of string, "{", or ", ") so a
        // hypothetical future key merely ending in the same suffix (e.g.
        // "some_other_dt_problem_display_id") can't false-match.
        var problemMatch = content.match(/(?:^|[{,]\s*)dt_problem_display_id=(P-[0-9]+)/);
        if (!problemMatch) {
            return null;
        }
        var rootCauseMatch = content.match(/(?:^|[{,]\s*)dt\\.davis\\.is_rootcause_relevant=(true|false)/);
        return {
            problemId: problemMatch[1],
            isRootCause: rootCauseMatch ? (rootCauseMatch[1] === 'true') : false,
        };
    }

    var current = extractProblemAndRootCause(currentAlert.getValue('additional_info'));
    if (!current) {
        return JSON.stringify({});
    }

    // Keep in sync with this rule record's own time_difference field (60,
    // set alongside this script) -- the advanced-rule script has no handle
    // back to its own em_alert_correlation_rule record, so this can't be
    // read live; it's a plain duplicate that must be edited in both places.
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
    while (gr.next()) {
        var otherSysId = gr.getUniqueValue();
        others.push(otherSysId);
        var other = extractProblemAndRootCause(gr.getValue('additional_info'));
        if (other && other.isRootCause && existingRootCauseSysId === null) {
            existingRootCauseSysId = otherSysId;
        }
    }

    var result = {};
    if (others.length === 0) {
        // No other still-groupable alert has been seen yet for this Davis
        // problem: currentAlert is primary of a group containing only
        // itself -- root-cause or not, there is no better candidate than
        // itself when it's the only alert. If a genuine root-cause alert
        // for this problem arrives later (while this one is still
        // "current"), the isRootCause branch below re-parents everything in
        // others -- which will by then include this alert -- so this
        // provisional self-primary gets correctly demoted at that point.
        result = {
            'PRIMARY': [currentAlert.getValue('sys_id')],
            'SECONDARY': [],
        };
    } else if (current.isRootCause) {
        // currentAlert is the Davis root-cause event: it is primary over
        // every other alert already seen for this problem, even ones
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
