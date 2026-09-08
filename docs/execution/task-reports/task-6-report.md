# Task 6 Report: Rewrite extract_events DQL

## Critical correction applied
The brief's DQL used `/lookups/dt_to_snow_cmdb_mapping` (stale 22-row table,
different columns). All three query files use
`/lookups/dt_to_snow_cmdb_mapping_v2` (553 rows, columns `dt_entity_key`,
`now_ci_class`, `bind_strategy`, `sgc_managed`) instead.

## Files created
- `dynatrace/dql/extract_events.dql`
- `dynatrace/dql/checks/normalization.dql`
- `dynatrace/dql/checks/lookup-coverage.dql` (not explicitly scripted in the
  brief's steps but listed under Files; added as a standing check that flags
  any live `dt_entity_key` the v2 lookup does not cover)

## Final DQL: dynatrace/dql/extract_events.dql

```
fetch events, from:"{{event()["timestamp"]}}"-5m, to:"{{event()["timestamp"]}}"+5m
| filter event.kind == "DAVIS_EVENT"
| filter in(event.id, {{event()["dt.davis.event_ids"] | replace("[", "{") | replace("]", "}") | replace("'", "\"")}})
| dedup event.id, sort:{timestamp desc}
| filterOut dt.davis.is_frequent_event == true
| fieldsAdd dt_raw_type = arrayFirst(coalesce(smartscape.affected_entity.types, affected_entity_types))
| fieldsAdd dt_entity_key = if(isNull(dt_raw_type), "__unknown__",
    else: lower(if(startsWith(dt_raw_type, "dt.entity."), substring(dt_raw_type, from: 10), else: dt_raw_type)))
| fieldsAdd dt_entity_id = toString(dt.smartscape_source.id)
| fieldsAdd dt_entity_name = coalesce(getNodeName(dt.smartscape_source.id), arrayFirst(affected_entity_names))
| fieldsAdd dt_problem_display_id = "{{ event()['display_id'] }}"
| fieldsAdd dt_problem_url = concat("https://bwm98081.apps.dynatrace.com/ui/apps/dynatrace.davis.problems/problem/", "{{ event()['event.id'] }}")
| lookup [load "/lookups/dt_to_snow_cmdb_mapping_v2"],
    sourceField: dt_entity_key, lookupField: dt_entity_key,
    fields: {now_ci_class, bind_strategy, sgc_managed}
| fields event.id, event.name, event.category, event.severity, event.status,
    event.description, dt_entity_key, dt_entity_id, dt_entity_name,
    now_ci_class, bind_strategy, sgc_managed,
    dt.davis.is_rootcause_relevant, dt_problem_display_id, dt_problem_url, timestamp
```

25 lines (excluding blank/comments), no per-type `dt.entity.*.name` enumeration.
`dt_entity_name` fallback is bounded to exactly two terms as required.

## Step 2: normalization check output

```
dtctl query -f dynatrace/dql/checks/normalization.dql -o json --plain
```

```json
{"ok":true,"result":{"kind":"records","records":[
  {"dt_entity_key":"service","events":"193","raw_forms":["SERVICE","dt.entity.service"]},
  {"dt_entity_key":"host","events":"23","raw_forms":["HOST","dt.entity.host"]}
]}}
```

Confirms the required convergence: `service` maps from both `SERVICE`
(Smartscape-on-Grail) and `dt.entity.service` (classic) forms. `host` also
converges (`HOST` / `dt.entity.host`), further evidence one lookup table
serves both topology vocabularies.

## Step 4: dtctl verify query output

Ran with the Jinja templating stripped per the brief's `sed` recipe:

```
✔ Query is valid
```

## Step 5: live run, per-field null counts

Ran the full un-truncated count via a `summarize`-based variant of the same
query logic (the row-level `dtctl query -o json` truncated to 1000 of 3867
rows on this 6h window, so null counts were computed server-side with
`countIf` to avoid undercount from truncation):

```
total = 3867
null_dt_entity_key   = 0/3867
null_dt_entity_id    = 97/3867
null_dt_entity_name  = 97/3867
null_now_ci_class    = 0/3867     <-- required: 0
null_bind_strategy   = 0/3867     <-- required: 0
```

