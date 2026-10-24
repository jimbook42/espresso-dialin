#!/usr/bin/env python3
"""Phase R2a. Merge Isaac's review answers onto the R1 keep set.

Review clicks are in the JPEG's natural pixel space. Those JPEGs are the
replay PNGs (same width and height, no rescale) with an overlay. Rectify
reads those same pixels. The browser replay displays PNG ((frame + 4) % n);
the review pack drew PNG (frame % n), four slots (0.5 s) earlier. Isaac's
tip belongs to the picture he saw. Auto labels belong to the picture the
reader scored. Both use the replay frame's hub and tap zero.

Writes only under /workspace/pl-state/nr/real/.
"""
from __future__ import annotations

import json
import math
import sys
from collections import defaultdict
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))

from gauge_profile import load_gauge_profile  # noqa: E402
from label_r1 import (  # noqa: E402
    ARC_EDGE_DEG,
    clockwise,
    in_arc,
    on_pin,
    quantile,
    signed_delta,
    wrap360,
)

REPO = Path(__file__).resolve().parents[2]
PROFILE_PATH = REPO / "profiles" / "flair58-v1.json"
REAL = Path("/workspace/pl-state/nr/real")
REVIEW = Path("/workspace/pl-state/nr/review")
REPLAY = Path("/workspace/pl-state/nr/replay")
FRAMES = Path("/workspace/pl-data/frames")
LABELS_R1 = REAL / "labels-r1.jsonl"
LABELS_R2 = REAL / "labels-r2.jsonl"
STATS_TXT = REAL / "labels-r2-stats.txt"
STATS_JSON = REAL / "labels-r2-stats.json"
ISAAC_WEIGHT = 4.0
AUTO_WEIGHT = 1.0
# Browser still loop starts at slot 4. See FlairPressureLab.jsx.
READER_SLOT0 = 4


def image_angle(hub, tip) -> float:
    return wrap360(math.degrees(math.atan2(tip[1] - hub[1], tip[0] - hub[0])))


def pngs_for(clip_id: str) -> list[Path]:
    folder = FRAMES / f"pressure-frames-png-{clip_id}"
    names = sorted(folder.glob("[0-9][0-9][0-9][0-9].png"))
    if not names:
        raise SystemExit(f"missing replay stills for {clip_id}")
    return names


def review_png(names: list[Path], frame: int) -> Path:
    return names[frame % len(names)]


def reader_png(names: list[Path], frame: int) -> Path:
    return names[(frame + READER_SLOT0) % len(names)]


def signed_bar(angle_deg: float, profile: dict) -> float:
    """Piecewise profile. Angles just below rest stay a small negative bar."""
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
    for index in range(1, len(anchors)):
        right = anchors[index]
        left = anchors[index - 1]
        if angle <= right["deg"]:
            span = right["deg"] - left["deg"]
            t = 0.0 if span == 0 else (angle - left["deg"]) / span
            return left["value"] + t * (right["value"] - left["value"])
    return float(anchors[-1]["value"])


def load_r1() -> list[dict]:
    rows = []
    for line in LABELS_R1.read_text().splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def load_replay(clip_id: str) -> dict:
    return json.loads((REPLAY / f"{clip_id}.json").read_text())


def round_or_none(value, digits: int):
    if value is None or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return round(float(value), digits)


def bar_from_delta(delta: float, profile: dict) -> tuple[float | None, float, bool, bool]:
    """Return bar, stored profile angle, out_of_arc, on_pin_snap.

    A tip on the 0 pin (or on the rest needle, which is the pin plus the
    5.8° rest offset) is 0 bar. Directions outside the 0–10 arc plus the
    16° edge are flagged and kept.
    """
    arc = float(profile["scale"]["anchors"][-1]["deg"])
    outside = not in_arc(delta, arc)
    if on_pin(delta):
        return 0.0, 0.0, False, True
    stored = signed_delta(delta)
    if outside:
        return None, round(stored, 4), True, False
    return round(signed_bar(delta, profile), 4), round(stored, 4), False, False


