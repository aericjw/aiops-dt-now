// Regression test for servicenow/src/fluent/correlation/dynatrace-problem-grouping.now.ts
//
// Why this exists (I7, final whole-branch review, 2026-09-08): this ~60-line
// script has never had a test. Three of this project's most expensive
// defects all lived in this one file and would each have been caught by a
// test like this one:
//   1. a gr._next() typo (should be gr.next()) -- infinite loop / no results
//   2. the `others.length` gap -- both branches gated on others.length > 0,
//      so a lone alert (the common case) was NEVER assigned PRIMARY
//   3. C1 (this review): \s inside the backtick template literal collapses
//      to a literal "s" at parse time, silently breaking both regexes
//
// Updated 2026-09-11 for the CI-based generalization: the script no longer
// groups by dt_problem_display_id (Dynatrace-only data) -- it groups by
// `cmdb_ci` (a real column, any source), ranking candidates by an optional
// Davis root-cause flag first, then by severity (normalizing severity=0
// Clear/resolved to the worst rank so it can never outrank an active alert).
// Cases below cover: solo self-promotion, cross-CI isolation (the whole
// point of the generalization), root-cause outranking severity, and
// severity-only ranking when neither alert has a root-cause signal (the new
// behavior a Dynatrace-only test suite would never have exercised).
//
// How this test works: it does NOT re-implement or hand-copy the script's
// logic. It extracts the literal `script: `...`` template-literal text
// straight out of the .now.ts SOURCE FILE and hands it to Node's own parser
// (by writing it into a small generated .js file and require()-ing it) --
// the same JS/TS grammar the real @servicenow/sdk build uses -- so template
// literal escape collapsing (the exact class of bug in C1) is reproduced
// faithfully rather than re-guessed. The resulting function is then run
// against stub GlideRecord/GlideDateTime objects seeded with realistic
// payload shapes and checked against the PRIMARY/SECONDARY cases below.
//
// Run directly: node tests/test_correlation_grouping.js
// Or via pytest: tests/test_correlation_grouping.py (subprocess wrapper,
// consistent with this repo's existing CLI-test pattern in
// test_validate_mapping.py).

'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const SOURCE_PATH = path.join(
    __dirname, '..', 'servicenow', 'src', 'fluent', 'correlation',
    'dynatrace-problem-grouping.now.ts'
);

function extractScriptLiteral(sourceText) {
    const marker = 'script: `';
    const start = sourceText.indexOf(marker);
    if (start === -1) {
        throw new Error('Could not find `script: `` marker in source file -- has the file structure changed?');
    }
    const literalStart = start + marker.length - 1; // position of the opening backtick itself
    // The script body is known (verified by grep, see file comments) to
    // contain no embedded backticks, so the next backtick after the opening
    // one is the closing one.
    const closingBacktick = sourceText.indexOf('`', literalStart + 1);
    if (closingBacktick === -1) {
        throw new Error('Could not find closing backtick for the script template literal.');
    }
    return sourceText.slice(literalStart, closingBacktick + 1); // includes both backticks
}

function loadFindCorrelatedAlerts() {
    const sourceText = fs.readFileSync(SOURCE_PATH, 'utf8');
    const literal = extractScriptLiteral(sourceText);
    // literal is a complete `...` template literal expression whose
    // evaluated string is: "(function findCorrelatedAlerts(currentAlert) { ... })(currentAlert);"
    // Wrap it so requiring this generated file hands back that STRING
    // (with real template-literal escape processing already applied by
    // Node's own parser), not the executed result.
    const wrapperSource = `module.exports = ${literal};\n`;
    const tmpFile = path.join(os.tmpdir(), `dt-correlation-script-${process.pid}.js`);
    fs.writeFileSync(tmpFile, wrapperSource, 'utf8');
    let deployedScriptText;
    try {
        delete require.cache[require.resolve(tmpFile)];
        deployedScriptText = require(tmpFile);
    } finally {
        fs.unlinkSync(tmpFile);
    }
    if (typeof deployedScriptText !== 'string') {
        throw new Error('Expected the extracted literal to evaluate to a string.');
    }
    return deployedScriptText;
}

// ---- Stub GlideRecord / GlideDateTime -------------------------------------

function makeGlideDateTime(isoOrEpoch) {
    let ms = typeof isoOrEpoch === 'number' ? isoOrEpoch : Date.parse(isoOrEpoch);
    return {
        subtract(msToSubtract) {
            ms -= msToSubtract;
        },
        valueOf() {
            return ms;
        },
    };
}

