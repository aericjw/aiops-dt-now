# Dynatrace → ServiceNow ITOM AIOps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a working end-to-end pipeline where every Dynatrace Davis event reaches ServiceNow ITOM as its own `em_event`, binds to the correct CMDB CI across all 533 Dynatrace entity types, correlates into one alert group per Davis problem, and promotes a single incident from the root-cause alert.

**Architecture:** A Dynatrace workflow extracts each Davis event, normalizes both topology vocabularies (classic `dt.entity.*` and Smartscape on Grail) into one canonical `dt_entity_key`, joins a validated 533-row Grail lookup table to obtain the target CMDB class and binding strategy, and fans out one ServiceNow event per Davis event. ServiceNow event rules compose a class-appropriate `ci_identifier`, IRE resolves the CI, a tag-based correlation rule regroups on the Davis problem ID, and an alert management rule promotes only the root-cause alert to an incident.

**Tech Stack:** `dtctl` v0.14.4 (Dynatrace CLI), DQL, Dynatrace Workflows (schemaVersion 4), `@servicenow/sdk` v4.11.2 (Fluent), ServiceNow Event Management Core 23.16.0, Python 3 (validation tooling), bash.

**Spec:** `docs/superpowers/specs/2026-09-05-dynatrace-servicenow-aiops-design.md`

## Global Constraints

- Dynatrace context is `tacocorp`, safety level `readwrite-all`. Never switch context. Verify with `dtctl config current-context --plain` before any write.
- ServiceNow auth alias is `pdi` → `https://dev285073.service-now.com/`. Always pass `-a pdi` explicitly.
- Existing Dynatrace workflow ID is `7c35a230-d8bf-4379-8137-43b8ad000f3d`. Update it in place; do not create a second workflow.
- Lookup table path is `/lookups/dt_to_snow_cmdb_mapping`. Lookup key field is `dt_entity_key`.
- **No `now_ci_class` value may be written that does not exist in `sys_db_object` on the target instance.** This is spec §7.2 and is enforced by the validator in Task 2.
- Severity is passed through unchanged (spec DEC-3). The only override is `severity = 0` when `event.status == "CLOSED"`, which is the auto-resolve mechanism.
- `is_frequent_event == true` events are filtered out in Dynatrace DQL (DEC-6). INFO-category events are **not** filtered (DEC-7).
- Never write a Dynatrace API token, ServiceNow password, or any secret into a file in this repo. Secrets live in ServiceNow credential records and Dynatrace connection objects only.
- Do not use em dashes in Dynatrace or ServiceNow resource names or descriptions. Use hyphens.
- Every DQL query must pass `dtctl verify query '<dql>' --plain` before it is embedded in a workflow.
- Commit after every task. Never leave the working tree dirty between tasks.

## File Structure

```
aiops-dt-now/
├── docs/superpowers/
│   ├── specs/2026-09-05-dynatrace-servicenow-aiops-design.md   # the spec (exists)
│   └── plans/2026-09-05-dynatrace-servicenow-aiops.md          # this plan
├── ground-truth/
│   ├── dt-entity-keys.csv          # 533 canonical keys + namespace (generated)
│   └── snow-ci-classes.csv         # 1327 CMDB class names + labels (generated)
├── mapping/
│   ├── partitions/
│   │   ├── manifest.json           # 8 units, disjoint, sum 533
│   │   ├── 01-cloud-azure.csv      # one per research unit
│   │   ├── 02-cloud-aws.csv
│   │   ├── 03-cloud-gcp-oci.csv
│   │   ├── 04-core.csv
│   │   ├── 05-database.csv
│   │   ├── 06-server-virt.csv
│   │   ├── 07-network.csv
│   │   └── 08-middleware-apps.csv
│   ├── dt_to_snow_cmdb_mapping.csv # merged + validated, uploaded to Grail
│   └── RESEARCH-BRIEF.md           # the instructions each research agent receives
├── dynatrace/
│   ├── dql/
│   │   ├── extract_events.dql      # the rewritten task query
│   │   └── checks/                 # verification queries (V1..V8 Dynatrace side)
│   └── workflows/
│       └── dt-problems-to-snow-itom.yaml
├── servicenow/                     # Fluent project (now.config.json at this level)
│   └── src/
│       ├── event-rules/
│       ├── correlation/
│       ├── alert-management/
│       └── alert-actions/
└── scripts/
    ├── fetch-dt-entity-keys.sh
    ├── fetch-snow-ci-classes.sh
    ├── validate_mapping.py
    ├── merge_partitions.py
    ├── make_partitions.py
    └── bind-rate-report.sh
```

**Responsibility boundaries.** `ground-truth/` holds only facts read from live systems and is never hand-edited. `mapping/partitions/` holds research output, one file per unit, so eight agents never touch the same file. `scripts/validate_mapping.py` is the single gate between research output and anything that reaches Dynatrace. `dynatrace/` and `servicenow/` each own one platform's deployable artifacts.

---

### Task 1: Ground-truth extraction

Produces the two authoritative fact files every later task validates against. Nothing is mapped, researched, or deployed until both exist and their counts match the spec.

**Files:**
- Create: `scripts/fetch-dt-entity-keys.sh`
- Create: `scripts/fetch-snow-ci-classes.sh`
- Create: `ground-truth/dt-entity-keys.csv` (generated output, committed)
- Create: `ground-truth/snow-ci-classes.csv` (generated output, committed)
- Create: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: `ground-truth/dt-entity-keys.csv` with header `dt_entity_key,namespace,source_type` and 533 data rows. `ground-truth/snow-ci-classes.csv` with header `class_name,label` and 1327 data rows. Every later task reads these two files.

- [ ] **Step 1: Write the Dynatrace extractor**

Create `scripts/fetch-dt-entity-keys.sh`:

```bash
#!/usr/bin/env bash
# Emits the canonical dt_entity_key for every classic entity type defined in the
# tenant. The normalization here MUST match dynatrace/dql/extract_events.dql
# exactly: strip a leading "dt.entity." then lowercase.
set -euo pipefail

OUT="${1:-ground-truth/dt-entity-keys.csv}"
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
rows = res.get("records", []) if isinstance(res, dict) else (res or [])
w = csv.writer(sys.stdout)
w.writerow(["dt_entity_key", "namespace", "source_type"])
for r in rows:
    w.writerow([r["dt_entity_key"], r["namespace"], "classic"])
' > "$OUT"

echo "wrote $(( $(wc -l < "$OUT") - 1 )) rows to $OUT"
```

- [ ] **Step 2: Run it and verify the count is exactly 533**

Run:
```bash
chmod +x scripts/fetch-dt-entity-keys.sh
./scripts/fetch-dt-entity-keys.sh
test "$(tail -n +2 ground-truth/dt-entity-keys.csv | wc -l | tr -d ' ')" = "533" \
  && echo "PASS: 533 rows" || echo "FAIL: wrong count"
```
Expected: `PASS: 533 rows`

If the count differs, the tenant's entity-type inventory changed since the spec was written. Do not adjust the assertion — stop and report the new count, because spec §7.3's partition arithmetic depends on 533.

- [ ] **Step 3: Verify normalization matches the live DQL**

The key file must agree with what the workflow will compute. Confirm the two known convergence cases:

```bash
grep -c '^host,__core__' ground-truth/dt-entity-keys.csv     # expect 1
grep -c '^service,__core__' ground-truth/dt-entity-keys.csv  # expect 1
grep -c '^otel:host,otel' ground-truth/dt-entity-keys.csv    # expect 1
```
Expected: `1` for each. These are the classic types that Smartscape-on-Grail `HOST`, `SERVICE`, and `dt.entity.otel:host` normalize onto.

- [ ] **Step 4: Write the ServiceNow extractor**

Create `scripts/fetch-snow-ci-classes.sh`:

```bash
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
```

- [ ] **Step 5: Run it and verify the count is exactly 1327**

Run:
```bash
chmod +x scripts/fetch-snow-ci-classes.sh
./scripts/fetch-snow-ci-classes.sh
test "$(tail -n +2 ground-truth/snow-ci-classes.csv | wc -l | tr -d ' ')" = "1327" \
  && echo "PASS: 1327 classes" || echo "FAIL: wrong count"
```
Expected: `PASS: 1327 classes`

- [ ] **Step 6: Spot-check the classes the spec names explicitly**

Every class the spec commits to must be present:

```bash
for c in cmdb_ci_kubernetes_deployment cmdb_ci_kubernetes_namespace \
         cmdb_ci_kubernetes_node cmdb_ci_kubernetes_statefulset \
         cmdb_ci_db_catalog cmdb_ci_db_postgresql_instance \
         cmdb_ci_cloud_function cmdb_ci_cloud_load_balancer \
         cmdb_ci_service_calculated cmdb_ci_win_server cmdb_ci_linux_server \
         cmdb_ci_computer cmdb_ci_appl cmdb_ci; do
  grep -q "^${c}," ground-truth/snow-ci-classes.csv \
    && echo "ok   $c" || echo "MISSING $c"
done
```
Expected: `ok` for all 14. A `MISSING` line means the spec cites a class this instance does not have — stop and report it.

- [ ] **Step 7: Commit**

```bash
git add scripts/fetch-dt-entity-keys.sh scripts/fetch-snow-ci-classes.sh \
        ground-truth/dt-entity-keys.csv ground-truth/snow-ci-classes.csv .gitignore
git commit -m "feat: extract ground truth for entity keys and CMDB classes"
```

---

### Task 2: Mapping validator

The single gate between research output and Dynatrace. Written and tested before any mapping row exists, so the eight research agents in Task 4 have an objective definition of "correct" to work against.

**Files:**
- Create: `scripts/validate_mapping.py`
- Create: `tests/test_validate_mapping.py`
- Create: `tests/fixtures/` (small CSVs used by the tests)

**Interfaces:**
- Consumes: `ground-truth/dt-entity-keys.csv`, `ground-truth/snow-ci-classes.csv` from Task 1.
- Produces: `validate(mapping_rows, valid_keys, valid_classes) -> list[str]` returning a list of human-readable error strings, empty when valid. CLI entry point `python3 scripts/validate_mapping.py <mapping.csv>` exiting 0 on pass, 1 on failure. Tasks 4 and 5 call the CLI.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_validate_mapping.py`:

```python
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "scripts"))
from validate_mapping import validate, BIND_STRATEGIES

KEYS = {"host", "service", "k8s_pod", "cloud:aws:lambda", "__unknown__"}
CLASSES = {"cmdb_ci_computer", "cmdb_ci_service_calculated", "cmdb_ci_appl", "cmdb_ci"}


def row(key, cls="cmdb_ci_appl", strat="ire_correlated", sgc="false"):
    return {"dt_entity_key": key, "now_ci_class": cls,
            "bind_strategy": strat, "sgc_managed": sgc}


def test_valid_mapping_passes():
    rows = [row(k) for k in KEYS]
    assert validate(rows, KEYS, CLASSES) == []


def test_unknown_ci_class_is_rejected():
    rows = [row(k) for k in KEYS]
    rows[0]["now_ci_class"] = "cmdb_ci_totally_made_up"
    errs = validate(rows, KEYS, CLASSES)
    assert any("cmdb_ci_totally_made_up" in e for e in errs)


def test_unknown_entity_key_is_rejected():
    rows = [row(k) for k in KEYS] + [row("not_a_real_entity_type")]
    errs = validate(rows, KEYS, CLASSES)
    assert any("not_a_real_entity_type" in e for e in errs)


