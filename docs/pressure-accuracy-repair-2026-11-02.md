# Pressure accuracy repair pass — 2 November 2026

## Verdict: not ready to merge

The pass fixes several concrete problems and improves some previously poor
clips, but **fails the coverage goal overall**. The new requirement for a match
against the calibrated face is too brittle after movement/appearance changes.
When that match fails, the implementation rejects the pose and can fail to
reacquire for a large part of the shot. It needs another repair/validation pass.

Do not interpret lower errors on the surviving readings as an overall accuracy
win. The number of scored published comparisons falls from **51 to 42**.

- Official stream coverage: **77.45% before → 62.84% after** (−14.61 percentage points).
- After: **2,346 fresh frames (59.23%)**, **143 held frames (3.61%)**,
  **1,472 gaps (37.16%)**, out of 3,961 frames.
- Published labelled median absolute error: **0.147 → 0.081 bar**;
  P90 **0.629 → 0.362 bar**; errors >1 bar **5.88% → 2.38%**.
- False-10 frame flags: **0 before, 0 after**, including **0 fresh / 0 held** after.
- Known serious regressions: `135116` coverage **90.50 → 11.45%**;
  `094055` **74.02 → 10.34%**; `160931` **81.16 → 18.84%**.
- Recent real-shot coverage also falls: `124006` **79.19 → 59.73%** and
  `130022` **80.50 → 55.50%**.

## Branch, exact candidate, and scoring integrity

Branch: `feat/pressure-accuracy-codex`.

Latest main was fetched and merged first (`19ab946`, incorporating main's
`5628c33`). The package version is **4.13.25 from main**; this pass did not bump
it. The updated AGENTS environment-only test rule applies.

The shared original checkout was being used by another chat, so the work ran
in an isolated managed worktree:
`C:/Users/Isaac/.codex/worktrees/pressure-accuracy-repair/espresso-dialin`.

The tested runtime candidate is **`d758da29ba80475f4d8247dccf983098a2254d60`**.
No runtime source was changed after the final exam started. Later commits only
record inspection and results. There was no retraining, dependency addition,
weight/config/fixture/label edit, DB/schema migration, existing user-data edit,
auth/privacy change, merge to main, or deployment.

The unchanged live exam ran **once** on that candidate. Command:

```text
node --import ./scripts/needle-reader/out/exam-observer.mjs scripts/needle-reader/exam.mjs --live
```

The preload is a read-only Node debugger observer. It captures returned publisher
observations and the exam's existing `clipSummary(result)` input. It does not
change arguments, returned values, labels, clips, thresholds or score code.
Its two-frame plumbing probe was checked before the exam. The observed frame
counts, published counts and labelled medians were checked against the official
result. The complete run finished successfully; it was not rerun after seeing
the regressions. Debugger instrumentation makes timing figures unsuitable for
performance comparisons.

The preserved initial baseline is
`pressure-accuracy-2026-11-02-baseline.json`. Full before/after details and actual
after-run label hits are in `pressure-accuracy-2026-11-02-after.json`.
Raw official outputs, read-only observations, browser checks and diagnostic
images stay under ignored `scripts/needle-reader/out/`. No video or image was
committed or uploaded.

## Before versus after, all clips

Coverage is the official exam's percentage with a published value, including
held output. Fresh and held columns explicitly separate those cases after repair.
Medians and worst errors are in bar; worst errors are signed. Within-0.3
denominators count published comparisons and exclude missing readings.

`—` in an older baseline within/worst cell means the original baseline did not
save individual hits. Its summaries cannot recover those values reliably, so
they are left unavailable rather than filled with estimates. Baseline hand-clip
worst values are the recorded two-decimal values. Exact fresh/held baseline
counts were also not recorded; 75 explicit hold/hold-max flags are a lower bound
on held frames, not a complete classification.

<!-- The checked table from the single run is appended below. -->

