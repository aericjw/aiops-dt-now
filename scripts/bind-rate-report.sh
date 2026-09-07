#!/usr/bin/env bash
# Spec check V5. Reports CI bind rate for Dynatrace-sourced events, grouped by the
# Dynatrace entity key carried in additional_info.
# Isolates OUR events (from the new pipeline) from the disabled v1 workflow's
# leftover em_event records, which lack dt_entity_key in additional_info.
set -euo pipefail
LIMIT="${1:-500}"

npx --yes @servicenow/sdk@4.11.2 query em_event \
  -q 'sourceLIKEDynatrace^additional_infoLIKEdt_entity_key^ORDERBYDESCsys_created_on' \
  --limit "$LIMIT" -f type,ci_type,additional_info,processing_notes,alert \
  -o json -a pdi \
| python3 -c '
import json, sys, collections
rows = json.load(sys.stdin).get("records", [])
by_key = collections.defaultdict(lambda: {"total": 0, "bound": 0})
for r in rows:
    key = r.get("type") or "__none__"
    notes = r.get("processing_notes") or ""
    by_key[key]["total"] += 1
    if "No CI found for binding" not in notes and "Binding Failure" not in notes:
        by_key[key]["bound"] += 1
tot = sum(v["total"] for v in by_key.values())
bnd = sum(v["bound"] for v in by_key.values())
print(f"sampled {tot} events")
print(f"OVERALL BIND RATE: {bnd}/{tot} "
      f"({100*bnd//tot if tot else 0}%)")
print("{:<26} {:>7} {:>7}  rate".format("dt_entity_key", "bound", "total"))
for k, v in sorted(by_key.items(), key=lambda x: -x[1]["total"]):
    b = v["bound"]; t = v["total"]
    rate = 100 * b // t if t else 0
    print(f"{k:<26} {b:>7} {t:>7}  {rate}%")
'
