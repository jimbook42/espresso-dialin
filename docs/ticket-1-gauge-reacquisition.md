# Ticket 1 — gauge reacquisition investigation

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
