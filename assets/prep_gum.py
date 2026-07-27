"""Prepare the river red gum sprite.

Two quirks beyond the usual checkerboard keying that prep_landmark.py handles:

  * a small human figure stands beside the tree as a scale reference. It has to go
    — the same person appearing next to every gum would read as a mistake — but it
    is joined to the tree through the dirt mound they both stand on, so
    --largest can't separate them.
  * a sparkle watermark in the bottom-right corner, which --largest does drop.

The figure occupies the mound's right lobe. Measured on the keyed sprite, nothing
but mound and figure lives below y=600 and right of x=520 — the canopy's rightmost
foliage stops at x=587 — so clearing that corner removes the figure and the very
tip of the mound, and leaves the tree as one connected piece.

    python3 prep_gum.py
"""
from PIL import Image
import numpy as np
from scipy import ndimage
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = "river gum 1.PNG"          # 'river gum 2.PNG' is a pixel-identical copy
DST = "river-gum.png"
TMP = os.path.join(HERE, ".gum-keyed.png")

subprocess.run([sys.executable, os.path.join(HERE, "prep_landmark.py"),
                "--largest", os.path.join(HERE, SRC), TMP], check=True)

im = Image.open(TMP).convert("RGBA")
a = np.asarray(im).copy()
alpha = a[..., 3]

CUT_X, CUT_Y = 521, 600
before = int((alpha > 40).sum())
alpha[CUT_Y:, CUT_X:] = 0
a[..., 3] = alpha
removed = before - int((alpha > 40).sum())

# the tree must survive as a single piece; if it ever splits, the cut is wrong
labels, n = ndimage.label(alpha > 40)
sizes = [int((labels == i).sum()) for i in range(1, n + 1)]
big = [s for s in sizes if s > 200]
assert len(big) == 1, f"clearing the corner split the tree into {len(big)} pieces"

out = Image.fromarray(a, "RGBA")
ys, xs = np.nonzero(alpha > 40)
out = out.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
out.save(os.path.join(HERE, DST))
os.remove(TMP)

print(f"  removed the scale figure and the mound's right tip ({removed} px)")
print(f"  {DST} is {out.size[0]}x{out.size[1]}")
