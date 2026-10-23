#!/usr/bin/env python3
"""Stream synthetic crops and train the Cartesian and polar needle CNNs.

Checkpoints land in /workspace/pl-state/nr/train (outside the repo).
A killed run resumes from the last checkpoint. The fixed 5k val set is
the synthetic gate; tau is chosen there and nowhere else.

  python3 scripts/needle-reader/train_needle.py train --target 160000
  python3 scripts/needle-reader/train_needle.py eval
  python3 scripts/needle-reader/train_needle.py export
"""
from __future__ import annotations

import argparse
import json
import math
import os
import signal
import sys
import time
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))

from gauge_profile import load_gauge_profile  # noqa: E402
from needle_model import (  # noqa: E402
    batch_loss,
    build_model,
    decode,
    parameter_count,
)

REPO = Path(__file__).resolve().parents[2]
PROFILE = REPO / "profiles" / "flair58-v1.json"
SYNTH = Path("/workspace/pl-state/nr/synth")
TRAIN = Path("/workspace/pl-state/nr/train")
VAL_DIR = SYNTH / "val"
TRAIN_SEED = 64242
BAR_DEG = 161.757 / 10.0
WILD_DEG = BAR_DEG
FLIP_DEG = 155.0


def _mem_mb() -> float:
    for line in Path("/proc/meminfo").read_text().splitlines():
        if line.startswith("MemAvailable:"):
            return int(line.split()[1]) / 1024
    return 0.0


def _require_mem() -> None:
    free = _mem_mb()
    if free < 3072:
        raise SystemExit(f"need >= 3 GB MemAvailable, have {free:.0f} MB")


def _load_val():
    labels = json.loads((VAL_DIR / "labels.json").read_text())
    angles = np.zeros(len(labels), np.float32)
    no_needle = np.zeros(len(labels), np.bool_)
    for row in labels:
        i = int(row["index"])
        no_needle[i] = bool(row["noNeedle"]) or row["angle"] is None
        angles[i] = 0.0 if no_needle[i] else float(row["angle"])
    cart = np.memmap(VAL_DIR / "cartesian.u8", dtype=np.uint8, mode="r", shape=(len(labels), 4, 96, 96))
    polar = np.memmap(VAL_DIR / "polar.u8", dtype=np.uint8, mode="r", shape=(len(labels), 4, 48, 360))
    return {"angles": angles, "noNeedle": no_needle, "cartesian": cart, "polar": polar, "n": len(labels)}


def _worker(index_q, out_q):
    os.environ["OMP_NUM_THREADS"] = "1"
    os.environ["MKL_NUM_THREADS"] = "1"
    import cv2
    cv2.setNumThreads(1)
    try:
        cv2.ocl.setUseOpenCL(False)
    except Exception:
        pass
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from gauge_profile import load_gauge_profile as load_profile
    from synth_bank import load_bank
    from synth_render import render_both

    profile = load_profile(str(PROFILE))
    bank = load_bank(SYNTH)
    while True:
        index = index_q.get()
        if index is None:
            return
        sample = render_both(bank, profile, TRAIN_SEED, int(index))
        angle = sample["angle"]
        no_needle = bool(sample["noNeedle"]) or angle is None
        cart = np.clip(np.round(sample["cartesian"] * 255.0), 0, 255).astype(np.uint8)
        polar = np.clip(np.round(sample["polar"] * 255.0), 0, 255).astype(np.uint8)
        out_q.put((cart, polar, -1.0 if no_needle else float(angle), no_needle))


