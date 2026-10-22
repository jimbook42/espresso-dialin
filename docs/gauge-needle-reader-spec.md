# Learned Needle Reader: Build Spec (Flair 58 first, any gauge later)

> PM-edited copy (2026-10-23). Edits: Flair anchors from labels; one self-training round in Phase 3; Phase 0 reuses existing evals and fixes replay tap calibration; Phase 7 and multi-style needles deferred.
>
> Box rules: real clips for Cursor are in /workspace/flair-train (allowed). NEVER touch /workspace/flair-real. No frames uploaded anywhere; the app never saves frames. Permissive licences only (no AGPL/Ultralytics). No clip-specific logic in the runtime. Hand labels: /workspace/cursor-dialin-6.42/scripts/pressure-label/fixtures/labels-2026-10-22.json (eval only). Heavy runs (training, browser replay) go through /workspace/bin/box-test-slot with TZ=UTC; check ≥3 GB free memory first. Commit AND push every 10 minutes.

Audience: Cursor (coder) and the Grok PM/QA bots (run the exams). Work through the phases in order. Each phase ends with a **gate**. Do not start the next phase until the gate passes, and report the metrics when you stop.

## 0. Master prompt (paste into Cursor, changing the phase number)

> Read `docs/gauge-needle-reader-spec.md`. Implement **Phase N only**. Keep the existing tap calibration and dial pose tracker unchanged unless the phase says otherwise. Add or extend the exam harness so the phase gate can be run with one command. When done, run the exam, paste the metrics table, and stop. Do not tune thresholds to pass a gate. If a gate fails, report why and propose options.

## 1. Goal and constraints

Read the pressure from an analogue gauge through the phone camera, live, fully on-device.

- Fully offline. No cloud or paid AI, free to commercialize. A small on-device model is fine.
- Budget: under 33 ms per frame total on a mid-range phone (measure with 4x CPU throttle). The model itself should take under 8 ms.
- Targets (see gates for exact numbers): readings on 90% or more of frames, typical error 0.25 bar or better (stretch 0.15), near-zero wild errors. A shown number must be right, and "no reading" is better than a wrong one.
- Honest floor: hand taps are only good to about 0.2–0.3 bar, so precision cannot be proven against them. See section 7 for the label-free checks that replace them.
- Hands-off data: no new recordings or labelling are needed for the build. The only inputs are assets already in hand (see section 4.1).

## 2. Architecture

```
camera frame
  -> [existing] dial pose tracker + tap calibration  (centre, scale, rotation/affine)
  -> rectify: canonical crop around the pivot (96x96 px, dial face radius about 40 px)
  -> needle model (tiny CNN)  -> angle distribution over 360 bins + confidence
  -> temporal filter / gating (rate limit, hold-last, hysteresis)
  -> gauge profile: angle -> value (piecewise-linear anchors)
  -> UI (value to 0.1, or "--" when not confident)
```

Design rules:

1. **The model knows nothing about any specific gauge.** It only answers: "in this rectified crop, which direction does the needle tip point?" Everything gauge-specific lives in a JSON **gauge profile**. This is what makes new gauges cheap.
2. **Predict the tip direction, never "the longest dark line".** The needle is double-ended: a thin tip about 2x the length of a short, fat tail. The model is trained with the tail as an explicit hard negative.
3. **Initialise from the calibrated rest angle** and cap how fast the reading may change (section 6). A tail lock at rest is about 180° away from the tip, i.e. far off the Flair 0–10 arc (about 161°), and this rule rejects it outright.
4. **Input representation is an A/B inside Phase 3**, not a decision made now:
   - A) Cartesian rectified crop, with rotation augmentation. It is robust to small pivot errors, because a line's orientation does not change when you shift the crop.
   - B) Polar unwrap (angle x radius). Rotation becomes a shift, which is elegant, but a pivot error of d px bends the needle by about d/r radians (3 px at r = 45 px is about 4 degrees, or about 0.23 bar on the Flair). Keep it only if it wins on the gates.

   Both are built behind a config flag, and the exam picks the winner.

