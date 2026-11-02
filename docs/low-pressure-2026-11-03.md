# Low-pressure reading investigation — 2026-11-03

Base: `origin/main` at `724f08924c4a8e2a097bf3c2f4ed87ef7b4ae19c`, v4.13.29. Branch: `fix/low-pressure`. No version bump, merge, deployment, dependencies, schema, saved-shot, settings, or database changes. The November 3 fixtures are imported byte-for-byte from `origin/data/labels-2026-11-03`; the pre-existing untracked November 2 fixtures are untouched.

## Outcome and limits

The accurate-tap video replay already avoided the saved app’s false rest snaps on unchanged main. The original shot’s live calibration does not exist, so its exact failure cannot be reproduced or claimed fixed. The verified failures below are controlled calibration perturbations, as requested in the revised ticket.

A modest hub error reproduced false near-rest readings and gaps. The fix preserves plausible user taps and uses strong directed shaft evidence to resolve a contradiction between calibration and live needle rays. The accurate-tap replay and all four hub-offset cases meet the low-pressure targets. Large wrong 5-ray angles retain scale bias; the full perturbation matrix does **not** meet every target. No score or tap was adjusted to hide that limitation.

## Verified root cause

1. Calibration used `readNeedleAt` (a pivot-centred detector), while live frames use `findPointerEvidence` (a directed, laterally offset shaft fit projected through the tapped hub). With hub x−10 px, calibration zero was 331.623°, versus the live measured ray around 325.364°. With x+10 px, calibration zero was 275.617°, versus the live ray around 310.833°. The disagreement biases zero before shot start. The correction uses the live geometric ray only when it has tracking-quality image evidence and contradicts the calibration detector by more than the existing 6° angular tolerance. It changes calibration, never re-zeros a running shot.
2. The old 22° tap-geometry sweep check could fail for plausible finger errors, then silently snap the hub to another location. A y−10 px hub tap moved from (284.8,418.3) to (280.016,411.516); five+25° and ten−25° cases moved the correct hub from (284.8,428.3) to (297.8,422.3). The current calibration allows up to 45° sweep uncertainty while keeping the existing radius, chord, centre-distance and mark-distance checks. Plausible taps remain exactly as placed.
3. The reproduced collapses originate upstream of pressure publication. No evidence justified changing the 0.15 bar pressure-start logic, publisher rate gate, display filter, tracking miss resets, or model. Those remain unchanged. Every recovered fresh result still requires current-frame shaft and registered-pose evidence; no interpolation or expected preinfusion curve is supplied.

## Replay method

`node scripts/pressure-label/analysis/replay-low-pressure.mjs perturb-before --perturb` was started before reader edits; the corresponding `perturb-after` command used the final production reader. Each case is one continuous run. Frames are decoded from the original full-resolution upright video at the union of an 8 Hz timeline and all 18 exact label times. Equal decoded camera pixels remain duplicates and cannot certify a fresh reading. Thus some exact labelled times are genuine gaps or short publisher holds. F = fresh; H = held. Held values are disclosed, never counted as recovered fresh frames.

Initial calibration uses only Isaac’s c001 hub/5/10 taps on the 0.3 s frame. Subsequent taps are used solely for independent truth: piecewise hand zero/5/10 geometry, including the real ~0.32 bar rest labels. No phase label is forced to zero. Cases are fixed: accurate taps, hub x/y ±10 px, both mark rays ±15°/±25°, and each individual mark ±25°. Rays rotate about the original c001 hub; perturbed hub cases leave mark coordinates fixed. Each case runs `calibrateFromTaps`, `createCalibratedTracker`, `readCalibratedFrame`, and `createShotLabR7Publisher`. All cases and all frames are retained. Median uses the repository’s interpolated `quantile(...,.5)`, over published labelled values including explicitly marked short holds. Gaps are excluded from error but separately counted. Recovery is fresh at c004/c005/c015/c016/c017.

