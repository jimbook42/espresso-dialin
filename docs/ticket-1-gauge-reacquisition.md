# Ticket 1 — gauge reacquisition investigation

The original investigation below describes `26e09a3`. See the follow-up at the end for the repaired branch.

Date: 9 November 2026 (Pacific/Auckland).
Base: `main` / `origin/main` verified by fetch at `bd74b383b9f66d395aa0dad62959ff07c6ca54c8`, version 4.14.7.
Branch: `fix/lab-pose-reacquire-lever-raised`.

**NOT READY — FURTHER WORK REQUIRED.** Two implementation repair rounds exhausted.
The failing regression remains enabled. No version bump, merge, push or deployment.

## A. Diagnosis

The live hook calls `readCalibratedFrame` in `tapCalibrate.js`, then the R7 publisher.
The whole-frame discovery used elsewhere in `gaugeTrack.js` was not called by this
calibrated tracking path.

1. `trackPose` searches around the last accepted hub: 10 px near, 28 px follow,
   and at most 48 px with the default leap cap. Its rim sampling radius was always
   `calibration.radius / 0.9`; candidate radii also had to remain within
   0.82–1.22 of the previous pose. Large translation/size changes can miss these
   windows even though the gauge remains visible.
2. `readCalibratedFrame` rejects a registered hub farther than 48 px from the last
   pose. On failure it restores that pose and reports `lost`. Subsequent searches
   therefore start from the same obsolete geometry. Needle detection is not run
   when `bezelOk` is false; the R7 tap publisher reports `pose-lost`, with no bar.
3. Registration's loss seed discarded old translation but retained old absolute
   pixel scale, although both patches were normalized to the proposed radius.
4. The pre-shot and shot-start pose warning rejected displacement greater than
   0.6 calibration radii even when original-face registration succeeded. This is
   a UI rejection, independent of pressure publishing.
5. Exact-repeat detection inspected only the original calibration region. A
   sufficiently distant recovered gauge could change outside that window.
6. Model results already carry their source timestamp and geometry; those checks
   reject old, moved or rotated results. They did not identify a loss/recovery
   boundary returning to the same coordinates, or explicitly reject absent frames.

No calibration pressure-map change is needed: the existing inverse affine angle
mapping and original zero/5/10 anchors remain the correct relationship.

The two historical shot IDs in the ticket were not present in available local
diagnostics. This is a reproduced code-level failure mechanism, not a claim that
every rejection in those historical shots has been explained.

## B. Partial implementation

- Keep the existing local tracking and the 48 px cap. On registration failure,
  use existing Hough candidate discovery, original-reference forward/backward LK,
  RANSAC, sector/residual/transform gates and a native rim-confidence check.
- Wide candidates additionally need correlation of at least 0.85 on printed
  interior pixels (excluding the common bezel and original needle sector), one
  unambiguous matched location and two agreeing observations. No new reference
  is learned during reacquisition. No transient reference means no wide recovery.
- Reuse the existing rotation-profile matcher to propose initial flow, with
  bounded orientation retries. These proposals cannot certify geometry by themselves.
- Sample the local rim around the current accepted radius; normalize the lost
  registration seed's scale. Preserve the legacy radius behavior.
- Carry an in-memory pose epoch into model samples. Reject model results from
  another epoch, duplicate pixels or absent frames, in addition to existing gates.
- Include the recovered region in exact-repeat checks. Allow the existing pose
  warning to accept displacement only when a current face registration verifies
  it. Keep the existing status indicator, hysteresis and readability requirement.

This avoids accepting a circle from proximity alone, expanding an unverified
leap cap, changing confidence thresholds, or changing the original pressure scale.
Existing optical-flow and needle gates have not been relaxed. The new wide
identity threshold is additional validation, not an examination threshold change.

An initial corner-only identity experiment admitted shared bezel features; it was
replaced in repair round one. The final synthetic rejection cases publish no fresh
pressure. Repair round two still fails combined abrupt rotation/translation/scale.

## C. Automated evidence

Synthetic images are 480×480 RGBA, with a 70 px initial radius, asymmetric face
texture, a visible bezel and a long thin pointer. A one-level alternating sensor
noise pattern supplies new stationary frames; identical frames are tested separately.
The production calibration, OpenCV, pointer detection, R7 publisher and pre-shot
sampler are used without mocking their validation results. These images do not
represent real glare, lens distortion, perspective changes, blur or phone CPU cost.