## 3. Gauge profile (JSON, one per gauge)

```json
{
  "id": "flair58-v1",
  "scale": { "anchors": [ {"deg": 0, "value": 0}, {"deg": 74.1, "value": 5}, {"deg": 161.8, "value": 10} ],
             "min": 0, "max": 10, "interp": "piecewise-linear" },
  "rest": { "deg": 0, "value": 0 },
  "needle": { "tipLenRatio": 1.0, "tailLenRatio": 0.5, "color": "dark", "template": "needle.png" },
  "masks": [ { "name": "stop_band", "polygon": "..." }, { "name": "pins", "polygon": "..." } ],
  "background": "dial_clean.png",
  "maxSlewPerSec": 4.0
}
```

PM edit: Flair 58 anchors above come from the 34 hand labels (median over frames, degrees clockwise on screen from the rest needle; the needle rests ON the 0 pin, rest needle ≈ pin + 5.8°): 0 bar = 0°, 5 bar ≈ 74.1°, 10 bar ≈ 161.8° (label pin→10 ≈ 167.6°). So 0→10 spans about 161°, about 16–17°/bar, and 0.1 bar ≈ 1.7°. At runtime the anchors are filled per session from the tap calibration (rest needle, 5 and 10 taps). Piecewise anchors handle non-linear scales on other gauges. Piecewise anchors handle non-linear scales on other gauges.

## 4. Training data engine (this is the hands-off part)

### 4.1 Inputs already available
- The reference gauge photo (frontal, needle at rest).
- The 8 old clips plus the 2 clips that have hand labels (10 total).
- The 34 hand-tapped frames (**evaluation only**, see 4.5).

### 4.2 Clean dial backgrounds
- From the reference photo: remove the needle with `cv2.inpaint` along its known mask to get `dial_clean.png`.
- From each clip: rectify every frame with the real tracker, then take a per-pixel median over the clip. The needle moves, so it mostly disappears, leaving real lighting, wear and coffee mess for that clip. Where the needle rests for long periods, mask that region and fill from other clips.
- Output: a bank of background images, both clean and realistic.

### 4.3 Needle template
- Segment the needle from the reference photo into an alpha mask in a pivot-centred frame. It has a thin, long tip, a short fat tail, and a visible hub.
- Randomise per sample: width ±20%, length ±8%, edge softness, and shade (the needle is not always pure black). (PM edit: multi-style needles are deferred; train the Flair needle only for now. Keep the profile JSON format so other styles can be added later.)

### 4.4 Renderer (Python, deterministic seeds)
Composite the needle onto a random background at a random angle over the full 360 degrees, with the label being the tip direction. Then apply, in randomised combinations:

- **Tracking error** (critical): jitter the centre ±3 px, scale ±5%, rotation ±3 degrees at the rectify step, because the real tracker's errors propagate into the crop.
- Oblique camera (affine and perspective), plus **parallax** (the needle sits above the dial print, so it shifts a few px and casts a shadow).
- Motion blur along the needle's tangent (the needle is rotating), defocus blur, low light with sensor noise, JPEG artefacts, colour cast.
- Glare: specular blobs, glass reflection streaks, gradients crossing the needle.
- Mess and hard negatives: coffee splatter, crema streaks, dark thin lines that resemble a needle, partial occlusion (finger, portafilter, steam), and a fully occluded needle (the target becomes "no reading").
- Always render the tail correctly, since it is the main confuser.

Generate on the fly (infinite data). A fixed, seeded **synthetic validation set** of about 5k frames is kept for the exam.

### 4.5 Real data without labelling
- The 34 hand labels are **evaluation only** (leave-one-clip-out). Training on them is allowed only in the final model, after the exam numbers have been recorded.
- **Self-training round (Phase 5):** run the synthetic-trained model over all clips. Keep frames only if confidence is high AND the forward/backward temporally smoothed reading agrees AND the step from neighbouring frames is physically plausible. Add them as pseudo-labels, plus the hardest low-confidence frames with their smoothed estimates. Retrain, and repeat at most twice.
- **Free ground truth:** every clip starts with the needle at rest, so the first reading must be 0 bar (see section 7).

