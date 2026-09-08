# Task 1: Ground-Truth Extraction - Report

## Overview
Successfully extracted and validated the canonical ground-truth files for Dynatrace entity types and ServiceNow CMDB CI classes. Both outputs match the expected counts and have passed all verification checks.

## Implementation Summary

### Files Created
1. **`scripts/fetch-dt-entity-keys.sh`** - Extracts all Dynatrace entity types using DQL query via `dtctl`
   - Normalizes entity keys by stripping "dt.entity." prefix and lowercasing
   - Computes namespace based on colon-presence in normalized key
   - Outputs CSV with columns: `dt_entity_key`, `namespace`, `source_type`

2. **`scripts/fetch-snow-ci-classes.sh`** - Extracts all CMDB CI classes from ServiceNow instance
   - Queries `sys_db_object` table for all entries starting with `cmdb_ci`
   - Sorts alphabetically by class name
   - Outputs CSV with columns: `class_name`, `label`

3. **`ground-truth/dt-entity-keys.csv`** - Generated output (533 data rows)
4. **`ground-truth/snow-ci-classes.csv`** - Generated output (1327 data rows)
5. **`.gitignore`** - Already existed, left unchanged (no overwrite)

## Verification Results

### Step 2: Dynatrace Entity Keys Count Verification
```
wrote 533 rows to ground-truth/dt-entity-keys.csv
PASS: 533 rows
```
✓ Expected: 533 rows
✓ Actual: 533 rows
✓ Status: PASS

### Step 3: Normalization Spot Checks
```
Checking for 'host' with __core__ namespace:
1
Checking for 'service' with __core__ namespace:
1
Checking for 'otel:host' with otel namespace:
1
```
✓ All three convergence cases verified:
  - `host,__core__` - Core entity type normalized correctly (count: 1)
  - `service,__core__` - Core entity type normalized correctly (count: 1)
  - `otel:host,otel` - Namespaced entity type normalized correctly (count: 1)

### Step 5: ServiceNow CI Classes Count Verification
```
wrote 1327 rows to ground-truth/snow-ci-classes.csv
PASS: 1327 classes
```
✓ Expected: 1327 classes
✓ Actual: 1327 classes
✓ Status: PASS

### Step 6: Required CMDB CI Classes Spot Checks
All 14 required classes verified present:
```
ok   cmdb_ci_kubernetes_deployment
ok   cmdb_ci_kubernetes_namespace
ok   cmdb_ci_kubernetes_node
ok   cmdb_ci_kubernetes_statefulset
ok   cmdb_ci_db_catalog
ok   cmdb_ci_db_postgresql_instance
ok   cmdb_ci_cloud_function
ok   cmdb_ci_cloud_load_balancer
ok   cmdb_ci_service_calculated
ok   cmdb_ci_win_server
ok   cmdb_ci_linux_server
ok   cmdb_ci_computer
ok   cmdb_ci_appl
ok   cmdb_ci
```
✓ All 14/14 required classes present

## File Quality Verification

### dt-entity-keys.csv
- **Header**: `dt_entity_key,namespace,source_type` ✓
- **Row count**: 533 data rows + 1 header = 534 total lines ✓
- **Sample rows**:
  ```
  activemq:broker,activemq,classic
  activemq:queue,activemq,classic
  activemq:topic,activemq,classic
  akamai-siem:config,akamai-siem,classic
  ...
  wmi:msmq_service_instance_queue,wmi,classic
  wmsshipping:container,wmsshipping,classic
  wmsshipping:truck,wmsshipping,classic
  ```
- **Format**: Well-formed CSV with proper escaping ✓

### snow-ci-classes.csv
- **Header**: `class_name,label` ✓
- **Row count**: 1327 data rows + 1 header = 1328 total lines ✓
- **Sample rows**:
  ```
  cmdb_ci,Configuration Item
  cmdb_ci_4g_authentication_authorization_accounting_function,Authentication Authorization Accounting Function
  cmdb_ci_4g_home_subscriber_server_function,Home Subscriber Server Function
  cmdb_ci_4g_mobility_management_entity_function,Mobility Management Entity Function
  ...
  cmdb_ci_zone,Data Center Zone
  cmdb_ci_zoo_keeper_cluster,Zoo Keeper Cluster
  cmdb_ci_zoo_keeper_cluster_node,Zoo Keeper Cluster Node
  ```
- **Format**: Well-formed CSV with proper escaping and newline normalization ✓

## Commit Information
```
Commit SHA: dbe70c0
Subject: feat: extract ground truth for entity keys and CMDB classes
Files changed: 4
  - created: scripts/fetch-dt-entity-keys.sh
  - created: scripts/fetch-snow-ci-classes.sh
  - created: ground-truth/dt-entity-keys.csv
  - created: ground-truth/snow-ci-classes.csv
```

## Self-Review Findings
- ✓ All shell scripts follow the exact specifications from the brief
- ✓ Python inline processing correctly handles JSON parsing and CSV output
- ✓ Both scripts are executable (mode 755)
- ✓ Error handling in place (set -euo pipefail)
- ✓ Generated CSVs are well-formed with no trailing/leading spaces
- ✓ Normalization in dt-entity-keys matches DQL extract_events.dql specification
- ✓ ServiceNow query correctly filters to cmdb_ci classes and handles label newlines
- ✓ No hardcoded secrets or sensitive data in scripts
- ✓ .gitignore left unchanged as instructed
- ✓ Commit message follows specified format with co-author attribution

