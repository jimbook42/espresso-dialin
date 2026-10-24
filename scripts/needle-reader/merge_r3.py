#!/usr/bin/env python3
"""Phase R5a. Merge labels-r2 + review-pack-2 + auto labels for 20261024_124140.

Review pack 2 uses reader PNG index (frame + READER_SLOT0) % n, not pack 1's frame % n.
Writes real/labels-r3.jsonl and stats under /workspace/pl-state/nr/real/.
"""
from __future__ import annotations

import json
import math
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from gauge_profile import load_gauge_profile  # noqa: E402
from label_r1 import (  # noqa: E402
    ARC_EDGE_DEG,
    clockwise,
    in_arc,
    label_clip,
    load_profile as load_label_rules,
    on_pin,
    quantile,
    signed_delta,
    wrap360,
)
from merge_r2 import (  # noqa: E402
    bar_from_delta,
    image_angle,
    load_replay,
    round_or_none,
    signed_bar,
)

REPO = Path(__file__).resolve().parents[2]
PROFILE_PATH = REPO / "profiles" / "flair58-v1.json"
REAL = Path("/workspace/pl-state/nr/real")
REVIEW2 = Path("/workspace/pl-state/nr/review2")
REPLAY = Path("/workspace/pl-state/nr/replay")
FRAMES = Path("/workspace/pl-data/frames")
LABELS_R2 = REAL / "labels-r2.jsonl"
LABELS_R3 = REAL / "labels-r3.jsonl"
STATS_TXT = REAL / "labels-r3-stats.txt"
STATS_JSON = REAL / "labels-r3-stats.json"
READER_SLOT0 = 4
ISAAC2_BASE = 6
SKIP_IDS = frozenset({"20261017_134943-0325", "20261017_135116-0164"})
CLIP_124140 = "20261024_124140"
REPEAT_CAP = 24


def pngs_for(clip_id: str) -> list[Path]:
    folder = FRAMES / f"pressure-frames-png-{clip_id}"
    names = sorted(folder.glob("[0-9][0-9][0-9][0-9].png"))
    if not names:
        raise SystemExit(f"missing replay stills for {clip_id}")
    return names


def reader_png(names: list[Path], frame: int) -> Path:
    return names[(frame + READER_SLOT0) % len(names)]


def load_r2_rows() -> list[dict]:
    rows = []
    for line in LABELS_R2.read_text().splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def repeat_weight(row: dict) -> int:
    count = ISAAC2_BASE if str(row.get("source", "")).startswith("isaac2") else int(row.get("weight", 1))
    bar = row.get("bar")
    if isinstance(bar, (int, float)):
        if bar >= 9:
            count *= 4
        elif bar >= 7:
            count *= 2
    return min(REPEAT_CAP, max(1, int(round(count))))


def bar_band_stats(rows: list[dict]) -> dict:
    def count_band(source_rows):
        n = 0
        w = 0.0
        for row in source_rows:
            bar = row.get("bar")
            if not isinstance(bar, (int, float)) or bar < 7 or bar > 10:
                continue
            n += 1
            w += repeat_weight(row)
        return n, w

    before_n, before_w = count_band(
        [r for r in rows if r.get("source") != "auto-124140" and not str(r.get("source", "")).startswith("isaac2")]
    )
    after_n, after_w = count_band(rows)
    total_w = sum(repeat_weight(r) for r in rows if isinstance(r.get("bar"), (int, float)))
    return {
        "beforeFrames7to10": before_n,
        "afterFrames7to10": after_n,
        "beforeWeightedShare7to10": round(before_w / total_w, 4) if total_w else None,
        "afterWeightedShare7to10": round(after_w / total_w, 4) if total_w else None,
        "totalWeighted": round(total_w, 1),
    }


