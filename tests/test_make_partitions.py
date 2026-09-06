import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "scripts"))
from make_partitions import assign_unit, UNITS

ALL = [
    ("cloud:azure:web:serverfarms", "cloud"),
    ("cloud:aws:sqs", "cloud"),
    ("cloud:gcp:project", "cloud"),
    ("cloud:oci:compute", "cloud"),
    ("host", "__core__"),
    ("sql:postgres_db", "sql"),
    ("mysql:instance", "mysql"),
    ("wmi:com_dynatrace_extension_ad_dhcp", "wmi"),
    ("f5:instance", "f5"),
    ("python:com_dynatrace_extension_meraki_device", "python"),
]


def test_every_key_lands_in_exactly_one_unit():
    for key, ns in ALL:
        units = [u for u in UNITS if assign_unit(key, ns) == u["id"]]
        assert len(units) == 1, f"{key} matched {len(units)} units"


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
