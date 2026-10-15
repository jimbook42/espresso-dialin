# Flair pressure lab — reference capture (live app)

From `gaugeTrack.js` `trackOrientation` (lines ~939–960) and `FlairPressureLab.jsx` (~541–545).

## What the live app requires (no extra tap for reference)

1. **User places the guide ring** on the gauge face (drag move + resize). The tracker is **seeded** from that ring (`readTrackedGauge` → `tracker.seed` at `region` nx/ny/nr).
2. **Front camera live** with the gauge in frame (`useFrontCameraStream` → `status === 'live'`).
3. **Rim lock** must find the dial (`locateGauge` / `trackPosition`) so `rimConfidence >= CONFIDENCE_MIN` (0.3).
4. **First orientation template** captures when **both**:
   - `needleLikeness >= NEEDLE_LIKENESS_GATE` (0.4), and
   - `rimConfidence >= CONFIDENCE_MIN` (0.3),
   on the same frame (`trackOrientation` when `!reference`).
5. Until `referenceCaptured` is true, rest calibration does not run (`gauge.held || !gauge.referenceCaptured` → stays `CALIBRATING`).
6. After reference exists, **rest calibration** needs `REST_STABLE_SAMPLES` (6) stable needle samples via `createRestCalibration()` (`quality` / `likeness` gates in `gaugeConfig.js`).

## Guided-ring bootstrap (tests)

`gaugeConfig.test.js` (~1451–1502): if the seed ring is wrong, wide search must find the real rim (`locateGauge` with `searchFraction` ~0.9); the guided prior must remain competitive (`priorStillThere`). Wrong ring at frame centre without a visible dial at that location → no reference, false “100% tracked”.

## Harness implication

Replay uses the **Start front camera** path as production on unmodified 720p clips. The user must align the guide ring on a live device; the harness does not crop or assume dial position. No manifest bar values enter the CV pipeline.
