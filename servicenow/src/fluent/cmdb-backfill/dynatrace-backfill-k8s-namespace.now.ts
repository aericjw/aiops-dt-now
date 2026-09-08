import { Record } from '@servicenow/sdk/core'

// Task 9b backfill: simulated k8s_namespace CMDB CIs, generated from live Dynatrace
// topology (dt.davis.events, from:-24h, top 20 most-frequent, see task-9b-report.md
// Step 1) so names match byte-for-byte against dt_ci_name/dt_entity_name. Every
// record is tagged discovery_source=SIM-Dynatrace-Test for identification and
// later neutralization (scripts/neutralize-cmdb-backfill.sh) - CMDB CI records
// cannot be physically deleted on this PDI (see task-9b-report.md Step 2).

Record({
    $id: Now.ID['dt-backfill-k8s-namespace-01'],
    table: 'cmdb_ci_kubernetes_namespace',
    data: {
        name: 'ZZ-RETIRED-bindplane-agent',
        discovery_source: 'SIM-Dynatrace-Test',
    },
})

Record({
    $id: Now.ID['dt-backfill-k8s-namespace-02'],
    table: 'cmdb_ci_kubernetes_namespace',
    data: {
        name: 'ZZ-RETIRED-dynatrace',
        discovery_source: 'SIM-Dynatrace-Test',
    },
})

Record({
    $id: Now.ID['dt-backfill-k8s-namespace-03'],
    table: 'cmdb_ci_kubernetes_namespace',
    data: {
        name: 'ZZ-RETIRED-easytrade',
        discovery_source: 'SIM-Dynatrace-Test',
    },
})

Record({
    $id: Now.ID['dt-backfill-k8s-namespace-04'],
    table: 'cmdb_ci_kubernetes_namespace',
    data: {
        name: 'ZZ-RETIRED-astroshop',
        discovery_source: 'SIM-Dynatrace-Test',
    },
})

Record({
    $id: Now.ID['dt-backfill-k8s-namespace-05'],
    table: 'cmdb_ci_kubernetes_namespace',
    data: {
        name: 'ZZ-RETIRED-kube-system',
        discovery_source: 'SIM-Dynatrace-Test',
    },
})

