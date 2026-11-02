# Label batch 2026-11-02 versus v4.13.27

Analysis only. Reader: `a860912` (v4.13.27); immutable label source: `data/labels-2026-11-02` at `41f685b`. No reader, exam, scoring, configuration, model or label edits. This deliberately selected hard-case batch is not a population accuracy estimate.

Recommend **B (needle tracking)** first, then **A (confirmed session zero through countdown)**, then **C (tip precision)**. Of 52 unique frames, 39 are fresh, 8 held and 5 gaps. Four gaps and all eight holds have needle-missing reasons; one gap is pose-lost. This is an opportunity count, not a promised recovery rate.

## Method and limits

- Use only `labels-orig.json.frames[id].orig`, checked against all 310 manifest coordinate conversions (within 0.051 source px). These are upright pixels. Cropped JPEGs are display references, not runtime inputs.
- Source dimensions are checked against replay dimensions. b012’s labelled source is 2160×3840, while its local exam MP4 is 720×1280 upright: reader points are multiplied by 3 for native-pixel comparisons. Angles and bar do not change under this uniform scale. Every row retains sourceScale.
- Replay source MP4s chronologically at 8 Hz, using unchanged tap reader and publisher. Existing exam full-frame streams come from the one required exam run. The two hand-exam clips are additionally replayed at full upright size using the same taps translated by +280 y from the exam square crop. They are a different evaluation view, not a repeat exam.
- Four new clips have no usable saved taps. Calibrate at their first labelled rest/used_1 frame using that frame’s hub/5/10 only. Zero is detected by the existing calibration code. This is favourable calibration input and is disclosed separately; calibration frames are not independent validation of hub/scale placement. That fixed calibration is supplied before replay, which starts at 0 as in the exam. This protocol does not simulate obtaining taps live or validate countdown timing.
- Nearest stream sample within 80 ms, matching exam/eval practice. New-shot label times are not generally on the 125 ms grid; per-row time difference is in JSON. This temporal mismatch can matter during fast ramps.
- Label bar uses piecewise hand 0/5/10. A pin centre is not the resting needle centreline: add the median signed pin→rest-shaft angle from unique phase-tagged rest frames in OTHER clips (leave one clip out), following eval-calibrated’s approach. Keep all tagged rest taps in that robust estimate; no outlier removal. The median offset is about 6°, but tagged rest samples include b030 at 27.23° and b039 at 16.01°. Their tips show pressure above rest: phase names must not override geometry. Primary truth is geometric on EVERY frame; the old evaluator’s phase-assumed-zero and pin-only bars are retained as sensitivity fields. No fit against reader errors and no per-clip tuning.
- This is an analysis truth convention, not a new zero policy. The agreed product policy remains one session zero with the existing “Does the gauge read 0 at rest?” confirmation as evidence, trusting user taps. Return-rest labels can describe imperfect return; inspect geometric values before treating them as an exact zero.
- Fresh/held/gap comes from publisher flags, not equality of successive values. Held age is elapsed time since last fresh observation, not last rendered value. Gaps have no invented pressure.
- Tip location is reconstructed from the last resolved shaft sample, including transverse offset. It is a sampled endpoint, not a subpixel physical endpoint. Both full endpoint distance and angle-only chord error at labelled radius are reported. Missing/ambiguous pointers remain missing. Tip bar error uses the labelled hub/scale, separating geometry from reader scale as far as possible.
- Zero-only error uses reader zero against the labelled needle and labelled 5/10. It isolates a geometric bias; subtracting it from a held/published bar is only a diagnostic, not a measured improvement. Perspective, hub error, scale differences and temporal staleness prevent an exact causal decomposition.

## Coverage, errors and holds

| Set | N | Fresh | Held | Gap | Shown % | Median \|bar error\| | ≤0.3 bar |
| --- | --- | --- | --- | --- | --- | --- | --- |
| All labels | 62 | 46 | 9 | 7 | 88.71 | 0.116 | 45/55 |
| Unique source frames | 52 | 39 | 8 | 5 | 90.38 | 0.114 | 39/47 |
| Existing unique | 20 | 12 | 4 | 4 | 80.00 | 0.165 | 9/16 |
| New unique | 32 | 27 | 4 | 1 | 96.88 | 0.094 | 30/31 |

Unique held ages: median 125 ms, maximum 375 ms. These selected-frame counts differ from time-weighted stream coverage. All 62 rows are kept; use 52 unique rows for inference.

