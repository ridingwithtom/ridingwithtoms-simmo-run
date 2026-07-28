"""Assemble docs/ — the folder that actually gets uploaded.

The repo holds ~9 MB of source photos, the un-keyed sprite originals and the
prep scripts. None of that is loaded at runtime, so none of it belongs on a
web host. This copies the three code files, runs assets/optimise.py to produce
downscaled sprites, and stamps the cache-busting query params with one build id.

The folder is named docs/ because GitHub Pages can serve a site straight from
main:/docs with no build pipeline to configure.

    python3 build.py
"""
import os
import re
import shutil
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(ROOT, "docs")

CODE = ["index.html", "style.css", "game.js"]
# Referenced from index.html rather than loaded by game.js, so these sit outside
# the ASSETS check below.
EXTRA = ["manifest.webmanifest"]
ICONS = ["icon-180.png", "icon-192.png", "icon-512.png"]
# Everything game.js actually loads. Keep this in step with LANDMARKS in game.js.
ASSETS = [
    "bike.png", "mt-dare-hotel.png", "birdsville-pub.png", "big-red-sign.png",
    "park-sign.png", "stuck-bike.png", "maccas-sign.png", "eagle-sprite.png",
    "tiger-sprite.png", "brendan-sprite.png", "river-gum.png", "dingo-sprite.png", "swag-sprite.png",
    "beardie-sprite.png", "frillneck-sprite.png", "stumpy-sprite.png",
    "eyre-creek-sign.png", "poeppel-post.png", "poeppel-sign.png",
]


def check_assets_match_source():
    """Fail loudly if game.js loads something the asset list doesn't cover."""
    js = open(os.path.join(ROOT, "game.js")).read()
    referenced = set(re.findall(r"loadLandmark\('([^']+)'\)", js))
    referenced |= set(re.findall(r"\.src = 'assets/([^']+)'", js))
    missing = referenced - set(ASSETS)
    if missing:
        sys.exit(f"game.js loads {sorted(missing)}, which build.py doesn't copy. "
                 f"Add them to ASSETS.")
    unused = set(ASSETS) - referenced
    if unused:
        print(f"  note: {sorted(unused)} listed but not referenced by game.js")


def main():
    check_assets_match_source()

    # Clear the contents rather than the directory itself: removing docs/ breaks
    # anything holding it open, such as a local preview server bind-mounting it.
    os.makedirs(DIST, exist_ok=True)
    for entry in os.listdir(DIST):
        path = os.path.join(DIST, entry)
        shutil.rmtree(path) if os.path.isdir(path) else os.remove(path)
    os.makedirs(os.path.join(DIST, "assets"))

    subprocess.run([sys.executable, os.path.join(ROOT, "assets", "optimise.py")],
                   check=True)

    produced = set(os.listdir(os.path.join(DIST, "assets")))
    for name in ASSETS:
        if name not in produced:
            sys.exit(f"optimise.py did not produce {name}")

    for name in ICONS:
        shutil.copy2(os.path.join(ROOT, "assets", name),
                     os.path.join(DIST, "assets", name))
    for name in EXTRA:
        shutil.copy2(os.path.join(ROOT, name), os.path.join(DIST, name))

    # Anything index.html asks for has to exist in the output, or a phone hits a
    # 404 on the icon and silently falls back to a screenshot of the page.
    for ref in set(re.findall(r'(?:href|src)="((?:assets/)?[\w.\-]+\.(?:png|webmanifest))"',
                              open(os.path.join(ROOT, "index.html")).read())):
        if not os.path.exists(os.path.join(DIST, ref)):
            sys.exit(f"index.html references {ref}, which isn't in the build.")

    stamp = str(int(time.time()))
    for name in CODE:
        text = open(os.path.join(ROOT, name)).read()
        if name == "index.html":
            text = re.sub(r'(game\.js|style\.css)(\?v=\d+)?', rf'\1?v={stamp}', text)
        open(os.path.join(DIST, name), "w").write(text)

    # GitHub Pages runs Jekyll by default, which ignores files starting with _.
    # Nothing here does, but the marker costs nothing and removes the whole class
    # of "my file didn't deploy" surprises.
    open(os.path.join(DIST, ".nojekyll"), "w").close()

    total = sum(
        os.path.getsize(os.path.join(dirpath, f))
        for dirpath, _, files in os.walk(DIST) for f in files
    )
    count = sum(len(files) for _, _, files in os.walk(DIST))
    print(f"\ndocs/ ready: {count} files, {total / 1024 / 1024:.2f} MB (build {stamp})")


if __name__ == "__main__":
    main()
