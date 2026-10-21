"""Pure numpy metrics over frames. Every function takes arrays and returns
numbers or masks, so tests can feed synthetic frames."""
from __future__ import annotations

import numpy as np


def diffs(gray: np.ndarray) -> np.ndarray:
    """Mean absolute difference (0–255) between consecutive frames; d[0] = 0."""
    g = gray.astype(np.int16)
    d = np.zeros(len(g))
    if len(g) > 1:
        d[1:] = np.abs(g[1:] - g[:-1]).mean(axis=(1, 2))
    return d


def entropy(gray: np.ndarray) -> float:
    h = np.bincount(gray.ravel(), minlength=256).astype(np.float64)
    p = h[h > 0] / h.sum()
    return float(-(p * np.log2(p)).sum())


def edge_density(gray: np.ndarray, thr: int = 24) -> float:
    g = gray.astype(np.int16)
    gx = np.abs(g[:, 1:] - g[:, :-1])[:-1]
    gy = np.abs(g[1:] - g[:-1])[:, :-1]
    return float(((gx + gy) > thr).mean())


def spans(mask: np.ndarray, min_len: int) -> list[tuple[int, int]]:
    """[start, end) runs of True at least min_len long."""
    out, start = [], None
    for i, v in enumerate(list(mask) + [False]):
        if v and start is None:
            start = i
        elif not v and start is not None:
            if i - start >= min_len:
                out.append((start, i))
            start = None
    return out


def to_lab(rgb: np.ndarray) -> np.ndarray:
    """sRGB uint8 (..., 3) → CIELAB (D65)."""
    c = rgb.astype(np.float64) / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = c @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], axis=-1)


def hex_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def palette_adherence(rgb: np.ndarray, palette: list[str], de: float = 12.0) -> float:
    """Share of pixels within ΔE76 `de` of some palette colour (sampled to ≤ 200k pixels)."""
    px = rgb.reshape(-1, 3)
    if len(px) > 200_000:
        px = px[:: len(px) // 200_000]
    lab = to_lab(px)
    pal = to_lab(np.array([hex_rgb(h) for h in palette], np.uint8))
    d = np.sqrt(((lab[:, None, :] - pal[None, :, :]) ** 2).sum(-1)).min(1)
    return float((d <= de).mean())


def exact_palette(rgb: np.ndarray, palette: list[str], keep: np.ndarray | None = None) -> float:
    """Share of pixels (inside `keep`) whose colour is exactly a palette entry (lossless frames)."""
    pal = np.array([hex_rgb(h) for h in palette], np.int32)
    key = (rgb[..., 0].astype(np.int32) << 16) | (rgb[..., 1].astype(np.int32) << 8) | rgb[..., 2]
    pk = (pal[:, 0] << 16) | (pal[:, 1] << 8) | pal[:, 2]
    hit = np.isin(key, pk)
    return float(hit[keep].mean() if keep is not None else hit.mean())


def block_uniformity(rgb: np.ndarray, k: int, keep: np.ndarray | None = None) -> float:
    """Share of k×k blocks (fully inside `keep`) whose pixels are all identical (integer nearest upscale ⇒ 1.0)."""
    H, W = rgb.shape[:2]
    h, w = H // k * k, W // k * k
    b = rgb[:h, :w].reshape(h // k, k, w // k, k, 3)
    ref = b[:, :1, :, :1, :]
    same = (b == ref).all(axis=(1, 3, 4))
    if keep is not None:
        inside = keep[:h, :w].reshape(h // k, k, w // k, k).all(axis=(1, 3))
        return float(same[inside].mean()) if inside.any() else 1.0
    return float(same.mean())


def rel_luminance(rgb: np.ndarray) -> np.ndarray:
    c = rgb.astype(np.float64) / 255.0
    c = np.where(c <= 0.03928, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * c[..., 0] + 0.7152 * c[..., 1] + 0.0722 * c[..., 2]


def region_contrast(rgb: np.ndarray) -> float:
    """WCAG contrast between the two dominant luminance clusters of a region
    (text vs its ground), robust to dots/dither: 10th vs 90th percentile."""
    L = rel_luminance(rgb).ravel()
    if L.size < 16:
        return 1.0
    lo, hi = np.percentile(L, 3), np.percentile(L, 97)
    return float((hi + 0.05) / (lo + 0.05))


def silhouette_area(rgb: np.ndarray, bg: tuple[int, int, int], thr: float = 40.0) -> float:
    d = np.abs(rgb.astype(np.int16) - np.array(bg, np.int16)).sum(-1)
    return float((d > thr).mean())


def single_frame_pops(area: np.ndarray, rel: float = 0.06) -> list[int]:
    """Frames whose silhouette area jumps and immediately jumps back (a topology pop)."""
    out = []
    for i in range(1, len(area) - 1):
        a, b, c = area[i - 1], area[i], area[i + 1]
        base = max(1e-4, (a + c) / 2)
        if abs(b - base) / base > rel and abs(a - c) / base < rel / 2:
            out.append(i)
    return out


def iridescent_mask(rgb: np.ndarray, chroma: float = 30.0) -> np.ndarray:
    """High-chroma pixels — where foil (or any saturated colour) is."""
    lab = to_lab(rgb)
    return np.hypot(lab[..., 1], lab[..., 2]) > chroma


def smooth_gradient_share(rgb: np.ndarray, exclude: np.ndarray | None = None, t: int = 16) -> float:
    """Share of the frame covered by smooth colour ramps (gradient filler).

    Each t×t tile gets a least-squares plane fit of its luminance. A ramp is
    planar (tiny residual) with a real slope; flat fills have no slope, and
    edges, hairlines, text and dots leave a large residual — so only genuine
    gradients count. Tiles touching `exclude` (photos, video) are ignored.
    """
    g = rgb.astype(np.float64).mean(-1)
    H, W = g.shape
    h, w = H // t, W // t
    tiles = g[: h * t, : w * t].reshape(h, t, w, t).transpose(0, 2, 1, 3).reshape(h, w, t * t)
    yy, xx = np.mgrid[0:t, 0:t]
    A = np.stack([xx.ravel(), yy.ravel(), np.ones(t * t)], 1)
    coef = tiles @ np.linalg.pinv(A).T                     # (h, w, 3): slope x, slope y, offset
    resid = tiles - coef @ A.T
    slope = np.hypot(coef[..., 0], coef[..., 1]) * t       # luminance change across the tile
    ramp = (slope > 3) & (resid.std(-1) < 1.5)
    if exclude is not None:
        ex = exclude[: h * t, : w * t].reshape(h, t, w, t).any(axis=(1, 3))
        keep = ~ex
        return float((ramp & keep).sum() / max(1, keep.sum()))
    return float(ramp.mean())