def test_duplicate_key_is_rejected():
    rows = [row(k) for k in KEYS] + [row("host")]
    errs = validate(rows, KEYS, CLASSES)
    assert any("duplicate" in e.lower() and "host" in e for e in errs)


def test_missing_coverage_is_rejected():
    rows = [row(k) for k in KEYS if k != "k8s_pod"]
    errs = validate(rows, KEYS, CLASSES)
    assert any("k8s_pod" in e for e in errs)


def test_bad_bind_strategy_is_rejected():
    rows = [row(k) for k in KEYS]
    rows[0]["bind_strategy"] = "guess_lol"
    errs = validate(rows, KEYS, CLASSES)
    assert any("guess_lol" in e for e in errs)


def test_bad_sgc_managed_is_rejected():
    rows = [row(k) for k in KEYS]
    rows[0]["sgc_managed"] = "maybe"
    errs = validate(rows, KEYS, CLASSES)
    assert any("maybe" in e for e in errs)


def test_bind_strategy_enum_matches_spec():
    assert BIND_STRATEGIES == {
        "sgc_service", "sgc_host", "sgc_process", "ire_correlated"}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_validate_mapping.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'validate_mapping'`

- [ ] **Step 3: Write the validator**

Create `scripts/validate_mapping.py`:

```python
#!/usr/bin/env python3
"""Gate between mapping research output and Dynatrace.

Enforces spec section 7.2: no row may name a CMDB class that does not exist on
the target instance. Also enforces full coverage of the canonical key set, key
uniqueness, and the bind_strategy enum from spec section 9.2.
"""
import csv
import pathlib
import sys

# spec section 9.2
BIND_STRATEGIES = {"sgc_service", "sgc_host", "sgc_process", "ire_correlated"}
REQUIRED_COLUMNS = ["dt_entity_key", "now_ci_class", "bind_strategy", "sgc_managed"]
BOOLEANS = {"true", "false"}


def validate(rows, valid_keys, valid_classes):
    """Return a list of error strings. Empty list means the mapping is valid."""
    errors = []
    seen = set()

    for i, r in enumerate(rows, start=2):  # start=2 accounts for the CSV header
        key = (r.get("dt_entity_key") or "").strip()
        cls = (r.get("now_ci_class") or "").strip()
        strat = (r.get("bind_strategy") or "").strip()
        sgc = (r.get("sgc_managed") or "").strip().lower()

        if not key:
            errors.append(f"line {i}: empty dt_entity_key")
            continue
        if key in seen:
            errors.append(f"line {i}: duplicate dt_entity_key {key!r}")
        seen.add(key)
        if key not in valid_keys:
            errors.append(
                f"line {i}: dt_entity_key {key!r} is not a known entity type")
        if cls not in valid_classes:
            errors.append(
                f"line {i}: now_ci_class {cls!r} does not exist on the instance "
                f"(key {key!r}) - demote to cmdb_ci_appl or cmdb_ci per spec tier 3")
        if strat not in BIND_STRATEGIES:
            errors.append(
                f"line {i}: bind_strategy {strat!r} is not one of "
                f"{sorted(BIND_STRATEGIES)} (key {key!r})")
        if sgc not in BOOLEANS:
            errors.append(
                f"line {i}: sgc_managed {sgc!r} must be 'true' or 'false' "
                f"(key {key!r})")

    for missing in sorted(valid_keys - seen):
        errors.append(f"coverage gap: no mapping row for dt_entity_key {missing!r}")

    return errors


def _load_column(path, column):
    with open(path, newline="", encoding="utf-8") as fh:
        return {row[column].strip() for row in csv.DictReader(fh) if row[column].strip()}


def main(argv):
    if len(argv) < 2:
        print("usage: validate_mapping.py <mapping.csv> "
              "[dt-entity-keys.csv] [snow-ci-classes.csv]", file=sys.stderr)
        return 2

    mapping_path = pathlib.Path(argv[1])
    keys_path = pathlib.Path(argv[2] if len(argv) > 2
                             else "ground-truth/dt-entity-keys.csv")
    classes_path = pathlib.Path(argv[3] if len(argv) > 3
                                else "ground-truth/snow-ci-classes.csv")

    with open(mapping_path, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        missing_cols = [c for c in REQUIRED_COLUMNS if c not in (reader.fieldnames or [])]
        if missing_cols:
            print(f"FAIL: {mapping_path} is missing columns: {missing_cols}",
                  file=sys.stderr)
            return 1
        rows = list(reader)

    valid_keys = _load_column(keys_path, "dt_entity_key") | {"__unknown__"}
    valid_classes = _load_column(classes_path, "class_name")

    errors = validate(rows, valid_keys, valid_classes)
    if errors:
        print(f"FAIL: {len(errors)} problem(s) in {mapping_path}", file=sys.stderr)
        for e in errors[:100]:
            print(f"  {e}", file=sys.stderr)
        if len(errors) > 100:
            print(f"  ... and {len(errors) - 100} more", file=sys.stderr)
        return 1

    print(f"PASS: {len(rows)} rows valid, "
          f"{len(valid_keys)} keys covered, all classes exist")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_validate_mapping.py -v`
Expected: PASS, 8 passed

- [ ] **Step 5: Verify the CLI rejects a known-bad file end to end**

```bash
printf 'dt_entity_key,now_ci_class,bind_strategy,sgc_managed\nhost,cmdb_ci_nope,sgc_host,true\n' \
  > /tmp/bad-mapping.csv
python3 scripts/validate_mapping.py /tmp/bad-mapping.csv; echo "exit=$?"
```
Expected: exit=1, with a `cmdb_ci_nope` error and 533 coverage-gap errors (truncated at 100).

- [ ] **Step 6: Commit**

```bash
git add scripts/validate_mapping.py tests/
git commit -m "feat: add mapping validator enforcing spec section 7.2 invariant"
```

---

### Task 3: Partition manifest

Splits the 533 keys into the eight disjoint research units from spec §7.3. Generated, not hand-written, so the disjointness and sum are provable rather than asserted.

**Files:**
- Create: `scripts/make_partitions.py`
- Create: `mapping/partitions/manifest.json` (generated, committed)
- Create: `mapping/partitions/0{1..8}-*.keys.txt` (generated, committed)
- Create: `tests/test_make_partitions.py`

**Interfaces:**
- Consumes: `ground-truth/dt-entity-keys.csv` from Task 1.
- Produces: `mapping/partitions/manifest.json` shaped as `{"units": [{"id": "01", "slug": "cloud-azure", "keys_file": "...", "expected": 122, "target_families": [...]}, ...]}`, and one `NN-slug.keys.txt` per unit containing that unit's keys, one per line. Task 4 dispatches one research agent per unit.

- [ ] **Step 1: Write the failing test**

Create `tests/test_make_partitions.py`:

```python
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "scripts"))
from make_partitions import assign_unit, UNITS

ALL = [
    ("cloud:azure:web:serverfarms", "cloud"),
    ("cloud:aws:sqs", "cloud"),
    ("cloud:gcp:project", "cloud"),
    ("cloud:oci:compute", "cloud"),
    ("host", "__core__"),
    ("sql:postgres_db", "sql"),
    ("mysql:instance", "mysql"),
    ("wmi:com_dynatrace_extension_ad_dhcp", "wmi"),
    ("f5:instance", "f5"),
    ("python:com_dynatrace_extension_meraki_device", "python"),
]


def test_every_key_lands_in_exactly_one_unit():
    for key, ns in ALL:
        units = [u for u in UNITS if assign_unit(key, ns) == u["id"]]
        assert len(units) == 1, f"{key} matched {len(units)} units"


def test_specific_assignments():
    assert assign_unit("cloud:azure:web:serverfarms", "cloud") == "01"
    assert assign_unit("cloud:aws:sqs", "cloud") == "02"
    assert assign_unit("cloud:gcp:project", "cloud") == "03"
    assert assign_unit("cloud:oci:compute", "cloud") == "03"
    assert assign_unit("host", "__core__") == "04"
    assert assign_unit("sql:postgres_db", "sql") == "05"
    assert assign_unit("wmi:anything", "wmi") == "06"
    assert assign_unit("f5:instance", "f5") == "07"
    assert assign_unit("python:whatever", "python") == "08"


def test_expected_counts_sum_to_533():
    assert sum(u["expected"] for u in UNITS) == 533


def test_there_are_eight_units():
    assert len(UNITS) == 8
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m pytest tests/test_make_partitions.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'make_partitions'`

- [ ] **Step 3: Write the partitioner**

Create `scripts/make_partitions.py`:

```python
#!/usr/bin/env python3
"""Split the canonical entity keys into the eight research units of spec 7.3.

Assignment is by namespace (and by cloud provider for the cloud namespace).
Unit 08 is the catch-all so the units are exhaustive by construction; the
expected counts are asserted so a drift in the tenant inventory fails loudly.
"""
import csv
import json
import pathlib
import sys

UNITS = [
    {"id": "01", "slug": "cloud-azure", "expected": 122,
     "target_families": ["cmdb_ci_cloud_*", "cmdb_azure_*"]},
    {"id": "02", "slug": "cloud-aws", "expected": 95,
     "target_families": ["cmdb_ci_aws_*", "cmdb_ci_cloud_*"]},
    {"id": "03", "slug": "cloud-gcp-oci", "expected": 31,
     "target_families": ["cmdb_ci_cloud_*"]},
    {"id": "04", "slug": "core", "expected": 108,
     "target_families": ["cmdb_ci_computer", "cmdb_ci_appl",
                         "cmdb_ci_service_*", "cmdb_ci_kubernetes_*"]},
    {"id": "05", "slug": "database", "expected": 30,
     "target_families": ["cmdb_ci_db_*"]},
    {"id": "06", "slug": "server-virt", "expected": 39,
     "target_families": ["cmdb_ci_win_server", "cmdb_ci_linux_server",
                         "cmdb_ci_storage_*", "cmdb_ci_vcenter_*",
                         "cmdb_ci_hyper_*"]},
    {"id": "07", "slug": "network", "expected": 38,
     "target_families": ["cmdb_ci_network_*", "cmdb_ci_lb_*",
                         "cmdb_ci_firewall_*", "cmdb_ci_ip_*"]},
    {"id": "08", "slug": "middleware-apps", "expected": 70,
     "target_families": ["cmdb_ci_appl_*", "cmdb_ci_endpoint_*"]},
]

_DATABASE_NS = {"sql", "mariadb", "mysql", "iris"}
_SERVER_NS = {"wmi", "hyperv", "nutanix", "os", "remote_unix", "disk-devices"}
_NETWORK_NS = {"cisco_aci", "f5", "network", "snmp", "snmptraps", "akamai-siem"}


def assign_unit(key, namespace):
    """Return the unit id owning this key. Exhaustive: always returns a unit."""
    if namespace == "cloud":
        if key.startswith("cloud:azure"):
            return "01"
        if key.startswith("cloud:aws"):
            return "02"
        return "03"          # gcp, oci, and any future provider
    if namespace == "__core__":
        return "04"
    if namespace in _DATABASE_NS:
        return "05"
    if namespace in _SERVER_NS:
        return "06"
    if namespace in _NETWORK_NS:
        return "07"
    return "08"


