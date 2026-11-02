# Needle tracking — 2026-11-02

The final candidate passes the specified numerical gates, with the feature **off by default**. Exam fresh time increases from 83.24% to 90.76%; held time falls from 11.21% to 5.00% and gaps from 5.55% to 4.24%. Frozen-batch unique frames improve from 39/8/5 to 47/2/3 fresh/held/gap. No deployment, version bump or calibration change.

## Implementation and evidence contract

- Opt in using `VITE_ENABLE_NEEDLE_TRACKING=true` for a Vite build, `DIALIN_NEEDLE_TRACKING=1` for Node replay, or `createCalibratedTracker(calibration, { needleTracking: true })`. These opt-ins do not change any `.env` file. Existing pressure-lab entry gating still applies.
- Carry the last verified shaft angle in registered dial coordinates and its measured radial contrast profile. When the independent detector loses the shaft, points off-scale, or contradicts its directed end, search the current image within the existing detector's 32° hint window. Use the existing one-degree angular resolution and two-pixel lateral sampling.
- Recovery still requires current narrow-ridge contrast, width, coherent reach, tip-versus-tail direction, and the existing quality threshold. Add profile cosine agreement ≥0.9. Appearance-weighted competing shafts determine the recovery margin; proximity alone cannot certify a reading. The prior only seeds the search; the returned ray is reconstructed entirely from the current measured shaft/offset/tip sample using the unchanged `pointerTipRay` formula.
- Keep the existing arc, endpoint, top-of-scale, rate, duplicate-frame and publisher gates. Contradictory end identity is withheld. Clear the tracking hint after three unsupported/duplicate frames, or immediately after pose loss. Failed observations never update its appearance or angle. Successful recovery can update its appearance from current pixels; accumulated drift remains a live-validation risk.
- The publisher is unchanged: no prediction-to-pressure conversion, interpolation, blending, new curve filter, extended hold, or timestamp refresh on a hold. The 450 ms hold still expires into a gap. User hub/5/10 and zero calibration are unchanged. `pointerSource` and current pointer candidates remain in diagnostics alongside hub, pose matrix and zero/5/10 angles.

## Before / after

Baseline: `a860912`, v4.13.27. Analysis tools copied byte-for-byte under Git clean filters from `b998bd1`; frozen labels from `41f685b`. The baseline exam is the recorded single run from that analysis, not a new selection of exam runs. The six additional full-frame batch clips were replayed before implementation; their before results reproduce the frozen report. Each candidate has one exam and one additional-clip replay. The batch reuses its corresponding exam streams for the six existing exam clips.

The first candidate failed the median gate. One algorithm repair retained the independent detector's 1° search resolution in recovery instead of using 2°. The failed candidate is included below; no other algorithm repair or cherry-picked rerun was used.

| Exam run | Fresh / held / gap frames | Coverage | Fresh / held / gap time % | Median absolute bar error | Within 0.3 bar | Worst signed error | Over 1 bar | False 10s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline | 3297 / 444 / 220 | 94.45% | 83.24 / 11.21 / 5.55 | 0.113 (0.112832) | 47/53 | +0.904 | 0/53 | 0 |
| Initial candidate — failed median | 3595 / 198 / 168 | 95.76% | 90.76 / 5.00 / 4.24 | 0.117 (0.116786) | 50/56 | +0.904 | 0/56 | 0 |
| Final — one repair | 3595 / 198 / 168 | 95.76% | 90.76 / 5.00 / 4.24 | 0.113 (0.112519) | 51/56 | +0.904 | 0/56 | 0 |

Each exam has 3961 stream frames at 125 ms cadence. Held time falls by 30.75 s and gap time by 6.50 s. Worst error remains 094055 @11s. The median improvement is small; it satisfies ≤0.113 without suggesting a meaningful accuracy breakthrough. Exam label scoring retains its original truth and display conventions.

| Frozen batch, unique frames | Fresh | Held | Gaps | Shown | Median absolute bar error | Within 0.3 bar | Worst absolute error | Over 1 bar |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline | 39 | 8 | 5 | 90.38% | 0.114 | 39/47 | 0.822 | 0/47 |
| Initial candidate | 47 | 2 | 3 | 94.23% | 0.094 | 41/49 | 0.822 | 0/49 |
| Final | 47 | 2 | 3 | 94.23% | 0.094 | 41/49 | 0.822 | 0/49 |

All 62 labels including repeats: 46/9/7 → 56/2/4 fresh/held/gap; median 0.116 → 0.098 bar. Final unique held ages are 125 ms (baseline median 125 ms, maximum 375 ms). For the 12 batch clips' complete streams, 4085 frames: 3424/446/215 → 3766/170/149 fresh/held/gap. Thus batch held time falls by 34.50 s and gap time by 8.25 s; this stream set overlaps the exam and is not an independent additional sample.

| Unique frame recovered | State | Reader bar before → after | Final error against frozen label bar |
| --- | --- | --- | --- |
| b004 | held → fresh | 5.655 → 5.756 | -0.636 |
| b005 | gap → fresh | — → 6.933 | -0.391 |
| b013 | held → fresh | 6.025 → 5.969 | -0.422 |
| b014 | held → fresh | 7.155 → 7.328 | +0.049 |
| b015 | held → fresh | 6.395 → 6.385 | -0.124 |
| b025 | held → fresh | 5.150 → 5.354 | +0.057 |
| b026 | gap → fresh | — → 6.702 | -0.069 |
| b053 | held → fresh | 7.447 → 7.310 | +0.215 |

