# Pass 2 plus endpoint-only evaluation — 2 November 2026

Candidate **beb8473**, branch **feat/pressure-accuracy-p2-endpoint**, based on **da595fb**. Latest main fetched: 5628c33, already an ancestor of pass 2. Cherry-picked **4a91b1d** only. Runtime patch applied independently of c79cf09; the only conflict was CODEX-HANDOVER.md (absent at pass 2), resolved with a branch-specific note. No tap-derived zero or new template-seeding behavior is included. The parked step-3 stash remains untouched.

**All targets met: NO.** Runtime was frozen before one unchanged final live exam. No rerun or tuning after results.

| Target | Now | Met |
| --- | ---: | --- |
| Coverage ≥90% | 82.83% | false |
| False-ten flags =0 | 0 (0 fresh / 0 held) | true |
| >1 bar errors <3% | 3.92% | false |
| Median ≤0.10 bar | 0.098 | true |

Within 0.3: **43/51**. Frame accounting: **3005 fresh + 276 held + 680 gaps = 3961**.

**Not ready to merge.** Pass-2 coverage was 99.17%, median 0.097, 48/58 within
0.3, 6.90% >1 bar, with ten high flags. Endpoint-only removes those flags but
reduces published labelled comparisons from 58 to 51 and coverage by about 16.3
percentage points. The lower extreme-error rate must be assessed alongside
those missing readings. Both >1-bar errors now are fresh-derived comparisons.

The endpoint check has a nonlocal limitation: it uses the shortest signed
angle to ten for every sample. On a calibrated arc wider than 180°, a valid
near-zero ray can therefore be rejected as if it crossed the upper endpoint.
On 225219 all 100 frames are gaps; a representative saved read has needle
321.741°, zero 321.254°, ten 144.025°, with 44 registration inliers and 0.145 px
residual. Its shortest signed step to ten is negative, despite being near zero.
This is a limitation of the endpoint commit itself, independent of c79cf09.
No correction was made after seeing this run.

The invalid zero and wrong-ray failure on 094055 remain unresolved in this
isolated candidate. At 40 s it publishes 7.883 against 5.404 (+2.478 bar).
130022's 25 s fresh-display window still publishes 7.687 against 6.610 (+1.077).

## All 12 clips: baseline / pass 2 / now

B = original baseline, P2 = da595fb registration repair, now = endpoint-only cherry-pick. Coverage includes held frames; held readings remain excluded from the confident curve. Missing original baseline fields were not retained and remain unavailable (—). No historical run was repeated. Worst errors are signed bar values; exact times/counts and label hits are in the companion JSON.

| Clip | Published % B / P2 / now | Fresh % B / P2 / now | Held % B / P2 / now | Gaps % B / P2 / now |
| --- | ---: | ---: | ---: | ---: |
| 20261015_225219 | 82.00 / 100.00 / 0.00 | — / 100.00 / 0.00 | — / 0.00 / 0.00 | 18.00 / 0.00 / 100.00 |
| 20261015_225307 | 72.73 / 99.17 / 99.17 | — / 95.04 / 95.04 | — / 4.13 / 4.13 | 27.27 / 0.83 / 0.83 |
| 20261017_084814 | 43.95 / 100.00 / 100.00 | — / 99.47 / 99.47 | — / 0.53 / 0.53 | 56.05 / 0.00 / 0.00 |
| 20261017_084919 | 79.62 / 100.00 / 67.40 | — / 99.69 / 63.64 | — / 0.31 / 3.76 | 20.38 / 0.00 / 32.60 |
| 20261017_134943 | 95.55 / 100.00 / 100.00 | — / 97.03 / 96.61 | — / 2.97 / 3.39 | 4.45 / 0.00 / 0.00 |
| 20261017_135116 | 90.50 / 99.72 / 93.30 | — / 98.88 / 87.43 | — / 0.84 / 5.87 | 9.50 / 0.28 / 6.70 |
| 20261018_094055 | 74.02 / 99.31 / 45.29 | — / 89.89 / 26.44 | — / 9.43 / 18.85 | 25.98 / 0.69 / 54.71 |
| 20261018_094151 | 85.71 / 99.40 / 64.29 | — / 96.73 / 55.65 | — / 2.68 / 8.63 | 14.29 / 0.60 / 35.71 |
| 20261018_160844 | 59.47 / 99.00 / 79.73 | — / 90.70 / 70.43 | — / 8.31 / 9.30 | 40.53 / 1.00 / 20.27 |
| 20261018_160931 | 81.16 / 100.00 / 96.92 | — / 96.58 / 93.84 | — / 3.42 / 3.08 | 18.84 / 0.00 / 3.08 |
| 20261024_124006 | 79.19 / 100.00 / 100.00 | — / 97.09 / 97.09 | — / 2.91 / 2.91 | 20.81 / 0.00 / 0.00 |
| 20261025_130022 | 80.50 / 94.25 / 94.25 | — / 79.50 / 79.50 | — / 14.75 / 14.75 | 19.50 / 5.75 / 5.75 |

