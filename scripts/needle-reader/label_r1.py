#!/usr/bin/env python3
"""Phase R1 auto-labels from the Phase 0 tap-calibrated classical reader.

The reader already ran on every replay frame (8 Hz, the browser replay grid).
This script does not train a model and does not read /workspace/flair-real.
Hand taps are used only afterwards, to measure agreement.

Keep a frame when all of these hold:
  confidence >= 0.55
  the tip lies on the 0–10 arc (161.757° from the calibrated rest, plus a 16° edge)
  forward and backward smoothers (0.25 s) agree within 5°
  the step to the neighbouring valid frame is within 1.5× the profile slew
    (4 bar/s) and never jumps more than 45°
The calibrated rest frame (tap atSec ± 0.5 s) that is off the 0 pin is dropped.
A needle on that pin (within 8°) is stored as exactly 0 bar.
A reading near 10 bar is kept and marked uncertain.
"""
from __future__ import annotations

import json
import math
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

REPO = Path(__file__).resolve().parents[2]
PROFILE_PATH = REPO / "profiles" / "flair58-v1.json"
LABELS_PATH = REPO / "scripts/pressure-label/fixtures/labels-2026-10-22.json"
MANIFEST_PATH = REPO / "scripts/pressure-label/fixtures/manifest-2026-10-22.json"
REPLAY_DIR = Path("/workspace/pl-state/nr/replay")
OUT_DIR = Path("/workspace/pl-state/nr/real")
REVIEW_DIR = Path("/workspace/pl-state/nr/review")
LABELS_OUT = OUT_DIR / "labels-r1.jsonl"
RESULTS_TXT = Path("/workspace/pl-state/nr/phaseR1-results.txt")
RESULTS_JSON = Path("/workspace/pl-state/nr/phaseR1-results.json")
TRAIN = Path("/workspace/flair-train")

CONF_TAU = 0.55
ARC_EDGE_DEG = 16.0
REST_SNAP_DEG = 8.0
REST_WINDOW_S = 0.5
SMOOTH_TAU_S = 0.25
AGREE_DEG = 5.0
SLEW_BAR_PER_S = 4.0
SLEW_MARGIN = 1.5
STEP_FLOOR_DEG = 6.0
MAX_STEP_DEG = 45.0
SLOT_S = 0.125
NEAR10_BAR = 9.0
MATCH_S = 0.08
STORED_W = 1280
STORED_H = 720
BAD_REST_CLIP = "20261018_094055"
REST_PHASES = {"rest", "dry_1", "used_1"}
REVIEW_TARGET = 60


def wrap360(deg: float) -> float:
    return deg % 360.0


def circ(a: float, b: float) -> float:
    return abs((a - b + 180.0) % 360.0 - 180.0)


def clockwise(from_deg: float, to_deg: float) -> float:
    return (to_deg - from_deg) % 360.0


def signed_delta(delta: float) -> float:
    """Clockwise delta in (-180, 180]. Values just under rest stay negative."""
    if delta >= 360.0 - ARC_EDGE_DEG:
        return delta - 360.0
    return delta


def quantile(values: list[float], p: float):
    if not values:
        return None
    ordered = sorted(values)
    index = (len(ordered) - 1) * p
    lo = math.floor(index)
    hi = math.ceil(index)
    if lo == hi:
        return ordered[lo]
    weight = index - lo
    return ordered[lo] * (1.0 - weight) + ordered[hi] * weight


def round_or_none(value, digits: int):
    if value is None or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return round(float(value), digits)


def load_profile() -> dict:
    profile = json.loads(PROFILE_PATH.read_text())
    anchors = profile["scale"]["anchors"]
    arc = float(anchors[-1]["deg"])
    slew = float(profile["maxSlewPerSec"])
    return {
        "arcDeg": arc,
        "slewBarPerS": slew,
        "slewDegPerS": slew * SLEW_MARGIN * (arc / float(profile["scale"]["max"])),
        "near10Deg": arc - ARC_EDGE_DEG,
    }


def exp_smooth(angles, weights, times, forward: bool):
    out = [None] * len(angles)
    order = range(len(angles)) if forward else range(len(angles) - 1, -1, -1)
    cx = cy = 0.0
    prev = None
    for index in order:
        weight = weights[index]
        if prev is None:
            if weight <= 0 or angles[index] is None:
                continue
            theta = math.radians(angles[index])
            cx, cy = math.cos(theta) * weight, math.sin(theta) * weight
            prev = times[index]
        else:
            decay = math.exp(-abs(times[index] - prev) / SMOOTH_TAU_S)
            cx *= decay
            cy *= decay
            if weight > 0 and angles[index] is not None:
                theta = math.radians(angles[index])
                cx += math.cos(theta) * weight
                cy += math.sin(theta) * weight
            prev = times[index]
        if cx * cx + cy * cy < 1e-8:
            continue
        out[index] = wrap360(math.degrees(math.atan2(cy, cx)))
    return out


