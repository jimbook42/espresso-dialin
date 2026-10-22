# Pressure lab: resumable state (updated 2026-10-22 15:30 NZT)

- Branch: `cursor/6-40-pressure-rectify` (worktree `/workspace/cursor-dialin-6.39`).
- Step 1 (repair 2): **angle-to-bar map** from half-bar ticks, sweep **179.52°**.
- This pass: **on-device needle model** on the rectified, rotation-registered face.

## This pass

Small CNN reads needle angle from the registered crop. Classical needle code still finds the dial and registers rotation. If the weights load, a confident model replaces that angle. If the load fails, the classical reader stays in place. A loaded model that is not confident clears the angle: the existing hold (≤1 s) then a gap. No guess. Live bar text is one decimal (`formatPressureBar`).

- Model: `public/flair-pressure-lab/needle.onnx` (opset 17, float32). **138,843** params, **557,891** bytes. Not quantised; already under 1 MB.
- Input `face` float32 `[1,3,64,64]` in `[0,1]`, NCHW. Output `needle` `[sin, cos, visibility logit]`. Angle is `atan2(sin, cos)` in the registered crop (0° = right, clockwise), then `angleToBar` / `registeredAngleToBar` with `CANONICAL_ZERO_BAR_ANGLE_DEG`.
- Confidence gate: sigmoid ≥ **0.6** (`NEEDLE_CONFIDENCE_MIN`) and the angle on the printed scale.
- Runtime: `onnxruntime-web` **1.22.0** (MIT), dynamic import only from the pressure lab, WASM, `numThreads = 1`. Weights and the WASM runtime are same-origin (`/flair-pressure-lab/needle.onnx`, `/flair-pressure-lab/ort/`). The crop tensor is dropped after the run. It is not stored on the bridge.
- WASM files are copied at build/postinstall by `scripts/copy-needle-ort.mjs` (gitignored, same idea as `opencv.js`).

### Train

```bash
python3 -m venv scripts/pressure-model/.venv
scripts/pressure-model/.venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
scripts/pressure-model/.venv/bin/pip install onnx pillow
node scripts/pressure-model/synthesize-crops.mjs
scripts/pressure-model/.venv/bin/python scripts/pressure-model/train_needle.py
```

Crops stay in `scripts/pressure-model/data/` (gitignored). The script writes the `.onnx`.

### Dataset

8,000 train / 1,200 val, 64×64 RGB, painted from `dialFaceTemplate.js` and `gaugeConfig.js` (21 half-bar ticks, sweep 179.52°, zero at `CANONICAL_ZERO_BAR_ANGLE_DEG`, espresso and stop sectors, needle span `TIP_INNER_RATIO`–`OUTER_RADIUS_RATIO`). Seeds: train 1000+, val 50000+. The mixture roll uses a different seed stream from the crop, so the needle bar is uniform on about **−0.45…10.45** (sharing one seed had skipped the rest pin). About 12% negatives (no face, no needle, or covered), about 34% nearly registered, the rest with residual rotation about ±10°, ellipse aspect about 0.86–1.16, shift, blur-free photometric noise. Python then adds brightness, contrast, channel gain, noise, box blur, JPEG, and a mild glare blob. Angle loss is masked when the visibility target is low. Dry bench clips were not mixed in.

### Validation (best epoch, 14)

| Set | Angle MAE | Bar MAE |
| --- | ---: | ---: |
| Plain val (visible needles) | 2.46° | 0.137 |
| Plain, easy registered subset | 1.47° | 0.082 |
| Photometric aug on val | 2.86° | 0.159 |

Visibility: mean confidence **0.992** on clear needles, **0.081** on negatives.

Node WASM check (`needleModel.onnx.test.js`): 8 held-out clean crops, bars 0, 1.5, 3.2, 5, 6.8, 8.4, 10, and 4.2 bar with 6° residual. Each under **0.3 bar**. One negative stays under the confidence gate.

### Speed

Crop pack + WASM inference, one thread, unthrottled: median **1.8 ms**, first call **9.9 ms**. At a 4× CPU throttle that is about **7 ms** steady, under the 33 ms budget. The full throttled replay harness was not run.

### Replay harness

`scripts/pressure-replay/run-clip-browser.mjs` and `run-replay.mjs` are **unchanged**. An extra `stageModel` summary was added and then removed so the reported metric set stays the same. The model file is a static asset under `public/flair-pressure-lab/`; the lab loads it. The harness does not fetch, cache, or score frames for it. In-memory replay rows can carry `stageModel` and a `model:` flag once the weights are loaded. The summary scripts do not read those fields.

### Licences

PyTorch BSD-3-Clause, ONNX Apache-2.0, NumPy BSD, Pillow HPND, onnxruntime-web MIT. No AGPL. No Ultralytics.

## Tests

`/workspace/bin/box-test-slot --build npm run test:vitest -- src/flairPressureLab/needleModel.vitest.js src/flairPressureLab/pressureCv.vitest.js src/flairPressureLab/replayGaugeSemantics.vitest.js scripts/pressure-replay/syntheticLayout.vitest.js scripts/pressure-replay/privacyAssert.vitest.js` — **58/58 passed**.

`/workspace/bin/box-test-slot node src/flairPressureLab/needleModel.onnx.test.js` — passed (error < 0.3 bar).

`/workspace/bin/box-test-slot node src/flairPressureLab/gaugeConfig.test.js` — passed.

## Prior pass (scale from ticks)

- Phone photo is canonical: 21 half-bar ticks, spacing 8.976°, sweep 179.52°. Product photo disagreed (~190°) and was not used.
- Oblique synthetic reader (classical, before this model), largest error about 0.55 bar on the four seeded frames.

## Rules (unchanged)

- No overfitting: geometry from detection or `dialFaceTemplate.js` / `measure-design-dial.py`; no frame upload/cache; ~1 s hold then gap; bench/synthetic clips only; tests via `box-test-slot --build`.
