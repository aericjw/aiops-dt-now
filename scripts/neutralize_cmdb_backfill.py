#!/usr/bin/env python3
"""
Task 9b Step 4: "neutralize" backfilled CMDB CI records.

Ruling (carried from task-9b-brief.md / task-9b-report.md): CMDB CI record
deletion is confirmed NOT possible via any write path available in this
environment. Field updates to already-created CMDB CI records were ALSO
tested here and are confirmed to be silently dropped by the same Fluent
build/install write path (sys_mod_count stays 0 across rebuild+redeploy,
even for non-identity fields on freshly-created records - see
task-9b-report.md, Step 4 findings).

This script still performs the textbook "neutralize by rename" mechanism -
rewrite the `name` field in the backfill source under
servicenow/src/fluent/cmdb-backfill/, rebuild, redeploy - and then
independently VERIFIES via `now-sdk query` whether the rename actually
landed on the instance. It does not report success unless the rename is
confirmed live; if the platform drops the write (the expected outcome per
the finding above), it says so explicitly rather than papering over it.

I6 fix (final whole-branch review, 2026-09-08): this script used to leave
the source-rewrite in place even when the live rename was confirmed to
have failed -- recreating, on every run, the exact defect a prior task's
review already caught once (repo source diverging from live reality: the
files say ZZ-RETIRED-..., the live CMDB CI records don't). Since the
docstring above already documents that this rename is EXPECTED to fail on
this platform, running this script with no arguments was guaranteed to
silently damage the repo that way. Fixed: the original contents of every
file under BACKFILL_DIR are captured before rewriting, and restored
automatically if verification does not confirm every record renamed live
(this applies whether or not --skip-build was passed - "not confirmed
live" is the bar, not "no exception was thrown"). The source mutation is
only left in place when the rename is independently verified to have
actually landed.

Usage:
    python3 scripts/neutralize_cmdb_backfill.py [--prefix ZZ-RETIRED-] [--skip-build]
"""
import argparse
import json
import pathlib
import re
import subprocess
import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
SERVICENOW_DIR = REPO_ROOT / "servicenow"
BACKFILL_DIR = SERVICENOW_DIR / "src" / "fluent" / "cmdb-backfill"
NAME_RE = re.compile(r"(name:\s*')((?:\\'|[^'])*)(')")

# class -> table, for post-rename verification (mapping/dt_to_snow_cmdb_mapping.csv)
TABLES = {
    "process": "cmdb_ci_appl",
    "k8s_pod": "cmdb_ci_kubernetes_pod",
    "k8s_deployment": "cmdb_ci_kubernetes_deployment",
    "k8s_namespace": "cmdb_ci_kubernetes_namespace",
    "k8s_node": "cmdb_ci_kubernetes_node",
    "k8s_cluster": "cmdb_ci_kubernetes_cluster",
    "frontend": "cmdb_ci_web_application",
    "browser_monitor": "cmdb_ci",
}


def capture_originals() -> dict:
    """Snapshot the current content of every backfill source file, so it can
    be restored if the live rename this script is about to attempt is not
    confirmed to have landed (I6 fix)."""
    return {path: path.read_text() for path in sorted(BACKFILL_DIR.glob("*.now.ts"))}


def restore_originals(originals: dict) -> None:
    for path, text in originals.items():
        path.write_text(text)
    print(f"==> reverted source rewrite in {len(originals)} file(s) under {BACKFILL_DIR} "
          f"(live rename was not confirmed)")


def rewrite_names(prefix: str) -> int:
    """Prepend `prefix` to every Record() `name` field under BACKFILL_DIR,
    idempotently (skips values already carrying the prefix)."""
    count = 0
    for path in sorted(BACKFILL_DIR.glob("*.now.ts")):
        text = path.read_text()

        def repl(m):
            nonlocal count
            val = m.group(2)
            if val.startswith(prefix):
                return m.group(0)
            count += 1
            return f"{m.group(1)}{prefix}{val}{m.group(3)}"

        new_text = NAME_RE.sub(repl, text)
        if new_text != text:
            path.write_text(new_text)
    return count


def run_now_sdk(args):
    cmd = ["npx", "--yes", "@servicenow/sdk@4.11.2"] + args
    return subprocess.run(cmd, cwd=SERVICENOW_DIR, capture_output=True, text=True)


def build_and_install():
    print("==> now-sdk build")
    r = run_now_sdk(["build"])
    print(r.stdout)
    if r.returncode != 0:
        print(r.stderr, file=sys.stderr)
        sys.exit(f"build failed (exit {r.returncode})")

    print("==> now-sdk install --auth pdi")
    r = run_now_sdk(["install", "--auth", "pdi"])
    print(r.stdout)
    if r.returncode != 0:
        print(r.stderr, file=sys.stderr)
        sys.exit(f"install failed (exit {r.returncode})")


def verify(prefix: str) -> bool:
    print(f"\n==> verifying rename via now-sdk query (prefix={prefix!r})")
    total_ok, total_bad = 0, 0
    for cls, table in TABLES.items():
        r = run_now_sdk([
            "query", table,
            "-q", "discovery_source=SIM-Dynatrace-Test",
            "-f", "sys_id,name",
            "-o", "json",
            "-a", "pdi",
        ])
        if r.returncode != 0:
            print(f"  {cls:16s} ({table}): query FAILED: {r.stderr.strip()}")
            continue
        try:
            records = json.loads(r.stdout).get("records", [])
        except json.JSONDecodeError:
            print(f"  {cls:16s} ({table}): could not parse query output")
            continue
        ok = sum(1 for rec in records if (rec.get("name") or "").startswith(prefix))
        bad = len(records) - ok
        total_ok += ok
        total_bad += bad
        status = (
            "NONE FOUND" if not records
            else "OK" if bad == 0
            else "NOT RENAMED"
        )
        print(f"  {cls:16s} ({table}): {ok}/{len(records)} renamed [{status}]")
    print(f"\nTotal: {total_ok} renamed, {total_bad} NOT renamed")
    return total_bad == 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--prefix", default="ZZ-RETIRED-")
    parser.add_argument(
        "--skip-build", action="store_true",
        help="skip build/install, only rewrite source + verify current instance state",
    )
    args = parser.parse_args()

    if not BACKFILL_DIR.is_dir():
        sys.exit(f"backfill source dir not found: {BACKFILL_DIR}")

    # I6 fix: snapshot before mutating, so the rewrite can be reverted if the
    # live rename this script attempts is not confirmed to have landed.
    originals = capture_originals()

    changed = rewrite_names(args.prefix)
    print(f"==> rewrote {changed} name field(s) in {BACKFILL_DIR}")

    if not args.skip_build:
        build_and_install()

    success = verify(args.prefix)
    if not success:
        restore_originals(originals)
        print(
            "\nWARNING: one or more backfilled CMDB CI records did NOT pick up "
            "the rename. This matches the confirmed finding in task-9b-report.md: "
            "field updates to already-created CMDB CI records are silently dropped "
            "by this PDI's Fluent/now-sdk write path (same class of platform "
            "protection as the confirmed-non-deletable finding). The source "
            "rewrite has been REVERTED (I6 fix, 2026-09-08) since the rename did "
            "not land live -- re-run this script to retry if the underlying "
            "platform protection is ever lifted (e.g. a ServiceNow admin "
            "disabling CMDB CI update protection for this scope, or applying the "
            "rename via a background script instead of the Table/Update-Set API).",
            file=sys.stderr,
        )
        sys.exit(1)
    print("\nAll backfilled records successfully renamed.")


if __name__ == "__main__":
    main()
