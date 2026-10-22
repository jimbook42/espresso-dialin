"""Train the Flair needle reader and export ONNX opset 17.

Permissive stack only: PyTorch (BSD-3), ONNX (Apache-2.0), NumPy (BSD), Pillow (MIT-like).

  scripts/pressure-model/.venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu onnx pillow
  node scripts/pressure-model/synthesize-crops.mjs
  scripts/pressure-model/.venv/bin/python scripts/pressure-model/train_needle.py

Crops are gitignored. The exported file is public/flair-pressure-lab/needle.onnx.
"""
import json
import math
import os
import sys

import numpy as np
import torch
import torch.nn as nn
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(ROOT, 'scripts', 'pressure-model', 'data')
OUT = os.path.join(ROOT, 'public', 'flair-pressure-lab', 'needle.onnx')
SWEEP_DEG = 179.52
SIZE = 64
EPOCHS = 14
BATCH = 64
LR = 1e-3


class NeedleNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(3, 12, 5, stride=2, padding=2),
            nn.ReLU(inplace=True),
            nn.Conv2d(12, 24, 3, stride=2, padding=1),
            nn.ReLU(inplace=True),
            nn.Conv2d(24, 48, 3, stride=2, padding=1),
            nn.ReLU(inplace=True),
            nn.Conv2d(48, 96, 3, stride=2, padding=1),
            nn.ReLU(inplace=True),
            nn.Conv2d(96, 96, 3, stride=1, padding=1),
            nn.ReLU(inplace=True),
            nn.AdaptiveAvgPool2d(1),
        )
        self.head = nn.Linear(96, 3)

    def forward(self, x):
        return self.head(self.features(x).flatten(1))


def load_split(name):
    labels = json.load(open(os.path.join(DATA, f'{name}-labels.json'), encoding='utf-8'))
    raw = np.fromfile(os.path.join(DATA, f'{name}-images.bin'), dtype=np.uint8)
    images = raw.reshape(labels['count'], labels['size'], labels['size'], 3)
    return images, labels


def with_rest(images, labels):
    rest_path = os.path.join(DATA, 'rest-labels.json')
    if not os.path.exists(rest_path):
        return images, labels
    rest_images, rest_labels = load_split('rest')
    count = int(rest_labels['count'])
    if count < 1:
        return images, labels
    reps = max(1, min(12, 480 // count))
    images = np.concatenate([images, np.tile(rest_images, (reps, 1, 1, 1))], axis=0)
    for key in ('angleDeg', 'confidence', 'easy'):
        labels[key] = list(labels[key]) + list(rest_labels[key]) * reps
    labels['count'] = int(images.shape[0])
    labels['restCopies'] = count * reps
    return images, labels


def jpeg_roundtrip(rgb, quality, rng):
    im = Image.fromarray(rgb, mode='RGB')
    import io
    buf = io.BytesIO()
    im.save(buf, format='JPEG', quality=int(quality))
    buf.seek(0)
    out = np.asarray(Image.open(buf).convert('RGB'), dtype=np.uint8)
    if out.shape != rgb.shape:
        return rgb
    return out


def box_blur(img, radius):
    if radius < 1:
        return img
    k = 2 * radius + 1
    pad = np.pad(img, ((radius, radius), (radius, radius), (0, 0)), mode='edge')
    integ = np.pad(pad, ((1, 0), (1, 0), (0, 0)), mode='constant')
    integ = np.cumsum(np.cumsum(integ, axis=0), axis=1)
    height, width = img.shape[:2]
    total = (
        integ[k:k + height, k:k + width]
        - integ[:height, k:k + width]
        - integ[k:k + height, :width]
        + integ[:height, :width]
    )
    return total / (k * k)


def augment(rgb, rng):
    img = rgb.astype(np.float32)
    img *= rng.uniform(0.62, 1.4)
    mean = img.mean(axis=(0, 1), keepdims=True)
    img = (img - mean) * rng.uniform(0.75, 1.3) + mean
    img *= rng.uniform(0.85, 1.15, size=(1, 1, 3)).astype(np.float32)
    img += rng.normal(0, rng.uniform(1.5, 10), size=img.shape).astype(np.float32)
    if rng.random() < 0.45:
        img = box_blur(img, 1)
    img = np.clip(img, 0, 255).astype(np.uint8)
    if rng.random() < 0.55:
        img = jpeg_roundtrip(img, int(rng.integers(38, 93)), rng)
    if rng.random() < 0.35:
        yy, xx = np.mgrid[0:SIZE, 0:SIZE]
        cx, cy = rng.uniform(8, SIZE - 8), rng.uniform(8, SIZE - 8)
        rad = rng.uniform(6, 18)
        blob = np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * rad * rad))
        img = np.clip(img.astype(np.float32) + blob[..., None] * rng.uniform(40, 120), 0, 255).astype(np.uint8)
    return img


