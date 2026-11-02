# Step-2 evaluation — 2 November 2026

Candidate: **4a91b1d**, branch **feat/pressure-accuracy-codex**. Runtime was restored
to this pushed HEAD before testing. The unfinished step-3 attempt is preserved
with git stash -u as **f96c56e321de594495d8a7ab2b6561effd6b83f1** (stash@{0});
it was not applied, committed, or included in this evaluation.

**All targets met: NO.** No runtime changes were made after testing began.

**Not ready to merge.** Eliminating false-ten flags did not preserve coverage or
accuracy. Published comparisons fell from 58 to 43, so the reduced extreme-error
count must be assessed alongside missing readings. In particular, 225219 now has
100% gaps; 094055 coverage fell from 99.31% to 46.21%. Transferring a single fixed
profile to every calibration introduces low-pressure zero mismatch and rejects
many previously available needle measurements. The registration repair alone
does not resolve those calibration/reading failures.

094055 at 22 s now reads 7.510 against 7.190 bar (+0.320), while its 19/40 s
comparisons are missing; at 11 s it reads 0.067 against 1.387 (−1.320).
130022's worst error is now −1.811 at 34 s. These regressions remain in all tables.

| Target | Measured now | Met |
| --- | ---: | --- |
| False-ten flags = 0 | 0 (0 fresh / 0 held) | true |
| >1-bar errors <3% | 4.65% | false |
| Median absolute error ≤0.10 bar | 0.179 | false |
| Published coverage ≥90% | 73.95% | false |

Now: **30/43 within 0.3 bar**; worst signed error
**-1.811 bar at 34 s**.
Frame accounting: **2601 fresh + 328 held + 1032 gaps = 3961**.

## Full per-clip history

B = original baseline, P1 = first accuracy repair, P2 = registration reacquisition,
now = steps 1–2 on 4a91b1d. Coverage includes held output; held samples remain
excluded from the confident curve. Missing old baseline fields are unavailable,
not zero. Historical numbers are copied from the preserved reports, never rerun.

| Clip | Published % B / P1 / P2 / now | Fresh % B / P1 / P2 / now | Held % B / P1 / P2 / now | Gaps % B / P1 / P2 / now |
| --- | ---: | ---: | ---: | ---: |
| 20261015_225219 | 82.00 / 100.00 / 100.00 / 0.00 | — / 100.00 / 100.00 / 0.00 | — / 0.00 / 0.00 / 0.00 | 18.00 / 0.00 / 0.00 / 100.00 |
| 20261015_225307 | 72.73 / 90.08 / 99.17 / 100.00 | — / 86.78 / 95.04 / 94.21 | — / 3.31 / 4.13 / 5.79 | 27.27 / 9.92 / 0.83 / 0.00 |
| 20261017_084814 | 43.95 / 91.58 / 100.00 / 87.89 | — / 90.26 / 99.47 / 85.53 | — / 1.32 / 0.53 / 2.37 | 56.05 / 8.42 / 0.00 / 12.11 |
| 20261017_084919 | 79.62 / 95.30 / 100.00 / 59.25 | — / 95.30 / 99.69 / 54.86 | — / 0.00 / 0.31 / 4.39 | 20.38 / 4.70 / 0.00 / 40.75 |
| 20261017_134943 | 95.55 / 90.68 / 100.00 / 72.03 | — / 88.35 / 97.03 / 68.01 | — / 2.33 / 2.97 / 4.03 | 4.45 / 9.32 / 0.00 / 27.97 |
| 20261017_135116 | 90.50 / 11.45 / 99.72 / 78.49 | — / 11.45 / 98.88 / 71.79 | — / 0.00 / 0.84 / 6.70 | 9.50 / 88.55 / 0.28 / 21.51 |
| 20261018_094055 | 74.02 / 10.34 / 99.31 / 46.21 | — / 10.11 / 89.89 / 31.03 | — / 0.23 / 9.43 / 15.17 | 25.98 / 89.66 / 0.69 / 53.79 |
| 20261018_094151 | 85.71 / 87.50 / 99.40 / 54.76 | — / 83.33 / 96.73 / 45.24 | — / 4.17 / 2.68 / 9.52 | 14.29 / 12.50 / 0.60 / 45.24 |
| 20261018_160844 | 59.47 / 91.69 / 99.00 / 57.48 | — / 78.07 / 90.70 / 39.20 | — / 13.62 / 8.31 / 18.27 | 40.53 / 8.31 / 1.00 / 42.52 |
| 20261018_160931 | 81.16 / 18.84 / 100.00 / 96.58 | — / 18.84 / 96.58 / 86.99 | — / 0.00 / 3.42 / 9.59 | 18.84 / 81.16 / 0.00 / 3.42 |
| 20261024_124006 | 79.19 / 59.73 / 100.00 / 100.00 | — / 55.93 / 97.09 / 97.54 | — / 3.80 / 2.91 / 2.46 | 20.81 / 40.27 / 0.00 / 0.00 |
| 20261025_130022 | 80.50 / 55.50 / 94.25 / 94.25 | — / 43.00 / 79.50 / 78.50 | — / 12.50 / 14.75 / 15.75 | 19.50 / 44.50 / 5.75 / 5.75 |