| Clip | Replay calibration | Frames | Fresh | Held | Gaps | Shown % | Max hold ms | Fresh Δ² RMS bar |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 20261015_225307 | existing exam sidecar taps | 121 | 56 | 34 | 31 | 74.38 | 375 | 0.0439 |
| 20261017_084814 | existing exam sidecar taps | 380 | 355 | 14 | 11 | 97.11 | 375 | 0.1148 |
| 20261017_134943 | existing exam sidecar taps | 472 | 402 | 53 | 17 | 96.40 | 375 | 0.1335 |
| 20261018_094055 | existing exam sidecar taps | 435 | 372 | 53 | 10 | 97.70 | 375 | 0.0966 |
| 20261018_160844 | existing exam sidecar taps | 301 | 241 | 28 | 32 | 89.37 | 375 | 0.1609 |
| 20261018_160931 | existing exam sidecar taps | 292 | 236 | 29 | 27 | 90.75 | 375 | 0.1510 |
| 20261025_130022 | exam hand taps translated from square crop (+280 y) | 400 | 313 | 66 | 21 | 94.75 | 375 | 0.1172 |
| 20261024_124006 | exam hand taps translated from square crop (+280 y) | 447 | 340 | 75 | 32 | 92.84 | 375 | 0.1264 |
| lab-replay-9801a937-8390-4ad9-ac95-b71e4016ccb1 | first labelled rest hub/5/10; zero remains detected | 311 | 267 | 30 | 14 | 95.50 | 375 | 0.1669 |
| lab-replay-e146d592-042d-4359-ad66-a4d4b4c5940f | first labelled rest hub/5/10; zero remains detected | 319 | 300 | 15 | 4 | 98.75 | 375 | 0.1180 |
| lab-replay-f62a5256 | first labelled rest hub/5/10; zero remains detected | 298 | 279 | 10 | 9 | 96.98 | 375 | 0.1235 |
| 20261024_124140 | first labelled rest hub/5/10; zero remains detected | 309 | 263 | 39 | 7 | 97.73 | 375 | 0.1728 |

Fresh Δ² RMS uses only three adjacent fresh stream samples, with no bridging gaps. It contains true pressure acceleration as well as noise; sparse hand labels cannot establish a ground-truth smoothness score. Gap-run start/end/duration are in JSON.

## Zero angle and isolated zero contribution

Angles below are signed reader minus hand pin/rest direction in the matched source frame, so they account for moving gauge orientation. Calibration zero is in the initial calibration frame and should not be directly subtracted from a later source angle. The table reports medians; every row’s absolute angles and bar contribution are in JSON.

| Clip | Calibration zero ° | LOCO pin→rest ° | Reader−pin ° | Reader−rest ° | Zero-only signed bar | Zero-only \|bar\| median | Rest labels |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 20261015_225307 | 325.45 | 6.32 | 4.06 | -2.26 | 0.156 | 0.156 | b012 |
| 20261017_084814 | 236.42 | 5.76 | 5.12 | -0.64 | -0.006 | 0.006 | b016 |
| 20261017_134943 | 322.07 | 6.00 | 0.45 | -5.55 | 0.000 | 0.000 | none |
| 20261018_094055 | 278.75 | 6.32 | -39.85 | -46.17 | 1.121 | 1.121 | b007 |
| 20261018_160844 | 238.12 | 5.76 | 4.23 | -1.53 | 0.078 | 0.078 | b011 |
| 20261018_160931 | 230.68 | 6.00 | -3.99 | -9.99 | 0.119 | 0.119 | none |
| 20261025_130022 | 318.03 | 5.76 | 2.34 | -3.42 | 0.097 | 0.097 | b010 |
| 20261024_124006 | 140.75 | 6.00 | 5.16 | -0.84 | 0.000 | 0.000 | none |
| lab-replay-9801a937-8390-4ad9-ac95-b71e4016ccb1 | 315.02 | 6.07 | 0.64 | -5.42 | 0.068 | 0.068 | b021, b022, b028 |
| lab-replay-e146d592-042d-4359-ad66-a4d4b4c5940f | 318.45 | 5.76 | 3.35 | -2.41 | 0.014 | 0.047 | b029, b030, b037 |
| lab-replay-f62a5256 | 314.82 | 6.32 | 0.21 | -6.11 | 0.167 | 0.167 | b038, b039, b046 |
| 20261024_124140 | 318.82 | 6.32 | 3.37 | -2.96 | 0.038 | 0.038 | b047 |

