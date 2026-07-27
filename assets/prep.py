"""Prepare the pixel-art bike photo for use as a game sprite.

Three jobs:
  1. Key out the white studio background, including the enclosed slivers between
     the wheel spokes (found by position inside the tyre discs, so the bike's own
     white bodywork survives).
  2. Punch each wheel out entirely, so the game can draw a fully procedural
     spinning wheel (knobby tyre included) in its place. Keeping the photo tyre
     made the wheel read as stationary, because the knobs never moved.
  3. Record the tyre contact points and wheel circles for the game to use.
"""
from PIL import Image
from collections import deque
import json

SRC = "126CE00B-DCD6-48DC-A7F9-122E20733AD3.png"
INNER = 0.99          # punch the whole wheel out; the game draws a spinning one

im = Image.open(SRC).convert("RGBA")
w, h = im.size
px = im.load()

def is_white(c):
    return c[0] > 228 and c[1] > 228 and c[2] > 228

# --- label near-white regions ----------------------------------------------
label = [[-1] * w for _ in range(h)]
regions = []
for sy in range(h):
    for sx in range(w):
        if label[sy][sx] != -1 or not is_white(px[sx, sy]):
            continue
        idx = len(regions)
        q = deque([(sx, sy)])
        label[sy][sx] = idx
        size = 0; edge = False; accx = 0; accy = 0; accmin = 0
        while q:
            cx, cy = q.popleft()
            size += 1; accx += cx; accy += cy
            accmin += min(px[cx, cy][:3])
            if cx == 0 or cy == 0 or cx == w - 1 or cy == h - 1:
                edge = True
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = cx + dx, cy + dy
                if 0 <= nx < w and 0 <= ny < h and label[ny][nx] == -1 and is_white(px[nx, ny]):
                    label[ny][nx] = idx
                    q.append((nx, ny))
        regions.append({"size": size, "edge": edge, "cx": accx / size,
                        "cy": accy / size, "minch": accmin / size})

edge_bg = {i for i, r in enumerate(regions) if r["edge"]}

def opaque(x, y):
    return not is_white(px[x, y]) or label[y][x] not in edge_bg

# --- ground line and the two tyre contact patches ---------------------------
bottom = []
for x in range(w):
    low = None
    for y in range(h - 1, -1, -1):
        if opaque(x, y):
            low = y; break
    bottom.append(low)

floor = max(v for v in bottom if v is not None)
touching = [x for x, v in enumerate(bottom) if v is not None and v >= floor - 6]
groups, cur = [], [touching[0]]
for x in touching[1:]:
    if x - cur[-1] <= 12:
        cur.append(x)
    else:
        groups.append(cur); cur = [x]
groups.append(cur)
groups = sorted(sorted(groups, key=len, reverse=True)[:2], key=lambda g: g[0])
rear = sum(groups[0]) / len(groups[0])
front = sum(groups[1]) / len(groups[1])

# tyre radius: at mid-wheel height only the tyres reach the far left / right
band = range(floor - 160, floor - 40)
left_edge = min(x for x in range(w) for y in band if opaque(x, y))
right_edge = max(x for x in range(w) for y in band if opaque(x, y))
r_rear = rear - left_edge
r_front = right_edge - front
wheels = [
    {"cx": rear,  "cy": floor - r_rear,  "r": r_rear},
    {"cx": front, "cy": floor - r_front, "r": r_front},
]

# --- clear white slivers inside the tyres -----------------------------------
spoke_bg = set()
for i, r in enumerate(regions):
    if i in edge_bg:
        continue
    for wh in wheels:
        if (r["cx"] - wh["cx"]) ** 2 + (r["cy"] - wh["cy"]) ** 2 < (wh["r"] * 0.94) ** 2:
            spoke_bg.add(i); break
# Enclosed pockets of background the edge flood can never reach: the slot between
# the luggage and the frame, the sliver alongside the fork leg, the gap behind the
# front number board. Left opaque they show up as white patches on the bike.
#
# They are told apart from the bike's own white bodywork on two counts at once.
# Purity: these are the photo's pure-white background, where painted white is
# always slightly shaded — the biggest bodywork region averages 237 on its minimum
# channel, these average 249+. And size: on luminance alone the two populations
# overlap (244.1 vs 244.0 at the boundary), so a purity threshold by itself would
# start punching holes in highlights. Requiring both leaves an 8-point margin.
pure_bg = {i for i, r in enumerate(regions)
           if i not in edge_bg and r["size"] >= 150 and r["minch"] >= 246}
print(f"  clearing {len(pure_bg)} enclosed pure-white pockets "
      f"({sum(regions[i]['size'] for i in pure_bg)} px)")

bg = edge_bg | spoke_bg | pure_bg

# --- compose, punching out the wheel interiors ------------------------------
out = Image.new("RGBA", (w, h))
opx = out.load()
for y in range(h):
    for x in range(w):
        if label[y][x] in bg:
            opx[x, y] = (0, 0, 0, 0)
            continue
        inside = False
        for wh in wheels:
            if (x - wh["cx"]) ** 2 + (y - wh["cy"]) ** 2 < (wh["r"] * INNER) ** 2:
                inside = True; break
        if inside:
            opx[x, y] = (0, 0, 0, 0)
        else:
            r, g, b, a = px[x, y]
            opx[x, y] = (r, g, b, 255)

bbox = out.getbbox()
trimmed = out.crop(bbox)
trimmed.save("bike.png")
ox, oy = bbox[0], bbox[1]

# --- convex hull of the opaque silhouette -----------------------------------
# Needed so the game can work out where a rotated bike actually rests on the
# sand. The image bounding box is no good: its corners are transparent, so a
# flipped bike would be lifted far too high and appear to float.
pts = []
tp = trimmed.load()
tw, th = trimmed.size
for x in range(tw):
    col = [y for y in range(th) if tp[x, y][3] > 80]
    if col:
        pts.append((x, col[0]))
        pts.append((x, col[-1]))

def hull(points):
    points = sorted(set(points))
    if len(points) <= 2:
        return points
    def half(pts):
        out = []
        for p in pts:
            while len(out) >= 2:
                (ax, ay), (bx, by) = out[-2], out[-1]
                if (bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax) <= 0:
                    out.pop()
                else:
                    break
            out.append(p)
        return out
    return half(points)[:-1] + half(points[::-1])[:-1]

silhouette = [[int(px_), int(py_)] for px_, py_ in hull(pts)]

meta = {
    "file": "bike.png",
    "hull": silhouette,
    "w": trimmed.size[0],
    "h": trimmed.size[1],
    "floorY": floor - oy,
    "rearContactX": round(rear - ox, 1),
    "frontContactX": round(front - ox, 1),
    "wheelbase": round(front - rear, 1),
    "innerFrac": INNER,
    "wheels": [
        {"cx": round(wh["cx"] - ox, 1), "cy": round(wh["cy"] - oy, 1), "r": round(wh["r"], 1)}
        for wh in wheels
    ],
}
json.dump(meta, open("bike.json", "w"), indent=2)
print(json.dumps(meta, indent=2))
