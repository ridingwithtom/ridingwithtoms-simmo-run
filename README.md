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

The soundtrack is `assets/kookaburralonger.128.mp3`, ninety-six seconds of desert
dawn on a loop — long enough that it outlasts the fuel budget, so a run never reaches
the join. It only downloads once you tap or press space, so it never holds up the
first paint, and the speaker button in the bottom right corner turns it off — the
choice sticks in `localStorage`.

## Three ways across

Pick one on the start screen — arrow keys or 1-3 on a keyboard, tap a card on a phone;
the choice sticks in `localStorage`. The cards name the difficulty rather than the
machine: the player is choosing how hard the run is, and what turns up is the surprise.
Easy is the default for a first-timer, not whatever happens to sit leftmost.

| | Chill (Jeep) | Easy (WR250R) | Hard (KTM) |
|---|---|---|---|
| speed | 215 px/s | 430 px/s | 860 px/s |
| the course takes | 121s | 62s | 31s |
| fuel | none | 82s | 41s |
| lean torque | — | 7 | 20 |
| pitch damping | — | 2.9 | 2.2 |
| input ramp | — | 7 | 11 |

**Chill** turns the game off rather than making it easy. The whole thing is a balance
task, so `autopilot` skips the lot: no lean input, no wheelie, no crest launch off Big
Red, no crash rules and no fuel clock. The Jeep just follows the ground to Birdsville
in about two minutes while you watch, wading Eyre Creek at 116 px/s on the way. The
fuel readout, the lean instructions and the touch zones all hide themselves, because
there is nothing to spend, nothing to read and nothing to press. The distance counter
stays — watching Birdsville come closer is the point.

It also needs a few things the bikes don't: both wheels drive rather than just the
rear, and the wheel gets a steel face with lug holes instead of eight wire spokes,
which on a Wrangler read as a pushbike. Its wheelbase is drawn 1.65x a bike's, matching
a real Wrangler against a real WR250R, which is the other reason the ride is smooth —
that is 1.65x as much terrain bridged between the contact patches.

Everything that differs lives in the `BIKES` table in `game.js` — including the
geometry, which is measured off each sprite rather than typed in: the contact patches
set the wheelbase the physics pivots about, and the hull is what stops a bike rotated
past vertical driving its bars through the sand.

Because both are scaled by wheelbase rather than height, they come out almost the same
size on screen (wheel radius 35.08 against 35.01, draw width 225.5 against 225.3), with
the KTM standing 6% taller. The lean number is
the sensitivity: both directions come off it, since the rider's torque is
`input * lean`. It was set from measurement rather than feel — see the physics notes.

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
      prep_ktm.py                  the KTM arrives with a baked-in checkerboard and
                                   drawn on a 4 degree tilt, so it is keyed, rotated
                                   level, then measured like prep.py does the WR
      prep_jeep.py                 the Jeep is white on flat grey, only 69 levels
                                   apart, and its wheels can't be found the way a
                                   bike's are — the bumpers own the silhouette's
                                   extremes, so the tyres come off their ground
                                   contacts instead
      encode_music.py              trims the soundtrack master by its gapless tag
                                   and re-encodes at 128 kbps (needs ffmpeg + lame)
      optimise.py                  downscales and quantises for the web
    build.py                       assembles docs/
    docs/                          built site — served by GitHub Pages

Everything in `assets/` other than the sprites listed in `build.py` is
source material: original photos, un-keyed screenshots, the sunset reference.
None of it is loaded at runtime and none of it ships.

## Notes on the music

The track is already cut to loop: tail straight into head, no silence at either end
of the music. What gets in the way is the mp3 container, which brackets the audio
with frames the encoder needs and the music doesn't.

