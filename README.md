# Dynatrace to ServiceNow ITOM AIOps Pipeline

Forwards Dynatrace Davis problems into ServiceNow ITOM Event Management as
per-event records that bind to CMDB configuration items, correlate into alert
groups, and promote to incidents.

## What this solves

Dynatrace has two topology vocabularies - classic `dt.entity.*` types and
Smartscape on Grail - and ServiceNow has 1,327 CMDB CI classes. Getting an
event from one side to the correct CI on the other requires a validated
mapping between them, per-class identifier composition, and event rules that
each match only their own binding strategy.

## Repository layout

| Path | Contents |
|---|---|
| `docs/superpowers/specs/` | Design spec - the binding authority |
| `docs/superpowers/plans/` | Implementation plan, 14 tasks |
| `ground-truth/` | Facts read from live systems, never hand-edited |
| `mapping/` | The 553-row entity-to-CI-class mapping and its research partitions |
| `dynatrace/dql/` | The `extract_events` query and verification checks |
| `dynatrace/workflows/` | Workflow definitions, including pre-change baselines |
| `servicenow/` | Fluent application - event rules and CI binding |
| `scripts/` | Ground-truth extractors, mapping validator, lookup upload, bind-rate report |
| `tests/` | Python tests for the mapping validator and partitioner |

## The mapping

553 rows covering every Dynatrace entity type the tenant defines plus the
Smartscape-on-Grail types that carry the overwhelming majority of real event
volume. Every target class is validated to exist on the target instance before
upload - a mapping naming a nonexistent class is rejected rather than shipped.

Four binding strategies, because Service Graph Connector names CIs differently
per class:

| Strategy | CMDB name shape |
|---|---|
| `sgc_host` | bare hostname |
| `sgc_service` | `<name> - SERVICE-XXXXXXXXXXXXXXXX` |
| `sgc_process` | `<process>@<host>`, resolved via the `runs_on` Smartscape edge |
| `ire_correlated` | name plus correlation id, for everything else |

## Running the tests

```bash
python3 -m pytest tests/ -v
```

## Known limitations

- `correlation_id` is empty on Service Graph Connector CIs, so `ire_correlated`
  cannot match on it alone. Types relying on it bind only if a CI with a
  matching name exists from another discovery source.
- `environment` and `__unknown__` events have no CMDB counterpart by nature and
  are reported separately rather than counted as binding failures.
- Binding lands on `em_alert.cmdb_ci`, not `em_event.cmdb_ci`.

## Setup steps requiring manual action

See `docs/USER-SETUP.md` where present: the Dynatrace API token, its ServiceNow
credential record, and the connection alias are deliberately not automated.
