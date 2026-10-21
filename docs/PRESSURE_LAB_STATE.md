# Pressure lab: resumable state (updated 2026-10-22 10:10 NZT)

- Branch: `cursor/6-40-pressure-rectify` (worktree `/workspace/cursor-dialin-6.39`).
- Prior doc referred to `cursor/6-39-pressure-small-gauge`; current work is step 1 of the rectify line on this branch.

## Step 1 (canonical dial prior) — done

- Rebuilt `FLAIR_CANONICAL_DIAL_PROFILE` and `FLAIR_CANONICAL_FACE_PROFILE` in `src/flairPressureLab/canonicalDial.js` from `dialFaceTemplate.js`:
  - Minor/major rim ticks only on the 0–10 bar arc via `barToDialAngle` (half-bar minors, integer majors); baseline elsewhere.
  - Face prior: `ESPRESSO_SECTOR`, `STOP_SECTOR`, numeral bumps at 5 and 10 bar.
  - Removed full-360° 30°/7.5° tick comb and ad-hoc arc degree ranges.
- Moved `CANONICAL_ZERO_BAR_ANGLE_DEG` (47°) into `dialFaceTemplate.js` with the other design-photo constants so `canonicalDial` can import `barToDialAngle` without a circular dependency; still re-exported from `canonicalDial.js`.
- Updated `syntheticFlairReplayFrame` and the OpenCV discovery vitest to paint/match the template sectors and arc ticks (not 30° spokes).
- Tests: `/workspace/bin/box-test-slot --build npm run test:vitest -- src/flairPressureLab/pressureCv.vitest.js scripts/pressure-replay/syntheticLayout.vitest.js` — **45/45 passed**.

## Next

- Step 2: refine 72-bin profile (per task plan).
- Score dry + synthetic clips; held-out real-shot exam still out of scope for Cursor.

## Rules (unchanged)

- No overfitting: geometry from detection or `dialFaceTemplate.js` / `measure-design-dial.py`; no frame upload/cache; ~1 s hold then gap; bench/synthetic clips only; tests via `box-test-slot --build`.
