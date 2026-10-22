# Pressure lab: resumable state (updated 2026-10-22 20:15 NZT)

- Branch: `cursor/6-40-pressure-rectify` (worktree `/workspace/cursor-dialin-6.39`).
- Step 1 (repair 2): **angle-to-bar map** from half-bar ticks, sweep **179.52°**.
- This pass: **needle model repair** — crop convention, real rest crops, classical fallback, slower model cadence.

## This pass

Small CNN reads needle angle from the registered crop. Classical needle code still finds the dial and registers rotation. The model runs on at most one frame in three. It replaces the classical angle only when the two bars agree (within **0.4 bar**) or the classical needle is missing/lost and model confidence is at least **0.85**. A low-confidence or disagreeing model leaves the classical reading in place (no forced gap). If the weights fail to load, the classical reader is unchanged. Live bar text is one decimal (`formatPressureBar`).

Dry-bench check (in memory, no frames written): after colour registration the classical relative bar is the manifest rest value, and the retrained model on that same crop reads the same bar at confidence about **1.0**. The earlier ~5–6 bar readings were the model looking at a real rectified face it had never been trained on, then clearing the classical angle whenever confidence was low. Unrotation sign matches the classical subtraction (`image angle − rotationDeg`).

- Model: `public/flair-pressure-lab/needle.onnx` (opset 17, float32). **138,843** params, **557,891** bytes. Not quantised; already under 1 MB.
- Input `face` float32 `[1,3,64,64]` in `[0,1]`, NCHW. Output `needle` `[sin, cos, visibility logit]`. Angle is `atan2(sin, cos)` in the registered crop (0° = right, clockwise), then `angleToBar` / `registeredAngleToBar` with `CANONICAL_ZERO_BAR_ANGLE_DEG`.
- Decode gate: sigmoid ≥ **0.6** (`NEEDLE_CONFIDENCE_MIN`) and the angle on the printed scale. Adoption still requires agreement (`NEEDLE_AGREE_BAR` 0.4) or a lost classical needle (`NEEDLE_BEAT_CONFIDENCE` 0.85).
- Runtime: `onnxruntime-web` **1.22.0** (MIT), dynamic import only from the pressure lab, WASM, `numThreads = 1`. Weights and the WASM runtime are same-origin (`/flair-pressure-lab/needle.onnx`, `/flair-pressure-lab/ort/`). The crop tensor is dropped after the run. It is not stored on the bridge.
- WASM files are copied at build/postinstall by `scripts/copy-needle-ort.mjs` (gitignored, same idea as `opencv.js`).

### Train

```bash
python3 -m venv scripts/pressure-model/.venv
scripts/pressure-model/.venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
scripts/pressure-model/.venv/bin/pip install onnx pillow
node scripts/pressure-model/synthesize-crops.mjs
node scripts/pressure-model/collect-rest-crops.mjs
scripts/pressure-model/.venv/bin/python scripts/pressure-model/train_needle.py
```

Crops stay in `scripts/pressure-model/data/` (gitignored). The script writes the `.onnx`.

### Dataset

8,000 train / 1,200 val, 64×64 RGB, painted from `dialFaceTemplate.js` and `gaugeConfig.js` (21 half-bar ticks, sweep 179.52°, zero at `CANONICAL_ZERO_BAR_ANGLE_DEG`, espresso and stop sectors, needle span `TIP_INNER_RATIO`–`OUTER_RADIUS_RATIO`). Seeds: train 1000+, val 50000+. The mixture roll uses a different seed stream from the crop, so the needle bar is uniform on about **−0.45…10.45**. About 12% negatives (this export: blank, no needle, or a needle under a cover; the renderer now omits the needle on every negative), about 34% nearly registered, the rest with residual rotation about ±10°, ellipse aspect about 0.86–1.16, a darker bezel, and a photo pass (box blur, short motion smear, red/blue split, white-balance, specular glare). Python then adds brightness, contrast, channel gain, noise, box blur, JPEG, and a mild glare blob.

**34** registered rest crops from the dry bench clips are mixed into training (12 copies each, 408 of 8,408). A crop is kept only when template registration, or else colour registration, already puts the classical relative bar inside the manifest tolerance. The tensor is the same `prepareRegisteredFace` square the runtime feeds. No frames are written.

