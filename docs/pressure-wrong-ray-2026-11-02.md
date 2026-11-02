# Wrong-ray production integration — 2 November 2026

Branch **fix/pressure-wrong-ray**, integration on8ca8caa. Runtime was frozen and hashed before one unchanged live exam. No tuning or rerun followed the result. All3961 frame pressure/fresh/held outputs match the corrected standalone replay (bar tolerance1e-9), and all frozen runtime hashes match. **All acceptance checks pass: true**. Sharp regression versus replay (coverage<90 or >1-bar errors>3%): **false**.

## Live result

Published coverage **94.45%** (83.24 fresh /11.21 held /5.55 gaps); median **0.112832 bar**; within0.3 **47/53**; >1-bar **0.00%**; worst **+0.904146 bar on094055 at11s**; false-ten **0 (0fresh/0held)**. Frames 3297+444+220=3961.

Isaac accepted a median up to approximately0.115 with zero >1-bar errors. Target checks: {"zeroFalseTen":true,"wildUnder3":true,"medianAtMostPoint115":true,"zeroWild":true,"coverageAtLeast90":true}.

## Requested points

| Clip | Time s | Published bar | Truth bar | Signed error | State |
| --- | ---: | ---: | ---: | ---: | --- |
| f011 | 19 | 5.654830 | 5.972936 | -0.318106 | held:needle-missing |
| f033 | 40 | 5.055815 | 5.404496 | -0.348682 | tap-fresh |
| 0201 | 25 | 6.651306 | 6.610000 | 0.041306 | fresh-derived display window |

## All12 clips

B=v4.13.26 production baseline, R=geometrically corrected standalone replay, live=integrated production reader. Coverage includes held output; held readings remain excluded from the confident curve. Medians/worst values are bar. Hand-clip labelled results use the unchanged fresh-display window, not necessarily an instantaneous fresh observation at the exact label time. Exact hits, worst times, frame counts and fresh/held splits are in the companion JSON.

| Clip | Published % B / R / live | Fresh % B / R / live | Held % B / R / live | Gaps % B / R / live |
| --- | ---: | ---: | ---: | ---: |
| 20261015_225219 | 81.00 / 100.00 / 100.00 | 64.00 / 96.00 / 96.00 | 17.00 / 4.00 / 4.00 | 19.00 / 0.00 / 0.00 |
| 20261015_225307 | 73.55 / 74.38 / 74.38 | 52.89 / 46.28 / 46.28 | 20.66 / 28.10 / 28.10 | 26.45 / 25.62 / 25.62 |
| 20261017_084814 | 96.58 / 97.11 / 97.11 | 92.89 / 93.42 / 93.42 | 3.68 / 3.68 / 3.68 | 3.42 / 2.89 / 2.89 |
| 20261017_084919 | 93.10 / 97.81 / 97.81 | 85.58 / 90.60 / 90.60 | 7.52 / 7.21 / 7.21 | 6.90 / 2.19 / 2.19 |
| 20261017_134943 | 95.13 / 96.40 / 96.40 | 85.59 / 85.17 / 85.17 | 9.53 / 11.23 / 11.23 | 4.87 / 3.60 / 3.60 |
| 20261017_135116 | 91.90 / 94.69 / 94.69 | 85.75 / 87.15 / 87.15 | 6.15 / 7.54 / 7.54 | 8.10 / 5.31 / 5.31 |
| 20261018_094055 | 95.17 / 97.70 / 97.70 | 66.21 / 85.52 / 85.52 | 28.97 / 12.18 / 12.18 | 4.83 / 2.30 / 2.30 |
| 20261018_094151 | 78.57 / 96.13 / 96.13 | 67.26 / 84.82 / 84.82 | 11.31 / 11.31 / 11.31 | 21.43 / 3.87 / 3.87 |
| 20261018_160844 | 90.03 / 89.37 / 89.37 | 76.08 / 80.07 / 80.07 | 13.95 / 9.30 / 9.30 | 9.97 / 10.63 / 10.63 |
| 20261018_160931 | 96.92 / 90.75 / 90.75 | 91.44 / 80.82 / 80.82 | 5.48 / 9.93 / 9.93 | 3.08 / 9.25 / 9.25 |
| 20261024_124006 | 93.96 / 92.84 / 92.84 | 86.58 / 76.06 / 76.06 | 7.38 / 16.78 / 16.78 | 6.04 / 7.16 / 7.16 |
| 20261025_130022 | 93.25 / 94.75 / 94.75 | 77.00 / 78.25 / 78.25 | 16.25 / 16.50 / 16.50 | 6.75 / 5.25 / 5.25 |

