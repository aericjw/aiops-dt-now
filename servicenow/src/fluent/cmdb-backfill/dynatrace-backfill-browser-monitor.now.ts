import { Record } from '@servicenow/sdk/core'

// Task 9b backfill: simulated browser_monitor CMDB CIs, generated from live Dynatrace
// topology (dt.davis.events, from:-24h, top 20 most-frequent, see task-9b-report.md
// Step 1) so names match byte-for-byte against dt_ci_name/dt_entity_name. Every
// record is tagged discovery_source=SIM-Dynatrace-Test for identification and
// later neutralization (scripts/neutralize-cmdb-backfill.sh) - CMDB CI records
// cannot be physically deleted on this PDI (see task-9b-report.md Step 2).

Record({
    $id: Now.ID['dt-backfill-browser-monitor-01'],
    table: 'cmdb_ci',
    data: {
        name: 'ZZ-RETIRED-PLOOMES',
        discovery_source: 'SIM-Dynatrace-Test',
    },
})

