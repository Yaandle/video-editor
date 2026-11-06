"""Cut the type that never changes (the title, the five part headings and their
digits) out of the sketchbook GIF's 1920x1080 frames as alpha masks, so the
replica keeps the exact The Seasons and Gotham letterforms.

    python styles/sketch/arch/make_crops.py media/uploads/TechnicalArchitectureStudy
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

SRC = Path(sys.argv[1])
OUT = Path(__file__).parent
RED = (255, 87, 87)


def frame(n):
    return np.asarray(Image.open(SRC / f'{n}.png').convert('RGB')).astype(np.float32)


def save(name, a, alpha, rgb):
    h, w = alpha.shape
    img = np.zeros((h, w, 4), np.uint8)
    img[..., :3] = rgb
    img[..., 3] = np.clip(alpha * 255 + 0.5, 0, 255).astype(np.uint8)
    Image.fromarray(img, 'RGBA').save(OUT / f'{name}.png')


meta = {}

# Title (black on white): alpha = 1 - luminance; words split at the gaps.
x0, y0, x1, y1 = 196, 216, 1726, 364
f = frame(4)[y0:y1, x0:x1]
alpha = 1 - f.min(axis=2) / 255
save('title', f, alpha, (0, 0, 0))
cols = np.nonzero((alpha > 0.25).any(axis=0))[0]
words, start = [], cols[0]
for a, b in zip(cols, cols[1:]):
    if b - a > 14:
        words.append([int(start), int(a) + 1])
        start = b
words.append([int(start), int(cols[-1]) + 1])
meta['title'] = {'x': x0, 'y': y0, 'w': x1 - x0, 'h': y1 - y0, 'words': words}

# Part headings (red on white): alpha from the green channel.
FRAMES = {1: 4, 2: 7, 3: 8, 4: 9, 5: 10}
hx0, hy0, hx1, hy1 = 300, 415, 640, 540
dx0, dy0, dx1, dy1 = 233, 449, 290, 506
for part, n in FRAMES.items():
    f = frame(n)
    g = f[..., 1]
    a = np.clip((255 - g) / (255 - RED[1]), 0, 1)
    save(f'h{part}', None, a[hy0:hy1, hx0:hx1], RED)
    save(f'd{part}', None, a[dy0:dy1, dx0:dx1], RED)
meta['heading'] = {'x': hx0, 'y': hy0, 'w': hx1 - hx0, 'h': hy1 - hy0}
meta['digit'] = {'x': dx0, 'y': dy0, 'w': dx1 - dx0, 'h': dy1 - dy0}
(OUT / 'crops.json').write_text(json.dumps(meta, indent=1))
print(json.dumps(meta))