The earlier label-only diagnostic visits the same 18 source times without intermediate frames; it is useful for the automated regression, but the continuous replay tables below are the ticket measurements. Their timings/state histories differ and should not be conflated.

## Accurate taps: saved app curve and matched before/after replay

The saved app column matches the nearest saved sample only within 0.2 s (no interpolation); its actual time is shown. That curve has unknown calibration and is not the controlled baseline.

| Frame | Time s | Hand bar | Saved app bar @time | Before replay | After replay |
| --- | --- | --- | --- | --- | --- |
| c001 | 0.3 | 0.321 | 0.000 @0.476 | gap | gap |
| c002 | 0.6 | 0.349 | 0.527 @0.641 | gap | gap |
| c003 | 2 | 1.015 | 0.268 @1.964 | 0.735 F | 0.735 F |
| c004 | 3 | 1.216 | gap | 0.850 F | 0.850 F |
| c005 | 4.2 | 1.365 | gap | 1.098 F | 1.098 F |
| c006 | 5.3 | 1.723 | 2.206 @5.298 | 1.579 F | 1.579 F |
| c007 | 5.7 | 1.823 | 0.115 @5.696 | 1.750 F | 1.750 F |
| c008 | 6.2 | 1.862 | gap | 1.687 F | 1.687 F |
| c009 | 6.63 | 1.913 | 2.224 @6.635 | 1.840 H | 1.840 H |
| c010 | 6.76 | 2.034 | 0.276 @6.764 | 1.816 H | 1.816 H |
| c011 | 7.5 | 2.066 | 0.243 @7.431 | 1.779 F | 1.779 F |
| c012 | 8.9 | 1.798 | 1.934 @8.893 | 1.640 H | 1.640 H |
| c013 | 9.96 | 2.003 | 0.218 @9.965 | 1.863 F | 1.863 F |
| c014 | 10.5 | 1.805 | 0.138 @10.496 | 1.553 F | 1.553 F |
| c015 | 11.3 | 2.149 | gap | 1.898 F | 1.898 F |
| c016 | 12.1 | 2.154 | gap | 2.004 F | 2.004 F |
| c017 | 12.9 | 2.193 | gap | 2.082 F | 2.082 F |
| c018 | 13.57 | 3.398 | 3.200 @13.567 | 3.668 F | 3.668 F |

## All fixed perturbations

| Calibration | Before F/H/gap | After F/H/gap | Median before | Median after | False rest before→after | Fresh gap frames before→after |
| --- | --- | --- | --- | --- | --- | --- |
| true | 13/3/2 | 13/3/2 | 0.196 | 0.196 | 0→0 | 5/5→5/5 |
| hub-x-10 | 13/3/2 | 13/4/1 | 0.465 | 0.160 | 1→0 | 5/5→5/5 |
| hub-x10 | 11/5/2 | 13/3/2 | 0.814 | 0.146 | 0→0 | 4/5→5/5 |
| hub-y-10 | 12/6/0 | 13/3/2 | 1.565 | 0.176 | 3→0 | 3/5→5/5 |
| hub-y10 | 14/4/0 | 14/4/0 | 0.089 | 0.089 | 0→0 | 5/5→5/5 |
| both-rays-25 | 13/3/2 | 13/3/2 | 0.574 | 0.574 | 0→0 | 5/5→5/5 |
| both-rays-15 | 13/3/2 | 13/3/2 | 0.207 | 0.207 | 0→0 | 5/5→5/5 |
| both-rays15 | 13/3/2 | 13/3/2 | 0.435 | 0.435 | 0→0 | 5/5→5/5 |
| both-rays25 | 13/3/2 | 13/3/2 | 0.572 | 0.572 | 1→1 | 5/5→5/5 |
| five-25 | 13/3/2 | 13/3/2 | 0.574 | 0.574 | 0→0 | 5/5→5/5 |
| five25 | 2/3/13 | 13/3/2 | 0.227 | 0.572 | 0→1 | 0/5→5/5 |
| ten-25 | 2/3/13 | 13/3/2 | 0.206 | 0.196 | 0→0 | 0/5→5/5 |
| ten25 | 13/3/2 | 13/3/2 | 0.196 | 0.196 | 0→0 | 5/5→5/5 |

