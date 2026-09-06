# Mapping research brief - unit {{UNIT}}

You are mapping Dynatrace entity types to ServiceNow CMDB CI classes.

## Your inputs

- `mapping/partitions/{{UNIT}}.keys.txt` - the entity keys you own. Map every one.
- `ground-truth/snow-ci-classes.csv` - the ONLY CMDB classes that exist on the
  target instance. This is an allowlist.

## Your output

Write `mapping/partitions/{{UNIT}}.csv` with this exact header:

    dt_entity_key,now_ci_class,bind_strategy,sgc_managed

One row per key in your keys file. Same order as the keys file.

## Hard rules

1. `now_ci_class` MUST appear in `ground-truth/snow-ci-classes.csv`. Verify each
   one with `grep "^<class>," ground-truth/snow-ci-classes.csv`. A class that is
   not in that file does not exist and will be rejected by the validator.
2. Do NOT invent, guess, or extrapolate class names. If you cannot verify a
   class exists, use the tier 3 fallback instead.
3. `bind_strategy` must be exactly one of: `sgc_service`, `sgc_host`,
   `sgc_process`, `ire_correlated`.
4. `sgc_managed` must be exactly `true` or `false`.
5. Only these four keys are SGC-managed, and they belong to unit 04:
   `host` -> sgc_host, `service` -> sgc_service, `process` -> sgc_process,
   `application` (FRONTEND) -> ire_correlated. Every other key in every unit is
   `sgc_managed=false` with `bind_strategy=ire_correlated`.

## The mapping ladder - use the most specific tier that applies

**Tier 1 - exact technology class.** A CMDB class names the same technology and
the same granularity. Example: `k8s_deployment` -> `cmdb_ci_kubernetes_deployment`.

**Tier 2 - generic technology class.** No exact class, but a generic class in the
same technology family exists. Example: `db_table_postgres` -> `cmdb_ci_db_catalog`,
because no `cmdb_ci_db_table` class exists on this instance.

**Tier 3 - structural parent.** No technology match at all. Use `cmdb_ci_appl`
for software and application entities, `cmdb_ci` for everything else. This is a
correct answer, not a failure. Prefer it over a wrong tier 1 or 2 guess.

## How to research a Dynatrace entity type

Dynatrace extension entity types come from extensions published in Dynatrace Hub.
The key's namespace tells you the technology:
`cloud:aws:*` = AWS, `sql:*` = databases, `f5:*` = F5 load balancers,
`jmx:*` = JVM-based middleware, and so on. Reason from the technology and resource to the closest CMDB class
that exists, then verify with grep.

Your target families for this unit: {{TARGET_FAMILIES}}. Search there first, but
you are not limited to them.

## Before you finish

Run this and fix anything it reports:

    python3 - <<'EOF'
    import csv
    valid = {r["class_name"] for r in csv.DictReader(open("ground-truth/snow-ci-classes.csv"))}
    keys = [l.strip() for l in open("mapping/partitions/{{UNIT}}.keys.txt") if l.strip()]
    rows = list(csv.DictReader(open("mapping/partitions/{{UNIT}}.csv")))
    assert [r["dt_entity_key"] for r in rows] == keys, "keys mismatch or wrong order"
    bad = [r for r in rows if r["now_ci_class"] not in valid]
    assert not bad, f"nonexistent classes: {[r['now_ci_class'] for r in bad][:10]}"
    print(f"OK {len(rows)} rows")
    EOF

Report back: the row count, how many landed in each tier, and any key you found
genuinely ambiguous.
