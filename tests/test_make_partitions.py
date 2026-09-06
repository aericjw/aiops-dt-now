import csv
import sys
import pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "scripts"))
from make_partitions import assign_unit, UNITS


def test_ground_truth_coverage_and_exhaustiveness():
    """Verify all 533 keys are classified, counts match expected, no overlaps."""
    repo_root = pathlib.Path(__file__).resolve().parents[1]
    csv_path = repo_root / "ground-truth" / "dt-entity-keys.csv"

    # Read all keys from ground truth
    all_keys = []
    per_unit_keys = {u["id"]: [] for u in UNITS}

    with open(csv_path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            key = row["dt_entity_key"].strip()
            namespace = row["namespace"].strip()
            all_keys.append(key)
            unit_id = assign_unit(key, namespace)
            per_unit_keys[unit_id].append(key)

    # Verify total count
    assert len(all_keys) == 533, f"Expected 533 keys, got {len(all_keys)}"

    # Verify per-unit counts match expected
    unit_id_to_expected = {u["id"]: u["expected"] for u in UNITS}
    for unit_id in sorted(per_unit_keys.keys()):
        actual_count = len(per_unit_keys[unit_id])
        expected_count = unit_id_to_expected[unit_id]
        assert actual_count == expected_count, (
            f"Unit {unit_id}: expected {expected_count} keys, got {actual_count}"
        )

    # Verify all returned ids are in UNITS
    valid_ids = {u["id"] for u in UNITS}
    for unit_id in per_unit_keys.keys():
        assert unit_id in valid_ids, f"Unit id {unit_id} not found in UNITS"

    # Verify no duplicates across units (no key in multiple units)
    all_classified_keys = []
    for keys_list in per_unit_keys.values():
        all_classified_keys.extend(keys_list)
    assert len(all_classified_keys) == len(set(all_classified_keys)), (
        "Found duplicate keys across units (one key classified into multiple units)"
    )

    # Verify union equals input (no key missing)
    assert set(all_classified_keys) == set(all_keys), (
        "Classified keys do not match input keys"
    )


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
