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
              "[dt-entity-keys.csv] [snow-ci-classes.csv] "
              "[dt-smartscape-types.csv]", file=sys.stderr)
        return 2

    mapping_path = pathlib.Path(argv[1])
    keys_path = pathlib.Path(argv[2] if len(argv) > 2
                             else "ground-truth/dt-entity-keys.csv")
    classes_path = pathlib.Path(argv[3] if len(argv) > 3
                                else "ground-truth/snow-ci-classes.csv")
    smartscape_path = pathlib.Path(argv[4] if len(argv) > 4
                                   else "ground-truth/dt-smartscape-types.csv")

    with open(mapping_path, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        missing_cols = [c for c in REQUIRED_COLUMNS if c not in (reader.fieldnames or [])]
        if missing_cols:
            print(f"FAIL: {mapping_path} is missing columns: {missing_cols}",
                  file=sys.stderr)
            return 1
        rows = list(reader)

    # The valid key universe is the union of classic dt.entity.* types and
    # Smartscape-on-Grail types -- two separate topology vocabularies that
    # together cover every dt_entity_key a Davis event can carry. Union, not
    # sum, because a handful of keys (host, service, disk, ...) exist in both.
    valid_keys = (_load_column(keys_path, "dt_entity_key")
                  | _load_column(smartscape_path, "dt_entity_key")
                  | {"__unknown__"})
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
