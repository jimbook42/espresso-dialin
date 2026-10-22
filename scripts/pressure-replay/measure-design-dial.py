"""Offline measurement of Flair 58 dial reference photos. Not loaded at runtime.

Reads one or more photos and prints dial geometry in the unit-circle frame.
Angles: 0° is to the right, clockwise, because image y grows downward.
Outputs angles relative to the zero stop pin and band radii as fractions of face radius.
Does not write image files. Pixel centre and radius are not runtime constants.
"""
import json
import os
import sys

import numpy as np
from PIL import Image

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.dirname(os.path.dirname(_SCRIPT_DIR))
DEFAULT_PHOTO = os.environ.get(
    'FLAIR_DESIGN_PHOTO',
    os.path.join(_REPO_ROOT, 'docs/reference/flair58-face-phone.jpg'),
)

# Tick-measured 0–10 bar scale (half-bar ticks). Primary: flair58-face-phone.jpg.
# flair58-face-product.png disagrees (>3°): ~190.1° sweep vs values below.
FLAIR_58_HALF_BAR_TICK_COUNT = 21
FLAIR_58_HALF_BAR_SPACING_DEG = 8.976
FLAIR_58_SWEEP_DEG = 179.52
FLAIR_58_FIVE_BAR_REL_DEG = 89.76
FLAIR_58_TEN_BAR_REL_DEG = 179.52
FLAIR_58_TICK_FIT_RMS_DEG = 0.493
FLAIR_58_BAR_PER_HALF_TICK = 0.5


def wrap360(deg):
    return float(deg) % 360


def atan2_deg(dy, dx):
    return wrap360(float(np.degrees(np.arctan2(dy, dx))))


def rel_to_zero(zero_deg, angle_deg):
    if angle_deg is None:
        return None
    return round(wrap360(angle_deg - zero_deg), 1)


def measure_scale_ticks(photo_path, cx, cy, face_radius, zero_deg, image, luma, sample):
    """Uniform half-bar tick spacing on the printed arc; numerals 5/10 have no ticks."""
    step = 0.25
    max_rel = 215.0
    rels = np.arange(0, max_rel, step)
    vals = []
    for rel in rels:
        abs_deg = wrap360(zero_deg + rel)
        rad = np.deg2rad(abs_deg)
        cos, sin = np.cos(rad), np.sin(rad)
        outer = np.mean([
            sample(luma, cx + face_radius * rf * cos, cy + face_radius * rf * sin)
            for rf in np.linspace(0.76, 0.93, 7)
        ])
        mid = np.mean([
            sample(luma, cx + face_radius * rf * cos, cy + face_radius * rf * sin)
            for rf in np.linspace(0.66, 0.76, 4)
        ])
        inner = np.mean([
            sample(luma, cx + face_radius * rf * cos, cy + face_radius * rf * sin)
            for rf in np.linspace(0.55, 0.64, 4)
        ])
        vals.append((outer - mid) + 0.5 * (mid - inner))
    smooth = np.convolve(np.array(vals), np.ones(9) / 9, mode='same')
    n_ticks = FLAIR_58_HALF_BAR_TICK_COUNT
    best = None
    for spacing in np.arange(7.8, 9.5, 0.01):
        for phase in np.arange(0, spacing, 0.05):
            observed = []
            for k in range(n_ticks):
                target = phase + k * spacing
                if target > max_rel:
                    break
                idx = int(round(target / step))
                lo = max(0, idx - 4)
                hi = min(len(smooth), idx + 5)
                window = smooth[lo:hi]
                if len(window) < 3:
                    continue
                peak_idx = lo + int(np.argmax(window))
                if peak_idx < 1 or peak_idx >= len(smooth) - 1:
                    continue
                y0, y1, y2 = smooth[peak_idx - 1], smooth[peak_idx], smooth[peak_idx + 1]
                off = 0.0
                denom = y0 - 2 * y1 + y2
                if abs(denom) > 1e-9:
                    off = 0.5 * (y0 - y2) / denom * step
                observed.append(peak_idx * step + off)
            if len(observed) < n_ticks - 4:
                continue
            y = np.array(observed)
            idx = np.arange(len(y))
            slope, intercept = np.linalg.lstsq(
                np.vstack([idx, np.ones(len(y))]).T,
                y,
                rcond=None,
            )[0]
            pred = slope * idx + intercept
            resid = y - pred
            rms = float(np.sqrt(np.mean(resid ** 2)))
            if best is None or rms < best['fitRmsDeg']:
                best = {
                    'tickCount': int(len(y)),
                    'halfBarSpacingDeg': round(float(slope), 3),
                    'sweepDeg': round(float(slope * (n_ticks - 1)), 2),
                    'fiveBarRelativeDeg': round(float(slope * 10), 2),
                    'tenBarRelativeDeg': round(float(slope * (n_ticks - 1)), 2),
                    'fitRmsDeg': round(rms, 3),
                    'fitResidualsDeg': [round(float(r), 3) for r in resid],
                    'firstTickRelativeDeg': round(float(intercept), 2),
                }
    if best is None:
        raise SystemExit(f'no tick scale in {photo_path}')
    return best


