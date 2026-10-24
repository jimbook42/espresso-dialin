#!/usr/bin/env python3
"""Phase R3a/R3b. Score the R2 folds before any repair.

Review answers are scored with the tracker/manifest pose (cx, cy, radius),
by the fold that held that clip out. Hand labels are reported twice: the
existing ideal-pose score, and the same frames with the tracker pose when
the label image shares the replay pixel grid.

Writes only under /workspace/pl-state/nr/train-r3/. Does not train.
"""
from __future__ import annotations

import json
import math
import os
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

import train_r2 as r2

REVIEW = Path("/workspace/pl-state/nr/review")
R3 = Path("/workspace/pl-state/nr/train-r3")
TRAIN_LOG = Path("/workspace/pl-state/nr/train-r2/train.log")
TAU = 0.06
NEAR10 = 0.65
FOCUS = (
    "20261017_084814",
    "20261017_134943",
    "20261017_135116",
    "20261018_160931",
)


def _med(values):
    return r2._quantile(values, 0.5)


def _round(value, digits=4):
    if value is None or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        return None
    return round(float(value), digits)


def assert_r2_folds_held_out(rows: list[dict]) -> dict:
    """Fail if a fold's training ids include the clip it is scored on.

    R2 checkpoints do not list their rows. Their train log does, and that
    expanded count changes if the held-out clip was included. R3 checkpoints
    store heldOutClip and trainRows.
    """
    import torch
    clips = [clip["id"] for clip in r2.baseline_order()]
    checked = {}
    for fold in clips + ["_all"]:
        train_ids = [i for i, row in enumerate(rows) if fold == "_all" or row["clip"] != fold]
        r2.assert_held_out(rows, fold, train_ids)
        path = r2.OUT / "folds" / f"{fold}.pt"
        if not path.exists():
            raise SystemExit(f"missing fold weights {path}")
        saved = torch.load(path, map_location="cpu", weights_only=False)
        held = saved.get("heldOutClip")
        if fold == "_all" and held not in (None,):
            raise SystemExit(f"REFUSING {path.name}: heldOutClip={held} on the all-clip fold")
        if fold != "_all" and held not in (None, fold):
            raise SystemExit(f"REFUSING {path.name}: heldOutClip={held}, expected {fold}")
        recorded = saved.get("trainRows")
        if recorded is not None and int(recorded) != len(train_ids):
            raise SystemExit(
                f"REFUSING {path.name}: checkpoint trainRows={recorded}, split has {len(train_ids)}"
            )
        checked[fold] = {
            "trainIds": len(train_ids),
            "heldOut": 0 if fold == "_all" else sum(1 for row in rows if row["clip"] == fold),
            "heldOutClip": held,
        }
    if r2.OUT == Path("/workspace/pl-state/nr/train-r2"):
        logged = {}
        for line in TRAIN_LOG.read_text().splitlines():
            if not line.startswith("train ") or " rows=" not in line:
                continue
            parts = line.split()
            logged[parts[1]] = int(parts[2].split("=")[1])
        for fold in clips + ["_all"]:
            train_ids = [i for i, row in enumerate(rows) if fold == "_all" or row["clip"] != fold]
            expanded = sum(r2._repeats(rows[i]) for i in train_ids)
            seen = logged.get(fold)
            if seen != expanded:
                raise SystemExit(
                    f"REFUSING fold {fold}: train log expanded {seen} rows, "
                    f"held-out split expands to {expanded}"
                )
            checked[fold]["trainRowsExpanded"] = expanded
    return checked


def _detail(model, crop: np.ndarray) -> dict:
    import torch
    from needle_model import decode

    x = torch.from_numpy(np.array(crop)).float().div_(255.0)
    with torch.no_grad():
        logits, aux = model(x)
        angle, conf = decode(logits, aux)
        prob = torch.softmax(logits, dim=-1)[0]
        peak = int(torch.argmax(logits, dim=-1)[0])
        opp = (peak + 180) % 360
        offs = torch.arange(-5, 6)
        index = torch.tensor([(opp + int(o)) % 360 for o in offs.tolist()], dtype=torch.long)
        opp_mass = float(torch.gather(prob, 0, index).sum())
    ang = float(angle[0])
    accepted, reason = r2._accept(ang, float(conf[0]), TAU, NEAR10, _detail.profile)
    return {
        "angle": _round(ang),
        "conf": _round(float(conf[0])),
        "predBar": _round(accepted),
        "reason": reason,
        "oppAngle": opp,
        "oppMass": _round(opp_mass),
    }


def _pose_crop(rgba: np.ndarray, pose: dict) -> np.ndarray:
    return r2._crop_u8(rgba, pose, _detail.profile)[None]


def _crop_tip_angle(pose: dict, x: float, y: float) -> float:
    """Angle of an image point in the rectified crop. Matches rectify.source_points."""
    theta = math.radians(float(pose["rotationDeg"]))
    cos = math.cos(theta)
    sin = math.sin(theta)
    scale = float(pose["radius"]) / 40.0
    dx = (float(x) - float(pose["cx"])) / scale
    dy = (float(y) - float(pose["cy"])) / scale
    lx = cos * dx + sin * dy
    ly = -sin * dx + cos * dy
    return r2.wrap360(math.degrees(math.atan2(ly, lx)))


