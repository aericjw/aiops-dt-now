#!/usr/bin/env bash
# Create the Grail lookup table at a fresh path. Validates first: a failing mapping
# aborts before anything is created, leaving the existing table intact.
#
# NOTE: This does not delete-then-create in place. The authenticated token lacks
# the storage:files:delete scope required by `dtctl delete lookup`, so this script
# creates at a new path instead of replacing the old one. The old
# /lookups/dt_to_snow_cmdb_mapping table is left untouched as a rollback artifact.
set -euo pipefail

SRC="${1:-mapping/dt_to_snow_cmdb_mapping.csv}"
LOOKUP_PATH="${2:-/lookups/dt_to_snow_cmdb_mapping_v2}"

echo "==> context: $(dtctl config current-context --plain)"
echo "==> validating $SRC"
python3 scripts/validate_mapping.py "$SRC"

echo "==> creating $LOOKUP_PATH"
dtctl create lookup -f "$SRC" \
  --path "$LOOKUP_PATH" \
  --lookup-field dt_entity_key \
  --display-name "Dynatrace to ServiceNow CMDB Mapping" \
  --description "Canonical entity key to CMDB CI class and CI binding strategy" \
  --skip-records 1 \
  --plain

echo "==> verifying"
dtctl query "load \"${LOOKUP_PATH}\" | summarize rows = count()" -o json --plain
