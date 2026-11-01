# Live pressure accuracy diagnosis — 2 November 2026

## Decision and scope

Stop after diagnosis, as requested. The recommended first implementation pass is
**4–6 hours**, with **no model retraining initially**. No runtime code, model,
configuration, exam/scoring script, labels, fixtures, version, or stored data was
changed. No merge or deployment was performed.

Branch: `feat/pressure-accuracy-codex`, created from latest fetched `origin/main`,
`876735d` (package version 4.13.24). Model requested: gpt-6.1-sol, high effort.

The central problem is unreliable geometry and inconsistent evidence between
stages. Raising coverage by loosening gates would also admit genuinely wrong
readings. Repairing registration, model coordinates and freshness together needs
more than the authorized couple of hours.

## Single baseline exam

Command: `node scripts/needle-reader/exam.mjs --live`.

The sandboxed attempt stopped at ffprobe before reading any video frames. One
complete exam then ran with the required subprocess access. No completed exam was
rerun or selected for a better result. The machine's existing ffmpeg, clips,
labels, taps, model and frozen config were used without alteration.

The adjacent `pressure-accuracy-2026-11-02-baseline.json` is an unchanged copy of
the official exam JSON. Local full stdout/stderr and supplementary diagnosis
remain under ignored `scripts/needle-reader/out/pressure-accuracy-diagnosis-2026-11-02/`.
Video frames have not been committed or uploaded.

| Clip | Coverage % | Median abs bar | P90 abs bar | Errors >1 bar % | Scored labels | False 10 count |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 20261015_225219 | 82.00 | 0.000 | 0.000 | 0.00 | 1 | 0 |
| 20261015_225307 | 72.73 | — | — | — | 0 | 0 |
| 20261017_084814 | 43.95 | 0.757 | 1.550 | 33.33 | 3 | 0 |
| 20261017_084919 | 79.62 | 0.551 | 0.998 | 33.33 | 3 | 0 |
| 20261017_134943 | 95.55 | 0.429 | 0.578 | 0.00 | 5 | 0 |
| 20261017_135116 | 90.50 | 0.437 | 0.465 | 0.00 | 3 | 0 |
| 20261018_094055 | 74.02 | 0.600 | 1.036 | 25.00 | 4 | 0 |
| 20261018_094151 | 85.71 | 0.283 | 0.512 | 0.00 | 3 | 0 |
| 20261018_160844 | 59.47 | 0.140 | 0.323 | 0.00 | 3 | 0 |
| 20261018_160931 | 81.16 | 0.091 | 0.295 | 0.00 | 3 | 0 |
| 20261024_124006 | 79.19 | 0.155 | 0.371 | 0.00 | 11 | 0 |
| 20261025_130022 | 80.50 | 0.075 | 0.245 | 0.00 | 12 | 0 |

Overall: **77.45% stream coverage**, **0.147 bar median**, **0.629 bar P90**,
**5.88% wild error** (>1 bar), 51 published labelled/hand comparisons, zero
false-10 flags. The exam's first-shown rest-offset maximum is 1.703 bar.

Recent hand-labelled clips reproduce the supplied baseline:

- **124006:** 8/11 published hand comparisons within 0.3 bar; worst signed error
  **−0.41 bar at 30.375 s**. Its twelfth hand frame, 55.25 s, has no reading.
- **130022:** 12/12 published hand comparisons within 0.3 bar; worst signed error
  **+0.28 bar at 10 s**. Its thirteenth hand frame, 49.375 s, has no reading.

These denominators exclude missing readings. Coverage is a separate measurement.
The official exam does not save individual old-clip hits, so their worst errors
and within-0.3 counts are unavailable from this baseline artifact. They were not
reconstructed by rerunning the score.

## Failure examples and causes

### 1. Dial registration can become wrong while the hub remains close

A separate raw-stage diagnostic replay of **20261017_084814** used the existing
calibration and tracker and compared its positions to existing labels. It did
not run the ONNX model or substitute for the scored exam.

| Time | Raw tap bar | Existing label bar | Hub error | Applied dial shift |
| --- | ---: | ---: | ---: | ---: |
| 9.5 s | 0.653 | 1.411 | 2.2 px | +10° |
| 18.5 s | 2.983 | 5.163 | 6.4 px | +20° |
| 22 s | 5.865 | 7.613 | 3.2 px | +20° |
| 41.5 s | 4.249 | 5.738 | 1.0 px | +20° |