def _ray_luma(crop: np.ndarray, angle_deg: float) -> float:
    """Mean luma along the tip ray. A visible needle is darker than the dial face."""
    rgb = crop[0, :3].astype(np.float32)
    luma = rgb.mean(axis=0)
    theta = math.radians(float(angle_deg))
    samples = []
    for radius in range(16, 38):
        x = int(round(47.5 + math.cos(theta) * radius))
        y = int(round(47.5 + math.sin(theta) * radius))
        if 0 <= x < 96 and 0 <= y < 96:
            samples.append(float(luma[y, x]))
    if not samples:
        return None
    return float(sum(samples) / len(samples))


def _load_rgba_bgr(path: Path) -> np.ndarray:
    return r2._rgba(path)


def score_review(rows: list[dict], models: dict) -> list[dict]:
    manifest = json.loads((REVIEW / "manifest.json").read_text())["frames"]
    answers = json.loads((REVIEW / "answers.json").read_text())["frames"]
    if len(manifest) != 60 or len(answers) != 60:
        raise SystemExit(f"expected 60 review answers, got {len(manifest)}/{len(answers)}")
    isaac = {}
    for row in rows:
        if str(row.get("source", "")).startswith("isaac"):
            isaac[(row["clip"], int(row["frame"]))] = row
    if len(isaac) != 60:
        raise SystemExit(f"expected 60 isaac rows in labels-r2, got {len(isaac)}")
    out = []
    decoded = {}
    for meta in manifest:
        answer = answers.get(meta["id"])
        if answer is None:
            raise SystemExit(f"manifest row {meta['id']} has no answer")
        clip = meta["clip"]
        frame = int(meta["frame"])
        row = isaac.get((clip, frame))
        if row is None:
            raise SystemExit(f"no isaac label for {meta['id']}")
        if meta.get("cx") is None or meta.get("cy") is None or not meta.get("radius"):
            raise SystemExit(f"{meta['id']} has no tracker pose")
        # Live reader pose. Isaac's hub is ignored on purpose.
        pose = {
            "cx": float(meta["cx"]),
            "cy": float(meta["cy"]),
            "radius": float(meta["radius"]),
            "rotationDeg": r2.wrap360(float(row["zero"]) + float(row["rotation"])),
        }
        png = r2.FRAMES / f"pressure-frames-png-{clip}" / row["png"]
        if png not in decoded:
            if len(decoded) > 8:
                decoded.clear()
            decoded[png] = _load_rgba_bgr(png)
        crop = _pose_crop(decoded[png], pose)
        pred = _detail(models[clip], crop)
        truth_angle = None if row.get("cropAngle") is None else float(row["cropAngle"])
        truth_bar = row.get("bar")
        ang_err = None if truth_angle is None or pred["angle"] is None else r2.circ(pred["angle"], truth_angle)
        bar_err = None
        if pred["predBar"] is not None and truth_bar is not None:
            bar_err = float(pred["predBar"]) - float(truth_bar)
        shift = row.get("hubShiftPx")
        tip = answer.get("tip")
        tip_angle = None
        tip_luma = None
        pred_luma = None
        if tip:
            tip_angle = _crop_tip_angle(pose, float(tip["x"]), float(tip["y"]))
            tip_luma = _ray_luma(crop, tip_angle)
        if pred.get("angle") is not None:
            pred_luma = _ray_luma(crop, float(pred["angle"]))
        out.append({
            "id": meta["id"],
            "clip": clip,
            "frame": frame,
            "timeS": row.get("timeS"),
            "source": row["source"],
            "verdict": answer.get("verdict"),
            "hubShiftPx": shift,
            "tracker": {"cx": pose["cx"], "cy": pose["cy"], "radius": pose["radius"]},
            "rotationDeg": _round(pose["rotationDeg"], 3),
            "truthAngle": truth_angle,
            "truthBar": truth_bar,
            "tipCropAngle": _round(tip_angle, 3),
            "tipRayLuma": _round(tip_luma, 1),
            "predRayLuma": _round(pred_luma, 1),
            **pred,
            "angleErr": _round(ang_err, 3),
            "barErr": _round(bar_err),
        })
    return out


def _replay_wh(clip_id: str) -> tuple[int, int]:
    cached = _replay_wh.cache.get(clip_id)
    if cached is not None:
        return cached
    import cv2
    image = cv2.imread(str(r2.png_list(clip_id)[0]), cv2.IMREAD_COLOR)
    if image is None:
        raise SystemExit(f"unreadable replay still for {clip_id}")
    cached = (int(image.shape[1]), int(image.shape[0]))
    _replay_wh.cache[clip_id] = cached
    return cached


_replay_wh.cache = {}


