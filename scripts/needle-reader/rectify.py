"""Canonical needle crop. Matches src/flairPressureLab/needleRectify.js.

Cartesian 96x96, dial radius 40 px. Polar 48x360 (radius x angle).
CHW float32 in [0, 1]. No bar values. Numpy only.
"""
from __future__ import annotations

import json
import math
import sys

import numpy as np

CARTESIAN_SIZE = 96
DIAL_RADIUS_PX = 40
POLAR_RADIUS_BINS = 48
POLAR_ANGLE_BINS = 360
POLAR_OUTER_PX = 48
SNAP = 1e-6


def snap(values: np.ndarray) -> np.ndarray:
    nearest = np.rint(values)
    return np.where(np.abs(values - nearest) <= SNAP, nearest, values)


def bilinear_rgb(rgba: np.ndarray, width: int, height: int, xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
    out = np.zeros(xs.shape + (3,), dtype=np.float64)
    valid = (xs >= 0) & (ys >= 0) & (xs <= width - 1) & (ys <= height - 1)
    if not np.any(valid):
        return out
    x = snap(xs)
    y = snap(ys)
    x0 = np.floor(x).astype(np.int32)
    y0 = np.floor(y).astype(np.int32)
    x1 = np.minimum(width - 1, x0 + 1)
    y1 = np.minimum(height - 1, y0 + 1)
    tx = (x - x0)[..., None]
    ty = (y - y0)[..., None]
    flat = rgba.reshape(-1, 4)[:, :3].astype(np.float64)
    c00 = np.zeros_like(out)
    c10 = np.zeros_like(out)
    c01 = np.zeros_like(out)
    c11 = np.zeros_like(out)
    c00[valid] = flat[y0[valid] * width + x0[valid]]
    c10[valid] = flat[y0[valid] * width + x1[valid]]
    c01[valid] = flat[y1[valid] * width + x0[valid]]
    c11[valid] = flat[y1[valid] * width + x1[valid]]
    mixed = (c00 * (1 - tx) + c10 * tx) * (1 - ty) + (c01 * (1 - tx) + c11 * tx) * ty
    mixed[~valid] = 0
    return mixed


def source_points(pose: dict, lx: np.ndarray, ly: np.ndarray, dial_radius_px: float):
    theta = math.radians(float(pose.get("rotationDeg") or 0))
    cos = math.cos(theta)
    sin = math.sin(theta)
    scale = float(pose["radius"]) / dial_radius_px
    sx = float(pose["cx"]) + (cos * lx - sin * ly) * scale
    sy = float(pose["cy"]) + (sin * lx + cos * ly) * scale
    return sx, sy


def to_chw(rgb: np.ndarray) -> np.ndarray:
    chw = np.empty((3, rgb.shape[0], rgb.shape[1]), dtype=np.float32)
    scaled = rgb / 255.0
    chw[0] = scaled[..., 0]
    chw[1] = scaled[..., 1]
    chw[2] = scaled[..., 2]
    return chw


def rectify(rgba: np.ndarray, width: int, height: int, pose: dict, spec: dict) -> np.ndarray:
    mode = spec.get("mode") or "cartesian"
    dial = float(spec.get("dialRadiusPx") or DIAL_RADIUS_PX)
    if not pose or not (float(pose.get("radius") or 0) > 1) or width < 2 or height < 2:
        if mode == "polar":
            return np.zeros((3, int(spec.get("radiusBins") or POLAR_RADIUS_BINS), int(spec.get("angleBins") or POLAR_ANGLE_BINS)), np.float32)
        size = int(spec.get("size") or CARTESIAN_SIZE)
        return np.zeros((3, size, size), np.float32)
    if mode == "polar":
        rows = int(spec.get("radiusBins") or POLAR_RADIUS_BINS)
        cols = int(spec.get("angleBins") or POLAR_ANGLE_BINS)
        outer = float(spec.get("outerRadiusPx") or POLAR_OUTER_PX)
        rho = ((np.arange(rows) + 0.5) / rows) * outer
        ang = np.deg2rad(np.arange(cols))
        lx = rho[:, None] * np.cos(ang)[None, :]
        ly = rho[:, None] * np.sin(ang)[None, :]
        sx, sy = source_points(pose, lx, ly, dial)
        return to_chw(bilinear_rgb(rgba, width, height, sx, sy))
    size = int(spec.get("size") or CARTESIAN_SIZE)
    coords = (np.arange(size) + 0.5) - size / 2
    lx, ly = np.meshgrid(coords, coords)
    sx, sy = source_points(pose, lx, ly, dial)
    return to_chw(bilinear_rgb(rgba, width, height, sx, sy))


def _peak(score: np.ndarray) -> float:
    index = int(np.argmax(score))
    y0 = score[(index - 1) % score.size]
    y1 = score[index]
    y2 = score[(index + 1) % score.size]
    denom = y0 - 2 * y1 + y2
    delta = 0.0
    if abs(denom) > 1e-12:
        delta = 0.5 * (y0 - y2) / denom
    delta = max(-1.0, min(1.0, float(delta)))
    turns = float(score.size)
    return (index + delta) % turns


def _snap_scalar(value: float) -> float:
    nearest = round(value)
    if abs(value - nearest) <= SNAP:
        return float(nearest)
    return value


def _luma_at(tensor: np.ndarray, x: float, y: float) -> float:
    _, height, width = tensor.shape
    if not (x >= 0 and y >= 0 and x <= width - 1 and y <= height - 1):
        return 1.0
    xq = _snap_scalar(x)
    yq = _snap_scalar(y)
    x0 = math.floor(xq)
    y0 = math.floor(yq)
    x1 = min(width - 1, x0 + 1)
    y1 = min(height - 1, y0 + 1)
    tx = xq - x0
    ty = yq - y0
    weights = (0.299, 0.587, 0.114)
    acc = 0.0
    for c, weight in enumerate(weights):
        v00 = tensor[c, y0, x0]
        v10 = tensor[c, y0, x1]
        v01 = tensor[c, y1, x0]
        v11 = tensor[c, y1, x1]
        v0 = v00 * (1 - tx) + v10 * tx
        v1 = v01 * (1 - tx) + v11 * tx
        acc += weight * (v0 * (1 - ty) + v1 * ty)
    return float(acc)


def measure_angle(tensor: np.ndarray, spec: dict) -> float:
    mode = spec.get("mode") or "cartesian"
    if mode == "polar":
        rows = tensor.shape[1]
        cols = tensor.shape[2]
        r0 = int(round(rows * 0.30))
        r1 = int(round(rows * 0.82))
        sl = tensor[:, r0:r1, :]
        luma = 0.299 * sl[0] + 0.587 * sl[1] + 0.114 * sl[2]
        score = (1.0 - luma).mean(axis=0)
        return _peak(score)
    size = tensor.shape[1]
    score = np.zeros(360, dtype=np.float64)
    radii = (18, 24, 30, 36)
    for deg in range(360):
        rad = math.radians(deg)
        cos = math.cos(rad)
        sin = math.sin(rad)
        acc = 0.0
        for rho in radii:
            x = rho * cos + size / 2 - 0.5
            y = rho * sin + size / 2 - 0.5
            acc += 1.0 - _luma_at(tensor, x, y)
        score[deg] = acc / len(radii)
    return _peak(score)


def _spec_from_job(job: dict) -> dict:
    spec = dict(job.get("spec") or {})
    spec["mode"] = job.get("mode") or spec.get("mode") or "cartesian"
    return spec


def worker() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        job = json.loads(line)
        width = int(job["width"])
        height = int(job["height"])
        raw = np.fromfile(job["path"], dtype=np.uint8, count=width * height * 4)
        if raw.size != width * height * 4:
            raise SystemExit(f"short frame {raw.size}")
        tensor = rectify(raw, width, height, job["pose"], _spec_from_job(job))
        tensor.tofile(job["out"])
        angle = measure_angle(tensor, _spec_from_job(job))
        sys.stdout.write(json.dumps({"angle": angle, "count": int(tensor.size)}) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    if "--worker" in sys.argv:
        worker()
    else:
        raise SystemExit("usage: rectify.py --worker")
