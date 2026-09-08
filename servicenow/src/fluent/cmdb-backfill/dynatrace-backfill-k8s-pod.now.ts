import { Record } from '@servicenow/sdk/core'

// Task 9b backfill: simulated k8s_pod CMDB CIs, generated from live Dynatrace
// topology (dt.davis.events, from:-24h, top 20 most-frequent, see task-9b-report.md
// Step 1) so names match byte-for-byte against dt_ci_name/dt_entity_name. Every
// record is tagged discovery_source=SIM-Dynatrace-Test for identification and
// later neutralization (scripts/neutralize-cmdb-backfill.sh) - CMDB CI records
// cannot be physically deleted on this PDI (see task-9b-report.md Step 2).

Record({
    $id: Now.ID['dt-backfill-k8s-pod-01'],
    table: 'cmdb_ci_kubernetes_pod',
    data: {
        name: 'opentelemetry-demo-prometheus-server-c69db89d4-fw5qk',
        discovery_source: 'SIM-Dynatrace-Test',
    },
})

Record({
    $id: Now.ID['dt-backfill-k8s-pod-02'],
    table: 'cmdb_ci_kubernetes_pod',
    data: {
        name: 'opentelemetry-demo-flagd-5d67ccf97-49dpz',
        discovery_source: 'SIM-Dynatrace-Test',
    },
})

Record({
    $id: Now.ID['dt-backfill-k8s-pod-03'],
    table: 'cmdb_ci_kubernetes_pod',
    data: {
        name: 'opentelemetry-demo-cartservice-84b6999749-j5sdc',
        discovery_source: 'SIM-Dynatrace-Test',
    },
})

Record({
    $id: Now.ID['dt-backfill-k8s-pod-04'],
    table: 'cmdb_ci_kubernetes_pod',
    data: {
        name: 'opentelemetry-demo-adservice-796f594686-297qc',
        discovery_source: 'SIM-Dynatrace-Test',
    },
})

Record({
    $id: Now.ID['dt-backfill-k8s-pod-05'],
    table: 'cmdb_ci_kubernetes_pod',
    data: {
        name: 'opentelemetry-demo-frauddetectionservice-768b65b4cf-z6cbb',
        discovery_source: 'SIM-Dynatrace-Test',
    },
})

Record({
    $id: Now.ID['dt-backfill-k8s-pod-06'],
    table: 'cmdb_ci_kubernetes_pod',
    data: {
        name: 'opentelemetry-demo-kafka-6f766f584b-5tgg5',
        discovery_source: 'SIM-Dynatrace-Test',
    },
})

Record({
    $id: Now.ID['dt-backfill-k8s-pod-07'],
    table: 'cmdb_ci_kubernetes_pod',
    data: {
        name: 'opentelemetry-demo-accountingservice-6c7bc84587-h887l',
        discovery_source: 'SIM-Dynatrace-Test',
    },
})

Record({
    $id: Now.ID['dt-backfill-k8s-pod-08'],
    table: 'cmdb_ci_kubernetes_pod',
    data: {
        name: 'load-generator-5ff8dd49d7-776t6',
        discovery_source: 'SIM-Dynatrace-Test',
    },
})

Record({
    $id: Now.ID['dt-backfill-k8s-pod-09'],
    table: 'cmdb_ci_kubernetes_pod',
    data: {
        name: 'bindplane-gateway-agent-7f8cfb858b-7fnfm',
        discovery_source: 'SIM-Dynatrace-Test',
    },
})

Record({
    $id: Now.ID['dt-backfill-k8s-pod-10'],
    table: 'cmdb_ci_kubernetes_pod',
    data: {
        name: 'bindplane-gateway-agent-7f8cfb858b-8zjvn',
        discovery_source: 'SIM-Dynatrace-Test',
    },
})

Record({
    $id: Now.ID['dt-backfill-k8s-pod-11'],
    table: 'cmdb_ci_kubernetes_pod',
    data: {
        name: 'bindplane-gateway-agent-7f8cfb858b-bf27z',
        discovery_source: 'SIM-Dynatrace-Test',
    },
})

Record({
    $id: Now.ID['dt-backfill-k8s-pod-12'],
    table: 'cmdb_ci_kubernetes_pod',
    data: {
        name: 'bindplane-gateway-agent-7f8cfb858b-wxpqq',
        discovery_source: 'SIM-Dynatrace-Test',
    },
})

Record({
    $id: Now.ID['dt-backfill-k8s-pod-13'],
    table: 'cmdb_ci_kubernetes_pod',
    data: {
        name: 'bindplane-gateway-agent-7f8cfb858b-b5z6q',
        discovery_source: 'SIM-Dynatrace-Test',
    },
})

Record({
    $id: Now.ID['dt-backfill-k8s-pod-14'],
    table: 'cmdb_ci_kubernetes_pod',
    data: {
        name: 'accounting-8555fc45dc-qzwvm',
        discovery_source: 'SIM-Dynatrace-Test',
    },
})

Record({
    $id: Now.ID['dt-backfill-k8s-pod-15'],
    table: 'cmdb_ci_kubernetes_pod',
    data: {
        name: 'bindplane-gateway-agent-7f8cfb858b-vtw6q',
        discovery_source: 'SIM-Dynatrace-Test',
    },
})

Record({
    $id: Now.ID['dt-backfill-k8s-pod-16'],
    table: 'cmdb_ci_kubernetes_pod',
    data: {
        name: 'bindplane-gateway-agent-7f8cfb858b-6b7gj',
        discovery_source: 'SIM-Dynatrace-Test',
    },
})

Record({
    $id: Now.ID['dt-backfill-k8s-pod-17'],
    table: 'cmdb_ci_kubernetes_pod',
    data: {
        name: 'astroshop-emailservice-84b7b8ccfb-vtw8w',
        discovery_source: 'SIM-Dynatrace-Test',
    },
})

Record({
    $id: Now.ID['dt-backfill-k8s-pod-18'],
    table: 'cmdb_ci_kubernetes_pod',
    data: {
        name: 'bindplane-gateway-agent-7f8cfb858b-wgn8f',
        discovery_source: 'SIM-Dynatrace-Test',
    },
})

Record({
    $id: Now.ID['dt-backfill-k8s-pod-19'],
    table: 'cmdb_ci_kubernetes_pod',
    data: {
        name: 'opentelemetry-demo-frontend-586f54d966-jmlvk',
        discovery_source: 'SIM-Dynatrace-Test',
    },
})

Record({
    $id: Now.ID['dt-backfill-k8s-pod-20'],
    table: 'cmdb_ci_kubernetes_pod',
    data: {
        name: 'metrics-server-v1.35.1-5bcff44f45-22tr4',
        discovery_source: 'SIM-Dynatrace-Test',
    },
})

