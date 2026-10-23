"""Phase 2 renderer. Composites a Flair needle, then rectifies.

The crop is the Phase-1 rectify output (Cartesian 96x96 or polar 48x360).
The red plane is appended as an extra channel, matching the model input in
the spec. Labels are the tip angle in that crop (degrees, +x, clockwise,
y down). A fully occluded needle is "no needle" (angle null). No bar values.
"""
from __future__ import annotations

import math

import cv2
import numpy as np

from rectify import (
    CARTESIAN_SIZE,
    DIAL_RADIUS_PX,
    POLAR_ANGLE_BINS,
    POLAR_OUTER_PX,
    POLAR_RADIUS_BINS,
    rectify,
)

CANVAS = 256
DIAL_R = float(DIAL_RADIUS_PX)
VAL_SEED = 64200
VAL_COUNT = 5000
EXTRA_RED = True

# Augmentation rates. Tracking error is always drawn (magnitude can be ~0).
P_OBLIQUE = 0.72
P_PARALLAX = 0.82
P_MOTION = 0.42
P_DEFOCUS = 0.38
P_LOW_LIGHT = 0.45
P_JPEG = 0.80
P_CAST = 0.55
P_GLARE = 0.48
P_MESS = 0.42
P_LINES = 0.38
P_PARTIAL = 0.18
P_FULL = 0.08
P_CLEAN_BG = 0.20


def make_rng(seed: int, index: int) -> np.random.Generator:
    mixed = (int(seed) * 0x9E3779B97F4A7C15 + int(index) * 0xBF58476D1CE4E5B9) & 0xFFFFFFFFFFFFFFFF
    return np.random.Generator(np.random.PCG64(mixed))


def wrap360(deg: float) -> float:
    return float(deg) % 360.0


def rectify_spec(profile: dict, mode: str) -> dict:
    rect = profile["rectify"]
    if mode == "polar":
        polar = rect["polar"]
        return {
            "mode": "polar",
            "dialRadiusPx": float(rect["cartesian"]["dialRadiusPx"]),
            "radiusBins": int(polar["radiusBins"]),
            "angleBins": int(polar["angleBins"]),
            "outerRadiusPx": float(polar["outerRadiusPx"]),
        }
    cart = rect["cartesian"]
    return {
        "mode": "cartesian",
        "dialRadiusPx": float(cart["dialRadiusPx"]),
        "size": int(cart["size"]),
    }


def with_red(chw: np.ndarray, enabled: bool = EXTRA_RED) -> np.ndarray:
    if not enabled:
        return chw
    return np.concatenate([chw, chw[0:1]], axis=0)


def sample_needle_params(profile: dict, rng: np.random.Generator) -> dict:
    """Width ±20%, length ±8%, softness and shade vary. Tail and hub stay on the profile."""
    needle = profile["needle"]
    return {
        "width": float(needle["width"]) * float(rng.uniform(0.80, 1.20)),
        "length": float(needle["length"]) * float(rng.uniform(0.92, 1.08)),
        "tailRatio": float(needle["tailRatio"]),
        "shade": float(np.clip(float(needle["shade"]) * float(rng.uniform(0.50, 2.40)), 0.02, 0.55)),
        "softness": float(np.clip(float(needle["softness"]) * float(rng.uniform(0.35, 1.90)), 0.0, 1.0)),
        "hub": float(needle["hub"]),
        "tipLenRatio": float(needle["tipLenRatio"]),
        "tailLenRatio": float(needle["tailLenRatio"]),
    }


def _scales(profile: dict, params: dict) -> dict:
    base = profile["needle"]
    def ratio(key: str) -> float:
        denom = float(base[key])
        if denom == 0:
            return 1.0
        return float(params[key]) / denom
    return {
        "width": ratio("width"),
        "length": ratio("length") * ratio("tipLenRatio"),
        "tail": ratio("tailRatio") * (ratio("tailLenRatio") if float(base["tailLenRatio"]) else 1.0),
        "hub": ratio("hub"),
        "shade": float(params["shade"]) / max(float(base["shade"]), 1e-3),
        "softness": float(params["softness"]),
    }