class Crops(torch.utils.data.Dataset):
    def __init__(self, images, labels, augment_on, seed):
        self.images = images
        self.angle = np.asarray(labels['angleDeg'], dtype=np.float32)
        self.conf = np.asarray(labels['confidence'], dtype=np.float32)
        self.easy = np.asarray(labels['easy'], dtype=np.float32)
        self.augment_on = augment_on
        self.rng = np.random.default_rng(seed)

    def __len__(self):
        return len(self.angle)

    def __getitem__(self, index):
        rgb = self.images[index]
        if self.augment_on:
            rgb = augment(rgb, self.rng)
        x = torch.from_numpy(np.transpose(rgb.astype(np.float32) / 255.0, (2, 0, 1)))
        rad = math.radians(float(self.angle[index]))
        target = torch.tensor(
            [math.sin(rad), math.cos(rad), float(self.conf[index])],
            dtype=torch.float32,
        )
        return x, target, torch.tensor(float(self.angle[index])), torch.tensor(float(self.easy[index]))


def circular_mae(pred_deg, truth_deg, mask):
    if mask.sum() < 1:
        return None, None
    diff = (pred_deg[mask] - truth_deg[mask] + 180) % 360 - 180
    deg = float(np.abs(diff).mean())
    bar = deg / SWEEP_DEG * 10
    return deg, bar


@torch.no_grad()
def evaluate(model, loader):
    model.eval()
    pred_all = []
    truth_all = []
    conf_t = []
    conf_p = []
    easy = []
    for x, target, angle, easy_flag in loader:
        out = model(x)
        ang = torch.atan2(out[:, 0], out[:, 1]) * (180 / math.pi)
        ang = torch.where(ang < 0, ang + 360, ang)
        pred_all.append(ang.numpy())
        truth_all.append(angle.numpy())
        conf_t.append(target[:, 2].numpy())
        conf_p.append(torch.sigmoid(out[:, 2]).numpy())
        easy.append(easy_flag.numpy())
    pred = np.concatenate(pred_all)
    truth = np.concatenate(truth_all)
    ct = np.concatenate(conf_t)
    cp = np.concatenate(conf_p)
    ez = np.concatenate(easy)
    visible = ct >= 0.5
    deg, bar = circular_mae(pred, truth, visible)
    easy_deg, easy_bar = circular_mae(pred, truth, (ez > 0.5) & visible)
    neg = ct < 0.2
    pos = ct > 0.8
    return {
        'angleMaeDeg': None if deg is None else round(deg, 3),
        'barMae': None if bar is None else round(bar, 4),
        'easyAngleMaeDeg': None if easy_deg is None else round(easy_deg, 3),
        'easyBarMae': None if easy_bar is None else round(easy_bar, 4),
        'visibleCount': int(visible.sum()),
        'easyCount': int(((ez > 0.5) & visible).sum()),
        'negConfidenceMean': None if neg.sum() == 0 else round(float(cp[neg].mean()), 3),
        'posConfidenceMean': None if pos.sum() == 0 else round(float(cp[pos].mean()), 3),
    }


