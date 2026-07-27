"""Prepare a landmark sprite (pub, hotel, sign) for the game.

Handles the awkward cases these assets actually arrive in:

  * a *baked-in* transparency checkerboard — the grey grid you get when a
    transparent PNG is screenshotted. Both checker tones and the anti-aliased
    pixels between squares are keyed out.
  * checkerboard trapped in enclosed areas (under a veranda, say) that a plain
    edge flood can never reach. Those are told apart from genuine white artwork
    by the fact that a checkerboard region contains BOTH tones, while painted
    white is one flat tone.
  * stray specks, which would otherwise inflate the crop.
  * empty margins. The game treats the bottom edge as ground level and centres
    the image horizontally, so the result is trimmed tight to the artwork.

    python3 prep_landmark.py IMG_2949.PNG mt-dare-hotel.png

Reads the source and writes a new file, leaving the original untouched.
Needs numpy and scipy:  pip3 install numpy scipy Pillow
"""
from PIL import Image
import numpy as np
from scipy import ndimage
import os
import sys

args = [a for a in sys.argv[1:] if not a.startswith("--")]
opts = {}
for i, a in enumerate(sys.argv[1:]):
    if a.startswith("--"):
        opts[a[2:]] = sys.argv[i + 2]

if len(args) < 2:
    print(__doc__)
    sys.exit(1)

src, dst = args[0], args[1]
if os.path.abspath(src).lower() == os.path.abspath(dst).lower():
    print(f"refusing to run: {src} and {dst} are the same file on a "
          f"case-insensitive filesystem, which would destroy the source.")
    print("pick a different output name, e.g. eagle-sprite.png")
    sys.exit(1)
spread_max = int(opts.get("spread", 14))     # how grey a pixel must be to count
margin = int(opts.get("margin", 8))          # widen the keyed luminance band
min_speck = int(opts.get("speck", 80))       # opaque blobs smaller than this go

rgb = np.asarray(Image.open(src).convert("RGB")).astype(np.int16)
h, w = rgb.shape[:2]

lum = rgb.mean(axis=2)
spread = rgb.max(axis=2) - rgb.min(axis=2)
greyish = spread <= spread_max

# --- learn the checker tones from a border strip -----------------------------
edge = np.zeros((h, w), bool)
edge[:4, :] = True
edge[-4:, :] = True
edge[:, :4] = True
edge[:, -4:] = True

border_lums = lum[edge & greyish]
if border_lums.size == 0:
    print("  no greyscale border found - is the background already transparent?")
    sys.exit(1)

lo = np.percentile(border_lums, 2) - margin
hi = np.percentile(border_lums, 98) + margin
dark_tone = np.percentile(border_lums, 10)
light_tone = np.percentile(border_lums, 90)

print(f"{src} {w}x{h}")
print(f"  keying greyscale luminance {lo:.0f}-{hi:.0f}; "
      f"checker tones {dark_tone:.0f} / {light_tone:.0f}")

is_bg = greyish & (lum >= lo) & (lum <= hi)

# --- background reachable from the edges -------------------------------------
labels, n = ndimage.label(is_bg)
edge_ids = set(int(v) for v in np.unique(labels[edge & is_bg]))
edge_ids.discard(0)
transparent = np.isin(labels, list(edge_ids))
edge_cleared = int(transparent.sum())

# --- enclosed checkerboard: keep flat tones, clear bimodal ones ---------------
near_dark = np.abs(lum - dark_tone) <= 12
near_light = np.abs(lum - light_tone) <= 12
enclosed_cleared = 0
for comp_id in range(1, n + 1):
    if comp_id in edge_ids:
        continue
    m = labels == comp_id
    size = int(m.sum())
    if size < 40:
        continue
    if (near_dark & m).sum() > size * 0.12 and (near_light & m).sum() > size * 0.12:
        transparent |= m
        enclosed_cleared += size

# --- build RGBA, then drop specks --------------------------------------------
alpha = np.where(transparent, 0, 255).astype(np.uint8)
op_labels, op_n = ndimage.label(alpha > 40)
specks = 0
if op_n:
    sizes = ndimage.sum(np.ones_like(alpha), op_labels, range(1, op_n + 1))
    if "largest" in opts:
        # single-subject sprite: keep only the biggest blob. Use this when the
        # source has a drop shadow baked in that survives the colour keying.
        keep = int(np.argmax(sizes)) + 1
        drop = (op_labels != keep) & (op_labels != 0)
        specks += int(drop.sum())
        alpha[drop] = 0
    else:
        for i, s in enumerate(sizes, start=1):
            if s < min_speck:
                alpha[op_labels == i] = 0
                specks += int(s)

im = Image.fromarray(np.dstack([rgb.astype(np.uint8), alpha]), "RGBA")

ys, xs = np.nonzero(alpha > 40)
im = im.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
im.save(dst)

total = (edge_cleared + enclosed_cleared) / (w * h) * 100
print(f"  cleared {total:.1f}% background ({enclosed_cleared} px of it enclosed), "
      f"{specks} px of specks")
print(f"  trimmed to {im.size[0]}x{im.size[1]}, "
      f"aspect {im.size[0] / im.size[1]:.2f} -> {dst}")