Across unique rows, median |zero-only bias| = 0.067 bar. On shown rows, subtracting that diagnostic contribution changes median |error| from 0.114 to 0.137 bar. It does not recover a missing observation and is not a prospective result.

Do not assign all error to A/B/C. At b006 (094055 @40s), reader−label is −0.686 bar, while tip-only error is −0.040 bar and zero-only bias is 0 on the piecewise >5 bar segment. Existing 5/10 calibration/pose mapping differs from this batch’s labels; neither zero nor tip precision alone explains that residual. At b004 @19s, −0.737 bar includes a 125 ms hold and the same scale discrepancy. The older exam’s −0.318/−0.349 errors use different labels/truth, not contradictory reader outputs. Reader bars stay 5.655 and 5.056. Keep calibration/pose provenance in the first ticket’s diagnostics.

## Tip precision and repeat noise

Unique resolved tip samples: n=45; median endpoint distance 3.69 source px (p90 15.49, worst 135.79); median angle-only chord 2.34 source px; median |tip geometry bar error| 0.091 bar (p90 0.226, n=43). Resolved tips outside the hand scale (b005, b013) have no valid bar error and are explicitly excluded only from that bar statistic; their large pixel errors remain. These conditional metrics exclude gaps without a resolved tip; they cannot show that tip precision alone fixes those gaps.

| Repeat | Hub source px | Tip source px | Hub display px | Tip display px | Needle Δ° | Geometric Δbar |
| --- | --- | --- | --- | --- | --- | --- |
| b003/b036 | 2.69 | 0.60 | 8.25 | 2.00 | 0.11 | 0.090 |
| b005/b044 | 3.38 | 2.33 | 8.60 | 5.83 | 3.38 | 0.136 |
| b025/b050 | 1.70 | 8.61 | 5.00 | 25.32 | 5.30 | 0.017 |
| b038/b051 | 0.76 | 2.38 | 2.24 | 7.62 | 2.81 | 0.175 |
| b043/b054 | 0.60 | 4.59 | 2.00 | 14.56 | 2.15 | 0.167 |
| b027/b055 | 1.92 | 3.18 | 6.08 | 9.85 | 1.08 | 0.048 |
| b011/b058 | 1.22 | 0.70 | 3.61 | 2.00 | 0.72 | 0.046 |
| b042/b060 | 2.24 | 4.04 | 6.71 | 12.17 | 2.32 | 0.047 |
| b008/b061 | 0.40 | 1.14 | 1.00 | 3.16 | 0.58 | 0.051 |
| b052/b062 | 1.73 | 2.89 | 5.10 | 8.25 | 2.28 | 0.041 |

Repeat medians: hub 1.71 / tip 2.63 upright source px; hub 5.05 / tip 7.93 display px; |Δbar| 0.050 (p90 0.167, max 0.175). These are paired retap disagreement, not standard deviation or a guaranteed lower bound. The approximate 3/9 px context describes zoomed display pixels; do not compare it directly with native source px.

## Per-frame results

Error = reader − label bar. Px are upright source pixels. Z bias is the zero-only diagnostic; tip Δbar compares the reconstructed tip with the label in the hand scale. Held readings do not have a fresh tip unless current image evidence resolves one. Full angles, matching times, raw observations and repeat markers are in JSON.