## 5. Model

- Input: 96x96x3 rectified crop (Cartesian mode) or about 48x360 polar image (polar mode). Add the red channel as an extra input, since red print (logo, Espresso arc, ticks) should not look like a needle.
- Backbone: 4–6 small conv blocks (depthwise-separable), at most 150k parameters. In polar mode use circular padding along the angle axis.
- Heads:
  - **Tip direction:** 360 logits (1 degree bins), trained with cross-entropy against a Gaussian-smoothed target (sigma about 1.5 degrees). Sub-bin angle comes from a soft-argmax over ±3 bins around the peak.
  - **Confidence:** the probability mass within ±5 degrees of the peak. For "no needle visible" training samples the target is a flat distribution, so confidence falls naturally.
  - Optional auxiliary head: needle orientation mod 180 (cos 2θ, sin 2θ), which is robust to pivot error, used as a consistency check against the tip direction.
- Export to ONNX, int8-quantise, run with ONNX Runtime Web (WASM SIMD, with WebGPU optional) in a web worker. Fallback: TFLite or tfjs. Model file under 1 MB.
- Training needs Python and PyTorch on any machine. At this model size a modern CPU is enough (about 1–2 hours for 100k–200k samples), and a GPU is optional. The Grok VDI can run it.

## 6. Temporal filter and gating

- Initialise at the calibrated rest angle.
- Per-frame slew limit from the profile (`maxSlewPerSec`). Derive it from the 99.9th percentile of plausible lever motion in the clips, not a guess.
- One-euro or Kalman smoothing, weighted by confidence.
- Show a number only if confidence is at least tau AND the reading is consistent with the last 3–5 frames. Otherwise hold the last value for up to about 300 ms, then show "--".
- Reject a tip/tail flip explicitly: if the opposite end of the line has a much stronger tip signature, re-check before accepting.
- Log every rejection reason (counts per clip) for the harness.

## 7. Evaluation harness (one command, run by the bots)

Metrics, reported per clip and overall:

| Metric | Meaning |
|---|---|
| Coverage | % of frames with a shown reading (also report separately for used-puck clips) |
| Median / P90 error | vs hand labels, leave-one-clip-out |
| Wild rate | % of shown readings more than 1.0 bar off hand labels |
| Flip rate | % of readings about 180 degrees wrong (tail locks) |
| Rest offset | reading at the start of each clip (true value is 0), a **free label** |
| Jitter | RMS second difference of the reading while steady |
| Latency | ms per frame at 4x CPU throttle, model and total |
| Rejections | counts by reason |

Also include the synthetic validation set (exact truth) for precision, since hand labels cannot show it.

**Parity test (mandatory):** the Python preprocessing (rectify and polar) and the TypeScript preprocessing must produce the same tensor within epsilon on the same frame, and the same angle within 0.3 degrees. Mismatched preprocessing is the most common reason a model that tests well fails in the app.

## 8. Phases and gates

