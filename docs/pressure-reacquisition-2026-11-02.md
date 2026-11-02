# Registration reacquisition repair — 2 November 2026

## Result: coverage recovered; accuracy targets failed

**Not ready to merge.** Reacquisition now exceeds the coverage target with
94.57% fresh readings, but the complete run exposes large pressure errors that
were previously hidden by lost registration. The combined requested outcome
was not achieved.

| Metric | Baseline | Previous pass | Now |
| --- | ---: | ---: | ---: |
| Published stream coverage | 77.45% | 62.84% | **99.17%** |
| Fresh coverage | unavailable | 59.23% | **94.57%** |
| Held coverage | unavailable | 3.61% | **4.59%** |
| Gaps | 22.55% | 37.16% | **0.83%** |
| Median absolute bar error | 0.147 | 0.081 | **0.097** |
| P90 absolute bar error | 0.629 | 0.362 | **0.537** |
| Errors over 1 bar | 5.88% | 2.38% | **6.90%** |
| Published labelled comparisons | 51 | 42 | **58** |
| Within 0.3 bar | unavailable | 36/42 | **48/58** |
| Exam false-10 frame flags | 0 | 0 | **10** |

After-frame accounting is **3,746 fresh + 182 held + 33 gaps = 3,961 frames**.
The ten >=9.95-bar flags are six fresh and four held frames, all on `160931`.
The raw metric is retained unchanged. See the burst-inspection caveat below.

## Scope and exact candidate

Branch: `feat/pressure-accuracy-codex`, starting at `65de086`.
Latest `origin/main` was fetched first; the branch was already up to date.
The implementation estimate was 90–110 minutes including validation, within
the requested approximately two-hour scope. No retraining was proposed or run.

The examined runtime candidate is
`f266f217563dc50a68cafbdad8318327bc227be9`. Runtime source was frozen before the
single final exam. All subsequent work is reporting and verification of its
saved outputs. Package version remains 4.13.25; this pass did not change it.

Only the registration matcher and its tests changed. The pressure mapper,
publisher, held/fresh behavior, calibration zero, model weights, scoring scripts,
labels, fixtures and frozen config are unchanged. There are no schema, stored
user-data, auth, privacy, dependency, recording-start or camera-view changes.

## Root cause established from per-frame evidence

The previous pass treated a failed printed-face match as a lost pose, even when
the rim search had found a plausible current gauge. Two matching problems
removed good corner correspondences; stale position prediction then prolonged
the loss.

1. **The optical-flow pyramid mixed local printed features with the changing
   surround.** The normalized patch is 128 px, with a 96 px face diameter. A
   19 px tracking window spans 76 input pixels already at pyramid level 2.
   Coarse levels therefore see a large fraction of the gauge and its surround,
   rather than just the printed corner. In the old `135116` trace, 268/358 flow
   checks retained fewer than eight correspondences. At 22.375 s the rim candidate
   was near (450,625), but only eight matches survived and seven were inliers,
   so the pose was rejected. Local-pyramid frame-pair tests recovered 18 inliers
   on that same failure window without changing acceptance thresholds.
2. **Raw brightness and contrast were not comparable to the frozen reference.**
   On `094055` at 19 s, the old trace had 18 forward-tracked points, only four
   under the photometric error cap, and no accepted round trips. The whole-patch
   mean changed from about 80 to 65. After correcting pyramid size, matching
   still failed there; normalization using the face interior recovered 31
   inliers on the same real frame pair. This is a registration-input correction,
   not a pressure adjustment.
3. **Loss reused stale translation despite a new rim candidate.** A failed match
   left the accepted hub frozen, and the next optical-flow seed still started
   from that old image position. This could override useful coarse localization
   and keep the tracker searching from a bad prior as the gauge moved. `094055`
   previously stayed lost from 5.625 through 54.25 s. `124006` lost its pose from
   7.125 through 28.875 s; `130022` from 7 through 18.75 s. The saved previous-pass
   traces supplied these spans.

Forward and reverse flow also had inconsistent initialization: forward flow used
the last accepted transform, but reverse flow started without the known reference
point estimate. Symmetric initialization alone did not resolve the real failures.
The local pyramid and photometric normalization were necessary measured fixes.

## Implemented correction

- Use one pyramid octave for local matching on the normalized face. Rim search
  already supplies coarse position.
- Normalize brightness and contrast from the face interior of both patches,
  with a contrast floor to avoid excessive noise amplification. Original camera
  pixels used by the needle reader are not changed.
