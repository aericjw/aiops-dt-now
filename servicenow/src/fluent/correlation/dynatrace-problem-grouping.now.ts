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
// alert's grouping outcome first (see below); the correlation engine does
// not re-run later rules once a rule has produced a grouping result for an
// alert, so the legacy rule's latent bug never gets a chance to fire.
//
// --- Single-alert gap (fixed 2026-09-08, see task-10-fix-single-alert-report.md) --
// Both branches were originally gated on `others.length > 0`. Every Davis
// problem sampled on this tenant at the time produced exactly one alert, so
// `others.length` was always 0 and no alert was EVER assigned PRIMARY, not
// even a lone root-cause alert trivially grouping with itself. Fixed with an
// `others.length === 0` case that makes currentAlert PRIMARY of a
// self-contained group (SECONDARY: [] -- empty array, not omitted, matching
// the shape ServiceNow's own OOB sample script documents).
//
// --- C1/C2 fix, 2026-09-08 (final whole-branch review) --------------------
// C1: a `\s` escape inside this backtick template literal collapsed to a
// literal `s` in the deployed script, breaking every regex match against the
// real `, ` separator in additional_content. Fixed with `\\s`.
// C2: the `others.length === 0` branch was unconditional, making ANY solo
// alert PRIMARY regardless of root-cause status -- for a multi-alert problem
// this could create two incidents (one from a wrongly-promoted non-root-cause
// alert, one from the real root-cause alert once it re-parented the first).
// Fixed by gating the solo branch on isRootCause.
//
// --- Generalized to group by bound CI, not Davis problem id (2026-09-11) --
// This pipeline exists to prove AIOps means correlating signal across
// sources, not just piping Dynatrace into ServiceNow faster. Grouping on
// `dt_problem_display_id` (Dynatrace-only data, parsed out of a
// Dynatrace-shaped additional_info string) meant this rule could never group
// an alert from any other source, no matter how good its CMDB binding was --
// the grouping key itself was the barrier, independent of everything else
// this rule already got right.
//
// Fix: group by `cmdb_ci` instead -- a real, direct em_alert column that
// exists identically regardless of source. Any alert bound to the same CI
// within the time window now correlates, whether it came from Dynatrace, a
// different monitoring tool, or anything else that lands in em_event with a
// working em_match_rule. Live proof this isn't just theoretical: at the time
// of this change, alerts with a bound CI already exist tenant-wide from
// EMSelfMonitoring, DEMO, and Group Alert sources alongside Dynatrace's --
// none of those had any way to correlate with each other before this change,
// even when bound to the same CI.
//
// Root-cause/primary selection had to change too, since
// dt.davis.is_rootcause_relevant is Dynatrace-specific (Davis AI's own
// determination -- no other source has an equivalent field on this
// instance). New ranking, in priority order:
//   1. Davis root-cause flag, if present (best-effort parse of
//      additional_content -- a bonus signal for Dynatrace alerts specifically,
//      never required, and simply absent/false for every other source).
//   2. `severity` (a real column on every em_alert regardless of source,
//      lower number = more severe on this instance's convention -- confirmed
//      against live data, e.g. SLOWDOWN=3, ERROR=2). severity=0 (Clear/
//      resolved) is normalized to the worst rank (999) so a closed alert on
//      the same CI can never outrank an active one.
//   3. Ties keep whichever alert was already primary (no reshuffling for a
//      dead heat).
// This is a real degradation of precision versus Davis's own root-cause
// analysis for Dynatrace's own alerts specifically -- Davis's signal is
// richer than "lowest severity number" -- but Davis's signal was never
// available for any other source to begin with, so this is what makes
// cross-source primary selection possible at all rather than a regression
// for anyone.
//
// --- Display_id-first, CI second (2026-09-15) ------------------------------
// dynatrace-correlation-by-display-id.now.ts now runs at order 85, strictly
// before this rule, and claims any Dynatrace alert that shares a
// dt_problem_display_id with another still-groupable Dynatrace alert --
// preserving Davis's own topology-aware root-cause grouping exactly, rather
// than re-deriving it from cmdb_ci. That rule deliberately returns no result
// for a SOLO Dynatrace alert (no display_id sibling yet), so this rule still
// sees those -- and still sees every other source's alert -- unchanged. Net
// effect: a multi-event Davis problem groups by display_id first; a solo
// Dynatrace alert, or any non-Dynatrace alert, still groups by CI here.
//
// Scope: widened from `source=Dynatrace` to "any alert with a bound CI",
// EXCEPT `Azure Monitor` -- that source already has its own dedicated,
// more specific correlation rule ("[Tag Based] Azure Monitor Correlation",
// order 9000, matches on Azure's own `essentials.correlationDetails.parentAlertId`
// relationship data). Since this rule runs at order 90 (before Azure's at
// 9000) and ServiceNow's correlation engine stops at the first rule that
// produces a result, leaving Azure Monitor alerts unclaimed here lets
// Azure's own, richer correlation logic run for them as originally intended
// instead of this rule's generic CI+severity heuristic silently preempting
// it. If a future source gets its own dedicated, more specific correlation
// rule, exclude it here the same way -- this is a judgment call each time
// (which source's own logic is actually better than the generic fallback),
// not something to automate.
Record({
    $id: Now.ID['dt-correlate-by-problem'],
    table: 'em_alert_correlation_rule',
    data: {
        name: 'Group alerts by bound CI and time window (multi-source)',
        active: true,
        advanced: true,
        table: 'em_alert',
        order: 90,
        time_difference: 60,
        description:
            'Groups any alert bound to the same CMDB CI within a time window into a single aggregation group, regardless of source. Primary is chosen by Davis root-cause flag when present (Dynatrace alerts only), falling back to severity for every other source. Excludes Azure Monitor, which has its own dedicated correlation rule. See dynatrace-problem-grouping.now.ts for the full history of this rule and why it looks the way it does.',
        advanced_filter: 'cmdb_ciISNOTEMPTY^source!=Azure Monitor^EQ',
        relationship: '',
        relationship_type: 1,
        override_group_description: false,
        custom_group_description: '',
        generate_virtual_alerts: false,
        script: `(function findCorrelatedAlerts(currentAlert) {
    // Best-effort, optional signal: Dynatrace alerts carry
    // dt_is_root_cause inside additional_info's Java Map#toString-shaped
    // additional_content string. Any other source simply won't match this
    // regex -- isDavisRootCause returns false, and ranking falls through to
    // severity below. Never required, never assumed present.
    //
    // FIX (2026-09-15, P-26092999 investigation): this used to read
    // dt.davis.is_rootcause_relevant, a per-EVENT flag. Live investigation
    // found Davis sets that flag true on MULTIPLE events of the same
    // multi-entity problem simultaneously (e.g. both the actual root-cause
    // service and a downstream affected service) -- it is not exclusive, so
    // whichever alert happened to arrive last in ServiceNow would win
    // PRIMARY regardless of Davis's actual determination. dt_is_root_cause
    // (set in dynatrace/dql/extract_events.dql / the deployed workflow) is
    // computed by comparing each event's own entity id against the Davis
    // PROBLEM's single root_cause_entity_id, so at most one event's alert can
    // ever have it true -- a real fix, not just a rename.
    function isDavisRootCause(additionalInfoRaw) {
        var parsed;
        try {
            parsed = JSON.parse(additionalInfoRaw);
        } catch (e) {
            return false;
        }
        var content = (parsed && parsed.additional_content) ? String(parsed.additional_content) : '';
        // Anchored to a key boundary (start of string, "{", or ", ") so a
        // hypothetical future key merely ending in the same suffix can't
        // false-match.
        var m = content.match(/(?:^|[{,]\\s*)dt_is_root_cause=(true|false)/);
        return m ? (m[1] === 'true') : false;
    }

    // severity=0 means Clear/resolved on this instance's convention, not
    // "most severe" -- normalize it to the worst possible rank so a closed
    // alert on the shared CI can never outrank an active one.
    function severityRank(rawSeverity) {
        var n = Number(rawSeverity);
        if (isNaN(n) || n === 0) {
            return 999;
        }
        return n;
    }

    var currentCiId = currentAlert.getValue('cmdb_ci');
    if (!currentCiId) {
        // Nothing to correlate by CI if this alert was never bound. The
        // rule's own advanced_filter (cmdb_ciISNOTEMPTY) should already keep
        // this script from running at all in that case; this is a defensive
        // second check, not the primary gate.
        return JSON.stringify({});
    }

    var currentIsRootCause = isDavisRootCause(currentAlert.getValue('additional_info'));
    var currentSeverityRank = severityRank(currentAlert.getValue('severity'));

    // Keep in sync with this rule record's own time_difference field (60,
    // set alongside this script) -- the advanced-rule script has no handle
    // back to its own em_alert_correlation_rule record, so this can't be
    // read live; it's a plain duplicate that must be edited in both places.
    var timeDifferenceInMinutes = 60;
    var windowStart = new GlideDateTime(currentAlert.getValue('initial_remote_time'));
    windowStart.subtract(Number(timeDifferenceInMinutes) * 1000 * 60);

    // Gather every other still-groupable alert (correlation_rule_group
    // 0=None or 1=Primary; a 2=Secondary alert already belongs to a group
    // and is left alone) bound to the SAME CI, within the window --
    // source-agnostic: any alert here, from any source, is a candidate.
    var gr = new GlideRecord('em_alert');
    gr.addQuery('cmdb_ci', currentCiId);
    gr.addQuery('sys_id', '!=', currentAlert.getValue('sys_id'));
    gr.addQuery('correlation_rule_group', 'IN', '0,1');
    gr.addQuery('initial_remote_time', '>=', windowStart);
    gr.orderBy('initial_remote_time');
    gr.query();

    var others = [];
    var bestOtherSysId = null;
    var bestOtherIsRootCause = false;
    var bestOtherSeverityRank = null;
    while (gr.next()) {
        var otherSysId = gr.getUniqueValue();
        others.push(otherSysId);
        var otherIsRootCause = isDavisRootCause(gr.getValue('additional_info'));
        var otherSeverityRank = severityRank(gr.getValue('severity'));
        var otherOutranksBest =
            bestOtherSysId === null ||
            (otherIsRootCause && !bestOtherIsRootCause) ||
            (otherIsRootCause === bestOtherIsRootCause && otherSeverityRank < bestOtherSeverityRank);
        if (otherOutranksBest) {
            bestOtherSysId = otherSysId;
            bestOtherIsRootCause = otherIsRootCause;
            bestOtherSeverityRank = otherSeverityRank;
        }
    }

    var result = {};
    if (others.length === 0 && currentIsRootCause) {
        // No other still-groupable alert on this CI yet, AND currentAlert is
        // itself the Davis root-cause event: primary of a group containing
        // only itself.
        result = {
            'PRIMARY': [currentAlert.getValue('sys_id')],
            'SECONDARY': [],
        };
    } else if (others.length === 0 && !currentIsRootCause) {
        // No other alert on this CI yet, and this one has no root-cause
        // signal either way. Same C2 reasoning as before: do not
        // self-promote on weak/absent signal alone, to avoid a premature
        // primary that a later, more severe/root-cause sibling on the same
        // CI would have to re-parent (risking a double incident in between).
        // Left ungrouped; picked up as an "other" candidate if/when a sibling arrives.
        return JSON.stringify({});
    } else {
        // At least one other alert already shares this CI within the
        // window. Decide whether currentAlert outranks the best one seen so
        // far: Davis root-cause first (if either side has it), then lower
        // severity rank wins, ties keep the incumbent.
        var currentOutranksBest =
            (currentIsRootCause && !bestOtherIsRootCause) ||
            (currentIsRootCause === bestOtherIsRootCause && currentSeverityRank < bestOtherSeverityRank);
        if (currentOutranksBest) {
            result = {
                'PRIMARY': [currentAlert.getValue('sys_id')],
                'SECONDARY': others,
            };
        } else {
            result = {
                'PRIMARY': [bestOtherSysId],
                'SECONDARY': [currentAlert.getValue('sys_id')],
            };
        }
    }
    return JSON.stringify(result);
})(currentAlert);`,
    },
})
