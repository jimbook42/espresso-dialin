# Pressure-reading diagnosis — 2 November 2026

**Stopped after diagnosis; implementation estimate 3–4 hours.** This exceeds the
user's approximately two-hour plan-first limit. No runtime code was changed and
no new live exam was run. The accuracy targets remain unfulfilled.

Branch: `feat/pressure-accuracy-codex`, starting at `da595fb`. Latest
`origin/main` was fetched first; merging it into this feature branch reported
already up to date. No merge into main or deployment was performed.

## Root causes and frame evidence

### 094055: an incorrect calibration reference admits the wrong needle ray

The calibration function takes **centre, printed 5, printed 10**, then obtains
zero from the detected needle on the frozen frame. The UI does not currently
collect a zero tap. This is a distinction from the task's 0/5/10 description.
A saved `zeroAngleDeg` is a derived result, not evidence of a user-placed zero.
The live exam reconstructs calibration from those three points; copying the
sidecar zero would not repair this clip, because the sidecar contains the same
incorrect zero. No sidecars or calibration data were edited.

At the 2.75 s calibration frame, a diagnostic detector probe returns **278.741°**,
quality **0.18**, raw margin **0.108**. Visual inspection shows the actual resting
pointer facing upper-right, consistent with the existing approximately 325.8°
annotation, rather than the accepted near-upward ray. The hub-lobe heuristic
can promote quality to the tracking floor. `chooseRestNeedle` only chooses
between the detected ray and its opposite; it does not validate that the
chosen ray is zero. That ray then defines the calibration arc and tip template.
A template captured at an unvalidated zero can learn dial printing or the wrong
needle end. Merely increasing a quality threshold does not address this.

At **22 s**, the saved pass-2 read has **27 registration inliers**, residual
**0.589 normalized px**, needle **276.470°**, quality **0.748**, zero **277.204°**,
and ten **146.053°**. The existing needle annotation is **79.177°**. Publication
is **−0.026 bar**, truth **7.190 bar**, error **−7.216 bar**. The source crop
shows that accepted ray on the opposite/branding side of the long pointer.
Registration is present; the invalid zero and approximately **227.4°** arc admit
the wrong ray as a near-zero reading. At 19 s the same pattern publishes
**0.027 vs 5.973 bar**. At 40 s a held **0.057 vs 5.404 bar** compounds an earlier
wrong observation; holding is not evidence of correctness.

The calibration frame happens to be at rest in this clip. The proposed runtime
repair must not infer that the first recorded frame, or an arbitrary new
calibration frame, is at rest. Recordings begin at the lever pull.

### 160931: extrapolation becomes 10, plus unresolved endpoint evidence

All **10 ≥9.95-bar frame flags** occur from **10.125–11.5 s**: **6 fresh + 4 held**.
Four fresh readings are exactly 10 because `barFromTapAnchors` clamps angles
past the tapped ten ray to the scale maximum. Their angular overshoots are about
**5.38°, 5.90°, 1.56°, 6.18°**. The temporal top-bar gate allows these through
because the preceding readings already rose close to the maximum.

Removing extrapolation alone is insufficient. At **10.5 s** the saved angle is
**44.762°**, ten **45.542°**, yielding **9.95689 bar**. At **11.375 s**, angle
**44.659°**, ten **45.454°**, yielding **9.95616 bar**. These are inside the
calibrated arc and would still flag; four held frames repeat near-limit readings.
At the measured face radius, the angular separation from ten is about **1.3 px**
at the outer needle sampling radius. The current reader emits a point angle,
without a localization interval that can establish which side of the endpoint
is supported. The tapped hub must remain authoritative; shifting it to the
annotation or to a newly detected pivot would change the user's calibration.

The source crops put the physical pointer near the printed 10. The exam counts
every published ≥9.95 value without per-frame truth in this burst, so the ten
flags are retained as the specified proxy, not described as ten independently
verified false physical events. No flags were discounted. A safe repair must
withhold ambiguous endpoint measurements, never cap them at a value just below
the scoring threshold.

### Checks across the other clips

All 12 saved per-frame traces were checked. **094055 is the only extreme
zero-to-five anomaly**: 137.7°, while the others span approximately 75.5–96.9°.
The calibration values below are reconstructed reference-frame angles from the
saved pose matrices; small registration numerical differences are immaterial.

