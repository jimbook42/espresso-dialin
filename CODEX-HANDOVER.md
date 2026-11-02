# Wrong-ray repair handover

Branch fix/pressure-wrong-ray from main f3e3db1 /v4.13.26. Local dependency junction safely unlinked (target preserved); npm ci succeeded into this checkout.

## Step 1 complete
- Optional third diagnostics argument to readCalibratedFrame records raw detector, hint, template result and selected source, without changing outputs.
- scripts/pressure-diagnostics/wrongRayReplay.mjs replays real clips through unchanged calibration/registration/publisher; asserts saved baseline bar/fresh/held equivalence per frame.
- Targeted: 41/41 pass. 094055 435 frames +130022 400 frames reproduce baseline exactly (835/835 verified).
- 094055 @19: detector277.436°, quality.7302, bar.026808; @40 detector106.001°, peak0/margin0 but quality boosted to.18, publisher holds .056692 vs fresh candidate7.882643.
- 130022 @25.25: detector279.392° off arc; template85.164°, corr.927 ->7.686812. @25 label uses this fresh-display window; truth6.61.
- Logs ignored under out/wrong-ray-step1-*. No official exam run.

## Next / mandatory stop
Step 2: independent bounded-offset pointer evidence and tests, standalone diagnostic replay all12 clips (own candidate tracking/publisher state; existing pose/calibration/map/endpoint unchanged). Verify baseline adapter before reporting new results. Update docs/pressure-wrong-ray-2026-11-02.md and this handover; commit/push validated step2, then STOP before production integration. Do not import new candidate reader in production. Any unexpected non-env test failure stops for reporting. The local stash f96c56e remains untouched. No main edits/merge/deploy.

## STOP — step 2 incomplete, targeted evidence failures
- Validated/pushed HEAD remains968e8bf (step1); production selection is unchanged.
- Untracked/uncommitted: src/flairPressureLab/pointerEvidence.js and pointerEvidence.vitest.js. Independent bounded-offset shaft scan, same line for both ends, existing coherent reach/taper scoring, alternate-axis margin; no production imports.
- Targeted step2 run: 43 passed,2 FAILED /45 tests (2 files pass,1 fails). Existing37 calibration+4 endpoint tests pass. New pivot-error and blank-face tests pass.
- New long thin pointer/broad short tail test: 4° error vs required<3°. New symmetric/equal-end shaft test incorrectly returns217° instead of null. These are real evidence/ambiguity failures, not environment exceptions; AGENTS and approved plan require STOP and report. Do not weaken tests or commit/integrate the candidate.
- Candidate12-clip replay not run; full suite/build/official exam not run. Latest official metrics remain v4.13.26 baseline91.82% (80.03fresh/11.79held/8.18gaps), median.100191,45/54 within.3,5.56%>1,worst-5.946128,0false10.
- The only fresh replay results in this task are baseline-equivalent step1 traces: 094055@19 .026808 fresh; @40 .056692 held (current raw candidate7.882643);130022@25 scoring window7.686812 from template at25.25. No new candidate pressure result can be claimed.

## Resume exactly here, after direction to continue
Inspect this handover, git status, pointerEvidence.js and its test; do not restart step1 or install again. Fix candidate tie/offset ambiguity without changing pressure thresholds or the pivot-orientation contract. The current coarse/refined search can favor an offset/off-axis discretization over the correct line and falsely distinguish equal ends. Re-run targeted suite only after correction, then build the standalone candidate mapping/publisher harness, validate its baseline adapter and replay all12 historical clips. Commit/push only validated completed step2; update docs/pressure-wrong-ray-2026-11-02.md and STOP before integration. No new official exam at pre-integration checkpoint. Stashf96c56e preserved; no changes to main, protected score/exam/fixtures/model, schema/data/auth/privacy or deployment.

## Step2 correction attempt passed
Single allowed correction: score the transverse ridge-centroid residual to stop off-axis/offset lines acquiring false taper. No test weakened. Targeted suite45/45 passes (all4 candidate tests, existing37 calibration+4 endpoint). Candidate remains standalone/unimported by production. Next: commit candidate and tests, run12 standalone historical clips with original map/endpoint/publisher and baseline adapter equivalence, then push/report/STOP before integration. No further tuning after clip results.

## Step2 checkpoint COMPLETE — STOP before integration
- Single authorized algorithm correction passed all45 targeted tests unchanged. Candidate core committed a41960b; no additional tuning after replay.
- All12 clips replayed once through standalone candidate path. All3961/3961 production baseline bar/fresh/held outputs match saved observations; existing raw mapper/endpoint equivalence also asserted on nonduplicate frames. No official live exam.
- Candidate diagnostics:95.80914% published,86.13986% fresh,9.66928% held,4.19086% gaps; median.192689;34/53 within.3;1.88679% >1; worst+1.060430 at094055/11s;0false10 (0fresh/0held). 3412+383+166=3961.
- Requested:094055@19=5.360987 HELD/uncertain vs5.972936 (error-.611949);094055@40=4.781597 fresh vs5.404496 (error-.622899);130022@25 fresh-display window6.651306 vs6.61 (+.041306); actual25.25s candidate6.931470 fresh.
- Acceptance NOT met: median/within.3 worse than production. Do not integrate. Other criteria coverage>=90,>1<3%,0false10 pass diagnostically only.
- New standalone scripts pointerCandidateReplay.mjs (production helper functions/config; independent publisher state), runPointerCheckpoint.mjs (12clips), reportPointerCheckpoint.mjs (report only). No application imports of pointerEvidence. Sourcescore/exam/fixtures/frozen config unchanged. No calibration/pressure thresholds changed.
- Full report docs/pressure-wrong-ray-2026-11-02.md, exact per-clip/hit data in -results.json. Full traces ignored out/wrong-ray-candidate-*.json; logs out/wrong-ray-checkpoint*.txt and wrong-ray-step2-attempt1.txt.
- No full suite/build or phone/performance/model validation at this pre-integration checkpoint; those belong to a later approved integration phase. Candidate fit bias across the dataset remains unresolved (e.g.094151/160844), despite improved named misses. Further work needs direction; inspect geometric fit/calibration compatibility without weakening tests or changing zero globally.
- Commit/push the completed harness/report, then STOP. No integration, main merge/deploy, retraining or further algorithm iteration authorized in this task. Original stash remains preserved.