- After loss, center the matching seed on the current rim candidate while
  retaining the last accepted shape estimate. A rim alone still cannot certify
  a lock: current printed pixels must pass the same checks.
- Initialize reverse flow from the known reference corners and still require
  the same one-pixel round-trip check.

The minimum inlier count, spatial support, residual/shape/rotation checks,
48 px hub-leap limit and calibration reference are unchanged. No per-clip
configuration or pressure-dependent exception was added. Reacquisition never
uses the first recorded needle as a new zero. The user's calibrated point and
tap rays remain the reference of the accepted affine transform.

Targeted raw registration diagnostics confirmed the mechanism before the scored
exam: `135116` reached 352/358 registered frames with local matching, `160931`
292/292, and `124006` 444/447. `094055` still failed with local matching alone;
face exposure normalization then recovered 432/435. These are geometry diagnostics,
not substitutes for the final exam's published-pressure coverage.

## Validation and integrity

- Targeted tests: **54 passed** across registration, tap calibration, publisher
  and camera freshness. New cases cover recovery after loss and translation,
  independent surround changes, exposure changes without relearning zero, and
  continued rejection of an occluded face despite a new rim candidate.
- Full `npm run test:vitest`: **441 passed, 2 failed, 1 skipped** (444 tests).
  Test files: **83 passed, 3 failed, 1 skipped** (87). The only failures are the
  two documented Python-dependent tests and the box-only temporal replay suite
  missing `/workspace/.../raw-frames.json`. These are green under AGENTS. No tests
  were deleted or skipped to obtain the result.
- `npm run build`: **passed**, including service-worker generation; existing
  large-chunk warnings remain.
- ESLint on both changed files: **passed**.
- Actual browser hook: **passed** using a real video camera source starting at
  video time **30.003 s**, with its first saved sample about **4.96 bar at 0.130 s**.
  No recorded rest frame was supplied to the running shot; calibration remained
  unchanged. It saved 40 fresh observations, then added none after the paused
  source's queued final frame drained; the display expired to a gap. OpenCV and
  the unchanged ONNX model ran, with no browser errors. As in the prior pass,
  the QA harness served the unchanged public ORT loader statically to bypass
  Vite's existing dev-module serving limitation.

The final command used the unchanged exam plus the same read-only observer:

```text
node --import ./scripts/needle-reader/out/exam-observer.mjs scripts/needle-reader/exam.mjs --live
```

It ran once for this candidate, without clip filters. The observer captures
returned observations and the exam's existing label-hit data without changing
inputs, outputs or scoring. Previous observations were preserved separately
before the run. Frame counts, pressure statistics and false-10 accounting are
checked against the official output. Debugger timing is not a phone-performance
benchmark. No merge or deployment is authorized or performed.

## Comparison conventions

The tables use **B / P / N = original baseline / previous pass / now**.
Published coverage includes fresh plus held output. Fresh and held are separated
explicitly; held values remain outside the confident saved curve. All accuracy
denominators count published comparisons and exclude missing readings.

The initial baseline did not retain exact fresh/held classifications or individual
old-clip label hits. Its missing fresh/held, within-0.3 and worst fields remain
unavailable (`—`/JSON null). Baseline gaps are the complement of published
coverage. Its two hand-clip worst errors were recorded to two decimals. No
baseline rerun or invented values were used to fill missing fields.

The unchanged hand scorer builds display windows from fresh samples within
its existing time windows. A scored hand comparison does not prove a fresh
measurement at the exact hand timestamp. The unchanged exam's legacy flip-angle
metric still has incompatible model-angle/reason semantics and is not used as
a physical direction-accuracy claim for this path.

Three-way pressure results and per-label evidence are recorded in
`pressure-reacquisition-2026-11-02-results.json`. Original baseline and previous
pass reports remain unchanged. Diagnostic frame pairs, stage traces, raw official
outputs and browser evidence remain under ignored `scripts/needle-reader/out/`.
No camera media is committed or uploaded.

The single final exam completed successfully as a command, but its accuracy
criteria failed. It was not rerun and no runtime correction was made afterward.

## Three-way coverage