| Clip | Zero→5 ° | 5→10 ° | Zero→10 ° | Raw clamped-to-10 frames | Published ≥9.95 frames |
| --- | ---: | ---: | ---: | ---: | ---: |
| 20261015_225219 | 93.02 | 89.76 | 182.78 | 0 | 0 |
| 20261015_225307 | 82.11 | 89.76 | 171.87 | 0 | 0 |
| 20261017_084814 | 85.41 | 89.76 | 175.17 | 0 | 0 |
| 20261017_084919 | 94.87 | 89.76 | 184.63 | 0 | 0 |
| 20261017_134943 | 87.71 | 89.76 | 177.47 | 0 | 0 |
| 20261017_135116 | 90.09 | 89.76 | 179.85 | 0 | 0 |
| 20261018_094055 | 137.67 | 89.76 | 227.43 | 0 | 0 |
| 20261018_094151 | 96.86 | 89.76 | 186.62 | 0 | 0 |
| 20261018_160844 | 93.99 | 89.76 | 183.75 | 0 | 0 |
| 20261018_160931 | 84.03 | 89.76 | 173.79 | 4 | 10 |
| 20261024_124006 | 75.48 | 86.98 | 162.46 | 0 | 0 |
| 20261025_130022 | 80.35 | 86.87 | 167.22 | 2 | 0 |

Only 160931 and 130022 contain raw clamped-to-ten candidates. The two 130022
candidates (4.75 and 6.5 s) were not published as ≥9.95 readings, so a blanket
change to the top-bar temporal thresholds is not justified.

130022 also has a distinct recovery outlier. After missing needle measurements
at 24.75–25.125 s, it publishes **7.68681 bar at 25.25 s**, angle **85.164°**,
quality/likeness **0.927**, with **29 registration inliers** and residual **0.482**.
The preceding accepted read at 24.625 s is 6.770 bar. The unchanged hand scorer's
±0.3 s fresh-display window uses the recovered 25.25 s reading for the 25 s label,
producing **+1.077 bar** against 6.61. This is not the instantaneous held value
at exactly 25 s. High template-style correlation can accompany the recovery
spike; the saved trace lacks an explicit detector-versus-template provenance
field, so its exact selection path is not asserted from correlation alone.
Its zero span is not the 094055 anomaly and its pressure is below the endpoint.
Zero validation and deleting the ten clamp alone would leave this error.

The other over-0.3 comparisons are 084814 at 22 s (−0.302), 134943 at 25 s
(+0.625), 160844 at 20 s (+0.416), and 130022 at 34 s (−0.500) and 49.375 s
(+0.353). They are retained, including the 084814 miss which must not be rounded
into the within-0.3 count. No other >1-bar labelled errors occur outside
094055 and 130022 in pass 2.

An arc-only antipodal ambiguity rule is insufficient: with the existing edge
allowance, every fresh 225219 reading also admits the opposite ray numerically,
even though its labelled result is accurate. Rejecting all such readings would
unnecessarily sacrifice coverage. Pointer identity needs image evidence.

## Proposed repair and effort

1. **Calibration reference, 45–60 min:** keep centre/5/10 taps fixed; separate
   scale-zero provenance from the moving needle. Anchor a static scale reference
   to the user pins and validate its geometry using the existing gauge profile;
   do not declare an arbitrary observed needle to be zero. Preserve any truly
   trusted user reference, and mark unresolved zero uncertainty explicitly in
   memory. Capture needle appearance only from a validated pointer at its
   measured angle, separately from the zero angle. This needs careful validation
   because a single hardcoded zero-to-ten span would shift valid calibrations
   across these clips. No new zero-tip calibration step, recording-start change,
   stored-data migration, or replacement of taps by detection is proposed.
2. **Pointer evidence/recovery, 60–90 min:** compare coherent long-shaft/tip
   evidence with the opposite broad tail and static printing, retaining enough
   alternative-candidate and lateral-offset information to reject an ambiguous
   winner. Apply the same evidence to detector and template recovery; template
   correlation alone must not certify a new pressure. Rejected candidates must
   not update the needle hint or last-good pressure. Preserve registration,
   bounded display holds, and exclusion of held samples from the confident curve.
