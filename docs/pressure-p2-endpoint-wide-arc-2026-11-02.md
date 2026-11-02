# Wide-arc endpoint guard repair — 2 November 2026

Candidate **f7914e5**, branch **feat/pressure-accuracy-p2-endpoint**, on endpoint-only commit beb8473. The guard now checks directed progress from calibrated zero to ten before applying the existing pixel uncertainty. This preserves near-zero readings on arcs wider than 180° and still rejects angles past ten and readings whose pixel uncertainty crosses ten. Added the 225219 wide-arc regression. Calibration zero/template remain pass-2 behavior; c79cf09 and the parked step-3 stash are not included.

**All targets met: NO.** Coverage and zero false-ten flags pass. Median is 0.100191 bar, slightly above 0.10; >1-bar errors are 5.56%. Runtime was frozen before one unchanged final live exam. No rerun or tuning after results.

| Target | Now | Met |
| --- | ---: | --- |
| Coverage ≥90% | 91.82% | true |
| False-ten flags =0 | 0 (0 fresh / 0 held) | true |
| >1 bar errors <3% | 5.56% | false |
| Median ≤0.10 bar | 0.100191 | false |

Within 0.3: **45/54**. Frame accounting: **3170 fresh + 467 held + 324 gaps = 3961**.

## All 12 clips: baseline / pass 2 / now

B = original baseline, previous = beb8473 endpoint-only, now = f7914e5 wide-arc guard. Coverage includes held frames; held readings remain excluded from the confident curve. Missing original baseline fields were not retained and remain unavailable (—). No historical run was repeated. Worst errors are signed bar values; exact times/counts and label hits are in the companion JSON.

| Clip | Published % B / P2 / now | Fresh % B / P2 / now | Held % B / P2 / now | Gaps % B / P2 / now |
| --- | ---: | ---: | ---: | ---: |
| 20261015_225219 | 82.00 / 0.00 / 81.00 | — / 0.00 / 64.00 | — / 0.00 / 17.00 | 18.00 / 100.00 / 19.00 |
| 20261015_225307 | 72.73 / 99.17 / 73.55 | — / 95.04 / 52.89 | — / 4.13 / 20.66 | 27.27 / 0.83 / 26.45 |
| 20261017_084814 | 43.95 / 100.00 / 96.58 | — / 99.47 / 92.89 | — / 0.53 / 3.68 | 56.05 / 0.00 / 3.42 |
| 20261017_084919 | 79.62 / 67.40 / 93.10 | — / 63.64 / 85.58 | — / 3.76 / 7.52 | 20.38 / 32.60 / 6.90 |
| 20261017_134943 | 95.55 / 100.00 / 95.13 | — / 96.61 / 85.59 | — / 3.39 / 9.53 | 4.45 / 0.00 / 4.87 |
| 20261017_135116 | 90.50 / 93.30 / 91.90 | — / 87.43 / 85.75 | — / 5.87 / 6.15 | 9.50 / 6.70 / 8.10 |
| 20261018_094055 | 74.02 / 45.29 / 95.17 | — / 26.44 / 66.21 | — / 18.85 / 28.97 | 25.98 / 54.71 / 4.83 |
| 20261018_094151 | 85.71 / 64.29 / 78.57 | — / 55.65 / 67.26 | — / 8.63 / 11.31 | 14.29 / 35.71 / 21.43 |
| 20261018_160844 | 59.47 / 79.73 / 90.03 | — / 70.43 / 76.08 | — / 9.30 / 13.95 | 40.53 / 20.27 / 9.97 |
| 20261018_160931 | 81.16 / 96.92 / 96.92 | — / 93.84 / 91.44 | — / 3.08 / 5.48 | 18.84 / 3.08 / 3.08 |
| 20261024_124006 | 79.19 / 100.00 / 93.96 | — / 97.09 / 86.58 | — / 2.91 / 7.38 | 20.81 / 0.00 / 6.04 |
| 20261025_130022 | 80.50 / 94.25 / 93.25 | — / 79.50 / 77.00 | — / 14.75 / 16.25 | 19.50 / 5.75 / 6.75 |