| ID | Clip | t s | Label | Reader | Error | State / reason | Age ms | Z bias bar | Tip px | Tip Δbar |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| b001 | 20261018_094055 | 10.875 | 1.525 | 2.347 | 0.822 | fresh: tap-fresh | — | 1.365 | 2.86 | -0.013 |
| b002 | 20261018_094055 | 11.000 | 1.583 | 2.291 | 0.708 | fresh: tap-fresh | — | 1.260 | 3.76 | -0.141 |
| b003 | 20261018_094055 | 11.125 | 1.766 | 2.324 | 0.558 | fresh: tap-fresh | — | 1.121 | 3.29 | -0.040 |
| b004 | 20261018_094055 | 19.000 | 6.392 | 5.655 | -0.737 | held: held:needle-missing | 125 | 0.000 | — | — |
| b005 | 20261018_094055 | 22.000 | 7.325 | — | — | gap: needle-missing | — | 0.000 | 129.83 | — |
| b006 | 20261018_094055 | 40.000 | 5.742 | 5.056 | -0.686 | fresh: tap-fresh | — | 0.000 | 0.98 | -0.040 |
| b007 | 20261018_094055 | 2.700 | -0.148 | — | — | gap: pose-lost | — | 1.962 | — | — |
| b008 | 20261017_084814 | 22.000 | 7.691 | 7.252 | -0.438 | fresh: tap-fresh | — | 0.000 | 1.33 | 0.037 |
| b009 | 20261018_160931 | 18.231 | 4.049 | 4.052 | 0.003 | fresh: tap-fresh | — | 0.119 | 0.12 | 0.002 |
| b010 | 20261025_130022 | 49.375 | 0.170 | 0.105 | -0.064 | fresh: tap-fresh | — | 0.194 | 4.17 | -0.242 |
| b011 | 20261018_160844 | 2.700 | 0.085 | — | — | gap: needle-missing | — | 0.068 | 2.98 | -0.157 |
| b012 | 20261015_225307 | 7.581 | -0.196 | — | — | gap: needle-missing | — | 0.156 | 3.28 | -0.051 |
| b013 | 20261017_134943 | 48.500 | 6.391 | 6.025 | -0.366 | held: held:needle-missing | 125 | 0.000 | 135.79 | — |
| b014 | 20261024_124006 | 33.375 | 7.279 | 7.155 | -0.124 | held: held:needle-missing | 375 | 0.000 | — | — |
| b015 | 20261025_130022 | 37.000 | 6.509 | 6.395 | -0.114 | held: held:needle-missing | 375 | 0.000 | — | — |
| b016 | 20261017_084814 | 1.800 | 0.058 | 0.035 | -0.023 | fresh: tap-fresh | — | -0.011 | 2.94 | -0.109 |
| b017 | 20261018_160844 | 8.750 | 1.708 | 1.501 | -0.207 | fresh: tap-fresh | — | 0.091 | 4.71 | -0.242 |
| b018 | 20261018_160844 | 8.875 | 1.580 | 1.503 | -0.077 | fresh: tap-fresh | — | 0.048 | 2.75 | -0.151 |
| b019 | 20261018_160844 | 9.000 | 1.597 | 1.503 | -0.094 | fresh: tap-fresh | — | 0.089 | 3.55 | -0.195 |
| b020 | 20261024_124006 | 30.375 | 5.179 | 5.232 | 0.053 | fresh: tap-fresh | — | 0.000 | 15.44 | -0.045 |
| b021 | lab-replay-9801a937-8390-4ad9-ac95-b71e4016ccb1 | 0.233 | 0.102 | 0.058 | -0.045 | fresh: tap-fresh | — | 0.045 | 2.06 | -0.091 |
| b022 | lab-replay-9801a937-8390-4ad9-ac95-b71e4016ccb1 | 0.503 | -0.004 | 0.014 | 0.018 | fresh: tap-fresh | — | 0.022 | 3.84 | 0.089 |
| b023 | lab-replay-9801a937-8390-4ad9-ac95-b71e4016ccb1 | 11.294 | 2.552 | 2.383 | -0.169 | fresh: tap-fresh | — | 0.171 | 6.68 | -0.203 |
| b024 | lab-replay-9801a937-8390-4ad9-ac95-b71e4016ccb1 | 11.705 | 3.568 | 3.749 | 0.181 | fresh: tap-fresh | — | 0.125 | 4.14 | 0.132 |
| b025 | lab-replay-9801a937-8390-4ad9-ac95-b71e4016ccb1 | 13.696 | 5.298 | 5.150 | -0.147 | held: held:needle-missing | 375 | 0.000 | — | — |
| b026 | lab-replay-9801a937-8390-4ad9-ac95-b71e4016ccb1 | 16.765 | 6.771 | — | — | gap: needle-missing | — | 0.000 | — | — |
| b027 | lab-replay-9801a937-8390-4ad9-ac95-b71e4016ccb1 | 36.361 | 3.634 | 3.543 | -0.091 | fresh: tap-fresh | — | 0.091 | 3.79 | -0.097 |
| b028 | lab-replay-9801a937-8390-4ad9-ac95-b71e4016ccb1 | 37.826 | -0.034 | 0.019 | 0.053 | held: held:needle-missing | 125 | 0.203 | 6.17 | -0.298 |
| b029 | lab-replay-e146d592-042d-4359-ad66-a4d4b4c5940f | 1.000 | -0.017 | 0.044 | 0.061 | fresh: tap-fresh | — | 0.137 | 1.66 | -0.097 |
| b030 | lab-replay-e146d592-042d-4359-ad66-a4d4b4c5940f | 3.660 | 1.357 | 1.441 | 0.085 | fresh: tap-fresh | — | 0.131 | 4.27 | -0.001 |
| b031 | lab-replay-e146d592-042d-4359-ad66-a4d4b4c5940f | 4.318 | 1.790 | 1.761 | -0.030 | fresh: tap-fresh | — | 0.027 | 5.14 | -0.049 |
| b032 | lab-replay-e146d592-042d-4359-ad66-a4d4b4c5940f | 13.959 | 4.992 | 5.170 | 0.178 | fresh: tap-fresh | — | 0.000 | 17.77 | 0.218 |
| b033 | lab-replay-e146d592-042d-4359-ad66-a4d4b4c5940f | 14.494 | 5.739 | 5.777 | 0.038 | fresh: tap-fresh | — | 0.000 | 10.06 | -0.011 |
| b034 | lab-replay-e146d592-042d-4359-ad66-a4d4b4c5940f | 17.155 | 6.579 | 6.715 | 0.137 | fresh: tap-fresh | — | 0.000 | 25.18 | -0.017 |
| b035 | lab-replay-e146d592-042d-4359-ad66-a4d4b4c5940f | 33.042 | 3.724 | 3.780 | 0.056 | fresh: tap-fresh | — | 0.066 | 1.61 | -0.076 |
| b036 (↔b003) | 20261018_094055 | 11.125 | 1.676 | 2.324 | 0.647 | fresh: tap-fresh | — | 1.234 | 3.89 | -0.049 |
| b037 | lab-replay-e146d592-042d-4359-ad66-a4d4b4c5940f | 37.000 | 0.211 | 0.074 | -0.136 | fresh: tap-fresh | — | -0.079 | 2.04 | -0.080 |
| b038 | lab-replay-f62a5256 | 0.577 | -0.073 | 0.003 | 0.077 | fresh: tap-fresh | — | 0.162 | 7.63 | 0.223 |
| b039 | lab-replay-f62a5256 | 3.772 | 0.641 | 0.766 | 0.124 | fresh: tap-fresh | — | 0.269 | 5.18 | -0.163 |
| b040 | lab-replay-f62a5256 | 3.917 | 0.492 | 0.723 | 0.232 | fresh: tap-fresh | — | 0.410 | 2.23 | -0.056 |
| b041 | lab-replay-f62a5256 | 14.176 | 3.359 | 3.225 | -0.134 | fresh: tap-fresh | — | 0.086 | 3.93 | -0.226 |
| b042 | lab-replay-f62a5256 | 15.771 | 5.675 | 5.686 | 0.011 | fresh: tap-fresh | — | 0.000 | 8.12 | 0.089 |
| b043 | lab-replay-f62a5256 | 20.837 | 7.015 | 7.006 | -0.009 | fresh: tap-fresh | — | 0.000 | 13.14 | -0.080 |
| b044 (↔b005) | 20261018_094055 | 22.000 | 7.461 | — | — | gap: needle-missing | — | 0.000 | 128.65 | — |
| b045 | lab-replay-f62a5256 | 32.691 | 2.983 | 3.145 | 0.162 | fresh: tap-fresh | — | 0.171 | 1.40 | 0.086 |
| b046 | lab-replay-f62a5256 | 34.442 | -0.059 | 0.018 | 0.077 | fresh: tap-fresh | — | 0.260 | 15.52 | 0.766 |
| b047 | 20261024_124140 | 1.000 | -0.212 | 0.084 | 0.296 | fresh: tap-fresh | — | 0.393 | 3.69 | -0.112 |
| b048 | 20261024_124140 | 5.000 | -0.012 | 0.104 | 0.116 | held: held:needle-missing | 125 | 0.015 | 3.36 | -0.060 |
| b049 | 20261024_124140 | 9.000 | 3.741 | 3.589 | -0.152 | fresh: tap-fresh | — | 0.056 | 0.60 | -0.032 |
| b050 (↔b025) | lab-replay-9801a937-8390-4ad9-ac95-b71e4016ccb1 | 13.696 | 5.281 | 5.150 | -0.130 | held: held:needle-missing | 375 | 0.000 | — | — |
| b051 (↔b038) | lab-replay-f62a5256 | 0.577 | 0.102 | 0.003 | -0.098 | fresh: tap-fresh | — | 0.163 | 6.05 | 0.106 |
| b052 | 20261024_124140 | 13.000 | 8.716 | 8.814 | 0.098 | fresh: tap-fresh | — | 0.000 | 3.15 | 0.113 |
| b053 | 20261024_124140 | 18.000 | 7.095 | 7.447 | 0.352 | held: held:needle-missing | 125 | 0.000 | — | — |
| b054 (↔b043) | lab-replay-f62a5256 | 20.837 | 6.849 | 7.006 | 0.158 | fresh: tap-fresh | — | 0.000 | 9.49 | 0.072 |
| b055 (↔b027) | lab-replay-9801a937-8390-4ad9-ac95-b71e4016ccb1 | 36.361 | 3.586 | 3.543 | -0.043 | fresh: tap-fresh | — | 0.106 | 1.24 | -0.069 |
| b056 | 20261024_124140 | 23.000 | 0.007 | 0.010 | 0.002 | fresh: tap-fresh | — | 0.019 | 3.56 | -0.074 |
| b057 | 20261024_124140 | 28.000 | 0.571 | 0.478 | -0.094 | fresh: tap-fresh | — | 0.154 | 3.11 | -0.172 |
| b058 (↔b011) | 20261018_160844 | 2.700 | 0.038 | — | — | gap: needle-missing | — | 0.070 | 2.49 | -0.139 |
| b059 | 20261024_124140 | 34.500 | 0.684 | 0.636 | -0.048 | fresh: tap-fresh | — | 0.209 | 3.56 | -0.163 |
| b060 (↔b042) | lab-replay-f62a5256 | 15.771 | 5.722 | 5.686 | -0.036 | fresh: tap-fresh | — | 0.000 | 6.11 | -0.104 |
| b061 (↔b008) | 20261017_084814 | 22.000 | 7.639 | 7.252 | -0.387 | fresh: tap-fresh | — | 0.000 | 2.32 | 0.086 |
| b062 (↔b052) | 20261024_124140 | 13.000 | 8.675 | 8.814 | 0.139 | fresh: tap-fresh | — | 0.000 | 3.73 | 0.169 |

