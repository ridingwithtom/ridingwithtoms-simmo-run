"""Prepare the Jeep into a driveable sprite for Chill mode.

Same destination as prep.py and prep_ktm.py — take the wheels out of the body sprite
so the game can spin them, and measure the contact patches, wheel circles and
silhouette hull — but it gets there differently on three counts:

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
  * the wheels don't get redrawn. The bikes' are punched out and rebuilt procedurally
    so the desert shows between the spokes; a Jeep wheel is solid, so there is nothing
    to see through and no reason to approximate it. The two discs are cut straight out
    of the artwork and the game rotates the real thing.

    python3 assets/prep_jeep.py

Writes jeep-car.png, jeep-car.json and the two wheel discs, leaving Jeep.PNG
untouched.
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
BG_TONE = 186.0       # learned from the border by key_background()


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

    global BG_TONE
    BG_TONE = tone
    print(f"  background tone {tone:.0f}, keyed {tone - BAND:.0f}-{tone + BAND:.0f}; "
          f"dropped {dropped}px outside the main blob; {opaque.mean() * 100:.1f}% opaque")
    return Image.fromarray(
        np.dstack([np.asarray(im.convert("RGB")), np.where(opaque, 255, 0).astype(np.uint8)]),
        "RGBA")


def defringe(rgb, alpha, tone):
    """Replace the halo with a properly estimated alpha edge.

    Keying a vehicle off a flat backdrop leaves a rim of blended pixels which are
    neither body nor background. Removing them by colour only works where the blend is
    darker than the paint: the white wheel arches blend towards 222 against a 186
    backdrop, which is indistinguishable by threshold from slightly-shaded white paint,
    and a band wide enough to catch it eats the bodywork.

    So they are unmixed instead. Each edge pixel is C = a*F + (1-a)*B for an unknown
    coverage a, a known backdrop B and a foreground F taken from the nearest interior
    pixel. Projecting C-B onto F-B recovers a, and the pixel keeps F at that alpha —
    which is what the artwork would have had over a transparent background. Thin
    features survive because nothing is eroded; the flag pole is 11px wide and there
    are 2px details that a blanket erosion would eat.

    Pixels whose neighbourhood is itself near the backdrop tone are left alone: with
    F close to B there is no direction to project onto and a is meaningless.
    """
    h, w = alpha.shape
    op = alpha > 0
    interior = ndimage.binary_erosion(op, iterations=3)
    if not interior.any():
        return alpha, 0
    # nearest interior pixel for every position, to stand in as the local foreground
    idx = ndimage.distance_transform_edt(~interior, return_indices=True)[1]
    F = rgb[idx[0], idx[1]].astype(float)
    B = np.array([tone, tone, tone], float)

    d = F - B
    denom = (d * d).sum(axis=2)
    C = rgb.astype(float) - B
    a = np.divide((C * d).sum(axis=2), denom, out=np.ones_like(denom),
                  where=denom > 400)          # |F-B| > 20 per channel, roughly
    a = np.clip(a, 0.0, 1.0)

    band = op & ~interior & (denom > 400)
    out_a = alpha.copy().astype(float)
    out_a[band] = a[band] * 255.0
    changed = int((np.abs(out_a - alpha) > 8).sum())
    # take the estimated foreground colour, so what is left is the paint and not a
    # mixture of paint and backdrop
    rgb[band] = np.clip(F[band], 0, 255).astype(int)

    # Whatever survives that and is still a small, bright, half-transparent blob is
    # blend residue rather than artwork — the specks left around the tyres where the
    # local foreground estimate had nothing dark to project onto. Solid paint is spared
    # by the alpha test (the wheel arch sits at 255) and the long anti-aliased roofline
    # by the size test, being one component thousands of pixels long.
    lum = rgb.mean(axis=2)
    speck = (out_a > 8) & (out_a < 250) & (lum > 190)
    lab, n = ndimage.label(speck)
    removed = 0
    if n:
        for i in range(1, n + 1):
            m = lab == i
            size = int(m.sum())
            if size <= 120:
                out_a[m] = 0
                removed += size
    # And the small *fully opaque* white marks sitting right on the silhouette edge —
    # highlight dabs in the pixel art that pass for keying dirt once the vehicle is
    # over dark sand, which is where the ring of white specks around the tyres came
    # from. The alpha test above skips them because they are solid; the size cap is
    # what keeps the white bodywork out of it: measured, the largest such blob anywhere
    # on the vehicle is 26px, so a 30px cap clears them all without reaching the paint.
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    near_edge = ndimage.distance_transform_edt(out_a > 8) <= 3
    dabs = (out_a > 8) & (lum > 195) & (sat < 40) & near_edge
    lab2, n2 = ndimage.label(dabs)
    for i in range(1, n2 + 1):
        m = lab2 == i
        size = int(m.sum())
        if size <= 30:
            out_a[m] = 0
            removed += size

    if removed:
        print(f"  cleared {removed}px of leftover bright speckle")
    return out_a.astype(np.uint8), changed


def bleed_colour(rgb, alpha):
    """Push the vehicle's colours out into the transparent region.

    Sprites are stored with unpremultiplied alpha, so every downscale — optimise.py's,
    then the canvas drawing it smaller than stored — mixes the RGB of *transparent*
    pixels into the semi-transparent edge. Keying only clears alpha, so those pixels
    still hold the grey backdrop they were cut from, and the Jeep grows a pale rim the
    moment it is drawn at anything but 1:1. It measures clean at full size, which is
    what makes it easy to miss.

    Filling the transparent side with the nearest opaque colour leaves nothing but
    vehicle to bleed. The alpha channel is untouched, so the silhouette is unchanged.
    """
    opaque = alpha > 0
    if not opaque.any():
        return rgb
    idx = ndimage.distance_transform_edt(~opaque, return_indices=True)[1]
    out = rgb.copy()
    out[~opaque] = rgb[idx[0], idx[1]][~opaque]
    return out


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

    # Before anything is cut or punched, so the wheel discs inherit a clean rim too.
    # After the wheels are measured, so the geometry comes off the full silhouette.
    _rgb = arr[:, :, :3].astype(int)
    arr[:, :, 3], halo = defringe(_rgb, arr[:, :, 3], BG_TONE)
    arr[:, :, :3] = _rgb.astype(np.uint8)
    print(f"  unmixed {halo}px of background halo along the edges")

    # A Jeep wheel is solid, so there is nothing to see through it and no reason to
    # redraw it from scratch. Each disc is cut straight out of the artwork here and the
    # game rotates the real thing. Safe because the wheel arch sits outside the fitted
    # circle: measured, the discs are 99.4% opaque and 0.0% bodywork across their upper
    # halves, so nothing but wheel goes round.
    for name, wh in (("rear", rear), ("front", front)):
        r = wh["r"]
        side = int(np.ceil(r * 2)) + 2
        cx, cy = wh["cx"], wh["cy"]
        x0, y0 = int(round(cx - side / 2)), int(round(cy - side / 2))
        disc = np.zeros((side, side, 4), np.uint8)
        sy0, sx0 = max(0, y0), max(0, x0)
        sy1, sx1 = min(h, y0 + side), min(w, x0 + side)
        disc[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = arr[sy0:sy1, sx0:sx1]
        gy, gx = np.mgrid[0:side, 0:side]
        dist = np.hypot(gx - (cx - x0), gy - (cy - y0))
        # feathered at the rim, or rotating it shows a jagged edge
        edge = np.clip((r - dist) / 1.5 + 1.0, 0.0, 1.0)
        disc[:, :, 3] = (disc[:, :, 3].astype(float) * edge).astype(np.uint8)
        disc[:, :, :3] = bleed_colour(disc[:, :, :3].astype(int),
                                      disc[:, :, 3]).astype(np.uint8)
        out_wheel = os.path.join(HERE, f"jeep-wheel-{name}.png")
        Image.fromarray(disc, "RGBA").save(out_wheel)
        print(f"  cut {os.path.basename(out_wheel)}: {side}x{side}, r {r:.1f}")

    punched = 0
    for wh in (rear, front):
        inside = ((xx - wh["cx"]) ** 2 + (yy - wh["cy"]) ** 2) < (wh["r"] * INNER) ** 2
        punched += int((inside & (arr[:, :, 3] > 0)).sum())
        arr[inside, 3] = 0
    print(f"  punched {punched}px out of the two wheels")

    arr[:, :, :3] = bleed_colour(arr[:, :, :3].astype(int), arr[:, :, 3]).astype(np.uint8)

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