def step_ok(index, angles, times, valid, slew_deg_s: float) -> bool:
    previous = next_index = None
    for cursor in range(index - 1, -1, -1):
        if valid[cursor]:
            previous = cursor
            break
    for cursor in range(index + 1, len(angles)):
        if valid[cursor]:
            next_index = cursor
            break

    def ok(other: int) -> bool:
        if angles[index] is None or angles[other] is None:
            return False
        gap = circ(angles[index], angles[other])
        if gap > MAX_STEP_DEG:
            return False
        dt = max(SLOT_S, abs(times[index] - times[other]))
        return gap <= max(STEP_FLOOR_DEG, slew_deg_s * dt)

    if previous is not None and not ok(previous):
        return False
    if next_index is not None and not ok(next_index):
        return False
    return previous is not None or next_index is not None


def on_pin(delta: float) -> bool:
    return delta <= REST_SNAP_DEG or delta >= 360.0 - ARC_EDGE_DEG


def in_arc(delta: float, arc_deg: float) -> bool:
    return delta <= arc_deg + ARC_EDGE_DEG or delta >= 360.0 - ARC_EDGE_DEG


def near_ten(delta: float, bar, arc_deg: float, near10_deg: float) -> bool:
    if bar is not None and bar >= NEAR10_BAR:
        return True
    return near10_deg <= delta <= arc_deg + ARC_EDGE_DEG


def label_clip(frames: list[dict], zero_deg: float, at_sec: float, rules: dict, max_time: float | None = None) -> list[dict]:
    """One row per replay frame. Hand taps are not an input.

    max_time is the clip length. The replay harness keeps going and wraps the
    stills; those slots are marked loop and do not enter the smoother.
    """
    arc = rules["arcDeg"]
    near10 = rules["near10Deg"]
    slew = rules["slewDegPerS"]
    angles = []
    weights = []
    times = []
    prepared = []
    for frame in frames:
        rotation = frame.get("gaugeRotationDeg") or 0.0
        raw = frame.get("needleAngleDeg")
        corrected = None if raw is None else wrap360(float(raw) - float(rotation))
        delta = None if corrected is None else clockwise(zero_deg, corrected)
        tracking = frame.get("tracking")
        live = max_time is None or float(frame["timeS"]) < max_time - 1e-9
        has_tip = tracking == "TRACKING" and corrected is not None and frame.get("bar") is not None
        valid = bool(live and has_tip and delta is not None and in_arc(delta, arc))
        confidence = frame.get("confidence")
        angles.append(corrected if valid else None)
        weights.append(float(confidence) if valid and confidence is not None else 0.0)
        times.append(float(frame["timeS"]))
        prepared.append({
            "delta": delta,
            "valid": valid,
            "live": live,
            "raw": None if raw is None else float(raw),
            "rotation": float(rotation),
        })
    forward = exp_smooth(angles, weights, times, True)
    backward = exp_smooth(angles, weights, times, False)
    valid_flags = [item["valid"] for item in prepared]
    rows = []
    for index, frame in enumerate(frames):
        item = prepared[index]
        delta = item["delta"]
        confidence = frame.get("confidence")
        bar = frame.get("bar")
        gap = None
        if forward[index] is not None and backward[index] is not None:
            gap = circ(forward[index], backward[index])
        reason = None
        keep = False
        uncertain = False
        angle_out = None if delta is None else signed_delta(delta)
        bar_out = None if bar is None else float(bar)
        if not item["live"]:
            reason = "loop"
        elif frame.get("tracking") == "CALIBRATING":
            reason = "calibrating"
        elif frame.get("tracking") == "LOST":
            reason = "lost"
        elif item["raw"] is None:
            reason = "no-reading"
        elif frame.get("tracking") != "TRACKING":
            reason = "uncertain-track"
        elif delta is None or not in_arc(delta, arc):
            reason = "out-of-arc"
        elif abs(times[index] - at_sec) <= REST_WINDOW_S and not on_pin(delta):
            reason = "rest-disagree"
        elif confidence is None or float(confidence) < CONF_TAU:
            reason = "low-confidence"
        elif gap is None or gap > AGREE_DEG:
            reason = "smooth-disagree"
        elif not step_ok(index, angles, times, valid_flags, slew):
            reason = "step"
        else:
            keep = True
            if on_pin(delta):
                reason = "rest-pin"
                bar_out = 0.0
                angle_out = 0.0
            elif near_ten(delta, bar_out, arc, near10):
                reason = "near-10"
                uncertain = True
            else:
                reason = "ok"
        rows.append({
            "frame": index,
            "timeS": round(times[index], 4),
            "angle": round_or_none(angle_out, 4),
            "bar": round_or_none(bar_out, 4),
            "confidence": round_or_none(None if confidence is None else float(confidence), 4),
            "keep": keep,
            "reason": reason,
            "uncertain": uncertain,
            "smoothGap": round_or_none(gap, 3),
        })
    return rows


