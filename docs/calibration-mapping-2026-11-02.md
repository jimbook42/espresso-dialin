# Calibration mapping diagnosis — 2026-11-02

The existing 094055 **stored hub/5/10 anchors disagree with this batch's hand geometry before substantial pose motion**. The current calibration preserves those stored points exactly. Registration carries the discrepancy forward; inverse registration and the clockwise piecewise mapping do not account for the large residual above 5 bar.

Per the ticket's instruction for incorrect stored taps, no production repair or anchor override was made. The smaller-error goal is **not achieved**. Zero repair attempts were made. This commit adds reproducible diagnostics and two mapping regression tests. Reader behavior, stored taps, tracking support, safety gates and hold timeout are unchanged.

“Stored anchors” here means the existing exam sidecar's `tapCalibration.anchors`, which contains previously snapped output points. The original unsnapped finger taps are unavailable in these inputs. This diagnosis does not establish that the user's original taps were wrong, nor does it authorize replacing saved anchors with detection or labels.

## Inputs and method

- Reader: `main` at `588ad88`, v4.13.28, tracking enabled by default; new worktree and `fix/calibration-mapping` branch. `npm ci` ran before analysis.
- Frozen labels: `41f685b`; prior report read from `b998bd1`. No label, exam, scoring, frozen config, model or existing analysis-script edits.
- One unchanged exam run, then the six additional full-frame replays and unchanged batch analyzer. Their numerical output reproduces the supplied baseline. The analyzer's generated report has static v4.13.27 metadata/prose; its numerical rows, not that metadata, supply the batch values below.
- New script: `scripts/pressure-label/analysis/calibration-mapping.mjs`. It consumes the observed exam traces and batch analysis, checks that applied hub/5/10 equal sidecar points to 1e-9 px, and writes complete diagnostics to ignored `scripts/needle-reader/out/calibration-mapping.json`. Both diagnosed clips pass that preservation assertion.
- Points are upright source pixels; no second rotation. These two clips have source/replay scale 1. The unchanged batch analyzer handles b012's 3× scale. Batch truth remains piecewise hand 0/5/10 with leave-one-clip-out pin→rest offsets, including imperfect phase-tagged rest frames.

To project a stored point, let `M` be the read's 2×2 pose matrix and `h` its registered hub. The source-space point is `h + M × (point − calibrationHub) × readRadius / (calibrationRadius × sqrt(det(M)))`. The determinant correction removes the radius scaling already returned by registration; applying the matrix without it would scale the anchors twice. This is diagnostic reconstruction of the existing transform, not a reader change.

## Stored versus applied calibration

094055 calibrates at 2.750 s. The closest frozen label, b007 at 2.700 s, is 50 ms earlier; it is not an exact-time calibration truth. At that nearby frame:

| Anchor | Stored / applied point | Label point | Position residual px | Ray residual ° |
| --- | --- | --- | --- | --- |
| Hub | (516.000, 776.000) | (506.2, 774.8) | 9.87 | −7.07 induced needle-ray shift |
| 5 | (540.647, 813.115) | (547.9, 809.8) | 7.97 | +16.40 |
| 10 | (474.865, 803.566) | (482.9, 810.7) | 10.74 | +23.19 |

Here mark-ray residuals compare each calibration's own hub→mark ray. The stored 5→10 sweep is exactly 89.76°, and the stored 5/10 angles are 56.412°/146.172°. Calibration applies those angles and all three points without a coordinate swap, rotation or snap adjustment. New calibration zero is 278.747°, radius 87.413 px. The sidecar's radius/zero were previously measured values; the exam recomputes these from the calibration still, as before.

The near-calibration mismatch is corroborated by every later frozen frame, rather than inferred only from the 50 ms timing difference. The hub remains roughly 8–12 px displaced and the own-hub 5/10 ray offsets remain roughly +17–19°/+19–24° on the unique later 094055 frames. The 10-px positional residuals matter because these stored mark rays are only about 45–50 px long.

## Pose motion and zero

The following matrices are reference-patch→current-patch linear transforms, not source-pixel homographies. Their scale also depends on the rim normalization. Polar rotation and determinant summarize the matrix without confusing a changing normalization with physical gauge scale.

| Time s | Matrix [a,b;c,d] | Polar rotation ° | det | Registered hub | Status |
| --- | --- | --- | --- | --- | --- |
| 2.750 | [0.99544,−0.00158;0.00131,0.99439] | +0.083 | 0.98986 | (515.895,775.981) | lost; retained pose/matrix |
| 19.000 | [0.97805,0.03575;−0.01134,0.97611] | −1.380 | 0.95508 | (485.192,785.458) | 31 inliers, RMS 0.631 patch px |
| 22.000 | [0.97315,0.02869;−0.00057,0.95739] | −0.868 | 0.93170 | (482.626,788.951) | 27 inliers, RMS 0.589 patch px |
| 40.000 | [0.99265,0.03775;−0.01362,0.99940] | −1.477 | 0.99257 | (463.261,792.520) | 25 inliers, RMS 0.438 patch px |