| Clip | Median bar B / R / live | Within 0.3 B / R / live | Worst signed bar B / R / live | >1 bar % B / R / live | False 10 B / R / live |
| --- | ---: | ---: | ---: | ---: | ---: |
| 20261015_225219 | 0.002 / 0.043 / 0.043 | 1/1 / 1/1 / 1/1 | 0.002 / 0.043 / 0.043 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261015_225307 | — / — / — | 0/0 / 0/0 / 0/0 | — / — / — | — / — / — | 0 / 0 / 0 |
| 20261017_084814 | 0.138 / 0.138 / 0.138 | 3/4 / 4/5 / 4/5 | -0.302 / -0.361 / -0.361 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261017_084919 | 0.009 / 0.058 / 0.058 | 3/3 / 3/3 / 3/3 | 0.136 / 0.154 / 0.154 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261017_134943 | 0.098 / 0.168 / 0.168 | 4/5 / 5/5 / 5/5 | 0.625 / -0.274 / -0.274 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261017_135116 | 0.010 / 0.044 / 0.044 | 3/3 / 3/3 / 3/3 | -0.031 / -0.060 / -0.060 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261018_094055 | 5.348 / 0.349 / 0.349 | 0/3 / 0/3 / 0/3 | -5.946 / 0.904 / 0.904 | 66.67 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261018_094151 | 0.152 / 0.200 / 0.200 | 3/3 / 3/3 / 3/3 | 0.184 / 0.268 / 0.268 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261018_160844 | 0.115 / 0.183 / 0.183 | 3/4 / 4/4 / 4/4 | 0.416 / -0.224 / -0.224 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261018_160931 | 0.032 / 0.112 / 0.112 | 3/3 / 2/3 / 2/3 | 0.278 / 0.307 / 0.307 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261024_124006 | 0.079 / 0.113 / 0.113 | 12/12 / 11/11 / 11/11 | 0.231 / 0.223 / 0.223 | 0.00 / 0.00 / 0.00 | 0 / 0 / 0 |
| 20261025_130022 | 0.128 / 0.091 / 0.091 | 10/13 / 11/12 / 11/12 | 1.077 / 0.397 / 0.397 | 7.69 / 0.00 / 0.00 | 0 / 0 / 0 |

## Integration

- Nonlegacy measurement and recovery use the shared bounded-offset pointer reader and hub-to-observed-tip ray. Ambiguous geometric direction yields no candidate; template correlation cannot bypass the shared verification. The legacy path is retained.
- Only a geometrically verified ray on the calibrated domain, passing existing endpoint checks, updates the needle hint. Only a valid pressure can update last-good pressure. Duplicate pixels explicitly clear pointerVerified. Existing450ms hold/gap publisher and saved fresh/held separation remain.
- Same-frame model corroboration uses the verified pointer ray and the existing5-degree agreement band, so unverified template recovery cannot certify model pressure. No model weights/confidence threshold or calibration changes.
- Calibration taps/zero, registration implementation, endpoint guard and pressure thresholds/frozen config are unchanged. No scoring/exam/label/fixture edits, retraining, schema/data/auth/privacy/version/dependency changes.

## Validation

- Targeted reader/geometry/endpoint/publisher tests: **54 passed /54**. New state regression checks verified updates, duplicate invalidation and ambiguous candidates preserving prior hint/last-good pressure. Existing pivot-error and symmetric-shaft tests remain unchanged.
- npm run test:vitest: **452 passed, 2 failed, 1 skipped (455)**; files85 passed/3 failed/1 skipped (89). Only documented Python-dependent gaugeProfile/needleRectify and missing box-only temporalReplay fixture failures. No other failures.
- npm run build: **passed**, PWA service worker generated; existing large-chunk warnings remain.
- Exact requested unchanged live exam command ran **once**: node --import ./scripts/needle-reader/out/exam-observer.mjs scripts/needle-reader/exam.mjs --live. The existing read-only observer captures result values/provenance; it changes no argument or returned pressure. Report counts/medians/false-ten splits were checked against official output. Timing under the observer is not a performance benchmark.
- Prior official outputs and preintegration checkpoint preserved under ignored out/wrong-ray-before-production. Raw logs: out/wrong-ray-integration-targeted.txt, -full-tests.txt, -build.txt, -exam.txt and -progress.txt. Runtime file hashes recorded before exam and verified before final commit.

## Risks and stop

No phone/hardware-camera latency benchmark was performed. The fitter scans multiple directions/offsets and its mobile CPU cost remains unverified. The unchanged exam private ONNX sampler provides legacy/unregistered metadata, so its nonlegacy published pressure primarily tests the pointer path; the live asynchronous model-corroboration path has not been newly exercised in-browser. Calibration consistency, including094055’s inherited zero, remains a residual accuracy limitation.

New code: tapCalibrate.js integration/diagnostics, shotLabR7Needle.js corroboration, pointerEvidence.js production use, and reader state tests. Documentation/report/handover updated. No merge, main push or deployment. Stop here for review.
