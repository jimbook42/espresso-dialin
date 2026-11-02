# Curve smoothing — 2026-11-02

**Repair 1 verified on 2026-11-03: all ticket acceptance gates pass.** Branch `fix/curve-smoothing`, based on `588ad88` (v4.13.28). Version unchanged. One final commit and branch push; no merge or deployment.

## Repair and trade-off

The existing drop test was correct and its expected **4.60000** is unchanged. The earlier filter reset direction history after the 200 ms interval before the final 0.5-bar drop, then blended that new drop to 4.64545. The repair passes movements of 0.25 bar or more through immediately, independent of direction history. The original assertion now passes; two additional tests cover the first large rise/drop after a continuity reset and removal of residual bias on sub-noise changes.

The filter retains a maximum 100 ms time constant and the measured 0.05-bar repeat-label noise scale. Smoothing fades in for changes from 0.05 to 0.10 bar, stays fully enabled from 0.10 to 0.20, and fades out from 0.20 to 0.25. Changes at/below the noise floor pass through, as do two consecutive movements in the same direction. Every output is causal and bounded by its current input and previous filtered value; no prediction supplies missing evidence. These are global rules, with no clip/label/pressure-specific exceptions.

This deliberately reduces smoothing compared with the rejected candidate: displayed batch median improves **0.094805 → 0.093981 bar**; steady reversals remain **22**, and maximum rise lag remains **125 ms**. Relative to raw baseline, second-difference RMS improves **0.100389 → 0.084359 bar** and reversals **38 → 22** (42.1% fewer). Small changes are less damped: aggregate median absolute adjacent delta is **0.025135 → 0.026028 bar**, a 3.6% increase. Against the old live display, large reversals improve **26 → 22** (15.4%); its stronger ordinary smoothing had median delta 0.009229 and second-difference RMS 0.084046. The repair does not claim every wobble statistic improves.

## Complete before / after verification

Baseline: one complete untouched-main exam and one six-clip batch replay captured before implementation. The first candidate was stopped on the real drop-test failure; its incomplete runs are retained as interrupted evidence and are not scored as successful runs. Isaac then authorized Repair 1. The repair has exactly one complete fresh exam and one complete six-clip replay, without cherry-picked exam reruns. The batch reuses its corresponding ten full-frame exam streams plus the six extra streams, using the unchanged frozen evaluator and labels.

| Metric | Baseline | Repair 1 | Target |
| --- | --- | --- | --- |
| Exam stream coverage | 95.76% | 95.76% | ≥95.76% |
| Fresh / held / gap frames | 3595 / 198 / 168 | 3595 / 198 / 168 | Fresh ≥90.76% |
| Fresh / held / gap time | 90.76 / 5.00 / 4.24% | 90.76 / 5.00 / 4.24% | Unchanged coverage/freshness |
| Exam median absolute error | 0.113 bar | 0.100 bar | ≤0.113 |
| Exam worst signed error | +0.904146 bar | +0.904146 bar | Report real worst |
| Exam errors >1 bar | 0/56 | 0/56 | 0% |
| False 10-bar stream count | 0 | 0 | 0 (display also 0) |
| Unique frozen batch fresh / held / gaps | 47 / 2 / 3 | 47 / 2 / 3 | No evidence loss |
| Batch raw median absolute error | 0.093981 | 0.093981 | ≤0.094 |
| Batch displayed median absolute error | 0.102303 | 0.093981 | ≤0.094 (hard target) |
| Batch displayed worst absolute error | 0.812278 | 0.822256 | Report real worst |
| Batch displayed errors >1 bar | 0/49 | 0/49 | 0 |
| Rise lag added by repair | 0 ms reference | 125 ms maximum | ≤150 ms |

Coverage percentages use the original exam’s two-decimal reporting precision: 3961 stream frames, with identical before/after counts. The exam uses raw publications for its ten full-frame streams and its existing display convention for the two hand clips; this mixed scoring convention is unchanged. That is why the exam median improves although raw publications are identical. The displayed batch median above is separately evaluated from actual captured publisher display outputs, not substituted with the raw median. It scores the same 49 shown unique labels out of 52, with the three gaps still gaps. Repeat labels are excluded by the frozen evaluator’s original unique-frame rule.

## Per-clip wobble

