"""Clean dial, per-clip median backgrounds, and the Flair needle template.

Backgrounds are rectified with the Phase-1 crop (dial radius 40) onto a
larger canvas so later tracking-error jitter still lands on dial, not black.
Nothing here is written into the repo. Clips come from /workspace/flair-train.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from rectify import rectify
from synth_render import CANVAS, DIAL_R, rectify_spec, to_uint8_hwc

PHOTO = "/workspace/flair-train/dry/20261015_225359.jpg"
TRAIN = Path("/workspace/flair-train")
FRAME_W = 1280
FRAME_H = 720


def mem_available_mb() -> float:
    text = Path("/proc/meminfo").read_text()
    for line in text.splitlines():
        if line.startswith("MemAvailable:"):
            return int(line.split()[1]) / 1024
    return 0.0


def list_clips() -> list[Path]:
    files = []
    for kind in ("dry", "used", "real"):
        folder = TRAIN / kind
        if not folder.is_dir():
            continue
        files.extend(sorted(folder.glob("*.mp4")))
    for path in files:
        resolved = str(path.resolve())
        if resolved.startswith("/workspace/flair-real"):
            raise SystemExit(f"refusing {resolved}")
    return files


def _sample_ring(rgb: np.ndarray, cx: float, cy: float, radius: float, rf: float) -> np.ndarray:
    angs = np.deg2rad(np.arange(0, 360, 12))
    xs = np.rint(cx + radius * rf * np.cos(angs)).astype(np.int32)
    ys = np.rint(cy + radius * rf * np.sin(angs)).astype(np.int32)
    h, w = rgb.shape[:2]
    ok = (xs >= 0) & (ys >= 0) & (xs < w) & (ys < h)
    if not np.any(ok):
        return np.zeros((0, 3), dtype=np.float32)
    return rgb[ys[ok], xs[ok]].astype(np.float32)


def score_circle(rgb: np.ndarray, cx: float, cy: float, radius: float) -> float:
    h, w = rgb.shape[:2]
    if radius < 10 or cx - radius < 2 or cy - radius < 2 or cx + radius >= w - 2 or cy + radius >= h - 2:
        return -1e9
    face = _sample_ring(rgb, cx, cy, radius, 0.42)
    ring = _sample_ring(rgb, cx, cy, radius, 1.04)
    mid = _sample_ring(rgb, cx, cy, radius, 0.58)
    if face.size == 0 or ring.size == 0 or mid.size == 0:
        return -1e9
    face_l = float(face.mean())
    ring_l = float(ring.mean())
    red = np.clip(mid[:, 0] - np.maximum(mid[:, 1], mid[:, 2]), 0, None)
    red_mean = float(red.mean())
    if ring_l > face_l - 4 or red_mean < 3.5:
        return -1e9
    return (face_l - ring_l) + red_mean * 3.0


def locate_dial(rgb: np.ndarray, prior: dict | None = None) -> dict | None:
    h, w = rgb.shape[:2]
    scale = min(1.0, 460.0 / max(h, w))
    sw, sh = max(16, int(round(w * scale))), max(16, int(round(h * scale)))
    small = cv2.resize(rgb, (sw, sh), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(small, cv2.COLOR_RGB2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    min_r = int(min(sw, sh) * 0.12)
    max_r = int(min(sw, sh) * 0.46)
    found = cv2.HoughCircles(
        blur,
        cv2.HOUGH_GRADIENT,
        dp=1.2,
        minDist=min(sw, sh) / 3,
        param1=80,
        param2=28,
        minRadius=min_r,
        maxRadius=max_r,
    )
    cands = []
    if prior is not None:
        cands.append((prior["cx"] * scale, prior["cy"] * scale, prior["radius"] * scale))
    if found is not None:
        for cx, cy, radius in found[0][:10]:
            cands.append((float(cx), float(cy), float(radius)))
    best = None
    for cx, cy, radius in cands:
        for factor in (0.90, 1.0, 1.10):
            score = score_circle(small, cx, cy, radius * factor)
            if best is None or score > best[0]:
                best = (score, cx, cy, radius * factor)
    if best is None or best[0] < 0:
        return None
    _, cx, cy, radius = best
    refined = best
    for dy in range(-6, 7, 3):
        for dx in range(-6, 7, 3):
            for dr in (-4, 0, 4):
                score = score_circle(small, cx + dx, cy + dy, radius + dr)
                if score > refined[0]:
                    refined = (score, cx + dx, cy + dy, radius + dr)
    _, cx, cy, radius = refined
    return {
        "cx": float(cx / scale),
        "cy": float(cy / scale),
        "radius": float(radius / scale),
        "score": float(refined[0]),
    }


def red_arc_angle(rgb: np.ndarray, cx: float, cy: float, radius: float) -> float | None:
    h, w = rgb.shape[:2]
    angs = np.arange(360, dtype=np.float64)
    rad = np.deg2rad(angs)
    xs = np.clip(np.rint(cx + radius * 0.55 * np.cos(rad)).astype(np.int32), 0, w - 1)
    ys = np.clip(np.rint(cy + radius * 0.55 * np.sin(rad)).astype(np.int32), 0, h - 1)
    pix = rgb[ys, xs].astype(np.float32)
    red = np.clip(pix[:, 0] - np.maximum(pix[:, 1], pix[:, 2]), 0, None)
    red = np.where(red > 10, red, 0.0)
    if float(red.sum()) < 30:
        return None
    ang = math_atan2(float(np.sum(np.sin(rad) * red)), float(np.sum(np.cos(rad) * red)))
    return ang


def math_atan2(y: float, x: float) -> float:
    return float(np.degrees(np.arctan2(y, x)) % 360.0)


def circular_mean(values: list[float]) -> float:
    if not values:
        return 0.0
    rad = np.deg2rad(np.asarray(values, dtype=np.float64))
    return math_atan2(float(np.sin(rad).mean()), float(np.cos(rad).mean()))


def smooth_series(values: np.ndarray, window: int = 9) -> np.ndarray:
    if values.size == 0:
        return values
    pad = window // 2
    out = np.empty_like(values)
    for i in range(values.size):
        lo = max(0, i - pad)
        hi = min(values.size, i + pad + 1)
        out[i] = np.median(values[lo:hi])
    return out


def decode_frames(path: Path, stride: int):
    vf = f"scale={FRAME_W}:{FRAME_H}:flags=bicubic"
    if stride > 1:
        vf = f"select='not(mod(n\\,{stride}))',{vf}"
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-noautorotate",
        "-i", str(path),
        "-vf", vf,
        "-fps_mode", "vfr",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    frame_bytes = FRAME_W * FRAME_H * 3
    assert proc.stdout is not None
    while True:
        buf = proc.stdout.read(frame_bytes)
        if len(buf) < frame_bytes:
            break
        yield np.frombuffer(buf, dtype=np.uint8).reshape(FRAME_H, FRAME_W, 3).copy()
    stderr = proc.stderr.read().decode("utf-8", "replace") if proc.stderr else ""
    code = proc.wait()
    if code != 0:
        raise RuntimeError(f"ffmpeg {path.name}: {stderr[-400:]}")


def bank_spec() -> dict:
    return {"mode": "cartesian", "size": CANVAS, "dialRadiusPx": DIAL_R}


def rectify_rgb(rgb: np.ndarray, pose: dict, spec: dict) -> np.ndarray:
    h, w = rgb.shape[:2]
    rgba = np.empty((h, w, 4), dtype=np.uint8)
    rgba[..., :3] = rgb
    rgba[..., 3] = 255
    chw = rectify(rgba, w, h, pose, spec)
    return to_uint8_hwc(chw)


def _ray_scores(gray: np.ndarray, cx: float, cy: float) -> np.ndarray:
    angs = np.deg2rad(np.arange(360))
    radii = np.linspace(DIAL_R * 0.38, DIAL_R * 0.92, 16)
    xs = cx + np.cos(angs)[:, None] * radii[None, :]
    ys = cy + np.sin(angs)[:, None] * radii[None, :]
    xi = np.clip(np.rint(xs).astype(np.int32), 0, gray.shape[1] - 1)
    yi = np.clip(np.rint(ys).astype(np.int32), 0, gray.shape[0] - 1)
    return gray[yi, xi].mean(axis=1)


def ghost_mask(median: np.ndarray, clean: np.ndarray) -> np.ndarray:
    """Mask a needle that survived the median because it rested too long."""
    h, w = median.shape[:2]
    cx = w / 2.0
    cy = h / 2.0
    gray = cv2.cvtColor(median, cv2.COLOR_RGB2GRAY).astype(np.float32)
    clean_g = cv2.cvtColor(clean, cv2.COLOR_RGB2GRAY).astype(np.float32)
    scores = _ray_scores(gray, cx, cy)
    clean_scores = _ray_scores(clean_g, cx, cy)
    excess = clean_scores - scores
    center = int(np.argmax(excess))
    if float(excess[center] - np.median(excess)) < 12 or float(excess[center]) < 14:
        return np.zeros((h, w), dtype=bool)
    mask = np.zeros((h, w), dtype=np.uint8)
    for deg in (center, (center + 180) % 360):
        rad = np.deg2rad(deg)
        length = DIAL_R * (0.92 if deg == center else 0.55)
        end = (int(round(cx + math_cos(rad) * length)), int(round(cy + math_sin(rad) * length)))
        thick = 5 if deg == center else 7
        cv2.line(mask, (int(cx), int(cy)), end, 255, thick)
    cv2.circle(mask, (int(cx), int(cy)), int(DIAL_R * 0.16), 255, -1)
    mask = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)), iterations=1)
    return mask > 0


def math_cos(rad: float) -> float:
    return float(np.cos(rad))


def math_sin(rad: float) -> float:
    return float(np.sin(rad))


def feather_fill(image: np.ndarray, fill: np.ndarray, mask: np.ndarray) -> np.ndarray:
    if not np.any(mask):
        return image
    soft = cv2.GaussianBlur(mask.astype(np.float32), (0, 0), 1.3)[..., None]
    mixed = image.astype(np.float32) * (1.0 - soft) + fill.astype(np.float32) * soft
    return np.clip(np.round(mixed), 0, 255).astype(np.uint8)


def match_gain(donor: np.ndarray, reference: np.ndarray, ignore: np.ndarray) -> np.ndarray:
    ys, xs = np.mgrid[0:donor.shape[0], 0:donor.shape[1]]
    dial = (xs - donor.shape[1] / 2) ** 2 + (ys - donor.shape[0] / 2) ** 2 <= (DIAL_R * 0.85) ** 2
    use = dial & ~ignore
    if int(use.sum()) < 50:
        use = dial
    out = donor.astype(np.float32)
    ref = reference.astype(np.float32)
    for c in range(3):
        src = float(out[..., c][use].mean())
        dst = float(ref[..., c][use].mean())
        if src > 1:
            out[..., c] *= dst / src
    return np.clip(np.round(out), 0, 255).astype(np.uint8)


def fill_ghosts(medians: dict[str, np.ndarray], masks: dict[str, np.ndarray], clean: np.ndarray) -> dict[str, np.ndarray]:
    strength = {name: int(masks[name].sum()) for name in medians}
    donors = [name for name, mass in strength.items() if mass < 80]
    filled = {}
    for name, image in medians.items():
        mask = masks[name]
        if not np.any(mask):
            filled[name] = image
            continue
        stack = [clean]
        for donor in donors:
            if donor != name:
                stack.append(medians[donor])
        pile = np.stack(stack, axis=0)
        mid = pile.shape[0] // 2
        ordered = np.sort(pile.astype(np.uint16), axis=0)
        base = ordered[mid].astype(np.uint8)
        base = match_gain(base, image, mask)
        filled[name] = feather_fill(image, base, mask)
    return filled


def load_photo_rgb(path: str = PHOTO) -> np.ndarray:
    if str(Path(path).resolve()).startswith("/workspace/flair-real"):
        raise SystemExit(f"refusing {path}")
    return np.array(Image.open(path).convert("RGB"))


def photo_geometry(path: str = PHOTO) -> dict:
    from reference_photo import measure
    return measure(path)


def photo_needle_mask(shape, cx, cy, radius, angle_deg, profile) -> np.ndarray:
    h, w = shape[:2]
    mask = np.zeros((h, w), dtype=np.uint8)
    needle = profile["needle"]
    tip = float(needle["length"]) * float(needle["tipLenRatio"]) * radius
    tail = float(needle["tailRatio"]) * tip
    hub = float(needle["hub"]) * radius
    rad = np.deg2rad(angle_deg)
    dx, dy = math_cos(rad), math_sin(rad)
    center = (int(round(cx)), int(round(cy)))
    tip_pt = (int(round(cx + dx * tip)), int(round(cy + dy * tip)))
    tail_pt = (int(round(cx - dx * tail)), int(round(cy - dy * tail)))
    thick = max(3, int(radius * max(float(needle["width"]) * 4.0, 0.03)))
    cv2.line(mask, center, tip_pt, 255, thick)
    cv2.line(mask, center, tail_pt, 255, max(thick + 2, int(thick * 1.8)))
    cv2.circle(mask, center, max(3, int(hub * 1.5)), 255, -1)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    return cv2.dilate(mask, kernel, iterations=2)


def inpaint_photo(rgb: np.ndarray, mask: np.ndarray) -> np.ndarray:
    return cv2.inpaint(rgb, mask, 5, cv2.INPAINT_TELEA)


def _tip_delta(gray: np.ndarray) -> float:
    h, w = gray.shape
    cx = w / 2.0
    cy = h / 2.0
    best_deg = 0
    best = -1e9
    for deg in range(-25, 26):
        rad = np.deg2rad(deg)
        outer = []
        inner = []
        for t in np.linspace(0.45, 0.92, 10):
            x = int(round(cx + math_cos(rad) * DIAL_R * t))
            y = int(round(cy + math_sin(rad) * DIAL_R * t))
            if 0 <= x < w and 0 <= y < h:
                outer.append(float(gray[y, x]))
        for t in np.linspace(0.12, 0.40, 6):
            x = int(round(cx - math_cos(rad) * DIAL_R * t))
            y = int(round(cy - math_sin(rad) * DIAL_R * t))
            if 0 <= x < w and 0 <= y < h:
                inner.append(float(gray[y, x]))
        if not outer:
            continue
        # Long dark tip, not the short tail: outer darkness minus the opposite outer.
        opp = []
        orad = np.deg2rad(deg + 180)
        for t in np.linspace(0.55, 0.92, 8):
            x = int(round(cx + math_cos(orad) * DIAL_R * t))
            y = int(round(cy + math_sin(orad) * DIAL_R * t))
            if 0 <= x < w and 0 <= y < h:
                opp.append(float(gray[y, x]))
        score = -(np.mean(outer)) + (np.mean(opp) if opp else 0) * 0.35
        if inner:
            score -= np.mean(inner) * 0.15
        if score > best:
            best = score
            best_deg = deg
    return float(best_deg)


def segment_template(canon: np.ndarray, profile: dict) -> tuple[np.ndarray, dict]:
    h, w = canon.shape[:2]
    cx = w / 2.0
    cy = h / 2.0
    gray = cv2.cvtColor(canon, cv2.COLOR_RGB2GRAY)
    bg = cv2.medianBlur(gray, 17).astype(np.float32)
    dark = bg - gray.astype(np.float32)
    ys, xs = np.mgrid[0:h, 0:w]
    x = xs + 0.5 - cx
    y = ys + 0.5 - cy
    needle = profile["needle"]
    tip_len = float(needle["length"]) * float(needle["tipLenRatio"]) * DIAL_R
    tail_len = float(needle["tailRatio"]) * tip_len
    hub_r = float(needle["hub"]) * DIAL_R
    radial = np.hypot(x, y)
    ang = np.degrees(np.arctan2(y, x)) % 360.0
    to_zero = np.abs((ang + 180.0) % 360.0 - 180.0)
    to_tail = np.abs((ang - 180.0 + 180.0) % 360.0 - 180.0)
    # Angular gate so ticks and the stop pin do not become part of the needle.
    corridor = (
        ((to_zero <= 9.0) & (x >= 0) & (radial <= tip_len + 1.5) & (radial >= hub_r * 0.35))
        | ((to_tail <= 14.0) & (x <= 0) & (radial <= tail_len + 1.5) & (radial >= hub_r * 0.3))
        | (radial <= hub_r * 1.15)
    )
    alpha = np.clip((dark - 8.0) / 32.0, 0.0, 1.0)
    alpha = np.where(corridor & (dark > 14), alpha, 0.0)
    alpha = cv2.GaussianBlur(alpha.astype(np.float32), (0, 0), 0.45)
    rgba = np.zeros((h, w, 4), dtype=np.float32)
    rgba[..., :3] = canon.astype(np.float32) / 255.0
    rgba[..., 3] = alpha
    metrics = measure_template(rgba)
    return rgba, metrics


def measure_template(rgba: np.ndarray) -> dict:
    h, w = rgba.shape[:2]
    cx = w / 2.0
    cy = h / 2.0
    alpha = rgba[..., 3]
    ys, xs = np.mgrid[0:h, 0:w]
    x = xs + 0.5 - cx
    y = ys + 0.5 - cy
    on = alpha > 0.28
    tip = on & (x > 2)
    tail = on & (x < -2)
    hub = on & (np.hypot(x, y) < DIAL_R * 0.2)
    tip_len = float(x[tip].max()) if np.any(tip) else 0.0
    tail_len = float(-x[tail].min()) if np.any(tail) else 0.0
    hub_r = float(np.hypot(x, y)[hub].max()) if np.any(hub) else 0.0
    return {
        "tipLenPx": round(tip_len, 3),
        "tailLenPx": round(tail_len, 3),
        "hubRadiusPx": round(hub_r, 3),
        "tipPixels": int(tip.sum()),
        "tailPixels": int(tail.sum()),
        "hubPixels": int(hub.sum()),
        "hasTip": bool(tip_len > DIAL_R * 0.45),
        "hasTail": bool(tail_len > DIAL_R * 0.12 and tail.sum() > 8),
        "hasHub": bool(hub.sum() > 6),
    }


def build_photo_assets(profile: dict, out_dir: Path) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    raw = load_photo_rgb()
    geo = photo_geometry()
    cx, cy = float(geo["hub"]["x"]), float(geo["hub"]["y"])
    radius = float(geo["faceRadiusPx"])
    needle_deg = float(geo["needleDeg"])
    pose = {"cx": cx, "cy": cy, "radius": radius, "rotationDeg": needle_deg}
    canon = rectify_rgb(raw, pose, bank_spec())
    delta = _tip_delta(cv2.cvtColor(canon, cv2.COLOR_RGB2GRAY))
    pose["rotationDeg"] = needle_deg + delta
    canon = rectify_rgb(raw, pose, bank_spec())
    Image.fromarray(canon).save(out_dir / "reference_rectified.png")
    template, metrics = segment_template(canon, profile)
    mask = photo_needle_mask(raw.shape, cx, cy, radius, needle_deg, profile)
    cleaned_photo = inpaint_photo(raw, mask)
    dial = rectify_rgb(cleaned_photo, pose, bank_spec())
    # Residual needle in the canonical crop, if the photo mask missed it.
    residual = ghost_mask(dial, cv2.medianBlur(dial, 21))
    if np.any(residual):
        painted = cv2.inpaint(dial, residual.astype(np.uint8) * 255, 3, cv2.INPAINT_TELEA)
        dial = painted
    red = red_arc_angle(raw, cx, cy, radius)
    red_crop = None if red is None else (red - pose["rotationDeg"]) % 360.0
    Image.fromarray(cleaned_photo).save(out_dir / "dial_clean_photo.png")
    Image.fromarray(dial).save(out_dir / "dial_clean.png")
    template_u8 = np.zeros((*template.shape[:2], 4), dtype=np.uint8)
    template_u8[..., :3] = np.clip(np.round(template[..., :3] * 255.0), 0, 255)
    template_u8[..., 3] = np.clip(np.round(template[..., 3] * 255.0), 0, 255)
    Image.fromarray(template_u8, mode="RGBA").save(out_dir / "needle.png")
    return {
        "dial": dial,
        "template": template,
        "metrics": metrics,
        "geometry": {
            "hub": [cx, cy],
            "faceRadiusPx": radius,
            "needleDeg": needle_deg,
            "tipDeltaDeg": delta,
            "rotationDeg": pose["rotationDeg"],
            "redArcDeg": red,
            "redCropDeg": red_crop,
        },
    }


def _pose_for_frame(rgb: np.ndarray, prior: dict | None, red_crop: float | None) -> dict | None:
    located = locate_dial(rgb, prior)
    if located is None:
        return None
    rotation = 0.0
    red = red_arc_angle(rgb, located["cx"], located["cy"], located["radius"])
    if red is not None and red_crop is not None:
        rotation = (red - red_crop) % 360.0
    elif prior is not None:
        rotation = float(prior.get("rotationDeg") or 0.0)
    return {
        "cx": located["cx"],
        "cy": located["cy"],
        "radius": located["radius"],
        "rotationDeg": rotation,
        "score": located["score"],
    }


def median_stack(stack: np.ndarray) -> np.ndarray:
    count, height, width, channels = stack.shape
    out = np.empty((height, width, channels), dtype=np.uint8)
    step = 8
    for y0 in range(0, height, step):
        y1 = min(height, y0 + step)
        ordered = np.sort(stack[:, y0:y1].astype(np.uint16), axis=0)
        mid = count // 2
        if count % 2:
            out[y0:y1] = ordered[mid]
        else:
            out[y0:y1] = ((ordered[mid - 1] + ordered[mid]) // 2).astype(np.uint8)
    return out


def _collect_poses(path: Path, red_crop: float | None, stride: int) -> list[dict | None]:
    poses = []
    prior = None
    for rgb in decode_frames(path, stride):
        pose = _pose_for_frame(rgb, prior, red_crop)
        poses.append(pose)
        if pose is not None:
            prior = pose
    return poses


def build_clip(path: Path, red_crop: float | None, profile: dict, stride: int, spec: dict) -> dict | None:
    raw_poses = _collect_poses(path, red_crop, stride)
    valid = [pose for pose in raw_poses if pose is not None]
    kept = len(valid)
    seen = len(raw_poses)
    if kept < 12:
        return None
    arr_cx = smooth_series(np.array([p["cx"] for p in valid], dtype=np.float64))
    arr_cy = smooth_series(np.array([p["cy"] for p in valid], dtype=np.float64))
    arr_r = smooth_series(np.array([p["radius"] for p in valid], dtype=np.float64))
    rots = np.array([p["rotationDeg"] for p in valid], dtype=np.float64)
    # Unwrap around the circular mean so the median filter does not jump at 0.
    center = circular_mean(rots.tolist())
    delta = (rots - center + 180.0) % 360.0 - 180.0
    smooth_delta = smooth_series(delta)
    smoothed = []
    for i in range(kept):
        smoothed.append({
            "cx": float(arr_cx[i]),
            "cy": float(arr_cy[i]),
            "radius": float(arr_r[i]),
            "rotationDeg": float((center + smooth_delta[i]) % 360.0),
        })
    canvases = np.empty((kept, CANVAS, CANVAS, 3), dtype=np.uint8)
    model_spec = rectify_spec(profile, "cartesian")
    polar_spec = rectify_spec(profile, "polar")
    mid = kept // 2
    real = None
    real_polar = None
    real_index = None
    cursor = 0
    for rgb, pose in zip(decode_frames(path, stride), raw_poses):
        if pose is None:
            continue
        use = smoothed[cursor]
        canvases[cursor] = rectify_rgb(rgb, use, spec)
        if cursor == mid:
            real = rectify_rgb(rgb, use, model_spec)
            real_polar = rectify_rgb(rgb, use, polar_spec)
            real_index = cursor
        cursor += 1
    if cursor != kept:
        raise RuntimeError(f"{path.name} pose pass {kept} != rectify pass {cursor}")
    median = median_stack(canvases)
    stable = {
        "cx": float(np.median(arr_cx)),
        "cy": float(np.median(arr_cy)),
        "radius": float(np.median(arr_r)),
        "rotationDeg": float(center % 360.0),
        "framesSeen": seen,
        "framesKept": kept,
        "stride": stride,
        "realIndex": real_index,
    }
    return {"median": median, "pose": stable, "real": real, "realPolar": real_polar}


def build_bank(profile: dict, out_dir: Path, stride: int = 2) -> dict:
    if mem_available_mb() < 3072:
        raise SystemExit(f"need >= 3 GB free, have {mem_available_mb():.0f} MB")
    out_dir.mkdir(parents=True, exist_ok=True)
    bg_dir = out_dir / "backgrounds"
    bg_dir.mkdir(exist_ok=True)
    photo = build_photo_assets(profile, out_dir)
    red_crop = photo["geometry"]["redCropDeg"]
    medians = {}
    masks = {}
    meta_clips = []
    real_cart = []
    real_polar = []
    real_names = []
    spec = bank_spec()
    for path in list_clips():
        print(f"median {path.name} stride {stride}", flush=True)
        built = build_clip(path, red_crop, profile, stride, spec)
        if built is None:
            print(f"  skip {path.name}", flush=True)
            continue
        medians[path.stem] = built["median"]
        masks[path.stem] = ghost_mask(built["median"], photo["dial"])
        meta_clips.append({"id": path.stem, "file": str(path), **built["pose"], "ghostPixels": int(masks[path.stem].sum())})
        if built["real"] is not None:
            real_cart.append(built["real"])
            real_polar.append(built["realPolar"])
            real_names.append(path.stem)
        print(f"  kept {built['pose']['framesKept']} ghost {int(masks[path.stem].sum())}", flush=True)
    filled = fill_ghosts(medians, masks, photo["dial"])
    for name, image in filled.items():
        Image.fromarray(image).save(bg_dir / f"{name}.png")
    real_cart_a = np.stack(real_cart, axis=0) if real_cart else np.zeros((0, 96, 96, 3), np.uint8)
    real_polar_a = np.stack(real_polar, axis=0) if real_polar else np.zeros((0, 48, 360, 3), np.uint8)
    np.savez_compressed(out_dir / "real_row.npz", cartesian=real_cart_a, polar=real_polar_a, names=np.array(real_names))
    meta = {
        "canvas": CANVAS,
        "dialRadiusPx": DIAL_R,
        "photo": PHOTO,
        "geometry": photo["geometry"],
        "template": photo["metrics"],
        "clips": meta_clips,
        "stride": stride,
    }
    (out_dir / "meta.json").write_text(json.dumps(meta, indent=2))
    return meta


def load_bank(out_dir: Path) -> dict:
    backgrounds = {"dial_clean": np.array(Image.open(out_dir / "dial_clean.png").convert("RGB"))}
    names = []
    bg_dir = out_dir / "backgrounds"
    for path in sorted(bg_dir.glob("*.png")):
        backgrounds[path.stem] = np.array(Image.open(path).convert("RGB"))
        names.append(path.stem)
    template_img = np.array(Image.open(out_dir / "needle.png").convert("RGBA")).astype(np.float32) / 255.0
    meta = json.loads((out_dir / "meta.json").read_text())
    real = np.load(out_dir / "real_row.npz")
    return {
        "backgrounds": backgrounds,
        "names": names,
        "template": np.ascontiguousarray(template_img),
        "metrics": meta.get("template") or {},
        "meta": meta,
        "real_cartesian": real["cartesian"],
        "real_polar": real["polar"],
        "real_names": [str(x) for x in real["names"].tolist()],
    }
