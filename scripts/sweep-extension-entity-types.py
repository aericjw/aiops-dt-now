#!/usr/bin/env python3
"""One-off sweep: for every installed Dynatrace extension, pull its
smartscapeNode entity-type definitions via `dtctl describe extension
--assets smartscape` and write them to a flat TSV for building a new
ground-truth CSV. Not part of the regular pipeline; a research tool for
extending mapping/dt_to_snow_cmdb_mapping.csv coverage."""
import json
import subprocess
import sys

exts = json.loads(
    subprocess.run(
        ["dtctl", "get", "extensions", "-o", "json", "--plain"],
        capture_output=True, text=True, timeout=60,
    ).stdout
)["result"]
ext_names = [e["extensionName"] for e in exts]
print(f"{len(ext_names)} extensions found", file=sys.stderr)

rows = []
for i, ext in enumerate(ext_names):
    try:
        proc = subprocess.run(
            ["dtctl", "describe", "extension", ext, "--assets", "smartscape", "-o", "json", "--plain"],
            capture_output=True, text=True, timeout=20,
        )
        d = json.loads(proc.stdout)
        nodes = (d.get("result") or {}).get("smartscape", {}).get("nodes", []) or []
        for n in nodes:
            rows.append((ext, n.get("nodeType"), n.get("nodeIdFieldName"), n.get("description", "")))
        print(f"[{i+1}/{len(ext_names)}] {ext}: {len(nodes)} nodes", file=sys.stderr)
    except subprocess.TimeoutExpired:
        print(f"[{i+1}/{len(ext_names)}] {ext}: TIMEOUT", file=sys.stderr)
    except Exception as e:
        print(f"[{i+1}/{len(ext_names)}] {ext}: ERROR {e}", file=sys.stderr)

with open("/tmp/extension-node-types-raw.tsv", "w") as f:
    for ext, node_type, id_field, desc in rows:
        f.write(f"{ext}\t{node_type}\t{id_field}\t{desc}\n")

print(f"\ntotal node rows: {len(rows)}", file=sys.stderr)
print(f"distinct node types: {len(set(r[1] for r in rows))}", file=sys.stderr)
