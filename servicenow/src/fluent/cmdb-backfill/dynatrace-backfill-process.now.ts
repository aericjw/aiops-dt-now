import { Record } from '@servicenow/sdk/core'

// Task 9b backfill: simulated process CMDB CIs, generated from live Dynatrace
// topology (dt.davis.events, from:-24h, top 20 most-frequent, see task-9b-report.md
// Step 1) so names match byte-for-byte against dt_ci_name/dt_entity_name. Every
// record is tagged discovery_source=SIM-Dynatrace-Test for identification and
// later neutralization (scripts/neutralize-cmdb-backfill.sh) - CMDB CI records
// cannot be physically deleted on this PDI (see task-9b-report.md Step 2).

Record({
    $id: Now.ID['dt-backfill-process-01'],
    table: 'cmdb_ci_appl',
    data: {
        name: 'ZZ-RETIRED-Accounting.dll accounting-*@aks-agentpool-21707267-vmss00000l',
        discovery_source: 'SIM-Dynatrace-Test',
    },
})

Record({
    $id: Now.ID['dt-backfill-process-02'],
    table: 'cmdb_ci_appl',
    data: {
        name: 'ZZ-RETIRED-AccountingService.dll opentelemetry-demo-accountingservice-*@gke-salsa-cluster-basic-salsa-pool-092fc55d-j1ga',
        discovery_source: 'SIM-Dynatrace-Test',
    },
})

Record({
    $id: Now.ID['dt-backfill-process-03'],
    table: 'cmdb_ci_appl',
    data: {
        name: 'ZZ-RETIRED-bin/npm-cli.js (npm) opentelemetry-demo-flagd-*@gke-salsa-cluster-basic-salsa-pool-092fc55d-j1ga',
        discovery_source: 'SIM-Dynatrace-Test',
    },
})

Record({
    $id: Now.ID['dt-backfill-process-04'],
    table: 'cmdb_ci_appl',
    data: {
        name: 'ZZ-RETIRED-chrome@ace-box-hfvm',
        discovery_source: 'SIM-Dynatrace-Test',
    },
})

Record({
    $id: Now.ID['dt-backfill-process-05'],
    table: 'cmdb_ci_appl',
    data: {
        name: 'ZZ-RETIRED-chromium load-generator-5ff8dd49d7-776t6@aks-agentpool2-18907389-vmss000000',
        discovery_source: 'SIM-Dynatrace-Test',
    },
})

Record({
    $id: Now.ID['dt-backfill-process-06'],
    table: 'cmdb_ci_appl',
    data: {
        name: 'ZZ-RETIRED-curl@aks-agentpool-21707267-vmss00000n',
        discovery_source: 'SIM-Dynatrace-Test',
    },
})

Record({
    $id: Now.ID['dt-backfill-process-07'],
    table: 'cmdb_ci_appl',
    data: {
        name: 'ZZ-RETIRED-edgedelta edgedelta@aks-agentpool-21707267-vmss00000k',
        discovery_source: 'SIM-Dynatrace-Test',
    },
})

Record({
    $id: Now.ID['dt-backfill-process-08'],
    table: 'cmdb_ci_appl',
    data: {
        name: 'ZZ-RETIRED-ig@aks-agentpool-21707267-vmss00000o',
        discovery_source: 'SIM-Dynatrace-Test',
    },
})

Record({
    $id: Now.ID['dt-backfill-process-09'],
    table: 'cmdb_ci_appl',
    data: {
        name: 'ZZ-RETIRED-npd-log-counter@aks-agentpool-21707267-vmss00000o',
        discovery_source: 'SIM-Dynatrace-Test',
    },
})

Record({
    $id: Now.ID['dt-backfill-process-10'],
    table: 'cmdb_ci_appl',
    data: {
        name: 'ZZ-RETIRED-prometheus opentelemetry-demo-prometheus-server-*@gke-salsa-cluster-basic-salsa-pool-86abe6ed-eva7',
        discovery_source: 'SIM-Dynatrace-Test',
    },
})

Record({
    $id: Now.ID['dt-backfill-process-11'],
    table: 'cmdb_ci_appl',
    data: {
        name: 'ZZ-RETIRED-prometheus prometheus-*@aks-agentpool-21707267-vmss00000o',
        discovery_source: 'SIM-Dynatrace-Test',
    },
})

Record({
    $id: Now.ID['dt-backfill-process-12'],
    table: 'cmdb_ci_appl',
    data: {
        name: 'ZZ-RETIRED-rails-dependencies gitlab-sidekiq-all-in-*-v*-*@ace-box-hfvm',
        discovery_source: 'SIM-Dynatrace-Test',
    },
})