## Ranked next fixes: B → A → C

Ranked for the stated goal of fewer gaps and smoother curves, not just single-frame median. Expected gains below are directions and observed opportunity ceilings, not fitted or measured improvements. They are not additive. There is no implementation/retraining experiment in this analysis.

### 1. B: Needle tracking across frames

- Gaps: Largest direct opportunity: four needle-missing gaps / 52 unique frames; at most +7.69 coverage percentage points if all four are recovered. One pose-lost gap is outside this bound.
- Smoothness: Eight held + four missing observations are candidates for genuine fresh evidence: at most 12/52 = 23.08 percentage points of freshness. Avoid plateau/lag then catch-up jumps. No numeric jitter improvement established.
- Median: Likely helps held-error tail more than median; eight held samples, maximum age 375 ms. A new quantitative median cannot be predicted from sparse labels.
- Risk: Medium/high: wrong-end identity, drift onto print or bezel, false certainty across occlusion. Prediction must never become measured pressure.
- First ticket: Add a behind-flag image-evidence tracker in registered dial coordinates; propagate prior tip/shaft and seek current-frame support, keep shaft-end identity, expire when support disappears. Preserve fresh/held/gap semantics and hold timeout. Run temporal clips, this frozen batch and one exam; no interpolation or relaxed safety gates.