**Phase 0: Baseline and harness.** PM edit: reuse the existing harnesses (`scripts/pressure-label/eval-labels.mjs`, `eval-calibrated.mjs` → eval-6.41, and the PM's `qc.sh` replay). First fix the replay so the tap calibration actually applies: in the qc_s641r2 run the real clip 084814 never showed CALIBRATING (check the `atSec` half-second window, timing base and the hook in `run-clip-browser.mjs` / `tapCalibrate.js`), and the replay result JSON must record that calibration applied. Wire the harness to the current build. Record all metrics for it as the baseline. Gate: harness runs end to end on all clips with one command, and baseline numbers are saved.

**Phase 1: Gauge profile, rectify, preprocessing parity.** Implement the profile schema, rectified crop and polar option in both Python and TypeScript. Gate: parity test passes on at least 200 frames.

**Phase 2: Synthetic generator.** Implement section 4.2–4.4 with a CLI to preview samples as a contact sheet (the bots should review it for realism against real frames). Gate: sample sheet reviewed, deterministic from seed, at least 200 samples/s on CPU with multiprocessing.

**Phase 3: Train v1 (synthetic only) and A/B Cartesian vs polar.** Gate (synthetic val): median error ≤ 0.1 bar, wild ≤ 0.2%, flip 0. Gate (real clips, no real training data yet): report coverage, median/P90, wild, flip. This is the synthetic-to-real transfer check. PM edit: Phase 3 also includes ONE small self-training round (section 4.5 rules: confident real frames whose forward/backward smoothed readings agree and whose frame-to-frame step is plausible, from /workspace/flair-train clips only, never hand labels); report metrics before and after it. If it is poor, fix the renderer (more realism, better tracking-error simulation) before anything else.

**Phase 4: Runtime integration and temporal filter.** ONNX Runtime Web in a worker, section 6 logic, UI states (value, "--", low confidence). Gate: real-clip replay, coverage ≥ 90% (≥ 85% on used-puck clips), median ≤ 0.30 vs hand labels (about the label noise floor), wild ≤ 1%, flip 0, rest offset within ±0.15 bar on every clip, total under 33 ms at 4x throttle.

**Phase 5: Self-training rounds (section 4.5).** Gate: improvement on leave-one-clip-out vs Phase 4 with no regression on any clip, and wild rate not higher.

**Phase 6: Hardening.** Low light, glare, fast lever pulls, a dry run, a stalled shot. Fail-safe behaviour: never show an implausible number, and recover cleanly after a lost track. Gate: no reading above plausible bounds in any clip, graceful "--" on lost tracking.

**Phase 7 (DEFERRED by PM, not in this build): New-gauge enrolment CLI.** Described in section 9. Gate: enrol a second gauge from one photo and run the harness on synthetic frames only.

## 9. Scaling to other gauges

Per new gauge, the only input is **one sharp, front-on photo of the gauge face with the needle at rest.** Then, automatically:

1. Enrolment CLI (reuse the tap UI): mark the pivot, the rest position, and 2–3 printed scale marks. It writes the gauge profile.
2. Remove the needle from the photo (inpaint) to get the clean background, and extract the needle template.
3. Generate the synthetic set and evaluate the **shared** model zero-shot on it. If it passes the synthetic gate, ship only the profile JSON.
4. If it does not pass, fine-tune the shared model on that gauge's synthetic data (minutes on CPU), then re-run the gate.

Training the shared model on varied needle styles (colour, width, length, tail shape) and varied dial backgrounds from the start is what makes step 3 usually succeed. The profile carries the angle-to-value mapping, so non-linear scales, different sweeps and different units cost nothing.

## 10. Risks and honest expectations

- **Synthetic-to-real gap** is the main risk. Phase 3 measures it early, before the runtime is built, and the renderer plus self-training are the fixes.
- **Pivot and tracking error** moves the apparent angle. Mitigated by tracking-error augmentation, the Cartesian/orientation path, and the A/B.
- **Parallax** shifts the needle relative to the print at oblique angles. The 3-anchor tap calibration absorbs the constant part. The remainder is part of the error budget, so recommend a roughly front-on camera in the UX.
- **Resolution:** on the Flair (0→10 ≈ 161°), 0.1 bar ≈ 1.7°; at a needle radius of about 45 px that is about 1.3 px of tip movement. So 0.1 bar is the static best case and 0.15–0.25 bar is realistic in motion. The slew limit and smoothing help, but do not promise more than that.
- **Validation caveat:** with only 8–10 clips the real-world test is thin. The built-in exam is a proxy, and 2–3 fresh clips (when convenient) are the honest final check.

## 11. What the owner must provide

- Now: nothing beyond the existing assets (reference photo, clips, 34 labels).
- Optional, later: 2–3 fresh shot clips (different puck, light, camera angle) as an unseen final test.
- Per new gauge: one clear front-on photo with the needle at rest.