def _lr(step: int, total: int, base: float = 1.5e-3) -> float:
    warm = min(200, max(1, total // 20))
    if step < warm:
        return base * (step + 1) / warm
    span = max(1, total - warm)
    t = (step - warm) / span
    return 1e-5 + 0.5 * (base - 1e-5) * (1 + math.cos(math.pi * min(1.0, t)))


def _batch_from(queue, batch: int, timeout: float):
    carts, polars, angles, flags = [], [], [], []
    for _ in range(batch):
        cart, polar, angle, no_needle = queue.get(timeout=timeout)
        carts.append(cart)
        polars.append(polar)
        angles.append(angle)
        flags.append(no_needle)
    def tensor(rows):
        return torch.from_numpy(np.stack(rows)).float().div_(255.0)
    ang = torch.tensor(angles, dtype=torch.float32)
    none = torch.tensor(flags, dtype=torch.bool)
    return tensor(carts), tensor(polars), ang, none


@torch.no_grad()
def _predict(model, images, device, batch=64):
    model.eval()
    angles, confs = [], []
    for start in range(0, len(images), batch):
        chunk = images[start:start + batch]
        if isinstance(chunk, np.memmap):
            chunk = np.array(chunk)
        x = torch.from_numpy(np.ascontiguousarray(chunk)).float().div_(255.0).to(device)
        pred, conf = decode(*model(x))
        angles.append(pred.cpu())
        confs.append(conf.cpu())
    return torch.cat(angles).numpy(), torch.cat(confs).numpy()


def synth_metrics(pred, conf, truth, no_needle, tau: float | None):
    present = ~no_needle
    err = np.abs(pred - truth) % 360
    err = np.minimum(err, 360 - err)
    use = present if tau is None else present & (conf >= tau)
    taken = err[use]
    if taken.size == 0:
        summary = {"n": 0, "median": None, "p90": None, "wildPct": None, "flipPct": None, "flipN": 0}
    else:
        order = np.sort(taken)
        def q(p):
            pos = (len(order) - 1) * p
            lo = int(math.floor(pos))
            hi = int(math.ceil(pos))
            return float(order[lo] if lo == hi else order[lo] * (hi - pos) + order[hi] * (pos - lo))
        wild = int((taken > WILD_DEG).sum())
        flips = int((taken >= FLIP_DEG).sum())
        summary = {
            "n": int(taken.size),
            "median": q(0.5),
            "p90": q(0.9),
            "wildPct": 100.0 * wild / taken.size,
            "wildN": wild,
            "flipPct": 100.0 * flips / taken.size,
            "flipN": flips,
        }
    if tau is None:
        summary["coveragePct"] = 100.0
    else:
        summary["coveragePct"] = 100.0 * float(use.sum()) / max(1, int(present.sum()))
        empty = no_needle & (conf >= tau)
        summary["noNeedleAcceptPct"] = 100.0 * float(empty.sum()) / max(1, int(no_needle.sum()))
    return summary


def choose_tau(pred, conf, truth, no_needle) -> dict:
    """Lowest tau on the synthetic val set that keeps wild ≤ 0.2% and flips at 0.

    Also rejects a threshold that still shows more than 1% of the empty frames.
    """
    best = None
    for step in range(5, 96):
        tau = step / 100.0
        row = synth_metrics(pred, conf, truth, no_needle, tau)
        if row["n"] < 50:
            continue
        if row["wildPct"] > 0.2 or row["flipN"] != 0:
            continue
        if row.get("noNeedleAcceptPct", 100) > 1.0:
            continue
        if best is None or row["coveragePct"] > best["coveragePct"]:
            best = {"tau": tau, **row}
    if best is not None:
        best["rule"] = "lowest tau is not required; highest needle coverage among valid taus"
        return best
    # Fall back to the tau with the lowest wild rate, then the highest coverage.
    fallback = None
    for step in range(5, 96):
        tau = step / 100.0
        row = synth_metrics(pred, conf, truth, no_needle, tau)
        key = (row["wildPct"] if row["wildPct"] is not None else 999, -(row["coveragePct"] or 0))
        if fallback is None or key < fallback[0]:
            fallback = (key, {"tau": tau, "rule": "fallback, no tau met wild/flip/empty", **row})
    return fallback[1]


def evaluate_checkpoint(ckpt_path: Path, out_path: Path) -> dict:
    _require_mem()
    device = torch.device("cpu")
    ckpt = torch.load(ckpt_path, map_location=device, weights_only=False)
    val = _load_val()
    profile = load_gauge_profile(str(PROFILE))
    report = {
        "checkpoint": str(ckpt_path),
        "samples": ckpt.get("samples"),
        "barDeg": BAR_DEG,
        "wildDeg": WILD_DEG,
        "flipDeg": FLIP_DEG,
        "profileId": profile["id"],
        "arms": {},
    }
    for mode, images in (("cartesian", val["cartesian"]), ("polar", val["polar"])):
        model = build_model(mode).to(device)
        model.load_state_dict(ckpt[mode])
        pred, conf = _predict(model, images, device)
        ungated = synth_metrics(pred, conf, val["angles"], val["noNeedle"], None)
        picked = choose_tau(pred, conf, val["angles"], val["noNeedle"])
        report["arms"][mode] = {
            "parameters": parameter_count(model),
            "ungated": ungated,
            "tau": picked,
            "gate": {
                "median": ungated["median"] is not None and ungated["median"] <= 1.5,
                "wild": ungated["wildPct"] is not None and ungated["wildPct"] <= 0.2,
                "flip": ungated["flipN"] == 0,
            },
        }
        print(json.dumps({"mode": mode, "ungated": ungated, "tau": picked["tau"], "tauCoverage": picked["coveragePct"]}, indent=2))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2))
    return report


