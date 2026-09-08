#!/usr/bin/env bash
# Spec check V5. Reports CI bind rate for Dynatrace-sourced events, grouped by the
# Dynatrace entity key carried in additional_info.
# Isolates OUR events (from the new pipeline) from the disabled v1 workflow's
# leftover em_event records, which lack dt_entity_key in additional_info.
#
# Bound is measured off em_alert.cmdb_ci (dot-walked as alert.cmdb_ci), not
# em_event.cmdb_ci - binding lands on the alert record ("Binding alert CI process
# flow" in processing_notes), never on the event, so measuring em_event.cmdb_ci
# always reads 0% regardless of actual bind success. Not inferred from
# processing_notes text either - that text can be truncated or otherwise
# misleading (observed: a record with only "Event rule applied: ..." in
# processing_notes and an empty cmdb_ci, which text-matching alone would have
# miscounted as bound).
#
# `environment` and `__unknown__` dt_entity_keys are entity-less: Dynatrace's
# tenant-level pseudo-entity and events with no resolvable entity at all. Neither
# has a CMDB counterpart and neither ever will, so they are reported separately and
# excluded from the BINDABLE rate, which is the number the pass condition applies to.
set -euo pipefail
LIMIT="${1:-500}"
ENTITY_LESS_KEYS="environment __unknown__"

npx --yes @servicenow/sdk@4.11.2 query em_event \
  -q 'sourceLIKEDynatrace^additional_infoLIKEdt_entity_key^ORDERBYDESCsys_created_on' \
  --limit "$LIMIT" -f type,ci_type,alert.cmdb_ci,additional_info,processing_notes,alert \
  -o json -a pdi \
| ENTITY_LESS_KEYS="$ENTITY_LESS_KEYS" python3 -c '
import json, os, sys, collections
rows = json.load(sys.stdin).get("records", [])
entity_less_keys = set(os.environ["ENTITY_LESS_KEYS"].split())
by_key = collections.defaultdict(lambda: {"total": 0, "bound": 0})
for r in rows:
    key = r.get("type") or "__none__"
    bound = bool((r.get("alert.cmdb_ci") or "").strip())
    by_key[key]["total"] += 1
    if bound:
        by_key[key]["bound"] += 1

tot = sum(v["total"] for v in by_key.values())
bnd = sum(v["bound"] for v in by_key.values())

bindable_tot = sum(v["total"] for k, v in by_key.items() if k not in entity_less_keys)
bindable_bnd = sum(v["bound"] for k, v in by_key.items() if k not in entity_less_keys)
entity_less_tot = sum(v["total"] for k, v in by_key.items() if k in entity_less_keys)

print(f"sampled {tot} events")
print(f"BINDABLE BIND RATE (excludes environment/__unknown__): {bindable_bnd}/{bindable_tot} "
      f"({100*bindable_bnd//bindable_tot if bindable_tot else 0}%)")
print(f"ENTITY-LESS (environment + __unknown__, not counted as failures): {entity_less_tot}/{tot}")
print(f"OVERALL BIND RATE (context only, includes entity-less): {bnd}/{tot} "
      f"({100*bnd//tot if tot else 0}%)")
print()
print("{:<26} {:>7} {:>7}  rate  {}".format("dt_entity_key", "bound", "total", ""))
for k, v in sorted(by_key.items(), key=lambda x: -x[1]["total"]):
    b = v["bound"]; t = v["total"]
    rate = 100 * b // t if t else 0
    tag = " (entity-less, excluded from BINDABLE rate)" if k in entity_less_keys else ""
    print(f"{k:<26} {b:>7} {t:>7}  {rate}%{tag}")
'
