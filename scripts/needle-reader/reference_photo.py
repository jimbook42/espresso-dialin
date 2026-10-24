"""Sanity-check the Flair anchors against the rest reference photo.

Uses the repo's dial measurement (scripts/pressure-replay/measure-design-dial.py):
needle, 0 pin, and the half-bar tick fit for 5 and 10. Angles are clockwise
degrees in the image (0° = +x, y down). Relative angles do not depend on EXIF
orientation. Prints one JSON object and does not write image files.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

EYE = {"pinToFiveDeg": 82.0, "pinToTenDeg": 170.0, "restNeedleDeg": 7.0}
# One oblique phone photo. Automatic pin and tick localisation is coarser than a visual ±3°.
COARSE = {"pinToFiveDeg": 8.0, "pinToTenDeg": 12.0, "restNeedleDeg": 8.0}
DEFAULT = "/workspace/flair-train/dry/20261015_225359.jpg"


def wrap360(deg: float) -> float:
    return float(deg) % 360.0


def clockwise(from_deg: float, to_deg: float) -> float:
    return wrap360(to_deg - from_deg)


def _measure_module():
    path = Path(__file__).resolve().parents[1] / "pressure-replay" / "measure-design-dial.py"
    spec = importlib.util.spec_from_file_location("measure_design_dial", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def measure(path: str) -> dict:
    raw = _measure_module().measure_photo(path)
    pin = float(raw["angles"]["zeroStopPin"])
    needle = float(raw["angles"]["needleLongEnd"])
    measured = {
        "pinToFiveDeg": float(raw["relativeToZeroPin"]["scaleFiveFromTicks"]),
        "pinToTenDeg": float(raw["relativeToZeroPin"]["scaleTenFromTicks"]),
        "restNeedleDeg": round(clockwise(pin, needle), 3),
    }
    deltas = {key: round(measured[key] - EYE[key], 3) for key in EYE}
    within = all(abs(deltas[key]) <= COARSE[key] for key in EYE)
    return {
        "photo": path,
        "image": raw["image"],
        "hub": raw["hub"],
        "faceRadiusPx": raw["faceRadiusPx"],
        "needleDeg": needle,
        "pinDeg": pin,
        "measured": measured,
        "eye": EYE,
        "deltaFromEyeDeg": deltas,
        "coarseToleranceDeg": COARSE,
        "withinCoarseBand": within,
        "ticks": raw["scaleFromTicks"],
        "method": "measure-design-dial tick fit from the 0 pin",
    }


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
    json.dump(measure(path), sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