A ±25° error in the 5 ray cannot be made accurate while keeping that tap as the pressure anchor. In particular, the both-rays+25° and five+25° cases still have a ≥1 bar label published below 0.6 bar. These are failed robustness targets, not successful fixes. Accepting a tap without moving it does not establish that its scale is correct. Further automatic correction would need independent evidence about the printed anchor or an explicit tap review decision; this patch does not replace user taps with a detected/expected scale.

## Full exam (one baseline run, one candidate run)

Both runs used exactly `node --import ./scripts/needle-reader/out/exam-observer.mjs scripts/needle-reader/exam.mjs --live`. All ten exam clips and both hand-label clips were present. The observer only records returned readings; exam, scoring, label, and frozen configuration files were not edited. Worst absolute error is reconstructed from the same observed labelled outputs via the existing baseline-evidence helper.

| Run | Stream coverage % | Median bar | Worst bar | >1 bar % | False 10 count | Scored labels |
| --- | --- | --- | --- | --- | --- | --- |
| Before | 94.98 | 0.098 | 0.400 | 0 | 0 | 57 |
| After | 94.98 | 0.098 | 0.400 | 0 | 0 | 57 |

Across the 12 observed exam streams and six additional batch streams, all 6,045 output frames have identical before/after bar, freshness, hold, reason and measurement timestamp. The change affects the demonstrated perturbed calibrations, not the existing exam publications.

## November 2 displayed batch

All ten exam streams plus six additional batch streams were replayed before and after. Truth uses the existing batch analysis convention: geometric hand 0/5/10, with the unique other-clip rest pin→shaft median correction; repeats are retained in fixtures and excluded from the unique 52-frame metric. The displayed value is reconstructed with the unchanged causal display filter and explicit hold/gap behavior, at the nearest 8 Hz frame within 0.08 s. No scoring inputs were modified.

| Run | Unique selected | Published/scored | Displayed median bar | Worst bar |
| --- | --- | --- | --- | --- |
| Before | 52 | 50 | 0.087 | 0.438 |
| After | 52 | 50 | 0.087 | 0.438 |

The measured fresh baseline is 0.086547 bar; the ticket's historical 0.094 bar is the acceptance threshold, not an improvement claimed by this patch. Reconstructed per-frame hand truth agrees exactly with the existing batch analysis evidence.

## Export evidence

The replay pressure JSON now adds `readerDiagnostics`: the calibration actually supplied to the live reader (zero/5/10 angles, hub, 5/10 points, radius, color template, needle template, placement source and `atSec`) and every observed frame’s fresh/held/gap state, raw/published bar, measured/captured shot-relative times, live anchor rays, hub and reason. `atSec` is the first observed use of that calibration in this recorded shot; it is not a claim that the freeze/calibration image exists in the recording. Calibration changes receive separate entries.

Capture is a bounded in-memory sidecar for the latest replay, keyed to the committed shot ID. It is exported only for that matching shot. No new DB fields or migrations are introduced. Reloading the app loses this evidence; the download explicitly says it is unavailable rather than substituting today’s settings or another shot’s taps. Export the failing shot before reloading. The original saved curve stays unchanged. A frozen calibration image or optical-flow reference from before recording is not exported, so exact browser camera/runtime reproduction still requires that initial context.

## Validation and remaining work

