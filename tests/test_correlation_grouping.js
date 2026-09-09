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
// How this test works: it does NOT re-implement or hand-copy the script's
// logic. It extracts the literal `script: `...`` template-literal text
// straight out of the .now.ts SOURCE FILE and hands it to Node's own parser
// (by writing it into a small generated .js file and require()-ing it) --
// the same JS/TS grammar the real @servicenow/sdk build uses -- so template
// literal escape collapsing (the exact class of bug in C1) is reproduced
// faithfully rather than re-guessed. The resulting function is then run
// against stub GlideRecord/GlideDateTime objects seeded with a real captured
// payload shape (see FIXTURE_PROBLEM_ID below, from the reviewer's live
// P-26091518 example) and checked against the four PRIMARY/SECONDARY cases.
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

// ---- Fixture data, from the reviewer's live captured payload shape --------
// (real example: {event.id=..., dt_problem_display_id=P-26091518,
//  dt.davis.is_rootcause_relevant=true})

function additionalInfo(problemId, isRootCause, eventId) {
    const content = `event.id=${eventId}, dt_problem_display_id=${problemId}, dt.davis.is_rootcause_relevant=${isRootCause}`;
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
        const current = { sys_id: 'alert-1', additional_info: additionalInfo('P-26091518', true, 'evt-1'), initial_remote_time: '2026-09-08 10:00:00' };
        const database = [];
        const result = runScript(deployedScriptText, current, database);
        assertDeepEqual(result, { PRIMARY: ['alert-1'], SECONDARY: [] }, 'solo + root-cause');
    }

    // Case 2: solo + not-root-cause -> {} (must NOT self-promote; this is the C2 fix)
    {
        const current = { sys_id: 'alert-2', additional_info: additionalInfo('P-26091519', false, 'evt-2'), initial_remote_time: '2026-09-08 10:00:00' };
        const database = [];
        const result = runScript(deployedScriptText, current, database);
        assertDeepEqual(result, {}, 'solo + not-root-cause (C2 regression: must not self-promote)');
    }

    // Case 3: multi + root-cause -> PRIMARY = self, SECONDARY = others (re-parents)
    {
        const current = { sys_id: 'alert-3-rootcause', additional_info: additionalInfo('P-26091520', true, 'evt-3'), initial_remote_time: '2026-09-08 10:05:00' };
        const database = [
            { sys_id: 'alert-3-other', additional_info: additionalInfo('P-26091520', false, 'evt-3b'), initial_remote_time: '2026-09-08 10:00:00', correlation_rule_group: '1' },
        ];
        const result = runScript(deployedScriptText, current, database);
        assertDeepEqual(result, { PRIMARY: ['alert-3-rootcause'], SECONDARY: ['alert-3-other'] }, 'multi + root-cause');
    }

    // Case 4a: multi + not-root-cause, existing root-cause other present ->
    // PRIMARY = that existing root-cause alert, SECONDARY = [self]
    {
        const current = { sys_id: 'alert-4a-supporting', additional_info: additionalInfo('P-26091521', false, 'evt-4a'), initial_remote_time: '2026-09-08 10:05:00' };
        const database = [
            { sys_id: 'alert-4a-rootcause', additional_info: additionalInfo('P-26091521', true, 'evt-4a-rc'), initial_remote_time: '2026-09-08 10:00:00', correlation_rule_group: '1' },
        ];
        const result = runScript(deployedScriptText, current, database);
        assertDeepEqual(result, { PRIMARY: ['alert-4a-rootcause'], SECONDARY: ['alert-4a-supporting'] }, 'multi + not-root-cause (existing root-cause other)');
    }

    // Case 4b: multi + not-root-cause, NO root-cause other seen yet -> fallback
    // to earliest-arrived other as provisional PRIMARY (will be re-parented
    // later when the true root-cause alert arrives).
    {
        const current = { sys_id: 'alert-4b-supporting-2', additional_info: additionalInfo('P-26091522', false, 'evt-4b'), initial_remote_time: '2026-09-08 10:10:00' };
        const database = [
            { sys_id: 'alert-4b-supporting-1', additional_info: additionalInfo('P-26091522', false, 'evt-4b-early'), initial_remote_time: '2026-09-08 10:00:00', correlation_rule_group: '0' },
        ];
        const result = runScript(deployedScriptText, current, database);
        assertDeepEqual(result, { PRIMARY: ['alert-4b-supporting-1'], SECONDARY: ['alert-4b-supporting-2'] }, 'multi + not-root-cause (fallback to earliest, no root-cause other yet)');
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