def procedural_sprite(profile: dict, params: dict, canvas: int = CANVAS) -> tuple[np.ndarray, float, float]:
    """Tip along +x, pivot at the canvas centre. Always includes the tail and a hub."""
    needle = profile["needle"]
    length = float(params["length"]) * float(params["tipLenRatio"])
    # tailLenRatio is a second config for the tail; the drawn length uses both.
    tail_ratio = float(params["tailRatio"])
    if float(needle["tailLenRatio"]) and float(needle["tailRatio"]):
        tail_ratio *= float(params["tailLenRatio"]) / float(needle["tailRatio"])
    tip_len = max(4.0, length * DIAL_R)
    tail_len = max(2.0, tail_ratio * float(params["length"]) * float(params["tipLenRatio"]) * DIAL_R)
    tip_w = max(0.8, float(params["width"]) * DIAL_R)
    tail_w = max(tip_w * 1.8, tip_w * (1.2 + 2.0 * (1.0 - min(tail_ratio, 1.0))))
    hub_r = max(1.6, float(params["hub"]) * DIAL_R)
    sigma = 0.30 + float(params["softness"]) * 1.8
    cx = canvas / 2.0
    cy = canvas / 2.0
    ys, xs = np.mgrid[0:canvas, 0:canvas]
    x = xs + 0.5 - cx
    y = ys + 0.5 - cy
    along = x
    across = y
    radial = np.hypot(x, y)
    tip_t = np.clip(along / tip_len, 0.0, 1.0)
    tip_half = (tip_w / 2.0) * (1.0 - 0.82 * np.power(tip_t, 1.35))
    tail_t = np.clip((-along) / tail_len, 0.0, 1.0)
    tail_half = (tail_w / 2.0) * (1.0 - 0.40 * tail_t)
    tip_inside = tip_half - np.abs(across)
    tip_end = tip_len - along
    tip_a = np.where((along >= 0.0) & (along <= tip_len), np.minimum(tip_inside, tip_end + 0.6), -1.0)
    tail_inside = tail_half - np.abs(across)
    tail_end = tail_len + along
    tail_a = np.where((along <= 0.0) & (along >= -tail_len), np.minimum(tail_inside, tail_end + 0.6), -1.0)
    hub_a = hub_r - radial
    inner = (hub_r * 0.42) - radial

    def edge(signed: np.ndarray) -> np.ndarray:
        return np.clip(0.5 + signed / (2.0 * sigma), 0.0, 1.0)

    alpha = np.maximum(np.maximum(edge(tip_a), edge(tail_a)), edge(hub_a))
    shade = float(params["shade"])
    color = np.array([shade, shade * 0.97, shade * 0.90], dtype=np.float32)
    rgba = np.zeros((canvas, canvas, 4), dtype=np.float32)
    rgba[..., 0] = color[0]
    rgba[..., 1] = color[1]
    rgba[..., 2] = color[2]
    highlight = edge(inner) * 0.55
    rgba[..., :3] = np.clip(rgba[..., :3] + highlight[..., None] * 0.10, 0.0, 1.0)
    rgba[..., 3] = alpha.astype(np.float32)
    return rgba, tip_len, tail_len


