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