def tracker_on_label(live: dict, label_wh: tuple[int, int], replay_wh: tuple[int, int], hub: tuple[float, float]):
    """Map a replay-frame tracker circle onto a hand-label photo.

    The label photo is the same exposure as the replay still, but some clips
    were saved upright while the replay PNG kept the phone's raw orientation.
    Portrait stills (720x1280) match a 90-degree clockwise label (1280x720),
    and the 4K dry photos are that landscape times 3. Clip 160844's labels
    are the replay frame rotated 180 degrees. The mapping with the smallest
    hub gap is the grid match. A real hub error is a few tens of pixels;
    the wrong grid is hundreds.
    """
    cx = float(live["centreX"])
    cy = float(live["centreY"])
    radius = float(live["radius"])
    lw, lh = label_wh
    rw, rh = replay_wh
    options = []
    if (lw, lh) == (rw, rh):
        options.append(("native", cx, cy, radius))
        options.append(("rot180", rw - cx, rh - cy, radius))
    if (lw, lh) == (rh, rw):
        options.append(("rot90cw", rh - cy, cx, radius))
    if rh and lw == rh * 3 and lh == rw * 3:
        options.append(("rot90cw-x3", 3.0 * (rh - cy), 3.0 * cx, radius * 3.0))
    if not options:
        return None
    def gap(option) -> float:
        return math.hypot(option[1] - hub[0], option[2] - hub[1])
    best = min(options, key=gap)
    return {"map": best[0], "cx": best[1], "cy": best[2], "radius": best[3], "hubGapPx": gap(best)}


def _nearest_replay(payload: dict, time_s: float) -> dict | None:
    best = None
    best_dt = 1e9
    for frame in payload["frames"]:
        if frame.get("timeS") is None:
            continue
        dt = abs(float(frame["timeS"]) - time_s)
        if dt < best_dt:
            best_dt = dt
            best = frame
    if best is None or best_dt > 0.25:
        return None
    best = dict(best)
    best["dt"] = best_dt
    return best


def score_hand(models: dict) -> tuple[list[dict], list[dict]]:
    """Return ideal-pose rows (from the R2 gate file) and tracker-pose rows."""
    profile = _detail.profile
    raw_labels = json.loads((r2.OUT / "raw-labels.json").read_text())
    raw_frames = json.loads((r2.OUT / "raw-frames.json").read_text())
    gated_frames, gated_labels = r2.apply_gate(raw_frames, raw_labels, TAU, NEAR10, False, True, profile)
    ideal_summary = r2.score_gates(gated_frames, gated_labels)
    geometry = {row["id"]: row for row in r2._label_geometry()}
    replay_cache = {}
    tracker_rows = []
    import cv2
    cv2.setNumThreads(2)
    for saved in raw_labels:
        geo = geometry[saved["id"]]
        path = r2.LABEL_DIR / geo["file"]
        bgr = cv2.imread(str(path), cv2.IMREAD_COLOR)
        if bgr is None:
            raise SystemExit(f"missing label image {geo['file']}")
        height, width = bgr.shape[:2]
        record = {
            "id": saved["id"],
            "clip": saved["clip"],
            "phase": saved["phase"],
            "t": saved["t"],
            "truthBar": saved.get("truthBar"),
            "truthDelta": saved.get("truthDelta"),
            "span": saved.get("span"),
            "restPhase": saved.get("restPhase"),
            "idealAngle": saved.get("angle"),
            "idealConf": saved.get("conf"),
            "available": False,
        }
        if saved["clip"] not in replay_cache:
            replay_cache[saved["clip"]] = json.loads((r2.REPLAY / f"{saved['clip']}.json").read_text())
        live = _nearest_replay(replay_cache[saved["clip"]], float(saved["t"]))
        if live is None or not live.get("radius") or live.get("centreX") is None:
            record["why"] = "no tracker pose within 0.25s"
            tracker_rows.append(record)
            continue
        hub = (float(geo["hub"][0]), float(geo["hub"][1]))
        tip = (float(geo["tip"][0]), float(geo["tip"][1]))
        zero_pt = (float(geo["zero"][0]), float(geo["zero"][1]))
        pin = r2._image_angle(hub, zero_pt)
        offset = r2._loco_offset(list(geometry.values()), saved["clip"])
        rest = r2.wrap360(pin + offset)
        mapped = tracker_on_label(live, (width, height), _replay_wh(saved["clip"]), hub)
        if mapped is None:
            record["why"] = f"image {width}x{height} does not match the replay grid"
            tracker_rows.append(record)
            continue
        cx = mapped["cx"]
        cy = mapped["cy"]
        radius = mapped["radius"]
        hub_gap = mapped["hubGapPx"]
        tip_len = math.hypot(tip[0] - hub[0], tip[1] - hub[1])
        ideal_radius = tip_len / float(profile["needle"]["length"])
        record["map"] = mapped["map"]
        if hub_gap > 80:
            record["why"] = f"tracker hub {hub_gap:.0f}px from the label hub after {mapped['map']}"
            record["hubGapPx"] = _round(hub_gap, 1)
            tracker_rows.append(record)
            continue
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        rgba = np.empty((height, width, 4), np.uint8)
        rgba[..., :3] = rgb
        rgba[..., 3] = 255
        pose = {"cx": cx, "cy": cy, "radius": radius, "rotationDeg": rest}
        pred = _detail(models[saved["clip"]], _pose_crop(rgba, pose))
        span = saved.get("span")
        pred_bar = None
        if pred["reason"] is None and span:
            delta = float(pred["angle"])
            signed = delta - 360.0 if delta > 300.0 else delta
            if r2.on_pin(delta):
                pred_bar = 0.0
            else:
                pred_bar = max(-0.6, min(10.6, (signed / float(span)) * 10.0))
        truth = saved.get("truthBar")
        shown = pred_bar is not None and not saved.get("restPhase")
        err = None if not shown or truth is None else pred_bar - float(truth)
        record.update({
            "available": True,
            "why": None,
            "hubGapPx": _round(hub_gap, 1),
            "trackerRadius": _round(radius, 2),
            "idealRadius": _round(ideal_radius, 2),
            "radiusRatio": _round(radius / ideal_radius, 3) if ideal_radius else None,
            "dt": _round(live["dt"], 3),
            "scale": 3.0 if mapped["map"].endswith("x3") else 1.0,
            **pred,
            "predBarSpan": _round(pred_bar),
            "barErr": _round(err),
        })
        tracker_rows.append(record)
    return ideal_summary, gated_labels, tracker_rows


