#!/usr/bin/env bash
# Emits every Smartscape-on-Grail topology type confirmed to have live nodes in
# this tenant. Smartscape on Grail is a separate topology vocabulary from
# classic dt.entity.* types (see ground-truth/dt-entity-keys.csv) -- its type
# names do not appear under the dt.entity.* prefix at all, and Dynatrace
# exposes no discovery endpoint for this vocabulary. So the candidate list
# below is a literal, hand-maintained list, probed one at a time against the
# live tenant rather than derived from a query.
set -euo pipefail

OUT="${1:-ground-truth/dt-smartscape-types.csv}"
CLASSIC="${2:-ground-truth/dt-entity-keys.csv}"
TMPOUT="$(mktemp)"
trap "rm -f '$TMPOUT'" EXIT

mkdir -p "$(dirname "$OUT")"

# Candidate Smartscape-on-Grail types. Maintained by hand -- add a type here
# when a new Smartscape topology kind is expected to carry live nodes in this
# tenant, then re-run this script to confirm and record it.
CANDIDATES=(
  HOST PROCESS SERVICE FRONTEND DISK
  K8S_CLUSTER K8S_NODE K8S_NAMESPACE K8S_POD K8S_DEPLOYMENT
  K8S_STATEFULSET K8S_DAEMONSET K8S_JOB K8S_CRONJOB K8S_SERVICE
  K8S_INGRESS K8S_REPLICASET
  BROWSER_MONITOR HTTP_MONITOR NETWORK_AVAILABILITY_MONITOR
  SYNTHETIC_LOCATION
  DB_TABLE_POSTGRES DB_INDEX_POSTGRES
)

declare -a CONFIRMED=()
for TYPE in "${CANDIDATES[@]}"; do
  COUNT="$(dtctl query "smartscapeNodes \"${TYPE}\", from:now()-30d | summarize c=count()" -o json --plain \
    | python3 -c '
import json, sys
d = json.load(sys.stdin)
res = d.get("result")
rows = res.get("records", []) if isinstance(res, dict) else (res or [])
print(rows[0]["c"] if rows else 0)
')"
  if [ "${COUNT:-0}" -gt 0 ]; then
    CONFIRMED+=("$TYPE")
  fi
done

if [ "${#CONFIRMED[@]}" -eq 0 ]; then
  echo "ERROR: zero Smartscape types with live nodes found" >&2
  exit 1
fi

python3 -c '
import csv, sys

classic_path = sys.argv[1]
confirmed = sys.argv[2:]

with open(classic_path, newline="", encoding="utf-8") as fh:
    classic = {r["dt_entity_key"] for r in csv.DictReader(fh)}

w = csv.writer(sys.stdout)
w.writerow(["dt_entity_key", "smartscape_type", "already_in_classic"])
for t in confirmed:
    key = t.lower()
    w.writerow([key, t, "true" if key in classic else "false"])
' "$CLASSIC" "${CONFIRMED[@]}" > "$TMPOUT"

mv "$TMPOUT" "$OUT"
echo "wrote $(( $(wc -l < "$OUT") - 1 )) rows to $OUT"