An unchanged-reader comparison loaded `main`'s original tap and registration
modules against exactly the same synthetic pixels. Every run first read the
stationary 5-bar input as 4.998 bar. Baseline movement results were 0/10 fresh reads
and 10/10 lost frames for each movement case below.

| Scenario after calibration | Branch fresh / frames | First fresh, capture-time offset | Max absolute 5-bar error |
| --- | ---: | ---: | ---: |
| Stationary | 10/10 | 0 ms | 0.004 bar |
| Right, +140 px | 9/10 | 125 ms | 0.011 bar |
| Left, −90 px | 9/10 | 125 ms | 0.010 bar |
| Up, −130 px | 9/10 | 125 ms | 0.009 bar |
| Down, +110 px | 9/10 | 125 ms | 0.021 bar |
| Radius +35% | 9/10 | 125 ms | 0.047 bar |
| Radius −35% | 9/10 | 125 ms | 0.081 bar |
| +140/−70 px, radius −30%, rotation +12° | 0/10 | Not recovered | No pressure published |

Movement success: 6/7 scenarios (85.7%). Including the stationary control: 7/8.
Coverage across this 80-frame matrix: 64/80 (80%); movement-only: 54/70 (77.1%).
These are deterministic scenario counts, not estimated population success rates.
All accepted representative 0, 2.5, 5, 7.5 and 9-bar synthetic inputs were within
0.3 bar. No synthetic 10-bar reading was manufactured or tested as an initial jump.

The capture-time offset is **not wall-clock latency**. At the 125 ms nominal
cadence the matcher confirms on the second frame, but full-suite desktop
processing reached 2,591 ms/frame. Stationary median was 140 ms in that run;
movement-case medians were 134–323 ms. The separate unchanged-reader comparison
had a 183 ms stationary median, with failed movement medians 37–72 ms. These
concurrent runs are not a controlled speed comparison. The costly wide search
does extra work; the approximate one-second real-device target is unproven and
cannot be claimed met from these measurements.

Additional new checks pass: gradual movement across Start, five-frame disappearance,
hand obstruction, recovery to readable status at the raised position, unchanged
calibration bytes, duplicate pixels, distant-region freshness, stale model epochs,
wrong orientation, another printed face, a plain circle and a missing needle.
The four invalid-scene tests cover 32 frames with zero fresh pressure outputs.

### Required commands

| Check | Result |
| --- | --- |
| `npm run test:vitest -- --maxWorkers=2 --minWorkers=1` | **FAIL:** 583 passed, 2 failed, 4 skipped; 1 unhandled worker RPC timeout |
| Final focused five-file run | **FAIL:** 41 passed, 1 failed (combined pose) |
| `npm test` | **FAIL:** local-time assertion at `csvTimestamp.test.js:29`; suite stops |
| `TZ=UTC` / `npm test` (PowerShell process environment) | **FAIL:** reaches unchanged legacy `gaugeConfig.test.js:742`; remaining suites do not run |
| `npm run lint` | **FAIL:** ESLint stack overflow in generated `public/flair-pressure-lab/opencv.js:23` |
| Changed-file lint excluding the hook | PASS, 0 errors/warnings after removing an unused assignment |
| Hook lint / unchanged `main` hook via stdin | Both have the same 10 existing React-hook errors and 1 warning |
| `npm run build` | PASS, existing large-chunk warning |
| `node scripts/playwright-shot-screen-smoke.mjs` | PASS: 5 passed, 0 failed, own correctly started preview on port 4181, isolated browser storage |

The second full-suite failure is `lowPressureBatch.vitest.js`: the November 3
real-frame regression recovers 4 instead of 5 designated frames with the
`hub-x-10` calibration perturbation. It is treated as a regression, not an
environment exception. Tests and their expected values were not changed.
An unchanged-main comparison through a temporary module loader (same original
analysis script and fixtures) confirms 5 recovered frames in all three cases;
its false-rest counts are 0/1/4 for true/hub-x-10/hub-y-10, respectively.
The unchanged legacy gauge test reproduces its assertion failure in isolation;
its gauge-tracking code and test file have no diff from `main`.
The four skips were existing test conditions: temporal replay (2), Python needle
rectification (1), viewport (1). The Python gauge-profile check passed here.
The Linux whole-video replay harness requires `/proc/meminfo`, `flock` and external
`/workspace` fixtures; it was not run on Windows.

