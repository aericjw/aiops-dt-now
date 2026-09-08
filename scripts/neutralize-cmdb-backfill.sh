#!/usr/bin/env bash
# Task 9b Step 4: "neutralize" (rename, not delete) every backfilled CMDB CI
# record tagged discovery_source=SIM-Dynatrace-Test, so it can never again
# byte-for-byte match a live Dynatrace-composed CI name.
#
# CMDB CI records on this PDI are confirmed NOT physically deletable via any
# write path available to this pipeline (see task-9b-report.md, Step 2:
# code-removal+rebuild+redeploy, explicit Now.del(), and install --reinstall
# were all tried against a live test record and none removed it). Field
# updates to already-created CMDB CI records are ALSO confirmed to be
# silently dropped by the same write path (task-9b-report.md, Step 4:
# sys_mod_count stayed 0 across rebuild+redeploy even for non-identity
# fields). This script still performs the textbook rename mechanism -
# rewrite source, rebuild, redeploy - and independently verifies the result
# via `now-sdk query`; it does not report success unless the rename is
# actually confirmed live on the instance.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 scripts/neutralize_cmdb_backfill.py "$@"