def scale_template(template: np.ndarray, scales: dict, metrics: dict) -> tuple[np.ndarray, float, float]:
    """Scale the photo template. Tip stays on +x. Hub scales uniformly."""
    canvas = template.shape[0]
    cx = canvas / 2.0
    cy = canvas / 2.0
    length_scale = max(0.2, scales["length"])
    width_scale = max(0.2, scales["width"])
    tail_scale = max(0.2, scales["tail"])
    hub_scale = max(0.2, scales["hub"])
    tip_len = float(metrics["tipLenPx"]) * length_scale
    tail_len = float(metrics["tailLenPx"]) * tail_scale
    hub_r = max(1.5, float(metrics["hubRadiusPx"]) * hub_scale)
    ys, xs = np.mgrid[0:canvas, 0:canvas]
    x = (xs + 0.5 - cx).astype(np.float32)
    y = (ys + 0.5 - cy).astype(np.float32)
    radial = np.hypot(x, y)
    hub = radial <= (hub_r + 1.25)
    tip = (~hub) & (x >= 0)
    src_x = np.empty_like(x)
    src_y = np.empty_like(y)
    src_x[hub] = x[hub] / hub_scale
    src_y[hub] = y[hub] / hub_scale
    src_x[tip] = x[tip] / length_scale
    src_y[tip] = y[tip] / width_scale
    tail = (~hub) & (~tip)
    src_x[tail] = x[tail] / tail_scale
    src_y[tail] = y[tail] / width_scale
    map_x = np.ascontiguousarray(src_x + cx - 0.5)
    map_y = np.ascontiguousarray(src_y + cy - 0.5)
    scaled = cv2.remap(template, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    shade = scales["shade"]
    scaled[..., :3] = np.clip(scaled[..., :3] * shade, 0.0, 1.0)
    sigma = 0.20 + scales["softness"] * 2.0
    if sigma >= 0.35:
        blurred = cv2.GaussianBlur(scaled[..., 3], (0, 0), sigma)
        scaled[..., 3] = blurred
    return scaled, tip_len, tail_len


def needle_sprite(bank: dict, profile: dict, params: dict) -> tuple[np.ndarray, float, float]:
    template = bank.get("template")
    metrics = bank.get("metrics") or {}
    if template is not None and metrics.get("tipLenPx") and metrics.get("tailLenPx"):
        sprite, tip_len, tail_len = scale_template(template, _scales(profile, params), metrics)
        # The photo mask can miss a thin tail. Underdraw the procedural tail
        # wherever the template has no coverage, so the tail is always there.
        proc, proc_tip, proc_tail = procedural_sprite(profile, params, template.shape[0])
        missing = sprite[..., 3] < 0.25
        sprite = sprite.copy()
        for c in range(3):
            sprite[..., c] = np.where(missing, proc[..., c], sprite[..., c])
        sprite[..., 3] = np.maximum(sprite[..., 3], proc[..., 3] * missing)
        return sprite, float(max(tip_len, proc_tip)), float(max(tail_len, proc_tail))
    return procedural_sprite(profile, params, CANVAS)


def _affine_points(matrix: np.ndarray, pts: np.ndarray) -> np.ndarray:
    pts = np.asarray(pts, dtype=np.float32)
    return pts @ matrix[:, :2].T + matrix[:, 2]


def place_needle(canvas_rgb: np.ndarray, sprite: np.ndarray, angle_deg: float, shift: tuple[float, float], tip_len: float, tail_len: float):
    """Rotate the +x sprite onto the canvas. Returns BGR-free RGB uint8 and hub/tip/tail points."""
    h, w = canvas_rgb.shape[:2]
    cx = w / 2.0
    cy = h / 2.0
    # Positive OpenCV angle is counter-clockwise. Clockwise (y down) is negative.
    matrix = cv2.getRotationMatrix2D((cx, cy), -float(angle_deg), 1.0)
    matrix[0, 2] += float(shift[0])
    matrix[1, 2] += float(shift[1])
    warped = cv2.warpAffine(
        sprite,
        matrix,
        (w, h),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0, 0),
    )
    alpha = warped[..., 3:4]
    color = warped[..., :3]
    base = canvas_rgb.astype(np.float32) / 255.0
    out = base * (1.0 - alpha) + color * alpha
    out_u8 = np.clip(np.round(out * 255.0), 0, 255).astype(np.uint8)
    local = np.array([[0.0, 0.0], [tip_len, 0.0], [-tail_len, 0.0]], dtype=np.float32)
    local[:, 0] += cx
    local[:, 1] += cy
    hub, tip, tail = _affine_points(matrix, local)
    return out_u8, hub, tip, tail