def map_stored_point(x: float, y: float, width: int, height: int, rotation_deg: float):
    quarter = int(round(rotation_deg)) % 360
    if quarter == 90:
        return y, width - 1 - x
    if quarter == 270:
        return height - 1 - y, x
    if quarter == 180:
        return width - 1 - x, height - 1 - y
    return x, y


def image_angle(hub, tip) -> float:
    return wrap360(math.degrees(math.atan2(tip[1] - hub[1], tip[0] - hub[0])))


def truth_bar(needle_deg: float, pin_deg: float, ten_deg: float, offset_deg: float):
    zero = wrap360(pin_deg + offset_deg)
    span = clockwise(zero, ten_deg)
    if not (40.0 < span < 280.0):
        return None
    delta = clockwise(zero, needle_deg)
    if delta > 300.0:
        delta -= 360.0
    if delta < -18.0 or delta > span + 18.0:
        return None
    return max(-0.6, min(10.6, (delta / span) * 10.0))


def probe_rotation(path: Path) -> float:
    probe = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height:stream_side_data=rotation",
            "-of", "json", str(path),
        ],
        check=True, capture_output=True, text=True,
    )
    stream = json.loads(probe.stdout)["streams"][0]
    rotation = 0.0
    for entry in stream.get("side_data_list") or []:
        if entry.get("rotation") is not None:
            rotation = float(entry["rotation"])
    return rotation, int(stream["width"]), int(stream["height"])


def source_video(clip_id: str) -> Path:
    for kind in ("real", "used", "dry"):
        path = TRAIN / kind / f"{clip_id}.mp4"
        if path.exists():
            return path
    raise FileNotFoundError(clip_id)


def load_marks():
    labels = json.loads(LABELS_PATH.read_text())["frames"]
    manifest = json.loads(MANIFEST_PATH.read_text())
    geometry = {}
    marks = []
    for entry in manifest:
        mark = labels[entry["id"]]
        clip = entry["clip"]
        if clip not in geometry:
            rotation, width, height = probe_rotation(source_video(clip))
            geometry[clip] = (rotation, width, height)
        rotation, width, height = geometry[clip]
        sx = STORED_W / width
        sy = STORED_H / height

        def display(point):
            return map_stored_point(point[0] * sx, point[1] * sy, STORED_W, STORED_H, rotation)

        hub = display(mark["hub"])
        tip = display(mark["tip"])
        pin = display(mark["zero"])
        ten = display(mark["ten"])
        marks.append({
            "id": entry["id"],
            "clip": clip,
            "t": float(entry["t"]),
            "phase": entry["phase"],
            "needle": image_angle(hub, tip),
            "pin": image_angle(hub, pin),
            "ten": image_angle(hub, ten),
        })
    return marks


