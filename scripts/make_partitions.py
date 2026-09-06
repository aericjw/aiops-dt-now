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