| Clip | Published % B / P / N | Fresh % P / N | Held % P / N | Gaps % B / P / N |
| --- | ---: | ---: | ---: | ---: |
| 20261015_225219 | 82.00 / 100.00 / 100.00 | 100.00 / 100.00 | 0.00 / 0.00 | 18.00 / 0.00 / 0.00 |
| 20261015_225307 | 72.73 / 90.08 / 99.17 | 86.78 / 95.04 | 3.31 / 4.13 | 27.27 / 9.92 / 0.83 |
| 20261017_084814 | 43.95 / 91.58 / 100.00 | 90.26 / 99.47 | 1.32 / 0.53 | 56.05 / 8.42 / 0.00 |
| 20261017_084919 | 79.62 / 95.30 / 100.00 | 95.30 / 99.69 | 0.00 / 0.31 | 20.38 / 4.70 / 0.00 |
| 20261017_134943 | 95.55 / 90.68 / 100.00 | 88.35 / 97.03 | 2.33 / 2.97 | 4.45 / 9.32 / 0.00 |
| 20261017_135116 | 90.50 / 11.45 / 99.72 | 11.45 / 98.88 | 0.00 / 0.84 | 9.50 / 88.55 / 0.28 |
| 20261018_094055 | 74.02 / 10.34 / 99.31 | 10.11 / 89.89 | 0.23 / 9.43 | 25.98 / 89.66 / 0.69 |
| 20261018_094151 | 85.71 / 87.50 / 99.40 | 83.33 / 96.73 | 4.17 / 2.68 | 14.29 / 12.50 / 0.60 |
| 20261018_160844 | 59.47 / 91.69 / 99.00 | 78.07 / 90.70 | 13.62 / 8.31 | 40.53 / 8.31 / 1.00 |
| 20261018_160931 | 81.16 / 18.84 / 100.00 | 18.84 / 96.58 | 0.00 / 3.42 | 18.84 / 81.16 / 0.00 |
| 20261024_124006 | 79.19 / 59.73 / 100.00 | 55.93 / 97.09 | 3.80 / 2.91 | 20.81 / 40.27 / 0.00 |
| 20261025_130022 | 80.50 / 55.50 / 94.25 | 43.00 / 79.50 | 12.50 / 14.75 | 19.50 / 44.50 / 5.75 |

## Three-way accuracy

| Clip | Median bar B / P / N | Within 0.3 B / P / N | Worst signed bar B / P / N | >1 bar % B / P / N | False 10 B / P / N |
| --- | ---: | ---: | ---: | ---: | ---: |
| 20261015_225219 | 0.000 / 0.003 / 0.002 | — / 1/1 / 1/1 | — / 0.003 / 0.002 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261015_225307 | — / 0.014 / 0.028 | — / 1/1 / 1/1 | — / -0.014 / -0.028 | — / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261017_084814 | 0.757 / 0.169 / 0.089 | — / 5/5 / 4/5 | — / -0.293 / -0.302 | 33.33 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261017_084919 | 0.551 / 0.007 / 0.009 | — / 3/3 / 3/3 | — / 0.123 / 0.136 | 33.33 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261017_134943 | 0.429 / 0.145 / 0.098 | — / 3/4 / 4/5 | — / 0.651 / 0.625 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261017_135116 | 0.437 / 0.001 / 0.015 | — / 1/1 / 3/3 | — / -0.001 / -0.031 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261018_094055 | 0.600 / 1.272 / 5.647 | — / 0/1 / 0/4 | — / 1.272 / -7.216 | 25.00 / 100.00 / 75.00 | 0 / 0 / 0 |
| 20261018_094151 | 0.283 / 0.015 / 0.152 | — / 3/3 / 3/3 | — / 0.157 / 0.184 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261018_160844 | 0.140 / 0.087 / 0.058 | — / 3/5 / 4/5 | — / -0.369 / 0.416 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261018_160931 | 0.091 / 0.041 / 0.032 | — / 2/2 / 3/3 | — / -0.053 / 0.278 | 0.00 / 0.00 / 0.00 | 0 / 0 / 10 |
| 20261024_124006 | 0.155 / 0.084 / 0.079 | 8/11 / 9/10 / 12/12 | -0.410 / 0.542 / 0.231 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261025_130022 | 0.075 / 0.083 / 0.128 | 12/12 / 5/6 / 10/13 | 0.280 / 0.326 / 1.077 | 0.00 / 0.00 / 7.69 | 0 / 0 / 0 |

## What the new run establishes

- **135116:** previous 11.45% published / 11.45% fresh becomes **99.72% /
  98.88%**; all three labelled readings are within 0.3 bar, median 0.015,
  worst −0.031. The long lockout is resolved in this run.
- **094055:** previous 10.34% published becomes **99.31%**, with **89.89% fresh**.
  However, the recovered pressure readings are wrong: at 19 s, **0.027 versus
  5.973 bar**; at 22 s, **−0.026 versus 7.190 bar**. At 40 s a held near-zero
  value is **−5.348 bar** from the label. This clip contributes three of the
  four >1-bar comparisons. It is not a coverage success that can be shipped
  without fixing pressure interpretation.