def measure_photo(photo_path):
    image = np.array(Image.open(photo_path).convert('RGB')).astype(np.float32)
    height, width = image.shape[:2]
    luma = image[:, :, 0] * 0.299 + image[:, :, 1] * 0.587 + image[:, :, 2] * 0.114

    def sample(arr, x, y):
        xi = int(np.clip(round(x), 0, width - 1))
        yi = int(np.clip(round(y), 0, height - 1))
        return float(arr[yi, xi])

    def chroma_at(x, y):
        xi = int(np.clip(round(x), 0, width - 1))
        yi = int(np.clip(round(y), 0, height - 1))
        r, g, b = image[yi, xi]
        excess = float(r - max(g, b))
        if excess <= 0:
            return 0.0
        return excess / ((float(r) + float(g) + float(b)) / 3 + 1)

    short = min(height, width)
    margin = max(16, int(short * 0.06))
    step = max(6, int(short * 0.035))
    r_min = max(24, int(short * 0.18))
    r_max = int(short * 0.46)
    r_step = max(6, step // 2)

    best_circle = None
    for cy in range(margin, height - margin, step):
        for cx in range(margin, width - margin, step):
            for radius in range(r_min, r_max, r_step):
                face_vals = []
                ring_vals = []
                red_mass = 0.0
                for deg in range(0, 360, 20):
                    rad = np.deg2rad(deg)
                    cos, sin = np.cos(rad), np.sin(rad)
                    face_vals.append(sample(luma, cx + radius * 0.5 * cos, cy + radius * 0.5 * sin))
                    ring_vals.append(sample(luma, cx + radius * 1.02 * cos, cy + radius * 1.02 * sin))
                    red_mass += chroma_at(cx + radius * 0.55 * cos, cy + radius * 0.55 * sin)
                ring_mean = float(np.mean(ring_vals))
                ring_cap = 95 if short > 900 else 118
                red_floor = 0.35 if short > 900 else 0.12
                if ring_mean > ring_cap or red_mass < red_floor:
                    continue
                score = float(np.mean(face_vals) - ring_mean) + red_mass * 40
                if best_circle is None or score > best_circle['score']:
                    best_circle = {'x': cx, 'y': cy, 'radius': radius, 'score': score}
    if best_circle is None:
        # Studio product shots can sit on a white field with no dark bezel ring.
        best_circle = None
        for cy in range(margin, height - margin, step):
            for cx in range(margin, width - margin, step):
                for radius in range(r_min, r_max, r_step):
                    inner = []
                    outer = []
                    red_mass = 0.0
                    for deg in range(0, 360, 24):
                        rad = np.deg2rad(deg)
                        cos, sin = np.cos(rad), np.sin(rad)
                        inner.append(sample(luma, cx + radius * 0.35 * cos, cy + radius * 0.35 * sin))
                        outer.append(sample(luma, cx + radius * 0.95 * cos, cy + radius * 0.95 * sin))
                        red_mass += chroma_at(cx + radius * 0.55 * cos, cy + radius * 0.55 * sin)
                    if red_mass < 0.2:
                        continue
                    score = float(np.mean(inner) - np.mean(outer)) + red_mass * 35
                    if best_circle is None or score > best_circle['score']:
                        best_circle = {'x': cx, 'y': cy, 'radius': radius, 'score': score}
    if best_circle is None:
        raise SystemExit(f'no dial circle in {photo_path}')

    def ray_lum(cx, cy, radius, deg):
        rad = np.deg2rad(deg)
        return sample(luma, cx + radius * np.cos(rad), cy + radius * np.sin(rad))

    def thin_needle_votes(cx, cy, face_radius):
        votes = []
        for t in np.linspace(0.32, 0.58, 8):
            radius = face_radius * float(t)
            best = None
            for deg in range(360):
                centre = ray_lum(cx, cy, radius, deg)
                left = ray_lum(cx, cy, radius, deg - 10)
                right = ray_lum(cx, cy, radius, deg + 10)
                if left < centre + 10 or right < centre + 10:
                    continue
                score = (left + right) / 2 - centre
                if best is None or score > best[0]:
                    best = (score, deg)
            if best is not None:
                votes.append(best[1])
        return votes

    def dominant_cluster(votes):
        if not votes:
            return None, None
        best = None
        for candidate in votes:
            members = [angle for angle in votes if abs((angle - candidate + 180) % 360 - 180) <= 12]
            if best is None or len(members) > best[0]:
                best = (len(members), float(np.median(members)), float(np.max(members) - np.min(members)))
        return best[1], best[0]

    face_radius = int(best_circle['radius'])
    shrink = max(80, int(face_radius * 0.45))
    for radius in range(best_circle['radius'], best_circle['radius'] - shrink, -6):
        ring = [ray_lum(best_circle['x'], best_circle['y'], radius, deg) for deg in range(0, 360, 12)]
        if float(np.mean(ring)) > 75:
            face_radius = int(radius)
            break

    hub_span = max(24, int(face_radius * 0.18))
    hub_step = max(4, hub_span // 10)
    best_hub = None
    for y in range(best_circle['y'] - hub_span, best_circle['y'] + hub_span + 1, hub_step):
        for x in range(best_circle['x'] - hub_span, best_circle['x'] + hub_span + 1, hub_step):
            votes = thin_needle_votes(x, y, face_radius)
            centre, count = dominant_cluster(votes)
            if centre is None or count < 4:
                continue
            spread = float(np.std([
                (angle - centre + 180) % 360 - 180
                for angle in votes
                if abs((angle - centre + 180) % 360 - 180) <= 12
            ]))
            if best_hub is None or (count, -spread) > (best_hub['count'], -best_hub['spread']):
                best_hub = {'x': x, 'y': y, 'needle': centre, 'count': count, 'spread': spread}
    if best_hub is None:
        raise SystemExit(f'no stable needle in {photo_path}')
    cx, cy = best_hub['x'], best_hub['y']
    needle_deg = wrap360(best_hub['needle'])

    pin = None
    for deg in range(int(needle_deg) - 25, int(needle_deg) + 26):
        rad = np.deg2rad(wrap360(deg))
        for t in np.linspace(0.64, 0.88, 12):
            x = cx + face_radius * t * np.cos(rad)
            y = cy + face_radius * t * np.sin(rad)
            value = sample(luma, x, y)
            if value < 125:
                continue
            ang = atan2_deg(y - cy, x - cx)
            off = min(abs(ang - needle_deg), 360 - abs(ang - needle_deg))
            if off < 2:
                continue
            if pin is None or value > pin['lum']:
                pin = {'deg': ang, 'lum': value, 't': float(t)}
    zero_deg = pin['deg'] if pin else needle_deg

    red = np.zeros(360)
    for deg in range(360):
        rad = np.deg2rad(deg)
        cos, sin = np.cos(rad), np.sin(rad)
        red[deg] = np.mean([
            chroma_at(cx + face_radius * rf * cos, cy + face_radius * rf * sin)
            for rf in np.linspace(0.40, 0.64, 10)
        ])
    smooth = np.array([np.mean([red[int(wrap360(deg + k))] for k in range(-3, 4)]) for deg in range(360)])
    red_on = smooth > 0.14
    red_runs = []
    cursor = int(np.argmin(red_on.astype(np.int8)))
    for k in range(360):
        i = (cursor + k) % 360
        if not red_on[i] or red_on[(i - 1) % 360]:
            continue
        mass = 0.0
        length = 0
        for t in range(360):
            j = (i + t) % 360
            if not red_on[j]:
                break
            mass += float(smooth[j])
            length += 1
        red_runs.append({'start': i, 'end': (i + length - 1) % 360, 'len': length, 'mass': mass})
    red_runs.sort(key=lambda run: run['mass'], reverse=True)
    if not red_runs:
        raise SystemExit(f'no red sector in {photo_path}')
    espresso = red_runs[0]

    outer = np.array([
        np.mean([
            ray_lum(cx, cy, face_radius * rf, deg)
            for rf in np.linspace(0.74, 0.92, 5)
        ])
        for deg in range(360)
    ])
    outer_med = float(np.median(outer))
    dark_on = np.array([
        outer[deg] < outer_med * 0.85
        and min(abs(deg - needle_deg), 360 - abs(deg - needle_deg)) > 25
        and min(abs(deg - zero_deg), 360 - abs(deg - zero_deg)) > 20
        for deg in range(360)
    ])
    dark_runs = []
    dark_cursor = int(np.argmin(dark_on.astype(np.int8)))
    for k in range(360):
        i = (dark_cursor + k) % 360
        if not dark_on[i] or dark_on[(i - 1) % 360]:
            continue
        length = 0
        for t in range(360):
            if not dark_on[(i + t) % 360]:
                break
            length += 1
        if length >= 12:
            dark_runs.append({'start': i, 'end': (i + length - 1) % 360, 'len': length})
    dark_runs.sort(key=lambda run: run['start'])
    merged = []
    for run in dark_runs:
        if not merged:
            merged.append(dict(run))
            continue
        gap = (run['start'] - merged[-1]['end']) % 360
        if gap <= 25:
            merged[-1]['end'] = run['end']
            merged[-1]['len'] = int((merged[-1]['end'] - merged[-1]['start']) % 360) or 360
        else:
            merged.append(dict(run))
    merged.sort(key=lambda run: run['len'], reverse=True)
    stop = merged[0] if merged else {'start': 0, 'end': 0, 'len': 0}

    def glyph(d0, d1):
        sin = 0.0
        cos = 0.0
        mass = 0.0
        for deg in range(d0, d1 + 1):
            wrapped = wrap360(deg)
            rad = np.deg2rad(wrapped)
            c, s = np.cos(rad), np.sin(rad)
            for rf in np.linspace(0.58, 0.76, 8):
                value = chroma_at(cx + face_radius * rf * c, cy + face_radius * rf * s)
                if value < 0.1:
                    continue
                sin += value * s
                cos += value * c
                mass += value
        if mass < 1:
            return None
        return atan2_deg(sin, cos)

    five = glyph(int(espresso['start']) - 45, int(espresso['start']) + 10)
    ten = glyph(int(espresso['end']) - 10, int(espresso['end']) + 45)

    def band_radii_on_ray(deg, chroma_floor=0.12):
        inner = None
        outer = None
        rad = np.deg2rad(deg)
        cos, sin = np.cos(rad), np.sin(rad)
        for rf in np.linspace(0.30, 0.78, 50):
            ch = chroma_at(cx + face_radius * rf * cos, cy + face_radius * rf * sin)
            if ch >= chroma_floor:
                if inner is None:
                    inner = float(rf)
                outer = float(rf)
        return inner, outer

    esp_mid = wrap360(espresso['start'] + espresso['len'] / 2)
    red_inner, red_outer = band_radii_on_ray(esp_mid)
    stop_mid = wrap360(stop['start'] + stop['len'] / 2) if stop['len'] else None
    dark_inner = dark_outer = None
    if stop_mid is not None:
        dark_inner, dark_outer = band_radii_on_ray(stop_mid, chroma_floor=0.0)
        if dark_inner is not None:
            lum_profile = []
            rad = np.deg2rad(stop_mid)
            cos, sin = np.cos(rad), np.sin(rad)
            for rf in np.linspace(0.68, 0.94, 28):
                lum_profile.append((
                    rf,
                    sample(luma, cx + face_radius * rf * cos, cy + face_radius * rf * sin),
                ))
            med = float(np.median([item[1] for item in lum_profile]))
            dark_inner = dark_outer = None
            for rf, lum in lum_profile:
                if lum < med * 0.82:
                    if dark_inner is None:
                        dark_inner = rf
                    dark_outer = rf

    logo_sin = logo_cos = logo_mass = 0.0
    for deg in range(360):
        rad = np.deg2rad(deg)
        cos, sin = np.cos(rad), np.sin(rad)
        for rf in np.linspace(0.16, 0.42, 8):
            ch = chroma_at(cx + face_radius * rf * cos, cy + face_radius * rf * sin)
            if ch < 0.09:
                continue
            if chroma_at(cx + face_radius * 0.52 * cos, cy + face_radius * 0.52 * sin) > 0.18:
                continue
            logo_sin += ch * sin
            logo_cos += ch * cos
            logo_mass += ch
    logo_deg = atan2_deg(logo_sin, logo_cos) if logo_mass > 4 else None

    reg_pins = []
    clusters = []
    for deg in range(360):
        rad = np.deg2rad(deg)
        for t in np.linspace(0.68, 0.86, 8):
            x = cx + face_radius * t * np.cos(rad)
            y = cy + face_radius * t * np.sin(rad)
            value = sample(luma, x, y)
            if value < 155:
                continue
            ang = atan2_deg(y - cy, x - cx)
            if min(abs(ang - zero_deg), 360 - abs(ang - zero_deg)) < 6:
                continue
            for cluster in clusters:
                cdeg = float(np.median(cluster['degs']))
                if abs((ang - cdeg + 180) % 360 - 180) > 7:
                    continue
                cluster['degs'].append(ang)
                cluster['ts'].append(float(t))
                cluster['lum'] = max(cluster['lum'], value)
                break
            else:
                clusters.append({'degs': [ang], 'ts': [float(t)], 'lum': value})
    for cluster in clusters:
        if len(cluster['degs']) < 5:
            continue
        deg = float(np.median(cluster['degs']))
        rel = rel_to_zero(zero_deg, deg)
        if rel is None or rel < 120 or rel > 250:
            continue
        reg_pins.append({
            'deg': round(deg, 1),
            'relativeDeg': rel,
            'radiusFraction': round(float(np.median(cluster['ts'])), 3),
        })
    reg_pins.sort(key=lambda item: item['relativeDeg'])

    scale_ticks = measure_scale_ticks(photo_path, cx, cy, face_radius, zero_deg, image, luma, sample)

    return {
        'photo': photo_path,
        'image': {'width': int(width), 'height': int(height)},
        'hub': {'x': int(cx), 'y': int(cy)},
        'faceRadiusPx': int(face_radius),
        'angles': {
            'zeroStopPin': round(zero_deg, 1),
            'needleLongEnd': round(needle_deg, 1),
            'five': None if five is None else round(five, 1),
            'ten': None if ten is None else round(ten, 1),
            'espressoStart': int(espresso['start']),
            'espressoEnd': int(espresso['end']),
            'espressoWidth': int(espresso['len']),
            'stopStart': int(stop['start']),
            'stopEnd': int(stop['end']),
            'stopWidth': int(stop['len']),
            'flairLogo': None if logo_deg is None else round(logo_deg, 1),
        },
        'relativeToZeroPin': {
            'five': rel_to_zero(zero_deg, five),
            'ten': rel_to_zero(zero_deg, ten),
            'espressoStart': rel_to_zero(zero_deg, espresso['start']),
            'espressoEnd': rel_to_zero(zero_deg, espresso['end']),
            'stopStart': rel_to_zero(zero_deg, stop['start']),
            'stopEnd': rel_to_zero(zero_deg, stop['end']),
            'flairLogo': rel_to_zero(zero_deg, logo_deg),
            'scaleFiveFromTicks': scale_ticks['fiveBarRelativeDeg'],
            'scaleTenFromTicks': scale_ticks['tenBarRelativeDeg'],
        },
        'bandRadiusFraction': {
            'redInner': round(red_inner, 3) if red_inner is not None else None,
            'redOuter': round(red_outer, 3) if red_outer is not None else None,
            'darkInner': round(dark_inner, 3) if dark_inner is not None else None,
            'darkOuter': round(dark_outer, 3) if dark_outer is not None else None,
        },
        'registrationPins': reg_pins,
        'scaleFromTicks': scale_ticks,
        'printedMaxBar': 10,
        'printedSweepDeg': FLAIR_58_SWEEP_DEG,
        'barPerHalfTick': FLAIR_58_BAR_PER_HALF_TICK,
    }


def main():
    paths = sys.argv[1:] if len(sys.argv) > 1 else [DEFAULT_PHOTO]
    reports = [measure_photo(path) for path in paths]
    if len(reports) == 1:
        print(json.dumps(reports[0], indent=2))
    else:
        print(json.dumps(reports, indent=2))


if __name__ == '__main__':
    main()