### Single live examination

`node scripts/needle-reader/exam.mjs --live` completed once, without reruns.
Examination scripts, labels and frozen configuration are unchanged.

- 12 clips, 3,961 stream frames, 57 scored labelled readings.
- Stock stream coverage: **95.25%**, including short display holds.
- Fresh tap coverage on the ten standard clips, derived from `tap-fresh` reason
  counts: **2,750/3,114 = 88.31%**. The hand-clip summaries do not export a separate
  fresh-frame count.
- Labelled median absolute error: **0.075 bar**; P90: **0.264 bar**; stock wild rate: 0%.
- False-10 count: **0** across all twelve clips.
- Hand-labelled clips: 24/25 readings within 0.3 bar. Worst hand error: **0.40 bar**
  at 49.375 s in `20261025_130022`; the other hand clip's worst was 0.22 bar.
- Overall worst labelled error: **not exported by the unchanged scorer**; do not
  interpret the hand-only maximum as the overall maximum.
- Stock angle-flip metric: **37.5%**. The scorer selects `snap.r5Angle` for
  `tap-fresh` results (only `classical-direct` selects the classical angle), so
  this metric concerns the separately recorded model angle, not the tap needle
  angle that produced these pressure values. It remains an unresolved reported
  metric; neither scoring code nor labels were changed to remove it.
- Median-of-clip processing medians: **214.7 ms/frame**. No settling-to-reacquisition
  timestamp is exported by this exam, so it does not prove the one-second target.

Full stock results remain in `scripts/needle-reader/out/exam-live.json` and
`exam-live.txt` (ignored generated outputs). These are existing labelled videos,
not a fresh real-phone lever-movement verification.

The existing exam passes model bar/confidence/angle without registered-model
metadata, so it does not validate the live asynchronous model-recovery channel.
That channel's epoch/age/pose rejections and model geometry are covered by unit
tests; camera/inference scheduling on the actual phone remains unverified.
Its stock stream coverage counts non-null display bars, including short holds;
it is not the same metric as the synthetic matrix's fresh/confident coverage.
The stock output does not export the overall maximum labelled error.

## D. Files and release boundary

Changed production files in `src/flairPressureLab/`:
`tapCalibrate.js`, `dialRegistration.js`, `cameraFrameFreshness.js`,
`hooks/useShotLabPressure.js`, `preShotReadableStatus.js`, `shotStartDialPoseCheck.js`,
`shotLabR7Needle.js`, `tapReadingPublisher.js`.

Tests: `leverReacquisition.vitest.js` (new), `cameraFrameFreshness.vitest.js`,
`shotStartDialPoseCheck.vitest.js`, `tapReadingPublisher.vitest.js`.
Report: this file.

No dependencies, schema, calibration records, saved shots, auth, privacy settings,
diagnostic/export formats, auto-stop logic, UI layout, examination fixtures or
version fields changed. The pre-existing untracked `batch-2026-11-02` directory
was left alone. Temporary baseline comparison modules are removed before commit.

## E. Remaining verification and next action

Keep production unchanged. Additional work must address the combined-pose failure,
the lost real-frame recovery and the expensive fallback before a release candidate.
Do not improve coverage by relaxing identity or needle validation.

Needed real-device evidence: a recording starting before calibration with the
lever down, continuous lever raising, about two seconds settled before Start,
then extraction with at least one temporary obstruction. Include the original
video and the existing diagnostic export with calibration anchors, application
version, timestamps, camera facing mode and shot ID. Do not change export formats.
Measure settling-to-first-confident-reading, current pose correctness, true needle
accuracy, gaps, false readings and frame-processing cost on the actual stationary
phone beneath the Flair 58, using front camera and rear camera separately.

This branch is a reviewable partial result with intentionally retained failing
tests, not a production-ready fix. Further implementation requires Isaac's next
instruction after the two-round stop.

## Follow-up repair from `26e09a3`

The November 2–3 and `new` replay exports contain shot video and pressure curves. The older screen recordings were made by feeding existing clips into a browser. The app starts its replay recorder and diagnostic timeline when the shot timer runs. None of the reviewed files establishes the original frozen calibration frame and continuous lever raise before Start with the phone stationary. The real-frame regression remains useful for checking ordinary tracking against `main`.

