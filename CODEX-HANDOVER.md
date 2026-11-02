# Pressure accuracy repair handover

Branch feat/pressure-accuracy-codex; started 5f4a973. Main fetched/merged: already up to date.

## Step 1 completed
- tapCalibrate.js now transfers the existing PROFILE_FIVE_DEG / PROFILE_FIVE_TO_TEN_DEG onto the user's five/ten rays for nonlegacy zero. No moving needle defines zero. Legacy zero unchanged.
- Appearance template uses the measured needle angle only when on the tap arc; an invalid calibration needle cannot seed a print/tail template. Taps and registration remain authoritative.
- Added tapScaleReference.vitest.js: rotations, scaled tap geometry and rejection of the historical 094055 wrong ray.
- Targeted tests: 42/42 pass (tapCalibrate + tapScaleReference).
- Historical mappings: 12/12 preserve exact five and ten pressures (floating tolerance 1e-10).
- Real 094055 reader-only replay (not exam): 435 frames, 434 registered, 1 lost; 135 fresh / 300 missing bars. At 22 s now 7.5099 bar rather than -0.026; 19/40 s wrong rays withheld. At 11 s 0.0668 vs prior truth 1.387: accuracy/coverage still need work. Replay output ignored: scripts/needle-reader/out/reacquisition-reading-step1-20261018_094055-rows.json.

## Remaining / resume exactly here
1. Step 2: remove nonlegacy ten clamp; pixel-derived endpoint uncertainty => no fresh pressure when interval crosses ten. Targeted tests and 160931 historical replay; update this handover, commit/push before step 3.
2. Step 3 required: step 1 already leaves missing/wrong candidates. Strengthen pointer and recovery evidence; check 130022 25.25 s and 094055. Do not claim all targets from steps 1–2 without evidence.
3. Full suite/build, then unchanged live exam ONCE with out/exam-observer.mjs; preserve out/exam-observed pass2 before overwrite. Generate baseline/P1/P2/now per-clip report from historical JSON docs. Delete this handover only in final completed commit.

## Risks / unverified
- Existing fixed profile transfers zero without resting frames, but perspective/profile mismatch remains a risk; final accuracy unmeasured.
- Step 1 causes many correct gaps when the detector still chooses an off-arc ray. Registration works; do not loosen it.
- No full suite/build/new exam yet. No targets claimed met. No retraining, scoring/fixture/config changes, main merge/deploy or version bump.