def _shadow(canvas_rgb: np.ndarray, sprite: np.ndarray, angle_deg: float, shift: tuple[float, float], rng: np.random.Generator) -> np.ndarray:
    h, w = canvas_rgb.shape[:2]
    cx = w / 2.0
    cy = h / 2.0
    extra = rng.uniform(1.2, 3.4, size=2)
    matrix = cv2.getRotationMatrix2D((cx, cy), -float(angle_deg), 1.0)
    matrix[0, 2] += float(shift[0]) + float(extra[0])
    matrix[1, 2] += float(shift[1]) + float(extra[1])
    alpha = sprite[..., 3]
    warped = cv2.warpAffine(alpha, matrix, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    warped = cv2.GaussianBlur(warped, (0, 0), 1.4)
    strength = float(rng.uniform(0.28, 0.55))
    cover = (warped * strength)[..., None]
    darkened = canvas_rgb.astype(np.float32) * (1.0 - cover)
    return np.clip(np.round(darkened), 0, 255).astype(np.uint8)


def _perspective(image: np.ndarray, rng: np.random.Generator, pts: np.ndarray):
    h, w = image.shape[:2]
    src = np.float32([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]])
    jitter = rng.uniform(-0.035, 0.035, size=(4, 2)).astype(np.float32)
    jitter[:, 0] *= w
    jitter[:, 1] *= h
    dst = src + jitter
    matrix = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(image, matrix, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT_101)
    moved = cv2.perspectiveTransform(pts.reshape(-1, 1, 2).astype(np.float32), matrix).reshape(-1, 2)
    return warped, moved


def _motion_blur(image: np.ndarray, angle_deg: float, length: int) -> np.ndarray:
    length = int(length)
    if length < 3:
        return image
    if length % 2 == 0:
        length += 1
    kernel = np.zeros((length, length), dtype=np.float32)
    rad = math.radians(angle_deg + 90.0)
    cx = cy = length // 2
    x0 = int(round(cx - math.cos(rad) * (length / 2 - 1)))
    y0 = int(round(cy - math.sin(rad) * (length / 2 - 1)))
    x1 = int(round(cx + math.cos(rad) * (length / 2 - 1)))
    y1 = int(round(cy + math.sin(rad) * (length / 2 - 1)))
    cv2.line(kernel, (x0, y0), (x1, y1), 1.0, 1)
    total = float(kernel.sum())
    if total <= 0:
        return image
    kernel /= total
    return cv2.filter2D(image, -1, kernel)


def _blob(image: np.ndarray, center, axes, color, alpha: float, angle: float, blur: float) -> np.ndarray:
    h, w = image.shape[:2]
    mask = np.zeros((h, w), dtype=np.float32)
    cv2.ellipse(mask, (int(center[0]), int(center[1])), (max(1, int(axes[0])), max(1, int(axes[1]))), float(angle), 0, 360, 1.0, -1)
    if blur > 0.2:
        mask = cv2.GaussianBlur(mask, (0, 0), blur)
    cover = np.clip(mask * alpha, 0.0, 1.0)[..., None]
    paint = np.array(color, dtype=np.float32).reshape(1, 1, 3)
    mixed = image.astype(np.float32) * (1.0 - cover) + paint * cover
    return np.clip(np.round(mixed), 0, 255).astype(np.uint8)


def _cover_needle(image: np.ndarray, hub: np.ndarray, tip: np.ndarray, tail: np.ndarray, color, alpha: float, blur: float, widen: float) -> np.ndarray:
    h, w = image.shape[:2]
    mask = np.zeros((h, w), dtype=np.float32)
    cv2.line(mask, tuple(np.round(hub).astype(int)), tuple(np.round(tip).astype(int)), 1.0, max(1, int(widen)))
    cv2.line(mask, tuple(np.round(hub).astype(int)), tuple(np.round(tail).astype(int)), 1.0, max(1, int(widen)))
    cv2.circle(mask, tuple(np.round(hub).astype(int)), max(2, int(widen)), 1.0, -1)
    if blur > 0.2:
        mask = cv2.GaussianBlur(mask, (0, 0), blur)
    cover = np.clip(mask * alpha, 0.0, 1.0)[..., None]
    paint = np.array(color, dtype=np.float32).reshape(1, 1, 3)
    mixed = image.astype(np.float32) * (1.0 - cover) + paint * cover
    return np.clip(np.round(mixed), 0, 255).astype(np.uint8)