**Acceptance criterion met**: `now_ci_class` and `bind_strategy` are null in
zero rows. `dt_entity_id`/`dt_entity_name` are null in 97/3867 rows (2.5%) —
recorded here as the Task 9 baseline for the bind-rate report, per the
brief's instruction not to treat this as a failure.

Sample rows from the truncated row-level run (for spot inspection):
```
process -> cmdb_ci_appl [sgc_process] AccountingService.dll opentelemetry-demo-accountingservice-*
process -> cmdb_ci_appl [sgc_process] chromium load-generator-5ff8dd49d7-776t6
service -> cmdb_ci_service_calculated [sgc_service] frontend-proxy
```

## lookup-coverage.dql check

Added as a standing coverage check (all distinct live `dt_entity_key` values
over 24h joined against v2, filtered to any with a null `now_ci_class` or
`bind_strategy`):

```
dtctl verify query -f dynatrace/dql/checks/lookup-coverage.dql --plain
✔ Query is valid

dtctl query -f dynatrace/dql/checks/lookup-coverage.dql -o json --plain
result.records: None (empty)
```

Zero uncovered entity keys over the last 24h — the v2 mapping fully covers
observed live traffic.

## Step 6: frequent-event gate volume

```
dtctl query 'fetch events, from:-6h | filter event.kind == "DAVIS_EVENT"
| summarize total = count(), frequent = countIf(dt.davis.is_frequent_event == true)' -o json --plain
```

```json
{"total":"7050","frequent":"0"}
```

In this particular 6h window there were 0 events flagged
`dt.davis.is_frequent_event == true`, so DEC-6 kept 0 of 7050 events out of
ServiceNow in this window. The `filterOut dt.davis.is_frequent_event == true`
clause in `extract_events.dql` is present and syntactically verified
(step 4); this window simply had no frequent events to exercise it — worth
re-checking against a window known to contain frequent-event bursts if that
matters for demoing the gate, but it doesn't block this task's acceptance
criterion.

## Files changed
- `dynatrace/dql/extract_events.dql` (new)
- `dynatrace/dql/checks/normalization.dql` (new)
- `dynatrace/dql/checks/lookup-coverage.dql` (new)

## Self-review findings
- Confirmed `/lookups/dt_to_snow_cmdb_mapping_v2` is used in every DQL file
  that performs a lookup (`grep` across all three files: 2 matches, both v2,
  zero matches for the old bare path).
- Confirmed no `dt.entity.*.name` per-type enumeration was reintroduced —
  the only occurrence of `dt.entity.` is the bounded prefix-strip literal
  used by the normalization rule, not a field enumeration.
- Confirmed all 15 interface fields named in the brief
  (`event.id`, `event.name`, `event.category`, `event.severity`,
  `event.status`, `event.description`, `dt_entity_key`, `dt_entity_id`,
  `dt_entity_name`, `now_ci_class`, `bind_strategy`, `sgc_managed`,
  `dt.davis.is_rootcause_relevant`, `dt_problem_display_id`,
  `dt_problem_url`, `timestamp`) appear in the final `fields` projection.
- `dtctl verify query --plain` passes on both `extract_events.dql` (with
  templating stripped) and `lookup-coverage.dql`.

## Concerns
- The row-level (non-aggregated) `dtctl query -o json` result truncates to
  1000 rows by default on this data volume; I used a `summarize`/`countIf`
  variant to get exact, un-truncated null counts for the acceptance check.
  This does not affect the shipped `extract_events.dql`, which always
  operates on a single problem's small event set (5-minute window, dedup'd),
  far below any truncation threshold.
- Step 6's frequent-event count was 0 in the live 6h window, so the gate's
  actual filtering effect wasn't observed live, only verified as
  syntactically correct. If demonstrating DEC-6's volume reduction matters
  for a later task, re-run step 6 during/after a period with frequent event
  bursts.
- `dynatrace/dql/checks/lookup-coverage.dql` was not literally specified as
  a step in the brief (no step content was given for it, only the filename
  under "Files: Create"), so I authored it based on its evident purpose —
  confirming the v2 lookup covers all live entity keys — consistent with the
  brief's file list and the task's acceptance criterion.
