"""Draw the home-screen / manifest icons.

Same design as the inline SVG favicon — a sun setting behind two dune ridges —
but as PNGs, because iOS wants a real bitmap for apple-touch-icon and the web
manifest wants 192 and 512 squares. Full-bleed and fully opaque: iOS applies its
own rounded corners and will composite transparency onto black.

    python3 assets/make_icons.py
"""
from PIL import Image, ImageDraw
import math
import os

SKY = (28, 46, 86)
SUN = (255, 207, 122)
DUNE_FAR = (200, 95, 44)
DUNE_NEAR = (156, 70, 32)
SIZES = [180, 192, 512]

HERE = os.path.dirname(os.path.abspath(__file__))
SS = 4          # supersample, then downscale — cheap anti-aliasing


def ridge(draw, size, base, amp, phase, colour):
    """Fill everything below a sine ridge. Same shape language as the terrain."""
    pts = []
    for i in range(size + 1):
        x = i / size
        y = base + amp * math.sin(x * math.pi * 1.7 + phase)
        pts.append((i, y * size))
    pts += [(size, size), (0, size)]
    draw.polygon(pts, fill=colour)


def build(size):
    s = size * SS
    im = Image.new("RGB", (s, s), SKY)
    d = ImageDraw.Draw(im)

    r = 0.20 * s
    cx, cy = 0.5 * s, 0.54 * s
    # a soft halo, drawn as concentric rings so it doesn't need a gradient
    for i in range(14, 0, -1):
        k = i / 14
        rr = r * (1 + k * 1.5)
        blend = tuple(round(SKY[c] + (SUN[c] - SKY[c]) * 0.06 * (1 - k)) for c in range(3))
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=blend)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=SUN)

    ridge(d, s, 0.66, 0.05, 0.4, DUNE_FAR)
    ridge(d, s, 0.82, 0.04, 2.3, DUNE_NEAR)

    return im.resize((size, size), Image.LANCZOS)


for size in SIZES:
    path = os.path.join(HERE, f"icon-{size}.png")
    build(size).save(path, optimize=True)
    print(f"icon-{size}.png  {os.path.getsize(path) / 1024:.1f} KB")