The labelled printed-5 ray changes from 312.77° at the rest label to 311.38°
at 18.5/22 s, approximately −1.4°, while the tracked scale accumulates +20°.
Inspection of the labelled frame crops confirms that the hub is close and the
face has not rotated by +20°. Registration error therefore explains a material
part of the pressure error. At 18.5 s the needle angle also differs by about 10°
from its label, so this is not exclusively a scale error.

The calibration taps and independent label rays already differ at rest. A repair
must preserve the user's initial taps and follow their movement, rather than
forcing them onto the exam labels. Fixing the extra +20° drift does not promise
zero residual calibration error.

Relevant code: `tapCalibrate.js` uses separate circular red/dark annulus
correlations and retains the previous shift when new evidence fails. A mistaken
shift can persist while subsequent needle angles are mapped through it. The
official exam shows only **43.95% coverage** here, with 206 `no-r2` frames;
the separate raw trace has no gaps of four or more consecutive frames. Output
loss cannot be attributed solely to failure to locate the needle.

### 2. Needle evidence disappears even with a tracked hub

The separate raw-stage trace of **20261018_160844** finds:

- **18 s:** hub error 3.2 px, pose not lost, needle missing.
- **29.5–30.75 s:** 11 consecutive 125 ms samples with no needle.
- **32 s:** hub error 2.2 px, pose not lost, needle missing; a longer missing
  stretch spans 31.625–32.125 s.

The official exam gives **59.47% coverage**. Its published labelled median is
good (0.140 bar), but the model's median is **2.945 bar**, and there are 96
`disagree` frames. Thus both missing needle evidence and reader/model disagreement
matter. The current template recovery has directional and jump assumptions,
including a looser short-clockwise-step recovery. A general recovery needs to
handle falling pressure and changing tilt without accepting a pin or tail.

### 3. Rise samples can disappear behind an apparently plausible display

On **124006**, the official hand output at **30.375, 31.875 and 33.375 s** has
raw tap readings of `null`. Display comparisons remain available at approximately
4.76, 6.04 and 6.92 bar against 5.17, 6.41 and 7.29 bar. These three comparisons
are below truth by 0.41, 0.37 and 0.37 bar.

The hand scorer computes a display-window median around each hand time. A
published comparison at a hand time is therefore not proof of a fresh needle
sighting at that exact instant. The raw-null evidence establishes missed
measurements on the rise, without identifying the exact share due to holding
versus display averaging.

### 4. Code issues that need controlled verification

- **Scale inconsistency:** calibration has size-scaled tolerances, but live
  `trackPose` calls `rimMeasure` and `searchRim` with their default 90 px
  measurement radius, even when passing a different radius for the separate
  candidate-size check. This is a concrete code inconsistency; its effect across
  other camera scales has not yet been measured by a controlled implementation.
- **Model coordinates:** `shotLabR7Needle.js` crops using only `read.shiftDeg`,
  returns the decoded registered-crop angle directly, and passes the model's
  canonical bar onward. The publisher/gate compares that with classical
  image-space angles and user-tap bars. There is no explicit full inverse crop
  transform and remapping through the user's pins in this path.
- **Asynchronous age:** `useShotLabPressure.js` retains the most recent model
  result without capture time/pose or an age limit. A slow inference can be
  compared with a newer classical frame after the gauge moves.
- **Freshness:** publisher uncertainty is `bar == null`; `hold-max` can keep a
  bar non-null after a miss, and the hook then records it as confident. Reported
  exam coverage consequently includes some held output, not just fresh measured
  pressure. This must not become a way to inflate confidence or fill real gaps.

The official reported flip rate is 25%. The coordinate issue above means this
must not be interpreted as 25% demonstrated physical needle-tail flips. The
unmodified official result is preserved in the baseline JSON.

## Today's shot: 12–17 s rise

Source: `shot-2026-11-02/lab-replay-f62a5256.mp4` and its supplied `-pressure.json`.
Inspected original video stills every 0.5 s from 12–18 s. The local contact sheet
is `scripts/needle-reader/out/today-rise.png`.

