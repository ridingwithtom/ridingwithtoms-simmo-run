"""Prepare the Jeep into a driveable sprite for Chill mode.

Same destination as prep.py and prep_ktm.py — punch the wheels out so the game can
spin its own, and measure the contact patches, wheel circles and silhouette hull —
but it gets there differently on two counts:

  * the background is flat grey and the Jeep is *white*, which is only 69 levels of
    luminance away from it. The key band is deliberately tight around the median
    background tone rather than spanning the border's full range: the tyres sit at
    luminance 106 and would otherwise be inside the band, letting the flood leak up
    into the rubber from the sand below them.
  * the wheels can't be found the way the motorbikes' are. On a bike the tyres own
    the extreme left and right of the silhouette; on a Jeep those are the bumpers.
    They're found from the two contact patches on the ground instead, and each tyre's
    circle is fitted to the arc of the silhouette's underside around its patch, which
    is pure tyre for a good 140px either way.

    python3 assets/prep_jeep.py

Writes jeep-car.png and jeep-car.json, leaving Jeep.PNG untouched.
Needs pillow, numpy and scipy.
"""
from PIL import Image
import json
import numpy as np
import os
import sys
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "Jeep.PNG")
DST = os.path.join(HERE, "jeep-car.png")
META = os.path.join(HERE, "jeep-car.json")

INNER = 0.99          # punch the whole wheel out; the game draws a spinning one
BAND = 14             # how far from the median background tone still counts as sky
SPREAD_MAX = 14       # and how colourless it has to be
ARC = 70              # px either side of a contact patch to fit that tyre's arc


def key_background(im):
    """RGBA with the flat grey keyed out, largest blob only."""
    rgb = np.asarray(im.convert("RGB")).astype(np.int16)
    h, w = rgb.shape[:2]
    lum = rgb.mean(axis=2)
    greyish = (rgb.max(axis=2) - rgb.min(axis=2)) <= SPREAD_MAX

    edge = np.zeros((h, w), bool)
    edge[:4, :] = edge[-4:, :] = True
    edge[:, :4] = edge[:, -4:] = True
    border = lum[edge & greyish]
    if border.size == 0:
        sys.exit("no flat grey border found")
    tone = float(np.median(border))

    is_bg = greyish & (np.abs(lum - tone) <= BAND)
    labels, _ = ndimage.label(is_bg)
    ids = set(int(v) for v in np.unique(labels[edge & (labels > 0)])) - {0}
    opaque = ~np.isin(labels, list(ids))

    # Anything grey the tight band missed — a vignetted corner, say — survives as its
    # own blob and goes here, along with the sparkle in the corner of the artwork.
    lab, n = ndimage.label(opaque)
    sizes = ndimage.sum(np.ones_like(opaque, float), lab, range(1, n + 1))
    keep = int(np.argmax(sizes)) + 1
    dropped = int((opaque & (lab != keep)).sum())
    opaque = lab == keep

    print(f"  background tone {tone:.0f}, keyed {tone - BAND:.0f}-{tone + BAND:.0f}; "
          f"dropped {dropped}px outside the main blob; {opaque.mean() * 100:.1f}% opaque")
    return Image.fromarray(
        np.dstack([np.asarray(im.convert("RGB")), np.where(opaque, 255, 0).astype(np.uint8)]),
        "RGBA")


def underside(mask):
    w = mask.shape[1]
    bottom = np.full(w, -1)
    for x in range(w):
        col = np.nonzero(mask[:, x])[0]
        if col.size:
            bottom[x] = col.max()
    return bottom


def fit_circle(pts):
    P = np.array(pts, float)
    x, y = P[:, 0], P[:, 1]
    c, *_ = np.linalg.lstsq(np.c_[2 * x, 2 * y, np.ones(len(P))], x ** 2 + y ** 2,
                            rcond=None)
    cx, cy = float(c[0]), float(c[1])
    r = float(np.sqrt(c[2] + cx ** 2 + cy ** 2))
    resid = np.abs(np.hypot(x - cx, y - cy) - r)
    return {"cx": cx, "cy": cy, "r": r, "resid": float(resid.mean()),
            "worst": float(resid.max()), "n": len(P)}


def wheels_of(im):
    """The two tyres, from their contact patches on the ground."""
    mask = np.asarray(im)[:, :, 3] > 80
    bottom = underside(mask)
    floor = int(bottom.max())

    near = np.nonzero((bottom >= 0) & (bottom >= floor - 12))[0]
    groups, cur = [], [int(near[0])]
    for x in near[1:]:
        if x - cur[-1] <= 16:
            cur.append(int(x))
        else:
            groups.append(cur)
            cur = [int(x)]
    groups.append(cur)
    groups = sorted(sorted(groups, key=len, reverse=True)[:2], key=lambda g: g[0])
    if len(groups) != 2:
        sys.exit(f"expected two contact patches on the ground, found {len(groups)}")

    out = []
    for g in groups:
        cx0 = sum(g) / len(g)
        pts = [(x, bottom[x]) for x in range(int(cx0 - ARC), int(cx0 + ARC))
               if 0 <= x < len(bottom) and bottom[x] > 0]
        if len(pts) < 60:
            sys.exit(f"only {len(pts)} underside points near x={cx0:.0f}")
        out.append(fit_circle(pts))
    return out[0], out[1]


