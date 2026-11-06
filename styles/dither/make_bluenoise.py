"""Generate assets/bluenoise64.png — a 64×64 blue-noise threshold map by
Ulichney's void-and-cluster method (deterministic: fixed seed, no downloads).

    python styles/dither/make_bluenoise.py
"""
from pathlib import Path

import numpy as np
from PIL import Image

N, SIGMA, SEED = 64, 1.5, 1993


def blur(a: np.ndarray) -> np.ndarray:
    """Toroidal Gaussian blur via FFT (the pattern tiles seamlessly)."""
    f = np.fft.fftfreq(N)
    g = np.exp(-2 * (np.pi * SIGMA) ** 2 * (f[:, None] ** 2 + f[None, :] ** 2))
    return np.real(np.fft.ifft2(np.fft.fft2(a) * g))


def tightest(bits: np.ndarray) -> tuple:
    e = np.where(bits, blur(bits.astype(float)), -np.inf)
    return np.unravel_index(np.argmax(e), e.shape)


def largest_void(bits: np.ndarray) -> tuple:
    e = np.where(bits, np.inf, blur(bits.astype(float)))
    return np.unravel_index(np.argmin(e), e.shape)


def main() -> None:
    rng = np.random.default_rng(SEED)
    bits = np.zeros((N, N), bool)
    bits.flat[rng.choice(N * N, N * N // 10, replace=False)] = True
    while True:  # relax the initial pattern
        a = tightest(bits); bits[a] = False
        b = largest_void(bits); bits[b] = True
        if a == b:
            break
    rank = np.zeros((N, N), int)
    ones = int(bits.sum())
    proto = bits.copy()
    for r in range(ones - 1, -1, -1):
        a = tightest(proto); proto[a] = False; rank[a] = r
    proto = bits.copy()
    for r in range(ones, N * N):
        b = largest_void(proto); proto[b] = True; rank[b] = r
    img = (rank * 256 // (N * N)).astype(np.uint8)
    out = Path(__file__).parent / "assets" / "bluenoise64.png"
    Image.fromarray(img, "L").save(out)
    print(out, img.min(), img.max(), round(float(img.mean()), 2))


if __name__ == "__main__":
    main()