def export_models(ckpt_path: Path, dest: Path) -> dict:
    import onnx
    dest.mkdir(parents=True, exist_ok=True)
    ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    sizes = {}
    for mode, shape in (("cartesian", (1, 4, 96, 96)), ("polar", (1, 4, 48, 360))):
        model = build_model(mode).eval()
        model.load_state_dict(ckpt[mode])
        fp32 = dest / f"needle-{mode}.onnx"
        torch.onnx.export(
            model,
            torch.zeros(*shape),
            str(fp32),
            input_names=["crop"],
            output_names=["logits", "aux"],
            opset_version=17,
            dynamo=False,
        )
        int8 = dest / f"needle-{mode}.int8.onnx"
        try:
            from onnxruntime.quantization import QuantType, quantize_dynamic
            quantize_dynamic(str(fp32), str(int8), weight_type=QuantType.QInt8)
        except Exception as exc:
            int8.write_bytes(b"")
            sizes[mode] = {"fp32": fp32.stat().st_size, "int8": None, "error": str(exc)}
            continue
        sizes[mode] = {
            "fp32": fp32.stat().st_size,
            "int8": int8.stat().st_size,
            "parameters": parameter_count(model),
            "onnxCheck": onnx.checker.check_model(str(fp32)) is None,
        }
        print(json.dumps({"mode": mode, **sizes[mode]}))
    (dest / "export.json").write_text(json.dumps(sizes, indent=2))
    return sizes