def check_space(manifest_frames: list[dict]) -> dict:
    """JPEG pixels vs the PNG the review pack painted, and vs the reader PNG."""
    mismatches = []
    sizes = {}
    for frame in manifest_frames:
        names = pngs_for(frame["clip"])
        review = review_png(names, int(frame["frame"]))
        reader = reader_png(names, int(frame["frame"]))
        jpeg_path = REVIEW / frame["file"]
        with Image.open(jpeg_path) as jpeg, Image.open(review) as png:
            jpeg_size = jpeg.size
            png_size = png.size
        sizes[frame["clip"]] = {"jpeg": list(jpeg_size), "reviewPng": list(png_size)}
        cx, cy = frame.get("cx"), frame.get("cy")
        inside = (
            cx is not None and cy is not None
            and 0 <= float(cx) < jpeg_size[0] and 0 <= float(cy) < jpeg_size[1]
        )
        if jpeg_size != png_size or not inside:
            mismatches.append({
                "id": frame["id"],
                "jpeg": list(jpeg_size),
                "reviewPng": list(png_size),
                "cx": cx,
                "cy": cy,
                "inside": inside,
            })
        # Same file family: reader PNG is a different slot, same dimensions.
        with Image.open(reader) as other:
            if other.size != png_size:
                mismatches.append({"id": frame["id"], "readerSize": list(other.size)})
    return {
        "match": not mismatches,
        "checked": len(manifest_frames),
        "mismatches": mismatches,
        "sizes": sizes,
        "reviewIndex": "(frame % n) + 1",
        "readerIndex": "((frame + 4) % n) + 1",
        "note": (
            "Review JPEG size equals the review PNG. Clicks use natural image pixels, "
            "which are those PNG pixels. Manifest cx,cy is the replay centre and lies "
            "inside the image. Rectify samples that pixel grid. No scale or rotation "
            "mapping is required. The review PNG is four 125 ms slots earlier than the "
            "PNG the browser reader scored for the same frame index."
        ),
    }