| Clip | Coverage before → after | Fresh / held after | Median before → after | Within 0.3 before → after | Worst signed before → after | >1 bar % before → after | False 10 before → after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 20261015_225219 | 82.00 → 100.00 | 100.00 / 0.00 | 0.000 → 0.003 | — → 1/1 | — → 0.003 | 0.00 → 0.00 | 0 → 0 |
| 20261015_225307 | 72.73 → 90.08 | 86.78 / 3.31 | — → 0.014 | — → 1/1 | — → -0.014 | — → 0.00 | 0 → 0 |
| 20261017_084814 | 43.95 → 91.58 | 90.26 / 1.32 | 0.757 → 0.169 | — → 5/5 | — → -0.293 | 33.33 → 0.00 | 0 → 0 |
| 20261017_084919 | 79.62 → 95.30 | 95.30 / 0.00 | 0.551 → 0.007 | — → 3/3 | — → 0.123 | 33.33 → 0.00 | 0 → 0 |
| 20261017_134943 | 95.55 → 90.68 | 88.35 / 2.33 | 0.429 → 0.145 | — → 3/4 | — → 0.651 | 0.00 → 0.00 | 0 → 0 |
| 20261017_135116 | 90.50 → 11.45 | 11.45 / 0.00 | 0.437 → 0.001 | — → 1/1 | — → -0.001 | 0.00 → 0.00 | 0 → 0 |
| 20261018_094055 | 74.02 → 10.34 | 10.11 / 0.23 | 0.600 → 1.272 | — → 0/1 | — → 1.272 | 25.00 → 100.00 | 0 → 0 |
| 20261018_094151 | 85.71 → 87.50 | 83.33 / 4.17 | 0.283 → 0.015 | — → 3/3 | — → 0.157 | 0.00 → 0.00 | 0 → 0 |
| 20261018_160844 | 59.47 → 91.69 | 78.07 / 13.62 | 0.140 → 0.087 | — → 3/5 | — → -0.369 | 0.00 → 0.00 | 0 → 0 |
| 20261018_160931 | 81.16 → 18.84 | 18.84 / 0.00 | 0.091 → 0.041 | — → 2/2 | — → -0.053 | 0.00 → 0.00 | 0 → 0 |
| 20261024_124006 | 79.19 → 59.73 | 55.93 / 3.80 | 0.155 → 0.084 | 8/11 → 9/10 | -0.410 → 0.542 | 0.00 → 0.00 | 0 → 0 |
| 20261025_130022 | 80.50 → 55.50 | 43.00 / 12.50 | 0.075 → 0.083 | 12/12 → 5/6 | 0.280 → 0.326 | 0.00 → 0.00 | 0 → 0 |

## Fresh versus held accuracy

The after stream classification above is exact for this run. Holds expire after
450 ms, are marked uncertain, and do not enter the saved confident pressure curve.
Exact duplicate gauge pixels cannot create fresh samples, even if a driver
increments its presented-frame ID. Fresh observations are timestamped when the
camera frame is presented; model observations retain their source capture time.

Among the after labelled comparisons, **40 are fresh-derived**, with **36/40
within 0.3 bar**, **0.066 bar median error**, **2.5% over 1 bar**, and worst
**+1.272 bar at 2.7 s on 094055**. For the two hand clips, “fresh-derived” means
the unchanged scorer's display windows built from fresh samples; it does not
assert that a fresh sample exists at the exact hand timestamp.

Two additional old-clip labelled comparisons are held values, both on `160844`:
**0/2 within 0.3**, median error **0.367 bar**, worst **−0.369 bar at 18 s**,
none over 1 bar. The hand scorer does not score held output independently.
The JSON report retains both fresh and held label summaries and the original
after label-hit fields.

There is no justified exact fresh-versus-fresh baseline comparison: the original
run did not retain that classification. The official published-value coverage
comparison still demonstrates a substantial regression.

## What improved and what failed

- **084814:** coverage rises from 43.95 to 91.58%; 343 fresh and 5 held frames.
  All five labels are now shown and within 0.3 bar. At 18.5 s the repair reads
  approximately 4.99 against 5.16 bar, replacing the separately diagnosed
  baseline raw value of 2.98. Static-face registration removes the spurious
  +20° scale rotation. Worst labelled error is −0.293 bar at 22 s.
- **084919:** coverage rises from 79.62 to 95.30%, entirely fresh; median
  0.551 → 0.007 bar, all three labels within 0.3.
- **160844:** fresh coverage is 78.07%, plus 13.62% held, compared with 59.47%
  baseline published coverage. Its two held labelled readings remain too low
  by about 0.37 bar; holds are no longer recorded as confident samples.
