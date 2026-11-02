# Pass 2 + endpoint-only handover — evaluation complete, stopped

Branch feat/pressure-accuracy-p2-endpoint. Base da595fb; evaluated runtime beb8473dbbc96a020b5c04c82a8a70765cf52be7. Latest main fetched: 5628c33, already an ancestor of base; no main integration changes required.

## Isolated cherry-pick
- Cherry-picked 4a91b1d. Runtime/tests apply independently; only conflict was modify/delete CODEX-HANDOVER.md, absent in pass 2. Resolved with branch-specific notes.
- Runtime differs from da595fb only in tapCalibrate.js endpoint guard/removal of upper extrapolation; added tapEndpoint.vitest.js.
- c79cf09 tap-derived zero and changed appearance-template seeding NOT included. Pass-2 zero, template, registration, publisher/model unchanged.
- History read on feat/pressure-accuracy-codex at 64a57f1: repair report and handover. Stash f96c56e321de594495d8a7ab2b6561effd6b83f1 remains preserved, local, not applied or discarded.

## Validation completed
- Targeted: 40/40 passed (endpoint 3 + calibration 37).
- Full Vitest: 444 passed, 2 failed, 1 skipped /447 tests; 84 passed, 3 failed, 1 skipped /88 files. Only documented Python-dependent pair and missing box-only temporalReplay fixture fail. Build passed (PWA generated; existing chunk warnings).
- Unchanged live exam ONCE on beb8473, existing read-only debugger observer for fresh/held accounting; no rerun/runtime adjustment. Prior combined-step outputs preserved under ignored out/step2-combined-before-endpoint-only. Logs out/p2-endpoint-*.
- Targets NOT all met: 82.83262% published (75.86468% fresh, 6.96794% held, 17.16738% gaps); median .098377 (passes); 3.92157% >1 (fails); 0 false-ten flags (passes, fresh0/held0). 43/51 within .3; 3005 fresh +276 held +680 gaps =3961.
- Worst remaining: 094055 @40s +2.478146 (7.882643 vs5.404496), 130022 @25s +1.076812 (7.686812 vs6.61).
- Guard's global shortest-signed-angle condition rejects near-zero rays on arcs wider than180: 225219 100/100 gaps despite stable registration. The endpoint-only result therefore loses coverage independently of the excluded zero commit. No repair attempted here.
- Full baseline/pass2/now comparison: docs/pressure-p2-endpoint-2026-11-02.md and -results.json. Missing original baseline fields retained as unavailable.

## Exact next state
Evaluation complete. Push branch and STOP per user. No additional repair/exam run, no merge/deploy. Further work requires direction; start from this report and review the global-angle guard and unresolved 094055 calibration/wrong-ray issue. No targets-success claim, no phone-camera benchmark/new exact today's-shot replay. Protected exam/scoring/threshold/fixtures/labels/config/model untouched; no retraining/schema/data/auth/privacy/version/dependency changes.