3. **Endpoint evidence, 20–30 min:** return no pressure for an out-of-domain
   angle, rather than synthesizing ten by clamping. Propagate a physically based
   angular uncertainty from pixel resolution, pointer width/fit and actual
   lever arm. When that interval crosses the calibrated endpoint, hold briefly
   or leave a gap. Do not use the exam's 9.95 cutoff as a runtime threshold or
   cap reported pressure below it.
4. **Validation/report, 45–60 min:** targeted tests for calibration under pressure,
   bad zero, tip/tail and print competition, recovery after a missing needle,
   both scale limits, and valid stationary needles; full Vitest and build under
   AGENTS' environment-only rule. Freeze runtime changes, run the unchanged live
   exam **once**, and report every clip plus fresh/held/gap accounting. Recheck
   today's shot's 12–17 s rise without requiring pre-pull frames. Targets remain
   ≥90% coverage, median ≤~0.10 bar, <3% >1-bar errors, and zero false-ten flags.

Total implementation/validation estimate: **about 3–4 hours**, no retraining.
There is no evidence yet that all four numerical targets will be met. Stop here
under the user's plan-first budget; the repair above requires approval before
runtime work. Countdown recording could provide a separate pre-pull diagnostic,
but it is not a required input or part of this proposal.

## Historical comparison and current status

B = original baseline, P1 = first accuracy repair, P2 = reacquisition repair.
**Now: no new candidate and no new exam**; runtime remains the P2 candidate
`f266f21` (reporting HEAD was `da595fb`). Asterisks below mean “not run,” not
zero or missing pressure. P2 is the latest measured result, not a fresh run.
Unavailable original baseline fields remain em dashes; no baseline was rerun.

| Clip | Published % B / P1 / P2 | Fresh % B / P1 / P2 | Held % B / P1 / P2 | Gaps % B / P1 / P2 | Now |
| --- | ---: | ---: | ---: | ---: | --- |
| 20261015_225219 | 82.00 / 100.00 / 100.00 | — / 100.00 / 100.00 | — / 0.00 / 0.00 | 18.00 / 0.00 / 0.00 | Not run* |
| 20261015_225307 | 72.73 / 90.08 / 99.17 | — / 86.78 / 95.04 | — / 3.31 / 4.13 | 27.27 / 9.92 / 0.83 | Not run* |
| 20261017_084814 | 43.95 / 91.58 / 100.00 | — / 90.26 / 99.47 | — / 1.32 / 0.53 | 56.05 / 8.42 / 0.00 | Not run* |
| 20261017_084919 | 79.62 / 95.30 / 100.00 | — / 95.30 / 99.69 | — / 0.00 / 0.31 | 20.38 / 4.70 / 0.00 | Not run* |
| 20261017_134943 | 95.55 / 90.68 / 100.00 | — / 88.35 / 97.03 | — / 2.33 / 2.97 | 4.45 / 9.32 / 0.00 | Not run* |
| 20261017_135116 | 90.50 / 11.45 / 99.72 | — / 11.45 / 98.88 | — / 0.00 / 0.84 | 9.50 / 88.55 / 0.28 | Not run* |
| 20261018_094055 | 74.02 / 10.34 / 99.31 | — / 10.11 / 89.89 | — / 0.23 / 9.43 | 25.98 / 89.66 / 0.69 | Not run* |
| 20261018_094151 | 85.71 / 87.50 / 99.40 | — / 83.33 / 96.73 | — / 4.17 / 2.68 | 14.29 / 12.50 / 0.60 | Not run* |
| 20261018_160844 | 59.47 / 91.69 / 99.00 | — / 78.07 / 90.70 | — / 13.62 / 8.31 | 40.53 / 8.31 / 1.00 | Not run* |
| 20261018_160931 | 81.16 / 18.84 / 100.00 | — / 18.84 / 96.58 | — / 0.00 / 3.42 | 18.84 / 81.16 / 0.00 | Not run* |
| 20261024_124006 | 79.19 / 59.73 / 100.00 | — / 55.93 / 97.09 | — / 3.80 / 2.91 | 20.81 / 40.27 / 0.00 | Not run* |
| 20261025_130022 | 80.50 / 55.50 / 94.25 | — / 43.00 / 79.50 | — / 12.50 / 14.75 | 19.50 / 44.50 / 5.75 | Not run* |