- `npm ci`: passed after the Windows sandbox initially blocked lifecycle subprocesses; no dependency/version changes.
- Full `npm run test:vitest`: 471 passed, 2 known Python-dependent failures, 1 skipped; the known `/workspace/.../raw-frames.json` suite also cannot collect on this PC. No other failures. The real-video regression passed. After the final test-only review edits, `npx vitest run src/flairPressureLab/labReplayDiagnostics.vitest.js src/flairPressureLab/lowPressureBatch.vitest.js` passed all 4 tests (including the added download test).
- `npm run build`: passed with the existing large-chunk warning.
- Fixtures are unchanged from their source data branch. No exam/scoring/label scripts, frozen r7 config, or environment/secrets files were modified.
- Browser camera capture/download with a newly recorded physical shot remains unverified. Automated export tests verify the actual JSON download, immutable calibration snapshots, typed-array serialization, distinct F/H/gap states, shot-ID matching, and unavailable-history behavior.
- The original live calibration is unavailable. Full robustness at ±25° wrong 5 rays remains unmet. Do not merge or deploy this as a claim that every original target has passed.

Changed implementation/test files: `src/flairPressureLab/tapCalibrate.js`, `hooks/useShotLabPressure.js`, `hooks/useLabShotReplay.js`, `labReplayDiagnostics.js`, `labReplayDiagnostics.vitest.js`, `labShotReplayExport.js`, `lowPressureBatch.vitest.js` (all under `src/flairPressureLab/`); analysis replay: `scripts/pressure-label/analysis/replay-low-pressure.mjs`; this report. The other 31 added files are the unchanged November 3 fixture import.

## Per-frame perturbation evidence

### hub-x-10

| Frame | Time s | Hand bar | Before | After |
| --- | --- | --- | --- | --- |
| c001 | 0.3 | 0.321 | gap | 0.029 H |
| c002 | 0.6 | 0.349 | gap | gap |
| c003 | 2 | 1.015 | 0.489 F | 0.908 F |
| c004 | 3 | 1.216 | 0.606 F | 0.992 F |
| c005 | 4.2 | 1.365 | 0.896 F | 1.235 F |
| c006 | 5.3 | 1.723 | 1.496 F | 1.706 F |
| c007 | 5.7 | 1.823 | 1.407 F | 1.646 F |
| c008 | 6.2 | 1.862 | 1.267 F | 1.640 F |
| c009 | 6.63 | 1.913 | 1.421 H | 1.721 H |
| c010 | 6.76 | 2.034 | 1.416 H | 1.770 H |
| c011 | 7.5 | 2.066 | 1.441 F | 1.781 F |
| c012 | 8.9 | 1.798 | 1.395 H | 1.682 H |
| c013 | 9.96 | 2.003 | 1.555 F | 1.836 F |
| c014 | 10.5 | 1.805 | 1.322 F | 1.689 F |
| c015 | 11.3 | 2.149 | 1.689 F | 1.988 F |
| c016 | 12.1 | 2.154 | 1.783 F | 2.147 F |
| c017 | 12.9 | 2.193 | 1.813 F | 2.214 F |
| c018 | 13.57 | 3.398 | 3.255 F | 3.334 F |

### hub-x10

| Frame | Time s | Hand bar | Before | After |
| --- | --- | --- | --- | --- |
| c001 | 0.3 | 0.321 | 1.302 H | gap |
| c002 | 0.6 | 0.349 | 1.206 F | gap |
| c003 | 2 | 1.015 | 1.936 F | 0.850 F |
| c004 | 3 | 1.216 | 2.039 F | 0.987 F |
| c005 | 4.2 | 1.365 | 2.314 F | 1.425 F |
| c006 | 5.3 | 1.723 | 2.563 F | 1.745 F |
| c007 | 5.7 | 1.823 | 2.508 F | 1.651 F |
| c008 | 6.2 | 1.862 | 2.666 F | 1.788 F |
| c009 | 6.63 | 1.913 | 2.697 H | 1.785 H |
| c010 | 6.76 | 2.034 | 2.613 H | 1.837 H |
| c011 | 7.5 | 2.066 | 2.664 F | 1.814 F |
| c012 | 8.9 | 1.798 | 2.549 H | 1.677 H |
| c013 | 9.96 | 2.003 | 2.623 H | 1.804 F |
| c014 | 10.5 | 1.805 | gap | 1.637 F |
| c015 | 11.3 | 2.149 | gap | 1.925 F |
| c016 | 12.1 | 2.154 | 3.052 F | 2.077 F |
| c017 | 12.9 | 2.193 | 3.050 F | 2.075 F |
| c018 | 13.57 | 3.398 | 3.850 F | 3.414 F |