The combined synthetic case found the gauge but rejected every candidate at affine validation. For example, 12 inliers out of 32 surviving matches fell short of the existing 50% requirement. Several fits estimated about 9–10° for the 12° input. Excluding bezel corners alone left the printed-pixel agreement below 0.85. Restricting the flow window to local printed detail produced a verified fit. The tracker now keeps that fit method after wide recovery. The affine, identity, rim and needle acceptance gates are preserved.

For `hub-x-10`, frame `c005` changed from fresh on `main` to `pose-lost` at `26e09a3`. A temporary reader that reverted only local rim sampling reproduced `main`'s scores and recovered the missing frame. Reverting the lost-flow seed alone did not. Local rim sampling uses the calibrated radius again. Wide discovery supplies the changed geometry when local tracking loses the dial. All three real-frame cases recover 5/5 designated frames. The correctly placed calibration has zero false rests. The deliberately perturbed `hub-x-10` and `hub-y-10` cases retain `main`'s 1 and 4 false rests respectively. The previous revision happened to report 1 for `hub-y-10`.

All seven synthetic movement cases recover on the second captured frame. The complete 80-frame matrix publishes 73 fresh readings with a maximum absolute 5-bar error of 0.101 bar. The four invalid-scene tests produce zero fresh readings across 32 frames. The separate continuation test observes zero whole-frame searches over ten fresh frames after the combined transform locks.

Back-to-back desktop timings used the same 480×480 synthetic images and instrumented copies in one Node process. Times cover `readCalibratedFrame` and exclude image generation, browser capture and ONNX inference.

| Frame path | Starting commit median / P95 / max | Repair median / P95 / max |
| --- | ---: | ---: |
| Normal tracking | 47 / 61 / 77 ms (72 frames) | 44 / 60 / 118 ms (82 frames) |
| Whole-frame search | 518 / 620 / 720 ms (16 frames) | 172 / 213 / 221 ms (14 frames) |

The earlier loaded desktop run reached 2.54 s per frame. Registration took about 86% of search-frame processing time in the paired starting-commit run. Its retries ran forward/backward optical flow and sometimes an affine fit for up to 12 circle proposals with six seeds each. The smaller window and single pyramid level cut the cost of those attempts. Full discovery ran twice per repaired movement case and zero times in the 82 normal tracking frames. These desktop measurements and the nominal 125 ms sample spacing leave the one-second phone target unverified. Local traces are in `scripts/needle-reader/out/ticket1-followup/paired-reader-study.json` and `real-ablation.json`.

| Validation | Result |
| --- | --- |
| Focused Vitest | 28 passed, 0 failed, one worker RPC timeout |
| Full Vitest | 586 passed, 0 failed, 4 existing skips |
| Legacy suite | Local-time CSV assertion and UTC legacy gauge assertion both reproduce earlier failures |
| Lint | Generated OpenCV asset causes an ESLint stack overflow. The three changed source and test files lint cleanly. |
| Build | Passed |
| Playwright shot-screen smoke | 5 passed, 0 failed |

The single stock exam completed on the repair with 12 clips, 3,961 frames and 57 scored labels. Stream coverage went from 95.25% to 94.62%. Standard-clip fresh coverage went from 2,750/3,114 (88.31%) to 2,740/3,114 (87.99%). Median absolute error went from 0.075 to 0.099 bar and P90 went from 0.264 to 0.255 bar. The worst hand-labelled error was 0.40 bar at 49.375 s. The stock report does not export the overall maximum. False-10 count was zero. The stock model-angle flip metric was 37.5%. The median of clip processing medians was 75.3 ms on this run. Saved output from `26e09a3` is in the local follow-up output directory for comparison.

A frame-level trace of `20261015_225307` matches `main` on all 121 published outcomes, including 56 fresh and 34 held readings. The starting commit had 58 fresh and 43 held readings on that clip. `20261018_094151` exposes an unresolved regression after the smaller fit takes over. The repair has 287 fresh readings and 7 pose losses versus 286 fresh readings and 2 pose losses on `main`. Six full searches occur after the initial recovery. The round-two attempt to retry the original local fit with pose agreement bounds produced identical counts on all 336 frames and was removed. The retained code and exam results are from round one. Keep release on hold for real-device evidence and review of those extra losses.