Eligibility is fixed from the baseline: a centered nine-frame window must be entirely fresh, have endpoint difference ≤0.35 bar and total range ≤0.75 bar. Only adjacent eligible fresh pairs/triples contribute; gaps and holds are not bridged. A reversal has consecutive opposite deltas both greater than 0.1 bar. This offline mask uses future context only to classify steady regions; the production filter never reads future samples. These are real trace proxies, not dense physical ground truth.

| Clip | Eligible pairs | Raw median abs delta | Display median abs delta | Reversals raw → display | Old live reversals | Raw → display second-difference RMS |
| --- | --- | --- | --- | --- | --- | --- |
| 20261015_225219 | 72 | 0.0010 | 0.0010 | 0 → 0 | 0 | 0.0160 → 0.0156 |
| 20261015_225307 | 0 | — | — | 0 → 0 | 0 | — → — |
| 20261017_084814 | 226 | 0.0380 | 0.0364 | 4 → 2 | 4 | 0.1020 → 0.0810 |
| 20261017_084919 | 112 | 0.0240 | 0.0228 | 0 → 0 | 3 | 0.0728 → 0.0616 |
| 20261017_134943 | 308 | 0.0320 | 0.0345 | 9 → 6 | 4 | 0.1256 → 0.1101 |
| 20261017_135116 | 68 | 0.0458 | 0.0444 | 1 → 1 | 2 | 0.1186 → 0.0968 |
| 20261018_094055 | 314 | 0.0333 | 0.0340 | 9 → 4 | 5 | 0.1075 → 0.0847 |
| 20261018_094151 | 112 | 0.0325 | 0.0324 | 2 → 2 | 4 | 0.1100 → 0.1011 |
| 20261018_160844 | 130 | 0.0494 | 0.0443 | 5 → 3 | 1 | 0.1145 → 0.0959 |
| 20261018_160931 | 109 | 0.0128 | 0.0133 | 2 → 2 | 1 | 0.0989 → 0.0958 |
| 20261024_124006-hand | 278 | 0.0136 | 0.0148 | 1 → 0 | 1 | 0.0763 → 0.0610 |
| 20261025_130022-hand | 279 | 0.0192 | 0.0199 | 5 → 2 | 1 | 0.0873 → 0.0712 |

The short 225307 clip has no fully fresh steady window under this definition and remains in the table. Noisy clips improve the primary reversal metric; some clips have unchanged counts or larger small deltas. Full old live/History and all-fresh diagnostics are retained in the ignored local metrics JSON.

## Source of jitter and boundaries

Baseline steady-window needle-angle second differences were 1.7909° RMS versus 0.5349° for the zero-angle pose reference (2140 diagnostic triples). Across all fresh triples, tracked-containing triples had 0.1648 bar second-difference RMS versus 0.1509 for independent-only triples. These are different frame sets, so this does not prove tracking caused that difference. There were 54 held→fresh transitions: median absolute jump 0.01263 bar, maximum 0.88585. Per-frame ray/pose variation and occasional hold catch-up therefore contribute; dense truth would be needed to separate real movement from all reader noise.

The published `bar`, acceptance/rate gates, freshness and timestamps remain unsmoothed. `displayBar` is separate and never feeds the reader. Only existing fresh evidence enters the filter; held output retains the previous filtered display without a new timestamp; gaps remain null. Begin-shot, pressure onset (rest ≤0.15 → pressure), missing observations and tracking reacquisition reset filter history. A raw timestamp discontinuity over 187.5 ms also resets the filter and starts a new SVG subpath. No interpolation fills gaps. Both live and History charts use the same filter; History retains its existing 0.35 s scale-alignment plot offset, which is not counted as negative filter lag.

Trace checks confirm identical raw publication fields for all 3961 exam frames, plus the six extra streams. The combined label corpus checked 5198 frames, 5198 actual captured display outputs, and 4762 fresh live/History chart values. Calibrations are identical before/after. History consistency was checked using plain persisted tS/bar samples, with in-memory reset metadata removed. The raw session serializer is unchanged; its existing test also verifies that reset metadata is not saved. No schema or saved raw data changes.

## Lag

