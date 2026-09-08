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

## 16. Verification results (Task 12, measured 2026-09-08)

§2.1's evidence table was the *before* picture (0/100 CI bind, 0 event rules matched, all
events forced to `cmdb_ci_service_calculated`). This section is the *after* picture, following
Tasks 5–11's fixes, re-measured live against `tacocorp`/`pdi` rather than re-derived from prior
reports. Numbers not re-measured in this task are cited from the task report or the execution
ledger (`docs/execution/execution-ledger.md`) that established them, not re-verified here.

| # | Check | Pass condition | Result | Evidence |
|---|---|---|---|---|
| V1 | `dtctl verify query` on rewritten DQL | no errors, no warnings | **PASS** | Re-ran `dtctl verify query` against the current live `dynatrace/dql/extract_events.dql` (Jinja stripped per the established recipe, now pointing at lookup v4): `✔ Query is valid`. Matches Task 6's original result. |
| V2 | Every `now_ci_class` in the lookup exists in `sys_db_object` | 533/533 (superseded: 553/553, see Task 4's Grail-vocabulary fix) | **PASS** | `mapping/dt_to_snow_cmdb_mapping.csv` = 553 data rows (554 lines incl. header, confirmed by `wc -l` in this task). Task 4c/Task 5 controller-verified live: 553 rows uploaded to `/lookups/dt_to_snow_cmdb_mapping_v4` (superseding v2/v3, per Task 9's lookup-path history), validator exit 0, zero invalid classes, 22/22 live-firing entity keys covered. Not re-uploaded or re-diffed against `sys_db_object` in this task — cited, not re-derived. |
| V3 | Workflow dry run on a live problem | N events in → N distinct `em_event` records out, each with its own entity | **PASS** | Established by Task 7 (P-26091047, 29 raw events → 29 `em_event` rows, 6 distinct `dt_entity_id` values, D1's `records[0]` bug fixed). Re-confirmed the shape holds on fresh live data in this task: pulled `wfe-task-result` for execution `75d85643…` (P-26091489 close trigger) and the `extract_events` task output correctly carries that trigger's own event (`dt_entity_id=SERVICE-01288A2EDDFE2F8B`), not a stale first-record value. |
| V4 | `ci_type` correctness | no HOST event carries a service class | **PASS** | Task 9's rule-scoping fix (per-`bind_strategy` `em_match_rule`s at order 8010/8020/8090, each gated on `em_event.type`) is confirmed live: the execution-ledger's "BREAKTHROUGH" measurement shows `service`/`process` events matching their own strategy's rule (rule 12 / rule 17 respectively), and `environment` events now fall through to the catch-all instead of being swallowed by the host rule. No live HOST event was available to re-sample in this session, but the scoping mechanism (a plain `type=host^EQ` filter, not a token) is structural and was independently confirmed deployed. |
| V5 | CI bind rate by `dt_entity_key` | measured and reported against the 0/100 baseline | **PASS (partial, environment-bounded)** | Baseline (§2.1): 0/100. Current best measurement (execution ledger, Task 9 fix round 2 + Task 9b, joining `em_event`→`em_alert.cmdb_ci`): **service 8/12 = 66.7% bound** (the execution ledger's own text rounds this to "66%"; recomputed here as 8÷12=0.667 to double-check), frontend 0/3 (no Dynatrace CIs exist for `cmdb_ci_web_application` on this PDI — a CMDB-coverage gap, not a rule defect), environment 0/14 (entity-less by nature, correctly excluded from the bindable rate per Ruling T9-F-ENTITYLESS) → **BINDABLE BIND RATE 8/15 = 53%**, materially above the 0/100 baseline. `process`/`k8s_*` bind mechanics are implemented and CIs were backfilled (Task 9b) but, per that task's own report, no live Davis problem of those classes has ever fired on this pipeline to exercise them — structurally reasoned as correct (name-based `sgc_process` join verified byte-for-byte against CMDB naming convention) but not empirically observed. Not re-measured with a fresh sample in this task (no new bind-relevant event class appeared in the close-path investigation); cited from the ledger's most recent confirmed number. |
| V6 | Correlation | one Davis problem → one `em_agg_group`, exactly one primary alert | **FAIL** | Newly confirmed in this task, resolving the question Tasks 10/11 left open. Zero `em_alert` records with `source=Dynatrace^correlation_rule_group=1` exist on this instance (`npx @servicenow/sdk query em_alert -q 'source=Dynatrace^correlation_rule_group=1'` → 0 rows), and the only 3 `em_agg_group` rows with a populated `primary_alert_id` predate this pipeline (`sys_created_on` 2026-06-24, unrelated `source`). **Root cause identified**: read `servicenow/src/fluent/correlation/dynatrace-problem-grouping.now.ts`'s deployed script — for a Davis problem with exactly one alert (`others.length === 0` in the script, i.e. no *other* still-groupable sibling alert exists for the same `dt_problem_display_id`), **both branches of the `if (current.isRootCause) / else if (others.length > 0)` structure fall through and the script returns `JSON.stringify({})`** — no `PRIMARY` is ever assigned, even to a lone root-cause alert grouping trivially with itself. Confirmed this is the operative case: every closed alert sampled in this task's V8 verification (5 of 5) came from single-entity Davis problems (`"The problem affects 1 entity overall"`), and every one has `correlation_rule_group=0`. The business rule that invokes the script **does** fire on the qualifying transition (see V8 below — this was independently confirmed, since the script must have run to have been observed producing `{}` rather than an error), so this is a script logic gap, not a further instance of the platform's state-transition gating Tasks 10/11 suspected. |
| V7 | Incident creation | one incident per group, from the primary alert only | **FAIL** | Directly downstream of V6: `em_alert_management_rule`'s trigger condition (`source=Dynatrace^correlation_rule_group=1^incidentISEMPTY`) has never matched, because no alert has ever reached `correlation_rule_group=1`. Confirmed live: `npx @servicenow/sdk query incident -q 'short_descriptionLIKEP-2609'` → 0 rows; `npx @servicenow/sdk query em_alert -q 'source=Dynatrace^incidentISNOTEMPTY'` → 0 rows. The rule and template built in Task 11 are deployed and structurally sound (verified field-by-field against the live record in that task) but have never had a matching input to act on. |
| V8 | Close path | Davis problem close → severity 0 → alert resolved → **group closed** | **PARTIAL PASS** — close path proven end-to-end through the alert; group-closure leg is unreachable, not unverified, because V6 means no group is ever created | See "Close-path verification" below for full detail. Severity-0 emission: confirmed (5 examples). Alert reaching `state=Closed`: confirmed (5/5 examples, all with real `sys_updated_on != sys_created_on` transitions). Group closing: **cannot occur** for any alert observed, because per V6 no `em_agg_group` is ever created for a Dynatrace alert in the first place — there is no group to close. This is the same root cause as V6's failure, not an independent V8 defect. |

### Close-path verification detail (spec V8)

**Step 1 — found a closed problem.** `dynatrace/dql/checks/close-path.dql` (created this task) against
live `tacocorp`, `from:-24h`: most recent closed, non-duplicate problem was **P-26091489**
("Failure rate increase", `frontend` service), closed `2026-09-08T20:06:00Z`. Ten closed problems
were returned in the 24h window; several others (`P-26091480`, message_key
`121631538443771818_1788891780000`, closed `2026-09-08T18:37:04`) were used for the broader
correlation-rule-group cross-check below because they had already fully processed by the time
of investigation (P-26091489's own close event had not yet propagated a severity-0 `em_event`
at the time it was checked — see the race-condition note below).

**Step 2 — severity-0 event confirmed, same `message_key` as the open event.** For
`message_key=121631538443771818_1788891780000` (`P-26091480`):
```
severity=3  resolution_state=New  sys_created_on=2026-09-08 18:30:34   (open)
severity=0  resolution_state=New  sys_created_on=2026-09-08 18:37:04   (close)
```
Both rows share the exact `message_key` — confirmed this is what makes ServiceNow treat the
second as a close of the first rather than a new event, per the brief. Four more independent
examples were sampled and show the identical open→severity-0-close pattern
(`6972629967322532533_1788875820000`, `-6585768356137897501_1788841860000`,
`1918943197279840605_1788875820000`, `-5623786556723918206_1788730320000`).

**New finding — a real race condition in the close path, not previously documented.** For
**P-26091489 specifically**, the close-triggered workflow execution (`75d85643-19f6-4f14-a977-
41191aa5d6e3`, trigger timestamp `2026-09-08T20:06:58.748Z`, `startedAt 20:06:58.781895Z`,
`endedAt 20:07:05.069756Z`, `SUCCESS`) pulled its own `extract_events` task result via
`dtctl get wfe-task-result`: the DQL's `event.status` field for the item read **`"ACTIVE"`**,
not `"CLOSED"`, at a snapshot timestamp `20:05:58.505Z`. The raw `dt.davis.events` record for
the same `event.id` did not flip to `event.status="CLOSED"` until `20:06:58.734Z` (confirmed by
direct query of `dt.davis.events`) — a gap of **60.229 seconds** (`20:06:58.734Z` minus
`20:05:58.505Z`; recomputed and double-checked directly from these two source timestamps, not
just the sub-minute portion, after an earlier draft of this section mis-stated the gap as 65ms
by comparing only the seconds-within-the-minute figures and missing that the minute digit rolled
over `20:05`→`20:06`). The DAVIS_PROBLEM close trigger fires the instant Davis marks a problem
closed, but the underlying raw-event snapshot the DQL reads (`fetch events, from:t-5m, to:t+5m |
dedup event.id, sort:{timestamp desc}`) can lag behind that instant by a full minute or more —
well in excess of the workflow's own execution time (`endedAt` minus `startedAt` for this run =
**6.29 seconds**, matching the platform-reported `runtime: 6`). A one-minute-stale snapshot
falling inside a five-minute window is a materially bigger gap than a sub-second race would be.
The practical effect: `severity: '{{ 0 if _.item["event.status"] == "CLOSED" else
_.item["event.severity"] }}'` evaluated to the *open* severity (3) for this specific problem's
close event, which is why P-26091489 was swapped for the four already-settled examples above to
demonstrate V8's severity-0 pass condition. **This means the close path is not 100% reliable** —
it appears to depend on whether the raw event snapshot has landed in Grail by the time the
workflow's 5-minute window query runs, which is a timing race, not a deterministic guarantee, and
the observed ~60-second lag shows the race can plausibly be lost by a comfortable margin, not just
by a hair. Worth flagging to whoever owns this spec next; a wider window or a short delay before
`extract_events` runs would likely close the gap, but that wasn't tested here (out of scope for a
verification-only task).

