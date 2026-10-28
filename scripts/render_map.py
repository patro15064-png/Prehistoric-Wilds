import json, sys
import numpy as np
from PIL import Image, ImageDraw

meta = json.load(open('shots/terrain.json'))
N = meta['N']; half = meta['half']
h = np.fromfile('shots/heights.bin', dtype=np.float32).reshape(N, N)
trail = np.fromfile('shots/trail.bin', dtype=np.float32).reshape(N, N)
img = np.zeros((N, N, 3), dtype=np.float32)
water = h < 0
img[...] = np.stack([0.35 + h / 120, 0.55 + h / 200, 0.25 + 0 * h], -1)
img[h > 25] = np.stack([0.8 + 0 * h, 0.65 + 0 * h, 0.3 + 0 * h], -1)[h > 25]
img[h > 55] = [0.35, 0.3, 0.3]
gy, gx = np.gradient(h)
slope = np.hypot(gx, gy) / (2 * half / (N - 1))
img[slope > 1.0] = [0.45, 0.35, 0.3]
img[water] = [0.1, 0.35, 0.7]
xs = np.linspace(-half, half, N)
X, Z = np.meshgrid(xs, xs)
crater = np.hypot(X + 18, Z + 178) < 46
img[crater & (h < 43.25)] = [1.0, 0.35, 0.05]
img[trail > 0.5] = [0.9, 0.85, 0.7]
shade = np.clip(1 - (gx - gy) * 0.08, 0.6, 1.3)[..., None]
img = np.clip(img * shade, 0, 1)
im = Image.fromarray((img * 255).astype(np.uint8)).resize((N * 2, N * 2), Image.NEAREST)
d = ImageDraw.Draw(im)
def px(x, z):
    return ((x + half) / (2 * half) * N * 2, (z + half) / (2 * half) * N * 2)
for name, (x, z) in {'camp': (24, 48), 'ruins': (128, -46), 'wyrm': (-20, -182), 'ribs': (-30, 214), 'elder': (96, 118), 'arch': (170, 196), 'vents': (40, -52), 'fingers': (190, -20)}.items():
    a, b = px(x, z)
    d.ellipse([a - 5, b - 5, a + 5, b + 5], outline=(255, 0, 255), width=2)
    d.text((a + 7, b - 6), name, fill=(255, 255, 255))
for k in ('top', 'pool', 'lagoon'):
    a, b = px(meta['falls'][k]['x'], meta['falls'][k]['z'])
    d.ellipse([a - 4, b - 4, a + 4, b + 4], outline=(0, 255, 255), width=2)
im.save(sys.argv[1] if len(sys.argv) > 1 else 'shots/map.png')
print('min', h.min(), 'max', h.max(), 'land%', (h > 0).mean())
