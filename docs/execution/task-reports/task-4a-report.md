# Task 4, Phase A: Research Brief and Merge Script

## Status: DONE

## Commits Created
- `2676070` feat: add research brief template and partition merge script

## Summary
Completed steps 1 and 4 as instructed: created the research brief template that will be distributed to 8 research agents with placeholder substitution, and created the merge script that will combine their outputs.

## What Was Written

### Step 1: mapping/RESEARCH-BRIEF.md
Created research instruction template for the 8 parallel research agents. The document contains:
- Clear input/output specifications
- Hard rules for CMDB class validation
- Mapping tier hierarchy (Tier 1/2/3)
- Research methodology for Dynatrace entity types
- Pre-submission validation script

**Placeholders preserved (verbatim):**
- `{{UNIT}}` appears 5 times in the document
- `{{TARGET_FAMILIES}}` appears 1 time

The file is byte-faithful to the brief, with no placeholders expanded or removed.

### Step 4: scripts/merge_partitions.py
Created Python script to merge 8 partition CSV files. The script:
- Reads partition manifest from `mapping/partitions/manifest.json`
- Validates each partition CSV exists and contains expected row count
- Checks for duplicate entity keys across partitions
- Strips whitespace from all fields
- Appends the `__unknown__` sentinel row
- Sorts output by entity key
- Writes merged output to `mapping/dt_to_snow_cmdb_mapping.csv`
- Reports row count and validates exit code

## Verification

### Placeholder Integrity
```
$ grep "UNIT" mapping/RESEARCH-BRIEF.md | wc -l
5
$ grep "TARGET_FAMILIES" mapping/RESEARCH-BRIEF.md | wc -l
1
```
Confirmed: placeholders survive intact in committed file.

### No Partition CSVs Created
```
$ ls -la mapping/partitions/*.csv 2>&1
(eval):1: no matches found: mapping/partitions/*.csv
$ ls -la mapping/*.csv 2>&1
(eval):1: no matches found: mapping/*.csv
```
Confirmed: no CSV files created, as required.

### No Subagents Dispatched
No subagents were spawned. The task explicitly instructed that step 2 (dispatch 8 research agents) is handled by the controller, not by this phase.

### Test Suite Status
Ran full test suite after file creation:
```
16 passed in 0.08s
```

All tests remain passing:
- test_make_partitions.py (4 tests)
- test_validate_mapping.py (12 tests)

### Files Changed
```
mapping/RESEARCH-BRIEF.md   | 74 lines added
scripts/merge_partitions.py | 64 lines added
```

Total: 138 insertions across 2 files.

## Self-Review Findings

1. **Byte Fidelity**: Compared both files character-by-character against the brief. Both are exact matches to the specified text, including all placeholders, indentation, and line breaks.

2. **Placeholder Safety**: Verified that `{{UNIT}}` and `{{TARGET_FAMILIES}}` remain as literal literal text in the committed brief, suitable for controller substitution at agent dispatch time.

3. **Script Validation**: The merge script contains proper error handling:
   - Detects missing partition files
   - Validates row counts against manifest expectations
   - Detects duplicate keys across partitions
   - Strips whitespace safely
   - Produces deterministic output (sorted by entity key)

4. **No Side Effects**: No files outside `mapping/` and `scripts/` were created or modified (except .claude/ which was pre-existing). No data files were generated.

5. **Reproducibility**: Both files are ready for their intended use:
   - Brief is ready for controller to substitute and dispatch to 8 agents
   - Merge script is ready to run after agents complete (currently will fail gracefully with "missing partition output" errors, which is expected)

## Concerns

None. Task 4, Phase A completed as specified. Both files are byte-faithful to the brief, placeholders are intact, no extra work was performed, and the test suite remains green.

## File Paths

- `/Users/aeric/Projects/aiops-dt-now/mapping/RESEARCH-BRIEF.md`
- `/Users/aeric/Projects/aiops-dt-now/scripts/merge_partitions.py`

---
Phase A complete. Awaiting Phase B: controller dispatch of 8 research agents (Steps 2-3), followed by merge/validate/report (Steps 5-7).