| Clip | Median bar B / P2 / now | Within 0.3 B / P2 / now | Worst signed bar B / P2 / now | >1 bar % B / P2 / now | False 10 B / P2 / now |
| --- | ---: | ---: | ---: | ---: | ---: |
| 20261015_225219 | 0.000 / 0.002 / — | — / 1/1 / 0/0 | — / 0.002 / — | 0.00 / 0.00 / — | 0 / 0 / 0 |
| 20261015_225307 | — / 0.028 / 0.028 | — / 1/1 / 1/1 | — / -0.028 / -0.028 | — / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261017_084814 | 0.757 / 0.089 / 0.089 | — / 4/5 / 4/5 | — / -0.302 / -0.302 | 33.33 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261017_084919 | 0.551 / 0.009 / 0.000 | — / 3/3 / 1/1 | — / 0.136 / -0.000 | 33.33 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261017_134943 | 0.429 / 0.098 / 0.098 | — / 4/5 / 4/5 | — / 0.625 / 0.625 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261017_135116 | 0.437 / 0.015 / 0.010 | — / 3/3 / 3/3 | — / -0.031 / -0.031 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261018_094055 | 0.600 / 5.647 / 0.915 | — / 0/4 / 1/3 | — / -7.216 / 2.478 | 25.00 / 75.00 / 33.33 | 0 / 0 / 0 |
| 20261018_094151 | 0.283 / 0.152 / 0.152 | — / 3/3 / 1/1 | — / 0.184 / -0.152 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261018_160844 | 0.140 / 0.058 / 0.115 | — / 4/5 / 3/4 | — / 0.416 / 0.416 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261018_160931 | 0.091 / 0.032 / 0.032 | — / 3/3 / 3/3 | — / 0.278 / 0.278 | 0.00 / 0.00 / 0.00 | 0 / 10 / 0 |
| 20261024_124006 | 0.155 / 0.079 / 0.079 | 8/11 / 12/12 / 12/12 | -0.410 / 0.231 / 0.231 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261025_130022 | 0.075 / 0.128 / 0.128 | 12/12 / 10/13 / 10/13 | 0.280 / 1.077 / 1.077 | 0.00 / 7.69 / 7.69 | 0 / 0 / 0 |

Fresh-derived comparisons: **40/48 within 0.3**, median 0.100, >1 bar 4.17%. Held comparisons: **3/3 within 0.3**, median 0.028, >1 bar 0.00%. Hand-clip fresh-derived scores use the unchanged fresh-sample display windows, not necessarily the instantaneous sample at the label timestamp.

## Worst remaining published errors

| Clip | Time s | Published | Truth | Signed error | Reason |
| --- | ---: | ---: | ---: | ---: | --- |
| 20261018_094055 | 40 | 7.883 | 5.404 | 2.478 | tap-fresh |
| 20261025_130022 | 25 | 7.687 | 6.610 | 1.077 | tap |
| 20261018_094055 | 11 | 2.302 | 1.387 | 0.915 | tap-fresh |
| 20261017_134943 | 25 | 6.909 | 6.284 | 0.625 | tap-fresh |
| 20261025_130022 | 34 | 6.170 | 6.670 | -0.500 | tap |
| 20261018_160844 | 20 | 7.493 | 7.077 | 0.416 | tap-fresh |
| 20261025_130022 | 49.375 | 0.043 | -0.310 | 0.353 | tap |
| 20261017_084814 | 22 | 7.311 | 7.613 | -0.302 | tap-fresh |

## Validation and scope

- Targeted endpoint + calibration tests: **40 passed / 40**.
- Full Vitest: **444 passed, 2 failed, 1 skipped (447 tests)**; files **84 passed, 3 failed, 1 skipped (88)**. Only the known Python-dependent gaugeProfile/needleRectify tests and box-only temporalReplay raw-frames.json fixture fail. Under AGENTS these are environment exceptions; no other failure and no test skipped or deleted to obtain results.
- Production build: **passed**, including PWA service-worker generation; existing large-chunk warnings remain.
- Unchanged live exam: **one completed run**. Existing read-only debugger observer captures publisher results and frame provenance without changing values or inputs. Counts, medians and high-flag splits match official output; timings under the observer are not performance benchmarks.
- Prior combined-step outputs preserved under ignored out/step2-combined-before-endpoint-only. New raw logs: out/p2-endpoint-targeted.txt, out/p2-endpoint-full-tests.txt, out/p2-endpoint-build.txt, out/p2-endpoint-exam.txt and -progress.txt. Original pass-2 results remain in the existing report and earlier output backups.
- Runtime difference from da595fb: only tapCalibrate.js endpoint extrapolation/quantization guard. Added tapEndpoint.vitest.js. Calibration zero, template appearance, registration, publisher and model unchanged. No exam/scoring/labels/fixtures/frozen config/acceptance-threshold edits. Documentation adds this report, companion JSON and CODEX-HANDOVER.md.
- No retraining, version/dependency/schema/data/auth/privacy or recording-start changes. No new phone-camera benchmark or exact replay of today’s shot with missing original taps.

Nothing merged into main or deployed. Push this branch and stop; no further runtime repair or exam rerun in this task.
