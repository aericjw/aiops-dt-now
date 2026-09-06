#!/usr/bin/env bash
# Emits every CMDB CI class that exists on the target instance. This file is the
# allowlist enforced by scripts/validate_mapping.py -- a now_ci_class not in here
# is a plan failure, not a warning.
set -euo pipefail

OUT="${1:-ground-truth/snow-ci-classes.csv}"
AUTH="${2:-pdi}"
mkdir -p "$(dirname "$OUT")"

npx --yes @servicenow/sdk query sys_db_object \
  -q 'nameSTARTSWITHcmdb_ci' --limit 2000 -f name,label -o json -a "$AUTH" \
| python3 -c '
import json, sys, csv
d = json.load(sys.stdin)
rows = d.get("records", [])
w = csv.writer(sys.stdout)
w.writerow(["class_name", "label"])
for r in sorted(rows, key=lambda x: x["name"]):
    w.writerow([r["name"], (r.get("label") or "").replace("\n", " ")])
' > "$OUT"

echo "wrote $(( $(wc -l < "$OUT") - 1 )) rows to $OUT"
