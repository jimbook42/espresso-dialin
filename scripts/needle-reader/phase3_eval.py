#!/usr/bin/env python3
"""Phase 3 real-clip transfer, one LOCO self-training round, and the results table.

Real frames are the Phase 0 replay stills (fps=8 PNGs) paired with that replay's
tracker centre/radius and the tap-calibration rest angle. Hand labels are
evaluation only. /workspace/flair-real is never opened.

  python3 scripts/needle-reader/phase3_eval.py cache
  python3 scripts/needle-reader/phase3_eval.py eval-real --tag 3a
  python3 scripts/needle-reader/phase3_eval.py self-train
  python3 scripts/needle-reader/phase3_eval.py report
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

import cv2
import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))

from gauge_profile import angle_to_value, load_gauge_profile  # noqa: E402
from needle_model import build_model, decode, parameter_count  # noqa: E402
from rectify import rectify  # noqa: E402
from synth_render import output_angle, rectify_spec, with_red  # noqa: E402
from train_needle import TRAIN, _predict, finetune_arm  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
PROFILE_PATH = REPO / "profiles" / "flair58-v1.json"
BASELINE_JSON = Path("/workspace/pl-state/nr/baseline.json")
REPLAY = Path("/workspace/pl-state/nr/replay")
FRAMES = Path("/workspace/pl-data/frames")
LABELS_PATH = REPO / "scripts/pressure-label/fixtures/labels-2026-10-22.json"
LABEL_DIR = Path("/workspace/pl-state/label-frames")
REAL = TRAIN / "real"
RESULTS_TXT = Path("/workspace/pl-state/nr/phase3-results.txt")
RESULTS_JSON = Path("/workspace/pl-state/nr/phase3-results.json")
REPLAY_W = 1280
REPLAY_H = 720
SLOT = 0.125
SLEW_BAR_PER_S = 4.0


def _mem_mb() -> float:
    for line in Path("/proc/meminfo").read_text().splitlines():
        if line.startswith("MemAvailable:"):
            return int(line.split()[1]) / 1024
    return 0.0


def _refuse(path: Path) -> None:
    resolved = str(path.resolve())
    if resolved.startswith("/workspace/flair-real"):
        raise SystemExit(f"refusing {resolved}")


def wrap360(deg: float) -> float:
    return float(deg) % 360.0


def circ(a: float, b: float) -> float:
    d = abs(wrap360(a) - wrap360(b)) % 360.0
    return min(d, 360.0 - d)


def circ_mean(a: float, b: float) -> float:
    ax, ay = math.cos(math.radians(a)), math.sin(math.radians(a))
    bx, by = math.cos(math.radians(b)), math.sin(math.radians(b))
    return wrap360(math.degrees(math.atan2(ay + by, ax + bx)))


def signed_bar(angle_deg: float, profile: dict) -> float:
    """Profile mapping, extended past the end anchors so a rest needle just
    below 0° is a small negative bar and not clamped up at 10."""
    angle = wrap360(angle_deg)
    if angle > 180.0:
        angle -= 360.0
    anchors = profile["scale"]["anchors"]
    if angle <= anchors[0]["deg"]:
        d0, v0 = anchors[0]["deg"], anchors[0]["value"]
        d1, v1 = anchors[1]["deg"], anchors[1]["value"]
        return v0 + (angle - d0) * (v1 - v0) / (d1 - d0)
    if angle >= anchors[-1]["deg"]:
        d0, v0 = anchors[-2]["deg"], anchors[-2]["value"]
        d1, v1 = anchors[-1]["deg"], anchors[-1]["value"]
        return v1 + (angle - d1) * (v1 - v0) / (d1 - d0)
    return float(angle_to_value(angle, profile))


def quantile(values: list[float], p: float):
    if not values:
        return None
    order = sorted(values)
    pos = (len(order) - 1) * p
    lo, hi = int(math.floor(pos)), int(math.ceil(pos))
    if lo == hi:
        return float(order[lo])
    return float(order[lo] * (hi - pos) + order[hi] * (pos - lo))


def load_profile() -> dict:
    return load_gauge_profile(str(PROFILE_PATH))


def baseline_clips() -> list[dict]:
    data = json.loads(BASELINE_JSON.read_text())
    return data["clips"]


def png_dir(clip_id: str) -> Path:
    path = FRAMES / f"pressure-frames-png-{clip_id}"
    _refuse(path)
    return path


def replay_rows(clip_id: str) -> tuple[dict, list[dict], list[Path]]:
    payload = json.loads((REPLAY / f"{clip_id}.json").read_text())
    folder = png_dir(clip_id)
    pngs = sorted(p for p in folder.glob("*.png") if p.name[:4].isdigit())
    if not pngs:
        raise SystemExit(f"no replay stills for {clip_id}")
    frames = payload["frames"]
    zero = float(payload["tapCalibration"]["anchors"]["zeroAngleDeg"])
    rows = []
    for i, frame in enumerate(frames):
        index = 4 + i
        png = pngs[index % len(pngs)]
        centre_ok = frame.get("centreX") is not None and frame.get("centreY") is not None and frame.get("radius")
        pose_ok = bool(centre_ok) and float(frame["radius"]) > 1
        rows.append({
            "i": i,
            "time": (4 + i) * SLOT,
            "tracking": frame.get("tracking") or "none",
            "poseOk": pose_ok,
            "cx": float(frame["centreX"]) if pose_ok else 0.0,
            "cy": float(frame["centreY"]) if pose_ok else 0.0,
            "radius": float(frame["radius"]) if pose_ok else 0.0,
            "png": png.name,
            "zero": zero,
        })
    return payload, rows, pngs


def _rgba(path: Path) -> np.ndarray:
    _refuse(path)
    bgr = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if bgr is None:
        raise RuntimeError(f"unreadable {path}")
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    rgba = np.empty((rgb.shape[0], rgb.shape[1], 4), np.uint8)
    rgba[..., :3] = rgb
    rgba[..., 3] = 255
    return rgba


def _crop(rgba: np.ndarray, pose: dict, profile: dict, mode: str) -> np.ndarray:
    h, w = rgba.shape[:2]
    chw = rectify(np.ascontiguousarray(rgba), w, h, pose, rectify_spec(profile, mode))
    return with_red(chw, True)


def _u8(chw: np.ndarray) -> np.ndarray:
    return np.clip(np.round(chw * 255.0), 0, 255).astype(np.uint8)


def cache_real() -> None:
    if _mem_mb() < 3072:
        raise SystemExit(f"need >= 3 GB free, have {_mem_mb():.0f} MB")
    cv2.setNumThreads(2)
    profile = load_profile()
    clips = baseline_clips()
    grouped = []
    total = 0
    for clip in clips:
        _payload, rows, pngs = replay_rows(clip["id"])
        grouped.append((clip, rows, pngs))
        total += len(rows)
    REAL.mkdir(parents=True, exist_ok=True)
    cart = np.memmap(REAL / "cartesian.u8", dtype=np.uint8, mode="w+", shape=(total, 4, 96, 96))
    polar = np.memmap(REAL / "polar.u8", dtype=np.uint8, mode="w+", shape=(total, 4, 48, 360))
    manifest_frames = []
    cursor = 0
    t0 = time.perf_counter()
    by_name = {}
    for clip, rows, pngs in grouped:
        by_name[clip["id"]] = {path.name: path for path in pngs}
        for row in rows:
            rgba = _rgba(by_name[clip["id"]][row["png"]])
            if row["poseOk"]:
                pose = {"cx": row["cx"], "cy": row["cy"], "radius": row["radius"], "rotationDeg": row["zero"]}
                cart[cursor] = _u8(_crop(rgba, pose, profile, "cartesian"))
                polar[cursor] = _u8(_crop(rgba, pose, profile, "polar"))
            else:
                cart[cursor] = 0
                polar[cursor] = 0
            manifest_frames.append({
                "clip": clip["id"],
                "kind": clip["kind"],
                "i": row["i"],
                "time": row["time"],
                "tracking": row["tracking"],
                "poseOk": row["poseOk"],
                "cx": row["cx"],
                "cy": row["cy"],
                "radius": row["radius"],
                "zero": row["zero"],
                "png": row["png"],
            })
            cursor += 1
            if cursor % 400 == 0:
                print(f"cache {cursor}/{total}", flush=True)
    cart.flush()
    polar.flush()
    manifest = {
        "n": total,
        "seconds": time.perf_counter() - t0,
        "pose": "rectifyPoseFromTrack: rotationDeg = tap zeroAngleDeg, centre and radius from the replay row",
        "stills": "fps=8 PNGs, replay index i uses still (4+i) mod frameCount, matching FlairPressureLab",
        "frames": manifest_frames,
    }
    (REAL / "manifest.json").write_text(json.dumps(manifest))
    print(f"cached {total} frames in {manifest['seconds']:.1f}s", flush=True)


def _load_manifest() -> dict:
    return json.loads((REAL / "manifest.json").read_text())


def _memmap(mode: str, n: int) -> np.memmap:
    shape = (n, 4, 96, 96) if mode == "cartesian" else (n, 4, 48, 360)
    return np.memmap(REAL / f"{mode}.u8", dtype=np.uint8, mode="r", shape=shape)


def _model_from(mode: str, state):
    model = build_model(mode).eval()
    weights = state
    if isinstance(state, dict) and isinstance(state.get(mode), dict) and any(k.endswith("weight") or "." in k for k in state[mode]):
        weights = state[mode]
    elif isinstance(state, dict) and isinstance(state.get("state"), dict):
        weights = state["state"]
    model.load_state_dict(weights)
    return model


def predict_indices(mode: str, state, indices: np.ndarray, batch: int = 64):
    if _mem_mb() < 2048:
        raise SystemExit(f"low memory {_mem_mb():.0f} MB")
    torch.set_num_threads(6)
    images = _memmap(mode, json.loads((REAL / "manifest.json").read_text())["n"])
    model = _model_from(mode, state)
    # Predict in index order, then scatter. Chunks keep the memmap happy.
    order = np.asarray(indices, dtype=np.int64)
    pred = np.zeros(order.shape[0], np.float32)
    conf = np.zeros(order.shape[0], np.float32)
    for start in range(0, order.shape[0], batch):
        sl = order[start:start + batch]
        ang, cf = _predict(model, images[sl], torch.device("cpu"), batch=batch)
        pred[start:start + batch] = ang
        conf[start:start + batch] = cf
    return pred, conf


def eval_arm(mode: str, tag: str, ckpt: Path) -> dict:
    manifest = _load_manifest()
    n = manifest["n"]
    state = torch.load(ckpt, map_location="cpu", weights_only=False)
    pred, conf = predict_indices(mode, state, np.arange(n))
    np.savez(REAL / f"pred-{mode}-{tag}.npz", angle=pred, conf=conf)
    print(f"predicted {mode} {tag} n={n} conf_p50={float(np.median(conf)):.3f}", flush=True)
    return {"n": n, "confP50": float(np.median(conf))}


def _labels() -> list[dict]:
    raw = json.loads(LABELS_PATH.read_text())["frames"]
    rows = []
    for key, row in raw.items():
        if row.get("unclear"):
            continue
        item = dict(row)
        item["id"] = key
        rows.append(item)
    return rows


def _scale_label_image(path: Path):
    rgba = _rgba(path)
    h, w = rgba.shape[:2]
    if w == REPLAY_W and h == REPLAY_H:
        return rgba, 1.0, 1.0
    rgb = cv2.resize(rgba[..., :3], (REPLAY_W, REPLAY_H), interpolation=cv2.INTER_AREA)
    out = np.empty((REPLAY_H, REPLAY_W, 4), np.uint8)
    out[..., :3] = rgb
    out[..., 3] = 255
    return out, REPLAY_W / w, REPLAY_H / h


def _nearest_pose(frames: list[dict], clip_id: str, t: float) -> dict | None:
    best = None
    best_dt = 1e9
    for frame in frames:
        if frame["clip"] != clip_id or not frame["poseOk"]:
            continue
        dt = abs(frame["time"] - t)
        if dt < best_dt:
            best_dt = dt
            best = frame
    if best is None or best_dt > 0.5:
        return None
    return best


def label_predictions(mode: str, state, manifest: dict, profile: dict) -> list[dict]:
    torch.set_num_threads(6)
    model = _model_from(mode, state).eval()
    frames = manifest["frames"]
    out = []
    for row in _labels():
        pose_row = _nearest_pose(frames, row["clip"], float(row["t"]))
        if pose_row is None:
            out.append({"id": row["id"], "clip": row["clip"], "t": row["t"], "phase": row.get("phase"), "ok": False})
            continue
        image, sx, sy = _scale_label_image(LABEL_DIR / f"{row['id']}.jpg")
        hub = np.array([row["hub"][0] * sx, row["hub"][1] * sy], np.float64)
        tip = np.array([row["tip"][0] * sx, row["tip"][1] * sy], np.float64)
        truth = output_angle(hub, tip, pose_row["zero"])
        pose = {"cx": pose_row["cx"], "cy": pose_row["cy"], "radius": pose_row["radius"], "rotationDeg": pose_row["zero"]}
        crop = _u8(_crop(image, pose, profile, mode))[None]
        ang, conf = _predict(model, crop, torch.device("cpu"), batch=1)
        out.append({
            "id": row["id"],
            "clip": row["clip"],
            "t": float(row["t"]),
            "phase": row.get("phase"),
            "ok": True,
            "truthDeg": truth,
            "predDeg": float(ang[0]),
            "conf": float(conf[0]),
            "truthBar": signed_bar(truth, profile),
            "predBar": signed_bar(float(ang[0]), profile),
        })
    return out


def _shown_frame(frame, conf, tau: float) -> bool:
    if not frame["poseOk"]:
        return False
    if frame["tracking"] in ("LOST", "CALIBRATING"):
        return False
    return float(conf) >= tau


def _jitter(bars: list[float]):
    second = []
    for i in range(2, len(bars)):
        if abs(bars[i] - bars[i - 1]) > 0.25 or abs(bars[i - 1] - bars[i - 2]) > 0.25:
            continue
        second.append(bars[i] - 2 * bars[i - 1] + bars[i - 2])
    if not second:
        return None
    return math.sqrt(sum(v * v for v in second) / len(second))


def summarise(manifest, angles, confs, labels, tau: float, profile: dict) -> dict:
    frames = manifest["frames"]
    by_clip = {}
    for index, frame in enumerate(frames):
        by_clip.setdefault(frame["clip"], []).append(index)
    label_by = {}
    for row in labels:
        label_by.setdefault(row["clip"], []).append(row)
    clips = []
    pool_err = []
    pool_flip = []
    shown_n = 0
    used_shown = 0
    used_n = 0
    for clip in baseline_clips():
        idxs = by_clip.get(clip["id"], [])
        shown_bars = []
        for index in idxs:
            if _shown_frame(frames[index], confs[index], tau):
                shown_bars.append(signed_bar(float(angles[index]), profile))
        n = len(idxs)
        shown = len(shown_bars)
        shown_n += shown
        if clip["kind"] == "used":
            used_n += n
            used_shown += shown
        lab = [row for row in label_by.get(clip["id"], []) if row.get("ok")]
        shown_lab = [row for row in lab if row["conf"] >= tau]
        errs = [abs(row["predBar"] - row["truthBar"]) for row in shown_lab]
        flips = [circ(row["predDeg"], row["truthDeg"]) >= 155.0 for row in shown_lab]
        ungated = [abs(row["predBar"] - row["truthBar"]) for row in lab]
        pool_err.extend(errs)
        pool_flip.extend(flips)
        clips.append({
            "id": clip["id"],
            "kind": clip["kind"],
            "frames": n,
            "coveragePct": 100.0 * shown / n if n else None,
            "median": quantile(errs, 0.5),
            "p90": quantile(errs, 0.9),
            "wildPct": (100.0 * sum(e > 1.0 for e in errs) / len(errs)) if errs else None,
            "flipPct": (100.0 * sum(flips) / len(flips)) if flips else None,
            "flipN": int(sum(flips)),
            "labelN": len(errs),
            "rest": shown_bars[0] if shown_bars else None,
            "jitter": _jitter(shown_bars),
            "ungatedMedian": quantile(ungated, 0.5),
            "ungatedN": len(ungated),
        })
    wilds = [e for e in pool_err]
    overall = {
        "coveragePct": 100.0 * shown_n / len(frames) if frames else None,
        "usedCoveragePct": 100.0 * used_shown / used_n if used_n else None,
        "median": quantile(pool_err, 0.5),
        "p90": quantile(pool_err, 0.9),
        "wildPct": (100.0 * sum(e > 1.0 for e in wilds) / len(wilds)) if wilds else None,
        "flipPct": (100.0 * sum(pool_flip) / len(pool_flip)) if pool_flip else None,
        "flipN": int(sum(pool_flip)),
        "labelN": len(pool_err),
        "restMaxAbs": max((abs(c["rest"]) for c in clips if c["rest"] is not None), default=None),
        "restMissing": [c["id"] for c in clips if c["rest"] is None],
        "jitterMedian": quantile([c["jitter"] for c in clips if c["jitter"] is not None], 0.5),
    }
    return {"tau": tau, "clips": clips, "overall": overall}


def _exp_smooth(angles, weights, times, forward: bool):
    n = len(angles)
    out = np.full(n, np.nan, np.float64)
    order = range(n) if forward else range(n - 1, -1, -1)
    cx = cy = 0.0
    prev = None
    tau = 0.40
    for i in order:
        w = float(weights[i])
        if prev is None:
            if w <= 0:
                continue
            a = math.radians(float(angles[i]))
            cx, cy = math.cos(a) * w, math.sin(a) * w
            prev = float(times[i])
        else:
            decay = math.exp(-abs(float(times[i]) - prev) / tau)
            cx *= decay
            cy *= decay
            if w > 0 and np.isfinite(angles[i]):
                a = math.radians(float(angles[i]))
                cx += math.cos(a) * w
                cy += math.sin(a) * w
            prev = float(times[i])
        if cx * cx + cy * cy < 1e-8:
            continue
        out[i] = wrap360(math.degrees(math.atan2(cy, cx)))
    return out


def _step_ok(i, angles, times, valid, deg_per_s: float) -> bool:
    prev = next_i = None
    for j in range(i - 1, -1, -1):
        if valid[j]:
            prev = j
            break
    for j in range(i + 1, len(angles)):
        if valid[j]:
            next_i = j
            break
    def ok(j):
        dt = max(SLOT, abs(float(times[i]) - float(times[j])))
        limit = max(6.0, deg_per_s * dt * 1.5)
        return circ(float(angles[i]), float(angles[j])) <= limit
    if prev is not None and not ok(prev):
        return False
    if next_i is not None and not ok(next_i):
        return False
    return prev is not None or next_i is not None


def build_pseudo(manifest, angles, confs, tau: float, profile: dict) -> list[dict]:
    deg_per_s = SLEW_BAR_PER_S * (profile["scale"]["anchors"][-1]["deg"] / profile["scale"]["max"])
    frames = manifest["frames"]
    by_clip = {}
    for index, frame in enumerate(frames):
        by_clip.setdefault(frame["clip"], []).append(index)
    pseudo = []
    stats = []
    for clip_id, idxs in by_clip.items():
        ang = np.array([angles[i] for i in idxs], np.float64)
        cf = np.array([confs[i] for i in idxs], np.float64)
        times = np.array([frames[i]["time"] for i in idxs], np.float64)
        valid = np.array([
            frames[i]["poseOk"] and frames[i]["tracking"] == "TRACKING" for i in idxs
        ])
        weights = np.where(valid, cf, 0.0)
        fwd = _exp_smooth(ang, weights, times, True)
        back = _exp_smooth(ang, weights, times, False)
        high = []
        hard = []
        for local, index in enumerate(idxs):
            if not valid[local] or not np.isfinite(fwd[local]) or not np.isfinite(back[local]):
                continue
            if not _step_ok(local, ang, times, valid, deg_per_s):
                continue
            agree = circ(float(fwd[local]), float(back[local]))
            if cf[local] >= tau and agree <= 3.0:
                high.append({"index": int(index), "clip": clip_id, "angle": float(ang[local]), "weight": 1.0, "conf": float(cf[local]), "kind": "high"})
            elif 0.2 <= cf[local] < tau and agree <= 4.0:
                hard.append({
                    "index": int(index),
                    "clip": clip_id,
                    "angle": circ_mean(float(fwd[local]), float(back[local])),
                    "weight": 0.35,
                    "conf": float(cf[local]),
                    "kind": "hard",
                })
        hard.sort(key=lambda row: row["conf"])
        keep_hard = hard[: max(0, int(round(0.15 * len(high))))]
        pseudo.extend(high)
        pseudo.extend(keep_hard)
        stats.append({"clip": clip_id, "high": len(high), "hard": len(keep_hard), "tracking": int(valid.sum())})
    return pseudo, stats, deg_per_s


def _pool_one(job):
    """Spawn worker. Job is (mode, seed, index)."""
    import os
    mode, seed, index = job
    os.environ["OMP_NUM_THREADS"] = "1"
    os.environ["MKL_NUM_THREADS"] = "1"
    cv2.setNumThreads(1)
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from gauge_profile import load_gauge_profile as load_p
    from synth_bank import load_bank
    from synth_render import render_sample
    sample = render_sample(load_bank(Path("/workspace/pl-state/nr/synth")), load_p(str(PROFILE_PATH)), seed, int(index), mode)
    angle = sample["angle"]
    no_needle = bool(sample["noNeedle"]) or angle is None
    raw = np.clip(np.round(sample["tensor"] * 255.0), 0, 255).astype(np.uint8)
    return raw, -1.0 if no_needle else float(angle), no_needle


def _render_pool(mode: str, count: int, seed: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """One synthetic pool for the short fine-tunes. Streamed with the Phase 2 renderer."""
    from multiprocessing import get_context
    ctx = get_context("spawn")
    shape = (count, 4, 96, 96) if mode == "cartesian" else (count, 4, 48, 360)
    images = np.empty(shape, np.uint8)
    angles = np.zeros(count, np.float32)
    flags = np.zeros(count, np.bool_)
    jobs = [(mode, seed, i) for i in range(count)]
    with ctx.Pool(4) as pool:
        for i, (raw, angle, flag) in enumerate(pool.imap(_pool_one, jobs, chunksize=8)):
            images[i] = raw
            angles[i] = angle
            flags[i] = flag
            if i and i % 500 == 0:
                print(f"pool {mode} {i}/{count}", flush=True)
    return images, angles, flags


def self_train(steps: int, pool: int) -> dict:
    synth = json.loads((TRAIN / "synth-eval.json").read_text())
    winner = pick_winner(synth)
    mode = winner["arm"]
    (TRAIN / "winner.json").write_text(json.dumps(winner, indent=2))
    print(f"winner {mode}: {winner['why']}", flush=True)
    manifest = _load_manifest()
    profile = load_profile()
    pred = np.load(REAL / f"pred-{mode}-3a.npz")
    pseudo, stats, slew = build_pseudo(manifest, pred["angle"], pred["conf"], winner["tau"], profile)
    (REAL / "pseudo.json").write_text(json.dumps({"slewDegPerS": slew, "tau": winner["tau"], "stats": stats, "n": len(pseudo)}, indent=2))
    print(f"pseudo {len(pseudo)} slew={slew:.2f} deg/s", flush=True)
    pool_path = TRAIN / f"ft-pool-{mode}.npz"
    if pool_path.exists():
        pool_blob = np.load(pool_path)
        pool_x, pool_angle, pool_none = pool_blob["x"], pool_blob["angle"], pool_blob["none"]
    else:
        pool_x, pool_angle, pool_none = _render_pool(mode, pool, 64242 + 17)
        np.savez(pool_path, x=pool_x, angle=pool_angle, none=pool_none)
    images = _memmap(mode, manifest["n"])
    base = TRAIN / "checkpoint.pt"
    fold_dir = TRAIN / "loco"
    fold_dir.mkdir(parents=True, exist_ok=True)
    folds = []
    t0 = time.perf_counter()
    # Per-clip predictions start as the 3a reading, then the held-out fold replaces them.
    loco_angle = pred["angle"].astype(np.float32).copy()
    loco_conf = pred["conf"].astype(np.float32).copy()
    clip_ids = [clip["id"] for clip in baseline_clips()]
    for clip_id in clip_ids:
        kept = [row for row in pseudo if row["clip"] != clip_id]
        if not kept:
            raise SystemExit(f"no pseudo labels once {clip_id} is held out")
        px = np.stack([images[row["index"]] for row in kept])
        pa = np.array([row["angle"] for row in kept], np.float32)
        pw = np.array([row["weight"] for row in kept], np.float32)
        dest = fold_dir / f"{clip_id}.pt"
        info = finetune_arm(mode, base, pool_x, pool_angle, pool_none, px, pa, pw, steps=steps, batch=64, lr=3e-4, dest=dest)
        state = torch.load(dest, map_location="cpu", weights_only=False)["state"]
        idxs = np.array([i for i, frame in enumerate(manifest["frames"]) if frame["clip"] == clip_id], np.int64)
        ang, cf = predict_indices(mode, state, idxs)
        loco_angle[idxs] = ang
        loco_conf[idxs] = cf
        # Label photos for this clip use the held-out model. Other clips are filled later.
        folds.append({"clip": clip_id, "pseudo": len(kept), "seconds": info["seconds"], "lastLoss": info["lastLoss"]})
        print(f"fold {clip_id} pseudo={len(kept)} {info['seconds']:.1f}s", flush=True)
    np.savez(REAL / f"pred-{mode}-3b.npz", angle=loco_angle, conf=loco_conf)
    # Label angles: one forward per label with that clip's LOCO weights.
    labels = []
    by_state = {}
    for clip_id in clip_ids:
        by_state[clip_id] = torch.load(fold_dir / f"{clip_id}.pt", map_location="cpu", weights_only=False)["state"]
    # Group labels by clip and run.
    pending = _labels()
    for clip_id in clip_ids:
        mine = [row for row in pending if row["clip"] == clip_id]
        if not mine:
            continue
        part = label_predictions(mode, by_state[clip_id], manifest, profile)
        labels.extend([row for row in part if row["clip"] == clip_id])
    (REAL / "labels-3b.json").write_text(json.dumps(labels))
    summary = summarise(manifest, loco_angle, loco_conf, labels, winner["tau"], profile)
    payload = {
        "arm": mode,
        "tau": winner["tau"],
        "folds": folds,
        "seconds": time.perf_counter() - t0,
        "pseudo": {"n": len(pseudo), "stats": stats},
        "metrics": summary,
    }
    (REAL / "self-train.json").write_text(json.dumps(payload, indent=2))
    return payload


def pick_winner(synth: dict) -> dict:
    """Choose the arm from real-clip transfer recorded before any pseudo-labels."""
    arms = {}
    for mode in ("cartesian", "polar"):
        pred = np.load(REAL / f"pred-{mode}-3a.npz")
        manifest = _load_manifest()
        profile = load_profile()
        labels = json.loads((REAL / f"labels-{mode}-3a.json").read_text())
        tau = float(synth["arms"][mode]["tau"]["tau"])
        metrics = summarise(manifest, pred["angle"], pred["conf"], labels, tau, profile)
        overall = metrics["overall"]
        arms[mode] = {
            "tau": tau,
            "metrics": metrics,
            "synthGate": synth["arms"][mode]["gate"],
            "synthMedian": synth["arms"][mode]["ungated"]["median"],
            "key": (
                overall["flipN"] or 0,
                -sum(1 for c in metrics["clips"] if c["rest"] is not None and abs(c["rest"]) <= 0.2),
                overall["wildPct"] if overall["wildPct"] is not None else 999,
                overall["median"] if overall["median"] is not None else 999,
                -(overall["coveragePct"] or 0),
            ),
        }
    order = sorted(arms, key=lambda mode: arms[mode]["key"])
    arm = order[0]
    other = order[1]
    a, b = arms[arm]["metrics"]["overall"], arms[other]["metrics"]["overall"]
    why = (
        f"{arm} wins the real-clip transfer: flip {a['flipN']} vs {b['flipN']}, "
        f"wild {a['wildPct']} vs {b['wildPct']}, median {a['median']} vs {b['median']}, "
        f"coverage {a['coveragePct']} vs {b['coveragePct']}"
    )
    return {"arm": arm, "why": why, "tau": arms[arm]["tau"], "compared": {mode: {"tau": arms[mode]["tau"], "overall": arms[mode]["metrics"]["overall"], "synthGate": arms[mode]["synthGate"]} for mode in arms}}


def _fmt(value, width, digits):
    if value is None:
        return "N/A".rjust(width)
    return f"{value:.{digits}f}".rjust(width)


def _block(title: str, metrics: dict, baseline: dict | None = None) -> list[str]:
    lines = [title]
    header = f"{'clip':<16} {'kind':<5} {'cov%':>7} {'med':>7} {'p90':>7} {'wild%':>7} {'flip%':>7} {'rest':>7} {'jitter':>8}"
    lines.append(header)
    base = {c["id"]: c for c in baseline["clips"]} if baseline else {}
    for clip in metrics["clips"]:
        lines.append(
            f"{clip['id']:<16} {clip['kind']:<5} "
            f"{_fmt(clip['coveragePct'], 7, 1)} {_fmt(clip['median'], 7, 3)} {_fmt(clip['p90'], 7, 3)} "
            f"{_fmt(clip['wildPct'], 7, 1)} {_fmt(clip['flipPct'], 7, 1)} {_fmt(clip['rest'], 7, 3)} {_fmt(clip['jitter'], 8, 4)}"
        )
        if baseline:
            b = base.get(clip["id"], {})
            lines.append(
                f"{'  baseline':<16} {clip['kind']:<5} "
                f"{_fmt(b.get('coveragePct'), 7, 1)} {_fmt(b.get('medianAbsBar'), 7, 3)} {_fmt(b.get('p90AbsBar'), 7, 3)} "
                f"{_fmt(b.get('wildPct'), 7, 1)} {_fmt(b.get('flipPct'), 7, 1)} {_fmt(b.get('restOffsetBar'), 7, 3)} {_fmt(b.get('jitterRms'), 8, 4)}"
            )
    o = metrics["overall"]
    lines.append(
        f"overall coverage={o['coveragePct']:.1f}%  used-puck={o['usedCoveragePct']:.1f}%  "
        f"median={o['median']}  p90={o['p90']}  wild={o['wildPct']}  flip={o['flipPct']} (n={o['flipN']})  "
        f"rest max|.|={o['restMaxAbs']}  missing={o['restMissing'] or 'none'}  jitter median={o['jitterMedian']}"
    )
    return lines


def go_no_go(metrics: dict) -> dict:
    o = metrics["overall"]
    coverage = o["coveragePct"] or 0
    wild = o["wildPct"] if o["wildPct"] is not None else 999
    flips = o["flipN"] or 0
    rests_ok = all(c["rest"] is not None and abs(c["rest"]) <= 0.2 for c in metrics["clips"])
    continue_ok = coverage >= 85 and wild <= 2 and flips == 0 and rests_ok
    fix = coverage < 70 or wild > 5
    if fix:
        bucket = "Fix the renderer first"
    elif continue_ok:
        bucket = "Continue"
    else:
        bucket = "Isaac's call"
    return {
        "bucket": bucket,
        "continue": {"coverage>=85": coverage >= 85, "wild<=2": wild <= 2, "flips0": flips == 0, "restWithin0.2": rests_ok},
        "fix": {"coverage<70": coverage < 70, "wild>5": wild > 5},
        "coverage": coverage,
        "wild": wild,
        "flips": flips,
        "restsOk": rests_ok,
    }


def write_report() -> None:
    baseline = json.loads(BASELINE_JSON.read_text())
    synth = json.loads((TRAIN / "synth-eval.json").read_text())
    profile = load_profile()
    manifest = _load_manifest()
    arms = {}
    for mode in ("cartesian", "polar"):
        pred = np.load(REAL / f"pred-{mode}-3a.npz")
        labels = json.loads((REAL / f"labels-{mode}-3a.json").read_text())
        tau = float(synth["arms"][mode]["tau"]["tau"])
        arms[mode] = summarise(manifest, pred["angle"], pred["conf"], labels, tau, profile)
        arms[mode]["tau"] = tau
    self_train_doc = json.loads((REAL / "self-train.json").read_text())
    loco = self_train_doc["metrics"]
    decision = go_no_go(loco)
    export = {}
    export_path = REPO / "scripts/needle-reader/export/export.json"
    if export_path.exists():
        export = json.loads(export_path.read_text())
    train_time = {}
    if (TRAIN / "train-time.json").exists():
        train_time = json.loads((TRAIN / "train-time.json").read_text())
    winner = json.loads((TRAIN / "winner.json").read_text()) if (TRAIN / "winner.json").exists() else {"arm": self_train_doc["arm"], "why": ""}
    lines = [
        "Phase 3 results. Synthetic-only 3a, then one leave-one-clip-out self-training round.",
        "Hand labels are evaluation only. Pseudo-labels come from /workspace/flair-train replay frames.",
        "Coverage is confidence >= tau and tracking not LOST or CALIBRATING. Tau is chosen on the synthetic val set only.",
        "Median, P90, wild (>1 bar) and flip (>=155° from the label angle) use shown label readings.",
        "Bar values use the Flair profile, with the scale extended past 0°/10° so rest can be slightly negative.",
        "Rest offset is the first shown bar of the clip. Truth is 0.",
        f"Winner: {winner.get('arm')} — {winner.get('why')}",
        "",
        "Synthetic validation (fixed 5k, ungated needle samples)",
    ]
    for mode in ("cartesian", "polar"):
        arm = synth["arms"][mode]
        u = arm["ungated"]
        gate = arm["gate"]
        lines.append(
            f"  {mode:<10} params={arm['parameters']}  median={u['median']:.3f}°  p90={u['p90']:.3f}°  "
            f"wild={u['wildPct']:.3f}%  flipN={u['flipN']}  "
            f"gate median={gate['median']} wild={gate['wild']} flip={gate['flip']}  tau={arm['tau']['tau']}"
        )
    lines.append("")
    base_metrics = {
        "clips": [
            {
                "id": c["id"], "kind": c["kind"],
                "coveragePct": c.get("coveragePct"), "median": c.get("medianAbsBar"),
                "p90": c.get("p90AbsBar"), "wildPct": c.get("wildPct"),
                "flipPct": c.get("flipPct"), "rest": c.get("restOffsetBar"),
                "jitter": c.get("jitterRms"),
            }
            for c in baseline["clips"]
        ],
        "overall": baseline.get("overall", {}),
    }
    # Baseline overall lives at the top level of baseline.json. Rebuild a short line from the clips file if needed.
    overall = baseline["overall"]
    lines.extend(_block("Phase 0 baseline", {
        "clips": base_metrics["clips"],
        "overall": {
            "coveragePct": overall["coveragePct"],
            "usedCoveragePct": overall["usedCoveragePct"],
            "median": overall["medianAbsBar"],
            "p90": overall["p90AbsBar"],
            "wildPct": overall["wildPct"],
            "flipPct": overall["flipPct"],
            "flipN": None,
            "restMaxAbs": overall["restAbsMax"],
            "restMissing": [],
            "jitterMedian": overall["jitterMedian"],
        },
    }))
    lines.append("")
    lines.extend(_block(f"3a Cartesian  tau={arms['cartesian']['tau']}", arms["cartesian"], baseline))
    lines.append("")
    lines.extend(_block(f"3a polar  tau={arms['polar']['tau']}", arms["polar"], baseline))
    lines.append("")
    lines.extend(_block(f"3b LOCO ({self_train_doc['arm']})  tau={self_train_doc['tau']}", loco, baseline))
    lines.append("")
    lines.append("Go/no-go after 3b, held-out clips:")
    lines.append(f"  bucket: {decision['bucket']}")
    lines.append(f"  continue checks: {json.dumps(decision['continue'])}")
    lines.append(f"  fix-renderer checks: {json.dumps(decision['fix'])}")
    lines.append(
        "  Continue requires coverage >= 85%, wild <= 2%, flips 0, rest within ±0.2 bar on every clip."
    )
    lines.append("  Fix the renderer first if coverage < 70% or wild > 5%. Anything between is Isaac's call.")
    if export:
        lines.append(f"Model files: {json.dumps(export)}")
    if train_time:
        lines.append(
            f"Synthetic training samples {train_time.get('samplesStart')}->{train_time.get('samplesEnd')} "
            f"in {train_time.get('seconds')} s. Self-train {self_train_doc.get('seconds')} s."
        )
    text = "\n".join(lines) + "\n"
    RESULTS_TXT.write_text(text)
    RESULTS_JSON.write_text(json.dumps({
        "winner": winner,
        "synthetic": synth,
        "cartesian3a": arms["cartesian"],
        "polar3a": arms["polar"],
        "loco3b": loco,
        "selfTrain": {k: self_train_doc[k] for k in ("arm", "tau", "seconds", "folds", "pseudo")},
        "goNoGo": decision,
        "export": export,
        "trainTime": train_time,
    }, indent=2))
    print(text)


def _overall_from_txt():
    return None


def eval_real_labels(tag: str) -> None:
    """Rectify the 34 label photos and score both arms. Run after eval-real."""
    manifest = _load_manifest()
    profile = load_profile()
    synth = json.loads((TRAIN / "synth-eval.json").read_text())
    for mode in ("cartesian", "polar"):
        ckpt = torch.load(TRAIN / "checkpoint.pt", map_location="cpu", weights_only=False)
        labels = label_predictions(mode, ckpt, manifest, profile)
        (REAL / f"labels-{mode}-{tag}.json").write_text(json.dumps(labels))
        tau = float(synth["arms"][mode]["tau"]["tau"])
        pred = np.load(REAL / f"pred-{mode}-{tag}.npz")
        summary = summarise(manifest, pred["angle"], pred["conf"], labels, tau, profile)
        (REAL / f"metrics-{mode}-{tag}.json").write_text(json.dumps(summary, indent=2))
        o = summary["overall"]
        print(f"{mode} cov={o['coveragePct']:.1f} med={o['median']} wild={o['wildPct']} flip={o['flipN']} rest={o['restMaxAbs']}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("cache")
    ev = sub.add_parser("eval-real")
    ev.add_argument("--tag", default="3a")
    ev.add_argument("--ckpt", type=Path, default=TRAIN / "checkpoint.pt")
    sub.add_parser("eval-labels")
    st = sub.add_parser("self-train")
    st.add_argument("--steps", type=int, default=125)
    st.add_argument("--pool", type=int, default=4000)
    sub.add_parser("report")
    args = parser.parse_args()
    if args.cmd == "cache":
        cache_real()
    elif args.cmd == "eval-real":
        for mode in ("cartesian", "polar"):
            eval_arm(mode, args.tag, args.ckpt)
        eval_real_labels(args.tag)
    elif args.cmd == "eval-labels":
        eval_real_labels("3a")
    elif args.cmd == "self-train":
        self_train(args.steps, args.pool)
    else:
        write_report()


if __name__ == "__main__":
    main()