function makeGlideRecordFactory(database) {
    // database: array of { sys_id, additional_info, initial_remote_time, correlation_rule_group }
    return function GlideRecord(tableName) {
        const conditions = [];
        let orderByField = null;
        let rows = [];
        let cursor = -1;
        return {
            addQuery(field, opOrValue, maybeValue) {
                if (maybeValue === undefined) {
                    conditions.push({ field, op: '=', value: opOrValue });
                } else {
                    conditions.push({ field, op: opOrValue, value: maybeValue });
                }
            },
            orderBy(field) {
                orderByField = field;
            },
            query() {
                rows = database.filter((rec) => conditions.every((c) => {
                    const actual = rec[c.field];
                    switch (c.op) {
                        case 'CONTAINS':
                            return String(actual).indexOf(c.value) !== -1;
                        case '!=':
                            return actual !== c.value;
                        case 'IN':
                            return String(c.value).split(',').indexOf(String(actual)) !== -1;
                        case '>=':
                            return Date.parse(actual) >= Number(c.value.valueOf());
                        case '=':
                            return actual === c.value;
                        default:
                            throw new Error('Unsupported stub GlideRecord op: ' + c.op);
                    }
                }));
                if (orderByField) {
                    rows = rows.slice().sort((a, b) => Date.parse(a[orderByField]) - Date.parse(b[orderByField]));
                }
                cursor = -1;
            },
            next() {
                cursor += 1;
                return cursor < rows.length;
            },
            getUniqueValue() {
                return rows[cursor].sys_id;
            },
            getValue(field) {
                return rows[cursor][field];
            },
        };
    };
}

function makeCurrentAlert(record) {
    return {
        getValue(field) {
            return record[field];
        },
    };
}

function runScript(deployedScriptText, currentAlertRecord, database) {
    const sandbox = {
        currentAlert: makeCurrentAlert(currentAlertRecord),
        GlideRecord: makeGlideRecordFactory(database),
        GlideDateTime: makeGlideDateTime,
        JSON,
        console,
    };
    const vm = require('vm');
    const context = vm.createContext(sandbox);
    const script = new vm.Script(
        `(function() { var __result = (${deployedScriptText.slice(0, -1)}); return __result; })()`
    );
    // deployedScriptText already ends in "...})(currentAlert);" -- strip the
    // trailing ';' so it can be used as an expression inside the wrapper IIFE above.
    const resultJson = script.runInContext(context);
    return JSON.parse(resultJson);
}

// ---- Fixture data -----------------------------------------------------
// additional_info shape matches live captured payloads: a Java
// Map#toString-rendered `additional_content` string. isRootCause is
// optional (undefined => the key is omitted entirely, simulating a
// non-Dynatrace source that never carries this field at all).

function additionalInfo(isRootCause, eventId) {
    let content = `event.id=${eventId}`;
    if (isRootCause !== undefined) {
        content += `, dt.davis.is_rootcause_relevant=${isRootCause}`;
    }
    return JSON.stringify({ additional_content: content });
}

function assertDeepEqual(actual, expected, label) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
        throw new Error(`FAIL [${label}]: expected ${e}, got ${a}`);
    }
    console.log(`PASS [${label}]`);
}