### Validation (best epoch, 14)

| Set | Angle MAE | Bar MAE |
| --- | ---: | ---: |
| Plain val (visible needles) | 3.48° | 0.194 |
| Plain, easy registered subset | 1.87° | 0.104 |
| Photometric aug on val | 3.92° | 0.218 |
| Dry rest crops (in the training mix) | 2.17° | 0.121 |

Visibility: mean confidence **0.985** on clear needles, **0.138** on negatives. Rest crops sit at **0.998**.

Node WASM check (`needleModel.onnx.test.js`): 8 held-out clean crops, bars 0, 1.5, 3.2, 5, 6.8, 8.4, 10, and 4.2 bar with 6° residual. Each under **0.3 bar**. One negative stays under the confidence gate.

### Speed

The model runs on every third tracked frame (`NEEDLE_MODEL_STRIDE` 3), so two frames in three are classical-only and the e2e median is a classical frame. Crop pack + WASM inference, one thread, unthrottled median **1.9 ms**, first call **9.0 ms**. `run-clip-browser.mjs` and `run-replay.mjs` were not changed and were not re-run.

### Replay harness

`scripts/pressure-replay/run-clip-browser.mjs` and `run-replay.mjs` are **unchanged**. An extra `stageModel` summary was added and then removed so the reported metric set stays the same. The model file is a static asset under `public/flair-pressure-lab/`; the lab loads it. The harness does not fetch, cache, or score frames for it. In-memory replay rows can carry `stageModel` and a `model:` flag once the weights are loaded. The summary scripts do not read those fields.

### Licences

PyTorch BSD-3-Clause, ONNX Apache-2.0, NumPy BSD, Pillow HPND, onnxruntime-web MIT. No AGPL. No Ultralytics.

## Tests

`/workspace/bin/box-test-slot --build npm run test:vitest -- src/flairPressureLab/needleModel.vitest.js src/flairPressureLab/pressureCv.vitest.js src/flairPressureLab/replayGaugeSemantics.vitest.js scripts/pressure-replay/syntheticLayout.vitest.js scripts/pressure-replay/privacyAssert.vitest.js` — **58/58 passed**. Needle vitest re-run after the negative-crop fix: **6/6**.

`/workspace/bin/box-test-slot node src/flairPressureLab/needleModel.onnx.test.js` — passed (error < 0.3 bar, unthrottled median 1.9 ms).

`/workspace/bin/box-test-slot node src/flairPressureLab/gaugeConfig.test.js` — passed.

## Prior pass (scale from ticks)

- Phone photo is canonical: 21 half-bar ticks, spacing 8.976°, sweep 179.52°. Product photo disagreed (~190°) and was not used.
- Oblique synthetic reader (classical, before this model), largest error about 0.55 bar on the four seeded frames.

## Phase 5a repair 1 (2026-10-22 21:30 NZT)

The 5.67 bar peak was the wide hub blob (counterweight and a printed mark), not a projective warp. The tip is the dark lobe that reaches out from the hub. On `20261018_160844` that ray plus the red-sector rotation reads **2.56 bar** at 16 s (sanity ~2) and **7.32 bar** at 20 s (sanity ~8). The needle hole was splitting the red run; a short gap is bridged, and the tick comb no longer replaces a colour lock. Dry clip `20261015_225307` at 1 s reads **0 bar** (it was the short end of the same hub pair, about 9 bar).

The disk-homography search is gone. A full refit is the affine ellipse. On the 20 s frame, unthrottled, the ellipse is about 5–9 ms and a cold rectify-plus-needle-plus-tick read is about 19 ms after warmup. At 4× that is under the old 1061 ms p95. The browser harness was not re-run this pass. The previous track-path median on this clip was 22.8 ms at 4×.

Offline overlays and the write-up are in `/workspace/pl-state/diag/` (`ROOT_CAUSE.md`). The diagnostic is `scripts/pressure-replay/diag-peak-bias.mjs`. It is not on the runtime path.

## Rules (unchanged)

- No overfitting: geometry from detection or `dialFaceTemplate.js` / `measure-design-dial.py`; no frame upload/cache; ~1 s hold then gap; bench/synthetic clips only; tests via `box-test-slot --build`.
