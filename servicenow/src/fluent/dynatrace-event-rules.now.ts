import { Record } from '@servicenow/sdk/core'

// CI binding rules for Dynatrace-sourced em_event records (Task 9).
//
// Order band 8000-8099 confirmed empty on this instance (highest pre-existing
// active em_match_rule is order 2000, Solarwinds). Lower order runs first in
// ServiceNow Event Management match rule evaluation, so these rules run last,
// after every pre-existing rule (Solarwinds, Splunk, SCOM, Nagios, and the
// disabled v1 Dynatrace rules at order 100-101) has had a chance to match.
// None of those target our events (they gate on `classification=2` for
// metric-style events and on v1-era additional_info keys like `entityType`
// that our pipeline never sets), so running last here is safe.
//
// Field-shape derivation: transformed the "Azure Metrics Virtual Machines"
// rule (sys_id 8cbb229067250300998d35e457415acb) and cross-checked against
// "SCOM Metrics - Windows Server" (identification value "node") and
// "Dynatrace Metrics Service/Application Binding" (existing v1 rule, for
// filter/additional_info_filter shape). See task-9-report.md for the full
// finding: identification_rules[].attributes[].value is a source-attribute
// name resolved against the em_event record - it is looked up as a direct
// em_event column first (e.g. "node") and, if no such column exists, as an
// additional_info JSON key (e.g. Azure's "id", "location", "subscriptionId").
// It is not exclusively one or the other, contrary to the brief's illustrative
// JSON, which is why Ruling 2 required deriving this from a live rule.

// --- Rule 1: sgc_host -----------------------------------------------------
// SGC writes host CI names as the bare Dynatrace host name. Task 9 step 3
// (dynatrace/dql/extract_events.dql) already passes that bare name through
// as dt_ci_name, and the workflow writes dt_ci_name into the em_event `node`
// column (f-ci-name). So identifying by the `node` column directly gives an
// exact-shape match with no extra lookup.
Record({
    $id: Now.ID['dt-bind-sgc-host'],
    table: 'em_match_rule',
    data: {
        name: 'Dynatrace - bind host events to server CI',
        active: true,
        order: 8010,
        table: 'em_event',
        bind: true,
        bind_type: 1,
        transform: true,
        ignore_event: false,
        ci_type: 'cmdb_ci_computer',
        // Scoped on the em_event `type` column, not additional_info.bind_strategy.
        // `type` already carries the literal Dynatrace entity key (dt_entity_key,
        // set by the workflow's f-type field), so "type=host" is an exact, plain
        // encoded-query condition - the same pattern as the confirmed working
        // "Azure WS binding" rule (`type=microsoft.web/sites^...`) and "Nagios -
        // IIS Short Name" (`type=IIS Web Server^...`). The first deploy of this
        // rule used a hand-composed @@EventRule@@_N token over additional_info
        // to scope by bind_strategy; that token format could not be verified
        // against a working example with this exact shape and it matched every
        // Dynatrace event, not just hosts (see task-9-report.md, Defect A).
        filter: 'source=Dynatrace^type=host^EQ',
        simple_filter: JSON.stringify({
            compound_type: 'or',
            subpredicates: [
                {
                    compound_type: 'and',
                    subpredicates: [
                        {
                            field: { name: 'source', value: 'Dynatrace', label: 'source', choices: [] },
                            fieldType: 'string',
                            operator: { name: '=', label: 'is', editor: 'field', advancedEditor: 'string' },
                        },
                        {
                            field: { name: 'type', value: 'host', label: 'type', choices: [] },
                            fieldType: 'string',
                            operator: { name: '=', label: 'is', editor: 'field', advancedEditor: 'string' },
                        },
                    ],
                },
            ],
        }),
        additional_info_filter: JSON.stringify({ conditions: [] }),
        identification_rules: JSON.stringify([
            {
                ciType: 'cmdb_ci_computer',
                attributes: [
                    { attribute: 'name', ciType: 'cmdb_ci_computer', ruleName: 'name', value: 'node' },
                ],
            },
        ]),
    },
})

// --- Rule 2: sgc_service ---------------------------------------------------
// SGC writes calculated-service CI names as "<name> - <id>". dt_ci_name
// composes that shape in the DQL query and is likewise carried into `node`.
Record({
    $id: Now.ID['dt-bind-sgc-service'],
    table: 'em_match_rule',
    data: {
        name: 'Dynatrace - bind service events to calculated service CI',
        active: true,
        order: 8020,
        table: 'em_event',
        bind: true,
        bind_type: 1,
        transform: true,
        ignore_event: false,
        ci_type: 'cmdb_ci_service_calculated',
        // See the host rule above for why this scopes on `type=service` (a
        // direct em_event column, holding dt_entity_key) instead of the
        // additional_info.bind_strategy token scheme from the first deploy.
        filter: 'source=Dynatrace^type=service^EQ',
        simple_filter: JSON.stringify({
            compound_type: 'or',
            subpredicates: [
                {
                    compound_type: 'and',
                    subpredicates: [
                        {
                            field: { name: 'source', value: 'Dynatrace', label: 'source', choices: [] },
                            fieldType: 'string',
                            operator: { name: '=', label: 'is', editor: 'field', advancedEditor: 'string' },
                        },
                        {
                            field: { name: 'type', value: 'service', label: 'type', choices: [] },
                            fieldType: 'string',
                            operator: { name: '=', label: 'is', editor: 'field', advancedEditor: 'string' },
                        },
                    ],
                },
            ],
        }),
        additional_info_filter: JSON.stringify({ conditions: [] }),
        identification_rules: JSON.stringify([
            {
                ciType: 'cmdb_ci_service_calculated',
                attributes: [
                    { attribute: 'name', ciType: 'cmdb_ci_service_calculated', ruleName: 'name', value: 'node' },
                ],
            },
        ]),
    },
})