Remaining unique gaps: b007 (pose-lost), b011 and b012. Remaining holds: b028 and b048. b006 @40s stays 5.056 bar, error -0.686 against this batch's piecewise labels: its scale/pose residual was not repaired. Retain that calibration provenance when evaluating recovered b004/b005/b013; tracking alone does not remove it.

## Continuity and smoothness limits

These measurements establish fewer stale plateaus and missing observations. They do not establish lower true jitter: the fresh-only second difference RMS includes real pressure acceleration, and adding fresh samples changes which triples are eligible. Several clips increase. No pressure smoothing or invented intermediate values were added.

| Clip | Fresh/held/gap before | Fresh/held/gap after | Fresh Δ² RMS bar before → after |
| --- | --- | --- | --- |
| 20261015_225307 | 56/34/31 | 56/34/31 | 0.0439 → 0.0439 |
| 20261017_084814 | 355/14/11 | 361/8/11 | 0.1148 → 0.1179 |
| 20261017_134943 | 402/53/17 | 438/17/17 | 0.1335 → 0.1364 |
| 20261018_094055 | 372/53/10 | 431/1/3 | 0.0966 → 0.1189 |
| 20261018_160844 | 241/28/32 | 252/17/32 | 0.1609 → 0.1590 |
| 20261018_160931 | 236/29/27 | 274/12/6 | 0.1510 → 0.1799 |
| 20261025_130022 | 313/66/21 | 395/5/0 | 0.1172 → 0.1183 |
| 20261024_124006 | 340/75/32 | 392/26/29 | 0.1264 → 0.1254 |
| lab-replay-9801a937-8390-4ad9-ac95-b71e4016ccb1 | 267/30/14 | 305/6/0 | 0.1669 → 0.1545 |
| lab-replay-e146d592-042d-4359-ad66-a4d4b4c5940f | 300/15/4 | 307/8/4 | 0.1180 → 0.1185 |
| lab-replay-f62a5256 | 279/10/9 | 284/5/9 | 0.1235 → 0.1240 |
| 20261024_124140 | 263/39/7 | 271/31/7 | 0.1728 → 0.1968 |

## Validation and reproduction

- `npm ci`: passed; no dependency changes.
- `DIALIN_NEEDLE_TRACKING=1 npm run test:vitest` (set the variable separately in PowerShell): 457 passed, 2 failed, 1 skipped. Files: 86 passed, 3 failed, 1 skipped. Exactly the documented Python gauge-profile/rectify failures and missing Linux temporal replay fixture; no other failures. Five added tests cover current-image measurement, expiry/pose loss, wrong-end identity, unsupported held→gap behavior, and reader-level refusal to mark an unsupported hint fresh.
- Targeted pointer/tracking/calibration/publisher tests: 55 passed, 0 failed. `npm run build`: passed with the opt-in enabled; the default-off build also passed before the one-degree repair.
- Trace assertions: 6045 replay frames across the exam and additional views; 488 tracked fresh publications all retain current resolved shaft evidence, quality ≥0.08 and appearance agreement ≥0.9. Held outputs retain no fresh timestamp and stay within 450 ms. All 18 calibration objects and all 62 label-derived bars are identical before/after. All 72 frozen label-source files and four copied analysis scripts match their source commits under Git clean filters.
- Accuracy gates apply to scored labelled frames, not unlabelled stream pressure. False-10 counts cover the stream. Labels remain in upright coordinates, including b012's documented 3× source/replay scale. Batch sampling/truth/calibration limitations from the frozen analysis are unchanged: nearest 8 Hz sample, leave-one-clip-out pin-to-rest offset, first labelled rest hub/5/10 for four new clips, and the two hand clips' full-frame translated taps.

After fetching/restoring the frozen data branch and creating the ignored `out/` preloader as in the original report:

```powershell
$env:DIALIN_NEEDLE_TRACKING='1'
node --import ./scripts/needle-reader/out/exam-observer.mjs scripts/needle-reader/exam.mjs --live
node scripts/pressure-label/analysis/replay-batch.mjs
node scripts/pressure-label/analysis/analyze-batch.mjs
$env:VITE_ENABLE_NEEDLE_TRACKING='true'
npm run build
```

Raw traces and generated analysis reports stay locally under the ignored `scripts/needle-reader/out/` and untracked generated report paths. Copied analysis scripts are unchanged; their generated report's static version/ranking prose describes the original baseline, so this document records the candidate interpretation. No exam/scoring scripts, frozen config, labels, models, zero policy, user taps, schemas or user data changed.

Unverified: live camera/countdown and repeated-shot operation, mobile cost, independent physical pressure, dense true jitter, and generalisation to unseen glare/occlusion. Exam median-of-clip processing time was 69.0 → 72.4 ms on this PC; concurrent offline work makes it an approximate comparison. Keep the flag off pending live image-support/occlusion checks and review. No merge or deployment is part of this ticket.