### 2. A: Continuous session zero through countdown until pressure onset

- Gaps: No demonstrated direct recovery of these five gaps: a scale offset does not supply a missing pointer or pose.
- Smoothness: Improves common baseline consistency; must freeze before first pressure movement. It cannot remove mid-shot needle gaps or smooth jitter by itself.
- Median: Not demonstrated: median isolated zero bias 0.067 bar; diagnostic subtraction changes shown median 0.114 to 0.137 (worse). Some early 094055 frames have large zero error; benefits are clip- and range-specific, not additive to other fixes.
- Risk: Medium: early pressurisation may be erased as zero. b030/b039 tagged rest are geometrically above rest, so phase name/countdown time is not rest evidence. Session confirmation and fresh image stability must govern eligibility; trust taps and freeze zero at onset.
- First ticket: Collect confirmed-rest observations through the 3-2-1 countdown, estimate one robust session zero with uncertainty, then freeze at onset. Keep user 5/10 taps fixed. Add onset/false-rest/occlusion acceptance cases; no mid-shot rezero.

### 3. C: Tip geometric precision

- Gaps: No demonstrated coverage gain from subpixel refinement alone. Off-scale/wrong-end cases need identity/evidence recovery, not endpoint polishing.
- Smoothness: Potential smaller reduction in fresh-sample jitter; current angular chord median 2.34 source px is close to repeat tip disagreement 2.63 source px. Physical endpoint length errors inflate full-distance metrics.
- Median: Conditional tip geometry median |error| 0.091 bar versus repeat geometric disagreement 0.050 bar. These are different sample sets; subtracting them is not a forecast. A few hundredths bar may be worth testing, but no measured whole-reader median gain is established.
- Risk: Low/medium for refinement of a verified shaft; high if tuned on these 52 frames. Hub/tap noise and perspective can dominate. Avoid optimising the tip sample length when angular pressure is already correct.
- First ticket: Refine the centreline-to-pivot ray only after shaft identity is verified; report angular and transverse residuals independently of tip extent. Validate on held-out clips and repeats before touching acceptance thresholds.