For device evidence, start the phone's screen recorder before calibration in the installed PWA. Calibrate with the lever down and return to the Dial screen. Raise the lever with the phone fixed, leave it settled for three seconds, then Start. Stop and save the shot, then use **History → Export replay** before reload or the next shot. Keep the original recording and export files and note the phone, OS, camera and app version. If available, a second camera framing the lever and Dial screen together can establish pre-Start timing. A separate run with the shot timer already running for two seconds before the lever raise puts the transition in the native replay for pixel analysis and fresh-reading timing during a shot. Capture Android Chrome first and repeat on the installed iPhone PWA for compatibility verification.

## Ticket 1C tracking stability

The 336-frame replay of `20261018_094151` used the same decoded frames, stored taps and 125 ms sampling for all three readers. The branch at `3993b3c` found the dial at 15.750 s and confirmed it at 15.875 s, one sample before main could read it. The verified rotation was under one degree. That recovery switched local tracking to the small-window fit over the inner face. Six later frames had too few forward/backward matches or affine inliers in that fit. Four searches identified a single matching gauge without the second confirmation needed to publish. Two found no verified gauge. The local fit resumed on the next frame after each loss.

Main produced fresh measurements at 18.625, 21.125, 24.375 and 39.250 s and display holds at 24.625 and 31.500 s. The branch emitted a pressure gap at each of those timestamps. The sampled video shows repeated lever movement and a clear pressurized dial at 21.125 s. It does not establish the app's Start time or extraction phase.

The repair retains the inner-face fit as the first attempt. When it fails on a locally tracked, nearly upright face after a verified recovery, the reader tries the same rim with the established broader flow window. This retry needs fresh affine evidence and the same printed-pixel agreement as full recovery. Both rotations must be within the local retry bound. The four restored measurements were within 0.048 bar of main on those frames. Those timestamps are between labels. Synthetic validation, labelled examination and the exact frame traces serve separate purposes.

| Same-clip replay | Main | `3993b3c` | Ticket 1C |
| --- | ---: | ---: | ---: |
| Pose losses | 2 | 7 | 1 |
| Whole-frame searches | 0 | 8 | 2 |
| Fresh readings | 286/336 | 287/336 | 292/336 |
| Median / P90 absolute error, three labels | 0.200 / 0.255 bar | 0.226 / 0.229 bar | 0.224 / 0.226 bar |
| Worst of the three labelled errors | 0.268 bar | 0.229 bar | 0.227 bar |
| Median normal frame | 62.7 ms | 60.7 ms | 60.4 ms |
| Median whole-frame search frame | — | 307.9 ms (8) | 317.9 ms (2) |
| Median frame for the two common searches | — | 312.7 ms | 317.9 ms |

Desktop reader timings came from one interleaved replay. Total time in whole-frame search fell from 2.20 to 0.55 seconds on this clip. The 125 ms interval from loss to recovery is replay sample spacing. Phone recovery latency still requires a recording of the fixed phone and lever through calibration and movement. The local frame trace and per-label errors are in `scripts/needle-reader/out/ticket1c/`.

The unchanged live exam completed with 12 clips, 3,961 frames and 57 scored labels per revision.

| Live exam | Main | `3993b3c` | Ticket 1C |
| --- | ---: | ---: | ---: |
| Standard-clip fresh readings | 2,741/3,114 | 2,740/3,114 | 2,745/3,114 |
| Standard-clip pose losses | 5 | 10 | 4 |
| Overall display coverage | 94.98% | 94.62% | 94.93% |
| Median / P90 absolute error | 0.098 / 0.271 bar | 0.099 / 0.255 bar | 0.099 / 0.255 bar |
| Worst error printed for hand-labelled clips | 0.40 bar | 0.40 bar | 0.40 bar |
| False 10-bar readings | 0 | 0 | 0 |

All seven synthetic movement cases and the stationary case passed with 73/80 fresh readings and a maximum absolute error of 0.101 bar. The five designated real frames passed in each existing calibration case. No invalid scene produced a fresh reading, including the new case that replaces the dial immediately after recovery. Final validation recorded 53 focused passes, 587 full-suite passes with four existing skips, a successful build and five passing browser smoke checks.
