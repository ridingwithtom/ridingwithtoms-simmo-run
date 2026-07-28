"""Prepare the two Poeppel Corner sprites.

Both arrive on flat grey with a sparkle watermark, which prep_landmark.py handles
with --largest. The marker post has one extra problem: the artwork includes its own
soft grey drop shadow, and that survives the colour key because it sits between the
two checker tones the keyer learns. Left in, it reads as a grey smudge on red sand —
the game draws its own contact shadows in warm tones.

The shadow is told from the post by saturation: the post is warm timber, every pixel
of it well off neutral, while the shadow is pure grey.

    python3 prep_poeppel.py
"""
from PIL import Image
import numpy as np
from scipy import ndimage
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def key(src, dst):
    subprocess.run([sys.executable, os.path.join(HERE, "prep_landmark.py"),
                    "--largest", os.path.join(HERE, src), os.path.join(HERE, dst)],
                   check=True)


def strip_grey_shadow(path, spread_max=16):
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im).copy()
    rgb = a[..., :3].astype(int)
    alpha = a[..., 3]
    neutral = (rgb.max(2) - rgb.min(2)) <= spread_max
    before = int((alpha > 40).sum())
    a[..., 3] = np.where(neutral & (alpha > 0), 0, alpha)
    removed = before - int((a[..., 3] > 40).sum())

    labels, n = ndimage.label(a[..., 3] > 40)
    sizes = [int((labels == i).sum()) for i in range(1, n + 1)]
    assert sum(1 for s in sizes if s > 200) == 1, \
        "stripping the shadow broke the post into pieces"

    out = Image.fromarray(a, "RGBA")
    ys, xs = np.nonzero(a[..., 3] > 40)
    out = out.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
    out.save(path)
    print(f"  removed {removed}px of grey shadow, trimmed to {out.size[0]}x{out.size[1]}")


key("poeppels corner.PNG", "poeppel-post.png")
strip_grey_shadow(os.path.join(HERE, "poeppel-post.png"))
key("poeppel sign.PNG", "poeppel-sign.png")
