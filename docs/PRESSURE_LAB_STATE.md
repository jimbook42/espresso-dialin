# Pressure lab: resumable state (updated 2026-10-22 10:35 NZT)

- Branch: `cursor/6-40-pressure-rectify` (worktree `/workspace/cursor-dialin-6.39`).
- Step 1 refinement: upright Flair 58 face geometry from owner reference photos in `docs/reference/`.

## Reference measurement (offline)

Script: `scripts/pressure-replay/measure-design-dial.py` (scaled search, optional multi-photo argv, white-background product fallback).

**Primary source:** `docs/reference/flair58-face-phone.jpg` (oblique phone; hub/needle locked).

| Quantity | Absolute (0° = right, CW) | Relative to zero pin |
| --- | ---: | ---: |
| Zero stop pin | 145.0° | 0° |
| Numeral 5 (glyph) | 216.7° | 71.7° (design 85°) |
| Numeral 10 (glyph) | 315.1° | 170.1° (design 170°) |
| Espresso block | 225°–310° | 80°–165° |
| STOP wedge | 61°–94° | 276°–309° |
| Flair logo centroid | 128.0° | 343.0° |
| Registration pins (right) | 321.5°, 355.5° | 176.5°, 210.5° @ r≈0.75, 0.83 |
| Red band (face radius) | — | inner 0.437, outer 0.78 |
| Dark stop band | — | inner 0.719, outer 0.94 |

**Secondary:** `docs/reference/flair58-face-product.png` — studio white field; circle/hub search is unreliable on this crop (product-only fallback often locks to the frame edge). Use for visual upright layout only; phone photo drives numbers.

Printed scale unchanged: **0–10 bar over 170°** clockwise from the stop pin (`FLAIR_58_SCALE.sweepDeg`).

## Template / profile updates (this pass)

- `dialFaceTemplate.js`: `CANONICAL_ZERO_BAR_ANGLE_DEG` **47 → 145** (old value matched a rotated design capture, not upright lower-left zero). Updated `ESPRESSO_SECTOR`, `STOP_SECTOR`, band fractions, `FLAIR_LOGO_ANGLE_DEG`, `REGISTRATION_PINS`.
- `canonicalDial.js`: face prior bumps for logo + right-side pins (step-1 profile).
- `measure-design-dial.py`: image-size-scaled search, relative-to-zero JSON, band fractions, logo/pins, CLI multi-photo.
- `pressureCv.vitest.js`: synthetic dial paints optional registration marks; zero needle omits short tail (tail at ~325° was winning over pointer at ~145°); tests adjusted for new zero angle.

## Tests

`/workspace/bin/box-test-slot --build npm run test:vitest -- src/flairPressureLab/pressureCv.vitest.js scripts/pressure-replay/syntheticLayout.vitest.js` — **45/45 passed**.

## Next

- Step 2: refine 72-bin profile (per task plan).
- Score dry + synthetic clips; held-out real-shot exam still out of scope for Cursor.

## Rules (unchanged)

- No overfitting: geometry from detection or `dialFaceTemplate.js` / `measure-design-dial.py`; no frame upload/cache; ~1 s hold then gap; bench/synthetic clips only; tests via `box-test-slot --build`.