def merge() -> dict:
    profile = load_gauge_profile(str(PROFILE_PATH))
    manifest = json.loads((REVIEW / "manifest.json").read_text())["frames"]
    answers = json.loads((REVIEW / "answers.json").read_text())["frames"]
    if len(manifest) != 60 or len(answers) != 60:
        raise SystemExit(f"expected 60/60, manifest={len(manifest)} answers={len(answers)}")
    space = check_space(manifest)
    if not space["match"]:
        raise SystemExit(f"review pixel space does not match the stills: {space['mismatches'][:3]}")

    by_id = {frame["id"]: frame for frame in manifest}
    r1_rows = load_r1()
    r1_index = defaultdict(dict)
    for row in r1_rows:
        r1_index[row["clip"]][int(row["frame"])] = row

    replay_cache = {}
    png_cache = {}

    def replay_frame(clip_id: str, frame: int) -> dict:
        if clip_id not in replay_cache:
            replay_cache[clip_id] = load_replay(clip_id)
            png_cache[clip_id] = pngs_for(clip_id)
        payload = replay_cache[clip_id]
        if frame < 0 or frame >= len(payload["frames"]):
            raise SystemExit(f"{clip_id} frame {frame} outside replay")
        return payload["frames"][frame], payload

    overrides = []
    replaced = set()
    for frame_id, answer in answers.items():
        meta = by_id.get(frame_id)
        if meta is None:
            raise SystemExit(f"answer without manifest row {frame_id}")
        verdict = answer.get("verdict")
        if verdict not in ("ok", "fix"):
            raise SystemExit(f"{frame_id} verdict {verdict}")
        clip = meta["clip"]
        frame = int(meta["frame"])
        live, payload = replay_frame(clip, frame)
        zero = float(payload["tapCalibration"]["anchors"]["zeroAngleDeg"])
        rotation = float(live.get("gaugeRotationDeg") or 0.0)
        prior = r1_index[clip].get(frame)
        if prior is None:
            raise SystemExit(f"no r1 row for {frame_id}")
        hub_source = "manifest"
        if verdict == "fix" and answer.get("hub"):
            hub = (float(answer["hub"]["x"]), float(answer["hub"]["y"]))
            hub_source = "isaac"
        else:
            if meta.get("cx") is None or meta.get("cy") is None:
                raise SystemExit(f"{frame_id} has no hub")
            hub = (float(meta["cx"]), float(meta["cy"]))
        shift = None
        if meta.get("cx") is not None and meta.get("cy") is not None:
            shift = math.hypot(hub[0] - float(meta["cx"]), hub[1] - float(meta["cy"]))
        if verdict == "ok":
            angle = prior.get("angle")
            bar = prior.get("bar")
            crop = None if angle is None else wrap360(float(angle))
            outside = False
            pin = prior.get("reason") == "rest-pin"
            tip = None
        else:
            tip_pt = answer.get("tip")
            if not tip_pt:
                raise SystemExit(f"{frame_id} fix without a tip")
            tip = (float(tip_pt["x"]), float(tip_pt["y"]))
            seen = image_angle(hub, tip)
            delta = clockwise(zero, wrap360(seen - rotation))
            bar, angle, outside, pin = bar_from_delta(delta, profile)
            crop = wrap360(delta if not pin else 0.0)
        names = png_cache[clip]
        row = {
            "clip": clip,
            "frame": frame,
            "timeS": prior.get("timeS"),
            "angle": angle,
            "bar": bar,
            "cropAngle": None if crop is None else round(crop, 4),
            "confidence": prior.get("confidence"),
            "keep": True,
            "reason": prior.get("reason"),
            "uncertain": bool(prior.get("uncertain")),
            "weight": ISAAC_WEIGHT,
            "source": "isaac-ok" if verdict == "ok" else "isaac-fix",
            "verified": True,
            "outOfArc": bool(outside),
            "onPin": bool(pin),
            "hubShiftPx": round_or_none(shift, 3),
            "hubSource": hub_source,
            "cx": round(hub[0], 3),
            "cy": round(hub[1], 3),
            "radius": live.get("radius"),
            "zero": round(zero, 4),
            "rotation": round(rotation, 4),
            "png": (review_png(names, frame)).name,
            "pngRole": "review",
        }
        if tip is not None:
            row["tipX"] = round(tip[0], 3)
            row["tipY"] = round(tip[1], 3)
        overrides.append(row)
        replaced.add((clip, frame))

    merged = []
    for row in r1_rows:
        key = (row["clip"], int(row["frame"]))
        if key in replaced:
            continue
        if not row.get("keep"):
            continue
        if row.get("angle") is None:
            continue
        live, payload = replay_frame(row["clip"], int(row["frame"]))
        zero = float(payload["tapCalibration"]["anchors"]["zeroAngleDeg"])
        rotation = float(live.get("gaugeRotationDeg") or 0.0)
        names = png_cache[row["clip"]]
        merged.append({
            "clip": row["clip"],
            "frame": int(row["frame"]),
            "timeS": row.get("timeS"),
            "angle": row.get("angle"),
            "bar": row.get("bar"),
            "cropAngle": round(wrap360(float(row["angle"])), 4),
            "confidence": row.get("confidence"),
            "keep": True,
            "reason": row.get("reason"),
            "uncertain": bool(row.get("uncertain")),
            "weight": AUTO_WEIGHT,
            "source": "auto",
            "verified": False,
            "outOfArc": False,
            "onPin": row.get("reason") == "rest-pin",
            "hubShiftPx": 0.0,
            "hubSource": "tracker",
            "cx": live.get("centreX"),
            "cy": live.get("centreY"),
            "radius": live.get("radius"),
            "zero": round(zero, 4),
            "rotation": round(rotation, 4),
            "png": reader_png(names, int(row["frame"])).name,
            "pngRole": "reader",
        })
    merged.extend(overrides)
    merged.sort(key=lambda row: (row["clip"], row["frame"], row["source"]))

    REAL.mkdir(parents=True, exist_ok=True)
    with LABELS_R2.open("w") as handle:
        for row in merged:
            handle.write(json.dumps(row, separators=(",", ":")) + "\n")

    stats = summarise(merged, overrides, space, profile)
    STATS_TXT.write_text(render_stats(stats))
    STATS_JSON.write_text(json.dumps(stats, indent=2) + "\n")
    return stats