def loco_offset(marks, clip_id: str) -> float:
    deltas = sorted(
        clockwise(mark["pin"], mark["needle"])
        for mark in marks
        if mark["clip"] != clip_id and mark["phase"] in REST_PHASES
    )
    if not deltas:
        deltas = sorted(
            clockwise(mark["pin"], mark["needle"])
            for mark in marks
            if mark["phase"] in REST_PHASES
        )
    return deltas[len(deltas) // 2]


def nearest(rows, time_s: float):
    best = None
    best_dt = 1e9
    for row in rows:
        dt = abs(row["timeS"] - time_s)
        if dt < best_dt:
            best = row
            best_dt = dt
    return best, best_dt


def agreement(by_clip: dict, marks) -> dict:
    per_clip = {}
    overall_err = []
    overall_rows = []
    covered = 0
    flips = 0
    for mark in marks:
        rows = by_clip[mark["clip"]]
        row, dt = nearest(rows, mark["t"])
        truth = truth_bar(mark["needle"], mark["pin"], mark["ten"], loco_offset(marks, mark["clip"]))
        kept = bool(row["keep"] and dt <= MATCH_S)
        pred = row["bar"] if kept else None
        err = None if pred is None or truth is None else pred - truth
        # Flip uses the reader tip on the replay frame, joined back by the caller
        # via needleDeg stored on the row when present.
        needle = row.get("needleDeg")
        flip = bool(kept and needle is not None and circ(needle, mark["needle"]) >= 155.0)
        if kept:
            covered += 1
        if flip:
            flips += 1
        if err is not None:
            overall_err.append(abs(err))
        item = {
            "id": mark["id"],
            "phase": mark["phase"],
            "t": mark["t"],
            "covered": kept,
            "reason": row["reason"],
            "predBar": round_or_none(pred, 4),
            "truthBar": round_or_none(truth, 4),
            "barErr": round_or_none(err, 4),
            "flip": flip,
            "dt": round(dt, 4),
        }
        per_clip.setdefault(mark["clip"], []).append(item)
        overall_rows.append({"clip": mark["clip"], **item})

    def pack(rows):
        errs = [abs(row["barErr"]) for row in rows if row["barErr"] is not None]
        n = len(rows)
        n_cov = sum(1 for row in rows if row["covered"])
        return {
            "n": n,
            "covered": n_cov,
            "coveragePct": round(100.0 * n_cov / n, 1) if n else None,
            "median": round_or_none(quantile(errs, 0.5), 3),
            "p90": round_or_none(quantile(errs, 0.9), 3),
            "max": round_or_none(max(errs) if errs else None, 3),
            "wild": sum(1 for err in errs if err > 1.0),
            "wildPct": round(100.0 * sum(1 for err in errs if err > 1.0) / len(errs), 1) if errs else None,
            "flips": sum(1 for row in rows if row["flip"]),
            "frames": rows,
        }

    clips = {clip: pack(rows) for clip, rows in per_clip.items()}
    return {
        "clips": clips,
        "overall": pack(overall_rows),
        "covered": covered,
        "flips": flips,
        "n": len(marks),
    }


def histogram(bars: list[float]) -> dict:
    bins = []
    for start in range(0, 10):
        count = sum(1 for bar in bars if start <= bar < start + 1)
        bins.append({"lo": start, "hi": start + 1, "n": count})
    bins.append({"lo": 10, "hi": 10, "n": sum(1 for bar in bars if bar >= 10)})
    negative = sum(1 for bar in bars if bar < 0)
    return {"negative": negative, "bins": bins}


def clip_length_s(clip_id: str) -> float:
    """Length of the still strip the reader actually saw, one frame per 125 ms."""
    folder = Path(f"/workspace/pl-data/frames/pressure-frames-png-{clip_id}")
    count = len(list(folder.glob("[0-9][0-9][0-9][0-9].png")))
    if count < 1:
        raise SystemExit(f"missing replay stills for {clip_id}")
    return count * SLOT_S


def still_file(clip_id: str, frame_index: int) -> Path:
    folder = Path(f"/workspace/pl-data/frames/pressure-frames-png-{clip_id}")
    names = sorted(folder.glob("[0-9][0-9][0-9][0-9].png"))
    if not names:
        raise SystemExit(f"missing replay stills for {clip_id}")
    file_index = (frame_index % len(names)) + 1
    path = folder / f"{file_index:04d}.png"
    if not path.exists():
        raise SystemExit(f"missing still {path}")
    return path


def replay_paths():
    paths = sorted(path for path in REPLAY_DIR.glob("*.json") if path.is_file())
    if len(paths) != 10:
        raise SystemExit(f"expected 10 replay json files, found {len(paths)}")
    return paths


def build_labels(rules: dict):
    by_clip = {}
    kind_of = {}
    order = []
    for path in replay_paths():
        payload = json.loads(path.read_text())
        clip = path.stem
        anchors = payload["tapCalibration"]["anchors"]
        rows = label_clip(
            payload["frames"],
            float(anchors["zeroAngleDeg"]),
            float(payload["tapCalibration"]["atSec"]),
            rules,
            max_time=clip_length_s(clip),
        )
        for row, frame in zip(rows, payload["frames"]):
            row["clip"] = clip
            row["needleDeg"] = round_or_none(frame.get("needleAngleDeg"), 4)
        by_clip[clip] = rows
        order.append(clip)
        kind_of[clip] = next(
            kind for kind in ("real", "used", "dry") if (TRAIN / kind / f"{clip}.mp4").exists()
        )
        kept = sum(1 for row in rows if row["keep"])
        print(f"labelled {clip} kept {kept}/{len(rows)}", flush=True)
    return by_clip, kind_of, order


def write_jsonl(by_clip, order):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    tmp = LABELS_OUT.with_suffix(".jsonl.tmp")
    fields = ("clip", "frame", "timeS", "angle", "bar", "confidence", "keep", "reason", "uncertain", "smoothGap")
    with tmp.open("w") as handle:
        for clip in order:
            for row in by_clip[clip]:
                handle.write(json.dumps({key: row[key] for key in fields}, separators=(",", ":")) + "\n")
    tmp.replace(LABELS_OUT)


def clip_stats(by_clip, kind_of, order):
    clips = []
    reasons = Counter()
    kept_bars = []
    for clip in order:
        rows = by_clip[clip]
        drop = Counter(row["reason"] for row in rows if not row["keep"])
        keep_reasons = Counter(row["reason"] for row in rows if row["keep"])
        bars = [row["bar"] for row in rows if row["keep"] and row["bar"] is not None]
        kept_bars.extend(bars)
        reasons.update(row["reason"] for row in rows)
        clips.append({
            "clip": clip,
            "kind": kind_of[clip],
            "frames": len(rows),
            "kept": sum(1 for row in rows if row["keep"]),
            "uncertain": sum(1 for row in rows if row["uncertain"]),
            "keepReasons": dict(keep_reasons),
            "dropReasons": dict(drop),
            "histogram": histogram(bars),
        })
    return clips, dict(reasons), histogram(kept_bars)


def fmt(value, width, digits=3):
    if value is None:
        return "N/A".rjust(width)
    return f"{value:.{digits}f}".rjust(width)


def render_results(rules, clips, reasons, hist, agree) -> str:
    lines = [
        "Phase R1 auto-labels. Classical reader only. No training.",
        "Source: Phase 0 tap-calibrated replay, every 8 Hz frame of the clip (dt=0.125 s).",
        "The replay harness wraps the stills after the clip ends. Those slots are reason=loop and are not labels.",
        f"Confidence threshold: >= {CONF_TAU}.",
        f"Arc: {rules['arcDeg']:.3f}° from calibrated rest, edge {ARC_EDGE_DEG:.0f}°. Out-of-arc directions are dropped (a tail cannot sit on the 0–10 arc).",
        f"Smoothers: exponential, tau {SMOOTH_TAU_S} s, forward/backward must agree within {AGREE_DEG:.0f}°.",
        f"Step: <= {rules['slewDegPerS']:.1f} deg/s ({SLEW_MARGIN}× profile {SLEW_BAR_PER_S:.0f} bar/s) and never more than {MAX_STEP_DEG:.0f}°.",
        f"Rest pin: within {REST_SNAP_DEG:.0f}° of calibrated rest, or the {ARC_EDGE_DEG:.0f}° below-rest edge, stored as 0 bar.",
        f"Calibrated rest window: atSec ± {REST_WINDOW_S} s. Off-pin readings there are rest-disagree, not labels.",
        f"Near 10: bar >= {NEAR10_BAR:.0f} or angle within {ARC_EDGE_DEG:.0f}° of the 10-bar anchor. Kept, uncertain, not dropped.",
        "Hand taps are agreement only. They are not written into labels-r1.jsonl.",
        "",
        "Kept frames. live excludes the wrapped tail after the clip ends. kept% is of live frames.",
        f"{'clip':<16} {'kind':<5} {'live':>7} {'kept':>7} {'kept%':>7} {'uncert':>7}",
    ]
    total_live = 0
    total_kept = 0
    for row in clips:
        live = row["frames"] - row["dropReasons"].get("loop", 0)
        total_live += live
        total_kept += row["kept"]
        pct = 100.0 * row["kept"] / live if live else 0
        lines.append(
            f"{row['clip']:<16} {row['kind']:<5} {live:7d} {row['kept']:7d} {pct:7.1f} {row['uncertain']:7d}"
        )
    lines.append(f"overall kept {total_kept}/{total_live} live frames ({100.0 * total_kept / total_live:.1f}%)")
    lines.append("")
    lines.append("Drop reasons (and keep tags)")
    for clip in clips:
        parts = [f"{key}={value}" for key, value in sorted(clip["dropReasons"].items())]
        keep_parts = [f"{key}={value}" for key, value in sorted(clip["keepReasons"].items())]
        lines.append(f"{clip['clip']}: drop {', '.join(parts) or 'none'}; keep {', '.join(keep_parts) or 'none'}")
    lines.append("overall: " + ", ".join(f"{key}={value}" for key, value in sorted(reasons.items())))
    lines.append("")
    lines.append("Kept bar histogram")
    if hist["negative"]:
        lines.append(f"  <0  {hist['negative']}")
    for bucket in hist["bins"]:
        if bucket["lo"] == 10:
            lines.append(f"  10  {bucket['n']}")
        else:
            lines.append(f"  {bucket['lo']}-{bucket['hi']}  {bucket['n']}")
    lines.append("")
    lines.append("Agreement with the 34 hand taps (covered = kept label within 0.08 s)")
    lines.append(f"{'clip':<16} {'n':>3} {'cov':>4} {'cov%':>6} {'med':>7} {'p90':>7} {'max':>7} {'wild':>5} {'flip':>5}")
    ordered = sorted(agree["clips"])
    for clip in ordered:
        row = agree["clips"][clip]
        lines.append(
            f"{clip:<16} {row['n']:3d} {row['covered']:4d} {fmt(row['coveragePct'], 6, 1)} "
            f"{fmt(row['median'], 7)} {fmt(row['p90'], 7)} {fmt(row['max'], 7)} {row['wild']:5d} {row['flips']:5d}"
        )
    overall = agree["overall"]
    lines.append(
        f"overall n={overall['n']} covered={overall['covered']} ({fmt(overall['coveragePct'], 0, 1)}%) "
        f"median={fmt(overall['median'], 0)} p90={fmt(overall['p90'], 0)} max={fmt(overall['max'], 0)} "
        f"wild={overall['wild']} ({fmt(overall['wildPct'], 0, 1)}%) flips={overall['flips']}"
    )
    lines.append("Wild means absolute bar error > 1. Flip means the kept tip is within 25° of 180° from the tap.")
    lines.append("")
    return "\n".join(lines) + "\n"


def spread_take(candidates, count, chosen, min_gap=2.0, per_clip=None):
    """Take up to `count` new frames. per_clip caps how many this call adds per clip."""
    picked = []
    added = Counter()
    taken = {(row["clip"], row["frame"]) for row in chosen}
    for item in candidates:
        key = (item["clip"], item["frame"])
        if key in taken:
            continue
        if per_clip is not None and added[item["clip"]] >= per_clip:
            continue
        if any(row["clip"] == item["clip"] and abs(row["timeS"] - item["timeS"]) < min_gap for row in chosen + picked):
            continue
        picked.append(item)
        taken.add(key)
        added[item["clip"]] += 1
        if len(picked) >= count:
            break
    return picked


def pick_review(by_clip) -> list[dict]:
    """About 60 uncertain frames: bad rest, near 10, low confidence, smoother gaps, rest, flips."""
    rows = [row for clip_rows in by_clip.values() for row in clip_rows if row["reason"] != "loop"]
    chosen = []
    bad = [row for row in rows if row["clip"] == BAD_REST_CLIP and row["reason"] in {
        "rest-disagree", "low-confidence", "smooth-disagree", "near-10", "step", "out-of-arc",
    }]
    bad.sort(key=lambda row: (
        {"rest-disagree": 0, "out-of-arc": 1, "near-10": 2, "step": 3, "low-confidence": 4, "smooth-disagree": 5}[row["reason"]],
        row["timeS"],
    ))
    chosen.extend(spread_take(bad, 12, chosen, min_gap=2.5))
    near10 = sorted((row for row in rows if row["reason"] == "near-10"), key=lambda row: -(row["bar"] or 0))
    chosen.extend(spread_take(near10, 8, chosen, min_gap=1.0, per_clip=3))
    low = [
        row for row in rows
        if row["confidence"] is not None and abs(row["confidence"] - CONF_TAU) <= 0.05 and row["needleDeg"] is not None
    ]
    low.sort(key=lambda row: abs(row["confidence"] - CONF_TAU))
    chosen.extend(spread_take(low, 12, chosen, min_gap=2.0, per_clip=2))
    disagree = [row for row in rows if row["reason"] == "smooth-disagree" and row["smoothGap"] is not None]
    disagree.sort(key=lambda row: -row["smoothGap"])
    chosen.extend(spread_take(disagree, 12, chosen, min_gap=2.0, per_clip=2))
    rest = [row for row in rows if row["reason"] in {"rest-pin", "rest-disagree"}]
    rest.sort(key=lambda row: (0 if row["reason"] == "rest-disagree" else 1, row["clip"], row["timeS"]))
    chosen.extend(spread_take(rest, 10, chosen, min_gap=2.0, per_clip=2))
    flips = [row for row in rows if row["reason"] in {"out-of-arc", "step"} and row["needleDeg"] is not None]
    flips.sort(key=lambda row: (0 if row["reason"] == "out-of-arc" else 1, row["timeS"]))
    chosen.extend(spread_take(flips, 8, chosen, min_gap=1.5, per_clip=2))
    # Top up thin clips first, then round-robin the buckets. Do not empty one clip into the pack.
    pools = [near10, low, disagree, rest, flips, bad]
    while len(chosen) < REVIEW_TARGET:
        counts = Counter(item["clip"] for item in chosen)
        thin = {clip for clip in by_clip if counts[clip] < 4}
        added = None
        for pool in pools:
            scoped = [row for row in pool if row["clip"] in thin] if thin else pool
            added = spread_take(scoped, 1, chosen, min_gap=1.0, per_clip=1)
            if added:
                break
        if not added:
            break
        chosen.extend(added)
    while len(chosen) > REVIEW_TARGET:
        counts = Counter(item["clip"] for item in chosen)
        removable = [
            index for index, row in enumerate(chosen)
            if counts[row["clip"]] > 3 and not (row["clip"] == BAD_REST_CLIP and row["reason"] == "rest-disagree")
            and row["reason"] == "smooth-disagree"
        ]
        if not removable:
            removable = [
                index for index, row in enumerate(chosen)
                if counts[row["clip"]] > 3 and row["reason"] not in {"rest-disagree", "near-10", "out-of-arc"}
            ]
        if not removable:
            break
        chosen.pop(removable[-1])
    chosen.sort(key=lambda row: (row["clip"], row["timeS"]))
    return chosen


def draw_frame(image: Image.Image, centre, radius, angle_deg, text: str) -> Image.Image:
    canvas = image.convert("RGB")
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.load_default()
    if centre and radius and angle_deg is not None and radius > 5:
        cx, cy = centre
        theta = math.radians(angle_deg)
        length = float(radius) * 0.86
        x1 = cx + length * math.cos(theta)
        y1 = cy + length * math.sin(theta)
        draw.line([(cx, cy), (x1, y1)], fill=(255, 220, 40), width=3)
        draw.ellipse([cx - 4, cy - 4, cx + 4, cy + 4], outline=(255, 80, 80), width=2)
        draw.ellipse([x1 - 4, y1 - 4, x1 + 4, y1 + 4], outline=(80, 220, 255), width=2)
    if text:
        draw.rectangle([8, 8, 8 + 8 * len(text), 26], fill=(0, 0, 0))
        draw.text((12, 10), text, fill=(255, 255, 255), font=font)
    return canvas


def render_review(chosen, by_clip_payload):
    REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    frame_dir = REVIEW_DIR / "frames"
    if frame_dir.exists():
        for stale in frame_dir.glob("*.jpg"):
            stale.unlink()
    frame_dir.mkdir(parents=True, exist_ok=True)
    manifest = []
    for row in chosen:
        payload = by_clip_payload[row["clip"]]
        frame = payload["frames"][row["frame"]]
        rotation = frame.get("gaugeRotationDeg") or 0.0
        centre = None
        if frame.get("centreX") is not None and frame.get("centreY") is not None:
            centre = (float(frame["centreX"]), float(frame["centreY"]))
        radius = frame.get("radius")
        if row["reason"] == "rest-pin":
            draw_deg = wrap360(float(payload["tapCalibration"]["anchors"]["zeroAngleDeg"]) + float(rotation))
        else:
            draw_deg = frame.get("needleAngleDeg")
        bar_text = "no bar" if row["bar"] is None else f"{row['bar']:.2f} bar"
        tag = "KEEP" if row["keep"] else "DROP"
        uncertain = " uncertain" if row["uncertain"] else ""
        text = f"{tag} {bar_text} {row['reason']}{uncertain} c={row['confidence']}"
        dest = frame_dir / f"{row['clip']}-{row['frame']:04d}.jpg"
        if not dest.exists():
            image = Image.open(still_file(row["clip"], row["frame"]))
            if centre and (centre[0] < 0 or centre[1] < 0 or centre[0] >= image.width or centre[1] >= image.height):
                raise SystemExit(
                    f"centre {centre} outside {image.size} for {row['clip']} frame {row['frame']}"
                )
            painted = draw_frame(image, centre, radius, draw_deg, text[:90])
            painted.save(dest, quality=86)
            image.close()
        manifest.append({
            "id": f"{row['clip']}-{row['frame']:04d}",
            "file": f"frames/{row['clip']}-{row['frame']:04d}.jpg",
            "clip": row["clip"],
            "frame": row["frame"],
            "timeS": row["timeS"],
            "bar": row["bar"],
            "angle": row["angle"],
            "confidence": row["confidence"],
            "keep": row["keep"],
            "reason": row["reason"],
            "uncertain": row["uncertain"],
            "cx": None if centre is None else centre[0],
            "cy": None if centre is None else centre[1],
            "radius": radius,
            "drawDeg": None if draw_deg is None else round(float(draw_deg), 3),
        })
    (REVIEW_DIR / "manifest.json").write_text(json.dumps({"frames": manifest}, indent=2) + "\n")
    answers = REVIEW_DIR / "answers.json"
    if not answers.exists():
        answers.write_text('{"frames": {}}\n')
    return manifest


def write_readme(count: int):
    text = f"""Phase R1 review pack
{count} frames. Images stay in this directory. Do not commit or upload them.

Start the page on this box only. It binds to 127.0.0.1 and does not open a tunnel.

  cd /workspace/cursor-dialin-6.42
  python3 scripts/needle-reader/review_r1.py

The process prints a URL with a token, like
  http://127.0.0.1:8765/?token=...
Open that URL on this machine. OK accepts the yellow tip and the printed bar.
Click the true tip to correct that frame. Answers are written to
  /workspace/pl-state/nr/review/answers.json

The yellow line is the proposed tip. The cyan dot is the proposed tip end.
A red dot is the hub. DROP frames are here because they were uncertain;
OK means the drawn tip is right, a click replaces it.
"""
    (REVIEW_DIR / "README.txt").write_text(text)


def self_check():
    rules = load_profile()
    assert abs(rules["arcDeg"] - 161.757) < 1e-6
    # Still, confident, on the pin → 0 bar.
    rest = []
    for index in range(8):
        rest.append({
            "timeS": index * SLOT_S,
            "tracking": "TRACKING",
            "needleAngleDeg": 10.0 + (0.2 if index else 0.0),
            "gaugeRotationDeg": 0,
            "bar": 0.1,
            "confidence": 0.8,
            "centreX": 10,
            "centreY": 10,
            "radius": 40,
        })
    rows = label_clip(rest, zero_deg=10.0, at_sec=0.0, rules=rules)
    assert rows[3]["keep"] and rows[3]["reason"] == "rest-pin" and rows[3]["bar"] == 0.0, rows[3]
    # Tail at 200° is outside the arc.
    tail = []
    for index in range(8):
        tail.append({
            "timeS": 2 + index * SLOT_S,
            "tracking": "TRACKING",
            "needleAngleDeg": 200.0,
            "gaugeRotationDeg": 0,
            "bar": 8.0,
            "confidence": 0.9,
        })
    tail_rows = label_clip(tail, zero_deg=0.0, at_sec=0.0, rules=rules)
    assert all(row["reason"] == "out-of-arc" and not row["keep"] for row in tail_rows), tail_rows[0]
    # Near 10 stays, marked uncertain. Build a flat high reading.
    high = []
    for index in range(8):
        high.append({
            "timeS": 5 + index * SLOT_S,
            "tracking": "TRACKING",
            "needleAngleDeg": 155.0,
            "gaugeRotationDeg": 0,
            "bar": 9.4,
            "confidence": 0.8,
        })
    high_rows = label_clip(high, zero_deg=0.0, at_sec=0.0, rules=rules)
    assert high_rows[4]["keep"] and high_rows[4]["uncertain"] and high_rows[4]["reason"] == "near-10", high_rows[4]
    # A one-frame 180° jump fails the step rule.
    jump = []
    for index in range(8):
        angle = 40.0 if index != 4 else 220.0
        bar = 2.0 if index != 4 else 9.0
        jump.append({
            "timeS": 9 + index * SLOT_S,
            "tracking": "TRACKING",
            "needleAngleDeg": angle,
            "gaugeRotationDeg": 0,
            "bar": bar,
            "confidence": 0.85,
        })
    jump_rows = label_clip(jump, zero_deg=0.0, at_sec=0.0, rules=rules)
    assert jump_rows[4]["reason"] == "out-of-arc" and not jump_rows[4]["keep"]
    assert jump_rows[3]["keep"] and jump_rows[5]["keep"], [row["reason"] for row in jump_rows]
    # Display rotation used for the tap comparison. 180° turns the tip by 180°.
    hub = map_stored_point(100, 100, 1280, 720, -180)
    tip = map_stored_point(140, 100, 1280, 720, -180)
    assert abs(circ(image_angle(hub, tip), 180.0)) < 1e-6
    print("self-check ok", flush=True)


def main():
    if "--self-check" in sys.argv:
        self_check()
        return
    self_check()
    rules = load_profile()
    by_clip, kind_of, order = build_labels(rules)
    write_jsonl(by_clip, order)
    # needleDeg is only for the agreement measurement, not the label file.
    marks = load_marks()
    if len(marks) != 34:
        raise SystemExit(f"expected 34 taps, found {len(marks)}")
    agree = agreement(by_clip, marks)
    clips, reasons, hist = clip_stats(by_clip, kind_of, order)
    text = render_results(rules, clips, reasons, hist, agree)
    RESULTS_TXT.write_text(text)
    body = {
        "thresholds": {
            "confidence": CONF_TAU,
            "arcDeg": rules["arcDeg"],
            "arcEdgeDeg": ARC_EDGE_DEG,
            "smoothTauS": SMOOTH_TAU_S,
            "agreeDeg": AGREE_DEG,
            "slewDegPerS": rules["slewDegPerS"],
            "maxStepDeg": MAX_STEP_DEG,
            "restSnapDeg": REST_SNAP_DEG,
            "restWindowS": REST_WINDOW_S,
            "near10Bar": NEAR10_BAR,
            "sampleS": SLOT_S,
        },
        "clips": clips,
        "reasons": reasons,
        "histogram": hist,
        "agreement": agree,
        "labels": str(LABELS_OUT),
        "frames": sum(row["frames"] for row in clips),
        "kept": sum(row["kept"] for row in clips),
    }
    RESULTS_JSON.write_text(json.dumps(body, indent=2) + "\n")
    payloads = {}
    for path in replay_paths():
        payloads[path.stem] = json.loads(path.read_text())
    chosen = pick_review(by_clip)
    manifest = render_review(chosen, payloads)
    write_readme(len(manifest))
    print(text, flush=True)
    print(f"review frames {len(manifest)} -> {REVIEW_DIR}", flush=True)


if __name__ == "__main__":
    main()