function main() {
    const deployedScriptText = loadFindCorrelatedAlerts();

    // Regression check for C1 specifically: the deployed (post-template-literal)
    // script text must contain a REAL \s whitespace token in both regexes, not a
    // bare "s" (which is what the C1 bug produced: `[{,]s*`).
    if (deployedScriptText.indexOf('[{,]s*') !== -1) {
        throw new Error('FAIL [C1 regression]: deployed script contains the broken `[{,]s*` pattern (literal "s", not \\s).');
    }
    if (deployedScriptText.indexOf('[{,]\\s*') === -1) {
        throw new Error('FAIL [C1 regression]: deployed script does not contain the correct `[{,]\\s*` pattern.');
    }
    console.log('PASS [C1 regression: deployed regex contains real \\s token]');

    // Case 1: solo + root-cause -> PRIMARY = self, SECONDARY = []
    {
        const current = { sys_id: 'alert-1', cmdb_ci: 'ci-A', additional_info: additionalInfo(true, 'evt-1'), initial_remote_time: '2026-09-08 10:00:00', severity: '3' };
        const database = [];
        const result = runScript(deployedScriptText, current, database);
        assertDeepEqual(result, { PRIMARY: ['alert-1'], SECONDARY: [] }, 'solo + root-cause');
    }

    // Case 2: solo + no root-cause signal -> {} (must NOT self-promote; C2 fix, generalized)
    {
        const current = { sys_id: 'alert-2', cmdb_ci: 'ci-A', additional_info: additionalInfo(undefined, 'evt-2'), initial_remote_time: '2026-09-08 10:00:00', severity: '2' };
        const database = [];
        const result = runScript(deployedScriptText, current, database);
        assertDeepEqual(result, {}, 'solo + no root-cause signal (C2 regression: must not self-promote)');
    }

    // Case 3: multi, current is root-cause -> PRIMARY = self, SECONDARY = others
    // (re-parents), even though the other alert has a "worse" i.e. lower
    // severity rank -- root-cause always outranks severity.
    {
        const current = { sys_id: 'alert-3-rootcause', cmdb_ci: 'ci-A', additional_info: additionalInfo(true, 'evt-3'), initial_remote_time: '2026-09-08 10:05:00', severity: '4' };
        const database = [
            { sys_id: 'alert-3-other', cmdb_ci: 'ci-A', additional_info: additionalInfo(undefined, 'evt-3b'), initial_remote_time: '2026-09-08 10:00:00', correlation_rule_group: '1', severity: '1' },
        ];
        const result = runScript(deployedScriptText, current, database);
        assertDeepEqual(result, { PRIMARY: ['alert-3-rootcause'], SECONDARY: ['alert-3-other'] }, 'multi + current is root-cause outranks severity');
    }

    // Case 4: multi, neither alert has a root-cause signal (e.g. both from a
    // non-Dynatrace source) -> ranking falls through to severity alone. The
    // existing other has the worse (lower) severity number, so it stays
    // PRIMARY and currentAlert becomes SECONDARY.
    {
        const current = { sys_id: 'alert-4-supporting', cmdb_ci: 'ci-A', additional_info: additionalInfo(undefined, 'evt-4'), initial_remote_time: '2026-09-08 10:05:00', severity: '3' };
        const database = [
            { sys_id: 'alert-4-worse', cmdb_ci: 'ci-A', additional_info: additionalInfo(undefined, 'evt-4-worse'), initial_remote_time: '2026-09-08 10:00:00', correlation_rule_group: '1', severity: '1' },
        ];
        const result = runScript(deployedScriptText, current, database);
        assertDeepEqual(result, { PRIMARY: ['alert-4-worse'], SECONDARY: ['alert-4-supporting'] }, 'multi + severity-only ranking, existing other stays primary');
    }

    // Case 5: multi, neither alert has a root-cause signal, but currentAlert
    // has the worse (lower) severity number than the existing primary ->
    // currentAlert outranks it on severity alone and becomes the new
    // PRIMARY, re-parenting the previous one. This is the behavior a
    // Dynatrace-only test suite would never exercise, since it never had a
    // non-root-cause severity comparison to make.
    {
        const current = { sys_id: 'alert-5-worse', cmdb_ci: 'ci-A', additional_info: additionalInfo(undefined, 'evt-5'), initial_remote_time: '2026-09-08 10:10:00', severity: '1' };
        const database = [
            { sys_id: 'alert-5-other', cmdb_ci: 'ci-A', additional_info: additionalInfo(undefined, 'evt-5-other'), initial_remote_time: '2026-09-08 10:00:00', correlation_rule_group: '0', severity: '3' },
        ];
        const result = runScript(deployedScriptText, current, database);
        assertDeepEqual(result, { PRIMARY: ['alert-5-worse'], SECONDARY: ['alert-5-other'] }, 'multi + severity-only ranking, currentAlert outranks and re-parents');
    }

    // Case 6: severity=0 (Clear/resolved) must never outrank an active
    // alert on the same CI, even though 0 < any positive severity number
    // numerically -- this is exactly what severityRank()'s normalization to
    // 999 exists to prevent.
    {
        const current = { sys_id: 'alert-6-clear', cmdb_ci: 'ci-A', additional_info: additionalInfo(undefined, 'evt-6'), initial_remote_time: '2026-09-08 10:10:00', severity: '0' };
        const database = [
            { sys_id: 'alert-6-active', cmdb_ci: 'ci-A', additional_info: additionalInfo(undefined, 'evt-6-active'), initial_remote_time: '2026-09-08 10:00:00', correlation_rule_group: '0', severity: '4' },
        ];
        const result = runScript(deployedScriptText, current, database);
        assertDeepEqual(result, { PRIMARY: ['alert-6-active'], SECONDARY: ['alert-6-clear'] }, 'severity=0 (Clear) must not outrank an active alert');
    }

    // Case 7: cross-CI isolation -- the whole point of the generalization.
    // An alert on a DIFFERENT cmdb_ci within the same time window must NOT
    // be treated as "other": currentAlert has no root-cause signal and no
    // other alert on ITS OWN CI, so it must stay ungrouped ({}), not get
    // pulled into a group with an unrelated CI's alert.
    {
        const current = { sys_id: 'alert-7-ci-b', cmdb_ci: 'ci-B', additional_info: additionalInfo(undefined, 'evt-7'), initial_remote_time: '2026-09-08 10:05:00', severity: '2' };
        const database = [
            { sys_id: 'alert-7-ci-a', cmdb_ci: 'ci-A', additional_info: additionalInfo(undefined, 'evt-7-other-ci'), initial_remote_time: '2026-09-08 10:00:00', correlation_rule_group: '0', severity: '1' },
        ];
        const result = runScript(deployedScriptText, current, database);
        assertDeepEqual(result, {}, 'cross-CI isolation: an alert on a different CI must not be grouped in');
    }

    console.log('ALL PASS');
}

try {
    main();
    process.exit(0);
} catch (e) {
    console.error(e.message || String(e));
    process.exit(1);
}