### hub-y-10

| Frame | Time s | Hand bar | Before | After |
| --- | --- | --- | --- | --- |
| c001 | 0.3 | 0.321 | 1.814 H | gap |
| c002 | 0.6 | 0.349 | 1.961 F | gap |
| c003 | 2 | 1.015 | 3.147 F | 0.669 F |
| c004 | 3 | 1.216 | 2.807 H | 0.850 F |
| c005 | 4.2 | 1.365 | 2.907 F | 1.185 F |
| c006 | 5.3 | 1.723 | 3.466 F | 1.575 F |
| c007 | 5.7 | 1.823 | 3.322 F | 1.602 F |
| c008 | 6.2 | 1.862 | 0.187 F | 1.609 F |
| c009 | 6.63 | 1.913 | 0.094 H | 1.776 H |
| c010 | 6.76 | 2.034 | 0.094 H | 1.763 H |
| c011 | 7.5 | 2.066 | 3.462 F | 1.715 F |
| c012 | 8.9 | 1.798 | 3.386 H | 1.593 H |
| c013 | 9.96 | 2.003 | 3.244 F | 1.876 F |
| c014 | 10.5 | 1.805 | 3.197 F | 1.638 F |
| c015 | 11.3 | 2.149 | 3.790 F | 1.988 F |
| c016 | 12.1 | 2.154 | 3.467 F | 2.047 F |
| c017 | 12.9 | 2.193 | 3.442 H | 2.231 F |
| c018 | 13.57 | 3.398 | 4.137 F | 3.225 F |

### hub-y10

| Frame | Time s | Hand bar | Before | After |
| --- | --- | --- | --- | --- |
| c001 | 0.3 | 0.321 | 0.267 H | 0.267 H |
| c002 | 0.6 | 0.349 | 0.106 F | 0.106 F |
| c003 | 2 | 1.015 | 1.037 F | 1.037 F |
| c004 | 3 | 1.216 | 1.203 F | 1.203 F |
| c005 | 4.2 | 1.365 | 1.326 F | 1.326 F |
| c006 | 5.3 | 1.723 | 1.657 F | 1.657 F |
| c007 | 5.7 | 1.823 | 1.771 F | 1.771 F |
| c008 | 6.2 | 1.862 | 1.781 F | 1.781 F |
| c009 | 6.63 | 1.913 | 1.808 H | 1.808 H |
| c010 | 6.76 | 2.034 | 1.808 H | 1.808 H |
| c011 | 7.5 | 2.066 | 1.883 F | 1.883 F |
| c012 | 8.9 | 1.798 | 1.735 H | 1.735 H |
| c013 | 9.96 | 2.003 | 1.670 F | 1.670 F |
| c014 | 10.5 | 1.805 | 1.707 F | 1.707 F |
| c015 | 11.3 | 2.149 | 1.970 F | 1.970 F |
| c016 | 12.1 | 2.154 | 2.015 F | 2.015 F |
| c017 | 12.9 | 2.193 | 2.235 F | 2.235 F |
| c018 | 13.57 | 3.398 | 3.266 F | 3.266 F |

### both-rays-25

