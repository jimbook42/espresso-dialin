# Pressure accuracy handover — stopped after step-2 evaluation

Branch: feat/pressure-accuracy-codex. Evaluated runtime: 4a91b1d.

## Completed
- Step 1 c79cf09: transfer existing profile onto user five/ten rays; zero independent of frozen moving needle; valid measured-needle appearance template.
- Step 2 4a91b1d: remove beyond-ten extrapolation and withhold pixel-ambiguous endpoint measurements. Registration/fresh-held separation retained.
- Full suite on restored step-2 runtime: 449 passed, 2 failed, 1 skipped / 452 tests; 85 passed, 3 failed, 1 skipped / 89 files. Only documented Python-dependent pair and missing box-only temporal replay fixture failures. Build passed.
- Unchanged final live exam ran ONCE on 4a91b1d, with existing read-only debugger observer. No runtime changes or reruns after seeing results. Previous pass2 outputs backed up under ignored out/pass2-observed-before-step2-exam and out/pass2-before-step2-exam.json.
- Outcome: targets NOT met. 0 false-ten flags (0 fresh/0 held); 73.94597% published (65.66524% fresh, 8.28074% held, 26.05403% gaps); median .178998 bar; 30/43 within .3; 4.65116% >1 bar; worst -1.810519 at 34 s on 130022. Frames: 2601 fresh +328 held +1032 gaps =3961.
- Full baseline/P1/P2/now per-clip report and exact data: docs/pressure-step2-evaluation-2026-11-02.md and -results.json. Historical missing baseline fields remain unavailable, not invented.

## Parked step 3 — preserved, NOT discarded or applied
- User requested git stash -u. Stash SHA: f96c56e321de594495d8a7ab2b6561effd6b83f1 (stash@{0} when created).
- Message: Park unfinished step 3 recovery geometry before 4a91b1d exam.
- Contains tapCalibrate.js offsetTipRay/tip-vs-tail attempt, untracked tapRecovery.vitest.js, and prior handover with exact failure. Untracked-file preservation verified in stash's third parent.
- That attempt failed an existing bounded-pivot test (12.1136 degrees error vs required <3); targeted run 47 passed, 1 failed /48. It was not committed or evaluated in this exam.
- To inspect: git stash show -p f96c56e321de594495d8a7ab2b6561effd6b83f1
- For future recovery only, after reviewing current changes: git stash apply f96c56e321de594495d8a7ab2b6561effd6b83f1 (use apply, not pop; do not weaken existing tests). Applying also restores the old handover, so preserve this current evaluation report first. Stash is local; branch pushes do not back it up remotely.

## Risks and exact next state
- Fixed-profile zero shift loses low-pressure readings (225219 100% gaps) and worsens accuracy on older clips; no combined-target success claimed. Future calibration approach remains unverified.
- No exact new replay of today's shot with original taps (not available), no phone-camera benchmark. No full correctness implied by green env-adjusted tests/build.
- STOP here per latest user request. No more implementation or exam runs in this task. Keep this handover because repair/step 3 remains unfinished and stashed. Future work requires new direction, review of report/stash, and independent validation.
- No exam/scoring/label/fixture/frozen-config/model changes, retraining, schema/data/auth/privacy/version changes, merge to main or deployment.