| Clip | Median bar B / P1 / P2 / now | Within 0.3 B / P1 / P2 / now | Worst signed bar B / P1 / P2 / now | >1 bar % B / P1 / P2 / now | False 10 B / P1 / P2 / now |
| --- | ---: | ---: | ---: | ---: | ---: |
| 20261015_225219 | 0.000 / 0.003 / 0.002 / — | — / 1/1 / 1/1 / 0/0 | — / 0.003 / 0.002 / — | 0.00 / 0.00 / 0.00 / — | 0 / 0 / 0 / 0 |
| 20261015_225307 | — / 0.014 / 0.028 / 0.339 | — / 1/1 / 1/1 / 0/1 | — / -0.014 / -0.028 / -0.339 | — / 0.00 / 0.00 / 0.00 | 0 / 0 / 0 / 0 |
| 20261017_084814 | 0.757 / 0.169 / 0.089 / 0.172 | — / 5/5 / 4/5 / 3/4 | — / -0.293 / -0.302 / -0.333 | 33.33 / 0.00 / 0.00 / 0.00 | 0 / 0 / 0 / 0 |
| 20261017_084919 | 0.551 / 0.007 / 0.009 / 0.704 | — / 3/3 / 3/3 / 0/1 | — / 0.123 / 0.136 / -0.704 | 33.33 / 0.00 / 0.00 / 0.00 | 0 / 0 / 0 / 0 |
| 20261017_134943 | 0.429 / 0.145 / 0.098 / 0.372 | — / 3/4 / 4/5 / 2/4 | — / 0.651 / 0.625 / 0.594 | 0.00 / 0.00 / 0.00 / 0.00 | 0 / 0 / 0 / 0 |
| 20261017_135116 | 0.437 / 0.001 / 0.015 / 0.554 | — / 1/1 / 3/3 / 1/2 | — / -0.001 / -0.031 / -0.874 | 0.00 / 0.00 / 0.00 / 0.00 | 0 / 0 / 0 / 0 |
| 20261018_094055 | 0.600 / 1.272 / 5.647 / 0.820 | — / 0/1 / 0/4 / 0/2 | — / 1.272 / -7.216 / -1.320 | 25.00 / 100.00 / 75.00 / 50.00 | 0 / 0 / 0 / 0 |
| 20261018_094151 | 0.283 / 0.015 / 0.152 / 0.360 | — / 3/3 / 3/3 / 0/1 | — / 0.157 / 0.184 / -0.360 | 0.00 / 0.00 / 0.00 / 0.00 | 0 / 0 / 0 / 0 |
| 20261018_160844 | 0.140 / 0.087 / 0.058 / 0.741 | — / 3/5 / 4/5 / 0/1 | — / -0.369 / 0.416 / -0.741 | 0.00 / 0.00 / 0.00 / 0.00 | 0 / 0 / 0 / 0 |
| 20261018_160931 | 0.091 / 0.041 / 0.032 / 0.481 | — / 2/2 / 3/3 / 1/3 | — / -0.053 / 0.278 / -0.549 | 0.00 / 0.00 / 0.00 / 0.00 | 0 / 0 / 10 / 0 |
| 20261024_124006 | 0.155 / 0.084 / 0.079 / 0.083 | 8/11 / 9/10 / 12/12 / 12/12 | -0.410 / 0.542 / 0.231 / -0.194 | 0.00 / 0.00 / 0.00 / 0.00 | 0 / 0 / 0 / 0 |
| 20261025_130022 | 0.075 / 0.083 / 0.128 / 0.155 | 12/12 / 5/6 / 10/13 / 11/12 | 0.280 / 0.326 / 1.077 / -1.811 | 0.00 / 0.00 / 7.69 / 8.33 | 0 / 0 / 0 / 0 |

