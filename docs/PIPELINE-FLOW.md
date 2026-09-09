# Pipeline flow, end to end

How a Dynatrace Davis problem becomes a ServiceNow incident, and why the
correlation step needed a scheduled-job workaround. See `docs/USER-SETUP.md`
for the full known-issues inventory and `docs/superpowers/specs/2026-09-05-dynatrace-servicenow-aiops-design.md`
section 16 for measured pass/fail results per spec check.

```mermaid
flowchart TD
    subgraph DT["Dynatrace"]
        A["Davis detects a problem<br/>(raw events → dt.davis.problems)"] --> B["extract_events.dql<br/>dedup, filter frequent events,<br/>derive dt_entity_key"]
        B --> C["Lookup: /lookups/dt_to_snow_cmdb_mapping_v4<br/>(553 rows) → CMDB class + bind strategy"]
        C --> D["Workflow: dt-problems-to-snow-itom<br/>per-event fan-out, sends to ServiceNow"]
    end

    D --> E

    subgraph SN["ServiceNow"]
        E["em_event created<br/>(one per Dynatrace event)"]
        E --> F["Event Rules (em_match_rule)<br/>host/service/process: bind by name<br/>everything else: catch-all"]
        F --> G["em_alert created<br/>(CI bound where possible)"]

        G -->|"guarded path: OOB rule skips this<br/>via isThreadProcessingEvents()"| H1["❌ Calculate correlation rule<br/>(OOB, never fires here)"]
        G -->|"unguarded: alert closes"| H2["Calculate correlation rule<br/>(OOB, close path)"]
        SWEEP["🔧 Sweep job (our fix)<br/>every 1 min, calls\ncalculateAlertCorrelation()\nfrom outside the guarded thread"] --> I

        H2 --> I["Correlation script<br/>dynatrace-problem-grouping.now.ts<br/>picks PRIMARY (root cause) alert"]
        I --> J["em_agg_group created<br/>correlation_rule_group=1 on primary"]

        J --> K["Incident-promotion rule<br/>fires only on the primary alert"]
        K --> L["em_alert_man_m2m_rule_flow action<br/>→ OOB 'Create Incident' subflow"]
        L --> M["✅ Incident created<br/>1 per Davis problem, CI attached"]

        G -.-> N["Operator actions on the alert<br/>open in Dynatrace / fetch logs / fetch metrics"]
        N -.-> O["Now Assist skill<br/>wraps the 3 actions for NL use"]
    end

    style SWEEP fill:#2d5,stroke:#141,color:#fff
    style M fill:#2d5,stroke:#141,color:#fff
    style H1 fill:#d55,stroke:#411,color:#fff
```

## The key thing this diagram makes visible

There are two ways into correlation — the normal path (`H1`) is structurally
blocked by a ServiceNow platform guard (`AlertManager.isThreadProcessingEvents()`),
so nothing ever flowed through it on this instance: every alert this pipeline
creates is born inside the exact thread that guard excludes. The close path
(`H2`) worked once the correlation script's own bugs were fixed, but only for
alerts that actually closed. The sweep job (`SWEEP`, green,
`servicenow/src/fluent/correlation/dynatrace-correlation-sweep-job.now.ts`) is
what makes it work for *any* alert, on a 1-minute cadence, by calling the same
correlation logic from outside the blocked thread.

Confirmed live end to end: `INC0010001`, `INC0010002`, `INC0010003` — real
incidents created from real Dynatrace Davis problems, each with a bound CI.
