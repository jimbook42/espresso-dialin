"""Gauge profile loader. Matches src/flairPressureLab/gaugeProfile.js."""
from __future__ import annotations

import json
from pathlib import Path

NEEDLE_FIELDS = {
    "width": (0, 0.5),
    "length": (0, 1.5),
    "tailRatio": (0, 1.5),
    "shade": (0, 1),
    "softness": (0, 1),
    "hub": (0, 0.5),
    "tipLenRatio": (0, 2),
    "tailLenRatio": (0, 2),
}


def _fail(message: str):
    raise ValueError(f"gauge profile: {message}")


def parse_gauge_profile(profile: dict) -> dict:
    if not isinstance(profile, dict) or not profile.get("id"):
        _fail("id is required")
    scale = profile.get("scale") or {}
    if scale.get("interp") != "piecewise-linear":
        _fail("scale.interp must be piecewise-linear")
    if not (isinstance(scale.get("max"), (int, float)) and isinstance(scale.get("min"), (int, float))):
        _fail("scale min/max are required")
    if not scale["max"] > scale["min"]:
        _fail("scale min/max are required")
    anchors = scale.get("anchors")
    if not isinstance(anchors, list) or len(anchors) < 2:
        _fail("scale.anchors need at least two points")
    previous = float("-inf")
    for anchor in anchors:
        deg = anchor.get("deg")
        value = anchor.get("value")
        if not isinstance(deg, (int, float)) or not isinstance(value, (int, float)):
            _fail("each anchor needs deg and value")
        if deg < previous:
            _fail("anchors must be sorted by deg")
        if deg == previous:
            _fail("anchor degrees must be unique")
        previous = deg
    rest = profile.get("rest") or {}
    if not isinstance(rest.get("deg"), (int, float)) or not isinstance(rest.get("value"), (int, float)):
        _fail("rest.deg and rest.value are required")
    needle = profile.get("needle") or {}
    for key, (lo, hi) in NEEDLE_FIELDS.items():
        value = needle.get(key)
        if not isinstance(value, (int, float)) or value < lo or value > hi:
            _fail(f"needle.{key} must be a number in [{lo}, {hi}]")
    if not needle.get("color") or not needle.get("template"):
        _fail("needle.color and needle.template are required")
    rectify = profile.get("rectify") or {}
    if rectify.get("mode") not in ("cartesian", "polar"):
        _fail("rectify.mode must be cartesian or polar")
    cartesian = rectify.get("cartesian") or {}
    polar = rectify.get("polar") or {}
    if cartesian.get("size") != 96 or cartesian.get("dialRadiusPx") != 40:
        _fail("cartesian crop must be 96 with dial radius 40")
    if polar.get("radiusBins") != 48 or polar.get("angleBins") != 360 or polar.get("outerRadiusPx") != 48:
        _fail("polar unwrap must be 48x360 with outer radius 48")
    slew = profile.get("maxSlewPerSec")
    if not isinstance(slew, (int, float)) or slew <= 0:
        _fail("maxSlewPerSec must be positive")
    return profile


def load_gauge_profile(path: str) -> dict:
    return parse_gauge_profile(json.loads(Path(path).read_text()))


def angle_to_value(angle_deg: float, profile: dict):
    parsed = parse_gauge_profile(profile)
    anchors = parsed["scale"]["anchors"]
    if angle_deg <= anchors[0]["deg"]:
        return anchors[0]["value"]
    last = anchors[-1]
    if angle_deg >= last["deg"]:
        return last["value"]
    for index in range(1, len(anchors)):
        right = anchors[index]
        left = anchors[index - 1]
        if angle_deg <= right["deg"]:
            span = right["deg"] - left["deg"]
            t = 0 if span == 0 else (angle_deg - left["deg"]) / span
            return left["value"] + t * (right["value"] - left["value"])
    return last["value"]