def merge_review2(profile: dict, r2_index: dict, png_cache: dict, replay_cache: dict) -> tuple[list[dict], list[dict], list[str]]:
    manifest = json.loads((REVIEW2 / "manifest.json").read_text())["frames"]
    answers = json.loads((REVIEW2 / "answers.json").read_text())["frames"]
    if READER_SLOT0 != 4:
        raise SystemExit("pack 2 must use READER_SLOT0=4")
    space_note = (
        f"Review pack 2 reader index ((frame + {READER_SLOT0}) % n); "
        "pack 1 used (frame % n). Asserted in merge_r3."
    )
    by_id = {frame["id"]: frame for frame in manifest}
    overrides = []
    overridden = []
    skipped = []
    for frame_id, answer in answers.items():
        if frame_id in SKIP_IDS:
            skipped.append(frame_id)
            continue
        meta = by_id.get(frame_id)
        if meta is None:
            raise SystemExit(f"answer without manifest row {frame_id}")
        verdict = answer.get("verdict")
        if verdict not in ("ok", "fix"):
            raise SystemExit(f"{frame_id} verdict {verdict}")
        clip = meta["clip"]
        frame = int(meta["frame"])
        payload = replay_cache.get(clip) or load_replay(clip)
        replay_cache[clip] = payload
        live = payload["frames"][frame]
        zero = float(payload["tapCalibration"]["anchors"]["zeroAngleDeg"])
        rotation = float(live.get("gaugeRotationDeg") or 0.0)
        hub_source = "manifest"
        if verdict == "fix" and answer.get("hub"):
            hub = (float(answer["hub"]["x"]), float(answer["hub"]["y"]))
            hub_source = "isaac"
        else:
            hub = (float(meta["cx"]), float(meta["cy"]))
        shift = math.hypot(hub[0] - float(meta["cx"]), hub[1] - float(meta["cy"]))
        if verdict == "ok":
            tip = meta.get("tip")
            if not tip:
                raise SystemExit(f"{frame_id} ok without prefilled tip")
            tip_pt = (float(tip["x"]), float(tip["y"]))
            seen = image_angle(hub, tip_pt)
            delta = clockwise(zero, wrap360(seen - rotation))
            bar, angle, outside, pin = bar_from_delta(delta, profile)
            crop = wrap360(delta if not pin else 0.0)
        else:
            tip_pt = answer.get("tip")
            if not tip_pt:
                raise SystemExit(f"{frame_id} fix without tip")
            tip = (float(tip_pt["x"]), float(tip_pt["y"]))
            seen = image_angle(hub, tip)
            delta = clockwise(zero, wrap360(seen - rotation))
            bar, angle, outside, pin = bar_from_delta(delta, profile)
            crop = wrap360(delta if not pin else 0.0)
            tip_pt = tip
        names = png_cache.get(clip) or pngs_for(clip)
        png_cache[clip] = names
        prior = r2_index.get((clip, frame))
        if prior is not None:
            overridden.append({"clip": clip, "frame": frame, "priorSource": prior.get("source")})
        row = {
            "clip": clip,
            "frame": frame,
            "timeS": meta.get("timeS"),
            "angle": angle,
            "bar": bar,
            "cropAngle": None if crop is None else round(crop, 4),
            "confidence": meta.get("r2conf"),
            "keep": True,
            "reason": "isaac2-ok" if verdict == "ok" else "isaac2-fix",
            "uncertain": bool(meta.get("uncertain")),
            "weight": ISAAC2_BASE,
            "source": "isaac2-ok" if verdict == "ok" else "isaac2-fix",
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
            "png": reader_png(names, frame).name,
            "pngRole": "reader",
            "tipX": round(tip_pt[0], 3),
            "tipY": round(tip_pt[1], 3),
        }
        overrides.append(row)
    return overrides, overridden, skipped, space_note


def legacy_zero(payload: dict) -> tuple[float, float]:
    """Tap anchors when Isaac's taps exist; else rest-frame lock from TRACKING ~0 bar."""
    tap = payload.get("tapCalibration") or {}
    anchors = tap.get("anchors") or {}
    if anchors.get("zeroAngleDeg") is not None:
        return float(anchors["zeroAngleDeg"]), float(tap.get("atSec") or 0.0)
    rest = [
        frame for frame in payload["frames"]
        if frame.get("tracking") == "TRACKING"
        and frame.get("needleAngleDeg") is not None
        and frame.get("bar") is not None
        and float(frame["bar"]) < 0.3
    ]
    if not rest:
        raise SystemExit(f"cannot derive legacy zero for {CLIP_124140}")
    frame = rest[0]
    rot = float(frame.get("gaugeRotationDeg") or 0.0)
    corrected = wrap360(float(frame["needleAngleDeg"]) - rot)
    return corrected, float(frame["timeS"])


