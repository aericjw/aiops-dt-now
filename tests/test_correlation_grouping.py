"""Pytest wrapper for tests/test_correlation_grouping.js (I7, final review).

The actual test logic lives in the Node script -- it extracts the live
`script: `...`` template literal straight out of
servicenow/src/fluent/correlation/dynatrace-problem-grouping.now.ts and runs
it against stub GlideRecord/GlideDateTime objects for the four
PRIMARY/SECONDARY cases, plus a direct regression check that the deployed
regex text contains a real \\s token (the C1 defect class). This wrapper
just shells out to Node so the test participates in `python3 -m pytest
tests/`, consistent with this repo's existing CLI-subprocess test pattern
(see test_validate_mapping.py).
"""
import pathlib
import shutil
import subprocess

import pytest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_correlation_grouping_script_logic():
    result = subprocess.run(
        ["node", str(REPO_ROOT / "tests" / "test_correlation_grouping.js")],
        cwd=str(REPO_ROOT),
        capture_output=True, text=True,
    )
    assert result.returncode == 0, (
        f"correlation grouping regression test failed:\n"
        f"stdout: {result.stdout}\nstderr: {result.stderr}"
    )
    assert "ALL PASS" in result.stdout