- **160931:** previous 18.84% published becomes **100%**, with **96.58% fresh**.
  All three existing labelled comparisons are within 0.3, but the stream has
  ten >=9.95-bar flags between **10.125 and 11.500 s**. Zero false-10 metric was
  not preserved.
- **124006:** previous 59.73% published becomes **100%**, with **97.09% fresh**.
  All twelve hand comparisons are now within 0.3; median 0.079, worst +0.231.
- **130022:** previous 55.50% published becomes **94.25%**, with **79.50% fresh**.
  All thirteen hand comparisons are available, but only ten are within 0.3.
  The 25 s comparison is **7.687 versus 6.610 bar**, error +1.077; the 34 s
  comparison is low by 0.500. These are material remaining pressure errors.
- **084814:** the previous gain is retained in coverage, now 100% published and
  99.47% fresh. Median improves from 0.169 to 0.089, but the 22 s error is
  **−0.302**, just outside 0.3. It is reported as 4/5, not rounded into 5/5.

The accuracy comparison has different coverage denominators, so neither a lower
nor a higher median alone describes the full change. Registration recovery
made additional difficult frames available; those frames reveal pressure
failures the previous strict lockout concealed.

## Remaining pressure/calibration failure evidence

On `094055`, the reconstructed calibration zero is about **278.7°**, while the
existing rest annotation points around **325.8°**. The stored sidecar also
records a 278.7° zero and a roughly 227° zero-to-ten span. This inconsistency
was not changed or replaced with a favourable value.

At 22 s the face has **27 registration inliers**, residual approximately
**0.589 normalized pixels**, and the accepted transform remains close to the
calibrated orientation. The needle reader chooses **276.5°** with quality about
0.748, whereas the existing needle annotation is **79.2°**. That is approximately
163° of circular separation and a near-zero publication at actual high pressure.
It supports a tip/tail or other wrong-ray interpretation compounded by an
inconsistent zero/arc; it is not simply a missing pose. Determining how the
reconstructed calibration relates to a user's original clean calibration still
needs care. No recorded resting needle can be assumed at shot start.

The `160931` false-10 counter is a proxy: the unchanged exam flags every published
value >=9.95, without checking hand truth at each stream frame. Inspection at
10.25 s shows the physical pointer visibly near the printed 10. Therefore the
ten frame flags are not ten independently verified false-reading events. All
ten are nevertheless retained and the requested zero-flag criterion is failed;
none were discounted or reclassified to improve the score.

Fresh-derived accuracy is **47/56 within 0.3**, median **0.097 bar**, with
**5.36% >1 bar** and worst −7.216 at 22 s on `094055`. The two held labelled
comparisons are **1/2 within 0.3**, with worst −5.348 at 40 s on that clip.
For hand clips, “fresh-derived” means the scorer's unchanged fresh-sample
display windows, rather than a guarantee of a fresh observation at the exact
label timestamp. Both fresh and held details are retained per clip in JSON.

## Commits and files changed

Runtime/test commits:

1. `465ee5a` — initialize bidirectional flow and recenter after loss.
2. `a6405ca` — keep optical flow local to the normalized printed face.
3. `f266f21` — normalize face exposure while preserving tap geometry.

Files changed in this pass:

- `src/flairPressureLab/dialRegistration.js`
- `src/flairPressureLab/dialRegistration.vitest.js`
- `docs/pressure-reacquisition-2026-11-02.md`
- `docs/pressure-reacquisition-2026-11-02-results.json`

The code diff is confined to two registration files. The held/fresh publisher,
calibration factory, model, pressure reader, UI, recorder, database and score
inputs were not edited. The last two files record the unfiltered result of the
single run. No runtime source changed after candidate `f266f21` was examined.

## Unverified and next step

The whole accuracy goal remains unfulfilled. No hardware-phone accuracy or
latency benchmark was run. Exact original-baseline fresh/held and old-clip
within/worst fields remain unavailable. Current pressure labels are sparse;
high fresh coverage does not establish that all published values are correct.

Before merge, a separate pressure-evidence/calibration pass should validate zero
against trusted user pins and resolve wrong-ray/tip-tail selection on the
recovered frames. It must preserve the user's taps, avoid reliance on recorded
rest frames, and continue excluding held output from the confident curve.
Another corrected candidate would need a newly agreed single final exam: this
pass's one run has been used and its failures are preserved here. No retraining,
main merge or deployment was performed.