Registration follows real translation and a small rotation/affine change. Compare the own-hub mark-ray residuals, which include the propagated hub discrepancy:

| Frame | 5 residual ° | 10 residual ° |
| --- | --- | --- |
| Near calibration, untransformed stored taps versus b007 | +16.40 | +23.19 |
| b004 @19 | +18.41 | +22.36 |
| b005 @22 | +17.00 | +23.95 |
| b006 @40 | +18.90 | +23.99 |

There is modest additional residual, not a newly accumulated 20° pose rotation. This evidence does not prove perfect registration or bound all its errors, but the dominant scale discrepancy already exists in the stored calibration. An image-based registration change cannot legitimately erase a deliberately preserved user anchor error.

The large zero error is present near calibration too: reader−hand-pin is −39.85° at b007, when the retained matrix is almost identity. At b004/b005/b006 it is −41.01°/−38.91°/−41.19°. A roughly 1.5° pose rotation cannot explain an initial roughly 40° error. This is a separate rest-zero estimate problem, not evidence of a 40° registration drift. It affects the lower piecewise segment; its isolated contribution at b004/b005/b006/b013 remains zero. No zero policy change is made here.

## Per-anchor residuals and isolated pressure contributions

Each cell is **position residual px / angular residual ° / isolated signed bar error**. For a mark's angular residual, both projected and labelled points use the **labelled hub**, separating the mark displacement from the hub's effect. The hub's angle is the change it induces in the labelled needle ray. Signs are projected minus labelled, clockwise positive.

Each pressure counterfactual substitutes only that one projected point into otherwise hand-labelled hub/5/10/tip geometry, retaining the batch's pin→rest convention. These are diagnostics, not published readings, prospective improvements or additive causal shares. Hub substitution recomputes the rays around that hub. Nonlinear interactions and affine inversion prevent summing the columns exactly.

| Frame | Hub px / ° / bar | 5 px / ° / bar | 10 px / ° / bar |
| --- | --- | --- | --- |
| b001 | 9.50 / −3.64 / +0.037 | 10.55 / +10.34 / −0.190 | 11.46 / +14.68 / 0.000 |
| b002 | 8.98 / −1.52 / +0.047 | 10.30 / +9.09 / −0.169 | 10.55 / +13.99 / 0.000 |
| b003 | 8.12 / −3.07 / +0.011 | 11.85 / +12.17 / −0.238 | 9.85 / +12.30 / 0.000 |
| b004 | 10.30 / +6.89 / −0.001 | 11.64 / +10.63 / −0.506 | 10.49 / +13.35 / −0.186 |
| b005 | 10.28 / +8.33 / +0.023 | 11.53 / +8.90 / −0.316 | 12.24 / +15.46 / −0.360 |
| b006 | 11.89 / +7.99 / −0.041 | 9.71 / +8.57 / −0.479 | 12.51 / +15.87 / −0.117 |
| b007 | 9.77 / −6.99 / +0.123 | 8.11 / +8.15 / +0.014 | 10.93 / +14.70 / 0.000 |
| b036, repeat of b003 | 10.66 / −2.99 / +0.047 | 11.04 / +10.40 / −0.205 | 13.34 / +17.50 / 0.000 |
| b044, repeat of b005 | 9.17 / +6.60 / +0.011 | 12.61 / +12.65 / −0.431 | 9.90 / +11.94 / −0.296 |
| b013, 134943 @48.5 | 3.85 / +2.68 / −0.008 | 7.71 / +6.31 / −0.287 | 8.66 / +10.12 / −0.147 |

b007 matches replay 2.750 s and is pose-lost; its diagnostics use the retained pose, not an accepted current observation. All other rows above match their label times exactly. b036 and b044 are repeats, excluded from the unique-52 median. b013 is from 20261017_134943, not 094055; that clip has no frozen label near its 5.5 s calibration, so no initial-error conclusion is claimed for it.

## Piecewise mapping check

The production reader inverse-transforms the measured direction into calibration coordinates and interpolates clockwise 0→5 and 5→10 separately. A direct current-image angular interpolation differs slightly under affine tilt; changing to that interpolation would be a different pressure model, not an angle-wrap correction.

The next table supplies the **labelled tip** to both mappings while retaining the reader hub and calibration. This isolates the scale/pose geometry from tip detection. It does not publish replacement pressure.

| Frame | Label bar | Existing inverse mapping | Current-image angular mapping | Inverse − label |
| --- | --- | --- | --- | --- |
| b004 | 6.392 | 5.712 | 5.694 | −0.679 |
| b005 | 7.325 | 6.708 | 6.672 | −0.616 |
| b006 | 5.742 | 5.095 | 5.093 | −0.647 |
| b013 | 6.391 | 5.999 | 5.976 | −0.393 |

At b006, the full scale discrepancy of −0.647 bar nearly explains the actual −0.686 bar. Choosing direct angular mapping instead changes only −0.0025 bar there. The tip sample is 0.98 px from the label, and its separate hand-scale error is −0.040 bar. At b005, the tracked tip and stored geometry interact; a diagnostic residual must not be presented as the measured gain from a repair.