def apply_augmentations(image: np.ndarray, rng: np.random.Generator, angle: float, hub, tip, tail):
    """Randomised camera and mess stack. Returns image, points, no_needle, names."""
    names = []
    pts = np.stack([hub, tip, tail]).astype(np.float32)
    h, w = image.shape[:2]

    if rng.random() < P_OBLIQUE:
        image, pts = _perspective(image, rng, pts)
        names.append("oblique")
    hub, tip, tail = pts

    if rng.random() < P_MOTION:
        length = int(rng.integers(3, 9))
        image = _motion_blur(image, angle, length)
        names.append("motion")
    if rng.random() < P_DEFOCUS:
        image = cv2.GaussianBlur(image, (0, 0), float(rng.uniform(0.4, 1.5)))
        names.append("defocus")

    if rng.random() < P_GLARE:
        kind = int(rng.integers(0, 3))
        if kind == 0:
            image = _blob(
                image,
                rng.uniform(0, w, size=2),
                rng.uniform(8, 28, size=2),
                (245, 245, 250),
                float(rng.uniform(0.35, 0.75)),
                float(rng.uniform(0, 180)),
                float(rng.uniform(1.5, 4.0)),
            )
        elif kind == 1:
            overlay = image.copy()
            p0 = rng.uniform(0, [w, h])
            p1 = p0 + rng.normal(0, 40, size=2)
            cv2.line(overlay, tuple(p0.astype(int)), tuple(p1.astype(int)), (250, 250, 255), int(rng.integers(1, 3)))
            streak = cv2.GaussianBlur(overlay, (0, 0), 1.2)
            image = cv2.addWeighted(image, 0.72, streak, 0.28, 0)
        else:
            yy = np.linspace(0, 1, h, dtype=np.float32)[:, None]
            xx = np.linspace(0, 1, w, dtype=np.float32)[None, :]
            direction = float(rng.uniform(0, math.tau))
            grad = np.clip(xx * math.cos(direction) + yy * math.sin(direction), 0, 1)
            strength = float(rng.uniform(0.15, 0.40))
            image = np.clip(image.astype(np.float32) * (1 - strength) + 255.0 * strength * grad[..., None], 0, 255).astype(np.uint8)
        names.append("glare")

    if rng.random() < P_MESS:
        splatters = int(rng.integers(4, 14))
        for _ in range(splatters):
            image = _blob(
                image,
                rng.uniform(w * 0.2, w * 0.8, size=2),
                rng.uniform(1.5, 7.0, size=2),
                (rng.integers(25, 70), rng.integers(12, 40), rng.integers(8, 28)),
                float(rng.uniform(0.45, 0.9)),
                float(rng.uniform(0, 180)),
                float(rng.uniform(0.3, 1.2)),
            )
        if rng.random() < 0.7:
            p0 = rng.uniform([w * 0.15, h * 0.15], [w * 0.85, h * 0.85])
            p1 = p0 + rng.normal(0, 30, size=2)
            overlay = image.copy()
            cv2.line(overlay, tuple(p0.astype(int)), tuple(p1.astype(int)), (210, 180, 130), 2)
            image = cv2.addWeighted(image, 0.75, overlay, 0.25, 0)
        names.append("mess")

    if rng.random() < P_LINES:
        count = int(rng.integers(1, 4))
        for _ in range(count):
            line_angle = wrap360(angle + float(rng.uniform(25, 335)))
            rad = math.radians(line_angle)
            span = float(rng.uniform(18, 55))
            origin = np.array([w / 2, h / 2]) + rng.normal(0, 8, size=2)
            p0 = origin - np.array([math.cos(rad), math.sin(rad)]) * span * 0.3
            p1 = origin + np.array([math.cos(rad), math.sin(rad)]) * span
            color = int(rng.integers(8, 40))
            cv2.line(image, tuple(p0.astype(int)), tuple(p1.astype(int)), (color, color, color), int(rng.integers(1, 3)))
        names.append("hard-negative")

    no_needle = False
    if rng.random() < P_FULL:
        image = _cover_needle(image, hub, tip, tail, (rng.integers(20, 80),) * 3, 0.92, 1.6, 14)
        image = _blob(image, hub, (22, 18), (rng.integers(30, 90),) * 3, 0.85, float(rng.uniform(0, 180)), 2.0)
        no_needle = True
        names.append("full-occlusion")
    elif rng.random() < P_PARTIAL:
        which = int(rng.integers(0, 3))
        if which == 0:
            image = _blob(image, hub + rng.normal(0, 10, size=2), rng.uniform(10, 22, size=2), (196, 154, 120), 0.88, float(rng.uniform(0, 180)), 1.5)
            names.append("finger")
        elif which == 1:
            image = _blob(image, rng.uniform(0, [w, h]), (rng.uniform(30, 70), rng.uniform(8, 18)), (18, 16, 14), 0.9, float(rng.uniform(0, 180)), 0.8)
            names.append("portafilter")
        else:
            image = _blob(image, hub + rng.normal(0, 12, size=2), rng.uniform(12, 26, size=2), (230, 230, 235), 0.55, float(rng.uniform(0, 180)), 3.0)
            names.append("steam")

    if rng.random() < P_LOW_LIGHT:
        gain = float(rng.uniform(0.28, 0.62))
        sigma = float(rng.uniform(5.0, 16.0))
        noise = rng.normal(0.0, sigma, size=image.shape)
        image = np.clip(image.astype(np.float32) * gain + noise, 0, 255).astype(np.uint8)
        names.append("low-light")

    if rng.random() < P_CAST:
        gains = rng.uniform(0.72, 1.28, size=3).astype(np.float32)
        gamma = float(rng.uniform(0.85, 1.20))
        cast = np.clip(image.astype(np.float32) * gains, 0, 255) / 255.0
        cast = np.power(cast, gamma)
        image = np.clip(np.round(cast * 255.0), 0, 255).astype(np.uint8)
        names.append("colour-cast")

    if rng.random() < P_JPEG:
        quality = int(rng.integers(36, 88))
        ok, buf = cv2.imencode(".jpg", cv2.cvtColor(image, cv2.COLOR_RGB2BGR), [int(cv2.IMWRITE_JPEG_QUALITY), quality])
        if ok:
            image = cv2.cvtColor(cv2.imdecode(buf, cv2.IMREAD_COLOR), cv2.COLOR_BGR2RGB)
        names.append("jpeg")

    return image, hub, tip, tail, no_needle, names


