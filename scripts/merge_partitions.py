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