def main():
    if not os.path.exists(os.path.join(DATA, 'train-images.bin')):
        sys.exit('missing crops; run node scripts/pressure-model/synthesize-crops.mjs')
    torch.manual_seed(0)
    np.random.seed(0)
    train_images, train_labels = with_rest(*load_split('train'))
    val_images, val_labels = load_split('val')
    print(f'train {train_labels["count"]} restCopies {train_labels.get("restCopies", 0)}')
    train_loader = torch.utils.data.DataLoader(
        Crops(train_images, train_labels, True, 1),
        batch_size=BATCH,
        shuffle=True,
        num_workers=0,
    )
    val_aug = torch.utils.data.DataLoader(
        Crops(val_images, val_labels, True, 2),
        batch_size=BATCH,
        shuffle=False,
    )
    val_clean = torch.utils.data.DataLoader(
        Crops(val_images, val_labels, False, 3),
        batch_size=BATCH,
        shuffle=False,
    )
    model = NeedleNet()
    params = sum(p.numel() for p in model.parameters())
    print(f'params {params}')
    opt = torch.optim.Adam(model.parameters(), lr=LR, weight_decay=1e-4)
    best_bar = 1e9
    best_state = None
    for epoch in range(EPOCHS):
        model.train()
        total = 0
        seen = 0
        for x, target, _angle, _easy in train_loader:
            out = model(x)
            weight = target[:, 2]
            ang = ((out[:, :2] - target[:, :2]) ** 2).sum(dim=1) * weight
            unit = (out[:, :2].norm(dim=1) - 1).abs() * weight
            bce = nn.functional.binary_cross_entropy_with_logits(out[:, 2], target[:, 2])
            loss = ang.mean() + 0.15 * unit.mean() + 0.45 * bce
            opt.zero_grad()
            loss.backward()
            opt.step()
            total += float(loss) * len(x)
            seen += len(x)
        aug_metrics = evaluate(model, val_aug)
        clean_metrics = evaluate(model, val_clean)
        score = clean_metrics['barMae'] if clean_metrics['barMae'] is not None else 1e9
        print(
            f'epoch {epoch + 1} loss {total / seen:.4f} '
            f'aug {aug_metrics["angleMaeDeg"]}°/{aug_metrics["barMae"]} bar '
            f'plain {clean_metrics["angleMaeDeg"]}°/{clean_metrics["barMae"]} bar '
            f'easy {clean_metrics["easyAngleMaeDeg"]}°/{clean_metrics["easyBarMae"]} bar '
            f'conf +{clean_metrics["posConfidenceMean"]}/-{clean_metrics["negConfidenceMean"]}'
        )
        if score < best_bar:
            best_bar = score
            best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}
    model.load_state_dict(best_state)
    plain = evaluate(model, val_clean)
    aug = evaluate(model, val_aug)
    rest_metrics = None
    if os.path.exists(os.path.join(DATA, 'rest-labels.json')):
        rest_images, rest_labels = load_split('rest')
        if rest_labels['count'] > 0:
            rest_loader = torch.utils.data.DataLoader(
                Crops(rest_images, rest_labels, False, 4),
                batch_size=BATCH,
                shuffle=False,
            )
            rest_metrics = evaluate(model, rest_loader)
            print(
                f'rest {rest_metrics["angleMaeDeg"]}°/{rest_metrics["barMae"]} bar '
                f'n {rest_metrics["visibleCount"]} conf {rest_metrics["posConfidenceMean"]}'
            )
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    model.eval()
    dummy = torch.zeros(1, 3, SIZE, SIZE)
    try:
        torch.onnx.export(
            model,
            dummy,
            OUT,
            input_names=['face'],
            output_names=['needle'],
            opset_version=17,
            dynamo=False,
        )
    except TypeError:
        torch.onnx.export(
            model,
            dummy,
            OUT,
            input_names=['face'],
            output_names=['needle'],
            opset_version=17,
        )
    metrics = {
        'params': params,
        'epochs': EPOCHS,
        'bytes': os.path.getsize(OUT),
        'valPlain': plain,
        'valAugmented': aug,
        'rest': rest_metrics,
        'sweepDeg': SWEEP_DEG,
    }
    with open(os.path.join(DATA, 'metrics.json'), 'w', encoding='utf-8') as handle:
        json.dump(metrics, handle, indent=2)
    print(json.dumps(metrics, indent=2))


if __name__ == '__main__':
    main()