def output_angle(hub: np.ndarray, tip: np.ndarray, rotation_deg: float) -> float:
    """Tip direction in the rectified crop. rotationDeg is the rectify pose."""
    vector = np.asarray(tip, dtype=np.float64) - np.asarray(hub, dtype=np.float64)
    delta = math.radians(float(rotation_deg))
    cos = math.cos(delta)
    sin = math.sin(delta)
    ox = cos * vector[0] + sin * vector[1]
    oy = -sin * vector[0] + cos * vector[1]
    return wrap360(math.degrees(math.atan2(oy, ox)))


def _pick_background(bank: dict, rng: np.random.Generator) -> tuple[str, np.ndarray]:
    names = bank["names"]
    if rng.random() < P_CLEAN_BG or not names:
        return "dial_clean", bank["backgrounds"]["dial_clean"]
    name = names[int(rng.integers(0, len(names)))]
    return name, bank["backgrounds"][name]


def render_canvas(bank: dict, profile: dict, rng: np.random.Generator):
    bg_name, background = _pick_background(bank, rng)
    image = background.copy()
    angle = float(rng.uniform(0.0, 360.0))
    params = sample_needle_params(profile, rng)
    sprite, tip_len, tail_len = needle_sprite(bank, profile, params)
    if float(rng.random()) < P_PARALLAX:
        shift = tuple(rng.uniform(-3.5, 3.5, size=2))
        image = _shadow(image, sprite, angle, shift, rng)
        names_shift = ["parallax"]
    else:
        shift = (0.0, 0.0)
        names_shift = []
    image, hub, tip, tail = place_needle(image, sprite, angle, shift, tip_len, tail_len)
    image, hub, tip, tail, no_needle, aug_names = apply_augmentations(image, rng, angle, hub, tip, tail)
    # Tracking error is applied as the rectify pose, in crop pixels.
    jitter = rng.uniform(-3.0, 3.0, size=2)
    scale = float(rng.uniform(0.95, 1.05))
    rotation = float(rng.uniform(-3.0, 3.0))
    aug_names = names_shift + aug_names + ["tracking"]
    h, w = image.shape[:2]
    pose = {
        "cx": w / 2.0 + float(jitter[0]),
        "cy": h / 2.0 + float(jitter[1]),
        "radius": DIAL_R * scale,
        "rotationDeg": rotation,
    }
    label = None if no_needle else round(output_angle(hub, tip, rotation), 6)
    return {
        "image": image,
        "pose": pose,
        "angle": label,
        "noNeedle": no_needle,
        "background": bg_name,
        "params": params,
        "augs": aug_names,
        "tailLen": tail_len,
        "tipLen": tip_len,
    }


