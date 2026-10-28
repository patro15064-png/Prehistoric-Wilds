from PIL import Image
import numpy as np, glob
from scipy import ndimage

def dehaze(im, lo, hi):
    a = np.array(im).astype(np.float32)
    a[:, :, 3] = np.clip((a[:, :, 3] - lo) / (hi - lo), 0, 1) * 255
    return Image.fromarray(a.astype(np.uint8), 'RGBA')

def main_blob(im, thr=40):
    a = np.array(im)
    m = a[:, :, 3] > thr
    lab, n = ndimage.label(ndimage.binary_dilation(m, iterations=6))
    if n == 0:
        return im
    sizes = ndimage.sum(m, lab, range(1, n + 1))
    k = int(np.argmax(sizes)) + 1
    keep = ndimage.binary_dilation(lab == k, iterations=2)
    a[:, :, 3] = np.where(keep, a[:, :, 3], 0)
    ys, xs = np.where(a[:, :, 3] > thr)
    return Image.fromarray(a, 'RGBA').crop((max(0, xs.min() - 4), max(0, ys.min() - 4), xs.max() + 5, ys.max() + 5))

im = Image.open('art/ui/med-heart.png').convert('RGBA')
print('heart alpha pct', np.percentile(np.array(im)[:, :, 3], [5, 25, 50]))
im = main_blob(dehaze(im, 150, 235)); im.thumbnail((256, 256), Image.LANCZOS)
im.save('public/ui/med-heart.webp', 'WEBP', quality=88)

A = 'wood stone fiber flint bone herb amber obsidian sulfur hogTusk roughHide snapperScale'.split()
B = 'stalkerClaw stalkerHide emberCarapace ashfangPelt ruinPlate hornShard ruinCrest scorchScale magmaHeart poultice gear-armour gear-weapon'.split()
for sheet, names, lo, hi in (('icons-a', A, 150, 235), ('icons-b', B, 20, 120)):
    im = Image.open(f'art/ui/{sheet}.png').convert('RGBA')
    print(sheet, np.percentile(np.array(im)[:, :, 3], [10, 40, 60]))
    im = dehaze(im, lo, hi); W, H = im.size
    for i, n in enumerate(names):
        c, r = i % 4, i // 4
        cell = main_blob(im.crop((c * W // 4, r * H // 3, (c + 1) * W // 4, (r + 1) * H // 3)))
        s = max(cell.size); sq = Image.new('RGBA', (s, s)); sq.paste(cell, ((s - cell.width) // 2, (s - cell.height) // 2))
        sq.resize((128, 128), Image.LANCZOS).save(f'public/ui/icons/{n}.webp', 'WEBP', quality=88, method=6)

sheet = Image.new('RGBA', (1300, 330), (40, 60, 50, 255)); x = 220; y = 10
sheet.alpha_composite(Image.open('public/ui/med-heart.webp').resize((200, 200)), (10, 10))
for f in sorted(glob.glob('public/ui/icons/*.webp')):
    if x + 100 > 1300:
        x = 220; y += 105
    sheet.alpha_composite(Image.open(f).resize((96, 96)), (x, y)); x += 100
sheet.convert('RGB').save('scratch/ui-sheet2.jpg', quality=85)