// --- Rule 3: sgc_process ----------------------------------------------------
// SGC writes process CI names as "<process name>@<host name>". Task 9's DQL
// resolves the parent host via a smartscapeEdges "runs_on" lookup (see
// task-9-report.md, fix round 2 - the initial getNodeField(id, "runsOn")
// traversal returned null because the edge type is snake_case "runs_on", not
// "runsOn") and composes dt_ci_name accordingly. `process` is the
// highest-volume Dynatrace entity type in the tenant (13,596 events/24h).
Record({
    $id: Now.ID['dt-bind-sgc-process'],
    table: 'em_match_rule',
    data: {
        name: 'Dynatrace - bind process events to application CI',
        active: true,
        order: 8030,
        table: 'em_event',
        bind: true,
        bind_type: 1,
        transform: true,
        ignore_event: false,
        ci_type: 'cmdb_ci_appl',
        // See the host rule above for why this scopes on `type=process` (a
        // direct em_event column, holding dt_entity_key).
        filter: 'source=Dynatrace^type=process^EQ',
        simple_filter: JSON.stringify({
            compound_type: 'or',
            subpredicates: [
                {
                    compound_type: 'and',
                    subpredicates: [
                        {
                            field: { name: 'source', value: 'Dynatrace', label: 'source', choices: [] },
                            fieldType: 'string',
                            operator: { name: '=', label: 'is', editor: 'field', advancedEditor: 'string' },
                        },
                        {
                            field: { name: 'type', value: 'process', label: 'type', choices: [] },
                            fieldType: 'string',
                            operator: { name: '=', label: 'is', editor: 'field', advancedEditor: 'string' },
                        },
                    ],
                },
            ],
        }),
        additional_info_filter: JSON.stringify({ conditions: [] }),
        identification_rules: JSON.stringify([
            {
                ciType: 'cmdb_ci_appl',
                attributes: [
                    { attribute: 'name', ciType: 'cmdb_ci_appl', ruleName: 'name', value: 'node' },
                ],
            },
        ]),
    },
})

// --- Rule 4: ire_correlated catch-all --------------------------------------
// Every remaining non-SGC entity type (roughly 550 of the 553 mapped keys)
// sets bind_strategy to ire_correlated. Match by correlation_id against
// dt_entity_id, the Davis smartscape entity ID carried in additional_info.
// This rule intentionally has no bind_strategy condition of its own - it is
// the last rule in the band (order 8090) and only ever sees events the three
// rules above did not already claim.
//
// KNOWN LIMITATION (fix round 2 finding, out of scope to fix): correlation_id
// is empty on every SGC-created CI in this CMDB. Any Dynatrace entity type
// whose target CMDB class is SGC-managed but mapped to ire_correlated (rather
// than one of the three named-match strategies above) can never bind via this
// rule, because the identification attribute it matches on is always empty on
// the CI side. Writing correlation_id into CMDB was explicitly out of scope
// for this task. ire_correlated bind rates should be read as a floor, not a
// true measure of CMDB coverage, until that gap is addressed elsewhere.
Record({
    $id: Now.ID['dt-bind-ire-correlated'],
    table: 'em_match_rule',
    data: {
        name: 'Dynatrace - bind remaining entity types via correlation id',
        active: true,
        order: 8090,
        table: 'em_event',
        bind: true,
        bind_type: 1,
        transform: true,
        ignore_event: false,
        ci_type: 'cmdb_ci',
        filter: 'source=Dynatrace^EQ',
        simple_filter: JSON.stringify({
            compound_type: 'or',
            subpredicates: [
                {
                    compound_type: 'and',
                    subpredicates: [
                        {
                            field: { name: 'source', value: 'Dynatrace', label: 'source', choices: [] },
                            fieldType: 'string',
                            operator: { name: '=', label: 'is', editor: 'field', advancedEditor: 'string' },
                        },
                    ],
                },
            ],
        }),
        additional_info_filter: JSON.stringify({ conditions: [] }),
        identification_rules: JSON.stringify([
            {
                ciType: 'cmdb_ci',
                attributes: [
                    { attribute: 'correlation_id', ciType: 'cmdb_ci', ruleName: 'correlation_id', value: 'dt_entity_id' },
                ],
            },
        ]),
    },
})
