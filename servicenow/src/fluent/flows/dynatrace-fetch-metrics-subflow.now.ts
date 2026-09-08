import { Subflow, wfa, action } from '@servicenow/sdk/automation'
import { StringColumn, ReferenceColumn } from '@servicenow/sdk/core'

// Task 13, action 3: "fetch related metrics."
//
// Sibling of ./dynatrace-fetch-logs-subflow.now.ts -- see that file's header
// comment for the shared assumptions (SGO-Dynatrace action reuse, the
// em_alert_management_rule input contract, the additional_info string
// format, and the credential dependency this cannot be verified against
// this session). This file only documents what's different for the metrics
// query itself.
const DYNATRACE_SAAS_ACTION = '853ef513ff433210aedbffffffffffb7' // "Fetch Dynatrace SaaS Data"
const DYNATRACE_SAAS_POLL_ACTION = '9c7b508bff0607106e5dffffffffff9d' // "Poll Dynatrace SaaS Query Results"

// Must match the sys_alias name the user creates per docs/USER-SETUP.md step 3.
const CONNECTION_ALIAS_NAME = 'Dynatrace DQL Read-Only'

export const dtFetchMetricsSubflow = Subflow(
    {
        $id: Now.ID['dt-fetch-metrics-subflow'],
        name: 'Dynatrace - fetch related metrics for alert entity',
        description:
            'Runs a DQL timeseries query for the entity bound to the triggering Dynatrace alert over the 30 minutes around it, and writes the result to the alert work notes. Requires the read-only Dynatrace API credential and connection alias from docs/USER-SETUP.md.',
        runAs: 'system',
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
        wfa.flowLogic.setFlowVariables(
            { $id: Now.ID['dt-fetch-metrics-set-entity-id'] },
            params.flowVariables,
            {
                // See ../flows/dynatrace-fetch-logs-subflow.now.ts for why this
                // embeds the input as a data pill rather than referencing
                // `fd_data.inputs.*` directly.
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
            { $id: Now.ID['dt-fetch-metrics-lookup-alias'] },
            {
                table: 'sys_alias',
                conditions: `name=${CONNECTION_ALIAS_NAME}`,
            }
        )

        // NOTE: there is no single metric key that applies to every Dynatrace
        // entity type (a host's relevant metric is not a service's or a
        // process's). This query is a representative default -- it is NOT
        // guaranteed to return data for every entity class the alert could be
        // bound to (Task 9's per-class CI binding covers hosts, services,
        // processes, k8s workloads, and more). Tune the metric selector to the
        // entity classes this instance actually alerts on once real DQL access
        // is available to iterate against (docs/USER-SETUP.md steps 1-3).
        //
        // Input/output keys (connectionalias, timeframestart, timeframeend,
        // query, segmentid, requesttoken) are each action's
        // `sys_hub_action_input.element` -- see
        // ../flows/dynatrace-fetch-logs-subflow.now.ts header comment for how
        // that was confirmed (the camelCase `label` is NOT the binding key).
        const fetchMetrics = wfa.action(
            DYNATRACE_SAAS_ACTION,
            {
                $id: Now.ID['dt-fetch-metrics-call'],
                annotation: 'Execute DQL timeseries query via the Dynatrace SaaS connection',
            },
            {
                connectionalias: wfa.dataPill(fetchAliasLookup.Record, 'reference'),
                timeframestart: '-15m',
                timeframeend: '+15m',
                query: wfa.inlineScript(`
                    var entityId = ${wfa.dataPill(params.flowVariables.entityId, 'string')} || '';
                    return 'timeseries avg(dt.host.cpu.usage), filter: matchesValue(dt.entity.*, "' + entityId + '"), from:-15m, to:+15m';
                `),
                segmentid: '',
            }
        )

        // Separate lookup (rather than reusing fetchAliasLookup.Record) --
        // see ../flows/dynatrace-fetch-logs-subflow.now.ts for why the poll
        // action gets its own single-use alias lookup.
        const pollAliasLookup = wfa.action(
            action.core.lookUpRecord,
            { $id: Now.ID['dt-fetch-metrics-lookup-alias-poll'] },
            {
                table: 'sys_alias',
                conditions: `name=${CONNECTION_ALIAS_NAME}`,
            }
        )

        const pollMetrics = wfa.action(
            DYNATRACE_SAAS_POLL_ACTION,
            {
                $id: Now.ID['dt-fetch-metrics-poll'],
                annotation: 'Poll for the async DQL result',
            },
            {
                connectionalias: wfa.dataPill(pollAliasLookup.Record, 'reference'),
                requesttoken: wfa.inlineScript(`
                    var body = ${wfa.dataPill(fetchMetrics.responseBody, 'string')};
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
            { $id: Now.ID['dt-fetch-metrics-write-worknotes'] },
            {
                table_name: 'em_alert',
                record: wfa.dataPill(params.inputs.alertGR, 'reference'),
                values: TemplateValue({
                    work_notes: wfa.inlineScript(`
                        var body = ${wfa.dataPill(pollMetrics.responseBody, 'string')};
                        return 'Dynatrace metrics (+/-15m around alert):\\n' + body;
                    `),
                }),
            }
        )
    }
)