Two encoders write those figures in two different places — Apple into an `iTunSMPB`
ID3 comment, lame into its own extension inside the first audio frame — so
`readGapless()` reads the bytes before decoding (after which they're detached) and
handles either. Both count samples at the file's own rate, which comes back too.

The part that is easy to get wrong: **decoders disagree about whether they apply
that information themselves.** Chrome honours lame's tag and hands back only the
music; it ignores Apple's and hands back everything. Trimming on top of a decoder
that already trimmed silently eats real audio — 1972 frames of it here. So
`loopWindow()` compares the length that came back against the length the file says
it holds, and only trims if nothing has yet. Verified both ways round, in 44.1 kHz
and 48 kHz contexts: both land on exactly 4230476 frames of music.

Going through the decoded duration rather than a sample rate is what keeps a
44.1 kHz file landing on the right frame in a 48 kHz context.

Nothing crossfades the join, deliberately. The track ends on a fade to −31 dB and
opens at −12 dB, an 18.7 dB step, so looping it reads as a restart rather than a
continuation — but there is no click (the sample step across the join is smaller
than 99% of the track's own) and no gap, and at 95.9 s against an 82 s fuel budget
a run never gets there. Only a session spanning several runs does.

`assets/encode_music.py` makes the shipped file from the master. The master is
265 kbps out of Final Cut, which is 3.0 MB — four times the rest of the site, for
birdsong played at a third volume — so it goes down to 128 kbps CBR and 1.47 MB.
The trim has to happen *before* re-encoding, because ffmpeg does not apply the
master's gapless information on decode and would otherwise bake its padding in as
real silence, permanently. Measured against the master, the encode is faithful to
about 15 kHz and rolls off above 16 kHz, where the master itself was already 56 dB
down.

## Notes on the difficulty

The playable band is a pitch between −1.5 and −0.06 rad, with an *unstable*
equilibrium at `COM_ANGLE − π/2` = −0.941: above it gravity pulls the nose down,
below it gravity drives you over backwards. So the rider is balancing on a knife
edge the whole way, and difficulty is how quickly that edge throws you off.

Two numbers measure it, by integrating the pitch equation on flat ground:

| | do nothing → front wheel down | hold full lean-back → loops | corrections a run asks for |
|---|---|---|---|
| Easy (7 / 2.9 / 7) | 1.10s | 0.92s | ~64 |
| Hard (20 / 2.2 / 11) | 1.00s | 0.45s | ~66 |
| on record as unwinnable (14 / 3.2) | 1.15s | 0.62s | ~96 |

The last column is the one that matters, and it corrected a mistake. Twitchiness on
its own is misleading, because a shorter run needs fewer saves: what a run really
asks of you is about its length divided by how long you can hold the lean before it
loops. Hard's first draft ran at lean 10, which measured as satisfyingly twitchy —
but over a 30s course it needed only ~40 clean corrections against Easy's ~64. It was
the *easier* bike to balance and merely the faster one to ride.

At 20/2.2/11 it loops in 0.45s, half of Easy's margin, which lands at ~66 corrections
— past Easy, so it is now harder in both dimensions. The ceiling is the row a comment
in `game.js` records as "unwinnable rather than hard": that bike demanded ~96, so
there is headroom left if it still isn't mean enough.

Doubling the speed has two consequences worth knowing:

- **Big Red sends it 946px instead of 430px**, landing far enough down the face that
  the slope there is −0.53 rad rather than −0.17. Landing pitch is attitude minus
  ground angle, so that eats 0.36 rad of the tolerance: on the KTM, holding a wheelie
  steeper than about −0.92 rad over Big Red is a guaranteed stack on touchdown. It
  lands *on* the sand — swept every attitude, zero penetration — it's the landing
  tolerance biting, not a clipping bug.
- **The wheel would spin backwards.** 9 knobs at 860 px/s advance 59% of a knob
  spacing per frame, past the 50% where rotation aliases. The KTM's wheel is drawn at
  half its true rate, which puts it back to the WR's 29%. The tyre technically drags,
  but a wheel doing 3.9 rev/s is a blur and going visibly backwards is much worse.

## Notes on the physics

The bike is a rigid body pitching about its rear contact patch. Chassis angle
comes from the exact chord between the two wheel contact points rather than a
spring, which is what stopped it floating over the dunes like a boat. Gravity
torque is measured in the world frame — getting that wrong made the descent off
Big Red sit exactly on the balance point and stack every single run.
