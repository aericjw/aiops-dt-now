# Dynatrace → ServiceNow ITOM AIOps: End-to-End Design

Date: 2026-09-05
Dynatrace tenant: `tacocorp` (https://bwm98081.apps.dynatrace.com/), dtctl safety level `readwrite-all`
ServiceNow instance: `dev285073` PDI, now-sdk alias `pdi`

## 1. Problem statement

Davis problems must reach ServiceNow ITOM Event Management as per-event records that
bind to the correct CMDB CI, correlate into low-noise alert groups, and promote to
incidents. The pipeline must handle **any** Dynatrace entity type across both the
classic entity model and Smartscape on Grail, not only the four core types the
Service Graph Connector imports.

## 2. Current state (measured, not assumed)

Workflow `7c35a230-d8bf-4379-8137-43b8ad000f3d` ("Dynatrace Problems to ServiceNow
ITOM (AIOps) v2") is deployed and triggering on `DAVIS_PROBLEM` open/close, scoped to
`k8s.cluster.name == "aeric-walls-aks"`.

### 2.1 Defects found

**D1 — loop-variable inconsistency.** The `send_event_to_servicenow` task correctly
declares `withItems: "item in {{result("extract_events")["records"]}}"`, but inside the
loop only the `node` field references `_.item`. The fields `resource`,
`additional_info`, `ci_type`, and `type` are hardcoded to `records[0]`. An N-event
problem therefore emits N ServiceNow events that all carry the **first** event's
entity, type, and payload.

Evidence — 100 sampled `em_event` records with `source LIKE Dynatrace`:

| Measure | Result |
|---|---|
| Promoted to alerts | 90 / 100 |
| `ci_type` assigned | 99 / 100, all `cmdb_ci_service_calculated` (HOST events included) |
| CI successfully bound | 0 / 100 |
| Event rules matched | 0 ("No event rule applied") |

Verbatim `processing_notes` from the instance:

```
Event CI type is cmdb_ci_service_calculated
No conditions found for matching / No matching CI found
Binding Failure Reason: Failed to find the host in CMDB CI table
using identifiers: "name=recommendation"
```

**D2 — single-strategy CI identifier.** The DQL emits
`if(sgc_supported, concat(name, " - ", entity_id), else: name)`. That matches the SGC
naming convention for services only. Verified SGC name shapes differ per class:

| Dynatrace type | SGC CI class | SGC `name` format |
|---|---|---|
| SERVICE | `cmdb_ci_service_calculated` | `chatbot - SERVICE-0C57F091741CFA1A` (name + entity ID) |
| HOST | `cmdb_ci_win_server` / `cmdb_ci_linux_server` | `dw0sdwk000L8W` (bare hostname) |
| PROCESS | `cmdb_ci_appl` | `cart cart-75bdb64689-4jj6p@aks-...vmss00000n` (proc `@` host) |

A single boolean cannot express three different join strategies.

**D3 — no Dynatrace entity ID in CMDB.** SGC-created CIs have empty `correlation_id`
and empty `object_id`. Verified by dumping a full `cmdb_ci_computer` record created by
`discovery_source = "SGO-Dynatrace SaaS"`. Name is the only available join key for
SGC-managed classes.

**D4 — 24KB brute-force name resolution.** `extract_events` resolves the entity display
name with a three-stage `coalesce()` across every classic `dt.entity.*.name` field
(~24,000 characters of DQL). This is unmaintainable and silently misses any entity type
added after it was written.

### 2.2 Environment facts

Dynatrace tenant, verified via `dtctl query`:

- **533** classic entity types defined (`dt.system.data_objects` starting `dt.entity.`)
- **24** distinct entity types actually emitting Davis events in a 30-day window
- Both vocabularies are live simultaneously: Smartscape-on-Grail types (`PROCESS`,
  `K8S_POD`, `SERVICE`, `DB_TABLE_POSTGRES`) alongside classic types
  (`dt.entity.service`, `dt.entity.host`, `dt.entity.otel:host`)
- 2,716 events in 30 days carry no entity type at all
- Existing lookup `/lookups/dt_to_snow_cmdb_mapping`, 22 rows

Davis event severity distribution (7 days) — note the direction:

| `event.severity` | `event.category` | Count |
|---|---|---|
| `"4"` | WARNING | 79,253 |
| `"5"` | INFO | 23,307 |
| `"3"` | CUSTOM_ALERT | 858 |
| `"3"` | ERROR | 638 |
| `"3"` | SLOWDOWN | 108 |
| `"3"` | AVAILABILITY | 35 |
| `"3"` | RESOURCE_CONTENTION | 4 |

`dt.davis.is_rootcause_relevant` is populated and usable for primary-alert selection.

ServiceNow instance, verified via `now-sdk query`:

- **1,327** CMDB CI classes
- Event Management Core (`sn_em_ai`) 23.16.0, Event Management Connectors,
  ITOM AIOPS Config Center, Service Operations Workspace ITOM Apps
- **Both** SGC apps installed: `sn_dynatrace_integ` 1.15.0 (classic) and
  `sn_dynatrace_saas` 1.1.4 (SaaS)
- Now Assist Core 29.3.10, ServiceNow Otto context menu 3.0.6
- Central tables: `em_match_rule` (label "Event Rule"), `em_mapping_rule`
  (Event Field Mapping), `em_match_field`, `em_binding_process_map`
  (Process to CI Type Mapping), `em_alert_correlation_rule`,
  `em_alert_management_rule`, `em_agg_group`

## 3. Goals and non-goals

### Goals

- Every Davis event in a problem reaches ServiceNow as its own `em_event`, carrying its
  own entity, type, and payload
- Any Dynatrace entity type — all 533 — resolves to a CMDB class that exists in the
  target instance
- CI binding succeeds for SGC-managed classes and degrades predictably for the rest
- Davis problem grouping survives into ServiceNow as one alert aggregation group with
  one primary alert
- Incidents are created from primary alerts only
- Operators can pull Dynatrace logs, metrics, and telemetry from within ServiceNow

### Non-goals

- Replacing or modifying the Service Graph Connector's CMDB population
- Writing CIs into CMDB from this pipeline (events carry identifiers; IRE decides)
- Bidirectional sync (ServiceNow → Dynatrace state changes)
- Re-tuning Dynatrace anomaly detectors (severity semantics are fixed at the source,
  separately — see decision DEC-3)

## 4. Decisions

| ID | Decision | Rationale |
|---|---|---|
| DEC-1 | One `em_event` per Davis event | Gives ServiceNow real material to correlate; preserves per-entity fidelity |
| DEC-2 | Send events as-is with rich identifiers; event rules + IRE resolve the CI class | Avoids owning a second CMDB population path alongside SGC |
| DEC-3 | Pass `event.severity` through unchanged | Severity semantics will be corrected at the Dynatrace detector level, not remapped in transit. Pipeline stays a faithful transport. `severity = 0` on problem close is retained as the auto-resolve mechanism, not a severity judgment. |
| DEC-4 | Dynatrace groups, ServiceNow refines | Davis RCA arrives intact as an aggregation group; ServiceNow correlation rules can still merge across sources |
| DEC-5 | Map all 533 entity types up front | User directive. Long tail mapped via parallel research, not deferred. |
| DEC-6 | Drop `is_frequent_event == true` at Dynatrace | Noise removed before it consumes ITOM ingestion |
| DEC-7 | INFO-category events continue to flow | Not gated. With DEC-3 they arrive as ServiceNow severity 5 (OK) and do not promote to alerts. Revisit if ingestion volume becomes a licensing concern. |

## 5. Architecture

```
Dynatrace                                    ServiceNow ITOM
─────────                                    ───────────────
Davis problem (open/close)
  │
  ├─ Workflow trigger (DAVIS_PROBLEM)
  │
  ├─ Task: extract_events (DQL)
  │    • fetch problem's DAVIS_EVENTs
  │    • resolve name via getNodeName()
  │    • normalize → dt_entity_key      ◄── Section 6
  │    • lookup → now_ci_class,
  │              bind_strategy          ◄── Section 7
  │    • drop is_frequent_event
  │
  └─ Task: send_event_to_servicenow
       withItems, per-item fields  ────────►  em_event
                                                │
                                                ├─ Event rules (em_match_rule)  ◄── Section 9
                                                │    set ci_type + ci_identifier
                                                │
                                                ├─ IRE → CI binding
                                                │
                                                ├─ em_alert (message_key dedup)  ◄── Section 10
                                                │
                                                ├─ Correlation rule → em_agg_group
                                                │    grouped on dynatrace_problem_id
                                                │    primary = is_rootcause_relevant
                                                │
                                                └─ Alert management rule → incident  ◄── Section 11
                                                     primary alert only
                                                        │
                                                        └─ Alert actions → Dynatrace DQL  ◄── Section 12
```

## 6. The canonical entity-type key

Both topology vocabularies collapse to one lookup key, `dt_entity_key`:

| Input | Source | `dt_entity_key` |
|---|---|---|
| `K8S_POD` | Smartscape on Grail | `k8s_pod` |
| `HOST` | Smartscape on Grail | `host` |
| `dt.entity.host` | classic core | `host` |
| `dt.entity.service` | classic core | `service` |
| `dt.entity.otel:host` | classic namespaced | `otel:host` |
| `dt.entity.sql:postgres_db` | classic namespaced | `sql:postgres_db` |
| null | — | `__unknown__` |

Rules, applied in order to `coalesce(smartscape.affected_entity.types, affected_entity_types)`:

1. If the value starts with `dt.entity.`, strip that prefix.
2. Lowercase the result.
3. If null or empty, emit `__unknown__`.

Smartscape-on-Grail `HOST` and classic `dt.entity.host` therefore converge on the same
row. This single normalization replaces defect D4's 24KB coalesce and makes the
pipeline model-agnostic by construction.

## 7. The type mapping table

`/lookups/dt_to_snow_cmdb_mapping` is rebuilt with four columns:

| Column | Type | Purpose |
|---|---|---|
| `dt_entity_key` | string | canonical key from Section 6 (primary key) |
| `now_ci_class` | string | target CMDB class, **verified to exist** in the instance |
| `bind_strategy` | string | how to compose `ci_identifier` — see Section 9 |
| `sgc_managed` | boolean | whether SGC already owns CIs of this class |

### 7.1 Mapping ladder

Each of the 533 types is assigned by the most specific tier that applies:

**Tier 1 — exact technology class.** A CMDB class exists that names the same
technology. Verified examples:

| `dt_entity_key` | `now_ci_class` | Verified present |
|---|---|---|
| `k8s_deployment` | `cmdb_ci_kubernetes_deployment` | yes |
| `k8s_namespace` | `cmdb_ci_kubernetes_namespace` | yes |
| `k8s_node` | `cmdb_ci_kubernetes_node` | yes |
| `k8s_statefulset` | `cmdb_ci_kubernetes_statefulset` | yes |

**Tier 2 — generic technology class.** No exact class; fall to the closest generic in
the same technology family. Verified examples:

| `dt_entity_key` | `now_ci_class` | Reason |
|---|---|---|
| `db_table_postgres` | `cmdb_ci_db_catalog` | no `cmdb_ci_db_table` class exists; `cmdb_ci_dynamodb_table` is AWS-specific and `v_db_index` is a view, not a CI class |
| `db_index_postgres` | `cmdb_ci_db_catalog` | no `cmdb_ci_db_index` class exists; the containing `cmdb_ci_db_postgresql_instance` is an alternative if per-index granularity is not needed |
| `cloud:gcp:cloud_function` | `cmdb_ci_cloud_function` | generic cloud function class |
| `cloud:gcp:https_lb` | `cmdb_ci_cloud_load_balancer` | generic cloud LB class |

**Tier 3 — structural parent.** No technology match. Assign `cmdb_ci_appl` (software
entities) or `cmdb_ci` (everything else), with full Dynatrace context preserved in
`additional_info` so the alert remains actionable and the gap remains visible.

### 7.2 Validation invariant

**No row may name a CMDB class that does not exist in the target instance.** Every
`now_ci_class` value is checked against `sys_db_object` before the lookup table is
uploaded. A row failing validation is demoted to Tier 3 rather than shipped broken.

### 7.3 Research partition

533 types across 35 namespaces. Balanced into 8 parallel research units, each
responsible for cross-referencing Dynatrace Hub extension topology declarations
against the instance's real class list:

| Unit | Namespace slice | Types | Primary CMDB target families |
|---|---|---|---|
| 1 | `cloud:azure` | 122 | `cmdb_ci_cloud_*`, `cmdb_azure_*` |
| 2 | `cloud:aws` | 95 | `cmdb_ci_aws_*`, `cmdb_ci_cloud_*` |
| 3 | `cloud:gcp`, `cloud:oci` | 31 | `cmdb_ci_cloud_*` |
| 4 | core (no namespace) | 108 | hosts, services, processes, k8s, apps, synthetic |
| 5 | `sql`, `mariadb`, `mysql`, `iris` | 30 | `cmdb_ci_db_*` |
| 6 | `wmi`, `hyperv`, `nutanix`, `os`, `remote_unix`, `disk-devices` | 39 | server, storage, virtualization |
| 7 | `cisco_aci`, `f5`, `network`, `snmp`, `snmptraps`, `akamai-siem` | 38 | `cmdb_ci_network_*`, `cmdb_ci_lb_*`, `cmdb_ci_firewall_*` |
| 8 | `python`, `prometheus`, `jmx`, `kafka`, `activemq`, `ibmmq`, `elasticsearch`, `databricks`, `cloudhub`, `jenkins`, `otel`, `hsm`, `syslog`, `custom`, `arquitetura_referencia`, `wmsshipping`, `logistics` | 70 | `cmdb_ci_appl_*`, `cmdb_ci_endpoint_*` |

Sum: 122 + 95 + 31 + 108 + 30 + 39 + 38 + 70 = **533**.

Each unit returns CSV rows. Rows are merged, validated against `sys_db_object`
(Section 7.2), and uploaded as one lookup table.

## 8. Dynatrace workflow v3

### 8.1 Trigger

Unchanged in shape. The `k8s.cluster.name` filter moves from the hardcoded
`customFilter` into a workflow **input** so scope can be widened without editing DQL.

### 8.2 Task `extract_events`

Rewritten DQL, target ~25 lines (from ~24KB):

1. `fetch events` bounded to the problem's timestamp window
2. `filter event.kind == "DAVIS_EVENT"` and `in(event.id, <problem's event ids>)`
3. `dedup event.id`
4. `fieldsAdd name = coalesce(getNodeName(dt.smartscape_source.id), affected_entity_names[0], entity_name)`
   — a bounded three-term fallback. It must NOT reintroduce a per-type `dt.entity.*.name`
   enumeration; if `getNodeName()` and the generic affected-entity fields both return null,
   the event is emitted with `name = null` and `dt_entity_key` still set, so the gap surfaces
   in the V5 bind-rate report rather than being papered over.
5. `fieldsAdd dt_entity_key = <Section 6 normalization>`
6. `lookup [load "/lookups/dt_to_snow_cmdb_mapping"]` → `now_ci_class`, `bind_strategy`, `sgc_managed`
7. `filterOut dt.davis.is_frequent_event == true` (DEC-6)
8. `fieldsKeep` the exact projection ServiceNow needs

Carried fields: `event.id`, `event.name`, `event.category`, `event.severity`,
`event.status`, `event.description`, entity id, entity name, `dt_entity_key`,
`now_ci_class`, `bind_strategy`, `sgc_managed`, `dt.davis.is_rootcause_relevant`,
problem `display_id`, problem deep link, entity tags.

All DQL is validated with `dtctl verify query` before apply.

### 8.3 Task `send_event_to_servicenow`

Keep `withItems`. **Every** field reference changes from `records[0]` to `_.item`.
This is the fix for defect D1.

Field mapping:

| `em_event` field | Value |
|---|---|
| `message_key` | `_.item["event.id"]` — stable across open/update/close |
| `source` | workflow input `snow_source` |
| `severity` | `0` if `event.status == "CLOSED"`, else `_.item["event.severity"]` (DEC-3) |
| `event_class` | `_.item["event.category"]` |
| `resource` | `_.item["name"]` |
| `node` | `_.item["name"]` |
| `metric_name` | `_.item["event.name"]` |
| `type` | `_.item["dt_entity_key"]` |
| `ci_type` | `_.item["now_ci_class"]` |
| `description` | problem display id + event name + truncated description |
| `additional_info` | full `_.item` record including entity id, problem id, deep link, `bind_strategy`, `is_rootcause_relevant` |

## 9. CI binding in ServiceNow

Per DEC-2, events arrive with identifiers and ServiceNow resolves the CI.

### 9.1 Event rules

One `em_match_rule` per CI-class family — host, process, service, kubernetes,
database, cloud, network — matching on `additional_info.dt_entity_key` and composing
`ci_identifier` according to `bind_strategy`.

### 9.2 Identifier composition by strategy

This is the concrete fix for defects D2 and D3:

| `bind_strategy` | Applies to | `ci_identifier` composed as |
|---|---|---|
| `sgc_service` | `cmdb_ci_service_calculated` | `{"name": "<name> - <SERVICE-ID>"}` |
| `sgc_host` | `cmdb_ci_win_server`, `cmdb_ci_linux_server`, `cmdb_ci_computer` | `{"name": "<hostname>", "fqdn": …, "ip_address": …}` |
| `sgc_process` | `cmdb_ci_appl` | `{"name": "<proc>@<host>"}` |
| `ire_correlated` | all non-SGC classes | `{"name": …, "correlation_id": "<DT entity ID>", …}` |

`em_binding_process_map` ("Process to CI Type Mapping") is used for the PROCESS case
rather than reimplementing it.

### 9.3 Rule ordering

New rules occupy a reserved order band so they do not shadow the 57 pre-existing rules
in the instance. The chosen band is proposed for user confirmation before apply.

### 9.4 Binding health check

A paired DQL query and ServiceNow query reporting bind rate grouped by
`dt_entity_key`, so mapping-table gaps are measured rather than assumed. Baseline is
today's measured 0/100.

## 10. Events → alerts

- **Dedup, reopen, auto-close.** `message_key` = Dynatrace `event.id`. ServiceNow
  dedups on it natively; `severity = 0` on problem close resolves the alert. This
  mechanism is already correct in v2 and is retained.
- **Correlation.** An `em_alert_correlation_rule` (tag-based) groups on
  `additional_info.dynatrace_problem_id`. One Davis problem becomes one `em_agg_group`.
- **Primary alert.** The alert whose event carried `is_rootcause_relevant == true`.
  A 40-event problem becomes one group, one primary, 39 supporting alerts.
- **Cross-source correlation.** A CI-topology correlation rule layered on top so
  Dynatrace groups can merge with alerts from other sources sharing a CI.

## 11. Alerts → incidents

An `em_alert_management_rule` fires **only** on the aggregation group's primary alert,
never on supporting alerts. This is the highest-leverage noise control in the design.

Incident payload carries: Davis problem ID, Dynatrace deep link, bound CI, and the
impacted service from `em_impacted_service`. The group closes when Davis closes the
problem, via the severity-0 cascade.

## 12. Operator telemetry pull-back

Two paths, built in this order:

1. **Alert management actions** (`em_alert_management_action`) — buttons on the alert
   calling the Dynatrace DQL API with the stored entity ID: fetch logs for this entity
   over the last 30 minutes, fetch related metrics, open the problem in Dynatrace.
   Deterministic, no AI dependency.
2. **Otto / Now Assist skill** wrapping the same DQL calls for natural-language access.
   A thin layer over path 1, which is why path 1 ships first.

## 13. Build and apply split

### Applied directly by Claude

| System | Artifact | Tool |
|---|---|---|
| Dynatrace | `/lookups/dt_to_snow_cmdb_mapping` (533 rows) | `dtctl` |
| Dynatrace | Workflow v3 — DQL, per-item fields, frequent-event gate | `dtctl apply` |
| ServiceNow | Event rules, CI binding, field mappings | Fluent app via `now-sdk` |
| ServiceNow | Correlation rule, alert management rule | Fluent `Record()` |
| ServiceNow | Alert actions calling Dynatrace DQL | Fluent |
| Repo | All source, versioned, with apply commands | git |

### Requires user action

| Item | Why |
|---|---|
| Dynatrace API token for ServiceNow (`storage:*:read`) | Scope approval is the user's; the secret must live in ServiceNow credentials, never in source |
| ServiceNow connection alias to Dynatrace | Definition generated by Claude; the user attaches the secret |
| Otto / Now Assist skill publication | Licensed, UI-gated flow on a PDI |
| Confirming `em_match_rule` order band | Interacts with 57 existing rules |
| Widening the k8s-cluster filter | 297k PROCESS events per 30 days is a real ITOM ingestion and licensing decision |

## 14. Verification

| # | Check | Pass condition |
|---|---|---|
| V1 | `dtctl verify query` on rewritten DQL | no errors, no warnings |
| V2 | Every `now_ci_class` in the lookup exists in `sys_db_object` | 533/533 |
| V3 | Workflow dry run on a live problem | N events in → N distinct `em_event` records out, each with its own entity |
| V4 | `ci_type` correctness | no HOST event carries a service class |
| V5 | CI bind rate by `dt_entity_key` | measured and reported against the 0/100 baseline |
| V6 | Correlation | one Davis problem → one `em_agg_group`, exactly one primary alert |
| V7 | Incident creation | one incident per group, from the primary alert only |
| V8 | Close path | Davis problem close → severity 0 → alert resolved → group closed |

## 15. Open assumptions

| ID | Assumption | Impact if wrong |
|---|---|---|
| A1 | INFO events continue to flow (DEC-7) | Ingestion volume higher than necessary; reversible with a one-line DQL filter |
| A2 | Severity passthrough is acceptable until detectors are retuned | Real outages (Davis `"3"`) arrive as ServiceNow Minor and may sit below promotion thresholds. Called out explicitly; the user has accepted this and will correct it at the Dynatrace source. |
| A3 | `em_match_rule` is the correct event-rule table for this EM version | Verified present with label "Event Rule"; `em_event_rule` does not exist in this instance |
| A4 | SGC naming conventions are stable | Binding breaks for SGC-managed classes if SGC changes name composition |