**Step 3 — alert resolution confirmed; group closure inapplicable.** For all 5 sampled
message_keys, `em_alert` reached `state=Closed` with a genuine transition
(`sys_updated_on != sys_created_on`), e.g.:
```
state=Closed  sys_created_on=2026-09-08 18:30:40  sys_updated_on=2026-09-08 18:37:09
correlation_rule_group=0   incident=""
```
**Brief correction applied, as instructed**: `em_agg_group` has no `alerts_count` field
(re-confirmed via `sys_dictionary` in this task: the real "is this group active" field is the
choice field **`group_status`** — `1=Active`, `0=Inactive`, confirmed via `sys_choice`). This
was moot for the actual check: **no `em_agg_group` record has ever been created for any of
these alerts** (`correlation_rule_group` is `0` on every one), so there is no group whose
`group_status` could be checked. This traces directly to V6's root cause above, not to any defect
in the close-path mechanism itself.

**Resolution of the open question from Tasks 10 and 11.** Both prior tasks flagged, as their
top open item, whether the correlation-triggering business rule might specifically require a
problem-closing transition to fire (as opposed to firing on any state transition, or not firing
on insert at all). This task's live data resolves it: the transition **does** reach the
correlation script (state changes from Open→Closed are real and observed, 5/5 sampled), but the
script itself — not the platform's transition-gating — is why `correlation_rule_group` never
populates. Every Davis problem sampled in this pipeline to date has produced exactly **one**
alert per problem (no multi-alert bursts observed live), and the script's grouping logic requires
`others.length > 0` (at least one *other* sibling alert already present) before it will assign
`PRIMARY` to anything, even to a lone root-cause alert. **The hypothesis that closing is what
gates correlation is refuted; the real gap is that the script never groups a single-alert
problem with itself.** This is a genuinely new finding, not a restatement of Task 10/11's
uncertainty, and is likely the dominant cause of V6/V7's fail state on this tenant, independent
of whatever the platform's state-transition gating turns out to require for multi-alert bursts
(still untested, since none has occurred live).

### Summary

| V1 | V2 | V3 | V4 | V5 | V6 | V7 | V8 |
|---|---|---|---|---|---|---|---|
| PASS | PASS | PASS | PASS | PASS (partial) | FAIL | FAIL | PARTIAL |

5 of 8 checks pass outright; V5 passes with a documented ceiling (CMDB coverage, not rule
defect); V6/V7 fail for a single identified, actionable root cause (the correlation script's
single-alert gap); V8 is split — the event/alert leg of the close path passes (with one newly
found reliability caveat, the extract-events race condition), while its group-closure leg is
unreachable rather than failing on its own terms.