| Clip | Median bar B / P1 / P2 | Within 0.3 B / P1 / P2 | Worst signed bar B / P1 / P2 | >1 bar % B / P1 / P2 | False 10 B / P1 / P2 | Now |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 20261015_225219 | 0.000 / 0.003 / 0.002 | — / 1/1 / 1/1 | — / 0.003 / 0.002 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 | Not run* |
| 20261015_225307 | — / 0.014 / 0.028 | — / 1/1 / 1/1 | — / -0.014 / -0.028 | — / 0.00 / 0.00 | 0 / 0 / 0 | Not run* |
| 20261017_084814 | 0.757 / 0.169 / 0.089 | — / 5/5 / 4/5 | — / -0.293 / -0.302 | 33.33 / 0.00 / 0.00 | 0 / 0 / 0 | Not run* |
| 20261017_084919 | 0.551 / 0.007 / 0.009 | — / 3/3 / 3/3 | — / 0.123 / 0.136 | 33.33 / 0.00 / 0.00 | 0 / 0 / 0 | Not run* |
| 20261017_134943 | 0.429 / 0.145 / 0.098 | — / 3/4 / 4/5 | — / 0.651 / 0.625 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 | Not run* |
| 20261017_135116 | 0.437 / 0.001 / 0.015 | — / 1/1 / 3/3 | — / -0.001 / -0.031 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 | Not run* |
| 20261018_094055 | 0.600 / 1.272 / 5.647 | — / 0/1 / 0/4 | — / 1.272 / -7.216 | 25.00 / 100.00 / 75.00 | 0 / 0 / 0 | Not run* |
| 20261018_094151 | 0.283 / 0.015 / 0.152 | — / 3/3 / 3/3 | — / 0.157 / 0.184 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 | Not run* |
| 20261018_160844 | 0.140 / 0.087 / 0.058 | — / 3/5 / 4/5 | — / -0.369 / 0.416 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 | Not run* |
| 20261018_160931 | 0.091 / 0.041 / 0.032 | — / 2/2 / 3/3 | — / -0.053 / 0.278 | 0.00 / 0.00 / 0.00 | 0 / 0 / 10 | Not run* |
| 20261024_124006 | 0.155 / 0.084 / 0.079 | 8/11 / 9/10 / 12/12 | -0.410 / 0.542 / 0.231 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 | Not run* |
| 20261025_130022 | 0.075 / 0.083 / 0.128 | 12/12 / 5/6 / 10/13 | 0.280 / 0.326 / 1.077 | 0.00 / 0.00 / 7.69 | 0 / 0 / 0 | Not run* |

Overall latest measured P2: **99.17% published**, **94.57% fresh**, **4.59% held**,
**0.83% gaps**; median **0.097 bar**, **48/58 within 0.3**, **6.90% >1 bar**,
worst **−7.216 bar**, **10 false-ten flags**. Frame accounting:
**3,746 fresh + 182 held + 33 gaps = 3,961**. Fresh-derived labelled comparisons:
**47/56 within 0.3**, median **0.097**, **5.36% >1 bar**; held:
**1/2 within 0.3**, worst **−5.348**. For hand clips, fresh-derived means the
unchanged scorer's fresh-sample display window, not necessarily a fresh frame at
the exact label timestamp. Per-clip fresh/held accuracy and exact numbers are
preserved in the companion JSON and prior pass-2 report.

## Validation and changed files in this diagnosis pass

- Main synchronization: fetched; already up to date.
- Read-only data checks: all **12/12 traces** inspected; seven diagnostic crops
  decoded. Calibration, wrong-ray, near-ten and recovery examples were visually
  inspected, with original source untouched.
- New unit tests/full suite/build: **not run; zero tests added or changed**.
  This is a plan-only stop before implementation, not a newly validated candidate.
- New live exams: **0**. The single final run is reserved for the approved repair.
- Historical P2 verification only: **441 passed, 2 known Python-dependent failures,
  1 skipped**, plus the known box-only missing-fixture suite; **build passed**.
  These are previous-run results, not checks repeated in this diagnosis pass.
- Tracked files changed: this report and
  `docs/pressure-reading-diagnosis-2026-11-02-results.json` only. Local diagnostic
  helpers/crops remain ignored under `scripts/needle-reader/out`; exam/scoring
  source, labels, fixtures, frozen config, model, runtime and version are untouched.

Unverified: the proposed repair, target attainment, phone-camera behavior,
and today's shot with a new candidate. Next step is approval of the estimated
3–4 hour repair, followed by small implementation commits and one final exam.
Nothing was merged into main or deployed.
