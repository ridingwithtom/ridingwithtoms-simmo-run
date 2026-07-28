"""Prepare the KTM into a rideable sprite, the way prep.py does for the WR.

The KTM arrives in a different state to the WR photo, so it needs its own script
rather than a flag on that one:

  * its background is a *baked-in* transparency checkerboard, not a white studio
    backdrop, so the keying is prep_landmark.py's job rather than prep.py's;
  * it is drawn on a tilt. Both tyres are clean circles, but the front one sits
    44px lower than the rear, which works out at just over 4 degrees nose-down.
    The game pins both contact patches to a single ground line, so a tilted sprite
    would ride with one wheel buried and the other in the air. It gets rotated
    level before anything is measured.

Otherwise the jobs are prep.py's: punch the wheels out so the game can draw its
own spinning ones in their place, and measure the contact patches, wheel circles
and silhouette hull that the physics needs.

    python3 assets/prep_ktm.py

Writes ktm-bike.png and ktm-bike.json, leaving ktm.PNG untouched.
Needs pillow, numpy and scipy.
"""
from PIL import Image
import json
import numpy as np
import os
import sys
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "ktm.PNG")
DST = os.path.join(HERE, "ktm-bike.png")
META = os.path.join(HERE, "ktm-bike.json")

INNER = 0.99            # punch the whole wheel out; the game draws a spinning one
SPREAD_MAX = 14         # how colourless a pixel must be to read as checkerboard
FIT_BAND = 26           # px either side of the nominal radius to accept a boundary point


def key_checkerboard(im):
    """RGBA with the baked-in checkerboard keyed out, largest blob only."""
    rgb = np.asarray(im.convert("RGB")).astype(np.int16)
    h, w = rgb.shape[:2]
    lum = rgb.mean(axis=2)
    greyish = (rgb.max(axis=2) - rgb.min(axis=2)) <= SPREAD_MAX

    edge = np.zeros((h, w), bool)
    edge[:4, :] = edge[-4:, :] = True
    edge[:, :4] = edge[:, -4:] = True
    border = lum[edge & greyish]
    if border.size == 0:
        sys.exit("no greyscale border — is the background already transparent?")
    lo, hi = np.percentile(border, 2) - 8, np.percentile(border, 98) + 8

    labels, _ = ndimage.label(greyish & (lum >= lo) & (lum <= hi))
    ids = set(int(v) for v in np.unique(labels[edge & (labels > 0)])) - {0}
    opaque = ~np.isin(labels, list(ids))

    # a stray speck would otherwise define the ground line
    lab, n = ndimage.label(opaque)
    sizes = ndimage.sum(np.ones_like(opaque, float), lab, range(1, n + 1))
    keep = int(np.argmax(sizes)) + 1
    specks = int((opaque & (lab != keep)).sum())
    opaque = lab == keep

    alpha = np.where(opaque, 255, 0).astype(np.uint8)
    print(f"  keyed checker luminance {lo:.0f}-{hi:.0f}; "
          f"dropped {specks}px of specks; {opaque.mean() * 100:.1f}% opaque")
    return Image.fromarray(np.dstack([np.asarray(im.convert('RGB')), alpha]), "RGBA")


def mask_of(im):
    return np.asarray(im)[:, :, 3] > 80


def fit_wheel(mask, cx0, cy0, r0, side):
    """Least-squares circle through boundary points that can only be tyre.

    Restricted to the outer flank and the underside — the top of each wheel is
    behind bodywork, and including it drags the fit onto the mudguard.
    """
    h, w = mask.shape
    pts = set()
    for y in range(h):
        row = np.nonzero(mask[y])[0]
        if not row.size:
            continue
        for x in (row.min(), row.max()):
            dx, dy = x - cx0, y - cy0
            if abs(np.hypot(dx, dy) - r0) > FIT_BAND:
                continue
            ang = abs(np.degrees(np.arctan2(dy, dx)))       # y grows downward
            outer = ang >= 90 if side == "rear" else ang <= 90
            if outer and dy > -r0 * 0.2:
                pts.add((int(x), int(y)))
    for x in range(w):
        col = np.nonzero(mask[:, x])[0]
        if not col.size:
            continue
        y = int(col.max())
        dx, dy = x - cx0, y - cy0
        if abs(np.hypot(dx, dy) - r0) <= FIT_BAND and dy > 0:
            pts.add((int(x), y))

    P = np.array(sorted(pts), float)
    if len(P) < 80:
        sys.exit(f"only {len(P)} boundary points for the {side} wheel — fit unreliable")
    x, y = P[:, 0], P[:, 1]
    c, *_ = np.linalg.lstsq(np.c_[2 * x, 2 * y, np.ones(len(P))], x ** 2 + y ** 2,
                            rcond=None)
    cx, cy = float(c[0]), float(c[1])
    r = float(np.sqrt(c[2] + cx ** 2 + cy ** 2))
    resid = np.abs(np.hypot(x - cx, y - cy) - r)
    return {"cx": cx, "cy": cy, "r": r, "resid": float(resid.mean()), "n": len(P)}


