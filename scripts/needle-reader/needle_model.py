"""Angle-only needle CNN. No bar values, anchors, or gauge logic.

Cartesian: 4x96x96. Polar: 4x48x360 with circular padding on the angle axis.
Both heads emit 360 tip-direction logits and an auxiliary (cos 2θ, sin 2θ).
"""
from __future__ import annotations

import math

import torch
import torch.nn as nn
import torch.nn.functional as F

BINS = 360
SIGMA_DEG = 1.5
SOFT_RADIUS = 3
CONF_RADIUS = 5


class DSBlock(nn.Module):
    def __init__(self, cin: int, cout: int, stride: int = 1):
        super().__init__()
        self.dw = nn.Conv2d(cin, cin, 3, stride=stride, padding=1, groups=cin, bias=False)
        self.bn1 = nn.BatchNorm2d(cin)
        self.pw = nn.Conv2d(cin, cout, 1, bias=False)
        self.bn2 = nn.BatchNorm2d(cout)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = F.relu(self.bn1(self.dw(x)))
        x = F.relu(self.bn2(self.pw(x)))
        return x


class CartesianNet(nn.Module):
    """Translation-tolerant crop encoder. A shifted needle keeps its direction."""

    def __init__(self):
        super().__init__()
        self.mode = "cartesian"
        self.stem = nn.Sequential(
            nn.Conv2d(4, 16, 3, padding=1, bias=False),
            nn.BatchNorm2d(16),
            nn.ReLU(),
        )
        self.b1 = DSBlock(16, 24, 2)
        self.b2 = DSBlock(24, 32, 2)
        self.b3 = DSBlock(32, 48, 2)
        self.b4 = DSBlock(48, 64, 2)
        self.b5 = DSBlock(64, 128, 1)
        self.att = nn.Conv2d(128, 1, 1)
        self.head = nn.Linear(128, BINS)
        self.aux = nn.Linear(128, 2)

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        x = self.b5(self.b4(self.b3(self.b2(self.b1(self.stem(x))))))
        weight = torch.softmax(self.att(x).flatten(2), dim=-1)
        feat = (x.flatten(2) * weight).sum(-1)
        return self.head(feat), self.aux(feat)


def _circular_pad_w(x: torch.Tensor, pad: int) -> torch.Tensor:
    if pad <= 0:
        return x
    return torch.cat([x[..., -pad:], x, x[..., :pad]], dim=-1)


def _replicate_pad_h(x: torch.Tensor, pad: int) -> torch.Tensor:
    if pad <= 0:
        return x
    top = x[:, :, :1, :].expand(-1, -1, pad, -1)
    bot = x[:, :, -1:, :].expand(-1, -1, pad, -1)
    return torch.cat([top, x, bot], dim=2)


