# Task 4 Phase C report — ninth partition integration

## What was built

1. `ground-truth/dt-smartscape-types.csv` — 23 rows, header
   `dt_entity_key,smartscape_type,already_in_classic`. `already_in_classic`
   computed against `ground-truth/dt-entity-keys.csv` at generation time
   (not hardcoded). Confirms exactly 4 overlaps (`host`, `service`, `disk`,
   `synthetic_location`) and 19 Grail-only types.
2. `scripts/fetch-dt-smartscape-types.sh` — regenerator following the
   conventions of `fetch-dt-entity-keys.sh` / `fetch-snow-ci-classes.sh`
   (`set -euo pipefail`, atomic temp-file + `mv`, fails loudly on empty
   result). Candidate types are a literal hand-maintained list with a
   comment explaining why (no discovery endpoint exists for Smartscape on
   Grail); each is probed with
   `smartscapeNodes "<TYPE>", from:now()-30d | summarize c=count()`.
3. `mapping/partitions/manifest-grail.json` — separate manifest, one unit
   (`09`/`grail-smartscape`, expected 19), same field shape as
   `manifest.json` entries. Kept separate per the ruling since
   `make_partitions.py` regenerates `manifest.json` wholesale.
4. `scripts/validate_mapping.py` — `main()` now unions the `dt_entity_key`
   column of `dt-entity-keys.csv` and `dt-smartscape-types.csv`, plus
   `__unknown__`, before calling `validate()`. Added an optional 4th CLI arg
   for the smartscape ground-truth path (defaults to
   `ground-truth/dt-smartscape-types.csv`), so existing CLI tests could keep
   passing explicit fixtures. `validate()` itself is untouched.
5. `scripts/merge_partitions.py` — now reads both `manifest.json` (units
   01-08) and `manifest-grail.json` (unit 09), unions their units, and
   merges all nine partitions plus the `__unknown__` sentinel. Manifest
   paths and output path are now optional CLI args (defaulting to the
   production paths) so tests can point it at fixture manifests without
   touching real repo files.
6. Tests added:
   - `tests/test_validate_mapping.py::test_key_union_covers_classic_and_grail_only_keys`
     — direct `validate()` test with a classic-only key (`host`) and a
     Grail-only key (`k8s_pod`) in the same valid-key union.
   - `tests/test_validate_mapping.py::test_cli_smartscape_keys_are_included_in_valid_set`
     — CLI-level test using new fixtures
     (`ground-truth-smartscape-sample.csv`, `mapping-with-smartscape-key.csv`)
     proving a Grail-only key (`k8s_deployment`, not in the classic fixture)
     validates once `main()` unions both files.
   - `tests/test_merge_partitions.py` (new file) — merges a fixture classic
     unit and a fixture Grail unit, asserts no duplicate `dt_entity_key` in
     output (including the sentinel), and asserts a separate test that a
     key duplicated across a classic and grail partition is rejected with a
     "duplicate" error naming the key.
   - Updated the three pre-existing CLI tests
     (`test_cli_valid_mapping_exits_zero`, `test_cli_nonexistent_class_exits_one`,
     `test_cli_missing_columns_exits_one_and_reports`, and
     `test_cli_unknown_sentinel_is_added_by_main`) to pass a 4th argument
     pointing at a header-only `tests/fixtures/ground-truth-smartscape.csv`
     fixture, since `main()`'s CLI contract grew a 4th positional arg and
     the real production smartscape file (23 rows) would otherwise silently
     inflate the valid-key universe used by those fixture-scoped tests and
     break their coverage checks.
   - All new fixtures live under `tests/fixtures/` (including a `merge/`
     subdirectory for merge-specific fixtures), and all new tests derive
     paths via `pathlib.Path(__file__)`.

## Merge output (verbatim)

```
PASS: merged 553 rows into mapping/dt_to_snow_cmdb_mapping.csv
exit=0
```

## Validate output (verbatim)

```
PASS: 553 rows valid, 553 keys covered, all classes exist
exit=0
```

## Tier distribution (553 rows)