Specific B evidence: b004/b013/b014/b015/b025/b028/b048/b053 are held; b005/b011/b012/b026 are needle-missing gaps. b007 is pose-lost. Resolved wrong-end rays at b005 and b013 are about 130–136 source px from the hand tip and off the hand pressure scale; retaining shaft identity is more relevant there than a tiny endpoint refinement. b030/b039 demonstrate why A must stop at actual movement rather than a phase label.

Unverified: prospective gain for any candidate, physical pressure independent of visual taps, dense truth curves and true jitter, live browser/countdown operation, camera/source equivalence for the high-resolution dry label, and generalisation beyond this deliberately selected batch. This analysis cannot certify a new algorithm. B is the recommended first ticket; keep the frozen baseline and labels unchanged.

## Baseline sanity check and validation

Single requested exam command: `node --import ./scripts/needle-reader/out/exam-observer.mjs scripts/needle-reader/exam.mjs --live`. The out preloader imports the checked-in analysis observer. It wraps original functions without altering their calls or returned readings; no exam/score source edits. Exam stream coverage 94.45% (83.24 fresh / 11.21 held / 5.55 gaps), labelled median 0.113 bar, 47/53 within 0.3, worst signed error 0.904 bar at 20261018_094055 @11s, false 10-bar stream count 0. Exam uses its existing older-label truth/display conventions; do not compare its median directly with the new batch metric. The reconstructed hits are validated against the saved exam median and count.

- `npm ci`: passed; existing audit reports 25 vulnerabilities (3 low, 15 moderate, 5 high, 2 critical). No dependency changes.
- `npm run test:vitest`: 452 passed, 2 failed, 1 skipped; files 85 passed, 3 failed, 1 skipped. Failures are exactly the allowed Python loader/rectify tests and Linux-only temporal replay missing raw-frames.json. No other test failures.
- `npm run build`: passed. No production code edits.
- Coordinate checks: 62 complete labels / 310 points; repeats 10; unique frames 52. Real data only; no retraining, pressure interpolation or hand-tuned readings.

## Reproduce

From a clean v4.13.27 analysis worktree (PowerShell):

```powershell
npm ci
git fetch origin data/labels-2026-11-02
git restore --source=41f685b -- scripts/pressure-label/fixtures/batch-2026-11-02
New-Item -ItemType Directory -Force scripts/needle-reader/out | Out-Null
Set-Content scripts/needle-reader/out/exam-observer.mjs "import '../../pressure-label/analysis/exam-observer.mjs';"
node --import ./scripts/needle-reader/out/exam-observer.mjs scripts/needle-reader/exam.mjs --live
node scripts/pressure-label/analysis/replay-batch.mjs
node scripts/pressure-label/analysis/analyze-batch.mjs
```

MP4s remain local under `C:\Users\Isaac\dialin-exam-clips` (or DIALIN_EXAM_CLIPS), including new/ and shot-2026-11-02/. Raw traces are ignored under scripts/needle-reader/out. Fetch the separate label branch for source labels/JPEGs; they are not duplicated in this analysis commit.