## Concerns
None. All verification steps passed with exact expected counts. The ground-truth files are ready for downstream tasks.

## Status
DONE - All requirements met, all verification checks passed, committed to main branch.

---

# Fix Round 1: Robustness Defects

## Findings Addressed

### Finding 1: Silent Empty Result (Both Scripts)
**Problem**: Python heredocs would return 0 rows but still exit 0, writing header-only CSV files instead of failing loudly.

**Fix Applied**:
- Added explicit check for empty/unexpected result from upstream
- Added explicit check for zero data rows after extracting records
- Both checks call `sys.stderr.write()` and `sys.exit(1)` to fail loudly

**Dynatrace Script Fix**:
```python
if res is None or (isinstance(res, dict) and "records" not in res and not isinstance(res, list)):
    sys.stderr.write("ERROR: empty or unexpected result from dtctl query\n")
    sys.exit(1)
rows = res.get("records", []) if isinstance(res, dict) else (res or [])
if not rows:
    sys.stderr.write("ERROR: zero data rows returned from dtctl query\n")
    sys.exit(1)
```

**ServiceNow Script Fix**:
```python
rows = d.get("records", [])
if not rows:
    sys.stderr.write("ERROR: zero data rows returned from ServiceNow query\n")
    sys.exit(1)
```

### Finding 2: Non-Atomic Write (Both Scripts)
**Problem**: Direct redirection `> "$OUT"` truncates file before Python runs, leaving partial/truncated files on disk if pipeline fails.

**Fix Applied**:
- Write to temporary file (`TMPOUT="$(mktemp)"`)
- Move to final location only after successful completion
- Trap on EXIT to clean up temp file on failure

**Code Pattern**:
```bash
TMPOUT="$(mktemp)"
trap "rm -f '$TMPOUT'" EXIT
# ... pipeline output to "$TMPOUT"
mv "$TMPOUT" "$OUT"
```

### Finding 3: Unpinned npx Version (ServiceNow Script Only)
**Problem**: `npx --yes @servicenow/sdk` resolves to latest version, which could be a breaking major version with different output shape.

**Fix Applied**:
- Pinned to `@servicenow/sdk@4.11.2` (the version named in tech stack and installed locally)

**Change**:
```bash
# Before:
npx --yes @servicenow/sdk query sys_db_object ...

# After:
npx --yes @servicenow/sdk@4.11.2 query sys_db_object ...
```

## Testing: Finding 1 Robustness Proof

### Test 1a: Dynatrace with null result
```bash
$ echo '{"result":null}' | python3 -c '
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
'
ERROR: empty or unexpected result from dtctl query
Exit code: 1
```
✓ Fails immediately with clear error message, exit code 1

### Test 1b: Dynatrace with empty records
```bash
$ echo '{"result":{"records":[]}}' | python3 -c '
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
'
ERROR: zero data rows returned from dtctl query
Exit code: 1
```
✓ Fails immediately when records array is empty, exit code 1

### Test 1c: ServiceNow with empty records
```bash
$ echo '{"records":[]}' | python3 -c '
import json, sys, csv
d = json.load(sys.stdin)
rows = d.get("records", [])
if not rows:
    sys.stderr.write("ERROR: zero data rows returned from ServiceNow query\n")
    sys.exit(1)
w = csv.writer(sys.stdout)
w.writerow(["class_name", "label"])
for r in sorted(rows, key=lambda x: x["name"]):
    w.writerow([r["name"], (r.get("label") or "").replace("\n", " ")])
'
ERROR: zero data rows returned from ServiceNow query
Exit code: 1
```
✓ Fails immediately with clear error message, exit code 1

## Re-Run Verification (Output Byte-Identity)

Both scripts were re-run against live systems and outputs are byte-identical to original:
```
wrote 533 rows to ground-truth/dt-entity-keys.csv
PASS: 533 rows

wrote 1327 rows to ground-truth/snow-ci-classes.csv
PASS: 1327 classes
```

### Git Diff Verification
Files changed (scripts only, no CSV changes):
```
scripts/fetch-dt-entity-keys.sh
scripts/fetch-snow-ci-classes.sh
```

CSV files unchanged (verified with `git diff ground-truth/*.csv`).

## Commit Information (Fix Round 1)
```
Commit SHA: a20d571
Subject: fix: add robustness guards to extractors
  - Add empty-result checks that fail loudly instead of silently writing header-only CSVs
  - Write to temp file then atomic move to prevent partial/truncated files on failure
  - Pin npx @servicenow/sdk to 4.11.2 for reproducibility
Files changed: 2
  - modified: scripts/fetch-dt-entity-keys.sh
  - modified: scripts/fetch-snow-ci-classes.sh
```

## Summary
All three robustness defects fixed with targeted guards:
1. ✓ Empty result detection added to both extractors
2. ✓ Atomic file writes implemented with temp-file pattern
3. ✓ SDK version pinned to 4.11.2 for reproducibility

Behavior on live systems unchanged (533 and 1327 rows), but failures now explicit instead of silent.