| Frame | Time s | Hand bar | Before | After |
| --- | --- | --- | --- | --- |
| c001 | 0.3 | 0.321 | gap | gap |
| c002 | 0.6 | 0.349 | gap | gap |
| c003 | 2 | 1.015 | 1.058 F | 1.058 F |
| c004 | 3 | 1.216 | 1.224 F | 1.224 F |
| c005 | 4.2 | 1.365 | 1.580 F | 1.580 F |
| c006 | 5.3 | 1.723 | 2.273 F | 2.273 F |
| c007 | 5.7 | 1.823 | 2.519 F | 2.519 F |
| c008 | 6.2 | 1.862 | 2.429 F | 2.429 F |
| c009 | 6.63 | 1.913 | 2.649 H | 2.649 H |
| c010 | 6.76 | 2.034 | 2.615 H | 2.615 H |
| c011 | 7.5 | 2.066 | 2.561 F | 2.561 F |
| c012 | 8.9 | 1.798 | 2.361 H | 2.361 H |
| c013 | 9.96 | 2.003 | 2.682 F | 2.682 F |
| c014 | 10.5 | 1.805 | 2.235 F | 2.235 F |
| c015 | 11.3 | 2.149 | 2.732 F | 2.732 F |
| c016 | 12.1 | 2.154 | 2.884 F | 2.884 F |
| c017 | 12.9 | 2.193 | 2.997 F | 2.997 F |
| c018 | 13.57 | 3.398 | 5.201 F | 5.201 F |

### both-rays-15

| Frame | Time s | Hand bar | Before | After |
| --- | --- | --- | --- | --- |
| c001 | 0.3 | 0.321 | gap | gap |
| c002 | 0.6 | 0.349 | gap | gap |
| c003 | 2 | 1.015 | 0.900 F | 0.900 F |
| c004 | 3 | 1.216 | 1.041 F | 1.041 F |
| c005 | 4.2 | 1.365 | 1.344 F | 1.344 F |
| c006 | 5.3 | 1.723 | 1.933 F | 1.933 F |
| c007 | 5.7 | 1.823 | 2.142 F | 2.142 F |
| c008 | 6.2 | 1.862 | 2.066 F | 2.066 F |
| c009 | 6.63 | 1.913 | 2.253 H | 2.253 H |
| c010 | 6.76 | 2.034 | 2.224 H | 2.224 H |
| c011 | 7.5 | 2.066 | 2.178 F | 2.178 F |
| c012 | 8.9 | 1.798 | 2.008 H | 2.008 H |
| c013 | 9.96 | 2.003 | 2.281 F | 2.281 F |
| c014 | 10.5 | 1.805 | 1.901 F | 1.901 F |
| c015 | 11.3 | 2.149 | 2.324 F | 2.324 F |
| c016 | 12.1 | 2.154 | 2.453 F | 2.453 F |
| c017 | 12.9 | 2.193 | 2.549 F | 2.549 F |
| c018 | 13.57 | 3.398 | 4.491 F | 4.491 F |

### both-rays15

| Frame | Time s | Hand bar | Before | After |
| --- | --- | --- | --- | --- |
| c001 | 0.3 | 0.321 | gap | gap |
| c002 | 0.6 | 0.349 | gap | gap |
| c003 | 2 | 1.015 | 0.621 F | 0.621 F |
| c004 | 3 | 1.216 | 0.718 F | 0.718 F |
| c005 | 4.2 | 1.365 | 0.928 F | 0.928 F |
| c006 | 5.3 | 1.723 | 1.334 F | 1.334 F |
| c007 | 5.7 | 1.823 | 1.479 F | 1.479 F |
| c008 | 6.2 | 1.862 | 1.426 F | 1.426 F |
| c009 | 6.63 | 1.913 | 1.555 H | 1.555 H |
| c010 | 6.76 | 2.034 | 1.535 H | 1.535 H |
| c011 | 7.5 | 2.066 | 1.504 F | 1.504 F |
| c012 | 8.9 | 1.798 | 1.386 H | 1.386 H |
| c013 | 9.96 | 2.003 | 1.575 F | 1.575 F |
| c014 | 10.5 | 1.805 | 1.312 F | 1.312 F |
| c015 | 11.3 | 2.149 | 1.604 F | 1.604 F |
| c016 | 12.1 | 2.154 | 1.693 F | 1.693 F |
| c017 | 12.9 | 2.193 | 1.760 F | 1.760 F |
| c018 | 13.57 | 3.398 | 3.100 F | 3.100 F |