```
total rows      : 553
tier 3 fallback : 185 (33%)
top classes     :
   126  cmdb_ci_appl
    59  cmdb_ci
    23  cmdb_ci_database
    15  cmdb_ci_function_ai
    14  cmdb_ci_cloud_load_balancer
     9  cmdb_ci_cloud_appserver
     8  cmdb_ci_cloud_queue_service
     8  cmdb_ci_vm_instance
     8  cmdb_ci_network_interface_device
     8  cmdb_ci_disk
     7  cmdb_ci_cloud_messaging_service
     7  cmdb_ci_db_instance
```

## Highest-stakes rows (verbatim, post-merge)

```
host,cmdb_ci_computer,sgc_host,true
process,cmdb_ci_appl,sgc_process,true
service,cmdb_ci_service_calculated,sgc_service,true
```

All three match the required values exactly.

## Test suite

```
20 passed in 0.13s
```

16 pre-existing tests (all in `test_make_partitions.py` and
`test_validate_mapping.py`) remain green; 4 new tests added (1 direct
`validate()` union test, 1 new CLI union test, and 2 in the new
`test_merge_partitions.py`).

## Files changed

- New: `ground-truth/dt-smartscape-types.csv`
- New: `scripts/fetch-dt-smartscape-types.sh`
- New: `mapping/partitions/manifest-grail.json`
- New: `mapping/dt_to_snow_cmdb_mapping.csv` (merged output, 553 rows)
- New: `mapping/partitions/01-cloud-azure.csv` through
  `08-middleware-apps.csv`, `09-grail-smartscape.csv`,
  `09-grail-smartscape.keys.txt` — these existed on disk (per the task
  brief's "what already exists" section) but were untracked in git; added
  to the commit as-is, unmodified.
- Modified: `scripts/validate_mapping.py` (`main()` only; `validate()`
  untouched), `scripts/merge_partitions.py` (multi-manifest merge, optional
  CLI args), `tests/test_validate_mapping.py` (updated CLI invocations +
  new tests)
- New: `tests/test_merge_partitions.py`,
  `tests/fixtures/ground-truth-smartscape.csv`,
  `tests/fixtures/ground-truth-smartscape-sample.csv`,
  `tests/fixtures/mapping-with-smartscape-key.csv`,
  `tests/fixtures/merge/{manifest.json,manifest-grail.json,unit-a.csv,09-grail-smartscape.csv}`
- Untouched (per constraint): `scripts/make_partitions.py`,
  `ground-truth/dt-entity-keys.csv`, all nine partition CSVs' contents.

## Self-review findings

- Confirmed `already_in_classic` in `dt-smartscape-types.csv` was computed
  programmatically against the real `dt-entity-keys.csv`, not hand-typed,
  and it landed on exactly the 4 keys the ruling specified (host, service,
  disk, synthetic_location).
- Confirmed `validate()`'s function signature and body are unchanged; only
  `main()`'s key-loading and argv handling changed.
- Confirmed the CLI-test fixture updates don't weaken coverage: the new
  `ground-truth-smartscape.csv` fixture is header-only (zero extra keys),
  so those tests still validate the same behavior they did before against
  the same classic-key fixture universe.
- Verified `merge_partitions.py`'s duplicate-key detection still fires
  across a classic/grail boundary (new test
  `test_merge_reports_duplicate_key_across_partitions`), not just within a
  single partition.
- Ran the real merge + validate end-to-end against production files (not
  just fixtures) and got exactly 553/553 as expected before committing.

## Concerns

- The `mapping/partitions/01-cloud-azure.csv` .. `08-middleware-apps.csv`
  and `09-grail-smartscape.*` files were untracked in git before this
  commit despite the brief saying they were "already validated by the
  controller." They are now committed verbatim (unmodified) alongside this
  phase's changes since Task 4 had apparently not yet committed them. Worth
  the controller double-checking this wasn't meant to be a separate,
  earlier commit.
- `scripts/fetch-dt-smartscape-types.sh` was written to spec but not
  executed against a live tenant (no live `dtctl` context available in this
  session) — the static `ground-truth/dt-smartscape-types.csv` content was
  generated from the 23 confirmed types given in the task instructions,
  not from a live probe. If the controller wants to confirm the script
  itself is correct end-to-end, it should be run once against `tacocorp`.