def _clip_table(rows: list[dict], value_key: str, accept_key: str | None = None) -> dict:
    by = defaultdict(list)
    for row in rows:
        if accept_key and not row.get(accept_key):
            continue
        value = row.get(value_key)
        if value is None:
            continue
        by[row["clip"]].append(abs(float(value)))
    clips = []
    all_values = []
    for clip in r2.baseline_order():
        values = by.get(clip["id"], [])
        all_values.extend(values)
        clips.append({
            "id": clip["id"],
            "n": len(values),
            "median": _round(_med(values), 3) if values else None,
        })
    return {"clips": clips, "n": len(all_values), "median": _round(_med(all_values), 3) if all_values else None}


def summarise_review(rows: list[dict]) -> dict:
    accepted = []
    in_arc = []
    angles = []
    for row in rows:
        if row.get("angleErr") is not None:
            angles.append(row)
        if row.get("predBar") is not None and row.get("barErr") is not None:
            in_arc.append({**row, "use": True})
        if row.get("reason") is None and row.get("barErr") is not None:
            accepted.append(row)
    return {
        "n": len(rows),
        "accepted": _clip_table(accepted, "barErr"),
        "inArc": _clip_table(in_arc, "barErr"),
        "angle": _clip_table(angles, "angleErr"),
    }


def summarise_tracker(rows: list[dict]) -> dict:
    usable = [row for row in rows if row.get("available") and row.get("barErr") is not None]
    return {
        "available": sum(1 for row in rows if row.get("available")),
        "skipped": [
            {"id": row["id"], "clip": row["clip"], "why": row.get("why")}
            for row in rows if not row.get("available")
        ],
        "scores": _clip_table(usable, "barErr"),
    }