### both-rays25

| Frame | Time s | Hand bar | Before | After |
| --- | --- | --- | --- | --- |
| c001 | 0.3 | 0.321 | gap | gap |
| c002 | 0.6 | 0.349 | gap | gap |
| c003 | 2 | 1.015 | 0.563 F | 0.563 F |
| c004 | 3 | 1.216 | 0.651 F | 0.651 F |
| c005 | 4.2 | 1.365 | 0.841 F | 0.841 F |
| c006 | 5.3 | 1.723 | 1.209 F | 1.209 F |
| c007 | 5.7 | 1.823 | 1.341 F | 1.341 F |
| c008 | 6.2 | 1.862 | 1.293 F | 1.293 F |
| c009 | 6.63 | 1.913 | 1.410 H | 1.410 H |
| c010 | 6.76 | 2.034 | 1.391 H | 1.391 H |
| c011 | 7.5 | 2.066 | 1.363 F | 1.363 F |
| c012 | 8.9 | 1.798 | 1.256 H | 1.256 H |
| c013 | 9.96 | 2.003 | 1.427 F | 1.427 F |
| c014 | 10.5 | 1.805 | 1.190 F | 1.190 F |
| c015 | 11.3 | 2.149 | 1.454 F | 1.454 F |
| c016 | 12.1 | 2.154 | 1.535 F | 1.535 F |
| c017 | 12.9 | 2.193 | 1.595 F | 1.595 F |
| c018 | 13.57 | 3.398 | 2.810 F | 2.810 F |

### five-25

| Frame | Time s | Hand bar | Before | After |
| --- | --- | --- | --- | --- |
| c001 | 0.3 | 0.321 | gap | gap |
| c002 | 0.6 | 0.349 | gap | gap |
| c003 | 2 | 1.015 | 1.058 F | 1.058 F |
| c004 | 3 | 1.216 | 1.224 F | 1.224 F |
| c005 | 4.2 | 1.365 | 1.580 F | 1.580 F |
| c006 | 5.3 | 1.723 | 2.273 F | 2.273 F |
| c007 | 5.7 | 1.823 | 2.519 F | 2.519 F |
| c008 | 6.2 | 1.862 | 2.429 F | 2.429 F |
| c009 | 6.63 | 1.913 | 2.649 H | 2.649 H |
| c010 | 6.76 | 2.034 | 2.615 H | 2.615 H |
| c011 | 7.5 | 2.066 | 2.561 F | 2.561 F |
| c012 | 8.9 | 1.798 | 2.361 H | 2.361 H |
| c013 | 9.96 | 2.003 | 2.682 F | 2.682 F |
| c014 | 10.5 | 1.805 | 2.235 F | 2.235 F |
| c015 | 11.3 | 2.149 | 2.732 F | 2.732 F |
| c016 | 12.1 | 2.154 | 2.884 F | 2.884 F |
| c017 | 12.9 | 2.193 | 2.997 F | 2.997 F |
| c018 | 13.57 | 3.398 | 5.153 F | 5.153 F |

### five25