def main():
    src = pathlib.Path("ground-truth/dt-entity-keys.csv")
    outdir = pathlib.Path("mapping/partitions")
    outdir.mkdir(parents=True, exist_ok=True)

    buckets = {u["id"]: [] for u in UNITS}
    with open(src, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            key = row["dt_entity_key"].strip()
            buckets[assign_unit(key, row["namespace"].strip())].append(key)

    failures = []
    manifest = {"units": []}
    for u in UNITS:
        keys = sorted(buckets[u["id"]])
        name = f"{u['id']}-{u['slug']}"
        keys_file = outdir / f"{name}.keys.txt"
        keys_file.write_text("\n".join(keys) + "\n", encoding="utf-8")
        if len(keys) != u["expected"]:
            failures.append(
                f"unit {name}: expected {u['expected']} keys, got {len(keys)}")
        manifest["units"].append({
            "id": u["id"], "slug": u["slug"],
            "keys_file": str(keys_file),
            "output_file": f"mapping/partitions/{name}.csv",
            "expected": u["expected"], "actual": len(keys),
            "target_families": u["target_families"],
        })

    total = sum(len(v) for v in buckets.values())
    if total != 533:
        failures.append(f"total keys {total}, expected 533")

    (outdir / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    if failures:
        for f in failures:
            print(f"FAIL: {f}", file=sys.stderr)
        return 1
    print(f"PASS: 8 disjoint units, {total} keys total")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python3 -m pytest tests/test_make_partitions.py -v`
Expected: PASS, 4 passed

- [ ] **Step 5: Generate the partitions and verify counts and disjointness**

```bash
python3 scripts/make_partitions.py
cat mapping/partitions/*.keys.txt | sort | uniq -d | head
echo "duplicates above (expect none)"
cat mapping/partitions/*.keys.txt | sort -u | wc -l
echo "unique keys above (expect 533)"
```
Expected: `PASS: 8 disjoint units, 533 keys total`, no duplicate lines, `533` unique keys.

- [ ] **Step 6: Commit**

```bash
git add scripts/make_partitions.py tests/test_make_partitions.py mapping/partitions/
git commit -m "feat: partition 533 entity keys into 8 disjoint research units"
```

---

### Task 4: Parallel mapping research

The 533-row mapping is produced by eight subagents working disjoint partitions, then merged and validated. No agent may invent a CMDB class; the allowlist and the validator make that mechanically checkable.

**Files:**
- Create: `mapping/RESEARCH-BRIEF.md`
- Create: `scripts/merge_partitions.py`
- Create: `mapping/partitions/0{1..8}-*.csv` (agent output)
- Create: `mapping/dt_to_snow_cmdb_mapping.csv` (merged, validated)

**Interfaces:**
- Consumes: `mapping/partitions/manifest.json` and the `*.keys.txt` files from Task 3; `ground-truth/snow-ci-classes.csv` from Task 1; `scripts/validate_mapping.py` from Task 2.
- Produces: `mapping/dt_to_snow_cmdb_mapping.csv` with header `dt_entity_key,now_ci_class,bind_strategy,sgc_managed` and 534 data rows (533 entity types plus `__unknown__`). Task 5 uploads this file verbatim.

- [ ] **Step 1: Write the research brief**

Create `mapping/RESEARCH-BRIEF.md`. This exact text is handed to each of the eight agents, with `{{UNIT}}` substituted:

```markdown
# Mapping research brief - unit {{UNIT}}

You are mapping Dynatrace entity types to ServiceNow CMDB CI classes.

## Your inputs

- `mapping/partitions/{{UNIT}}.keys.txt` - the entity keys you own. Map every one.
- `ground-truth/snow-ci-classes.csv` - the ONLY CMDB classes that exist on the
  target instance. This is an allowlist.

## Your output

Write `mapping/partitions/{{UNIT}}.csv` with this exact header:

    dt_entity_key,now_ci_class,bind_strategy,sgc_managed

One row per key in your keys file. Same order as the keys file.

## Hard rules

1. `now_ci_class` MUST appear in `ground-truth/snow-ci-classes.csv`. Verify each
   one with `grep "^<class>," ground-truth/snow-ci-classes.csv`. A class that is
   not in that file does not exist and will be rejected by the validator.
2. Do NOT invent, guess, or extrapolate class names. If you cannot verify a
   class exists, use the tier 3 fallback instead.
3. `bind_strategy` must be exactly one of: `sgc_service`, `sgc_host`,
   `sgc_process`, `ire_correlated`.
4. `sgc_managed` must be exactly `true` or `false`.
5. Only these four keys are SGC-managed, and they belong to unit 04:
   `host` -> sgc_host, `service` -> sgc_service, `process` -> sgc_process,
   `application` (FRONTEND) -> ire_correlated. Every other key in every unit is
   `sgc_managed=false` with `bind_strategy=ire_correlated`.

## The mapping ladder - use the most specific tier that applies

**Tier 1 - exact technology class.** A CMDB class names the same technology and
the same granularity. Example: `k8s_deployment` -> `cmdb_ci_kubernetes_deployment`.

**Tier 2 - generic technology class.** No exact class, but a generic class in the
same technology family exists. Example: `db_table_postgres` -> `cmdb_ci_db_catalog`,
because no `cmdb_ci_db_table` class exists on this instance.

**Tier 3 - structural parent.** No technology match at all. Use `cmdb_ci_appl`
for software and application entities, `cmdb_ci` for everything else. This is a
correct answer, not a failure. Prefer it over a wrong tier 1 or 2 guess.

## How to research a Dynatrace entity type

Dynatrace extension entity types come from extensions published in Dynatrace Hub.
The key's namespace tells you the technology:
`cloud:aws:*` = AWS, `sql:*` = databases, `f5:*` = F5 load balancers,
`jmx:*` = JVM-based middleware, and so on. The segment after the namespace names
the resource. Reason from the technology and resource to the closest CMDB class
that exists, then verify with grep.

Your target families for this unit: {{TARGET_FAMILIES}}. Search there first, but
you are not limited to them.

## Before you finish

Run this and fix anything it reports:

    python3 - <<'EOF'
    import csv
    valid = {r["class_name"] for r in csv.DictReader(open("ground-truth/snow-ci-classes.csv"))}
    keys = [l.strip() for l in open("mapping/partitions/{{UNIT}}.keys.txt") if l.strip()]
    rows = list(csv.DictReader(open("mapping/partitions/{{UNIT}}.csv")))
    assert [r["dt_entity_key"] for r in rows] == keys, "keys mismatch or wrong order"
    bad = [r for r in rows if r["now_ci_class"] not in valid]
    assert not bad, f"nonexistent classes: {[r['now_ci_class'] for r in bad][:10]}"
    print(f"OK {len(rows)} rows")
    EOF

Report back: the row count, how many landed in each tier, and any key you found
genuinely ambiguous.
```

- [ ] **Step 2: Dispatch the eight research agents in parallel**

Read `mapping/partitions/manifest.json`. For each of the eight units, dispatch one
subagent (`subagent_type: "general-purpose"`) in a single message so they run
concurrently. Each agent's prompt is `mapping/RESEARCH-BRIEF.md` with `{{UNIT}}`
replaced by that unit's `NN-slug` and `{{TARGET_FAMILIES}}` replaced by its
`target_families` list.

Agents write only their own `mapping/partitions/NN-slug.csv`. They never touch a
shared file, so there are no write conflicts.

- [ ] **Step 3: Verify each agent's output independently**

```bash
for f in mapping/partitions/*.csv; do
  base="${f%.csv}"
  exp=$(wc -l < "${base}.keys.txt" | tr -d ' ')
  got=$(( $(wc -l < "$f") - 1 ))
  [ "$exp" = "$got" ] && echo "ok   $f ($got rows)" || echo "FAIL $f exp=$exp got=$got"
done
```
Expected: `ok` for all eight, with row counts 122, 95, 31, 108, 30, 39, 38, 70.

Re-dispatch any unit that failed, with the specific failure in the prompt. Do not
hand-patch an agent's output — the point of the gate is that the output is
reproducible.

- [ ] **Step 4: Write the merge script**

Create `scripts/merge_partitions.py`:

```python
#!/usr/bin/env python3
"""Merge the eight research partitions into one mapping file.

Appends the __unknown__ row, which no unit owns because it is not a real entity
type -- it is the sentinel emitted when a Davis event carries no entity type at
all (2,716 such events in a 30-day window, per spec section 2.2).
"""
import csv
import json
import pathlib
import sys

FIELDS = ["dt_entity_key", "now_ci_class", "bind_strategy", "sgc_managed"]
UNKNOWN_ROW = {
    "dt_entity_key": "__unknown__",
    "now_ci_class": "cmdb_ci",
    "bind_strategy": "ire_correlated",
    "sgc_managed": "false",
}


def main():
    manifest = json.loads(
        pathlib.Path("mapping/partitions/manifest.json").read_text(encoding="utf-8"))
    out = pathlib.Path("mapping/dt_to_snow_cmdb_mapping.csv")

    rows, seen, errors = [], set(), []
    for unit in manifest["units"]:
        path = pathlib.Path(unit["output_file"])
        if not path.exists():
            errors.append(f"missing partition output: {path}")
            continue
        with open(path, newline="", encoding="utf-8") as fh:
            unit_rows = list(csv.DictReader(fh))
        if len(unit_rows) != unit["expected"]:
            errors.append(
                f"{path}: expected {unit['expected']} rows, got {len(unit_rows)}")
        for r in unit_rows:
            key = r["dt_entity_key"].strip()
            if key in seen:
                errors.append(f"{path}: duplicate key across partitions: {key}")
            seen.add(key)
            rows.append({k: (r.get(k) or "").strip() for k in FIELDS})

    rows.append(dict(UNKNOWN_ROW))
    rows.sort(key=lambda r: r["dt_entity_key"])

    if errors:
        for e in errors:
            print(f"FAIL: {e}", file=sys.stderr)
        return 1

    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)

    print(f"PASS: merged {len(rows)} rows into {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 5: Merge and validate**

```bash
python3 scripts/merge_partitions.py
python3 scripts/validate_mapping.py mapping/dt_to_snow_cmdb_mapping.csv
echo "exit=$?"
```
Expected: `PASS: merged 534 rows`, then `PASS: 534 rows valid, 534 keys covered, all classes exist`, `exit=0`.

This is spec check **V2 (533/533 plus the sentinel)**. If the validator fails, fix the offending partition by re-dispatching that unit — never by editing the merged file, which would be overwritten on the next merge.

- [ ] **Step 6: Report tier distribution**

```bash
python3 - <<'EOF'
import csv, collections
rows = list(csv.DictReader(open("mapping/dt_to_snow_cmdb_mapping.csv")))
tier3 = [r for r in rows if r["now_ci_class"] in ("cmdb_ci", "cmdb_ci_appl")]
print(f"total rows      : {len(rows)}")
print(f"tier 3 fallback : {len(tier3)} ({100*len(tier3)//len(rows)}%)")
print("top classes     :")
for c, n in collections.Counter(r["now_ci_class"] for r in rows).most_common(12):
    print(f"  {n:>4}  {c}")
EOF
```

Record the tier-3 percentage in the commit message. It is the honest measure of how much of the long tail resolved to a real technology class, and the baseline for any future mapping improvement.

- [ ] **Step 7: Commit**

```bash
git add mapping/ scripts/merge_partitions.py
git commit -m "feat: map all 533 Dynatrace entity types to verified CMDB classes"
```

---

### Task 5: Upload the lookup table to Grail

**Files:**
- Create: `scripts/upload-lookup.sh`
- Modify: none

**Interfaces:**
- Consumes: `mapping/dt_to_snow_cmdb_mapping.csv` from Task 4.
- Produces: Grail lookup table at `/lookups/dt_to_snow_cmdb_mapping` with lookup field `dt_entity_key`, loadable by `load "/lookups/dt_to_snow_cmdb_mapping"`. Task 6's DQL joins it.

- [ ] **Step 1: Write the upload script**

`dtctl` has no update verb for lookups, so replacing one is delete-then-create. The
script validates before it deletes, so a bad mapping can never destroy the working
table.

Create `scripts/upload-lookup.sh`:

```bash
#!/usr/bin/env bash
# Replace the Grail lookup table. Validates first: a failing mapping aborts before
# the delete, leaving the existing table intact.
set -euo pipefail

SRC="${1:-mapping/dt_to_snow_cmdb_mapping.csv}"
LOOKUP_PATH="/lookups/dt_to_snow_cmdb_mapping"

echo "==> context: $(dtctl config current-context --plain)"
echo "==> validating $SRC"
python3 scripts/validate_mapping.py "$SRC"

echo "==> deleting existing $LOOKUP_PATH (ignored if absent)"
dtctl delete lookup "$LOOKUP_PATH" --plain 2>/dev/null || true

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
```

- [ ] **Step 2: Dry-run the create to confirm the parse pattern**

```bash
chmod +x scripts/upload-lookup.sh
dtctl create lookup -f mapping/dt_to_snow_cmdb_mapping.csv \
  --path /lookups/dt_to_snow_cmdb_mapping \
  --lookup-field dt_entity_key --dry-run --plain
```
Expected: a preview showing the four auto-detected columns `dt_entity_key`,
`now_ci_class`, `bind_strategy`, `sgc_managed` and no error. If the header row is
being treated as data, add `--skip-records 1` (already in the script).

- [ ] **Step 3: Upload**

Run: `./scripts/upload-lookup.sh`
Expected: validator PASS, then a `rows` count of `534`.

- [ ] **Step 4: Verify the join works against live event data**

This is the real acceptance test — the lookup must join to actual Davis events, not
just exist:

```bash
dtctl query 'fetch dt.davis.events, from:-24h
| fieldsAdd raw = coalesce(smartscape.affected_entity.types, affected_entity_types)
| expand raw
| fieldsAdd dt_entity_key = if(isNull(raw), "__unknown__", else: lower(if(startsWith(raw, "dt.entity."), substring(raw, from: 10), else: raw)))
| lookup [load "/lookups/dt_to_snow_cmdb_mapping"], sourceField: dt_entity_key, lookupField: dt_entity_key, fields: {now_ci_class, bind_strategy, sgc_managed}
| summarize events = count(), by: {dt_entity_key, now_ci_class, bind_strategy}
| sort events desc | limit 20' -o json --plain
```
Expected: every row has a non-null `now_ci_class`. `host` resolves to a server class
with `bind_strategy=sgc_host`; `service` to `cmdb_ci_service_calculated` with
`sgc_service`; `process` to `cmdb_ci_appl` with `sgc_process`; `k8s_pod` and the
K8s family to `cmdb_ci_kubernetes_*`.

A null `now_ci_class` means a live entity type is missing from the table — capture
the key, add it to the owning partition, re-run Task 4 steps 4 through 7, and
re-upload.

- [ ] **Step 5: Commit**

```bash
git add scripts/upload-lookup.sh
git commit -m "feat: add lookup upload script and publish 534-row mapping to Grail"
```

---

### Task 6: Rewrite the extract_events DQL

Replaces defect D4's ~24,000-character three-stage `coalesce()` with a bounded query. Verified standalone before it is embedded in the workflow, so a DQL error can never be confused with a workflow error.

**Files:**
- Create: `dynatrace/dql/extract_events.dql`
- Create: `dynatrace/dql/checks/normalization.dql`
- Create: `dynatrace/dql/checks/lookup-coverage.dql`

**Interfaces:**
- Consumes: the Grail lookup table from Task 5.
- Produces: a DQL query emitting one row per Davis event with these fields, which Task 7's workflow references by name: `event.id`, `event.name`, `event.category`, `event.severity`, `event.status`, `event.description`, `dt_entity_key`, `dt_entity_id`, `dt_entity_name`, `now_ci_class`, `bind_strategy`, `sgc_managed`, `dt.davis.is_rootcause_relevant`, `dt_problem_display_id`, `dt_problem_url`, `timestamp`.

- [ ] **Step 1: Write the normalization check first**

Create `dynatrace/dql/checks/normalization.dql`. This asserts spec §6's central claim — that both topology vocabularies converge:

```
fetch dt.davis.events, from:-24h
| fieldsAdd raw = coalesce(smartscape.affected_entity.types, affected_entity_types)
| expand raw
| fieldsAdd dt_entity_key = if(isNull(raw), "__unknown__",
    else: lower(if(startsWith(raw, "dt.entity."), substring(raw, from: 10), else: raw)))
| summarize events = count(), raw_forms = collectDistinct(raw), by: {dt_entity_key}
| filter arraySize(raw_forms) > 1
| sort events desc
```

- [ ] **Step 2: Run it and confirm convergence**

Run: `dtctl query -f dynatrace/dql/checks/normalization.dql -o json --plain`
Expected: at least one row where `dt_entity_key` is `service` and `raw_forms`
contains both `SERVICE` and `dt.entity.service`. That single row is the proof that
one lookup table serves both topology models. If no such row appears, widen the
window to `-7d` before concluding anything.

- [ ] **Step 3: Write the extract query**

Create `dynatrace/dql/extract_events.dql`. The `{{ }}` expressions are Dynatrace
workflow Jinja templating and are inert outside a workflow — Step 4 substitutes
literals to verify the DQL itself:

```
fetch events, from:"{{event()["timestamp"]}}"-5m, to:"{{event()["timestamp"]}}"+5m
| filter event.kind == "DAVIS_EVENT"
| filter in(event.id, {{event()["dt.davis.event_ids"] | replace("[", "{") | replace("]", "}") | replace("'", "\"")}})
| dedup event.id, sort:{timestamp desc}
| filterOut dt.davis.is_frequent_event == true
| fieldsAdd dt_raw_type = arrayFirst(coalesce(smartscape.affected_entity.types, affected_entity_types))
| fieldsAdd dt_entity_key = if(isNull(dt_raw_type), "__unknown__",
    else: lower(if(startsWith(dt_raw_type, "dt.entity."), substring(dt_raw_type, from: 10), else: dt_raw_type)))
| fieldsAdd dt_entity_id = toString(dt.smartscape_source.id)
| fieldsAdd dt_entity_name = coalesce(getNodeName(dt.smartscape_source.id), arrayFirst(affected_entity_names))
| fieldsAdd dt_problem_display_id = "{{ event()['display_id'] }}"
| fieldsAdd dt_problem_url = concat("https://bwm98081.apps.dynatrace.com/ui/apps/dynatrace.davis.problems/problem/", "{{ event()['event.id'] }}")
| lookup [load "/lookups/dt_to_snow_cmdb_mapping"],
    sourceField: dt_entity_key, lookupField: dt_entity_key,
    fields: {now_ci_class, bind_strategy, sgc_managed}
| fields event.id, event.name, event.category, event.severity, event.status,
    event.description, dt_entity_key, dt_entity_id, dt_entity_name,
    now_ci_class, bind_strategy, sgc_managed,
    dt.davis.is_rootcause_relevant, dt_problem_display_id, dt_problem_url, timestamp
```

Note `dt_entity_name` deliberately has only two fallback terms. Per spec §8.2 it must
**not** grow a per-type `dt.entity.*.name` enumeration — that is defect D4. When both
terms are null the event ships with a null name and the gap surfaces in Task 9's
bind-rate report.

- [ ] **Step 4: Verify the DQL with the templating stripped**

Substitute literals for the Jinja expressions and verify:

```bash
sed -e 's|from:"{{event()\["timestamp"\]}}"-5m, to:"{{event()\["timestamp"\]}}"+5m|from:-6h|' \
    -e '/filter in(event.id/d' \
    -e 's|"{{ event()\[.display_id.\] }}"|"P-TEST"|' \
    -e "s|\"{{ event()\['event.id'\] }}\"|\"E-TEST\"|" \
    dynatrace/dql/extract_events.dql > /tmp/extract_literal.dql
dtctl verify query -f /tmp/extract_literal.dql --plain
```
Expected: `✔ Query is valid`

- [ ] **Step 5: Run it against live data and check every field is populated**

```bash
dtctl query -f /tmp/extract_literal.dql -o json --plain | python3 -c '
import json, sys
d = json.load(sys.stdin); res = d.get("result")
rows = res.get("records", []) if isinstance(res, dict) else (res or [])
print(f"rows: {len(rows)}")
required = ["dt_entity_key", "dt_entity_id", "now_ci_class", "bind_strategy"]
for f in required:
    nulls = sum(1 for r in rows if r.get(f) in (None, ""))
    print(f"  {f:<16} null in {nulls}/{len(rows)}")
for r in rows[:5]:
    print(f"    {r.get(\"dt_entity_key\"):<14} -> {r.get(\"now_ci_class\")} "
          f"[{r.get(\"bind_strategy\")}] {str(r.get(\"dt_entity_name\"))[:30]}")
'
```
Expected: `now_ci_class` and `bind_strategy` null in **0** rows — every live event
type is covered by the lookup. `dt_entity_name` may have a small number of nulls;
record the count as the Task 9 baseline.

- [ ] **Step 6: Confirm the frequent-event gate is working**

```bash
dtctl query 'fetch events, from:-6h | filter event.kind == "DAVIS_EVENT"
| summarize total = count(), frequent = countIf(dt.davis.is_frequent_event == true)' -o json --plain
```
Record both numbers. `frequent` is the volume DEC-6 keeps out of ServiceNow.

- [ ] **Step 7: Commit**

```bash
git add dynatrace/dql/
git commit -m "feat: rewrite extract_events DQL with canonical entity key normalization"
```

---

### Task 7: Deploy Dynatrace workflow v3

Fixes defect D1 — the loop-variable inconsistency that made every event in a problem report the first event's entity.

**Files:**
- Create: `dynatrace/workflows/dt-problems-to-snow-itom.yaml`
- Modify: live workflow `7c35a230-d8bf-4379-8137-43b8ad000f3d`

**Interfaces:**
- Consumes: `dynatrace/dql/extract_events.dql` from Task 6.
- Produces: `em_event` records in ServiceNow, one per Davis event, with the field mapping in spec §8.3. Tasks 9 through 12 consume these records.

- [ ] **Step 1: Export the live workflow as the editing baseline**

```bash
mkdir -p dynatrace/workflows
dtctl get workflow 7c35a230-d8bf-4379-8137-43b8ad000f3d -o yaml --plain \
  > dynatrace/workflows/dt-problems-to-snow-itom.yaml
git add dynatrace/workflows/ && git commit -m "chore: capture workflow v2 baseline before edit"
```

Committing the untouched export first means the v3 diff is reviewable and the
rollback is `git checkout` plus one apply.

- [ ] **Step 2: Replace the extract_events query**

In `dynatrace/workflows/dt-problems-to-snow-itom.yaml`, replace the entire
`tasks.extract_events.input.query` value with the contents of
`dynatrace/dql/extract_events.dql`. Also delete the `customSampleResult` block on
that task — it caches the old schema and will mislead the workflow editor.

- [ ] **Step 3: Fix every field to reference the loop item**

This is the defect D1 fix. In `tasks.send_event_to_servicenow.input.fields`, replace
the whole list. Every `value` must reference `_.item`, never `records[0]`:

```yaml
fields:
  - id: f-message-key
    key: message_key
    value: '{{ _.item["event.id"] }}'
  - id: f-source
    key: source
    value: "{{ input('snow_source') }}"
  - id: f-severity
    key: severity
    value: '{{ 0 if _.item["event.status"] == "CLOSED" else _.item["event.severity"] }}'
  - id: f-event-class
    key: event_class
    value: '{{ _.item["event.category"] }}'
  - id: f-resource
    key: resource
    value: '{{ _.item["dt_entity_name"] }}'
  - id: f-node
    key: node
    value: '{{ _.item["dt_entity_name"] }}'
  - id: f-metric-name
    key: metric_name
    value: '{{ _.item["event.name"] }}'
  - id: f-type
    key: type
    value: '{{ _.item["dt_entity_key"] }}'
  - id: f-ci-type
    key: ci_type
    value: '{{ _.item["now_ci_class"] }}'
  - id: f-description
    key: description
    value: '[{{ _.item["dt_problem_display_id"] }}] {{ _.item["event.name"] }} - {{ _.item["event.description"] | default("", true) | truncate(900, true) }}'
  - id: f-additional-info
    key: additional_info
    value: '{{ _.item }}'
```

`additional_info` carries the whole item, so `dt_entity_id`, `bind_strategy`,
`sgc_managed`, `dt.davis.is_rootcause_relevant`, and `dt_problem_url` all reach
ServiceNow for Tasks 9 through 12 without needing their own fields.

Leave `withItems`, `concurrency`, `conditions`, and `connectionId` untouched.

- [ ] **Step 4: Make the cluster filter an input**

In `trigger.eventTrigger.triggerConfiguration.value`, change `customFilter` from the
hardcoded `matchesValue(k8s.cluster.name, "aeric-walls-aks")` to
`{{ input('scope_filter') }}`, and add the input alongside the existing two:

```yaml
input:
  snow_source: Dynatrace
  snow_table: em_event
  scope_filter: matchesValue(k8s.cluster.name, "aeric-walls-aks")
```

Scope stays exactly as it is today. Widening it is a volume decision reserved for the
user (spec §13).

- [ ] **Step 5: Diff before applying**

```bash
dtctl diff -f dynatrace/workflows/dt-problems-to-snow-itom.yaml --plain
```
Expected: changes confined to the DQL query, the eleven field values, and the new
input. **If the diff touches the trigger's `filterQuery`, `uniqueExpression`, or
`connectionId`, stop** — those are working and out of scope.

- [ ] **Step 6: Apply**

```bash
dtctl config current-context --plain   # must print: tacocorp
dtctl apply -f dynatrace/workflows/dt-problems-to-snow-itom.yaml --plain
```
Expected: update confirmed against ID `7c35a230-d8bf-4379-8137-43b8ad000f3d`. A
`version` warning is benign.

- [ ] **Step 7: Record the ServiceNow baseline before the first v3 run**

```bash
npx --yes @servicenow/sdk query em_event -q 'sourceLIKEDynatrace^ORDERBYDESCsys_created_on' \
  --limit 1 -f sys_id,sys_created_on -o json -a pdi
```
Note the timestamp. Everything after it is v3 output.

- [ ] **Step 8: Execute against a real problem and verify fan-out (spec V3, V4)**

Trigger a run — either wait for a live problem or execute the workflow manually:

```bash
dtctl exec workflow 7c35a230-d8bf-4379-8137-43b8ad000f3d --plain
dtctl get workflow-executions --plain | head -5
```

Then check the emitted events, substituting the Step 7 timestamp:

```bash
npx --yes @servicenow/sdk query em_event \
  -q 'sourceLIKEDynatrace^sys_created_on>javascript:gs.dateGenerate("<TIMESTAMP>")' \
  --limit 200 -f message_key,type,ci_type,resource,node,severity -o json -a pdi \
| python3 -c '
import json, sys, collections
rows = json.load(sys.stdin).get("records", [])
print(f"events: {len(rows)}")
print(f"distinct message_key : {len({r[\"message_key\"] for r in rows})}")
print(f"distinct resource    : {len({r[\"resource\"] for r in rows})}")
print("ci_type spread:", dict(collections.Counter(r["ci_type"] for r in rows)))
print("type spread   :", dict(collections.Counter(r["type"] for r in rows)))
'
```

Pass conditions:
- **V3** — distinct `message_key` equals the event count (no collapsing), and
  distinct `resource` is greater than 1 when the problem spans multiple entities.
- **V4** — `ci_type` spread contains more than one class when `type` spread does. The
  v2 failure signature was 99/100 events all `cmdb_ci_service_calculated`; seeing that
  again means a field is still bound to `records[0]`.

- [ ] **Step 9: Commit**

```bash
git add dynatrace/workflows/dt-problems-to-snow-itom.yaml
git commit -m "fix: bind every ServiceNow event field to the loop item, not records[0]"
```

---

### Task 8: ServiceNow Fluent project scaffold

Establishes the deployable unit and proves the build-and-install round trip before any ITOM config depends on it.

**Files:**
- Create: `servicenow/now.config.json` (generated by `now-sdk init`)
- Create: `servicenow/src/index.now.ts`
- Create: `servicenow/package.json` (generated)

**Interfaces:**
- Consumes: nothing.
- Produces: a deployable scoped app on the `pdi` instance. Tasks 9 through 13 add `Record()` definitions under `servicenow/src/` and redeploy with the same `now-sdk build && now-sdk deploy` cycle.

- [ ] **Step 1: Run the mandatory SDK orientation**

The `now-sdk` skill requires this before any Fluent work, and the docs are versioned
with the installed SDK. Run all three, then read every topic both lists return, plus
`keys-file` by name:

```bash
cd servicenow
npx @servicenow/sdk explain quickstart --list --format=raw
npx @servicenow/sdk explain fluent-language --list --format=raw
npx @servicenow/sdk --help
npx @servicenow/sdk explain keys-file --format=raw
```

**If any topic contradicts the Fluent code in Tasks 9 through 13, the orientation
output wins.** Those tasks were written against `record-api` as documented by SDK
4.11.2; a different installed version may differ.

- [ ] **Step 2: Initialize the app**

```bash
mkdir -p servicenow && cd servicenow
npx @servicenow/sdk init --auth pdi
```
Answer prompts with app name `Dynatrace AIOps Event Pipeline` and a scope the
instance accepts. Record the resulting scope name — Tasks 9 through 13 need it.

- [ ] **Step 3: Verify the empty app builds and installs**

```bash
cd servicenow
npx @servicenow/sdk build
npx @servicenow/sdk deploy --auth pdi
```
Expected: build succeeds, install reports success. This proves auth and packaging
work while there is nothing to debug but the toolchain.

- [ ] **Step 4: Confirm the app is on the instance**

```bash
npx --yes @servicenow/sdk query sys_app -q 'nameLIKEDynatrace AIOps' \
  -f name,scope,version -o json -a pdi
```
Expected: one record.

- [ ] **Step 5: Commit**

```bash
cd .. && git add servicenow/ && git commit -m "feat: scaffold ServiceNow Fluent app for Dynatrace AIOps pipeline"
```

---

### Task 9: Event rules and CI binding

The fix for defects D2 and D3. Baseline to beat: **0 of 100** Dynatrace events bound to a CI.

**Files:**
- Create: `servicenow/src/event-rules/*.now.ts`
- Create: `scripts/bind-rate-report.sh`
- Modify: `dynatrace/dql/extract_events.dql` (adds `dt_ci_name`)

**Interfaces:**
- Consumes: `em_event` records from Task 7 carrying `additional_info.bind_strategy`, `additional_info.dt_entity_id`, `additional_info.dt_entity_name`.
- Produces: `em_match_rule` records that set `ci_type` and resolve `em_event.ci_identifier`, plus `scripts/bind-rate-report.sh` which Tasks 10 through 12 reuse as their regression check.

- [ ] **Step 1: Write the bind-rate report first**

This is the test. It must run and show the failing baseline before any rule exists.

Create `scripts/bind-rate-report.sh`:

```bash
#!/usr/bin/env bash
# Spec check V5. Reports CI bind rate for Dynatrace-sourced events, grouped by the
# Dynatrace entity key carried in additional_info.
set -euo pipefail
LIMIT="${1:-500}"

npx --yes @servicenow/sdk query em_event \
  -q 'sourceLIKEDynatrace^ORDERBYDESCsys_created_on' \
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
print(f"{\"dt_entity_key\":<26} {\"bound\":>7} {\"total\":>7}  rate")
for k, v in sorted(by_key.items(), key=lambda x: -x[1]["total"]):
    rate = 100 * v["bound"] // v["total"] if v["total"] else 0
    print(f"{k:<26} {v[\"bound\"]:>7} {v[\"total\"]:>7}  {rate}%")
'
```

- [ ] **Step 2: Run it and record the failing baseline**

```bash
chmod +x scripts/bind-rate-report.sh
./scripts/bind-rate-report.sh 100
```
Expected: an overall bind rate at or near **0%**. Save this output — it is the
before-picture for the whole task.

- [ ] **Step 3: Add the SGC-shaped CI name to the Dynatrace query**

Binding needs the name in the shape SGC actually wrote, which differs per class
(spec §2.1 D2). Compose it in Dynatrace where the topology is available, not in
ServiceNow where it is not. Append to `dynatrace/dql/extract_events.dql`, before the
final `fields` line:

```
| fieldsAdd dt_ci_name = if(bind_strategy == "sgc_service", concat(dt_entity_name, " - ", dt_entity_id),
    else: dt_entity_name)
```

and add `dt_ci_name` to the `fields` list.

`sgc_service` is handled here because the composition is pure string work. `sgc_host`
passes the bare name through, which is already correct. **`sgc_process` needs the
parent host name** to build SGC's `<proc>@<host>` form — attempt it with a Smartscape
traversal from the process to its host:

```bash
dtctl verify query 'smartscapeNodes "PROCESS" | limit 5
| fieldsAdd host_name = getNodeName(getNodeField(id, "runsOn"))' --plain
```

If that verifies, extend `dt_ci_name` with a third branch for `sgc_process`. **If it
does not verify, do not invent a traversal** — instead set `bind_strategy` to
`ire_correlated` for the `process` key in the mapping CSV, re-run Task 5, and let IRE
match on `correlation_id`. Record which path was taken.

Re-verify and re-apply the workflow:

```bash
dtctl verify query -f /tmp/extract_literal.dql --plain
dtctl apply -f dynatrace/workflows/dt-problems-to-snow-itom.yaml --plain
```

Then add the field to `send_event_to_servicenow` so ServiceNow receives it:

```yaml
  - id: f-ci-name
    key: node
    value: '{{ _.item["dt_ci_name"] }}'
```

replacing the earlier `f-node` entry.

- [ ] **Step 4: Capture an existing event rule as a Fluent template**

The `em_match_rule` `filter`, `simple_filter`, and `identification_rules` fields hold
intricate encoded JSON — the `@@EventRule@@_N` token format is not worth reverse
engineering by hand. Convert a working rule instead:

```bash
cd servicenow
npx @servicenow/sdk transform --auth pdi \
  --table em_match_rule --sys-id 8cbb229067250300998d35e457415acb
```

That sys_id is the "Azure Metrics Virtual Machines" rule, confirmed present on this
instance and confirmed to use `bind`, `bind_type`, `ci_type`, and
`identification_rules`. Read the generated Fluent to learn the exact field shapes,
then write ours against it.

- [ ] **Step 5: Write the four binding rules**

Create `servicenow/src/event-rules/dynatrace-binding.now.ts`. One rule per bind
strategy from spec §9.2. `identification_rules` maps an `additional_info` field to a
CI attribute for a target class — that is the mechanism, learned from the template in
Step 4:

```typescript
import { Record } from '@servicenow/sdk/core'

// Reserved order band 8000-8099 so these never shadow the 57 pre-existing rules.
// Confirm the band with the user before deploying (spec section 9.3).

Record({
    $id: Now.ID['dt-bind-sgc-host'],
    table: 'em_match_rule',
    data: {
        name: 'Dynatrace - bind host events to server CI',
        active: true,
        order: 8010,
        table: 'em_event',
        bind: true,
        bind_type: 1,
        transform: true,
        ignore_event: false,
        ci_type: 'cmdb_ci_computer',
        identification_rules: JSON.stringify([
            {
                ciType: 'cmdb_ci_computer',
                role: 'primary',
                attributes: [
                    { attribute: 'name', value: 'node', ruleName: 'name', ciType: 'cmdb_ci_computer' },
                ],
            },
        ]),
    },
})

Record({
    $id: Now.ID['dt-bind-sgc-service'],
    table: 'em_match_rule',
    data: {
        name: 'Dynatrace - bind service events to calculated service CI',
        active: true,
        order: 8020,
        table: 'em_event',
        bind: true,
        bind_type: 1,
        transform: true,
        ignore_event: false,
        ci_type: 'cmdb_ci_service_calculated',
        identification_rules: JSON.stringify([
            {
                ciType: 'cmdb_ci_service_calculated',
                role: 'primary',
                attributes: [
                    { attribute: 'name', value: 'node', ruleName: 'name', ciType: 'cmdb_ci_service_calculated' },
                ],
            },
        ]),
    },
})

Record({
    $id: Now.ID['dt-bind-sgc-process'],
    table: 'em_match_rule',
    data: {
        name: 'Dynatrace - bind process events to application CI',
        active: true,
        order: 8030,
        table: 'em_event',
        bind: true,
        bind_type: 1,
        transform: true,
        ignore_event: false,
        ci_type: 'cmdb_ci_appl',
        identification_rules: JSON.stringify([
            {
                ciType: 'cmdb_ci_appl',
                role: 'primary',
                attributes: [
                    { attribute: 'name', value: 'node', ruleName: 'name', ciType: 'cmdb_ci_appl' },
                ],
            },
        ]),
    },
})

Record({
    $id: Now.ID['dt-bind-ire-correlated'],
    table: 'em_match_rule',
    data: {
        name: 'Dynatrace - bind remaining entity types via correlation id',
        active: true,
        order: 8090, // last: catch-all for every non-SGC entity type
        table: 'em_event',
        bind: true,
        bind_type: 1,
        transform: true,
        ignore_event: false,
        ci_type: 'cmdb_ci',
        identification_rules: JSON.stringify([
            {
                ciType: 'cmdb_ci',
                role: 'primary',
                attributes: [
                    { attribute: 'correlation_id', value: 'dt_entity_id', ruleName: 'correlation_id', ciType: 'cmdb_ci' },
                    { attribute: 'name', value: 'node', ruleName: 'name', ciType: 'cmdb_ci' },
                ],
            },
        ]),
    },
})
```

**Scoping.** `em_match_rule` has **no `source` column** — verified against
`sys_dictionary`. Its 37 columns are exactly: `active, additional_info_filter,
assignment_group, bind, bind_fallbacks, bind_type, ci_type, close_alert_freq,
close_alert_int, close_alert_op, close_alert_value, create_alert_freq,
create_alert_int, create_alert_op, create_alert_value, description, event_class,
event_data, filter, identification_rules, ignore_event, is_ui16_compatible, metric,
name, order, rule_mapping_counter, rule_version, run_ignore_before_enrich,
search_additional_rules, simple_filter, sys_domain, sys_id, sys_overrides, table,
threshold, threshold_alert_template, transform`. Setting any field outside that list
will fail at deploy.

Scope each rule two ways instead:

- `filter` / `simple_filter` — an encoded query over `em_event` carrying
  `source=Dynatrace` plus the rule's own condition.
- `additional_info_filter` — conditions over the event's `additional_info` JSON,
  which is where `bind_strategy` lives.

Both encodings use the instance-specific `@@EventRule@@_N` token format. Copy the
shape from the template read in Step 4 and substitute values; never hand-compose it.

Also consider `bind_fallbacks`, which lets a rule attempt a secondary identification
when the primary misses — directly useful for the `ire_correlated` catch-all.

- [ ] **Step 6: Confirm the order band with the user before deploying**

The band is 8000-8099. Check nothing existing occupies it:

```bash
npx --yes @servicenow/sdk query em_match_rule -q 'order>=8000^order<=8099' \
  -f name,order,active -o json -a pdi
```
Expected: zero records. **If any record returns, stop and ask the user** which band to
use — this is the confirmation spec §9.3 and §13 reserve for them.

- [ ] **Step 7: Deploy**

```bash
cd servicenow && npx @servicenow/sdk build && npx @servicenow/sdk deploy --auth pdi && cd ..
```

- [ ] **Step 8: Re-run the workflow and measure the bind rate (spec V4, V5)**

```bash
dtctl exec workflow 7c35a230-d8bf-4379-8137-43b8ad000f3d --plain
sleep 90
./scripts/bind-rate-report.sh 200
```

Pass condition: overall bind rate is materially above the 0% baseline from Step 2,
and the `sgc_host`, `sgc_service`, and `sgc_process` keys (`host`, `service`,
`process`) are at or near 100% — those three have exact, verified name shapes and
have no excuse to miss.

Per-key rates below 100% for `ire_correlated` keys are expected and acceptable: those
CIs may simply not exist in CMDB. That is information, not a defect. Record the
per-key table.

- [ ] **Step 9: Commit**

```bash
git add servicenow/src/event-rules/ scripts/bind-rate-report.sh dynatrace/dql/ dynatrace/workflows/
git commit -m "feat: bind Dynatrace events to CIs with per-class identifier strategies"
```

---

### Task 9b: Backfill simulated CMDB CIs to test binding coverage

Added mid-run (not part of the original plan). Task 9 confirmed the binding mechanism
works, but on this PDI most non-`host`/`service`/`process` classes have zero matching
CMDB CIs to bind to at all — that is a gap in this test instance's CMDB population, not
in the mapping (in a real customer environment the CMDB is populated from many
discovery sources). User directed: backfill simulated CMDB data, generated from live
Dynatrace topology so names match byte-for-byte, to test whether binding actually
works when a matching CI exists. Mark every backfilled record with
`discovery_source = SIM-Dynatrace-Test` and ship a teardown script.

**Known going in (do not re-derive):**
- `host` and `service` CMDB CIs already exist with exact-match names for every entity
  currently producing events — no backfill needed for these two classes.
- Per `mapping/dt_to_snow_cmdb_mapping.csv`, only `host`, `service`, and `process` use
  `bind_strategy` `sgc_host`/`sgc_service`/`sgc_process` with name-based
  `em_match_rule` identification (Task 9). Every other class — including all `k8s_*`
  and `frontend` — is `ire_correlated`, matching on `correlation_id`, which is
  confirmed always empty on SGC-created CIs (defect D3). **Backfilling CMDB names for
  those classes is not expected to make them bind** — that is the open question this
  task exists to answer empirically, not a defect to fix here. Record the actual
  result either way.
- The exact figures cited in earlier session notes for "how many entities need
  backfill" are stale (tenant traffic and workflow cadence have moved on). Re-derive
  the current scope live in Step 1 rather than trusting a hardcoded count.

**Files:**
- Create: `servicenow/src/fluent/cmdb-backfill/*.now.ts` (write mechanism confirmed;
  must live under `src/fluent/`, not a sibling directory — see Step 2)
- Create: `scripts/neutralize-cmdb-backfill.sh` (renamed from `teardown-...` — see
  Step 2's ruling: CMDB CI records cannot be physically deleted on this PDI, so
  cleanup means renaming them inert, not removing the rows)
- Modify: `docs/execution/execution-ledger.md` or equivalent — record the per-class
  bind-rate table from Step 5

**Interfaces:**
- Consumes: `scripts/bind-rate-report.sh` (Task 9) as both the before/after
  measurement and the source of which `dt_entity_key` values currently have
  unbound events.
- Produces: CMDB CI records tagged `discovery_source = SIM-Dynatrace-Test`, and a
  neutralize script that renames exactly those records to an inert form.

- [ ] **Step 1: Determine current scope from live data, not from old notes**

Run `scripts/bind-rate-report.sh 500` first to see which `dt_entity_key` values
currently have unbound events. Then, for `process`, `k8s_pod`, `k8s_deployment`,
`k8s_namespace`, `k8s_node`, `k8s_cluster`, `frontend`, and `browser_monitor`, pull
the distinct entity names actually needed via DQL against `dt.davis.events` (same
`dt_entity_key` derivation as `dynatrace/dql/extract_events.dql`), for example:

```
fetch dt.davis.events, from:-24h
| fieldsAdd dt_raw_type = arrayFirst(coalesce(smartscape.affected_entity.types, affected_entity_types))
| fieldsAdd dt_entity_key = if(isNull(dt_raw_type), "__unknown__",
    else: lower(if(startsWith(dt_raw_type, "dt.entity."), substring(dt_raw_type, from: 10), else: dt_raw_type)))
| filter dt_entity_key == "<class>"
| fieldsAdd dt_entity_id = toString(dt.smartscape_source.id)
| fieldsAdd dt_entity_name = coalesce(getNodeName(dt.smartscape_source.id), arrayFirst(affected_entity_names))
| summarize count(), by:{dt_entity_id, dt_entity_name}
| sort `count()` desc
| limit 20
```

Run via `dtctl query '<dql>' --plain` (not `dtctl verify query`, which only
validates). **Cap each class at the 20 most-frequent entities in the last 24h** —
Ruling: full tenant Smartscape topology for `process` and `k8s_pod` alone is in the
tens of thousands of entities system-wide, three to four orders of magnitude more
than needed to prove or disprove the binding mechanism; a bounded, most-active sample
is sufficient and keeps the write volume to the live PDI sane. If wrong, re-run with a
different limit — cheap to redo.

For `process`, additionally join the `runs_on` edge to the parent host (same pattern
as Task 9 Step 3 / `dynatrace/dql/extract_events.dql`) so you can compose the exact
`<proc>@<host>` name the `sgc_process` identification rule searches for.

For each class, query the corresponding CMDB table (mapping in
`mapping/dt_to_snow_cmdb_mapping.csv`: `process`→`cmdb_ci_appl`,
`k8s_pod`→`cmdb_ci_kubernetes_pod`, `k8s_deployment`→`cmdb_ci_kubernetes_deployment`,
`k8s_namespace`→`cmdb_ci_kubernetes_namespace`, `k8s_node`→`cmdb_ci_kubernetes_node`,
`k8s_cluster`→`cmdb_ci_kubernetes_cluster`, `frontend`→`cmdb_ci_web_application`,
`browser_monitor`→`cmdb_ci`) via `now-sdk query <table> -q 'nameIN<comma-list>'
-f name -o json -a pdi` to find which of the 20 already exist. Backfill only the
missing ones.

- [ ] **Step 2: Write mechanism and teardown contract (already investigated — read before doing anything)**

A prior implementer already investigated this step and reported BLOCKED; you are
resuming with that investigation done and a ruling from the user. Do not repeat the
investigation — read `.superpowers/sdd/2026-09-05-dynatrace-servicenow-aiops/task-9b-report.md`
in full first, then proceed from these established facts:

- **Write path confirmed working**: a `Record()` block in a `.now.ts` file, built and
  installed via `npx @servicenow/sdk build && npx @servicenow/sdk install --auth pdi`.
  **Layout constraint confirmed the hard way**: the build only picks up `.now.ts`
  files under `servicenow/src/fluent/` (or a subdirectory of it) — a sibling
  directory like `servicenow/src/cmdb-backfill/` is silently ignored (no error, no
  entry in the generated `src/fluent/generated/keys.ts` manifest). Put backfill
  source under `servicenow/src/fluent/cmdb-backfill/`.
- **Physical deletion of CMDB CI records is confirmed NOT possible** via any
  mechanism available in this environment: code-removal + rebuild + redeploy,
  explicit `Now.del()`, and full `install --reinstall` were all tried against a live
  throwaway `cmdb_ci_appl` test record and none removed it (a control test against a
  non-CMDB table worked, isolating this to CMDB CI tables specifically — almost
  certainly ServiceNow's standard CMDB delete-protection). **Do not re-attempt these
  or invent a new deletion mechanism** — this is settled, not open.
- One orphaned test CI is already live on the PDI from that investigation
  (`cmdb_ci_appl` sys_id `d235f3db8c3a470b8987048a07d7ad58`, name
  `TEARDOWN-VERIFY-TEST-SIM-Dynatrace`, `discovery_source=SIM-Dynatrace-Test`). User
  decision: **leave it in place** — it is correctly tagged and harmless. Do not spend
  further effort trying to remove it.

**Ruling (user decision, carried into this brief): redefine "teardown" as
neutralize, not delete.** Since these CMDB CI records cannot be physically removed
on this PDI, "teardown" for this task means: rename every backfilled record (matched
by `discovery_source = "SIM-Dynatrace-Test"`) to a name that cannot byte-for-byte
match any real Dynatrace-composed `dt_ci_name`/`dt_entity_name` — e.g. prefix with
`ZZ-RETIRED-` — so it stops being a live binding target, without deleting the row.
This changes the task's deliverable from a delete script to a neutralize (rename)
script; update every reference to "teardown" below accordingly.

- [ ] **Step 3: Create the backfill records**

One Fluent source file per class under `servicenow/src/fluent/cmdb-backfill/` (e.g.
`servicenow/src/fluent/cmdb-backfill/dynatrace-backfill-process.now.ts`), each
`Record()` setting at minimum `name` (the exact composed name from Step 1) and
`discovery_source: "SIM-Dynatrace-Test"`. Use `now-sdk transform` against an existing
record of the same class first (same pattern as Task 9 Step 4) to learn which other
fields are required for a valid insert on this instance — do not guess required
fields.

Build and deploy:

```bash
cd servicenow && npx @servicenow/sdk build && npx @servicenow/sdk deploy --auth pdi && cd ..
```

- [ ] **Step 4: Write and test the neutralize (formerly "teardown") script**

`scripts/neutralize-cmdb-backfill.sh` (rename from `teardown-cmdb-backfill.sh` per
the Step 2 ruling) — queries every record with `discovery_source =
"SIM-Dynatrace-Test"` across the 8 backfill target tables (plus the pre-existing
orphan in `cmdb_ci_appl`, for completeness, though it's already inert enough to
leave alone per the user's decision) and renames each to a `ZZ-RETIRED-<original
name>` form. Since `now-sdk query` is read-only, use the same Fluent
build/install write path as Step 3 to apply the rename (an `Update()`-style
`Record()` targeting the same sys_ids, or equivalent — follow whatever update
pattern `now-sdk explain` or the Fluent docs show for modifying existing records by
sys_id). Test it against one of the Step 3 records first and confirm via
`now-sdk query` that the name changed before treating it as done.

- [ ] **Step 5: Re-run the workflow and measure**

```bash
dtctl exec workflow 7c35a230-d8bf-4379-8137-43b8ad000f3d --plain
sleep 90
./scripts/bind-rate-report.sh 500
```

Record the per-class table. Expected and acceptable: `process` improves materially
(it has a working name-based identification rule); `k8s_*`, `frontend`, and
`browser_monitor` most likely stay at 0% bound despite the CI now existing, because
`ire_correlated` needs `correlation_id`, which the backfilled CIs don't have — **this
outcome, if observed, answers Task 9's open question and is not a task failure.** If
any of them instead do bind, that's an important, unexpected finding — capture what
made it bind (e.g. IRE falling through to a secondary name-only match) since it
changes the answer to Task 9's open question.

- [ ] **Step 6: Commit**

```bash
git add servicenow/src/fluent/cmdb-backfill/ scripts/neutralize-cmdb-backfill.sh
git commit -m "feat: backfill simulated CMDB CIs to test binding coverage for non-SGC classes"
```

---

### Task 10: Alert correlation and primary alert

**Files:**
- Create: `servicenow/src/correlation/dynatrace-problem-grouping.now.ts`

**Interfaces:**
- Consumes: `em_alert` records whose events carry `additional_info.dynatrace_problem_id` and `additional_info.dt.davis.is_rootcause_relevant`.
- Produces: one `em_agg_group` per Davis problem. Task 11 fires on that group's primary alert.

- [ ] **Step 1: Record the pre-change grouping baseline**

```bash
npx --yes @servicenow/sdk query em_agg_group -q 'ORDERBYDESCsys_created_on' \
  --limit 20 -f sys_id,sys_created_on -o json -a pdi
```
Note the newest timestamp; groups after it are attributable to this task.

- [ ] **Step 2: Write the correlation rule**

Create `servicenow/src/correlation/dynatrace-problem-grouping.now.ts`:

```typescript
import { Record } from '@servicenow/sdk/core'

// Spec DEC-4: Davis grouping arrives intact, then ServiceNow refines.
// Tag-based correlation on the Davis problem id -- one problem, one alert group.
Record({
    $id: Now.ID['dt-correlate-by-problem'],
    table: 'em_alert_correlation_rule',
    data: {
        name: 'Dynatrace - group alerts by Davis problem id',
        active: true,
        description:
            'Groups all alerts originating from one Dynatrace Davis problem into a ' +
            'single aggregation group, preserving Davis root cause analysis.',
        order: 100,
    },
})
```

The instance already ships tag-based correlation rules — all currently
`active: false`. Read one first to copy its exact grouping-field structure:

```bash
npx --yes @servicenow/sdk query em_alert_correlation_rule \
  -q 'nameLIKETag Based' --limit 1 -o json -a pdi
```

`em_alert_correlation_rule`'s real columns are `active, advanced, advanced_filter,
custom_group_description, description, filter_child, filter_parent,
generate_virtual_alerts, name, order, override_group_description, relationship,
relationship_type, rule_origin, script, sys_domain, sys_id, sys_overrides, table,
time_difference` (verified against `sys_dictionary`). Grouping is expressed through
`filter_parent` and `filter_child`, or through `script` when `advanced` is true.

Set `filter_parent` and `filter_child` so both sides match on the
`additional_info` key `dynatrace_problem_id`, following the exact encoding the
query above returns. Do not add fields outside the verified column list.

- [ ] **Step 3: Deploy**

```bash
cd servicenow && npx @servicenow/sdk build && npx @servicenow/sdk deploy --auth pdi && cd ..
```

- [ ] **Step 4: Verify one problem produces one group (spec V6)**

```bash
dtctl exec workflow 7c35a230-d8bf-4379-8137-43b8ad000f3d --plain
sleep 120
npx --yes @servicenow/sdk query em_agg_group -q 'ORDERBYDESCsys_created_on' \
  --limit 10 -f sys_id,primary_alert,alerts_count,sys_created_on -o json -a pdi
```

Pass conditions:
- One group per Davis problem, not one per event.
- `alerts_count` on that group equals the number of events the workflow emitted for
  that problem.
- `primary_alert` is populated and points at the alert whose event carried
  `is_rootcause_relevant == true`.

Verify the primary is the right one:

```bash
npx --yes @servicenow/sdk query em_alert -q 'sys_id=<PRIMARY_ALERT_SYS_ID>' \
  -f additional_info,description -o json -a pdi | grep -o 'is_rootcause_relevant[^,]*'
```
Expected: `true`.

- [ ] **Step 5: Commit**

```bash
git add servicenow/src/correlation/
git commit -m "feat: correlate Dynatrace alerts into one group per Davis problem"
```

---

### Task 11: Incident promotion from the primary alert

The highest-leverage noise control in the design: N alerts produce exactly one incident.

**Files:**
- Create: `servicenow/src/alert-management/dynatrace-incident-promotion.now.ts`

**Interfaces:**
- Consumes: the `em_agg_group` and its `primary_alert` from Task 10.
- Produces: one `incident` per Davis problem, linked to the bound CI.

- [ ] **Step 1: Write the promotion rule**

Create `servicenow/src/alert-management/dynatrace-incident-promotion.now.ts`:

```typescript
import { Record } from '@servicenow/sdk/core'

// Spec section 11: fires ONLY on an aggregation group's primary alert.
// A rule that fires on supporting alerts produces one incident per event, which
// is the exact noise problem this pipeline exists to solve.
Record({
    $id: Now.ID['dt-promote-primary-to-incident'],
    table: 'em_alert_management_rule',
    data: {
        name: 'Dynatrace - create incident from Davis root cause alert',
        active: true,
        order: 8010,
        description:
            'Creates one incident per Dynatrace Davis problem, from the root cause ' +
            'alert only. Supporting alerts in the group do not create incidents.',
    },
})
```

Read an existing active rule for the exact condition and action field shapes:

```bash
npx --yes @servicenow/sdk query em_alert_management_rule -q 'active=true' \
  --limit 1 -o json -a pdi
```

`em_alert_management_rule`'s real columns are `active, additional_info,
alert_filter, assignment_group, automatic_execution_setting, description, error_msg,
incident_template, kb, migrated_from, multiple_alert_rules, name, order,
overwrite_template, state, submit_counter, sys_domain, sys_id, sys_overrides, type`
(verified against `sys_dictionary`).

Use `alert_filter` for the condition - it must require both that the alert is its
group's primary and that `source` is `Dynatrace`. Use `incident_template` (a
reference to `em_incident_template`) to carry the Davis problem ID, the
`dt_problem_url` deep link, the bound CI, and the impacted service. Set `type` to the
incident-creation value the existing active rule uses.

- [ ] **Step 2: Deploy**

```bash
cd servicenow && npx @servicenow/sdk build && npx @servicenow/sdk deploy --auth pdi && cd ..
```

- [ ] **Step 3: Verify one incident per problem (spec V7)**

```bash
dtctl exec workflow 7c35a230-d8bf-4379-8137-43b8ad000f3d --plain
sleep 150
npx --yes @servicenow/sdk query incident \
  -q 'short_descriptionLIKEP-^ORDERBYDESCsys_created_on' \
  --limit 20 -f number,short_description,cmdb_ci,sys_created_on -o json -a pdi
```

Pass conditions:
- Exactly **one** incident per Davis problem ID. More than one means the rule is
  firing on supporting alerts — fix the primary-alert condition, do not filter
  downstream.
- `cmdb_ci` is populated, proving Task 9's binding carried through to the incident.

- [ ] **Step 4: Commit**

```bash
git add servicenow/src/alert-management/
git commit -m "feat: promote only Davis root cause alerts to incidents"
```

---

### Task 12: Close-path verification

No new configuration. Proves the lifecycle closes, which nothing so far has tested.

**Files:**
- Create: `dynatrace/dql/checks/close-path.dql`

**Interfaces:**
- Consumes: everything from Tasks 7 through 11.
- Produces: a documented pass or fail for spec check V8.

- [ ] **Step 1: Find a Davis problem that closed recently**

Create `dynatrace/dql/checks/close-path.dql`:

```
fetch dt.davis.problems, from:-24h
| filter event.status == "CLOSED" and not(dt.davis.is_duplicate)
| fields display_id, event.id, event.name, event.start, event.end
| sort event.end desc
| limit 10
```

Run: `dtctl query -f dynatrace/dql/checks/close-path.dql -o json --plain`

- [ ] **Step 2: Confirm severity 0 events were emitted for it**

Using the `display_id` from Step 1:

```bash
npx --yes @servicenow/sdk query em_event \
  -q 'sourceLIKEDynatrace^descriptionLIKE<DISPLAY_ID>^severity=0' \
  --limit 50 -f message_key,severity,resolution_state -o json -a pdi
```
Expected: at least one severity-0 event whose `message_key` matches an earlier
non-zero event for the same problem. Matching `message_key` is what makes ServiceNow
treat it as a close rather than a new event.

- [ ] **Step 3: Confirm the alert resolved and the group closed (spec V8)**

```bash
npx --yes @servicenow/sdk query em_alert -q 'message_key=<MESSAGE_KEY>' \
  -f state,severity,sys_updated_on -o json -a pdi
```
Expected: `state` is `Closed`.

Then confirm the group:

```bash
npx --yes @servicenow/sdk query em_agg_group -q 'sys_id=<GROUP_SYS_ID>' \
  -f state,alerts_count -o json -a pdi
```
Expected: the group is no longer active.

- [ ] **Step 4: Record the result**

Append a `## Verification results` section to
`docs/superpowers/specs/2026-09-05-dynatrace-servicenow-aiops-design.md` with the
measured outcome of V1 through V8, including the bind-rate table from Task 9 Step 8.
The spec's §2.1 evidence table was the before-picture; this is the after-picture.

- [ ] **Step 5: Commit**

```bash
git add dynatrace/dql/checks/close-path.dql docs/superpowers/specs/
git commit -m "test: verify close path and record V1-V8 results"
```

---

### Task 13: Operator telemetry pull-back

Deterministic Dynatrace queries from the ServiceNow alert. Built before the AI layer because the AI layer is a wrapper over it.

**Files:**
- Create: `servicenow/src/alert-actions/dynatrace-telemetry.now.ts`
- Create: `docs/USER-SETUP.md`

**Interfaces:**
- Consumes: `em_alert` records whose `additional_info` carries `dt_entity_id` and `dt_problem_url`.
- Produces: alert-context actions that return Dynatrace logs and metrics for the bound entity.

- [ ] **Step 1: Write the user setup document**

The credential is the user's to create (spec §13). Create `docs/USER-SETUP.md`:

```markdown
# User setup steps

These require your action. Claude cannot and should not do them.

## 1. Dynatrace API token

Create a token at Settings > Access Tokens with **only** these scopes:

- `storage:logs:read`
- `storage:metrics:read`
- `storage:events:read`

Do not grant write scopes. This integration only reads.

## 2. ServiceNow credential record

Store the token as a credential on `dev285073`. Do not paste it into any file in
this repository.

## 3. Connection alias

Point a connection alias at `https://bwm98081.apps.dynatrace.com/` using the
credential from step 2. The alias name must match the one referenced in
`servicenow/src/alert-actions/dynatrace-telemetry.now.ts`.

## 4. Confirm the event rule order band

Rules deploy into order band 8000-8099. Confirm nothing you depend on occupies it.

## 5. Publish the Now Assist skill (Task 14)

Skill publication is a licensed, UI-gated flow. The skill logic is delivered as
source; you publish it.
```

- [ ] **Step 2: Write the rule container and its child actions**

`em_alert_management_action` is an abstract parent with only five columns — `active,
execution, executions_limit, management_rule, sys_id` — verified against
`sys_dictionary`. **It has no `name` column.** Actions are children of an
`em_alert_management_rule` via `management_rule`, and the concrete behaviour comes
from the subclass:

| Subclass | Extra columns | Use for |
|---|---|---|
| `em_launch_application` | `display_name`, `url` | opening a URL |
| `em_alert_man_m2m_rule_flow` | `sub_flow`, `link_to_flow_designer` | running a subflow |

`em_launch_application.url` substitutes alert fields with `${field}` syntax. A
verified example from this instance:

```
/$ngbsm.do?&id=${cmdb_ci.sys_id}&mapScriptID=...&level=20
```

Create `servicenow/src/alert-actions/dynatrace-telemetry.now.ts` with one
`em_alert_management_rule` container plus three child actions:

```typescript
import { Record } from '@servicenow/sdk/core'

Record({
    $id: Now.ID['dt-telemetry-rule'],
    table: 'em_alert_management_rule',
    data: {
        name: 'Dynatrace - operator telemetry actions',
        active: true,
        order: 8100,
        description: 'Pull Dynatrace logs and metrics for the alert bound entity.',
        // alert_filter: encoded query scoping to source=Dynatrace. Copy the
        // encoding from an existing active rule; do not hand-compose it.
    },
})

Record({
    $id: Now.ID['dt-action-open-problem'],
    table: 'em_launch_application',
    data: {
        active: true,
        execution: 1,
        executions_limit: 1,
        management_rule: Now.ID['dt-telemetry-rule'],
        display_name: 'Open problem in Dynatrace',
        url: '', // set in Step 2b once substitution is verified
    },
})
```

- [ ] **Step 2b: Verify whether `${}` substitution can reach the problem URL**

`dt_problem_url` lives inside the alert's `additional_info` JSON, and `${field}`
substitution is documented for alert columns, not JSON keys. Test before relying on it:

```bash
npx --yes @servicenow/sdk query sys_dictionary -q 'name=em_alert^elementISNOTEMPTY' \
  --limit 200 -f element -o json -a pdi | python3 -c '
import json, sys
els = sorted(r["element"] for r in json.load(sys.stdin).get("records", []))
print(len(els), "columns"); print(", ".join(els))
'
```

Two outcomes, both acceptable — pick based on what the query shows:

- **A plain alert column can carry the URL.** Set `url` to that `${...}` expression.
  If the column exists but is empty, amend the Dynatrace workflow to populate it.
  Simplest path.
- **No column can carry it.** Then all three actions become
  `em_alert_man_m2m_rule_flow` records pointing at a subflow that reads
  `additional_info`, parses `dt_problem_url` and `dt_entity_id`, and acts. More work,
  but the only correct option if substitution cannot reach JSON.

Record which outcome applied and why. Do not guess — the query answers it.

- [ ] **Step 2c: Add the two DQL actions**

Add two more child actions of the same rule:

1. **Fetch logs for this entity** — calls the Dynatrace DQL execution API with
   `fetch logs, from:-30m | filter matchesValue(dt.entity.*, "<dt_entity_id>") | limit 100`,
   writing results to the alert's work notes.
2. **Fetch related metrics** — runs a `timeseries` query for the entity over the 30
   minutes around the alert.

Both need the credential from `docs/USER-SETUP.md`, so both are
`em_alert_man_m2m_rule_flow` records regardless of Step 2b's outcome — a subflow is
where the connection alias is usable.

Build the launch action first: it is the only one that works before the user
completes setup, so it proves the wiring independently of the credential.

- [ ] **Step 3: Deploy and verify the credential-free action**

```bash
cd servicenow && npx @servicenow/sdk build && npx @servicenow/sdk deploy --auth pdi && cd ..

# The rule container (has a name column)
npx --yes @servicenow/sdk query em_alert_management_rule \
  -q 'nameLIKEDynatrace' -f name,active,order -o json -a pdi

# Its child actions, queried by parent since actions have no name column
npx --yes @servicenow/sdk query em_alert_management_action \
  -q 'management_rule.nameLIKEDynatrace' \
  -f sys_class_name,active,execution,management_rule -o json -a pdi
```
Expected: one rule, three child actions. Open a Dynatrace alert in Service Operations
Workspace and confirm "Open problem in Dynatrace" navigates to the correct problem.
- [ ] **Step 4: Verify the DQL actions once the user has completed setup**

Actions one and two cannot be verified until `docs/USER-SETUP.md` steps 1 through 3
are done. **Do not mark this task complete on action three alone** — report clearly
that two of three actions are blocked on the user, and which step unblocks them.

- [ ] **Step 5: Commit**

```bash
git add servicenow/src/alert-actions/ docs/USER-SETUP.md
git commit -m "feat: add Dynatrace telemetry pull-back actions on ServiceNow alerts"
```

---

### Task 14: Now Assist / Otto skill source

Delivered as source. Publication is the user's step (spec §13).

**Files:**
- Create: `servicenow/src/alert-actions/dynatrace-now-assist-skill.now.ts`
- Modify: `docs/USER-SETUP.md`

**Interfaces:**
- Consumes: the three actions from Task 13.
- Produces: a Now Assist skill definition wrapping them for natural-language use.

- [ ] **Step 1: Read the AI agent docs**

```bash
cd servicenow
npx @servicenow/sdk explain aiagent-api --format=raw
npx @servicenow/sdk explain building-ai-agents-tools-guide --format=raw
```
The instance has Now Assist Core 29.3.10 and the Otto context menu 3.0.6, so the
`AiAgent` API is the right surface.

- [ ] **Step 2: Write the skill definition**

Create `servicenow/src/alert-actions/dynatrace-now-assist-skill.now.ts` defining an
agent whose tools are Task 13's three actions, scoped to the `em_alert` table, so an
operator can ask "show me the logs for this alert" and have it resolve
`additional_info.dt_entity_id` and run the corresponding action.

Follow the exact `AiAgent` shape from Step 1's output. Do not invent tool schemas.

- [ ] **Step 3: Build and confirm it packages**

```bash
cd servicenow && npx @servicenow/sdk build && cd ..
```
Expected: build succeeds. Deployment is fine; **activation and publication are the
user's step** and must not be attempted here.

- [ ] **Step 4: Append the publication step to the setup doc**

Add to `docs/USER-SETUP.md` under step 5 the exact navigation path to publish the
skill, and note that until it is published the Task 13 actions remain available
directly from the alert form.

- [ ] **Step 5: Commit**

```bash
git add servicenow/src/alert-actions/ docs/USER-SETUP.md
git commit -m "feat: add Now Assist skill wrapping Dynatrace telemetry actions"
```

---

## Handoff summary

After Task 14, these remain with the user and are listed in `docs/USER-SETUP.md`:

| Item | Blocks |
|---|---|
| Dynatrace API token with read-only storage scopes | Task 13 actions 1 and 2 |
| ServiceNow credential record | Task 13 actions 1 and 2 |
| Connection alias to the Dynatrace tenant | Task 13 actions 1 and 2 |
| Confirming the 8000-8099 event rule order band | Task 9 Step 6 (blocking) |
| Publishing the Now Assist skill | Task 14 |
| Deciding whether to widen the k8s cluster scope filter | Production rollout |