Added unit tests verify 0/5/10 and both segment midpoints through affine transformation/inversion at four dial rotations, including 360° wrap; the opposite ray is rejected. A second test verifies that changing valid zero anchors cannot change an above-5 result after inverse registration. All ten dial-registration tests pass. There is no demonstrated wrap, direction, or anchor-application defect to repair.

## Before/after and gates

There is no candidate production change. “After” below means the reader is unchanged; no second exam or batch run was performed, and no measured improvement is claimed.

| Metric | Before, measured once | After |
| --- | --- | --- |
| Exam stream coverage | 95.76% | unchanged code; not rerun |
| Exam fresh / held / gaps | 90.76% / 5.00% / 4.24%; 3595 / 198 / 168 of 3961 | not rerun |
| Exam median absolute error | 0.113 bar; unrounded reconstructed 0.112519 | not rerun |
| Exam worst signed error | +0.904 bar, 094055 @11s | not rerun |
| Exam >1 bar | 0% of 56 scored labels | not rerun |
| Exam false 10s | 0 | not rerun |
| Frozen unique batch fresh / held / gap | 47 / 2 / 3 | not rerun |
| Frozen unique batch median absolute error | 0.0939805 bar (0.094 rounded), 49 shown rows | not rerun |

All original numerical gates reproduce at baseline. The improvement gate fails because no repair is justified within the instruction to preserve the stored taps.

| Frame / convention | Label | Before reader | Before error | After |
| --- | --- | --- | --- | --- |
| b001 @10.875, batch | 1.525 | 2.347 | +0.822 | unchanged; not rerun |
| b002 @11, batch | 1.583 | 2.291 | +0.708 | unchanged; not rerun |
| b003 @11.125, batch | 1.766 | 2.324 | +0.558 | unchanged; not rerun |
| @11, older exam truth | 1.387 | 2.291 | +0.904 | unchanged; not rerun |
| b004 @19, batch | 6.392 | 5.756 | −0.636 | unchanged; not rerun |
| b005 @22, batch | 7.325 | 6.933 | −0.391 | unchanged; not rerun |
| b006 @40, batch | 5.742 | 5.056 | −0.686 | unchanged; not rerun |
| b013, 134943 @48.5, batch | 6.391 | 5.969 | −0.422 | unchanged; not rerun |

## Validation and reproduction

- `npm ci`: passed, 503 packages installed; no dependency changes.
- Initial `npm run test:vitest`: 457 passed, 2 failed, 1 skipped; one additional suite cannot load its missing Linux replay fixture.
- Final `npm run test:vitest`, including the two new mapping tests: **459 passed, 2 failed, 1 skipped**; files 86 passed, 3 failed, 1 skipped. Failures are exactly the allowed Python gauge-profile/rectify tests and the Linux-only temporal replay suite. No other failures.
- `npm run build`: 1 successful build, 0 failures. Existing chunk-size warning. No runtime code changed afterward.
- Exam command below: 1 completed run, 0 execution failures; 56 scored labels, 51 within 0.3 bar, 0 over 1 bar; stream counts above.
- `replay-batch.mjs`: 6/6 clips completed, 0 execution failures. `analyze-batch.mjs`: 62/62 complete label rows, 52 unique frames, 0 coordinate-check failures; reconstructed exam evidence agrees with saved results.
- New `calibration-mapping.mjs`: 2/2 clips preserve all three stored points; 10 frame diagnostics emitted, including repeats; 0 assertion failures. `node --check` and `git diff --check` pass.

From the new worktree after `npm ci`, fetch the frozen data branch and materialize its fixture directory read-only, as in the original analysis instructions. Then:

```powershell
New-Item -ItemType Directory -Force scripts/needle-reader/out | Out-Null
Set-Content scripts/needle-reader/out/exam-observer.mjs "import '../../pressure-label/analysis/exam-observer.mjs';"
node --import ./scripts/needle-reader/out/exam-observer.mjs scripts/needle-reader/exam.mjs --live
node scripts/pressure-label/analysis/replay-batch.mjs
node scripts/pressure-label/analysis/analyze-batch.mjs
node scripts/pressure-label/analysis/calibration-mapping.mjs
```

Raw traces, diagnostic JSON, generated original-analysis reports and restored frozen fixtures are local analysis inputs/outputs and are not included in this commit. Existing scripts and frozen labels remain unchanged.

Unverified: exact-time hand geometry at 2.750 s, original unsnapped tap provenance, independent physical pressure, live browser behavior, and perfect registration on unseen views. The sparse labels cannot isolate every affine/perspective interaction. No after-run benefit, merge or deployment is claimed.

Suggested next step: inspect the original unsnapped taps/calibration image against these already-snapped sidecar anchors. If the saved points do not express the user's intended hub/5/10, have the user explicitly correct or confirm their calibration through the normal tap workflow. Diagnose that provenance separately; do not silently substitute label/detector anchors or fit a per-clip correction.