| Frame | Time s | Hand bar | Before | After |
| --- | --- | --- | --- | --- |
| c001 | 0.3 | 0.321 | 0.094 H | gap |
| c002 | 0.6 | 0.349 | 0.090 H | gap |
| c003 | 2 | 1.015 | 0.886 F | 0.563 F |
| c004 | 3 | 1.216 | gap | 0.651 F |
| c005 | 4.2 | 1.365 | gap | 0.841 F |
| c006 | 5.3 | 1.723 | gap | 1.209 F |
| c007 | 5.7 | 1.823 | gap | 1.341 F |
| c008 | 6.2 | 1.862 | 1.625 F | 1.293 F |
| c009 | 6.63 | 1.913 | gap | 1.410 H |
| c010 | 6.76 | 2.034 | 2.051 H | 1.391 H |
| c011 | 7.5 | 2.066 | gap | 1.363 F |
| c012 | 8.9 | 1.798 | gap | 1.256 H |
| c013 | 9.96 | 2.003 | gap | 1.427 F |
| c014 | 10.5 | 1.805 | gap | 1.190 F |
| c015 | 11.3 | 2.149 | gap | 1.454 F |
| c016 | 12.1 | 2.154 | gap | 1.535 F |
| c017 | 12.9 | 2.193 | gap | 1.595 F |
| c018 | 13.57 | 3.398 | gap | 2.810 F |

### ten-25

| Frame | Time s | Hand bar | Before | After |
| --- | --- | --- | --- | --- |
| c001 | 0.3 | 0.321 | 0.116 H | gap |
| c002 | 0.6 | 0.349 | 0.111 H | gap |
| c003 | 2 | 1.015 | 1.086 F | 0.735 F |
| c004 | 3 | 1.216 | gap | 0.850 F |
| c005 | 4.2 | 1.365 | gap | 1.098 F |
| c006 | 5.3 | 1.723 | gap | 1.579 F |
| c007 | 5.7 | 1.823 | gap | 1.750 F |
| c008 | 6.2 | 1.862 | 1.992 F | 1.687 F |
| c009 | 6.63 | 1.913 | gap | 1.840 H |
| c010 | 6.76 | 2.034 | 2.514 H | 1.816 H |
| c011 | 7.5 | 2.066 | gap | 1.779 F |
| c012 | 8.9 | 1.798 | gap | 1.640 H |
| c013 | 9.96 | 2.003 | gap | 1.863 F |
| c014 | 10.5 | 1.805 | gap | 1.553 F |
| c015 | 11.3 | 2.149 | gap | 1.898 F |
| c016 | 12.1 | 2.154 | gap | 2.004 F |
| c017 | 12.9 | 2.193 | gap | 2.082 F |
| c018 | 13.57 | 3.398 | gap | 3.668 F |

### ten25

| Frame | Time s | Hand bar | Before | After |
| --- | --- | --- | --- | --- |
| c001 | 0.3 | 0.321 | gap | gap |
| c002 | 0.6 | 0.349 | gap | gap |
| c003 | 2 | 1.015 | 0.735 F | 0.735 F |
| c004 | 3 | 1.216 | 0.850 F | 0.850 F |
| c005 | 4.2 | 1.365 | 1.098 F | 1.098 F |
| c006 | 5.3 | 1.723 | 1.579 F | 1.579 F |
| c007 | 5.7 | 1.823 | 1.750 F | 1.750 F |
| c008 | 6.2 | 1.862 | 1.687 F | 1.687 F |
| c009 | 6.63 | 1.913 | 1.840 H | 1.840 H |
| c010 | 6.76 | 2.034 | 1.816 H | 1.816 H |
| c011 | 7.5 | 2.066 | 1.779 F | 1.779 F |
| c012 | 8.9 | 1.798 | 1.640 H | 1.640 H |
| c013 | 9.96 | 2.003 | 1.863 F | 1.863 F |
| c014 | 10.5 | 1.805 | 1.553 F | 1.553 F |
| c015 | 11.3 | 2.149 | 1.898 F | 1.898 F |
| c016 | 12.1 | 2.154 | 2.004 F | 2.004 F |
| c017 | 12.9 | 2.193 | 2.082 F | 2.082 F |
| c018 | 13.57 | 3.398 | 3.668 F | 3.668 F |