def tensor_from_canvas(image: np.ndarray, pose: dict, profile: dict, mode: str, extra_red: bool = EXTRA_RED) -> np.ndarray:
    h, w = image.shape[:2]
    rgba = np.empty((h, w, 4), dtype=np.uint8)
    rgba[..., :3] = image
    rgba[..., 3] = 255
    chw = rectify(np.ascontiguousarray(rgba), w, h, pose, rectify_spec(profile, mode))
    return with_red(chw, extra_red)


def render_sample(bank: dict, profile: dict, seed: int, index: int, mode: str = "cartesian", extra_red: bool = EXTRA_RED) -> dict:
    rng = make_rng(seed, index)
    drawn = render_canvas(bank, profile, rng)
    tensor = tensor_from_canvas(drawn["image"], drawn["pose"], profile, mode, extra_red)
    drawn["tensor"] = tensor
    drawn["mode"] = mode
    drawn["seed"] = int(seed)
    drawn["index"] = int(index)
    return drawn


def render_both(bank: dict, profile: dict, seed: int, index: int, extra_red: bool = EXTRA_RED) -> dict:
    """One canvas, both crops. The label does not depend on the mode."""
    rng = make_rng(seed, index)
    drawn = render_canvas(bank, profile, rng)
    drawn["cartesian"] = tensor_from_canvas(drawn["image"], drawn["pose"], profile, "cartesian", extra_red)
    drawn["polar"] = tensor_from_canvas(drawn["image"], drawn["pose"], profile, "polar", extra_red)
    drawn["seed"] = int(seed)
    drawn["index"] = int(index)
    return drawn


def to_uint8_hwc(chw: np.ndarray) -> np.ndarray:
    rgb = np.clip(np.round(chw[:3] * 255.0), 0, 255).astype(np.uint8)
    return np.transpose(rgb, (1, 2, 0))


def expected_shapes(extra_red: bool = EXTRA_RED) -> dict:
    channels = 4 if extra_red else 3
    return {
        "cartesian": (channels, CARTESIAN_SIZE, CARTESIAN_SIZE),
        "polar": (channels, POLAR_RADIUS_BINS, POLAR_ANGLE_BINS),
        "outerRadiusPx": POLAR_OUTER_PX,
    }
