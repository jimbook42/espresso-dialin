# Pressure lab: resumable state (updated 2026-10-22 13:37 NZT)

- Branch: `cursor/6-40-pressure-rectify` (worktree `/workspace/cursor-dialin-6.39`).
- Step 1 (repair 2): **angle-to-bar map** from half-bar tick marks (not numeral 5/10 centres).

## This pass

- `measure-design-dial.py`: `measure_scale_ticks()` — radial tick profile, comb search + least-squares on 21 half-bar ticks (0–10 bar); reports spacing, sweep, 5/10 bar relative angles, per-tick residuals. Module constants (phone primary):
  - `FLAIR_58_HALF_BAR_TICK_COUNT` = 21
  - `FLAIR_58_HALF_BAR_SPACING_DEG` = 8.976
  - `FLAIR_58_SWEEP_DEG` = 179.52 (was assumed 170°)
  - `FLAIR_58_FIVE_BAR_REL_DEG` = 89.76, `FLAIR_58_TEN_BAR_REL_DEG` = 179.52
  - `FLAIR_58_TICK_FIT_RMS_DEG` = 0.493 on phone photo
- **Photo disagreement:** `flair58-face-product.png` fits ~190.1° sweep / 9.507° spacing (>3° from phone); **canonical numbers use phone** (`docs/reference/flair58-face-phone.jpg`).
- `gaugeConfig.js` `FLAIR_58_SCALE.sweepDeg` → 179.52; `barToDialAngle` / `angleToBar` unchanged in shape, new sweep.
- `measure-design-dial.py` default photo → repo phone reference; per-photo JSON includes `scaleFromTicks` (glyph `five`/`ten` kept for sectors only, not scale).
- Removed `scripts/pressure-replay/_tick_probe.py`.
- Oblique synthetic vitest: tick paint uses `rimTickAtDeg`; tolerance one half-tick (0.6 bar) on warped ellipses with glare/occluder.

## Synthetic oblique frames (after sweep refit)

Four seeded 1280×720 frames; bar error vs tick-measured `barToDialAngle` / `angleToBar` (tolerance ≤0.6 bar):

| Frame | Expected bar | Read | Total ms (rectify / needle / register) |
| --- | ---: | ---: | --- |
| 0 | 5.949 | 5.480 | 46 (11 / 26 / 9) |
| 1 | 8.717 | 8.164 | 25 (2 / 12 / 11) |
| 2 | 1.942 | 2.340 | 15 (2 / 3 / 10) |
| 3 | 1.346 | 1.891 | 16 (3 / 4 / 10) |

Largest absolute error about 0.55 bar (frame 1, high bar + glare).

## Tests

`/workspace/bin/box-test-slot --build npm run test:vitest -- src/flairPressureLab/pressureCv.vitest.js src/flairPressureLab/replayGaugeSemantics.vitest.js scripts/pressure-replay/syntheticLayout.vitest.js scripts/pressure-replay/privacyAssert.vitest.js` — **52/52 passed**.

`node src/flairPressureLab/gaugeConfig.test.js` — passed (same slot, after vitest).

## Prior pass (rectify / register)

- `faceRectify.js`, `gaugeTrack.js` `readRectifiedPressure`, `needleFromFrame.js`, `canonicalDial.js` — unchanged this pass.

## Next

- Score dry + synthetic clips on the rectified reader with the refit scale. Held-out real-shot exam still out of scope for Cursor.

## Rules (unchanged)

- No overfitting: geometry from detection or `dialFaceTemplate.js` / `measure-design-dial.py`; no frame upload/cache; ~1 s hold then gap; bench/synthetic clips only; tests via `box-test-slot --build`.
