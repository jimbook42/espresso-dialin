#!/usr/bin/env python3
"""Phase 2 synthetic needle generator.

Backgrounds and the validation set are written under /workspace/pl-state/nr/synth
(not the repo). The model tensor is the Phase-1 rectify crop plus the red channel.

  python3 scripts/needle-reader/synth.py backgrounds
  python3 scripts/needle-reader/synth.py contact
  python3 scripts/needle-reader/synth.py determinism
  python3 scripts/needle-reader/synth.py benchmark
  python3 scripts/needle-reader/synth.py val
  python3 scripts/needle-reader/synth.py gate
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))

from gauge_profile import load_gauge_profile  # noqa: E402
from synth_bank import build_bank, load_bank, mem_available_mb  # noqa: E402
from synth_render import (  # noqa: E402
    CANVAS,
    EXTRA_RED,
    VAL_COUNT,
    VAL_SEED,
    expected_shapes,
    make_rng,
    needle_sprite,
    output_angle,
    place_needle,
    render_both,
    render_sample,
    to_uint8_hwc,
)

REPO = Path(__file__).resolve().parents[2]
DEFAULT_PROFILE = REPO / "profiles" / "flair58-v1.json"
DEFAULT_OUT = Path("/workspace/pl-state/nr/synth")


def _threads() -> None:
    cv2.setNumThreads(1)
    try:
        cv2.ocl.setUseOpenCL(False)
    except Exception:
        pass


def _require_mem() -> None:
    free = mem_available_mb()
    if free < 3072:
        raise SystemExit(f"need >= 3 GB MemAvailable, have {free:.0f} MB")


def _chw_u8(chw: np.ndarray) -> np.ndarray:
    return np.clip(np.round(chw * 255.0), 0, 255).astype(np.uint8)


def _label_row(sample: dict) -> dict:
    row = {
        "index": sample["index"],
        "seed": sample["seed"],
        "angle": sample["angle"],
        "noNeedle": bool(sample["noNeedle"]),
        "background": sample["background"],
        "augs": sample["augs"],
        "needle": {key: round(float(sample["params"][key]), 6) for key in ("width", "length", "tailRatio", "shade", "softness", "hub")},
    }
    if "bar" in row or "value" in row:
        raise RuntimeError("label must be angle-only")
    return row


def cmd_backgrounds(args) -> None:
    _require_mem()
    _threads()
    profile = load_gauge_profile(str(args.profile))
    meta = build_bank(profile, args.out, stride=args.stride, only=args.clips)
    print(json.dumps({
        "clips": len(meta["clips"]),
        "template": meta["template"],
        "out": str(args.out),
    }, indent=2))


def _sheet(cells: list[np.ndarray], labels: list[str], columns: int, scale: int, title: str) -> Image.Image:
    if not cells:
        raise RuntimeError("empty contact sheet")
    base_h, base_w = cells[0].shape[:2]
    cell_w = base_w * scale
    cell_h = base_h * scale
    caption = 18
    gap = 6
    rows = (len(cells) + columns - 1) // columns
    width = columns * cell_w + (columns + 1) * gap
    height = rows * (cell_h + caption) + (rows + 1) * gap + 8
    sheet = Image.new("RGB", (width, height), (28, 28, 28))
    draw = ImageDraw.Draw(sheet)
    for i, (cell, label) in enumerate(zip(cells, labels)):
        row, col = divmod(i, columns)
        x = gap + col * (cell_w + gap)
        y = gap + row * (cell_h + caption + gap)
        tile = cell
        if cell.shape[2] == 3:
            image = Image.fromarray(cell, mode="RGB")
        else:
            image = Image.fromarray(cell, mode="RGBA")
        if scale != 1:
            image = image.resize((cell_w, cell_h), Image.Resampling.NEAREST)
        sheet.paste(image, (x, y))
        draw.text((x, y + cell_h + 2), label[:42], fill=(230, 230, 230))
    return sheet


def cmd_contact(args) -> None:
    _threads()
    profile = load_gauge_profile(str(args.profile))
    bank = load_bank(args.out)
    columns = 8
    synth = columns * columns
    cart_cells = []
    polar_cells = []
    cart_labels = []
    polar_labels = []
    for index in range(synth):
        sample = render_both(bank, profile, VAL_SEED, index, extra_red=not args.no_extra_red)
        cart_cells.append(to_uint8_hwc(sample["cartesian"]))
        polar_cells.append(to_uint8_hwc(sample["polar"]))
        if sample["noNeedle"]:
            text = f"{index} no needle"
        else:
            text = f"{index} {sample['angle']:.0f}°"
        cart_labels.append(text)
        polar_labels.append(text)
    real_c = bank["real_cartesian"]
    real_p = bank["real_polar"]
    names = bank["real_names"]
    pick = np.linspace(0, len(names) - 1, min(columns, len(names)), dtype=int) if names else []
    for i in pick:
        cart_cells.append(real_c[int(i)])
        polar_cells.append(real_p[int(i)])
        cart_labels.append(f"real {names[int(i)][-6:]}")
        polar_labels.append(f"real {names[int(i)][-6:]}")
    cart_path = args.out / "contact-cartesian.png"
    polar_path = args.out / "contact-polar.png"
    _sheet(cart_cells, cart_labels, columns, 2, "cartesian").save(cart_path)
    _sheet(polar_cells, polar_labels, columns, 2, "polar").save(polar_path)
    print(json.dumps({"cartesian": str(cart_path), "polar": str(polar_path)}, indent=2))


def _clean_tensor(bank, profile):
    image = bank["backgrounds"]["dial_clean"]
    h, w = image.shape[:2]
    pose = {"cx": w / 2.0, "cy": h / 2.0, "radius": 40.0, "rotationDeg": 0.0}
    from synth_render import tensor_from_canvas
    return tensor_from_canvas(image, pose, profile, "cartesian", True)


def _outer_tip(tensor: np.ndarray, clean: np.ndarray):
    """Bearing of the darkness the needle adds outside the hub."""
    weights = (0.299, 0.587, 0.114)
    luma = weights[0] * tensor[0] + weights[1] * tensor[1] + weights[2] * tensor[2]
    base = weights[0] * clean[0] + weights[1] * clean[1] + weights[2] * clean[2]
    dark = np.clip(base - luma, 0, None)
    size = luma.shape[0]
    ys, xs = np.mgrid[0:size, 0:size]
    x = xs + 0.5 - size / 2.0
    y = ys + 0.5 - size / 2.0
    radial = np.hypot(x, y)
    use = (radial > 22) & (radial < 38) & (dark > 0.015)
    if float(dark[use].sum()) < 0.05:
        return None
    return float(np.degrees(np.arctan2((y * dark)[use].sum(), (x * dark)[use].sum())) % 360.0)


def _plain(bank, profile, angle: float, mode: str):
    image = bank["backgrounds"]["dial_clean"].copy()
    params = dict(profile["needle"])
    sprite, tip_len, tail_len = needle_sprite(bank, profile, params)
    image, hub, tip, tail = place_needle(image, sprite, angle, (0.0, 0.0), tip_len, tail_len)
    h, w = image.shape[:2]
    pose = {"cx": w / 2.0, "cy": h / 2.0, "radius": 40.0, "rotationDeg": 0.0}
    from synth_render import tensor_from_canvas
    tensor = tensor_from_canvas(image, pose, profile, mode, True)
    label = output_angle(hub, tip, 0.0)
    tail_alpha = float(sprite[..., 3][:, : CANVAS // 2].sum())
    return label, tensor, tail_alpha, tail_len


def cmd_determinism(args) -> None:
    _threads()
    profile = load_gauge_profile(str(args.profile))
    bank = load_bank(args.out)
    shapes = expected_shapes(not args.no_extra_red)
    a = render_both(bank, profile, args.seed, 0, extra_red=not args.no_extra_red)
    b = render_both(bank, profile, args.seed, 0, extra_red=not args.no_extra_red)
    other = render_both(bank, profile, args.seed, 1, extra_red=not args.no_extra_red)
    same = a["cartesian"].tobytes() == b["cartesian"].tobytes() and a["polar"].tobytes() == b["polar"].tobytes()
    differ = a["cartesian"].tobytes() != other["cartesian"].tobytes()
    shape_ok = a["cartesian"].shape == shapes["cartesian"] and a["polar"].shape == shapes["polar"]
    tail_ok = True
    angle_errors = []
    clean_tensor = _clean_tensor(bank, profile)
    for angle in (15.0, 74.0, 160.0, 200.0, 310.0):
        label, tensor, tail_alpha, tail_len = _plain(bank, profile, angle, "cartesian")
        if tail_alpha < 5 or tail_len < 2:
            tail_ok = False
        bearing = _outer_tip(tensor, clean_tensor)
        delta = 180.0 if bearing is None else abs(((bearing - label + 540) % 360) - 180)
        angle_errors.append(delta)
    # Workers must agree with the parent on the same seed.
    import multiprocessing as mp
    ctx = mp.get_context("spawn")
    with ctx.Pool(2, initializer=_threads) as pool:
        remote = pool.starmap(_remote_bytes, [(str(args.out), str(args.profile), args.seed, 3, not args.no_extra_red)])
    local = render_both(bank, profile, args.seed, 3, extra_red=not args.no_extra_red)
    worker_ok = remote[0] == (local["cartesian"].tobytes(), local["polar"].tobytes())
    report = {
        "identicalBytes": same,
        "differentIndexDiffers": differ,
        "shapes": shape_ok,
        "cartesian": list(a["cartesian"].shape),
        "polar": list(a["polar"].shape),
        "tailRendered": tail_ok,
        "cleanAngleMaxDeg": round(max(angle_errors), 4) if angle_errors else None,
        "workerBytesMatch": worker_ok,
        "angleOnly": a["angle"] is None or isinstance(a["angle"], float),
        "pass": bool(same and differ and shape_ok and tail_ok and worker_ok and max(angle_errors) <= 3.0),
    }
    print(json.dumps(report, indent=2))
    (args.out / "determinism.json").write_text(json.dumps(report, indent=2))
    if not report["pass"]:
        raise SystemExit(1)


def _remote_bytes(out_dir: str, profile_path: str, seed: int, index: int, extra_red: bool):
    _threads()
    profile = load_gauge_profile(profile_path)
    bank = load_bank(Path(out_dir))
    sample = render_both(bank, profile, seed, index, extra_red=extra_red)
    return sample["cartesian"].tobytes(), sample["polar"].tobytes()


def _bench_chunk(out_dir: str, profile_path: str, seed: int, start: int, count: int, extra_red: bool) -> int:
    _threads()
    profile = load_gauge_profile(profile_path)
    bank = load_bank(Path(out_dir))
    acc = 0
    for index in range(start, start + count):
        sample = render_sample(bank, profile, seed, index, mode="cartesian", extra_red=extra_red)
        acc = (acc + int(sample["tensor"].reshape(-1)[::97].sum() * 1000)) & 0xFFFFFFFF
    return acc


def cmd_benchmark(args) -> None:
    _require_mem()
    _threads()
    profile = load_gauge_profile(str(args.profile))
    bank = load_bank(args.out)
    render_sample(bank, profile, 1, 0)
    cores = args.workers or os.cpu_count() or 1
    total = args.n
    chunk = (total + cores - 1) // cores
    jobs = []
    left = total
    start = 0
    while left > 0:
        take = min(chunk, left)
        jobs.append((str(args.out), str(args.profile), args.seed, start, take, not args.no_extra_red))
        start += take
        left -= take
    import multiprocessing as mp
    ctx = mp.get_context("spawn")
    t0 = time.perf_counter()
    with ctx.Pool(len(jobs), initializer=_threads) as pool:
        pool.starmap(_bench_chunk, jobs)
    elapsed = time.perf_counter() - t0
    rate = total / elapsed if elapsed else 0.0
    report = {
        "samples": total,
        "seconds": round(elapsed, 3),
        "samplesPerSec": round(rate, 1),
        "cores": len(jobs),
        "pass": rate >= 200.0,
    }
    print(json.dumps(report, indent=2))
    (args.out / "benchmark.json").write_text(json.dumps(report, indent=2))
    if not report["pass"]:
        raise SystemExit(1)


def _val_chunk(out_dir: str, profile_path: str, seed: int, start: int, count: int, extra_red: bool) -> list:
    _threads()
    profile = load_gauge_profile(profile_path)
    bank = load_bank(Path(out_dir))
    out = Path(out_dir)
    shapes = expected_shapes(extra_red)
    cart = np.memmap(out / "val" / "cartesian.u8", dtype=np.uint8, mode="r+", shape=(VAL_COUNT, *shapes["cartesian"]))
    polar = np.memmap(out / "val" / "polar.u8", dtype=np.uint8, mode="r+", shape=(VAL_COUNT, *shapes["polar"]))
    rows = []
    for index in range(start, start + count):
        sample = render_both(bank, profile, seed, index, extra_red=extra_red)
        cart[index] = _chw_u8(sample["cartesian"])
        polar[index] = _chw_u8(sample["polar"])
        rows.append(_label_row(sample))
    cart.flush()
    polar.flush()
    return rows


def cmd_val(args) -> None:
    _require_mem()
    _threads()
    if args.count != VAL_COUNT:
        raise SystemExit(f"validation set is fixed at {VAL_COUNT} frames")
    profile = load_gauge_profile(str(args.profile))
    bank = load_bank(args.out)
    render_both(bank, profile, VAL_SEED, 0)
    shapes = expected_shapes(not args.no_extra_red)
    val_dir = args.out / "val"
    val_dir.mkdir(parents=True, exist_ok=True)
    cart_path = val_dir / "cartesian.u8"
    polar_path = val_dir / "polar.u8"
    cart = np.memmap(cart_path, dtype=np.uint8, mode="w+", shape=(VAL_COUNT, *shapes["cartesian"]))
    polar = np.memmap(polar_path, dtype=np.uint8, mode="w+", shape=(VAL_COUNT, *shapes["polar"]))
    cart.flush()
    polar.flush()
    del cart, polar
    cores = args.workers or os.cpu_count() or 1
    chunk = (VAL_COUNT + cores - 1) // cores
    jobs = []
    left = VAL_COUNT
    start = 0
    while left > 0:
        take = min(chunk, left)
        jobs.append((str(args.out), str(args.profile), VAL_SEED, start, take, not args.no_extra_red))
        start += take
        left -= take
    import multiprocessing as mp
    ctx = mp.get_context("spawn")
    t0 = time.perf_counter()
    with ctx.Pool(len(jobs), initializer=_threads) as pool:
        parts = pool.starmap(_val_chunk, jobs)
    elapsed = time.perf_counter() - t0
    rows = [row for part in parts for row in part]
    rows.sort(key=lambda row: row["index"])
    if len(rows) != VAL_COUNT or rows[0]["index"] != 0 or rows[-1]["index"] != VAL_COUNT - 1:
        raise SystemExit("validation labels are incomplete")
    (val_dir / "labels.json").write_text(json.dumps(rows))
    manifest = {
        "seed": VAL_SEED,
        "count": VAL_COUNT,
        "extraRedChannel": not args.no_extra_red,
        "channels": ["R", "G", "B", "R"] if not args.no_extra_red else ["R", "G", "B"],
        "layout": "NCHW uint8, float = u8/255, red duplicated as the last channel when enabled",
        "cartesian": {"file": "cartesian.u8", "shape": [VAL_COUNT, *shapes["cartesian"]]},
        "polar": {"file": "polar.u8", "shape": [VAL_COUNT, *shapes["polar"]]},
        "labels": "labels.json",
        "angle": "tip direction in the crop, degrees clockwise from +x, y down; null when noNeedle",
        "seconds": round(elapsed, 2),
        "noNeedle": sum(1 for row in rows if row["noNeedle"]),
    }
    (val_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(json.dumps(manifest, indent=2))


def cmd_gate(args) -> None:
    det = json.loads((args.out / "determinism.json").read_text())
    bench = json.loads((args.out / "benchmark.json").read_text())
    meta = json.loads((args.out / "meta.json").read_text())
    manifest = json.loads((args.out / "val" / "manifest.json").read_text())
    contact_c = args.out / "contact-cartesian.png"
    contact_p = args.out / "contact-polar.png"
    template = meta.get("template") or {}
    rows = [
        ["contact cartesian", "PASS" if contact_c.is_file() and contact_c.stat().st_size > 1000 else "FAIL", str(contact_c)],
        ["contact polar", "PASS" if contact_p.is_file() and contact_p.stat().st_size > 1000 else "FAIL", str(contact_p)],
        ["deterministic", "PASS" if det.get("pass") else "FAIL", f"worker {det.get('workerBytesMatch')} clean angle {det.get('cleanAngleMaxDeg')}°"],
        ["throughput", "PASS" if bench.get("pass") else "FAIL", f"{bench.get('samplesPerSec')} /s on {bench.get('cores')} cores"],
        ["backgrounds", "PASS" if len(meta.get("clips") or []) >= 8 and (args.out / "dial_clean.png").is_file() else "FAIL", f"clean + {len(meta.get('clips') or [])} clips"],
        ["needle template", "PASS" if template.get("hasTip") and template.get("hasTail") and template.get("hasHub") else "FAIL", f"tip {template.get('tipLenPx')} tail {template.get('tailLenPx')} hub {template.get('hubRadiusPx')}"],
        ["val set", "PASS" if manifest.get("count") == VAL_COUNT else "FAIL", f"{manifest.get('count')} seed {manifest.get('seed')} no-needle {manifest.get('noNeedle')}"],
        ["angle-only labels", "PASS" if manifest.get("angle") else "FAIL", "tip angle, null when occluded"],
        ["red channel", "PASS" if manifest.get("extraRedChannel") else "FAIL", " ".join(manifest.get("channels") or [])],
        ["tail always", "PASS" if det.get("tailRendered") else "FAIL", "procedural tail under the template"],
    ]
    passed = all(row[1] == "PASS" for row in rows)
    lines = ["Phase 2 gate — synthetic generator", ""]
    for name, status, detail in rows:
        lines.append(f"  {status.ljust(4)}  {name.ljust(22)}  {detail}")
    lines.append("")
    lines.append("PHASE 2 PASS" if passed else "PHASE 2 FAIL")
    lines.append("")
    text = "\n".join(lines)
    (args.out / "gate.txt").write_text(text)
    (args.out / "gate.json").write_text(json.dumps({
        "pass": passed,
        "rows": [{"name": name, "status": status, "detail": detail} for name, status, detail in rows],
    }, indent=2))
    print(text)
    if not passed:
        raise SystemExit(1)


def main() -> None:
    parser = argparse.ArgumentParser(description="Phase 2 synthetic needle generator")
    parser.add_argument("--profile", type=Path, default=DEFAULT_PROFILE)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--seed", type=int, default=VAL_SEED)
    parser.add_argument("--workers", type=int, default=0)
    parser.add_argument("--no-extra-red", action="store_true")
    sub = parser.add_subparsers(dest="cmd", required=True)
    bg = sub.add_parser("backgrounds")
    bg.add_argument("--stride", type=int, default=1)
    bg.add_argument("--clips", nargs="*", default=None)
    bg.set_defaults(func=cmd_backgrounds)
    sub.add_parser("contact").set_defaults(func=cmd_contact)
    sub.add_parser("determinism").set_defaults(func=cmd_determinism)
    bench = sub.add_parser("benchmark")
    bench.add_argument("--n", type=int, default=1600)
    bench.set_defaults(func=cmd_benchmark)
    val = sub.add_parser("val")
    val.add_argument("--count", type=int, default=VAL_COUNT)
    val.set_defaults(func=cmd_val)
    sub.add_parser("gate").set_defaults(func=cmd_gate)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    args.func(args)


if __name__ == "__main__":
    main()