| Clip | Median bar B / P2 / now | Within 0.3 B / P2 / now | Worst signed bar B / P2 / now | >1 bar % B / P2 / now | False 10 B / P2 / now |
| --- | ---: | ---: | ---: | ---: | ---: |
| 20261015_225219 | 0.000 / — / 0.002 | — / 0/0 / 1/1 | — / — / 0.002 | 0.00 / — / 0.00 | 0 / 0 / 0 |
| 20261015_225307 | — / 0.028 / — | — / 1/1 / 0/0 | — / -0.028 / — | — / 0.00 / — | 0 / 0 / 0 |
| 20261017_084814 | 0.757 / 0.089 / 0.138 | — / 4/5 / 3/4 | — / -0.302 / -0.302 | 33.33 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261017_084919 | 0.551 / 0.000 / 0.009 | — / 1/1 / 3/3 | — / -0.000 / 0.136 | 33.33 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261017_134943 | 0.429 / 0.098 / 0.098 | — / 4/5 / 4/5 | — / 0.625 / 0.625 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261017_135116 | 0.437 / 0.010 / 0.010 | — / 3/3 / 3/3 | — / -0.031 / -0.031 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261018_094055 | 0.600 / 0.915 / 5.348 | — / 1/3 / 0/3 | — / 2.478 / -5.946 | 25.00 / 33.33 / 66.67 | 0 / 0 / 0 |
| 20261018_094151 | 0.283 / 0.152 / 0.152 | — / 1/1 / 3/3 | — / -0.152 / 0.184 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261018_160844 | 0.140 / 0.115 / 0.115 | — / 3/4 / 3/4 | — / 0.416 / 0.416 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261018_160931 | 0.091 / 0.032 / 0.032 | — / 3/3 / 3/3 | — / 0.278 / 0.278 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261024_124006 | 0.155 / 0.079 / 0.079 | 8/11 / 12/12 / 12/12 | -0.410 / 0.231 / 0.231 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261025_130022 | 0.075 / 0.128 / 0.128 | 12/12 / 10/13 / 10/13 | 0.280 / 1.077 / 1.077 | 0.00 / 7.69 / 7.69 | 0 / 0 / 0 |

Fresh-derived comparisons: **42/50 within 0.3**, median 0.106, >1 bar 4.00%. Held comparisons: **3/4 within 0.3**, median 0.010, >1 bar 25.00%. Hand-clip fresh-derived scores use the unchanged fresh-sample display windows, not necessarily the instantaneous sample at the label timestamp.

## Worst remaining published errors

| Clip | Time s | Published | Truth | Signed error | Reason |
| --- | ---: | ---: | ---: | ---: | --- |
| 20261018_094055 | 19 | 0.027 | 5.973 | -5.946 | tap-fresh |
| 20261018_094055 | 40 | 0.057 | 5.404 | -5.348 | held:rate-unconfirmed |
| 20261025_130022 | 25 | 7.687 | 6.610 | 1.077 | tap |
| 20261018_094055 | 11 | 2.302 | 1.387 | 0.915 | tap-fresh |
| 20261017_134943 | 25 | 6.909 | 6.284 | 0.625 | tap-fresh |
| 20261025_130022 | 34 | 6.170 | 6.670 | -0.500 | tap |
| 20261018_160844 | 20 | 7.493 | 7.077 | 0.416 | tap-fresh |
| 20261025_130022 | 49.375 | 0.043 | -0.310 | 0.353 | tap |

## Validation and scope

- Targeted endpoint + calibration tests: **41 passed / 41**.
- Full Vitest: **445 passed, 2 failed, 1 skipped (448 tests)**; files **84 passed, 3 failed, 1 skipped (88)**. Only the known Python-dependent gaugeProfile/needleRectify tests and box-only temporalReplay raw-frames.json fixture fail. Under AGENTS these are environment exceptions; no other failure and no test skipped or deleted to obtain results.
- Production build: **passed**, including PWA service-worker generation; existing large-chunk warnings remain.
- Unchanged live exam: **one completed run**. Existing read-only debugger observer captures publisher results and frame provenance without changing values or inputs. Counts, medians and high-flag splits match official output; timings under the observer are not performance benchmarks.
- Prior combined-step outputs preserved under ignored out/step2-combined-before-endpoint-only. New raw logs: out/wide-arc-targeted.txt, out/wide-arc-full-tests.txt, out/wide-arc-build.txt, out/wide-arc-exam.txt and -progress.txt. Original pass-2 results remain in the existing report and earlier output backups.
- Runtime difference from beb8473: tapCalibrate.js uses the zero-to-ten directed arc to distinguish far near-zero rays from samples near/past ten. tapEndpoint.vitest.js adds the >180° regression. Calibration zero, template appearance, registration, publisher and model unchanged. No exam/scoring/labels/fixtures/frozen config/acceptance-threshold edits. Documentation adds this report, companion JSON and CODEX-HANDOVER.md.
- No retraining, version/dependency/schema/data/auth/privacy or recording-start changes. No new phone-camera benchmark or exact replay of today’s shot with missing original taps.

Nothing merged into main or deployed. The requested exam ran once; stop here.

