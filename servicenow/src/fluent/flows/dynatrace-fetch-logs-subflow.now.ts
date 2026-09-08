import { Subflow, wfa, action } from '@servicenow/sdk/automation'
import { StringColumn, ReferenceColumn } from '@servicenow/sdk/core'

// Task 13, action 2: "fetch logs for this entity."
//
// Invoked as an em_alert_man_m2m_rule_flow child action of the
// "Dynatrace - operator telemetry actions" rule (see
// ../alert-actions/dynatrace-telemetry.now.ts). Cannot be functionally
// verified this session -- it depends on the read-only Dynatrace API
// credential and connection alias that docs/USER-SETUP.md asks the user to
// create (spec section 13 explicitly reserves that credential for the user).
// See task-13-report.md for the full list of assumptions this file makes
// that could not be confirmed against a live run.

// "Fetch Dynatrace SaaS Data" / "Poll Dynatrace SaaS Query Results" --
// pre-existing SGO-Dynatrace integration action types, live on this instance
// (verified via `sys_hub_action_type_definition` / `sys_hub_action_input` /
// `sys_hub_action_output` queries against tacocorp+pdi). They already wrap
// the Dynatrace Grail DQL execute+poll cycle behind a `connectionAlias`
// (reference to sys_alias) input, which is exactly the mechanism
// docs/USER-SETUP.md step 3 asks the user to set up -- reusing them avoids
// hand-rolling REST + polling logic blind. Called by sys_id fallback because
// they aren't bundled as typed `action.core.*` definitions in this SDK.
//
// Input/output keys (connectionalias, timeframestart, timeframeend, query,
// segmentid, requesttoken, responseBody) are each action's
// `sys_hub_action_input.element` / `sys_hub_action_output.element` -- the
// real programmatic key, confirmed by reading full `sys_hub_action_input`
// records (not just the camelCase `label`, which turned out NOT to be the
// binding key: a first deploy attempt using camelCase `connectionAlias`
// left the poll action's `connectionalias` input unfilled at publish
// validation -- "connectionAlias on action number 3 is mandatory and must
// be filled in" -- while the identically-cased key happened to work on the
// first action of the same name, which is what exposed the mismatch).
const DYNATRACE_SAAS_ACTION = '853ef513ff433210aedbffffffffffb7' // "Fetch Dynatrace SaaS Data"
const DYNATRACE_SAAS_POLL_ACTION = '9c7b508bff0607106e5dffffffffff9d' // "Poll Dynatrace SaaS Query Results"

// Must match the sys_alias name the user creates per docs/USER-SETUP.md step 3.
const CONNECTION_ALIAS_NAME = 'Dynatrace DQL Read-Only'

