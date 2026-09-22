import { Record } from '@servicenow/sdk/core'

// Test-only backfill (2026-09-16): simulated cmdb_ci_db_mssql_instance CI for
// easytrade's SQL Server pod, so the ire_correlated catch-all rule
// (dynatrace-event-rules.now.ts, dt-bind-ire-correlated) has a name-matching
// CI to bind against. Name matches dt_ci_name/dt_entity_name byte-for-byte:
// "MSSQLSERVER@easytrade-db-0", derived from a real Davis problem
// (P-26093025, "Blocked Proccess on MSSQLSERVER@easytrade-db-0") raised by a
// custom-configured anomaly detector, and confirmed live via em_event's own
// processing_notes: "Binding Failure Reason: Failed to find the host with
// name: MSSQLSERVER@easytrade-db-0" -- this record exists to remove exactly
// that failure reason, same pattern as Task 9b's dt-backfill-frontend-01.
//
// --- dt-backfill-db-mssql-01 superseded (2026-09-16) -----------------------
// The first attempt at this record only set `name` and `discovery_source`,
// same shape as the Task 9b frontend backfill. A fresh blocking-process test
// against this exact name still failed to bind ("Binding Failure Reason:
// Failed to find the host with name: MSSQLSERVER@easytrade-db-0") despite the
// CI existing with a byte-for-byte matching name -- live inspection found
// install_status and operational_status both blank on the record (the
// Record() API only sets fields explicitly listed in `data`; every other
// field is left unset, not defaulted, per record-api.md's own documented
// behavior). Every real, SGC-discovered CI on this instance carries
// install_status=1, operational_status=1 -- the Identification &
// Reconciliation Engine appears to exclude CIs missing that from candidate
// matching, which is why the name match still failed.
//
// Tried adding install_status/operational_status to dt-backfill-db-mssql-01
// directly (rebuild + redeploy) to fix it in place. Confirmed this does NOT
// work: sys_mod_count stayed 0, both fields stayed blank live. This isn't a
// new finding -- scripts/neutralize_cmdb_backfill.py's own docstring already
// documented it: field updates to an already-created CMDB CI record are
// silently dropped by this PDI's Fluent write path, and that script's own
// "neutralize by rename" mechanism is a rename (a field update) and is
// therefore ALSO expected to fail here, not a working walk-back as an
// earlier session summary claimed without having read this script first.
// dt-backfill-db-mssql-01 is left in place, permanently inert (harmless: it
// can never match anything since it will never carry a valid install_status)
// -- there is no confirmed way to delete, rename, or repair it on this PDI.
//
// Fix: a new record, $id'd separately, with install_status/operational_status
// set from creation instead of added after the fact.
Record({
    $id: Now.ID['dt-backfill-db-mssql-02'],
    table: 'cmdb_ci_db_mssql_instance',
    data: {
        name: 'MSSQLSERVER@easytrade-db-0',
        discovery_source: 'SIM-Dynatrace-Test',
        install_status: '1',
        operational_status: '1',
    },
})
