import csv
import pathlib
import subprocess
import sys
import tempfile

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
FIXTURES = pathlib.Path(__file__).resolve().parent / "fixtures" / "merge"


def run_merge(out_path):
    return subprocess.run(
        [sys.executable, str(REPO_ROOT / "scripts" / "merge_partitions.py"),
         str(FIXTURES / "manifest.json"),
         str(FIXTURES / "manifest-grail.json"),
         str(out_path)],
        cwd=str(FIXTURES),
        capture_output=True, text=True,
    )


def test_merge_combines_classic_and_grail_units_with_no_duplicates():
    """Merging a classic unit and a Grail unit should succeed and produce
    rows with no duplicate dt_entity_key, including the __unknown__ sentinel."""
    with tempfile.TemporaryDirectory() as tmp:
        out_path = pathlib.Path(tmp) / "merged.csv"
        result = run_merge(out_path)
        assert result.returncode == 0, f"stderr: {result.stderr}"
        assert "PASS" in result.stdout

        rows = list(csv.DictReader(open(out_path, newline="", encoding="utf-8")))
        keys = [r["dt_entity_key"] for r in rows]
        assert len(keys) == len(set(keys)), "duplicate dt_entity_key in merged output"

        # 2 rows from the classic unit + 2 from the grail unit + the sentinel
        assert len(rows) == 5
        assert "__unknown__" in keys
        assert "host" in keys        # classic-only
        assert "k8s_pod" in keys     # grail-only


def test_merge_reports_duplicate_key_across_partitions():
    """A key present in both a classic and grail partition must be flagged,
    not silently merged."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = pathlib.Path(tmp)

        # Duplicate "host" into the grail fixture's output file via a temp
        # manifest pointing at a modified copy, so the shared fixtures stay
        # untouched.
        grail_csv = tmp_path / "09-grail-smartscape.csv"
        grail_csv.write_text(
            "dt_entity_key,now_ci_class,bind_strategy,sgc_managed\n"
            "host,cmdb_ci_computer,sgc_host,true\n"
            "process,cmdb_ci_appl,sgc_process,true\n",
            encoding="utf-8",
        )
        grail_manifest = tmp_path / "manifest-grail.json"
        grail_manifest.write_text(
            '{"units": [{"id": "09", "slug": "grail-smartscape", '
            f'"keys_file": "unused.txt", "output_file": "{grail_csv}", '
            '"expected": 2, "target_families": ["cmdb_ci"]}]}',
            encoding="utf-8",
        )

        out_path = tmp_path / "merged.csv"
        result = subprocess.run(
            [sys.executable, str(REPO_ROOT / "scripts" / "merge_partitions.py"),
             str(FIXTURES / "manifest.json"),
             str(grail_manifest),
             str(out_path)],
            cwd=str(FIXTURES),
            capture_output=True, text=True,
        )
        assert result.returncode == 1
        assert "duplicate" in result.stderr.lower()
        assert "host" in result.stderr