def seed_centres(mask):
    """Rough centres: the tyres own the extreme left and right of the silhouette,
    and a circle's widest point is level with its centre."""
    rows = {}
    for y in range(mask.shape[0]):
        r = np.nonzero(mask[y])[0]
        if r.size:
            rows[y] = (int(r.min()), int(r.max()))
    xmin = min(v[0] for v in rows.values())
    xmax = max(v[1] for v in rows.values())
    cy_rear = np.mean([y for y, (a, _) in rows.items() if a <= xmin + 1])
    cy_front = np.mean([y for y, (_, b) in rows.items() if b >= xmax - 1])
    # radius from the widest point down to the lowest point of that same wheel
    cols = {}
    for x in range(mask.shape[1]):
        c = np.nonzero(mask[:, x])[0]
        if c.size:
            cols[x] = int(c.max())
    span = (xmax - xmin) // 3
    r_rear = max(v for x, v in cols.items() if x <= xmin + span) - cy_rear
    r_front = max(v for x, v in cols.items() if x >= xmax - span) - cy_front
    return ((xmin + r_rear, cy_rear, r_rear), (xmax - r_front, cy_front, r_front))


def wheels_of(im):
    mask = mask_of(im)
    (rcx, rcy, rr), (fcx, fcy, fr) = seed_centres(mask)
    rear = fit_wheel(mask, rcx, rcy, rr, "rear")
    front = fit_wheel(mask, fcx, fcy, fr, "front")
    return rear, front


def main():
    print(f"{os.path.relpath(SRC, os.path.dirname(HERE))}")
    keyed = key_checkerboard(Image.open(SRC))

    rear, front = wheels_of(keyed)
    drop = (front["cy"] + front["r"]) - (rear["cy"] + rear["r"])
    tilt = np.degrees(np.arctan2(drop, front["cx"] - rear["cx"]))
    print(f"  as drawn: rear r {rear['r']:.1f} (fit {rear['resid']:.2f}px), "
          f"front r {front['r']:.1f} (fit {front['resid']:.2f}px)")
    print(f"  front wheel sits {drop:.1f}px low -> tilted {tilt:.2f} deg, levelling it")

    # positive angle lifts the right-hand side, which is where the front wheel is
    level = keyed.rotate(tilt, resample=Image.BICUBIC, expand=True,
                         fillcolor=(0, 0, 0, 0))
    rear, front = wheels_of(level)
    drop = (front["cy"] + front["r"]) - (rear["cy"] + rear["r"])
    print(f"  levelled: rear r {rear['r']:.1f} (fit {rear['resid']:.2f}px), "
          f"front r {front['r']:.1f} (fit {front['resid']:.2f}px), "
          f"wheels now {drop:+.1f}px apart")

    if abs(drop) > 4:
        sys.exit(f"levelling left the wheels {drop:.1f}px apart — check the fits")
    if max(rear["resid"], front["resid"]) > 6:
        sys.exit("a wheel fit residual is over 6px; the tyres are not being read as circles")
    if abs(rear["r"] - front["r"]) / max(rear["r"], front["r"]) > 0.15:
        sys.exit(f"wheel radii disagree by more than 15% ({rear['r']:.1f} vs {front['r']:.1f})")

    # --- punch the wheels out -------------------------------------------------
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

    mask = mask_of(trimmed)
    tw, th = trimmed.size
    floor = max(rear["cy"] + rear["r"], front["cy"] + front["r"]) - oy

    # --- convex hull, so a bike rotated past vertical rests on its real outline --
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
            out = []
            for p in ps:
                while len(out) >= 2:
                    (ax, ay), (bx, by) = out[-2], out[-1]
                    if (bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax) <= 0:
                        out.pop()
                    else:
                        break
                out.append(p)
            return out
        return half(points)[:-1] + half(points[::-1])[:-1]

    meta = {
        "file": os.path.basename(DST),
        "hull": [[int(a), int(b)] for a, b in hull(pts)],
        "w": tw,
        "h": th,
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

    print(f"  wrote {os.path.basename(DST)}: {tw}x{th}, "
          f"wheelbase {meta['wheelbase']}px, floorY {meta['floorY']}, "
          f"{len(meta['hull'])} hull points")
    print(json.dumps({k: v for k, v in meta.items() if k != "hull"}, indent=2))


if __name__ == "__main__":
    main()
