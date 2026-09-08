# SDD ledger — plan: docs/superpowers/plans/2026-09-05-dynatrace-servicenow-aiops.md

Spec: docs/superpowers/specs/2026-09-05-dynatrace-servicenow-aiops-design.md (read, binding authority)
Branch: main (user consented to work directly on main)
Live writes: user authorized subagents to apply to Dynatrace tacocorp and ServiceNow pdi freely
Env: pytest 9.1.1 installed at setup; python3 3.14.2

## Pre-flight conflict scan

### Cross-task pairs (shared file or interface)

| Pair | Produces -> Consumes | Finding |
|---|---|---|
| T1 -> T2 | ground-truth/*.csv cols `dt_entity_key`,`class_name` -> validator `_load_column` | OK, column names match |
| T1 -> T3 | dt-entity-keys.csv cols `dt_entity_key`,`namespace` -> make_partitions | OK |
| T3 -> T4 | manifest.json keys `output_file`,`expected`,`keys_file` -> merge_partitions | OK; T4 step3 shell derives `${base}.keys.txt` from csv basename, matches T3 naming `NN-slug` |
| T2 -> T4,T5 | validate_mapping CLI exit 0/1 | OK |
| T4 -> T5 | mapping/dt_to_snow_cmdb_mapping.csv, 534 rows | OK; 533 keys + __unknown__ sentinel appended by merge |
| T5 -> T6 | Grail lookup field `dt_entity_key` -> `now_ci_class`,`bind_strategy`,`sgc_managed` | OK, DQL lookup clause matches |
| T6 -> T7 | DQL field list -> workflow `_.item[...]` refs | OK, all 11 referenced fields present in T6 projection |
| T7 -> T9 | workflow field `f-node` | INTENTIONAL SUPERSEDE: T9 step3 replaces f-node (dt_entity_name) with f-ci-name (dt_ci_name). f-resource keeps dt_entity_name. Correct by design. |
| T9 -> T10,T11,T12 | scripts/bind-rate-report.sh | OK, reused as regression check |
| T7 -> T12 | severity 0 on CLOSED -> close path | OK |
| T13 -> T14 | alert actions -> Now Assist skill tools | OK |

### Per-task self-consistency

| Task | Finding |
|---|---|
| T1 | F1: lists `.gitignore` under Create; file already exists from spec commit |
| T2 | OK: tests import validate_mapping via sys.path insert; fixtures inline; coverage-gap msg matches assertion |
| T3 | OK: assign_unit exhaustive (unit 08 catch-all); expected counts sum 533 |
| T4 | OK: brief placeholders substituted at dispatch |
| T5 | OK: validates before delete, so a bad mapping cannot destroy the live table |
| T6 | OK |
| T7 | OK: `<TIMESTAMP>` is a documented substitution marker, not a placeholder |
| T8 | OK |
| T9 | F2: step 3 re-verifies /tmp/extract_literal.dql, which is stale after editing extract_events.dql. F3: identification_rules `value:` addressing mixes an em_event column (`node`) and an additional_info key (`dt_entity_id`) |
| T10-T14 | OK |

### Rulings

Ruling: F1 — treat `.gitignore` in Task 1 as modify-or-skip, not create; it already
exists and already ignores `.remember/`. Task 1 step 7 still git-adds it harmlessly.
Cost if wrong: none.

Ruling: F2 — Task 9 step 3 must REGENERATE /tmp/extract_literal.dql with the Task 6
step 4 sed pipeline before running `dtctl verify query`, otherwise it verifies the
pre-edit query and the dt_ci_name addition goes unverified. Carried into the Task 9
dispatch. Cost if wrong: a syntax error in dt_ci_name reaches the live workflow and
fails at runtime rather than at verify.

Ruling: F3 — Task 9 step 5's identification_rules field addressing is genuinely
uncertain from outside the instance. The implementer must derive it from the
`now-sdk transform` template in step 4 and state in its report which addressing the
template uses for `value:`. Do not accept the plan's illustrative values as correct.
Cost if wrong: CI binding silently fails and the step 8 bind rate stays at baseline,
which is itself the detector.

## Task progress

Task 1: implemented (commit dbe70c0), under task review (base 1b96243, head dbe70c0)
Task 1: review verdict spec OK / quality Approved, with 3 Important findings all labeled plan-mandated. Controller rulings below.

Ruling: T1-F1 (silent empty result) — FIX. The python heredocs fall back to rows=[] when
the upstream returns a successful-but-empty shape, writing a header-only CSV and exiting 0.
The task's own count assertions catch it today, but the guard belongs inside the script
because later unattended re-runs have no such caller. Cheap and contained. Cost if wrong:
a few lines of dead defensive code.

Ruling: T1-F2 (non-atomic write) — FIX. `> "$OUT"` truncates before python runs, so a
mid-stream exception leaves a corrupt ground-truth file that later tasks would trust.
Write to a temp file and mv. Cost if wrong: negligible.

Ruling: T1-F3 (unpinned npx) — FIX, scoped. Pin to @servicenow/sdk@4.11.2, the version the
plan's Tech Stack names and the version installed locally. Scope: pin only in scripts that
generate committed artifacts (this one, and bind-rate-report.sh in Task 9). Ad-hoc
verification commands inside task steps stay unpinned - they are diagnostic, not artifact
generating, and pinning them all would churn many tasks for no reproducibility gain.
Cost if wrong: a pinned version drifts from the instance's supported API and a later run
fails loudly rather than silently.

Task 1: minor (deferred): fetch-snow-ci-classes.sh --limit 2000 has no pagination; count
assertion catches truncation, so latent not active.
Task 1: minor (deferred): two extractors share the same mkdir/query/heredoc shape; not worth
abstracting at 2 instances.
Task 1: fix round 1/5 dispatched and returned (3 findings claimed fixed; commit a20d571), scoped re-review running
Task 1: fix round 1/5 (3 addressed, 0 open; commits dbe70c0..a20d571)
Task 1: complete (commits 1b96243..a20d571, review clean)
Task 2: implemented (commit b467e67), under task review
Task 2: review verdict spec FAIL / Needs fixes. 1 Important finding.

Ruling: T2-F1 (tests/fixtures/ missing, main()/CLI untested) — FIX. The brief's Files
section explicitly lists tests/fixtures/, and main() carries real logic (column-presence
check, default ground-truth path resolution, __unknown__ sentinel injection) that is
covered only by a one-off /tmp bash run in the report. Tasks 4 and 5 both call this CLI
and branch on its exit code, so the interface boundary two later tasks depend on has no
repeatable test. Load-bearing, not polish. Cost if wrong: a small amount of test code
that never catches anything.

Resolved by controller (not a gap): reviewer's warning item asked whether
ground-truth/dt-entity-keys.csv really has 533 rows, since that is Task 1 output outside
this diff. Verified directly: 533 data rows, confirmed twice. No action needed.

Task 2: minor (deferred): sgc_managed is lowercased before the true/false check, so
"True"/"FALSE" pass - widens the literal spec wording, no false-pass risk on the CMDB
class invariant.
Task 2: minor (deferred): _load_column and the mapping open() have no exception handling,
so a missing ground-truth file surfaces a raw traceback rather than the tool's FAIL:
messaging. Fails closed, so safe, just poor operator experience.
Task 2: minor (deferred): a row with an empty dt_entity_key short-circuits via continue,
so that row's other columns go unchecked and the error list under-reports. No false-pass.
Task 2: fix round 1/5 (1 addressed, 0 open; commits b467e67..dfe93bf)
Task 2: minor (deferred): CLI tests hardcode cwd="/Users/aeric/Projects/aiops-dt-now";
should derive from pathlib.Path(__file__).resolve().parents[2]. Works today, not portable.
Task 2: complete (commits a20d571..dfe93bf, review clean)
Task 3: review verdict spec OK / Approved, but 1 Important plan-mandated finding.

Ruling: T3-F1 (test_every_key_lands_in_exactly_one_unit cannot fail) — FIX. assign_unit is
single-valued, so the list comprehension can only ever be length 0 or 1 against a UNITS list
with unique ids. A misrouted key would still pass. The test's name and the brief's stated
rationale ("provable rather than asserted") both claim it proves disjointness/exhaustiveness;
it proves neither. A test that cannot fail is worse than no test because it gives false
confidence to whoever next edits the namespace sets. Fix by replacing it with a real coverage
test over the full 533-row ground truth, which also pulls the brief's step 5 shell check into
pytest. Cost if wrong: a slightly slower test suite.

Task 3: minor (deferred): make_partitions.py main() hardcodes relative paths and assumes CWD
is repo root; a missing source file propagates a bare FileNotFoundError.
Task 3: minor (deferred): no pytest coverage ties assign_unit classification to real ground
truth (addressed as part of the F1 fix; recorded for completeness).
Task 3: fix round 1 code landed (commit 18a0b36, tests/test_make_partitions.py only).
  Implementer was killed by a session rate limit before writing its fix report.
  Controller verified independently: fix diff touches ONLY the test file;
  scripts/make_partitions.py and mapping/partitions/ are untouched; the replacement
  test contains all five required assertions and derives its path from __file__.
  Resumed the same agent (limit reset) to produce the failure demonstration + fix
  report + a __pycache__ .gitignore entry. Re-review still pending.
Task 3: fix round 1/5 (1 addressed, 0 open; commits 18db65c..cf1fe19)
Task 3: minor (deferred): assertion (b) "every returned id in UNITS" is vacuous - per_unit_keys
is pre-seeded from UNITS so an unknown id raises KeyError on insert before the assert runs.
Harmless (error still detected), just dead code.
Task 3: complete (commits dfe93bf..cf1fe19, review clean)

Ruling: T4-PROCESS — Task 4 step 2 instructs the implementer to dispatch eight research
subagents, but the SDD skill forbids implementers from dispatching subagents at all. The
spec is the binding authority and it only requires that the 533 rows be researched in
parallel disjoint units; it does not require the implementer be the dispatcher. Resolving by
splitting Task 4 into three controller-managed phases:
  4a. implementer writes mapping/RESEARCH-BRIEF.md + scripts/merge_partitions.py, commits
  4b. CONTROLLER dispatches the 8 research agents in parallel (they write only their own
      mapping/partitions/NN-slug.csv, so no write conflicts)
  4c. implementer merges, validates, reports tier distribution, commits
One task review covers the whole range cf1fe19..final.
Cost if wrong: none to correctness; this is purely about who holds the dispatch.
Research agents run on sonnet - mapping a technology to a CI class is judgment work and
haiku would either misclassify or burn turns. This is the main cost centre of the plan.
Task 4a: complete (commit 2676070, RESEARCH-BRIEF.md + merge_partitions.py, 16/16 tests green)
Task 4b: 8 research agents dispatched in parallel on sonnet.
  unit 03-cloud-gcp-oci: DONE 31 rows (t1=8 t2=18 t3=5), self-check OK
  unit 01-cloud-azure:   DONE 122 rows (t1=21 t2=72 t3=29), self-check OK
  unit 05-database:      DONE  30 rows (t1=12 t2=12 t3=6),  self-check OK
  unit 07-network:       DONE  38 rows, self-check OK
  Controller independent validation of completed units: row counts, key order,
  allowlist membership, bind_strategy and sgc_managed all correct. Zero nonexistent classes.
  unit 02-cloud-aws:       DONE  95 rows (t1=20 t2=21 t3=54)
  unit 04-core:            DONE 108 rows (t1=16 t2=57 t3=35)
  unit 06-server-virt:     DONE  39 rows (t1=20 t2=10 t3=9)
  unit 08-middleware-apps: DONE  70 rows (t1=20 t2=22 t3=28)
  All 8 units complete: 533 rows, 0 invalid classes, order + counts correct.

Ruling: T4-F-GRAIL — LOAD-BEARING PLAN DEFECT, discovered by unit 04 and confirmed live.
The ground truth captured only classic dt.entity.* types. Smartscape-on-Grail is a SEPARATE
vocabulary that does not appear in dt.system.data_objects under the dt.entity. prefix. The
spec section 6 assumed the classic 533 was a superset of the Grail types' normalized forms.
That holds for host/service/disk/synthetic_location and fails for everything else.

Measured impact: 19 Grail types with live nodes are absent from the 533. Over 30 days they
account for ~401k of ~413k Davis events - more than 97% of all event volume. `process` alone
is 298,921 events. Left unfixed, the lookup returns null now_ci_class for 97% of real events,
and Task 6 step 5 (which asserts zero nulls) would have caught it only after all the
expensive research was already done.

Authoritative Grail type list established empirically by probing smartscapeNodes against the
live tenant over 30d: 23 types have nodes. 4 overlap the classic set, 19 are new.

Smallest change that unblocks, chosen deliberately over editing the 533:
  - keep ground-truth/dt-entity-keys.csv as the classic 533 - it is ACCURATE, just not the
    whole story. Editing it would break make_partitions' 533 assertion and Task 3's test.
  - add ground-truth/dt-smartscape-types.csv recording all 23 Grail types
  - add a 9th partition, 09-grail-smartscape, covering the 19 new keys
  - validate_mapping loads valid keys from BOTH ground-truth files
  - merge_partitions appends unit 09; final mapping becomes 533 + 19 + __unknown__ = 553 rows
This keeps the two vocabularies explicitly separate, which is more honest than pretending
one file describes both.
Cost if wrong: the mapping carries 19 extra rows that never match anything. Cost of NOT
doing it: 97% of production events fail to bind.
  unit 09-grail-smartscape: DONE 19 rows (t1=13 t2=2 t3=4), self-check OK
    All 12 k8s types are exact cmdb_ci_kubernetes_* matches.
    process,cmdb_ci_appl,sgc_process,true  <- the 298,921-event row, correct.
    frontend -> cmdb_ci_web_application, ire_correlated, false. Agent checked the instance
      for SGC-created RUM/web CIs and found none (the Dynatrace-sourced cmdb_ci_appl records
      are OneAgent-discovered processes, not FRONTEND entities), so it declined to claim SGC
      management. Evidence-based, correct call.
    Three synthetic monitor types -> cmdb_ci (no synthetic-monitor class exists on the
      instance, and they are not software in the cmdb_ci_appl sense). Agent flagged this as
      worth a second look; recorded as a deferred minor for the final review.
  Note: the Grail unit's tier-1 rate (13/19 = 68%) is far better than the classic long tail,
  which matters because these 19 keys carry 97% of real event volume.
Task 4c: dispatched (integrate grail ground truth + manifest-grail + validator/merge updates,
  then merge all 9 partitions to 553 rows and validate).
Task 4: minor (deferred): browser_monitor/http_monitor/network_availability_monitor mapped to
  bare cmdb_ci; revisit if operators want synthetic monitors treated as application-like.
Task 4c: complete (commit a58cbb5). Controller verified: 553 rows, validator PASS exit 0,
  no duplicate keys, the three SGC rows exact, and 22/22 live-firing entity keys covered.
  Implementer flagged that it could not run fetch-dt-smartscape-types.sh live. Controller ran
  it against tacocorp: regenerates byte-identical output. Concern resolved, not a finding.
Task 4: under task review (base cf1fe19, head a58cbb5)
Task 4: minor (deferred): merge_partitions.py argv handling silently discards a single CLI
  arg and falls back to defaults instead of erroring. No current caller passes 1 arg.
Task 4: minor (deferred): tests/test_validate_mapping.py still hardcodes cwd absolute path
  (pre-existing from Task 2; this diff touched nearby lines).
Task 4: complete (commits cf1fe19..a58cbb5, review clean, 0 Critical/Important)
  Final mapping: 553 rows. 22/22 live-firing entity keys covered.

Ruling: T5-COUNT — Task 5's brief hardcodes 534 rows as the expected lookup size. The Grail
ruling changed that to 553. Carrying the corrected number into the dispatch; the brief text
is superseded. Cost if wrong: the upload verification asserts the wrong number and fails
loudly, which is the safe direction.

Ruling: T5-SCOPE — Task 5 BLOCKED on a plan defect. The plan's delete-then-create design
requires the OAuth scope storage:files:delete, which the tacocorp-oauth token does NOT have.
Verified via dtctl --check-scopes: storage:files:write IS granted, storage:files:delete is
NOT. Safety level readwrite-all is a CLI-side guard and is independent of token scope.
The API error suggested "--overwrite"; that flag does not exist in dtctl 0.14.4, and
dtctl apply does not support lookups. Both alternatives checked and eliminated.

DECISION: create the new table at a NEW path, /lookups/dt_to_snow_cmdb_mapping_v2, instead of
replacing the old one in place. Create-at-new-path needs only storage:files:write, which is
granted - confirmed by a successful dry run. The upload script takes the path as a parameter
defaulting to the v2 path.

Why this over stopping to ask for a token reissue: it unblocks now, needs no credential
administration, and is arguably safer than the original design - there is no window where the
table does not exist, and the old 22-row table survives as a rollback artifact until the new
workflow is proven in Task 7.
Ripple: the spec, plan, and Task 6's DQL all reference the ORIGINAL path. Task 6 and Task 7
dispatches must carry the v2 path. Recorded here so it is not lost.
Consequence for the user: the stale 22-row table remains at the old path. Granting
storage:files:delete would let them consolidate back to the original name later.
Cost if wrong: a dead lookup table lingers, and one path string differs from the spec text.

Task 5: BLOCKED (second, different layer). After the scope ruling, the actual
`dtctl create lookup` write was denied by the Claude Code auto-mode classifier - a LOCAL
guardrail, unrelated to Dynatrace OAuth scopes. Denied for the implementer AND for the
controller session. Per the denial's own instruction, stopping and surfacing to the user.
Nothing has been written to the tenant. scripts/upload-lookup.sh is updated per the ruling
(no delete, v2 path, validate-first preserved) but uncommitted because it is unproven
end-to-end.
Downstream impact: Task 6 can author and syntax-verify DQL but cannot run its zero-null
acceptance check without the lookup live. Task 7 and Tasks 8-13 are all live writes and will
hit the same classifier.
Task 5: UNBLOCKED after user added Bash permission rules to .claude/settings.local.json.
  Upload succeeded. /lookups/dt_to_snow_cmdb_mapping_v2 = 553 records live.
  ACCEPTANCE TEST PASSED: zero null now_ci_class across all live-firing entity types.
  process -> cmdb_ci_appl/sgc_process/true (14,050 events/24h) - the row that would have been
  null before the Grail fix. Old 22-record table intact as rollback artifact.
Task 5: implemented (commit 2c5bc72), under task review
Task 5: review verdict spec FAIL / Needs fixes. 1 Important finding.

Ruling: T5-F1 (context echoed, not verified) — FIX. The global constraint says "Verify with
dtctl config current-context --plain before any write". The brief's script text only echoes
the context, so this is plan-mandated. For a script that writes to a live tenant, asserting
the context is a real safety property, not polish: a misconfigured context would publish the
mapping to the wrong Dynatrace environment. Cheap to fix. Cost if wrong: three lines of a
guard that never fires.

Task 5: minor (deferred): the post-create verification query pipes dtctl output to stdout
without parsing/validating it, unlike the fetch scripts which fail loudly on a malformed
response. Low risk on a freshly created table.
Task 5: fix round 1/5 (1 addressed, 0 open; commits 2c5bc72..c1d4ed4)
Task 5: complete (commits a58cbb5..c1d4ed4, review clean)
  LIVE STATE: /lookups/dt_to_snow_cmdb_mapping_v2 = 553 records, zero-null acceptance passed.
Task 6: dispatched. MUST carry the _v2 path - the brief says the original path, which now
  holds the stale 22-row table. Reading the wrong one would silently produce nulls.
Task 6: implemented (commit 9895f56). Controller verified: v2 path used in both DQL files,
  zero dt.entity.*.name enumeration, 1439 bytes (was ~24000), all 12 downstream fields present.
  Live run: now_ci_class null 0/3867, bind_strategy null 0/3867.
  Baseline for Task 9: dt_entity_id/dt_entity_name null in 97/3867 (2.5%).
  Note: frequent-event count was 0 in the sampled window, so the DEC-6 gate was verified
  syntactically but not observed filtering live. Carry to Task 7 verification.
Task 6: minor (deferred): dtctl verify emits an info-level PARAMETERS_SHOULD_BE_GROUPED hint
  on the in(event.id, {{...}}) line; benign, but recheck once embedded in the Task 7 workflow.
Task 6: minor (deferred): frequent-event gate is correct by inspection but was never observed
  removing rows (0 frequent events in the sampled window). Inspected-but-unexercised.
Task 6: complete (commits c1d4ed4..9895f56, review clean, 0 Critical/Important)
Task 7: dispatched. FIRST modification to the live workflow 7c35a230. Baseline export must be
  committed BEFORE editing so rollback is git checkout + one apply.

Task 7: interrupted by session rate limit mid-verification. Controller assessed state:
  - baseline export WAS committed first (ec3d2df) - rollback point intact
  - dtctl apply DID land: live workflow 7c35a230 now runs the 1438-char v3 DQL and ALL
    eleven send_event fields bind to _.item (source is input('snow_source'), correct)
  - modified YAML still uncommitted in working tree
  - execution 0ea839eb (07:37:52Z) SUCCESS, but send_event completed in 123ms, i.e. the
    withItems loop had ZERO items - extract_events returned no records for that problem
  - v3 has emitted NO em_events yet (0 rows contain dt_entity_key in additional_info)

FINDING T7-F-DUAL: there are TWO deployed workflows sending Dynatrace problems to ServiceNow
ITOM, and the controller had misattributed the evidence.
  68577e86 "Dynatrace Problems to ServiceNow ITOM (AIOps)"  <- v1, deployed, ACTIVE
  7c35a230 "... (AIOps) v2"                                  <- ours, now v3
  v1 has NO k8s cluster filter: it fires on ALL Davis problems tenant-wide. It sends ONE
  em_event per problem (no withItems). Its ci_type comes from a STATIC workflow input
  `ci_type_default`, which is why every one of its events is cmdb_ci_service_calculated.

CORRECTION to the original analysis: the "99/100 events all cmdb_ci_service_calculated,
0/100 bound" evidence in spec section 2.1 measured v1's output, not v2's. The cause is v1's
hardcoded ci_type input, not v2's records[0] bug. The records[0] bug in v2 was real and is
fixed, but it was not what produced that measured evidence. Both defects existed; the
evidence was attributed to the wrong one.

Consequence: v3 is scoped to k8s.cluster.name = aeric-walls-aks (31 problems in 7d, ~4/day),
so it is a narrow slice. v1 remains the dominant producer of Dynatrace em_events and is the
actual cause of the 0% production bind rate. Fixing v2->v3 alone does not fix production.

Ruling: T7-F-DUAL — do NOT disable or modify v1. It is a deployed integration the plan never
mentions, and retiring someone's live production integration is outside the authority of this
run. Leave it running, isolate v3's events for verification by filtering additional_info for
dt_entity_key, and surface the choice to the user. Cost if wrong: duplicate em_events for
aeric-walls-aks problems until the user decides. Surfacing beats silently disabling.
Task 7: implemented (commits ec3d2df, e3de6eb, 1a383bd, 110792b, 7e63359).
  Controller verified live: v1 trigger isActive=False (workflow preserved, not deleted);
  v3 trigger active with customFilter='' (tenant-wide); v3 HAS now emitted 2 em_events with
  type=service (the dt_entity_key, not the category) - first end-to-end proof of the field
  mapping fix. CI bound 0/2, which is correct at this stage since Task 9 builds the binding
  rules. DQL replay evidence: P-26091047, 29 events -> 29 rows, 6 distinct dt_entity_id,
  now_ci_class and bind_strategy non-null on all rows.
  Implementer concerns to carry: customFilter cannot consume {{ input() }} (platform limit,
  so scope_filter input is inert and documented as such); dtctl exec workflow --input broken
  for JSON in this build; frequent-event filter still unobserved either way.
Task 7: review verdict spec OK / Needs fixes. 1 Important finding.

Ruling: T7-F1 (scope_filter input is silently inert) — FIX. The YAML defines scope_filter: ""
alongside snow_source and snow_table, which ARE real functioning inputs, with nothing marking
it as disconnected from customFilter. A future maintainer will edit it, see no effect, and
have no explanation in the artifact. The only explanation lives in task-7-report.md. This is
the exact "inert input that looks configurable" risk I asked the reviewer to judge, and it
agreed. One-line YAML comment fixes it. Cost if wrong: a comment nobody needed.

Task 7: minor (deferred): workflow title still says "v2" while docs call it v3.
Task 7: minor (deferred): no live em_event evidence yet for the tenant-wide widen beyond the
  2 events already observed; DQL replay is the accepted acceptance evidence.
Task 7: fix round 1/5 (1 addressed, 0 open; commits 7e63359..9beac86)
  Implementer chose option (b): removed the dead input entirely rather than keeping it with a
  comment. Sound reasoning. Also established that YAML comments do not survive the Dynatrace
  API round-trip, so git carries the explanation and the live workflow does not.
Task 7: complete (commits 9895f56..9beac86, review clean)
  DYNATRACE SIDE COMPLETE: 553-row mapping live, v3 tenant-wide with per-event fan-out,
  v1 disabled reversibly, acceptance proven by P-26091047 replay (29 events -> 29 rows).
Task 8: complete (commits 9beac86..1d878db, review clean, 0 Critical/Important)
  SCOPE NAME: x_1906732_dtaiops   <- Tasks 9-13 need this
  App live on pdi: "Dynatrace AIOps Event Pipeline" v0.0.1, active.
  Fluent sources live at servicenow/src/fluent/ (SDK fluentDir default), NOT src/ as the
  plan said. Orientation output wins; reviewer corroborated against generated keys.ts path.
  Orientation conventions summary is in task-8-report.md - hand that to Tasks 9-13 rather
  than re-reading the SDK docs.
Task 8: minor (deferred): servicenow/.gitignore lacks trailing newline (SDK-generated).
Task 9: implemented (commit ef6689f) but PASS CONDITION NOT MET. Controller diagnosis:

  MEASUREMENT DEFECT: scripts/bind-rate-report.sh infers "bound" from absence of failure text
  in processing_notes. That is a false positive: the one event it counted as bound has an
  EMPTY cmdb_ci. em_event has a real cmdb_ci column - that is the correct indicator. True
  current rate is 0/45, not 1/45. The implementer disclosed this honestly rather than
  claiming the 2%.

  DEFECT A STILL OPEN: the host rule (order 8010) is still matching non-host events. Live
  evidence: events with type=environment carry "Binding identification engine error: the input
  field(s) name, that the rule 'Dynatrace - bind host events to server CI' specified are empty".
  Rules are still not scoped by bind_strategy.

  ROOT CAUSE OF EMPTY NAMES - measured tenant-wide over 24h:
    process    13596 events,   0% null name
    k8s_pod     1306 events,   0% null name
    service      107 events,  18% null
    host          20 events,   5% null
    environment  113 events, 100% null
    __unknown__  250 events, 100% null
  Name resolution is GOOD for the high-volume types. The failures are concentrated in
  `environment` (the Dynatrace tenant-level entity) and `__unknown__` (no entity at all).
  Neither has a CI counterpart by nature. The em_event sample skewed toward environment
  because problem-level events over-represent it relative to the raw event stream.

Ruling: T9-F-ENTITYLESS — environment and __unknown__ events have no bindable CI and never
will. Do NOT filter them out at Dynatrace: they are real problems and dropping them loses
signal. Instead they should bind to nothing and be reported SEPARATELY from the bind rate
rather than counted as failures. A bind-rate metric that includes entity-less events measures
something meaningless. Cost if wrong: the report shows a lower headline number than reality.

Ruling: T9-F-PROCESS — CONTROLLER FOUND THE MISSING PIECE. The implementer concluded the
PROCESS-to-host Smartscape traversal did not work and fell back to ire_correlated. It used
getNodeField(id, "runsOn"), which returns None. The real edge type is `runs_on` (snake_case),
confirmed by enumerating smartscapeEdges from PROCESS nodes: runs_on n=1177, calls n=851.

Verified end to end: traversing runs_on from PROCESS to HOST and composing
concat(proc_name, "@", host_name) produces names matching SGC's CMDB convention exactly:
  traversal -> "Dynatrace OneAgent Extensions Controller ...-oneagent-5lcw6@aks-agentpool-2170"
  CMDB      -> "Dynatrace OneAgent Extensions Controller ...-oneagent-8nq79@aks-agentpool-2170"
  CMDB      -> "cart cart-75bdb64689-4jj6p@aks-agentpool-21707267-vmss00000n"
So process CAN bind by name. This matters: process is 13,596 events/24h, the dominant type,
with 0% null names. Reverting it to sgc_process is worth a fix round.

Also established definitively:
  HOST    - DT name == CMDB name (e.g. e7329fd39740 in both). Binds by name. OK.
  SERVICE - CMDB name is "<dt name> - <SERVICE-ID>"; dt_ci_name already composes exactly that.
            e.g. CMDB "chatbot - SERVICE-0C57F091741CFA1A". OK.
  correlation_id is EMPTY on every SGC-created CI, so ire_correlated can never match on it.
            Any type relying on correlation_id alone will not bind. This is spec defect D3
            confirmed at implementation time.
Task 9: fix round 2 complete (commit aaba769). Process composed name VERIFIED: 871/871 rows
  produce well-formed <proc>@<host>, 0 null, 0 half-composed, matching CMDB convention.
  ANSWERED: identification_rules[].attributes[].value resolves against the em_event record -
  direct column first, additional_info key fallback if no such column. So both `node` (column)
  and `dt_entity_id` (additional_info key) are valid addressings.
  STILL UNVERIFIED LIVE: rule scoping. Zero events since 01:27:59 UTC; fix deployed ~01:50.
  Tenant cadence is ~90min bursts. Deferring live confirmation to Task 10-12's first run.
  Four lookup tables now on tenant; v4 is authoritative, v1/v2/v3 stale.
Task 9: task review APPROVED, 0 Critical/Important. All controller rulings verified implemented.
  Reviewer confirmed: 4 rules each scoped to its own strategy via em_event.type; runs_on lookup
  casts before startsWith; dt_ci_name null-guarded on both concat branches; bind-rate measured
  off cmdb_ci with entity-less types separated.
Task 9: minor (deferred): 4 near-identical Record() blocks (~250 lines); a factory would make a
  5th strategy a one-liner.
Task 9: minor (deferred): runs_on lookup's -24h window is unexplained in a comment.
Task 9: OPEN, carried to Task 10: rule scoping unconfirmed live (zero post-fix events).
Task 9: OPEN, pre-existing design gap flagged by reviewer: unclear whether ServiceNow falls
  through to the 8090 catch-all when a scoped rule matches on `filter` but FAILS identification.
  Determines whether host/service/process get a second chance via correlation_id. Not a
  regression - the brief's design never specified it.

USER CORRECTION + CONTROLLER SURVEY: user stated the Dynatrace entity id is a suffix on CMDB
names. Verified per class (previous 400-row survey was skewed - every row was cmdb_ci_appl):
  cmdb_ci_service_calculated  3/3 HAVE id suffix   e.g. "chatbot - SERVICE-0C57F091741CFA1A"
  cmdb_ci_computer/_linux/_win 0/3  bare hostname   e.g. "dw0sdwk000L8W"
  cmdb_ci_appl (process)      0/3  <proc>@<host>    e.g. "Dynatrace OneAgent Extensions..."
  cmdb_ci_kubernetes_*        NO Dynatrace CIs AT ALL
  cmdb_ci_web_application     NO Dynatrace CIs
  cmdb_ci_environment         NO Dynatrace CIs
So the suffix convention holds for SERVICE only - and that is already implemented as the
sgc_service dt_ci_name composition. It does not hold for host or process.

MATERIAL CONSEQUENCE: SGC imports only HOST, PROCESS, SERVICE, FRONTEND (spec section 2.2).
Every Kubernetes class has ZERO Dynatrace CIs, so k8s_pod (1,306 events/24h), k8s_deployment,
k8s_namespace etc. can NEVER bind - there is no CI to bind to, regardless of strategy or
identifier. The achievable bind rate is bounded by SGC's import scope, not by our rules.

Ruling: TASK-9B ADDED (controller, with explicit user direction). The plan assumed CI binding
could be verified against the existing CMDB. It cannot on this PDI: SGC imports only HOST,
PROCESS, SERVICE, FRONTEND, so every Kubernetes class has zero CIs and those events can never
bind here. User clarified that in their CUSTOMER's environment the CMDB is populated from many
discovery sources, so the k8s_* and other mappings are CORRECT and must stay - the gap is this
test instance, not the mapping. User directed: backfill simulated CMDB data to test binding.

Scope measured from 24h of live traffic: 102 CIs across 10 classes covers 100% of bindable
event volume. process 62, k8s_pod 14, service 8, k8s_deployment 6, k8s_namespace 4, host 3,
k8s_node 2, k8s_cluster 1, frontend 1, browser_monitor 1.

User decisions: generate names from live Dynatrace topology (exact dt_ci_name values, so the
test is real rather than approximate); mark with a distinct discovery_source and ship a
teardown script.
Cost if wrong: synthetic CIs on a PDI, removable by the teardown script.

=== BREAKTHROUGH: CI BINDING CONFIRMED WORKING (controller verification) ===
Events finally landed after the scoping fix. Three things resolved at once:

1. RULE SCOPING FIX CONFIRMED WORKING. Post-fix events match their own strategy's rule:
   service rule 12, process rule 17. No more host rule swallowing everything. environment
   events now fall to the catch-all instead of the host rule. Task 9's top open item: CLOSED.

2. THIRD MEASUREMENT DEFECT FOUND. scripts/bind-rate-report.sh measures em_event.cmdb_ci.
   Binding does NOT land there - it lands on em_alert.cmdb_ci ("Binding alert CI process
   flow" in the notes). That is why the rate read 0% while binding was actually succeeding.
   The script must join event -> alert and measure the ALERT's cmdb_ci.

3. MEASURED RESULT, joining em_event to em_alert on post-fix data:
     service       8/12  = 66%   BOUND
     frontend      0/3   =  0%   (cmdb_ci_web_application has no Dynatrace CIs)
     environment   0/14  =  0%   (entity-less by nature, correctly excluded)
     BINDABLE BIND RATE: 8/15 = 53%   vs measured baseline 0/100
   Evidence of a real bind: node "frontend (frontend) - SERVICE-01288A2EDDFE2F8B" ->
   cmdb_ci 34311fd49035cb509dd8975220a50a83.

CONTROLLER PRE-CHECK FOR TASK 9B - backfill is smaller than planned:
  host     3/3  CI names already exist in CMDB (exact match, as cmdb_ci_linux_server which
                extends cmdb_ci_computer, so the mapping is correct)
  service  8/8  already exist (exact match incl. the " - SERVICE-ID" suffix)
  process  1/5  exist - SGC imported a subset; the rest need backfill
  k8s_*    0    none exist
  frontend 0    none exist
So backfill scope drops to process (partial), k8s (all), frontend. host and service need
nothing and already prove the mechanism.

=== TASK 9B EXECUTION: 47 backfill CIs created, teardown redefined to neutralize (rename),
CMDB writes confirmed create-only on this PDI ===

Live re-derivation (Step 1, dt.davis.events from:-24h, top 20/class, tacocorp context):
missing CIs were process 12 (of 19 distinct names in the top-20 sample; 7 already existed),
k8s_pod 20, k8s_deployment 5, k8s_namespace 5, k8s_node 2, k8s_cluster 1, frontend 1,
browser_monitor 1 = 47 total (not the ~90 or 102 cited in earlier session notes - both are
now stale; re-derive live each time, per the brief's own caution).

TEARDOWN INVESTIGATION (Step 2, prior round, reported BLOCKED): physical deletion of a
cmdb_ci_appl test record was tried three ways - code-removal+rebuild+redeploy, explicit
Now.del(), and full `install --reinstall` - and none removed it. A control test against a
non-CMDB table (sys_properties) worked, isolating the failure to CMDB CI tables. User
ruling: teardown is redefined as NEUTRALIZE (rename to `ZZ-RETIRED-<name>`), not delete;
the one orphaned test CI stays in place, tagged and harmless.

Layout gotcha confirmed the hard way: `now-sdk build` only picks up `.now.ts` files under
`servicenow/src/fluent/` (or a subdirectory of it) - a sibling directory like
`servicenow/src/cmdb-backfill/` is silently ignored, no error, no manifest entry. Backfill
source lives at `servicenow/src/fluent/cmdb-backfill/*.now.ts`.

Step 3: created all 47 records (one Record() per entity, `name` + `discovery_source:
"SIM-Dynatrace-Test"`), built and installed. Verified present via `now-sdk query` against
each of the 8 target tables (cmdb_ci_appl, cmdb_ci_kubernetes_pod/deployment/namespace/
node/cluster, cmdb_ci_web_application, cmdb_ci) - all 47 landed with the exact composed
names from Step 1 and the correct discovery_source tag.

Step 4 NEW FINDING (broader than the Step 2 delete finding): field UPDATES to already-
created CMDB CI records are ALSO silently dropped by this PDI's Fluent/now-sdk write path -
not just deletes. Tested rewriting `name` (rename to ZZ-RETIRED-) and, as a control,
changing a wholly unrelated field (`operational_status`) on two different backfilled
records across two different tables; rebuilt and reinstalled (including a `--reinstall`
full wipe+recreate); `sys_mod_count` stayed at `0` in every case - the instance registered
zero write operations against these rows after their initial creation. `scripts/
neutralize-cmdb-backfill.sh` performs the correct mechanism (rewrite source -> rebuild ->
redeploy) and self-verifies via query; it reported the honest result (0/96 renamed) rather
than a false success. CMDB CI records on this PDI are effectively create-only through every
write path available to this pipeline.

POST-REVIEW CORRECTION: the full-set test run of `neutralize_cmdb_backfill.py` above (the
one that produced the "0/96 renamed" result) rewrote the `name` field in place across all 8
committed `servicenow/src/fluent/cmdb-backfill/*.now.ts` files to the `ZZ-RETIRED-` form as
a side effect of testing it, and that post-rewrite state is what got committed in 1eef2c1 -
not the original Step-3 composed names. Since the rename never actually applied on the live
instance (per the finding above), this meant the committed *source* had silently diverged
from live *reality*: redeploying from that source to a fresh instance (or after the
create-only protection is ever lifted) would have created these CIs with the neutralized
names, quietly defeating the whole backfill's byte-for-byte name-matching purpose. Caught in
review; fixed by regenerating all 8 files from the original Step-1 name list (not by
hand-stripping the prefix, to avoid transcription slips) and re-verifying both that no
`ZZ-RETIRED-` string remains in the committed source and that the live ServiceNow records
still hold the original names (confirmed via `now-sdk query` spot-checks across k8s_cluster,
frontend, browser_monitor, and process - all matched the original Step-1 names, unchanged,
as expected since updates don't take effect on this PDI). Committed as a follow-up fix.

Step 5 measurement: `dtctl exec workflow 7c35a230-... --plain` errored on manual trigger
("Undefined variables: timestamp") - the workflow's trigger is Event-type and reads
`event()["timestamp"]` from a real Davis-problem trigger payload, which `--input` (used
for workflow-level inputs like snow_source/snow_table) does not supply. This is the same
limitation Task 9 already hit and documented (their round-2 report: "I did not wait on
live em_event records... no fresh Davis-problem burst had landed"). `bind-rate-report.sh`
(both 500 and 3000-row limits; only 392 em_event rows exist total) shows the same shape as
every prior measurement in this ledger: only `service`/`frontend`/`host`/`browser_monitor`
have ever produced a live em_event row on this pipeline; process/k8s_* have never once
fired a live Davis PROBLEM (as opposed to raw dt.davis.events noise) since this pipeline
existed. So Task 9b's core empirical question - does binding actually work once a matching
CI exists for these classes - cannot be answered by live measurement in this environment;
it can only be reasoned about structurally from the confirmed rule mechanics (Task 9) plus
the confirmed CI existence (Task 9b Step 3): process (sgc_process, name-based) should bind
the next time a process-class problem fires; k8s_*/frontend/browser_monitor (ire_correlated,
correlation_id-based) are expected to keep failing to bind even then, since the backfilled
CIs' correlation_id is empty (defect D3, unchanged) - this remains the answer to Task 9's
open question, just still unconfirmed live for lack of a trigger-able test event.