- **135116:** only 41/358 frames are fresh; **317 are pose-lost**. At 5 s the
  accepted hub is stuck near (491,615); at 22.382 s the existing labelled hub
  is (450,627), and pressure is withheld. The frozen reference match fails to
  sustain/reacquire the face as its appearance/pose changes.
- **094055:** 390/435 frames are pose-lost. At 2.7 s a fresh reading is
  **1.272 bar against a rest label of 0**; by 40 s the held tracker position
  is 64.8 px from the labelled hub. This is both a confidence/needle error
  and a failed reacquisition case.
- **160931:** 237/292 frames are pose-lost. Its small median error describes
  only two surviving labelled readings and cannot excuse the lost coverage.
- **124006:** the rise is better represented at 30.375 s (5.26 vs 5.17 bar)
  and 33.375 s (7.25 vs 7.29), but the 14 s and 22 s comparisons disappear.
  A worse +0.542 error occurs at 29 s in the scorer's display window, while
  the nearby raw sample is about 2.23 against hand 2.22. The unchanged hand
  scorer's ±0.3 s window can include the imminent rise; raw and displayed
  comparison errors must be distinguished.
- **130022:** only six hand comparisons remain. Missing examples include
  10, 13, 16, 22, 25, 34 and 37 s. The 49.375 s comparison becomes available,
  but is +0.326 bar against the slightly negative hand value. Coverage and
  hand accuracy therefore fail the intended preservation check.

The new strict registration gate prevents a round rim alone from certifying a
changed face. That avoids some false rotation but is too fragile in its current
form. Because a rejected match also freezes the accepted pose, later movement
can compound reacquisition failure within the retained 48 px search limit.
Inspection establishes this failure mode; it does not prove which combination
of illumination, perspective, feature support and initial fit dominates every
clip. No per-clip thresholds or exceptions were added after seeing these scores.

The exam still computes its legacy flip metric using old model-angle/reason
semantics. The reported flip percentages are preserved in JSON but are not used
as a physical needle-direction accuracy claim for the repaired path.

## Today's shot and the no-rest requirement

Isaac clarified that the recorder starts at shot start after the countdown.
The supplied video and saved pressure curve are therefore treated as sharing
the shot-start time origin for this inspection. Countdown/recording behavior
was not changed.

Visual inspection at 0.5 s spacing shows little needle movement through 13.5 s
and a clear rise by 14 s. The saved curve moves from 0.744 bar at 13.774 s to
2.019 at 13.910 s. Saved-sample crossings are 2 bar at **13.908 s**, 5 bar at
**15.074 s**, and 6 bar at **16.168 s**. There is a **399 ms gap from 15.121 to
15.520 s**. These observations do not show a full one-second onset delay at
that visual resolution; they do not establish accurate mid-rise pressure.

The export lacks the original user calibration, so an exact post-repair replay
with those taps cannot be claimed. A separate, explicitly unscored angular-only
diagnostic used visible estimates from frame 0: centre (344,503.3), five
(378,538.3), ten (316.7,544). Its zero came from the pins and the existing
rest-to-ten profile, not from assuming the first recorded needle was at rest.
Those coordinates were chosen once and not tuned against the pressure curve.

That diagnostic also **failed to maintain registration**: 87/298 frames were
fresh, 209 were pose-lost; only 8/41 frames in 12–17 s were fresh. There were no
fresh samples in the chosen 13–13.5 s angular baseline window, so a repaired
angular-onset time could not be computed. Zero remained unchanged. This is an
additional robustness warning, not a scored accuracy result or proof of what
the missing original calibration would have produced. No diagnostic bar curve
was substituted for Isaac's saved data.

The implemented reader starts with no prior needle angle, retains calibration
hub/rays/zero, and searches the calibrated arc on its first measurement. A
zero-angle pin at exactly 0° is accepted (fixing the old truthiness check).

The actual React hook was checked in Edge using the real 124006 video as a
camera source starting at **30.003 s**, after calibration on a separate frozen
frame. It started at about **4.96 bar**, with its first saved sample at 0.124 s
of the test shot. No rest frame was fed to the running shot and the calibration
was unchanged. The browser test saved 41 fresh observations, then added none
after the paused source's queued final frame drained; the readout expired to
a gap. This establishes that the startup logic does not require a recorded rest
frame, while the full exam shows that general tracking robustness is not solved.