Fresh-derived accuracy now: **30/43
within 0.3**, median **0.179 bar**, >1 bar
**4.65%**. Held accuracy: **0/0
within 0.3**, median **— bar**, >1 bar
**—%**. For the hand clips, fresh-derived means the
unchanged scorer's fresh-sample display windows, not an instantaneous fresh
measurement at the exact label timestamp. Exact counts, worst timestamps,
label hits and separate fresh/held summaries are in the companion JSON.

## Changes evaluated and limitations

- Step 1 (c79cf09): derive zero from the existing scale profile transferred onto
  the user's five/ten rays; no frozen moving needle defines zero. Capture a
  template only from an on-arc measured needle. This removes 094055's invalid
  near-278-degree zero but does not solve pointer identification or validate the
  fixed profile under every view. Taps remain authoritative.
- Step 2 (4a91b1d): no extrapolation to ten past the tapped endpoint; withhold
  near-endpoint measurements whose pixel-quantization interval crosses ten.
  The bound uses actual pointer and tapped-ray lever arms, not the exam's
  pressure cutoff. Registration and fresh/held separation are preserved.
- Step 3 remains parked and failed a real targeted test before being stashed.
  No step-3 repair or success is claimed. The zero/profile assumption can shift
  low-pressure readings, and unresolved pointer selection can reduce coverage.
  This evaluation reports the complete result rather than hiding those costs.

## Checks and provenance

- Full Vitest: **449 passed, 2 failed, 1 skipped (452 tests)**; files **85 passed,
  3 failed, 1 skipped (89)**. The only failures are the two Python-dependent tests
  (gaugeProfile, needleRectify) and the temporalReplay suite's missing box-only
  raw-frames.json. These are the documented AGENTS environment exceptions.
  No tests were deleted, modified or skipped to obtain this result.
- Production build: **passed**, including PWA service-worker generation.
  Existing large-chunk warnings remain.
- Unchanged live exam: **one run**, completed successfully. The existing read-only
  debugger observer captured result and publisher output to distinguish fresh
  and held readings; it changed no input or returned value. Timing under the
  observer is not a performance benchmark. Per-clip counts, medians and flag
  splits were checked against the official exam output.
- Previous outputs preserved under ignored out/pass2-observed-before-step2-exam
  and out/pass2-before-step2-exam.json. Current stdout/progress, full tests and
  build logs are under ignored out/step2-final-exam*, out/step2-full-tests.txt,
  and out/step2-build.txt. No source clips were edited or uploaded.
- Exam/scoring scripts, fixtures, labels, frozen config, model and runtime source
  have no changes from the evaluated candidate. Only this report, its JSON and
  CODEX-HANDOVER.md record the evaluation. The stash is local and is not uploaded
  by pushing a branch.

No new phone-camera benchmark or exact replay of today's shot with its missing
original calibration was performed. No retraining, schema/data/auth/privacy,
version or recording-start change. Nothing merged into main or deployed.
Stop here as requested. The parked attempt is recoverable; further repair needs
separate direction and must start by reviewing its failed-test contract.