def diagnose(review: list[dict], hand_tracker: list[dict], gated_labels: list[dict]) -> dict:
    profile = _detail.profile
    raw_frames = json.loads((r2.OUT / "raw-frames.json").read_text())
    by_label = {row["id"]: row for row in gated_labels}
    focus_hand = []
    for row in gated_labels:
        if row["clip"] not in FOCUS:
            continue
        focus_hand.append({
            "id": row["id"],
            "clip": row["clip"],
            "phase": row["phase"],
            "predBar": row.get("predBar"),
            "truthBar": row.get("truthBar"),
            "barErr": row.get("barErr"),
            "needleErr": row.get("needleErr"),
            "reason": row.get("reason"),
            "restPhase": row.get("restPhase"),
            "shown": row.get("shown"),
        })
    focus_review = [row for row in review if row["clip"] in FOCUS]
    # Rest / profile offset: signed angle error on pin-like review frames and on hand rest frames.
    offsets = defaultdict(list)
    for row in review:
        if row.get("truthBar") == 0 or row.get("truthAngle") == 0:
            if row.get("angle") is not None and row.get("truthAngle") is not None:
                signed = (float(row["angle"]) - float(row["truthAngle"]) + 540) % 360 - 180
                offsets[row["clip"]].append(signed)
    rest_offset = {
        clip: {"n": len(values), "medianDeg": _round(_med(values), 2)}
        for clip, values in offsets.items()
    }
    # 160931 rejections from the live gate inputs (raw model angles, before slew).
    clip_frames = [frame for frame in raw_frames if frame["clip"] == "20261018_160931"]
    reasons = defaultdict(int)
    ooa = []
    low = []
    for frame in clip_frames:
        tracking = frame.get("tracking") or "none"
        if tracking in ("LOST", "CALIBRATING") or not frame.get("poseOk") or frame.get("angle") is None:
            reasons[tracking if tracking in ("LOST", "CALIBRATING") else "lost"] += 1
            continue
        angle = float(frame["angle"])
        conf = float(frame["conf"])
        if not r2.in_arc(angle):
            reasons["out-of-arc"] += 1
            opp = (angle + 180.0) % 360.0
            opp_bar = None
            if r2.in_arc(opp):
                opp_bar = 0.0 if r2.on_pin(opp) else r2.signed_bar(opp, profile)
            ooa.append({
                "timeS": frame.get("timeS"),
                "angle": _round(angle, 1),
                "conf": _round(conf, 3),
                "oppAngle": _round(opp, 1),
                "oppInArc": bool(r2.in_arc(opp)),
                "oppBar": _round(opp_bar, 2),
                "belowZeroDeg": _round((360.0 - angle) if angle > 180 else angle, 1),
            })
            continue
        bar = 0.0 if r2.on_pin(angle) else r2.signed_bar(angle, profile)
        scaled = conf
        if bar >= 9.0 or (r2.ARC - r2.ARC_EDGE) <= angle <= r2.ARC + r2.ARC_EDGE:
            scaled *= NEAR10
        if scaled < TAU:
            reasons["low-confidence"] += 1
            low.append({
                "timeS": frame.get("timeS"),
                "angle": _round(angle, 1),
                "bar": _round(bar, 2),
                "conf": _round(conf, 3),
                "near10": bar >= 9.0,
            })
        else:
            reasons["accepted"] += 1
    # Bin the out-of-arc angles and the implied tip if the peak is the tail.
    def _bin(rows, key, width):
        counts = defaultdict(int)
        for row in rows:
            counts[int(float(row[key]) // width) * width] += 1
        return {str(k): counts[k] for k in sorted(counts)}

    low_near10 = sum(1 for row in low if row["near10"])
    low_high = sum(1 for row in low if row["bar"] is not None and row["bar"] >= 7)
    ooa_tail_like = sum(1 for row in ooa if row["oppInArc"] and row["oppBar"] is not None and row["oppBar"] >= 7)
    ooa_near_pin = sum(1 for row in ooa if row["belowZeroDeg"] is not None and row["belowZeroDeg"] <= 30)
    scale = []
    for row in hand_tracker:
        if not row.get("available"):
            continue
        if row["clip"] not in FOCUS:
            continue
        scale.append({
            "id": row["id"],
            "clip": row["clip"],
            "phase": row["phase"],
            "hubGapPx": row.get("hubGapPx"),
            "idealRadius": row.get("idealRadius"),
            "trackerRadius": row.get("trackerRadius"),
            "radiusRatio": row.get("radiusRatio"),
            "idealAngle": row.get("idealAngle"),
            "trackerAngle": row.get("angle"),
            "truthBar": row.get("truthBar"),
            "barErr": row.get("barErr"),
            "reason": row.get("reason"),
        })
    return {
        "handFrames": focus_hand,
        "reviewFrames": [
            {
                "id": row["id"],
                "clip": row["clip"],
                "timeS": row["timeS"],
                "source": row["source"],
                "truthBar": row["truthBar"],
                "truthAngle": row["truthAngle"],
                "angle": row["angle"],
                "conf": row["conf"],
                "predBar": row["predBar"],
                "barErr": row["barErr"],
                "angleErr": row["angleErr"],
                "reason": row["reason"],
                "hubShiftPx": row["hubShiftPx"],
                "oppAngle": row["oppAngle"],
                "oppMass": row["oppMass"],
            }
            for row in focus_review
        ],
        "restOffsetDeg": rest_offset,
        "handById": {row["id"]: row for row in by_label if False},
        "clip160931": {
            "frames": len(clip_frames),
            "reasons": dict(reasons),
            "outOfArc": ooa,
            "outOfArcBins": _bin(ooa, "angle", 10),
            "tailLike": ooa_tail_like,
            "within30OfZero": ooa_near_pin,
            "lowConfidence": low,
            "lowConfidenceN": len(low),
            "lowNear10": low_near10,
            "lowBarAtLeast7": low_high,
        },
        "focusScale": scale,
    }


def _fmt(value, digits=3):
    if value is None:
        return "N/A"
    return f"{float(value):.{digits}f}"


def render_report(loco: dict, ideal: dict, review_sum: dict, tracker_sum: dict, diagnosis: dict) -> str:
    lines = [
        "Phase R3a. R2 leave-one-clip-out weights, no retraining.",
        "Review answers use the tracker/manifest pose. Truth is Isaac's angle (fix) or the verified auto angle (ok).",
        "Hand labels keep the R2 ideal-pose score. A second column uses the tracker centre and radius on the same photo when it shares the replay grid.",
        "Gate for accepted review bars: tau=0.06 near10=0.65, same as the R2 final config. Slew is not applied to stills.",
        "",
        "Leave-one-clip-out check. Each fold's expanded training rows match the train log, and the split excludes that clip.",
    ]
    for fold, info in loco.items():
        lines.append(
            f"  {fold} trainIds={info['trainIds']} heldOut={info['heldOut']} heldOutClip={info['heldOutClip']}"
        )
    lines.append("")
    lines.append("Hand-label ideal pose (R2 gate, the published score).")
    lines.append(
        f"  pooled median={_fmt(ideal['overall']['median'])} n={ideal['overall']['labelN']} "
        f"wild={_fmt(ideal['overall']['wildPct'], 1)} flips={ideal['overall']['flipN']}"
    )
    lines.append(f"{'clip':<18} {'n':>4} {'median':>8} {'cov':>8}")
    for clip in ideal["clips"]:
        lines.append(
            f"{clip['id']:<18} {clip['labelN']:4d} {_fmt(clip['median']):>8} {_fmt(clip['coveragePct'], 1):>8}"
        )
    lines.append("")
    lines.append("Hand-label tracker pose (accepted non-rest bars).")
    lines.append(
        f"  available={tracker_sum['available']} pooled median={_fmt(tracker_sum['scores']['median'])} "
        f"n={tracker_sum['scores']['n']}"
    )
    if tracker_sum["skipped"]:
        lines.append("  skipped: " + ", ".join(f"{row['id']} ({row['why']})" for row in tracker_sum["skipped"]))
    lines.append(f"{'clip':<18} {'n':>4} {'median':>8}")
    for clip in tracker_sum["scores"]["clips"]:
        lines.append(f"{clip['id']:<18} {clip['n']:4d} {_fmt(clip['median']):>8}")
    lines.append("")
    lines.append("Review answers, tracker pose.")
    acc = review_sum["accepted"]
    arc = review_sum["inArc"]
    ang = review_sum["angle"]
    lines.append(
        f"  n={review_sum['n']} accepted median={_fmt(acc['median'])} n={acc['n']} "
        f"in-arc median={_fmt(arc['median'])} n={arc['n']} angle-median={_fmt(ang['median'], 2)} deg"
    )
    lines.append(f"{'clip':<18} {'accN':>5} {'accMed':>8} {'arcN':>5} {'arcMed':>8} {'angMed':>8}")
    by_acc = {row["id"]: row for row in acc["clips"]}
    by_arc = {row["id"]: row for row in arc["clips"]}
    by_ang = {row["id"]: row for row in ang["clips"]}
    for clip in r2.baseline_order():
        cid = clip["id"]
        lines.append(
            f"{cid:<18} {by_acc[cid]['n']:5d} {_fmt(by_acc[cid]['median']):>8} "
            f"{by_arc[cid]['n']:5d} {_fmt(by_arc[cid]['median']):>8} {_fmt(by_ang[cid]['median'], 2):>8}"
        )
    lines.append("")
    lines.append("R3b diagnosis, before any repair.")
    lines.append("Hand-label frames that set the failing medians (ideal pose, R2 gate):")
    for row in diagnosis["handFrames"]:
        if row.get("restPhase"):
            continue
        lines.append(
            f"  {row['id']} {row['clip']} {row['phase']} pred={_fmt(row.get('predBar'))} "
            f"truth={_fmt(row.get('truthBar'))} err={_fmt(row.get('barErr'))} "
            f"needle={_fmt(row.get('needleErr'), 1)} reason={row.get('reason')}"
        )
    lines.append("Review frames on those clips (tracker pose):")
    for row in diagnosis["reviewFrames"]:
        lines.append(
            f"  {row['id']} {row['clip']} t={row['timeS']} {row['source']} "
            f"truthBar={row['truthBar']} pred={row['predBar']} err={row['barErr']} "
            f"angErr={row['angleErr']} conf={row['conf']} reason={row['reason']} "
            f"hubShift={row['hubShiftPx']} oppMass={row['oppMass']}"
        )
    lines.append("Signed angle error on review frames whose truth is the pin (median degrees, pred-truth):")
    for clip, info in sorted(diagnosis["restOffsetDeg"].items()):
        lines.append(f"  {clip} n={info['n']} median={info['medianDeg']}")
    cov = diagnosis["clip160931"]
    lines.append(
        f"160931 live frames {cov['frames']} reasons={cov['reasons']} "
        f"out-of-arc tail-like (opposite in arc and >=7 bar)={cov['tailLike']} "
        f"within 30 deg below zero={cov['within30OfZero']} "
        f"low-conf n={cov['lowConfidenceN']} of which bar>=7 {cov['lowBarAtLeast7']} near10 {cov['lowNear10']}"
    )
    lines.append(f"160931 out-of-arc angle bins: {cov['outOfArcBins']}")
    lines.append("160931 out-of-arc frames:")
    for row in cov["outOfArc"]:
        lines.append(
            f"  t={row['timeS']} angle={row['angle']} conf={row['conf']} "
            f"opp={row['oppAngle']} oppBar={row['oppBar']} belowZero={row['belowZeroDeg']}"
        )
    lines.append("Tracker vs ideal radius on the focus hand labels:")
    for row in diagnosis["focusScale"]:
        lines.append(
            f"  {row['id']} {row['phase']} hubGap={row['hubGapPx']} "
            f"idealR={row['idealRadius']} trackerR={row['trackerRadius']} ratio={row['radiusRatio']} "
            f"idealAng={row['idealAngle']} trackerAng={row['trackerAngle']} err={row['barErr']}"
        )
    lines.append("")
    return "\n".join(lines) + "\n"


def _run_exam(frames, labels, latency: dict) -> str:
    exam_in = r2.OUT / "exam-input.json"
    exam_txt = r2.OUT / "exam-r3.txt"
    exam_json = r2.OUT / "exam-r3.json"
    exam_in.write_text(json.dumps(r2._exam_input(frames, labels, latency)))
    env = {
        **os.environ,
        "TZ": "UTC",
        "NEEDLE_R2_EXAM": str(exam_in),
        "NEEDLE_EXAM_TXT": str(exam_txt),
        "NEEDLE_EXAM_JSON": str(exam_json),
        "NEEDLE_EXAM_TITLE": "Phase R3 exam. Leave-one-clip-out repair-1 model, same metric functions as the Phase 0 baseline.",
    }
    result = subprocess.run(
        ["node", "scripts/needle-reader/exam.mjs", "--r2"],
        cwd=str(r2.REPO),
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise SystemExit(f"exam failed\n{result.stderr[-2000:]}\n{result.stdout[-2000:]}")
    return result.stdout


def _gate_row(summary: dict) -> dict:
    """R3 gates. Dry-clip coverage is reported and is not a miss."""
    overall = summary["overall"]
    r2_median = 0.172
    focus = {
        "20261017_084814": 0.25,
        "20261017_134943": 0.25,
        "20261017_135116": 0.25,
    }
    by_id = {clip["id"]: clip for clip in summary["clips"]}
    checks = {
        "pooledMedian": overall["median"] is not None and overall["median"] <= r2_median,
        "pooledWild": overall["wildPct"] is not None and overall["wildPct"] <= 2,
        "flips": overall["flipN"] == 0,
        "rest": overall["restMaxAbs"] is not None and overall["restMaxAbs"] <= 0.2,
        "160931Coverage": by_id["20261018_160931"]["coveragePct"] is not None and by_id["20261018_160931"]["coveragePct"] >= 85,
    }
    for clip_id, limit in focus.items():
        med = by_id[clip_id]["median"]
        checks[f"{clip_id}Median"] = med is not None and med <= limit
    return {
        "checks": {key: "PASS" if value else "FAIL" for key, value in checks.items()},
        "verdict": "GO" if all(checks.values()) else "NO-GO",
    }


def write_phase_results(ideal, review_sum, tracker_sum, exam_text: str, review_rows: list[dict]) -> None:
    r2_review = 0.231
    acc = review_sum["accepted"]
    review_ok = acc["median"] is not None and acc["median"] <= r2_review + 1e-9
    judged = _gate_row(ideal)
    if not review_ok:
        judged["checks"]["reviewMedian"] = "FAIL"
        judged["verdict"] = "NO-GO"
    else:
        judged["checks"]["reviewMedian"] = "PASS"
    lines = [
        "Phase R3 results. Repair-1 weights scored leave-one-clip-out. No second retrain.",
        "Hand-label ideal pose is the published exam score (label hub, dial radius = tip length / 0.86).",
        "Review answers use the tracker pose on the review PNG. Truth is Isaac's angle, or the verified auto angle.",
        "Hand-label tracker pose maps the replay circle onto the label photo before the hub-gap check.",
        "Old tracker column treated every label as 1280x720 or a 3x scale of that, and skipped gaps above 160 px.",
        "That compared portrait tracker coordinates (720x1280) with landscape label photos, so the gap was 178-1091 px.",
        "New column: rot90cw for portrait stills, rot90cw times 3 for the 4K dry photos, rot180 for 160844, native otherwise.",
        "Gate tau=0.06 near10=0.65 slew=false restWindow=true, the R2 final config. Dry clips 225219 and 225307 are not coverage gates.",
        "",
        "Hand-label ideal pose, R2 then R3.",
        f"  R2 pooled median=0.172 n=23 wild=0.0 flips=0 restMax=0.000",
        f"  R3 pooled median={_fmt(ideal['overall']['median'])} n={ideal['overall']['labelN']} "
        f"wild={_fmt(ideal['overall']['wildPct'], 1)} flips={ideal['overall']['flipN']} "
        f"restMax={_fmt(ideal['overall']['restMaxAbs'])}",
        f"{'clip':<18} {'R2med':>8} {'R3med':>8} {'R2cov':>8} {'R3cov':>8} {'R3n':>5}",
    ]
    r2_med = {
        "20261017_084814": 0.358, "20261017_134943": 0.274, "20261018_094055": 0.100,
        "20261018_160844": 0.227, "20261017_084919": 0.031, "20261017_135116": 0.325,
        "20261018_094151": 0.148, "20261018_160931": 0.130, "20261015_225219": None,
        "20261015_225307": None,
    }
    r2_cov = {
        "20261017_084814": 98.0, "20261017_134943": 93.3, "20261018_094055": 94.1,
        "20261018_160844": 94.5, "20261017_084919": 99.2, "20261017_135116": 98.4,
        "20261018_094151": 91.2, "20261018_160931": 78.7, "20261015_225219": 75.4,
        "20261015_225307": 62.8,
    }
    for clip in ideal["clips"]:
        lines.append(
            f"{clip['id']:<18} {_fmt(r2_med[clip['id']]):>8} {_fmt(clip['median']):>8} "
            f"{_fmt(r2_cov[clip['id']], 1):>8} {_fmt(clip['coveragePct'], 1):>8} {clip['labelN']:5d}"
        )
    lines.append("")
    lines.append("Review answers, tracker pose.")
    lines.append(f"  R2 accepted median=0.231 n=54. 094055 accepted median=6.461 angle-median=135.46 deg.")
    lines.append(
        f"  R3 accepted median={_fmt(acc['median'])} n={acc['n']} "
        f"angle-median={_fmt(review_sum['angle']['median'], 2)} deg"
    )
    lines.append(f"{'clip':<18} {'R3n':>5} {'R3med':>8} {'R3ang':>8}")
    by_acc = {row["id"]: row for row in acc["clips"]}
    by_ang = {row["id"]: row for row in review_sum["angle"]["clips"]}
    for clip in r2.baseline_order():
        cid = clip["id"]
        lines.append(
            f"{cid:<18} {by_acc[cid]['n']:5d} {_fmt(by_acc[cid]['median']):>8} {_fmt(by_ang[cid]['median'], 2):>8}"
        )
    lines.append("")
    lines.append("Hand-label tracker pose after the coordinate fix (accepted non-rest bars).")
    lines.append(
        f"  available={tracker_sum['available']} pooled median={_fmt(tracker_sum['scores']['median'])} "
        f"n={tracker_sum['scores']['n']}"
    )
    if tracker_sum["skipped"]:
        lines.append("  skipped: " + ", ".join(f"{row['id']} ({row['why']})" for row in tracker_sum["skipped"]))
    for clip in tracker_sum["scores"]["clips"]:
        lines.append(f"  {clip['id']} n={clip['n']} median={_fmt(clip['median'])}")
    lines.append("")
    lines.append("Gates")
    for key, value in judged["checks"].items():
        lines.append(f"  {key} {value}")
    lines.append(f"verdict {judged['verdict']}")
    lines.append("")
    lines.append("094055 review pose check. Tip-in-crop angle is the click mapped through the tracker pose.")
    lines.append("If that angle matches the truth, the crop grid is the one the label used and the miss is the model.")
    focus = [row for row in review_rows if row["clip"] == "20261018_094055"]
    for row in focus:
        lines.append(
            f"  {row['id']} truth={row['truthAngle']} tipCrop={row.get('tipCropAngle')} pred={row['angle']} "
            f"angErr={row['angleErr']} barErr={row['barErr']} conf={row['conf']} "
            f"tipLuma={row.get('tipRayLuma')} predLuma={row.get('predRayLuma')} hubShift={row['hubShiftPx']}"
        )
    lines.append("")
    lines.append("Exam harness")
    lines.append(exam_text.rstrip())
    lines.append("")
    text = "\n".join(lines) + "\n"
    out_txt = Path("/workspace/pl-state/nr/phaseR3-results.txt")
    out_json = Path("/workspace/pl-state/nr/phaseR3-results.json")
    out_txt.write_text(text)
    out_json.write_text(json.dumps({
        "verdict": judged,
        "ideal": ideal,
        "reviewSummary": review_sum,
        "trackerSummary": {
            "available": tracker_sum["available"],
            "scores": tracker_sum["scores"],
            "skipped": tracker_sum["skipped"],
        },
        "r2": {"handMedian": 0.172, "reviewMedian": r2_review},
    }, indent=2) + "\n")
    print(text, flush=True)


def main() -> None:
    import cv2
    score_r3_models = "--r3" in sys.argv
    if "--out" in sys.argv:
        r2.OUT = Path(sys.argv[sys.argv.index("--out") + 1])
    elif score_r3_models:
        r2.OUT = R3
    cv2.setNumThreads(2)
    R3.mkdir(parents=True, exist_ok=True)
    print(f"scoring folds in {r2.OUT}", flush=True)
    _detail.profile = r2.load_profile()
    rows = r2.load_train_rows()
    loco = assert_r2_folds_held_out(rows)
    print("loco ok", flush=True)
    if score_r3_models and not (r2.OUT / "raw-frames.json").exists():
        print("predicting R3 folds", flush=True)
        r2.predict()
    clips = sorted({row["clip"] for row in rows})
    models = {clip: r2._load_fold(clip) for clip in clips}
    review = score_review(rows, models)
    print(f"review {len(review)}", flush=True)
    ideal, gated_labels, tracker_rows = score_hand(models)
    print(
        f"ideal median {ideal['overall']['median']} tracker available "
        f"{sum(1 for row in tracker_rows if row.get('available'))}",
        flush=True,
    )
    review_sum = summarise_review(review)
    tracker_sum = summarise_tracker(tracker_rows)
    diagnosis = diagnose(review, tracker_rows, gated_labels)
    report = render_report(loco, ideal, review_sum, tracker_sum, diagnosis)
    payload = {
        "loco": loco,
        "ideal": ideal,
        "reviewSummary": review_sum,
        "trackerSummary": tracker_sum,
        "review": review,
        "handTracker": tracker_rows,
        "diagnosis": diagnosis,
        "gate": {"tau": TAU, "near10": NEAR10},
        "weights": str(r2.OUT),
    }
    if score_r3_models:
        (R3 / "r3-model-report.txt").write_text(report)
        (R3 / "r3-model-scores.json").write_text(json.dumps(payload) + "\n")
        profile = _detail.profile
        raw_frames = json.loads((r2.OUT / "raw-frames.json").read_text())
        raw_labels = json.loads((r2.OUT / "raw-labels.json").read_text())
        gated_frames, gated_from_raw = r2.apply_gate(raw_frames, raw_labels, TAU, NEAR10, False, True, profile)
        latency_path = Path("/workspace/pl-state/nr/train-r2/export/latency.json")
        latency = json.loads(latency_path.read_text()) if latency_path.exists() else {"model4xMs": None, "total4xMs": None}
        latency = dict(latency)
        latency["note"] = "R2 int8 measurement. R3 uses the same Cartesian net (17962 parameters) and was not re-exported."
        exam_text = _run_exam(gated_frames, gated_from_raw, latency)
        write_phase_results(r2.score_gates(gated_frames, gated_from_raw), review_sum, tracker_sum, exam_text, review)
    else:
        (R3 / "r3a-report.txt").write_text(report)
        (R3 / "r3b-diagnosis.txt").write_text(report)
        (R3 / "r3a-scores.json").write_text(json.dumps(payload) + "\n")
        (R3 / "r3b-diagnosis.json").write_text(json.dumps(diagnosis) + "\n")
        print(report, flush=True)


if __name__ == "__main__":
    main()
