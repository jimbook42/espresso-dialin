"""Offline measurement of the design photo. Not loaded at runtime.

Reads the Flair design photo and prints dial angles relative to each other.
Angles: 0° is to the right, clockwise, because image y grows downward.
Does not write image files. Pixel centre and radius are not runtime constants.
"""
import json
import os

import numpy as np
from PIL import Image

PHOTO = os.environ.get('FLAIR_DESIGN_PHOTO', '/workspace/flair-replay/20261015_225359.jpg')


def wrap360(deg):
    return float(deg) % 360


def atan2_deg(dy, dx):
    return wrap360(float(np.degrees(np.arctan2(dy, dx))))


image = np.array(Image.open(PHOTO).convert('RGB')).astype(np.float32)
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


# A bright face inside a dark bezel, with printed red. A lamp has no red sector.
best_circle = None
for cy in range(400, height - 400, 32):
    for cx in range(400, width - 400, 32):
        for radius in range(480, 900, 40):
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
            if ring_mean > 95 or red_mass < 0.4:
                continue
            score = float(np.mean(face_vals) - ring_mean) + red_mass * 40
            if best_circle is None or score > best_circle['score']:
                best_circle = {'x': cx, 'y': cy, 'radius': radius, 'score': score}
if best_circle is None:
    raise SystemExit('no dial circle')


def ray_lum(cx, cy, radius, deg):
    rad = np.deg2rad(deg)
    return sample(luma, cx + radius * np.cos(rad), cy + radius * np.sin(rad))


def thin_needle_votes(cx, cy, face_radius):
    """Angle of the thin dark ridge on the white face. A wide printed sector is not thin."""
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
# Inner edge of the bezel, from the coarse circle inward until the face is bright.
for radius in range(best_circle['radius'], best_circle['radius'] - 280, -8):
    ring = [ray_lum(best_circle['x'], best_circle['y'], radius, deg) for deg in range(0, 360, 12)]
    if float(np.mean(ring)) > 78:
        face_radius = int(radius)
        break

best_hub = None
for y in range(best_circle['y'] - 80, best_circle['y'] + 81, 8):
    for x in range(best_circle['x'] - 80, best_circle['x'] + 81, 8):
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
    raise SystemExit('no stable needle')
cx, cy = best_hub['x'], best_hub['y']
needle_deg = wrap360(best_hub['needle'])

# Stop pin: bright speck beside the long-end tip, on the outer face.
pin = None
for deg in range(int(needle_deg) - 20, int(needle_deg) + 21):
    rad = np.deg2rad(wrap360(deg))
    for t in np.linspace(0.64, 0.86, 12):
        x = cx + face_radius * t * np.cos(rad)
        y = cy + face_radius * t * np.sin(rad)
        value = sample(luma, x, y)
        if value < 130:
            continue
        ang = atan2_deg(y - cy, x - cx)
        off = min(abs(ang - needle_deg), 360 - abs(ang - needle_deg))
        if off < 2:
            continue
        if pin is None or value > pin['lum']:
            pin = {'deg': ang, 'lum': value}
zero_deg = pin['deg'] if pin else needle_deg

red = np.zeros(360)
for deg in range(360):
    rad = np.deg2rad(deg)
    cos, sin = np.cos(rad), np.sin(rad)
    red[deg] = np.mean([
        chroma_at(cx + face_radius * rf * cos, cy + face_radius * rf * sin)
        for rf in np.linspace(0.46, 0.60, 8)
    ])
smooth = np.array([np.mean([red[int(wrap360(deg + k))] for k in range(-3, 4)]) for deg in range(360)])
red_on = smooth > 0.15
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
    raise SystemExit('no red sector')
espresso = red_runs[0]

outer = np.array([
    np.mean([
        ray_lum(cx, cy, face_radius * rf, deg)
        for rf in np.linspace(0.78, 0.90, 5)
    ])
    for deg in range(360)
])
outer_med = float(np.median(outer))
# Skip the needle's own shadow near zero. The STOP band is the other dark sector.
dark_on = np.array([
    outer[deg] < outer_med * 0.85 and min(abs(deg - needle_deg), 360 - abs(deg - needle_deg)) > 25
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
    if length >= 15:
        dark_runs.append({'start': i, 'end': (i + length - 1) % 360, 'len': length})
# A screw can split the printed STOP band. Merge runs that sit within 25°.
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
        for rf in np.linspace(0.58, 0.74, 8):
            value = chroma_at(cx + face_radius * rf * c, cy + face_radius * rf * s)
            if value < 0.1:
                continue
            sin += value * s
            cos += value * c
            mass += value
    if mass < 1:
        return None
    return atan2_deg(sin, cos)


five = glyph(espresso['start'] - 40, espresso['start'] + 8)
ten = glyph(espresso['end'] - 8, espresso['end'] + 40)

report = {
    'photo': PHOTO,
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
    },
    'printedMaxBar': 10,
    'printedNumerals': (
        '0 at the stop pin, 5, and 10. No 12 and no 16 are printed. '
        'The dark band past 10 reads STOP! BREAKAGE!.'
    ),
    'note': (
        'Angles are this photo orientation. The template stores them relative to each other. '
        'Pixel centre and radius are not runtime constants.'
    ),
}
print(json.dumps(report, indent=2))
