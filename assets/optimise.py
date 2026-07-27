"""Shrink the game's sprites to the size they're actually drawn at.

The originals are 500-1200 px on their long edge but the game never draws them
larger than a few hundred CSS px, and game.js clamps the canvas at DPR 2 -- so
anything beyond 2x the drawn height is bytes the player downloads and the
browser immediately throws away when it downscales.

Each sprite is resized with Lanczos, then palette-quantised where that is
lossless enough to be invisible (these are flat renders, not photographs).
Writes into docs/assets/, leaving the originals untouched.

    python3 assets/optimise.py
"""
from PIL import Image
import numpy as np
import os

DPR_CAP = 2          # game.js: DPR = Math.min(devicePixelRatio, 2)
MARGIN = 1.1         # a little headroom for the odd oversized draw

# file -> the height in CSS px the game draws it at (LANDMARK_SIZE.h in game.js,
# EAGLE_H for the eagle). The bike is special: it's scaled by wheelbase.
DRAWN_H = {
    "mt-dare-hotel.png":  250,
    "birdsville-pub.png": 250,
    "big-red-sign.png":   200,
    "park-sign.png":      180,
    "stuck-bike.png":     130,
    "maccas-sign.png":    300,
    "eagle-sprite.png":   150,
    "tiger-sprite.png":   150,
    "brendan-sprite.png": 210,
    "river-gum.png":      400,
}
# SPRITE_SCALE = BIKE_WHEELBASE / SPRITE.wheelbase = 152 / 819
BIKE_SCALE = 152 / 819

SRC = os.path.dirname(os.path.abspath(__file__))
DST = os.path.join(os.path.dirname(SRC), "docs", "assets")
os.makedirs(DST, exist_ok=True)


def target_size(name, im):
    w, h = im.size
    if name == "bike.png":
        want_w = w * BIKE_SCALE * DPR_CAP * MARGIN
        return max(1.0, w / want_w)
    want_h = DRAWN_H[name] * DPR_CAP * MARGIN
    return max(1.0, h / want_h)


def save_smallest(im, path):
    """Write the smaller of full-colour and palette-quantised.

    These sprites are flat renders carrying a lot of near-duplicate colours,
    which is what makes them compress so badly as 32-bit PNGs. A 255-entry
    palette is visually indistinguishable once the image is drawn at a third of
    its stored size, and typically takes 85% off. FASTOCTREE is used because it
    is the only Pillow method that handles an alpha channel.
    """
    im.save(path, optimize=True)
    plain = os.path.getsize(path)

    q = im.quantize(colors=255, method=Image.FASTOCTREE, dither=Image.NONE)
    tmp = path + ".q.png"
    q.save(tmp, optimize=True)
    if os.path.getsize(tmp) < plain:
        os.replace(tmp, path)
        # sanity-check the palette version really is close to the original
        err = quant_error(im, Image.open(path))
        assert err < 8, f"{os.path.basename(path)}: quantising shifted colours by {err:.1f}/255"
    else:
        os.remove(tmp)
    return os.path.getsize(path)


def quant_error(original, result):
    """Mean per-channel colour shift over the opaque pixels."""
    a = np.asarray(original.convert("RGBA"), dtype=float)
    b = np.asarray(result.convert("RGBA"), dtype=float)
    mask = a[..., 3] > 20
    if not mask.any():
        return 0.0
    return float(np.abs(a[..., :3] - b[..., :3])[mask].mean())


before = after = 0
for name in ["bike.png"] + list(DRAWN_H):
    src = os.path.join(SRC, name)
    im = Image.open(src).convert("RGBA")
    was = os.path.getsize(src)
    factor = target_size(name, im)
    new = (max(1, round(im.size[0] / factor)), max(1, round(im.size[1] / factor)))
    out = im.resize(new, Image.LANCZOS) if factor > 1.02 else im
    now = save_smallest(out, os.path.join(DST, name))
    before += was
    after += now
    print(f"{name:22s} {im.size[0]:5d}x{im.size[1]:<5d} -> {new[0]:4d}x{new[1]:<4d}  "
          f"{was / 1024:7.0f} KB -> {now / 1024:6.0f} KB  ({100 * (1 - now / was):4.1f}% off)")

print(f"\n{'TOTAL':22s} {before / 1024 / 1024:.2f} MB -> {after / 1024 / 1024:.2f} MB "
      f"({100 * (1 - after / before):.1f}% smaller)")