def auto_labels_124140(profile: dict, rules: dict) -> list[dict]:
    path = REPLAY / f"{CLIP_124140}.json"
    if not path.exists():
        raise SystemExit(f"missing replay json {path}; run build_r5_replay.mjs first")
    payload = json.loads(path.read_text())
    zero_deg, at_sec = legacy_zero(payload)
    rows = label_clip(payload["frames"], zero_deg, at_sec, rules)
    names = pngs_for(CLIP_124140)
    out = []
    for row, frame in zip(rows, payload["frames"]):
        if not row.get("keep") or row.get("angle") is None:
            continue
        zero = float(anchors["zeroAngleDeg"])
        rotation = float(frame.get("gaugeRotationDeg") or 0.0)
        out.append({
            "clip": CLIP_124140,
            "frame": int(row["frame"]),
            "timeS": row.get("timeS"),
            "angle": row.get("angle"),
            "bar": row.get("bar"),
            "cropAngle": round(wrap360(float(row["angle"])), 4),
            "confidence": row.get("confidence"),
            "keep": True,
            "reason": row.get("reason"),
            "uncertain": bool(row.get("uncertain")),
            "weight": 1.0,
            "source": "auto-124140",
            "verified": False,
            "outOfArc": row.get("reason") == "out-of-arc",
            "onPin": row.get("reason") == "rest-pin",
            "hubShiftPx": 0.0,
            "hubSource": "tracker",
            "cx": frame.get("centreX"),
            "cy": frame.get("centreY"),
            "radius": frame.get("radius"),
            "zero": round(zero, 4),
            "rotation": round(rotation, 4),
            "png": reader_png(names, int(row["frame"])).name,
            "pngRole": "reader",
        })
    return out


def merge() -> dict:
    profile = load_gauge_profile(str(PROFILE_PATH))
    rules = load_label_rules()
    r2_rows = load_r2_rows()
    r2_index = {(row["clip"], int(row["frame"])): row for row in r2_rows}
    replay_cache = {}
    png_cache = {}
    isaac2, overridden, skipped, space_note = merge_review2(profile, r2_index, png_cache, replay_cache)
    replaced = {(row["clip"], int(row["frame"])) for row in isaac2}
    auto_new = auto_labels_124140(profile, rules)
    merged = []
    for row in r2_rows:
        key = (row["clip"], int(row["frame"]))
        if key in replaced:
            continue
        merged.append(row)
    merged.extend(isaac2)
    merged.extend(auto_new)
    merged.sort(key=lambda row: (row["clip"], row["frame"], row.get("source", "")))
    flagged = [
        {"clip": row["clip"], "frame": row["frame"], "angle": row["angle"], "bar": row["bar"], "source": row["source"]}
        for row in merged if row.get("outOfArc")
    ]
    bands = bar_band_stats(merged)
    per_source = defaultdict(int)
    for row in merged:
        per_source[row.get("source", "unknown")] += 1
    stats = {
        "labels": str(LABELS_R3),
        "n": len(merged),
        "fromR2": len(r2_rows),
        "isaac2": len(isaac2),
        "auto124140": len(auto_new),
        "skippedReview2": skipped,
        "overridden": overridden,
        "outOfArc": flagged,
        "bands7to10": bands,
        "perSource": dict(per_source),
        "readerSlot0": READER_SLOT0,
        "isaac2BaseWeight": ISAAC2_BASE,
        "repeatCap": REPEAT_CAP,
        "space": space_note,
        "trainable": sum(1 for row in merged if row.get("cropAngle") is not None and row.get("cx") is not None),
    }
    REAL.mkdir(parents=True, exist_ok=True)
    with LABELS_R3.open("w") as handle:
        for row in merged:
            handle.write(json.dumps(row, separators=(",", ":")) + "\n")
    STATS_TXT.write_text(render_stats(stats))
    STATS_JSON.write_text(json.dumps(stats, indent=2) + "\n")
    return stats


def render_stats(stats: dict) -> str:
    lines = [
        "Phase R5 label merge (labels-r3).",
        "Base = labels-r2.jsonl. Review pack 2 overrides same clip+frame.",
        f"Skipped review2 (no tip): {', '.join(stats['skippedReview2'])}",
        f"Reader slot: ((frame + {stats['readerSlot0']}) % n) for pack 2.",
        stats["space"],
        "",
        f"rows {stats['n']}  from-r2 {stats['fromR2']}  isaac2 {stats['isaac2']}  "
        f"auto-124140 {stats['auto124140']}  trainable {stats['trainable']}",
        f"7-10 bar frames before {stats['bands7to10']['beforeFrames7to10']} "
        f"after {stats['bands7to10']['afterFrames7to10']}",
        f"weighted 7-10 share before {stats['bands7to10']['beforeWeightedShare7to10']} "
        f"after {stats['bands7to10']['afterWeightedShare7to10']}",
        f"out of arc: {len(stats['outOfArc'])}",
    ]
    for row in stats["outOfArc"]:
        lines.append(f"  {row['clip']} f={row['frame']} angle={row['angle']} bar={row['bar']} {row['source']}")
    lines.append("")
    lines.append("per source:")
    for source, count in sorted(stats["perSource"].items()):
        lines.append(f"  {source}: {count}")
    lines.append("")
    return "\n".join(lines) + "\n"


def main():
    stats = merge()
    print(render_stats(stats), end="")


if __name__ == "__main__":
    main()
