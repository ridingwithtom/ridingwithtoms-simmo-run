# RidingWithTom's Simmo Run!

A browser game about crossing the Simpson Desert on a Yamaha WR250R — Mt Dare
Hotel to Birdsville, 1200 sand dunes, on the back wheel the whole way.

One crossing is one day: the run opens before dawn with the stars still out, the
sun climbs to noon around Poeppel Corner, sets behind Big Red, and you roll into
Birdsville under a full moon with the pub letting off fireworks.

Three quarters of the way across you drop into Eyre Creek and wade through it. The
water is translucent, so the bed, the fish and the submerged half of the bike all
show through it, and it drags the bike down to a little over half speed — which
costs you fuel you don't get back.

The soundtrack is `assets/Kookaburra_Dawn.mp3`, thirty seconds of desert dawn on a
loop. It only downloads once you tap or press space, so it never holds up the
first paint, and the speaker button in the bottom right corner turns it off — the
choice sticks in `localStorage`.

## Controls

| | Keyboard | Touch |
|---|---|---|
| lift the nose | <kbd>↓</kbd> | hold the left half of the screen |
| bring it down | <kbd>↑</kbd> | hold the right half |
| start / restart | <kbd>space</kbd> | tap |

Let the front wheel touch the sand and you stack. Lean too far past the balance
point and you loop it over backwards — also a stack. Every stack costs 5 seconds
of fuel and you've only got enough for about three.

## Running it locally

No build step and no dependencies for development — it's plain HTML, CSS and
canvas. Any static server over the project root works:

    python3 -m http.server 8080

Then open <http://localhost:8080>.

## Building for the web

`docs/` is the deployable site: the three code files, the soundtrack, plus only
the sprites the game actually loads, downscaled to the size they're drawn at and
palette-quantised. That takes the payload from 5.25 MB to 0.38 MB, which matters
a lot on mobile data.

    python3 build.py          # needs pillow and numpy

Re-run it after changing `game.js`, `index.html`, `style.css` or any sprite —
`docs/` is a build product, not a place to edit. The script fails loudly if
`game.js` starts loading a sprite it doesn't know to copy.

## Layout

    index.html style.css game.js   the game
    assets/                        sprite originals + the scripts that prepare them
      prep.py                      keys the bike photo, punches the wheels out,
                                   measures contact points and the convex hull
      prep_landmark.py             strips baked-in transparency checkerboards
                                   from the landmark sprites
      prep_gum.py                  the river gum needs its scale-reference figure
                                   removed as well, and it is joined to the tree
                                   through the dirt mound, so --largest can't do it
      optimise.py                  downscales and quantises for the web
    build.py                       assembles docs/
    docs/                          built site — served by GitHub Pages

Everything in `assets/` other than the sprites listed in `build.py` is
source material: original photos, un-keyed screenshots, the sunset reference.
None of it is loaded at runtime and none of it ships.

## Notes on the music

The mp3 has a LAME tag but no Xing header, so a decoder has no gapless
information to work with and `<audio loop>` would tick audibly every thirty
seconds. Web Audio instead: the decoder's leading padding is measured off the
waveform and skipped, and because the track ends about 5 dB louder than it starts
each repeat is a separate source overlapping the one before it, crossfaded on an
equal-power curve. Each pass queues the one after next when it ends, which keeps
half a minute of slack in the chain so a throttled background tab can't starve it
into a gap.

## Notes on the physics

The bike is a rigid body pitching about its rear contact patch. Chassis angle
comes from the exact chord between the two wheel contact points rather than a
spring, which is what stopped it floating over the dunes like a boat. Gravity
torque is measured in the world frame — getting that wrong made the descent off
Big Red sit exactly on the balance point and stack every single run.