class CircBlock(nn.Module):
    """Depthwise block. Angle axis is circular; radius axis is replicated."""

    def __init__(self, cin: int, cout: int, stride_h: int = 1, kernel: tuple[int, int] = (3, 5)):
        super().__init__()
        self.kernel = kernel
        self.dw = nn.Conv2d(cin, cin, kernel, stride=(stride_h, 1), padding=0, groups=cin, bias=False)
        self.bn1 = nn.BatchNorm2d(cin)
        self.pw = nn.Conv2d(cin, cout, 1, bias=False)
        self.bn2 = nn.BatchNorm2d(cout)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        kh, kw = self.kernel
        x = _replicate_pad_h(_circular_pad_w(x, kw // 2), kh // 2)
        x = F.relu(self.bn1(self.dw(x)))
        x = F.relu(self.bn2(self.pw(x)))
        return x


class PolarNet(nn.Module):
    """Angle axis stays 360 bins so a shift of the unwrap is a shift of the logits."""

    def __init__(self):
        super().__init__()
        self.mode = "polar"
        self.stem = nn.Conv2d(4, 24, 1, bias=False)
        self.bn0 = nn.BatchNorm2d(24)
        self.b1 = CircBlock(24, 32, 2)
        self.b2 = CircBlock(32, 48, 2)
        self.b3 = CircBlock(48, 64, 2)
        self.b4 = CircBlock(64, 96, 2)
        self.b5 = CircBlock(96, 96, 1, kernel=(3, 7))
        self.collapse = nn.Conv2d(96, 48, kernel_size=(3, 1), bias=False)
        self.bn_c = nn.BatchNorm2d(48)
        self.logit = nn.Conv2d(48, 1, kernel_size=(1, 5), bias=False)
        self.aux = nn.Linear(96, 2)

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        x = F.relu(self.bn0(self.stem(x)))
        x = self.b5(self.b4(self.b3(self.b2(self.b1(x)))))
        pooled = x.mean(dim=(2, 3))
        flat = F.relu(self.bn_c(self.collapse(x)))
        logits = self.logit(_circular_pad_w(flat, 2)).squeeze(1).squeeze(1)
        return logits, self.aux(pooled)


def build_model(mode: str) -> nn.Module:
    if mode == "cartesian":
        return CartesianNet()
    if mode == "polar":
        return PolarNet()
    raise ValueError(f"mode must be cartesian or polar, got {mode}")


def parameter_count(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters())


def gaussian_targets(angles: torch.Tensor, no_needle: torch.Tensor, sigma: float = SIGMA_DEG) -> torch.Tensor:
    """Circular Gaussian over 360 bins. No-needle rows are uniform."""
    idx = torch.arange(BINS, device=angles.device, dtype=torch.float32)
    dist = (idx[None, :] - angles[:, None]).abs()
    dist = torch.minimum(dist, BINS - dist)
    log_w = -0.5 * (dist / sigma) ** 2
    peaked = torch.softmax(log_w, dim=-1)
    flat = torch.full_like(peaked, 1.0 / BINS)
    return torch.where(no_needle[:, None], flat, peaked)


def batch_loss(logits: torch.Tensor, aux: torch.Tensor, angles: torch.Tensor, no_needle: torch.Tensor, aux_weight: float = 0.15) -> torch.Tensor:
    target = gaussian_targets(angles, no_needle)
    ce = -(target * F.log_softmax(logits, dim=-1)).sum(dim=-1).mean()
    theta = angles * (math.pi / 180.0)
    want = torch.stack((torch.cos(2 * theta), torch.sin(2 * theta)), dim=-1)
    present = (~no_needle).float()
    denom = present.sum().clamp(min=1.0)
    aux_mse = (((aux - want) ** 2).sum(dim=-1) * present).sum() / denom
    return ce + aux_weight * aux_mse


def decode(logits: torch.Tensor, aux: torch.Tensor | None = None) -> tuple[torch.Tensor, torch.Tensor]:
    """Soft-argmax over ±3 bins, confidence = mass within ±5°, optional mod-180 check."""
    prob = torch.softmax(logits, dim=-1)
    peak = torch.argmax(logits, dim=-1)
    offs = torch.arange(-SOFT_RADIUS, SOFT_RADIUS + 1, device=logits.device)
    local = torch.gather(logits, 1, (peak[:, None] + offs) % BINS)
    weight = torch.softmax(local, dim=-1)
    delta = (weight * offs.to(weight.dtype)).sum(dim=-1)
    angle = torch.remainder(peak.to(delta.dtype) + delta, BINS)
    offs5 = torch.arange(-CONF_RADIUS, CONF_RADIUS + 1, device=logits.device)
    conf = torch.gather(prob, 1, (peak[:, None] + offs5) % BINS).sum(dim=-1)
    if aux is not None:
        aux_deg = torch.remainder(torch.rad2deg(torch.atan2(aux[:, 1], aux[:, 0])) * 0.5, 180.0)
        tip = torch.remainder(angle, 180.0)
        diff = (aux_deg - tip).abs()
        diff = torch.minimum(diff, 180.0 - diff)
        conf = torch.where(diff > 25.0, conf * 0.25, conf)
    return angle, conf


def circ_diff_deg(a: torch.Tensor, b: torch.Tensor) -> torch.Tensor:
    d = (a - b).abs() % 360
    return torch.minimum(d, 360 - d)