export const dtFetchLogsSubflow = Subflow(
    {
        $id: Now.ID['dt-fetch-logs-subflow'],
        name: 'Dynatrace - fetch logs for alert entity',
        description:
            'Runs a DQL logs query scoped to the entity bound to the triggering Dynatrace alert, and writes the result to the alert work notes. Requires the read-only Dynatrace API credential and connection alias from docs/USER-SETUP.md.',
        runAs: 'system',
        // Input contract copied verbatim from the live OOB "SGO-Dynatrace Alert
        // Subflow" (sys_hub_flow 21b17cce07032010b1306a77c4a93506) -- confirmed
        // via a `sys_hub_flow_input` query that em_alert_management_rule /
        // em_alert_man_m2m_rule_flow invocation passes exactly these six named
        // inputs. `alertGR` (reference to em_alert) is the only mandatory field
        // and is the sole handle back to the triggering alert -- a differently
        // named input here would never be populated by the platform.
        inputs: {
            alertRuleName: StringColumn({ label: 'alertRuleName', mandatory: true }),
            alertRuleId: StringColumn({ label: 'alertRuleId', mandatory: true }),
            alertGR: ReferenceColumn({ label: 'alertGR', referenceTable: 'em_alert', mandatory: true }),
            executionId: StringColumn({ label: 'executionId' }),
            userName: StringColumn({ label: 'userName' }),
            userDisplayName: StringColumn({ label: 'userDisplayName' }),
        },
        flowVariables: {
            entityId: StringColumn({ label: 'Entity ID' }),
        },
    },
    (params) => {
        // additional_info is NOT valid JSON -- it's a Groovy/Java map
        // toString() embedded as a string value inside a JSON wrapper (verified
        // against live tacocorp alert records, e.g. Alert0012240:
        // '{"additional_content" : "{event.id=..., dt_entity_id=null, ...}"}').
        // No parse-JSON transform is available in this SDK's flow API, so
        // extraction is a regex against the raw field value inside an inline
        // script -- the documented mechanism (`wfa.inlineScript`) for custom
        // per-record logic that the typed action/flow-logic catalog can't
        // express.
        wfa.flowLogic.setFlowVariables(
            { $id: Now.ID['dt-fetch-logs-set-entity-id'] },
            params.flowVariables,
            {
                // `fd_data.inputs.*` is not a valid script reference (confirmed
                // by a deploy attempt that failed with "Unsupported reference:
                // inputs" against tacocorp+pdi) -- referencing the input's
                // dot-walked field as a normal data pill embedded in the script
                // string, the same way prior-step outputs are referenced below,
                // is the pattern that actually deploys.
                entityId: wfa.inlineScript(`
                    var info = ${wfa.dataPill((params.inputs.alertGR as any).additional_info, 'string')} || '';
                    var m = /dt_entity_id=([^,}]*)/.exec(info);
                    var val = m ? m[1] : '';
                    return (val && val !== 'null') ? val : '';
                `),
            }
        )

        const fetchAliasLookup = wfa.action(
            action.core.lookUpRecord,
            { $id: Now.ID['dt-fetch-logs-lookup-alias'] },
            {
                table: 'sys_alias',
                conditions: `name=${CONNECTION_ALIAS_NAME}`,
            }
        )

        const fetchLogs = wfa.action(
            DYNATRACE_SAAS_ACTION,
            {
                $id: Now.ID['dt-fetch-logs-call'],
                annotation: 'Execute DQL logs query via the Dynatrace SaaS connection',
            },
            {
                connectionalias: wfa.dataPill(fetchAliasLookup.Record, 'reference'),
                timeframestart: '-30m',
                timeframeend: 'now',
                // Query verified with `dtctl verify query '<dql>' --plain`
                // against tacocorp (see task-13-report.md). The brief's literal
                // template used `dt.entity.*`, which fails verification --
                // PARSE_ERROR, `,` isn't allowed here -- because a bare
                // wildcard field is not valid inside `matchesValue()` (only
                // valid in `by:` grouping contexts). `dt.entity.*` is also
                // deprecated in favor of `dt.smartscape.*`, but neither
                // resolves this specific problem: there is no single
                // type-agnostic wildcard entity field usable as a filter
                // argument, and the alert's bound entity can be any of the
                // ~100+ classes in mapping/dt_to_snow_cmdb_mapping.csv (not
                // just host/service/process). `dt.smartscape_source.id` is
                // the type-agnostic identifier field this task already
                // extracts dt_entity_id FROM in the ingestion workflow
                // (dt-problems-to-snow-itom.yaml: `dt_entity_id =
                // toString(dt.smartscape_source.id)`) -- using the same field
                // name here keeps both sides of the comparison symmetric, and
                // it verified successfully.
                query: wfa.inlineScript(`
                    var entityId = ${wfa.dataPill(params.flowVariables.entityId, 'string')} || '';
                    return 'fetch logs, from:-30m | filter matchesValue(dt.smartscape_source.id, "' + entityId + '") | limit 100';
                `),
                segmentid: '',
            }
        )

        // Separate lookup (rather than reusing fetchAliasLookup.Record) so the
        // poll action's connectionalias data pill has its own single-use
        // source step -- the deploy failure above only affected the second
        // reuse of a lookup result, so this also removes that variable.
        const pollAliasLookup = wfa.action(
            action.core.lookUpRecord,
            { $id: Now.ID['dt-fetch-logs-lookup-alias-poll'] },
            {
                table: 'sys_alias',
                conditions: `name=${CONNECTION_ALIAS_NAME}`,
            }
        )

        const pollLogs = wfa.action(
            DYNATRACE_SAAS_POLL_ACTION,
            {
                $id: Now.ID['dt-fetch-logs-poll'],
                annotation: 'Poll for the async DQL result',
            },
            {
                connectionalias: wfa.dataPill(pollAliasLookup.Record, 'reference'),
                requesttoken: wfa.inlineScript(`
                    var body = ${wfa.dataPill(fetchLogs.responseBody, 'string')};
                    try {
                        return JSON.parse(body).requestToken || '';
                    } catch (e) {
                        return '';
                    }
                `),
            }
        )

        wfa.action(
            action.core.updateRecord,
            { $id: Now.ID['dt-fetch-logs-write-worknotes'] },
            {
                table_name: 'em_alert',
                record: wfa.dataPill(params.inputs.alertGR, 'reference'),
                values: TemplateValue({
                    work_notes: wfa.inlineScript(`
                        var body = ${wfa.dataPill(pollLogs.responseBody, 'string')};
                        return 'Dynatrace logs (last 30m):\\n' + body;
                    `),
                }),
            }
        )
    }
)