The browser loaded and ran the unchanged ONNX model. A real test frame produced
confidence about 0.69 but an angle mapping outside the tap arc, so that prediction
was rejected. The model still has accuracy limitations. The unchanged exam's
private model sampler emits legacy canonical values without capture/pose
metadata; the repaired publisher deliberately cannot certify pressure from
those values. The exam thus assesses the repaired classical path, while the
actual registered asynchronous model path was exercised separately in-browser.

**Separate countdown suggestion:** extra pre-lever frames could help diagnose
exposure settling and check reacquisition before the pull. This pass does not
establish that recording during the countdown would solve the failures, and
the repaired pipeline must work from calibration without requiring those frames.
No countdown, recorder-start or camera-view change was made.

## Validation

- Final `npm run test:vitest`: **437 passed, 2 failed, 1 skipped** (440 tests).
  Files: **83 passed, 3 failed, 1 skipped** (87). The only failures are the
  two documented Python-dependent needle-reader tests and the box-only temporal
  replay suite missing `/workspace/.../raw-frames.json`. Under updated AGENTS
  these are environment-only and do not block. No tests were deleted or skipped
  to obtain these results.
- Final `npm run build`: **passed**, including service-worker generation.
  Existing large-chunk warnings remain.
- Browser check: **passed** on the actual hook with real video, OpenCV and ONNX
  WASM, no-rest startup, saved fresh samples and stalled-source expiry. No browser
  errors; all requests were local. Vite's dev server rejects the public ORT
  `.mjs` dynamic import, so this isolated QA harness served the unchanged loader
  statically as production does. That existing dev-serving limitation was not
  changed in this pass.
- Changed-file lint found 7 errors and 1 warning, all already present on main:
  three unused-symbol findings in the legacy R6 reader and the existing React
  hook ref/effect/dependency diagnostics. New pure modules and new changes add
  no lint findings. The baseline comparison was retained locally.
- The final live exam completed **once**. It **fails the intended coverage and
  recent-clip preservation goals**, despite the unit/build checks above.
- Protected exam/scoring code, frozen config, model weights and fixtures have no
  diff from the preserved baseline. No phone/hardware-camera benchmark was run.

## Commits and files

Main integration: `19ab946`.

1. `4974a3b` — calibrated static-face registration and rim scale.
2. `9d2e362` — tap-registered model crop and output mapping.
3. `3e972b1` — fresh observations, bounded display holds and capture timestamps.
4. `1b61a2a` — bidirectional ridge recovery and transient-reference restoration.
5. `da93296` — stalled-camera and cross-calibration inference guards.
6. `d758da2` — duplicate pixels and presented-frame timestamps; examined candidate.

Repair source/test files, all under `src/flairPressureLab/`:

- `cameraFrameFreshness.js`, `cameraFrameFreshness.vitest.js`
- `classicalReaderR6.js`
- `dialRegistration.js`, `dialRegistration.vitest.js`
- `hooks/useShotLabPressure.js`
- `needleModel.js`
- `shotLabR7Live.js`, `shotLabR7Needle.js`
- `tapCalibrate.js`, `tapCalibrate.vitest.js`
- `tapNeedleModel.js`, `tapNeedleModel.vitest.js`
- `tapReadingPublisher.js`, `tapReadingPublisher.vitest.js`

New review artifacts: this report and
`docs/pressure-accuracy-2026-11-02-after.json`. The earlier baseline documentation
remains unchanged. The main merge also carries its unrelated chart/version
changes, not authored as part of this pressure repair.

## Next step

Review this as an experimental branch. Repair loss/reacquisition before merge:
use recent verified face evidence with calibration consistency checks, handle
appearance changes, and allow recovery without changing the user's zero or
raising confidence on a missing needle. Keep the fresh/held separation and the
fixed protection against jumping to another circle. No retraining is proposed
as the first response to this regression.

A further corrected candidate needs another explicitly agreed single final exam;
the one allowed run for this pass has been used and all its bad numbers are
preserved here. Nothing was merged or deployed.