The needle is approximately steady through 13.5 s and visibly rising by 14 s.
The saved curve changes from 0.744 bar at 13.774 s to 2.019 bar at 13.910 s.
There is no visible full-second onset delay at this inspection resolution.

Interpolated threshold crossings of the **saved samples only** (not new truth
labels or an accuracy score):

| Saved pressure | Crossing time |
| --- | ---: |
| 2 bar | 13.908 s |
| 3 bar | 14.333 s |
| 4 bar | 14.690 s |
| 5 bar | 15.074 s |
| 6 bar | 16.168 s |
| 6.5 bar | 16.985 s |

There is a **399 ms sample gap from 15.121 to 15.520 s**, about three normal
125–135 ms intervals. It warrants examining fresh-reading loss during the rise.

An exact latency number is unverified: the export contains only `shotId` and
pressure points, without the user's calibration or a recorder-start offset.
MediaRecorder and pressure collection start separately. Comparing this saved
curve with video cannot uniquely separate clock offset, scale error and filter
lag. A global time shift based on this one shot is not justified. Latest main
also already bypasses the one-second display mean when the latest sample is
more than 0.2 bar from it; the saved export itself is the stored sample curve.

## Proposed first implementation pass — 4–6 hours

1. **Repair pose and scale registration (about 1.5–2 hours).** Make rim sampling
   consistent with calibration size and keep motion anchored to the calibrated
   face. Check stable face features against the reference, exclude the moving
   needle from registration, and prevent unsupported colour shifts from sticking.
   Preserve the user's tapped rays under the accepted pose transform. Keep
   bounded search/reacquisition and the existing protection against other circles.
2. **Put model and classical evidence in one frame (about 45–60 minutes).**
   Carry capture time and source pose with each model result. Establish the full
   crop/rectification angle transform and map the model needle back through the
   same tap geometry before comparing readers. Reject stale/cross-shot results.
3. **Recover measurements and represent gaps honestly (about 45–60 minutes).**
   Review missing-needle recovery in both travel directions. Require current
   pixel evidence for a new measurement; distinguish a short display hold from
   a fresh confident sample. Do not invent readings, extrapolate through
   occlusion, or relax confidence merely to raise coverage.
4. **Verify the complete behavior (about 1–2 hours).** Add focused regressions
   for coordinate transforms, stale inference, wrong persistent shifts, scale
   changes and gap freshness. Inspect existing real failure windows; use the
   unchanged full exam once for the finished candidate, Vitest and build, plus a
   browser replay of actual asynchronous inference. Compare every clip and
   preserve the recent clips' accuracy and zero false 10s. A phone/CPU live check
   remains necessary before any claim of broad camera robustness.

No production dependency, new recording, schema/data/auth/privacy change or
training run is proposed for this first pass. If geometry repair leaves too
many unreadable needles, return with evidence and a separately scoped training
plan using Isaac's own gauge frames, real held-out shots and explicit approval.
More labels can come from existing videos; no need to assume many new shots.

## Validation and limits

- **Live exam:** completed successfully once; 12 clips. This is the baseline,
  not an improvement claim. There is no after exam because implementation stopped.
- **Vitest:** 418 passed, 2 failed, 1 skipped (421 tests). Test files: 79 passed,
  3 failed, 1 skipped (83). One failed suite cannot load the Linux-only
  `C:/workspace/pl-state/nr/train-r2/raw-frames.json`; two tests need unavailable
  `python` (`gaugeProfile.vitest.js`, `needleRectify.vitest.js`). No tests were
  removed or changed. An initial sandbox attempt failed at esbuild startup;
  these counts are from the actual suite with subprocess access.
- **Build:** passed, including service-worker generation; existing large-chunk
  warnings. The initial sandbox attempt failed to spawn Vite's helper.
- Short supplementary raw-stage diagnostic replays: 225219 and 084814 first
  four seconds; complete raw traces of 084814 and 160844. These are not reruns
  of the scored exam and do not replace its results.
- Inference-time figures in the exam are not isolated benchmarks: validation
  and some diagnosis ran concurrently.
- Old-clip labelled samples are sparse and some are withheld; low published
  error does not establish accuracy on unlabelled or missing frames. Broad
  camera setups, exact phone latency and post-fix accuracy remain unverified.

Next step: Isaac approves the 4–6 hour geometry/coordinates/freshness pass before
implementation begins. Retraining would require a separate decision.
