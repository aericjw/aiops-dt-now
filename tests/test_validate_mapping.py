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


# CLI tests exercising main() end-to-end
import subprocess
import tempfile


def fixtures_dir():
    return pathlib.Path(__file__).resolve().parent / "fixtures"


def test_cli_valid_mapping_exits_zero():
    """CLI should exit 0 on a valid mapping."""
    result = subprocess.run(
        ["python3", "scripts/validate_mapping.py",
         str(fixtures_dir() / "mapping-valid.csv"),
         str(fixtures_dir() / "ground-truth-keys.csv"),
         str(fixtures_dir() / "ground-truth-classes.csv")],
        cwd="/Users/aeric/Projects/aiops-dt-now",
        capture_output=True, text=True
    )
    assert result.returncode == 0, f"Expected exit 0, got {result.returncode}. stderr: {result.stderr}"
    assert "PASS" in result.stdout


def test_cli_nonexistent_class_exits_one():
    """CLI should exit 1 when a mapping names a class that doesn't exist."""
    result = subprocess.run(
        ["python3", "scripts/validate_mapping.py",
         str(fixtures_dir() / "mapping-bad-class.csv"),
         str(fixtures_dir() / "ground-truth-keys.csv"),
         str(fixtures_dir() / "ground-truth-classes.csv")],
        cwd="/Users/aeric/Projects/aiops-dt-now",
        capture_output=True, text=True
    )
    assert result.returncode == 1, f"Expected exit 1, got {result.returncode}"
    assert "cmdb_ci_nonexistent" in result.stderr
    assert "FAIL" in result.stderr


def test_cli_missing_columns_exits_one_and_reports():
    """CLI should exit 1 and report missing columns when columns are absent."""
    result = subprocess.run(
        ["python3", "scripts/validate_mapping.py",
         str(fixtures_dir() / "mapping-missing-columns.csv"),
         str(fixtures_dir() / "ground-truth-keys.csv"),
         str(fixtures_dir() / "ground-truth-classes.csv")],
        cwd="/Users/aeric/Projects/aiops-dt-now",
        capture_output=True, text=True
    )
    assert result.returncode == 1, f"Expected exit 1, got {result.returncode}"
    assert "missing columns" in result.stderr
    assert "bind_strategy" in result.stderr or "sgc_managed" in result.stderr
    assert "FAIL" in result.stderr


def test_cli_unknown_sentinel_is_added_by_main():
    """The __unknown__ sentinel should be injected by main() into valid keys.

    A mapping whose only extra row (beyond the fixture keys) is __unknown__
    should validate successfully, not be flagged as unknown.
    """
    result = subprocess.run(
        ["python3", "scripts/validate_mapping.py",
         str(fixtures_dir() / "mapping-valid.csv"),
         str(fixtures_dir() / "ground-truth-keys.csv"),
         str(fixtures_dir() / "ground-truth-classes.csv")],
        cwd="/Users/aeric/Projects/aiops-dt-now",
        capture_output=True, text=True
    )
    assert result.returncode == 0, f"Expected exit 0, got {result.returncode}. stderr: {result.stderr}"
    # The mapping-valid.csv includes __unknown__ explicitly, so it should pass
    # without any "not a known entity type" error for __unknown__
    assert "not a known entity type" not in result.stderr