def summarise(merged, overrides, space, profile) -> dict:
    per_clip = {}
    for row in merged:
        bucket = per_clip.setdefault(row["clip"], {
            "n": 0, "auto": 0, "isaacOk": 0, "isaacFix": 0, "weightSum": 0.0, "outOfArc": 0,
        })
        bucket["n"] += 1
        bucket["weightSum"] += float(row["weight"])
        if row["source"] == "auto":
            bucket["auto"] += 1
        elif row["source"] == "isaac-ok":
            bucket["isaacOk"] += 1
        else:
            bucket["isaacFix"] += 1
        if row["outOfArc"]:
            bucket["outOfArc"] += 1
    shifts = [float(row["hubShiftPx"]) for row in overrides if row.get("hubSource") == "isaac" and row.get("hubShiftPx") is not None]
    flagged = [
        {
            "clip": row["clip"],
            "frame": row["frame"],
            "angle": row["angle"],
            "bar": row["bar"],
            "source": row["source"],
        }
        for row in merged if row["outOfArc"]
    ]
    ok = sum(1 for row in overrides if row["source"] == "isaac-ok")
    fix = sum(1 for row in overrides if row["source"] == "isaac-fix")
    with_hub = sum(1 for row in overrides if row["hubSource"] == "isaac")
    return {
        "labels": str(LABELS_R2),
        "n": len(merged),
        "auto": sum(1 for row in merged if row["source"] == "auto"),
        "isaacOk": ok,
        "isaacFix": fix,
        "isaacHub": with_hub,
        "isaacWeight": ISAAC_WEIGHT,
        "autoWeight": AUTO_WEIGHT,
        "outOfArc": flagged,
        "hubShiftPx": {
            "n": len(shifts),
            "median": round_or_none(quantile(shifts, 0.5), 3),
            "p90": round_or_none(quantile(shifts, 0.9), 3),
            "max": round_or_none(max(shifts) if shifts else None, 3),
            "mean": round_or_none(sum(shifts) / len(shifts) if shifts else None, 3),
        },
        "clips": per_clip,
        "space": space,
        "profile": {
            "anchors": profile["scale"]["anchors"],
            "pinOffsetDeg": profile["rest"].get("pinOffsetDeg"),
            "arcEdgeDeg": ARC_EDGE_DEG,
        },
        "trainable": sum(1 for row in merged if row.get("cropAngle") is not None and row.get("cx") is not None),
    }


def render_stats(stats: dict) -> str:
    lines = [
        "Phase R2 label merge.",
        "Isaac's answer overrides the auto label. ok keeps the auto angle and marks it verified.",
        "fix recomputes the angle from his hub (or the manifest hub) to his tip.",
        "Bar uses the tap profile: 0° = 0 bar, 74.0613° = 5, 161.757° = 10. A tip on the 0 pin is 0 bar.",
        f"Isaac frames are weight {stats['isaacWeight']:g}. Auto frames are weight {stats['autoWeight']:g}.",
        "",
        stats["space"]["note"],
        f"Pixel space match: {stats['space']['match']} on {stats['space']['checked']} review frames.",
        f"Review PNG index {stats['space']['reviewIndex']}. Reader PNG index {stats['space']['readerIndex']}.",
        "",
        f"rows {stats['n']}  auto {stats['auto']}  isaac-ok {stats['isaacOk']}  isaac-fix {stats['isaacFix']}  "
        f"fixes with his hub {stats['isaacHub']}  trainable {stats['trainable']}",
        "hub shift px (his hub vs manifest centre): "
        f"n={stats['hubShiftPx']['n']} median={stats['hubShiftPx']['median']} "
        f"p90={stats['hubShiftPx']['p90']} max={stats['hubShiftPx']['max']} mean={stats['hubShiftPx']['mean']}",
        f"out of arc: {len(stats['outOfArc'])} (kept and listed, not dropped)",
    ]
    for row in stats["outOfArc"]:
        lines.append(f"  {row['clip']} frame {row['frame']} angle={row['angle']} bar={row['bar']} {row['source']}")
    lines.append("")
    lines.append(f"{'clip':<18} {'n':>5} {'auto':>6} {'ok':>4} {'fix':>4} {'weight':>8} {'out':>4}")
    for clip in sorted(stats["clips"]):
        row = stats["clips"][clip]
        lines.append(
            f"{clip:<18} {row['n']:5d} {row['auto']:6d} {row['isaacOk']:4d} {row['isaacFix']:4d} "
            f"{row['weightSum']:8.1f} {row['outOfArc']:4d}"
        )
    lines.append("")
    return "\n".join(lines) + "\n"


def main():
    stats = merge()
    print(render_stats(stats), end="")


if __name__ == "__main__":
    main()