Every monotonic contiguous fresh rise of at least 0.5 bar is checked at 25%, 50% and 75% of its amplitude. Crossing time is the first sampled observation above threshold (8 Hz); no values are interpolated and no gap is crossed. This measures filter delay relative to raw publication, not total camera/reader latency. The earlier preliminary offline filter without directional pass-through had a 250 ms crossing delay and was rejected before the interrupted candidate exam. The repaired implementation passes all 156 checked crossings with maximum 125 ms added delay.

| Clip | Threshold checks | Median added lag ms | Maximum added lag ms |
| --- | --- | --- | --- |
| 20261015_225219 | 0 | — | — |
| 20261015_225307 | 0 | — | — |
| 20261017_084814 | 18 | 0 | 125 |
| 20261017_084919 | 12 | 0 | 0 |
| 20261017_134943 | 12 | 0 | 0 |
| 20261017_135116 | 33 | 0 | 125 |
| 20261018_094055 | 12 | 0 | 0 |
| 20261018_094151 | 21 | 0 | 125 |
| 20261018_160844 | 12 | 0 | 125 |
| 20261018_160931 | 12 | 0 | 0 |
| 20261024_124006-hand | 12 | 0 | 0 |
| 20261025_130022-hand | 12 | 0 | 0 |

## Tests, scope and reproduction

- `npm ci` passed in the original setup; no dependencies changed during Repair 1.
- `npm run test:vitest`: **468 passed, 2 failed, 1 skipped**; files **86 passed, 3 failed, 1 skipped**. Failures are exactly the allowed Python gauge-profile/rectify tests and Linux-only temporal replay suite missing raw-frames.json. No other failures; the original drop assertion is retained and passes.
- `npm run build`: passed. Existing >500 kB chunk warning remains.
- Complete fresh exam and six-clip replay: passed. Frozen evaluator and observational metrics: passed. All 72 frozen label files match source commit `41f685b` under Git clean filters.
- No exam/scoring/label/config/model edits, retraining, dependencies, schema/data/auth/privacy changes, version bump, merge or deployment. React review covered the two SVG path edits.

Changed files: `src/flairPressureLab/pressureCurveFilter.js`, `pressureDisplaySmoothing.js`, `pressureDisplaySmoothing.vitest.js`, `shotLabR7Live.js`, `shotLabR7Live.vitest.js`, `tapCalibrate.js`, `shotLabPressureSession.vitest.js`, `hooks/useShotLabPressure.js`; `src/components/ShotPressureChart.jsx`, `ScaleFlowChart.jsx`, `ScaleFlowChart.vitest.js`; `scripts/curve-smoothing/measure.mjs`; this report.

With the existing local baseline traces and frozen label data present, the final commands were:

```powershell
npm run test:vitest
npm run build
node --import ./scripts/needle-reader/out/exam-observer.mjs scripts/needle-reader/exam.mjs --live
node --import ./scripts/needle-reader/out/curve-batch-observer.mjs scripts/pressure-label/analysis/replay-batch.mjs
node scripts/pressure-label/analysis/analyze-batch.mjs
node scripts/curve-smoothing/measure.mjs
```

The ignored preloaders capture an additional `displayBar` output field only, preserving original calls, arguments, readings and scoring. The exam preloader imports the unchanged checked-in observer, then adds the field to its captured record; the batch preloader adds it to the existing replay record. `baseline-display.mjs` is the original 588ad88 display helper saved before changes. Baseline traces: `curve-baseline-{exam,observed,batch,analysis}.json`. Repair logs: `curve-repair1-{tests,build,exam,batch,analysis,metrics}.txt`; captured current traces: `exam-observed.json`, `exam-live.json`, `batch-replayed.json`, `curve-metrics.json`, all under ignored `scripts/needle-reader/out/`. Generated legacy analysis docs stay local; their static old-version prose is not the repair report.

## Limits and next step

Unverified: live camera/countdown/repeated-shot behavior, mobile scheduling/processing cost, physical pressure independent of visual labels, and unseen glare/occlusion. The 125 ms bound is measured on these 8 Hz replays; it is not an end-to-end camera latency guarantee. Small-delta wobble is deliberately less smoothed, and not every clip/statistic improves. The batch displayed worst error rises slightly while remaining below one bar; pre-existing calibration bias is not repaired. Next step: Isaac reviews the branch and tries live pressure rises/drops and History gaps. No merge or deployment is authorized by this ticket.
