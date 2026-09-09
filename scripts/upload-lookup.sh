#!/usr/bin/env bash
# Create the Grail lookup table at a fresh path. Validates first: a failing mapping
# aborts before anything is created, leaving the existing table intact.
#
# NOTE: This does not delete-then-create in place. The authenticated token lacks
# the storage:files:delete scope required by `dtctl delete lookup`, so this script
# creates at a new path instead of replacing the old one. Every prior path
# (currently _v1 through _v3) is left untouched as a rollback artifact -- this
# tacocorp instance now has FOUR lookup tables for this reason
# (dt_to_snow_cmdb_mapping_v1 .. _v4), and _v4 is the current live/authoritative
# one (the one dynatrace/dql/extract_events.dql actually loads).
#
# I2 fix (final whole-branch review, 2026-09-08): this default had drifted to
# _v2 while extract_events.dql and the deployed workflow had already moved on
# to _v4 -- silently re-uploading a stale, unused path if run without an
# explicit second argument. Default now matches _v4. IMPORTANT: the next time
# this script is run to publish a new mapping version (e.g. _v5), you MUST
# update BOTH this default AND the load path in
# dynatrace/dql/extract_events.dql (and ideally lookup-coverage.dql too) in the
# same change -- they must never drift apart again.
set -euo pipefail

SRC="${1:-mapping/dt_to_snow_cmdb_mapping.csv}"
LOOKUP_PATH="${2:-/lookups/dt_to_snow_cmdb_mapping_v4}"
EXPECTED_CONTEXT="${EXPECTED_CONTEXT:-tacocorp}"

CONTEXT="$(dtctl config current-context --plain)"
echo "==> context: $CONTEXT"
if [ "$CONTEXT" != "$EXPECTED_CONTEXT" ]; then
  echo "ERROR: context is '$CONTEXT', expected '$EXPECTED_CONTEXT'" >&2
  exit 1
fi

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