def main():
    print(os.path.relpath(SRC, os.path.dirname(HERE)))
    keyed = key_background(Image.open(SRC))

    rear, front = wheels_of(keyed)
    drop = (front["cy"] + front["r"]) - (rear["cy"] + rear["r"])
    tilt = np.degrees(np.arctan2(drop, front["cx"] - rear["cx"]))
    print(f"  as drawn: rear r {rear['r']:.1f} (fit {rear['resid']:.2f}px), "
          f"front r {front['r']:.1f} (fit {front['resid']:.2f}px)")
    print(f"  front wheel sits {drop:.1f}px {'low' if drop > 0 else 'high'} "
          f"-> tilted {tilt:.2f} deg, levelling it")

    level = keyed.rotate(tilt, resample=Image.BICUBIC, expand=True, fillcolor=(0, 0, 0, 0))
    rear, front = wheels_of(level)
    drop = (front["cy"] + front["r"]) - (rear["cy"] + rear["r"])
    print(f"  levelled: rear r {rear['r']:.1f} (fit {rear['resid']:.2f}px), "
          f"front r {front['r']:.1f} (fit {front['resid']:.2f}px), "
          f"wheels now {drop:+.1f}px apart")

    if abs(drop) > 4:
        sys.exit(f"levelling left the wheels {drop:.1f}px apart")
    if max(rear["resid"], front["resid"]) > 4:
        sys.exit("a tyre is not being read as a circle; check the underside fit")
    if abs(rear["r"] - front["r"]) / max(rear["r"], front["r"]) > 0.2:
        sys.exit(f"wheel radii disagree by over 20% ({rear['r']:.1f} vs {front['r']:.1f})")

    arr = np.array(level)
    h, w = arr.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    punched = 0
    for wh in (rear, front):
        inside = ((xx - wh["cx"]) ** 2 + (yy - wh["cy"]) ** 2) < (wh["r"] * INNER) ** 2
        punched += int((inside & (arr[:, :, 3] > 0)).sum())
        arr[inside, 3] = 0
    print(f"  punched {punched}px out of the two wheels")

    out = Image.fromarray(arr, "RGBA")
    bbox = out.getbbox()
    trimmed = out.crop(bbox)
    ox, oy = bbox[0], bbox[1]
    trimmed.save(DST)

    mask = np.asarray(trimmed)[:, :, 3] > 80
    tw, th = trimmed.size
    floor = max(rear["cy"] + rear["r"], front["cy"] + front["r"]) - oy

    pts = []
    for x in range(tw):
        col = np.nonzero(mask[:, x])[0]
        if col.size:
            pts.append((x, int(col.min())))
            pts.append((x, int(col.max())))

    def hull(points):
        points = sorted(set(points))
        if len(points) <= 2:
            return points

        def half(ps):
            acc = []
            for p in ps:
                while len(acc) >= 2:
                    (ax, ay), (bx, by) = acc[-2], acc[-1]
                    if (bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax) <= 0:
                        acc.pop()
                    else:
                        break
                acc.append(p)
            return acc
        return half(points)[:-1] + half(points[::-1])[:-1]

    meta = {
        "file": os.path.basename(DST),
        "hull": [[int(a), int(b)] for a, b in hull(pts)],
        "w": tw, "h": th,
        "floorY": round(floor, 1),
        "rearX": round(rear["cx"] - ox, 1),
        "frontX": round(front["cx"] - ox, 1),
        "wheelbase": round(front["cx"] - rear["cx"], 1),
        "wheels": [
            {"cx": round(rear["cx"] - ox, 1), "cy": round(rear["cy"] - oy, 1),
             "r": round(rear["r"], 1)},
            {"cx": round(front["cx"] - ox, 1), "cy": round(front["cy"] - oy, 1),
             "r": round(front["r"], 1)},
        ],
    }
    json.dump(meta, open(META, "w"), indent=2)
    print(f"  wrote {os.path.basename(DST)}: {tw}x{th}, wheelbase {meta['wheelbase']}px, "
          f"floorY {meta['floorY']}, {len(meta['hull'])} hull points")
    print(json.dumps({k: v for k, v in meta.items() if k != "hull"}, indent=2))


if __name__ == "__main__":
    main()
