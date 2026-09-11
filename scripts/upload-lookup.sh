#!/usr/bin/env bash
# Create the Grail lookup table at a fresh path. Validates first: a failing mapping
# aborts before anything is created, leaving the existing table intact.
#
# NOTE: This does not delete-then-create in place. The authenticated token lacks
# the storage:files:delete scope required by `dtctl delete lookup`, so this script
# creates at a new path instead of replacing the old one. Every prior path
# (currently _v1 through _v5) is left untouched as a rollback artifact -- this
# tacocorp instance now has SIX lookup tables for this reason
# (dt_to_snow_cmdb_mapping_v1 .. _v6), and _v6 is the current live/authoritative
# one (the one dynatrace/dql/extract_events.dql actually loads).
#
# I2 fix (final whole-branch review, 2026-09-08): this default had drifted to
# _v2 while extract_events.dql and the deployed workflow had already moved on
# to _v4 -- silently re-uploading a stale, unused path if run without an
# explicit second argument. IMPORTANT: every time this script is run to
# publish a new mapping version, you MUST update BOTH this default AND the
# load path in dynatrace/dql/extract_events.dql, dynatrace/dql/checks/lookup-coverage.dql,
# and the deployed workflow (dynatrace/workflows/dt-problems-to-snow-itom.yaml,
# re-applied via `dtctl apply`) in the same change -- they must never drift
# apart again. This is now expected to happen periodically: mapping/dt_to_snow_cmdb_mapping.csv
# grows over time as new entity types are discovered (classic Smartscape
# additions, new built-in Grail node types, and -- per
# ground-truth/dt-extension-entity-types.csv -- new entity types defined by
# newly installed Dynatrace extensions). Re-run
# scripts/sweep-extension-entity-types.py periodically to check for newly
# installed extensions' entity types, add rows for any genuinely new ones,
# re-validate, and publish at the next version.
set -euo pipefail

SRC="${1:-mapping/dt_to_snow_cmdb_mapping.csv}"
LOOKUP_PATH="${2:-/lookups/dt_to_snow_cmdb_mapping_v6}"
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
