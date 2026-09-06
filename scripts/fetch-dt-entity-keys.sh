#!/usr/bin/env bash
# Emits the canonical dt_entity_key for every classic entity type defined in the
# tenant. The normalization here MUST match dynatrace/dql/extract_events.dql
# exactly: strip a leading "dt.entity." then lowercase.
set -euo pipefail

OUT="${1:-ground-truth/dt-entity-keys.csv}"
TMPOUT="$(mktemp)"
trap "rm -f '$TMPOUT'" EXIT

mkdir -p "$(dirname "$OUT")"

dtctl query 'fetch dt.system.data_objects
| filter startsWith(name, "dt.entity.")
| fieldsAdd dt_entity_key = lower(substring(name, from: 10))
| fieldsAdd namespace = if(contains(dt_entity_key, ":"),
    substring(dt_entity_key, from: 0, to: indexOf(dt_entity_key, ":")),
    else: "__core__")
| fields dt_entity_key, namespace
| sort dt_entity_key asc' -o json --plain \
| python3 -c '
import json, sys, csv
d = json.load(sys.stdin)
res = d.get("result")
if res is None or (isinstance(res, dict) and "records" not in res and not isinstance(res, list)):
    sys.stderr.write("ERROR: empty or unexpected result from dtctl query\n")
    sys.exit(1)
rows = res.get("records", []) if isinstance(res, dict) else (res or [])
if not rows:
    sys.stderr.write("ERROR: zero data rows returned from dtctl query\n")
    sys.exit(1)
w = csv.writer(sys.stdout)
w.writerow(["dt_entity_key", "namespace", "source_type"])
for r in rows:
    w.writerow([r["dt_entity_key"], r["namespace"], "classic"])
' > "$TMPOUT"

mv "$TMPOUT" "$OUT"
echo "wrote $(( $(wc -l < "$OUT") - 1 )) rows to $OUT"
