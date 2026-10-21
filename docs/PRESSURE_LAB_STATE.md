# Pressure lab: resumable state (updated 2026-10-22 12:25 NZT)

- Branch: `cursor/6-40-pressure-rectify` (worktree `/workspace/cursor-dialin-6.39`).
- Step 2: rectify an oblique face, then register and read the needle on that circle.

## This pass

- `faceRectify.js`: rim-edge points around the detected circle, `cv.fitEllipse` with residual rejection (glare and occluded rays dropped), `cv.warpAffine` onto a circle the size of the fitted major axis. Ellipse centre, axes, and tilt come from that fit. A nearly round face is not resampled.
- `gaugeTrack.js`: `readRectifiedPressure` runs needle and template registration on the rectified circle. `matchGaugeRotation` refines the best bin with a parabola (sub-degree; the nearest bin does not change). Fine profiles are 360 bins. The unique scale arc publishes the rotation; the tick comb refines it when the comb is actually visible, and a flat comb does not veto the arc. Needle bins stay masked.
- `needleFromFrame.js`: 1° peak plus a parabola, then a half-degree ridge centre on the rectified face.
- `canonicalDial.js`: profile builder takes a bin count. The exported template is still 72 bins.
- Live `completeReading` rectifies before the needle and the colour/template registration when OpenCV is loaded.

## Synthetic oblique frames

Four seeded 1280×720 frames, major axis 150–200 px, aspect 0.6–0.95, random tilt, in-plane rotation that is not a multiple of 5°, glare blob, partial rim occluder. Candidate from the bright-face moments, not the painter. Bar error vs `barToDialAngle` / `angleToBar`:

| Frame | Expected bar | Read | Total ms (rectify / needle / register) |
| --- | ---: | ---: | --- |
| 0 | 5.949 | 5.928 | 38 (13 / 12 / 13) |
| 1 | 8.717 | 8.698 | 17 (3 / 4 / 10) |
| 2 | 1.942 | 1.972 | 15 (2 / 3 / 10) |
| 3 | 1.346 | 1.369 | 21 (4 / 5 / 11) |

Largest absolute error about 0.03 bar.

## Tests

`/workspace/bin/box-test-slot --build npm run test:vitest -- src/flairPressureLab/pressureCv.vitest.js src/flairPressureLab/replayGaugeSemantics.vitest.js scripts/pressure-replay/syntheticLayout.vitest.js scripts/pressure-replay/privacyAssert.vitest.js` — **52/52 passed**.

`node src/flairPressureLab/gaugeConfig.test.js` — passed (same slot, after vitest).

## Next

- Score dry + synthetic clips on the rectified reader. Held-out real-shot exam still out of scope for Cursor.

## Rules (unchanged)

- No overfitting: geometry from detection or `dialFaceTemplate.js` / `measure-design-dial.py`; no frame upload/cache; ~1 s hold then gap; bench/synthetic clips only; tests via `box-test-slot --build`.