def train(args) -> None:
    _require_mem()
    os.environ["OMP_NUM_THREADS"] = str(args.threads)
    os.environ["MKL_NUM_THREADS"] = str(args.threads)
    torch.set_num_threads(args.threads)
    TRAIN.mkdir(parents=True, exist_ok=True)
    device = torch.device("cpu")
    cart = build_model("cartesian").to(device)
    polar = build_model("polar").to(device)
    print(f"params cartesian={parameter_count(cart)} polar={parameter_count(polar)}", flush=True)
    if parameter_count(cart) > 150_000 or parameter_count(polar) > 150_000:
        raise SystemExit("model exceeds 150k parameters")
    models = {"cartesian": cart, "polar": polar}
    active = ("cartesian", "polar") if args.arm == "both" else (args.arm,)
    ckpt_path = TRAIN / "checkpoint.pt"
    best_path = TRAIN / "best.pt"
    seen = {"cartesian": 0, "polar": 0}
    best_score = 1e9
    if ckpt_path.exists() and not args.fresh:
        saved = torch.load(ckpt_path, map_location=device, weights_only=False)
        if isinstance(saved.get("samples"), dict):
            seen = {"cartesian": int(saved["samples"].get("cartesian", 0)), "polar": int(saved["samples"].get("polar", 0))}
        else:
            both = int(saved.get("samples") or 0)
            seen = {"cartesian": both, "polar": both}
        for mode, model in models.items():
            try:
                model.load_state_dict(saved[mode])
            except RuntimeError as exc:
                print(f"reinit {mode} ({exc.__class__.__name__})", flush=True)
                seen[mode] = 0
        best_score = float(saved.get("bestScore", best_score))
        print(f"resume seen={seen}", flush=True)
    if all(seen[mode] >= args.target for mode in active):
        print(f"already at {seen} >= {args.target}", flush=True)
        return
    opt = torch.optim.AdamW([p for mode in active for p in models[mode].parameters()], lr=1.5e-3, weight_decay=1e-4)

    import multiprocessing as mp
    ctx = mp.get_context("spawn")
    index_q = ctx.Queue(maxsize=512)
    out_q = ctx.Queue(maxsize=max(8, args.batch * 2))
    workers = []
    for _ in range(args.workers):
        proc = ctx.Process(target=_worker, args=(index_q, out_q), daemon=True)
        proc.start()
        workers.append(proc)

    remaining = max(args.target - seen[mode] for mode in active)
    steps = math.ceil(remaining / args.batch)
    next_index = max(seen[mode] for mode in active)
    stop = {"flag": False}

    def save(score=None):
        payload = {
            "samples": dict(seen),
            "cartesian": cart.state_dict(),
            "polar": polar.state_dict(),
            "opt": opt.state_dict(),
            "bestScore": best_score if score is None else score,
            "target": args.target,
            "seed": TRAIN_SEED,
            "sigma": 1.5,
            "arm": args.arm,
        }
        tmp = ckpt_path.with_suffix(".tmp")
        torch.save(payload, tmp)
        tmp.replace(ckpt_path)

    def handle(sig, frame):
        stop["flag"] = True
        print(f"signal {sig}, stopping after this step", flush=True)

    signal.signal(signal.SIGTERM, handle)
    signal.signal(signal.SIGINT, handle)

    def feed_more(n):
        nonlocal next_index
        for _ in range(n):
            index_q.put(next_index)
            next_index += 1

    # Stay under the index-queue cap. Extra indices are filled after each consume
    # so a full output queue cannot stall the feeder.
    feed_more(args.batch * max(1, args.workers))
    val = _load_val()
    rng = np.random.default_rng(0)
    subset = rng.choice(val["n"], size=min(800, val["n"]), replace=False)
    t0 = time.perf_counter()
    window = t0
    cart.train()
    polar.train()
    try:
        for step in range(steps):
            if stop["flag"]:
                break
            if any(not proc.is_alive() for proc in workers):
                raise RuntimeError("a render worker exited")
            batch_cart, batch_polar, angles, no_needle = _batch_from(out_q, args.batch, timeout=300)
            feed_more(args.batch)
            progress = min(seen[mode] for mode in active)
            lr = _lr(progress // args.batch, math.ceil(args.target / args.batch))
            for group in opt.param_groups:
                group["lr"] = lr
            opt.zero_grad(set_to_none=True)
            losses = {}
            if "cartesian" in active:
                losses["c"] = batch_loss(*cart(batch_cart), angles, no_needle)
            if "polar" in active:
                losses["p"] = batch_loss(*polar(batch_polar), angles, no_needle)
            sum(losses.values()).backward()
            torch.nn.utils.clip_grad_norm_([p for mode in active for p in models[mode].parameters()], 1.0)
            opt.step()
            for mode in active:
                seen[mode] += args.batch
            if step % 25 == 0:
                now = time.perf_counter()
                rate = (25 * args.batch) / max(1e-6, now - window) if step else args.batch / max(1e-6, now - t0)
                window = now
                print(
                    f"step={step} seen={seen} loss_c={float(losses['c'].detach()) if 'c' in losses else float('nan'):.4f} "
                    f"loss_p={float(losses['p'].detach()) if 'p' in losses else float('nan'):.4f} lr={lr:.6f} rate={rate:.1f}/s",
                    flush=True,
                )
            if step > 0 and step % 100 == 0:
                save()
            if step > 0 and step % args.val_every == 0:
                score = _val_score(cart, polar, val, subset, device, active)
                print(
                    f"val subset median cart={score['cartesian']:.3f} polar={score['polar']:.3f}",
                    flush=True,
                )
                vals = [score[mode] for mode in active]
                mean_score = sum(vals) / len(vals)
                if mean_score < best_score:
                    best_score = mean_score
                    torch.save({
                        "samples": dict(seen),
                        "cartesian": cart.state_dict(),
                        "polar": polar.state_dict(),
                        "bestScore": best_score,
                        "seed": TRAIN_SEED,
                    }, best_path)
                cart.train()
                polar.train()
                save(best_score)
    finally:
        save()
        for _ in workers:
            try:
                index_q.put_nowait(None)
            except Exception:
                pass
        for proc in workers:
            proc.join(timeout=2)
            if proc.is_alive():
                proc.terminate()
    elapsed = time.perf_counter() - t0
    (TRAIN / "train-time.json").write_text(json.dumps({
        "samplesEnd": seen,
        "seconds": elapsed,
        "target": args.target,
        "arm": args.arm,
    }, indent=2))
    print(f"train done seen={seen} seconds={elapsed:.1f}", flush=True)


@torch.no_grad()
def _val_score(cart, polar, val, subset, device, active=("cartesian", "polar")):
    scores = {"cartesian": 999.0, "polar": 999.0}
    for mode, model, images in (
        ("cartesian", cart, val["cartesian"]),
        ("polar", polar, val["polar"]),
    ):
        if mode not in active:
            continue
        model.eval()
        pred, _conf = _predict(model, images[subset], device)
        err = np.abs(pred - val["angles"][subset]) % 360
        err = np.minimum(err, 360 - err)
        present = ~val["noNeedle"][subset]
        scores[mode] = float(np.median(err[present])) if present.any() else 999.0
    return scores


def finetune_arm(mode: str, base_ckpt: Path, pool_x: np.ndarray, pool_angle: np.ndarray, pool_none: np.ndarray,
                 pseudo_x: np.ndarray, pseudo_angle: np.ndarray, pseudo_weight: np.ndarray,
                 steps: int, batch: int, lr: float, dest: Path, threads: int = 6) -> dict:
    """Short fine-tune of one arm. Pseudo rows are already the LOCO subset."""
    os.environ["OMP_NUM_THREADS"] = str(threads)
    os.environ["MKL_NUM_THREADS"] = str(threads)
    torch.set_num_threads(threads)
    device = torch.device("cpu")
    model = build_model(mode).to(device)
    saved = torch.load(base_ckpt, map_location=device, weights_only=False)
    model.load_state_dict(saved[mode])
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-5)
    rng = np.random.default_rng((steps * 10007 + int(pseudo_angle.shape[0]) + (1 if mode == "polar" else 0)) % (2**32))
    weights = pseudo_weight.astype(np.float64)
    weights = weights / max(weights.sum(), 1e-8)
    model.train()
    t0 = time.perf_counter()
    last = None
    for step in range(steps):
        use_pseudo = pseudo_x.shape[0] > 0 and rng.random() < 0.5
        if use_pseudo:
            pick = rng.choice(pseudo_x.shape[0], size=batch, replace=True, p=weights)
            raw = pseudo_x[pick]
            angles = torch.from_numpy(pseudo_angle[pick].astype(np.float32))
            no_needle = torch.zeros(batch, dtype=torch.bool)
        else:
            pick = rng.integers(0, pool_x.shape[0], size=batch)
            raw = pool_x[pick]
            angles = torch.from_numpy(pool_angle[pick].astype(np.float32))
            no_needle = torch.from_numpy(pool_none[pick].astype(bool))
        x = torch.from_numpy(np.ascontiguousarray(raw)).float().div_(255.0)
        opt.zero_grad(set_to_none=True)
        loss = batch_loss(*model(x), angles, no_needle)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        # Cosine from lr down to lr/10 across the short round.
        group_lr = lr * (0.1 + 0.9 * 0.5 * (1 + math.cos(math.pi * step / max(1, steps))))
        for group in opt.param_groups:
            group["lr"] = group_lr
        opt.step()
        last = float(loss.item())
        if step % 25 == 0:
            print(f"finetune {mode} step={step} loss={last:.4f}", flush=True)
    dest.parent.mkdir(parents=True, exist_ok=True)
    torch.save({"mode": mode, "samples": steps * batch, "state": model.state_dict(), "base": str(base_ckpt)}, dest)
    return {"seconds": time.perf_counter() - t0, "steps": steps, "lastLoss": last, "pseudo": int(pseudo_x.shape[0])}


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    tr = sub.add_parser("train")
    tr.add_argument("--target", type=int, default=120000)
    tr.add_argument("--batch", type=int, default=64)
    tr.add_argument("--workers", type=int, default=2)
    tr.add_argument("--threads", type=int, default=6)
    tr.add_argument("--val-every", type=int, default=200)
    tr.add_argument("--fresh", action="store_true")
    tr.add_argument("--arm", choices=("both", "cartesian", "polar"), default="both")
    ev = sub.add_parser("eval")
    ev.add_argument("--ckpt", type=Path, default=TRAIN / "checkpoint.pt")
    ev.add_argument("--out", type=Path, default=TRAIN / "synth-eval.json")
    ex = sub.add_parser("export")
    ex.add_argument("--ckpt", type=Path, default=TRAIN / "checkpoint.pt")
    ex.add_argument("--dest", type=Path, default=REPO / "scripts" / "needle-reader" / "export")
    args = parser.parse_args()
    if args.cmd == "train":
        train(args)
    elif args.cmd == "eval":
        evaluate_checkpoint(args.ckpt, args.out)
    else:
        export_models(args.ckpt, args.dest)


if __name__ == "__main__":
    main()
