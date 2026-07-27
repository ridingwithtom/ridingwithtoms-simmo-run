(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const fuelFill = document.getElementById('fuel-fill');
  // Fall back to the older element ids: a cached index.html served against fresh
  // JS would otherwise leave these null and throw on the first frame.
  const fuelNum = document.getElementById('fuel-num')
               || document.getElementById('fuel-count');
  const fuelCap = document.querySelector('#fuel-count .cap');
  const progressFill = document.getElementById('progress-fill');
  const dunesNum = document.getElementById('dunes-num')
                || document.getElementById('progress-count');
  const dunesCap = document.querySelector('#progress-count .cap');
  const startScreen = document.getElementById('start-screen');
  const finishScreen = document.getElementById('finish-screen');
  const deadScreen = document.getElementById('dead-screen');
  const finishTimeEl = document.getElementById('finish-time');
  const deadDetailEl = document.getElementById('dead-detail');

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ---------- canvas sizing ----------
  // W and H are the *virtual* viewport: how much world is in frame, not how many
  // CSS pixels the canvas occupies. On a phone they stay near the desktop values
  // and ZOOM shrinks everything to fit, so a small screen shows the same stretch
  // of desert rather than the same stretch magnified — you get the same warning
  // of the next dune. Every draw function is written in terms of W and H, so the
  // zoom costs nothing beyond the transform below.
  //
  // Anything working in real CSS pixels (the touch split, the DOM HUD) must keep
  // using window.innerWidth / CSS units, not these.
  const REF_W = 1180, REF_H = 620;   // the view a desktop window already gives
  const MIN_ZOOM = 0.45;             // past this the bike is too small to read
  let W = 0, H = 0, DPR = 1, ZOOM = 1;

  function viewportPx() {
    // A page that isn't laid out yet — or is in a backgrounded tab being
    // restored — can report 0 here. Assigning that to canvas.width gives a 0x0
    // backing store and a blank game, so fall back to the canvas's own box and
    // then to the reference view.
    const rect = canvas.getBoundingClientRect();
    return {
      w: window.innerWidth || Math.round(rect.width) || REF_W,
      h: window.innerHeight || Math.round(rect.height) || REF_H
    };
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    const { w: cssW, h: cssH } = viewportPx();

    // Never zoom in past 1:1 — big screens are already showing plenty, and
    // magnifying would make the game easier than it was designed to be.
    ZOOM = clamp(Math.min(cssW / REF_W, cssH / REF_H), MIN_ZOOM, 1);

    W = cssW / ZOOM;
    H = cssH / ZOOM;
    canvas.width = Math.round(cssW * DPR);
    canvas.height = Math.round(cssH * DPR);
    ctx.setTransform(DPR * ZOOM, 0, 0, DPR * ZOOM, 0, 0);
  }

  // Mobile Safari collapses and expands its toolbar without reliably firing a
  // resize event, so reconcile every frame as well. It's two integer compares.
  function reconcileSize() {
    const { w, h } = viewportPx();
    if (canvas.width !== Math.round(w * DPR) || canvas.height !== Math.round(h * DPR)) {
      resize();
    }
  }

  document.body.classList.add('on-title');

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
  resize();

  // ---------- input (lean only + space) ----------
  const keys = { ArrowUp: false, ArrowDown: false };
  window.addEventListener('keydown', (e) => {
    if (e.key in keys) { keys[e.key] = true; e.preventDefault(); return; }
    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      if (state.mode === 'title') startRun();
      else if (state.mode === 'finished' || state.mode === 'dead') resetRun();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key in keys) { keys[e.key] = false; e.preventDefault(); }
  });

  // Touch: left half of the screen leans back (the one you hold most of the
  // time), right half leans forward. Tracked per pointer id so a second finger
  // landing doesn't cancel the first, and so lifting one finger only releases
  // its own side. Mouse pointers are ignored for leaning — otherwise clicking
  // the window to focus it would jerk the bike mid-run.
  const touchLean = new Map();       // pointerId -> -1 (back) or +1 (forward)

  function touchLeanSum() {
    let sum = 0;
    for (const dir of touchLean.values()) sum += dir;
    return clamp(sum, -1, 1);
  }

  // Real fullscreen where the browser allows it. Android Chrome and iPad Safari
  // do; iPhone Safari has never supported the Fullscreen API, which is why the
  // title screen also points at Add to Home Screen. Must run inside a user
  // gesture, so it hangs off the tap that starts the run.
  function tryFullscreen() {
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) return;
    try {
      const p = req.call(el, { navigationUI: 'hide' });
      if (p && p.catch) p.catch(() => { /* refused; the game plays fine anyway */ });
    } catch (_) { /* ditto */ }
  }

  window.addEventListener('pointerdown', (e) => {
    const starting = state.mode === 'title' || state.mode === 'finished'
                  || state.mode === 'dead';
    if (starting && e.pointerType !== 'mouse') tryFullscreen();
    if (state.mode === 'title') { startRun(); e.preventDefault(); return; }
    if (state.mode === 'finished' || state.mode === 'dead') {
      resetRun(); e.preventDefault(); return;
    }
    if (e.pointerType === 'mouse') return;
    touchLean.set(e.pointerId, e.clientX < window.innerWidth / 2 ? -1 : 1);
    // Capture, so this finger keeps reporting to the canvas even if it drifts
    // over the HUD or off the edge. Without it the release event can go to
    // whatever element the finger wandered onto and the lean sticks on.
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* not critical */ }
    e.preventDefault();
  }, { passive: false });

  function releasePointer(e) { touchLean.delete(e.pointerId); }
  window.addEventListener('pointerup', releasePointer);
  window.addEventListener('pointercancel', releasePointer);
  window.addEventListener('lostpointercapture', releasePointer);
  // Backstop: a browser that drops a touch without any release event would
  // otherwise pin the lean on for the rest of the run.
  window.addEventListener('blur', () => touchLean.clear());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) touchLean.clear();
  });

  // ---------- course layout ----------
  // Centre-frame at the start line. The bike shares this world position, so the
  // title screen nudges the bike sideways (START_SHIFT below) to stand clear of
  // the building rather than in front of it.
  const PUB_START_X = 0;
  const BIG_RED_X = 21200;
  const FINISH_DISTANCE = 24000;
  const TOTAL_DUNES = 1200;

  const RIDE_SPEED = 430;          // fixed forward speed (world px/sec)
  const FUEL_START = 78;           // seconds — enough for the run plus ~3 stacks
  const CRASH_FUEL_PENALTY = 5;
  const CRASH_RECOVERY_TIME = 1.4;
  const CELEBRATION_TIME = 6.0;      // seconds of fireworks before the end screen

  // ---------- terrain ----------
  function hash(n) {
    const s = Math.sin(n * 12.9898) * 43758.5453;
    return s - Math.floor(s);
  }

  function baseTerrain(x) {
    return Math.sin(x * 0.00075) * 105 +
           Math.sin(x * 0.0026 + 1.7) * 46 +
           Math.sin(x * 0.0052 + 0.9) * 62 +
           Math.sin(x * 0.011 + 0.4) * 15;
  }

  // flat apron around each pub (and across the start line) so the bike spawns level
  function flatWindow(x, centre, halfWidth, ease) {
    const d = Math.abs(x - centre);
    if (d <= halfWidth) return 1;
    const t = Math.min(1, (d - halfWidth) / ease);
    return 1 - t * t * (3 - 2 * t);
  }

  function padFactor(x) {
    // The start apron is wider than the finish one because Mt Dare sits well to
    // the left of the start line; at the old 460 the ground under its footprint
    // varied 35px and the building looked tilted.
    const a = flatWindow(x, 0, 900, 800);
    const b = flatWindow(x, FINISH_DISTANCE, 460, 800);
    return 1 - 0.94 * Math.max(a, b);
  }

  // Big Red: one enormous dune just before town
  function bigRed(x) {
    const d = (x - BIG_RED_X) / 900;
    return 560 * Math.exp(-d * d);
  }

  function nearTerrain(x) {
    return baseTerrain(x) * padFactor(x) + bigRed(x);
  }

  // A band of country between the far ridge and the dunes you ride on, so
  // something can sit part-way into the distance rather than only near or far.
  function midTerrain(x) {
    return Math.sin(x * 0.0011 + 2.2) * 72 +
           Math.sin(x * 0.0038 + 0.6) * 26;
  }

  function farTerrain(x) {
    return Math.sin(x * 0.0006 + 3.1) * 74 + Math.sin(x * 0.0021) * 26;
  }

  // ---------- day cycle ----------
  // One Simpson crossing = one day. Sunrise as you leave Mt Dare, the sun at its
  // peak by the maccas sign, setting over Big Red, and full dark by Birdsville.
  const NOON_P   = 11680 / FINISH_DISTANCE;   // the maccas sign
  const SUNSET_P = BIG_RED_X / FINISH_DISTANCE;

  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);

  function sampleKeys(keys, p) {
    if (p <= keys[0].p) return keys[0].v.slice();
    for (let i = 1; i < keys.length; i++) {
      if (p <= keys[i].p) {
        const a = keys[i - 1], b = keys[i];
        const t = (p - a.p) / (b.p - a.p);
        return a.v.map((v, j) => lerp(v, b.v[j], t));
      }
    }
    return keys[keys.length - 1].v.slice();
  }

  // Sky is authored as [top, mid, horizon] rgb triples. These are pre-tint
  // values: the world tint below multiplies over the whole frame, so the night
  // entries are deliberately brighter than the final look.
  const SKY_KEYS = [
    { p: 0.00, v: [ 26, 34, 70,   62, 52, 92,  132, 84, 84] },   // pre-dawn, stars out
    { p: 0.04, v: [ 32, 44, 86,  132, 76, 74,  208,128, 94] },   // first light
    { p: 0.075,v: [ 38, 52, 96,  190, 92, 62,  244,170, 96] },   // sunrise
    { p: 0.10, v: [ 44, 96,164,  138,176,214,  244,206,150] },   // early morning
    { p: 0.30, v: [ 47,111,176,  122,169,212,  242,184,120] },   // morning
    { p: 0.49, v: [ 38,120,196,  116,172,220,  214,229,244] },   // midday
    { p: 0.70, v: [ 58,118,176,  158,186,208,  242,196,144] },   // afternoon
    { p: 0.83, v: [110, 92,140,  214,124, 66,  246,180,106] },   // golden hour
    { p: 0.883,v: [ 96, 66,116,  212, 96, 46,  244,160, 84] },   // sunset
    { p: 0.94, v: [ 44, 46, 96,   92, 62,104,  150, 82, 74] },   // dusk
    { p: 1.00, v: [ 42, 58,107,   46, 62,112,   58, 74,124] }    // night
  ];

  // Multiplied over the finished frame, so the whole scene shares one light.
  const TINT_KEYS = [
    { p: 0.00, v: [ 92, 102, 148] },   // pre-dawn
    { p: 0.04, v: [178, 152, 156] },
    { p: 0.075,v: [255, 186, 146] },
    { p: 0.12, v: [255, 232, 210] },
    { p: 0.40, v: [255, 252, 248] },
    { p: 0.55, v: [255, 255, 255] },
    { p: 0.74, v: [255, 236, 208] },
    { p: 0.86, v: [255, 178, 126] },
    { p: 0.90, v: [226, 140, 110] },
    { p: 0.95, v: [120, 106, 140] },
    { p: 1.00, v: [ 62,  74, 122] }
  ];

  function dayCycle() {
    const p = clamp(state.cameraX / FINISH_DISTANCE, 0, 1);

    // sun climbs to the maccas sign, then falls to the horizon at Big Red
    let sunAlt;
    // starts a touch below the horizon: the run opens pre-dawn with the stars
    // still out, and the sun breaks the horizon a few seconds in
    if (p <= NOON_P) sunAlt = -0.06 + 1.06 * smooth(p / NOON_P);
    else if (p <= SUNSET_P) sunAlt = 1 - smooth((p - NOON_P) / (SUNSET_P - NOON_P));
    else sunAlt = -0.4 * smooth((p - SUNSET_P) / (1 - SUNSET_P));

    // heading east, so the sun comes up ahead of you and sets away behind
    const sunXf = lerp(0.86, 0.14, Math.min(p / SUNSET_P, 1.1));

    const night = clamp((p - 0.86) / 0.12, 0, 1);
    const dawn = clamp((0.075 - p) / 0.075, 0, 1);   // fades as the sun comes up
    const starGlow = Math.max(night, dawn);
    const moonAlt = 0.18 + 0.45 * night;

    return {
      p,
      sunAlt,
      sunXf,
      night,
      dawn,
      starGlow,
      moonAlt,
      sky: sampleKeys(SKY_KEYS, p),
      tint: sampleKeys(TINT_KEYS, p)
    };
  }

  // stars, fixed in the sky and gently twinkling
  const STARS = [];
  (function seedStars() {
    for (let i = 0; i < 110; i++) {
      STARS.push({
        xf: hash(i * 1.7 + 0.3),
        yf: hash(i * 3.9 + 1.1) * 0.62,
        r: 0.6 + hash(i * 5.3) * 1.5,
        phase: hash(i * 7.1) * Math.PI * 2,
        rate: 1.2 + hash(i * 2.9) * 2.2
      });
    }
  })();

  // ---------- background critters ----------
  const roos = [];
  const emus = [];
  (function seedCritters() {
    let x = 400;
    for (let i = 0; i < 60; i++) {
      x += 520 + hash(i * 3.1) * 900;
      roos.push({
        worldX: x,
        phase: hash(i * 5.7) * Math.PI * 2,
        rate: 4.5 + hash(i * 2.3) * 2.5,
        scale: 0.75 + hash(i * 9.1) * 0.6,
        hop: 18 + hash(i * 1.9) * 12
      });
    }
    let ex = 900;
    for (let i = 0; i < 45; i++) {
      ex += 700 + hash(i * 7.7 + 2) * 1100;
      emus.push({
        worldX: ex,
        phase: hash(i * 4.3 + 5) * Math.PI * 2,
        rate: 7 + hash(i * 6.1) * 3,
        scale: 0.8 + hash(i * 3.7) * 0.5
      });
    }
  })();

  function drawKangaroo(x, groundY, hopT, scale) {
    ctx.save();
    ctx.translate(x, groundY);
    ctx.scale(scale, scale);
    ctx.fillStyle = 'rgba(58,33,18,0.6)';
    ctx.rotate(-0.25 - hopT * 0.15);

    ctx.beginPath();                                  // tail
    ctx.moveTo(-8, -6);
    ctx.quadraticCurveTo(-26, 2, -30, 20 - hopT * 8);
    ctx.quadraticCurveTo(-24, 18 - hopT * 8, -14, -2);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();                                  // body
    ctx.ellipse(2, -10, 16, 11, -0.15, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();                                  // head
    ctx.ellipse(20, -20, 7, 5, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();                                  // ears
    ctx.moveTo(22, -25); ctx.lineTo(24, -34); ctx.lineTo(27, -25);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(17, -25); ctx.lineTo(17, -33); ctx.lineTo(21, -25);
    ctx.closePath(); ctx.fill();

    ctx.beginPath();                                  // forepaws
    ctx.moveTo(14, -12); ctx.lineTo(18, -2); ctx.lineTo(15, -1); ctx.lineTo(11, -10);
    ctx.closePath(); ctx.fill();

    const ext = 1 - hopT;                             // hind legs
    ctx.beginPath();
    ctx.moveTo(-6, -4);
    ctx.lineTo(-10, 6 + ext * 10);
    ctx.lineTo(2, 8 + ext * 12);
    ctx.lineTo(6, -2);
    ctx.closePath(); ctx.fill();

    ctx.restore();
  }

  function drawEmu(x, groundY, t, scale) {
    ctx.save();
    ctx.translate(x, groundY);
    ctx.scale(scale, scale);
    const body = 'rgba(52,38,26,0.6)';
    const stride = Math.sin(t);
    const stride2 = Math.sin(t + Math.PI);

    // legs (long, scissoring as it runs)
    ctx.strokeStyle = body;
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.lineTo(stride * 7, -8);
    ctx.lineTo(stride * 10, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.lineTo(stride2 * 7, -8);
    ctx.lineTo(stride2 * 10, 0);
    ctx.stroke();

    // shaggy body
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(-1, -23, 13, 10, -0.1, 0, Math.PI * 2);
    ctx.fill();
    // tail fluff
    ctx.beginPath();
    ctx.ellipse(-12, -22, 6, 7, 0.3, 0, Math.PI * 2);
    ctx.fill();

    // long neck + small head
    ctx.strokeStyle = body;
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.moveTo(8, -27);
    ctx.quadraticCurveTo(15, -38, 13, -48);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(13, -51, 4, 3.4, 0.2, 0, Math.PI * 2);
    ctx.fill();
    // beak
    ctx.beginPath();
    ctx.moveTo(16, -51); ctx.lineTo(22, -50); ctx.lineTo(16, -49);
    ctx.closePath(); ctx.fill();

    ctx.restore();
  }

  // ---------- bike sprite ----------
  // Geometry measured from assets/bike.png by assets/prep.py: the tyre contact
  // points, plus each wheel circle (whose interior prep.py punched out so we can
  // draw a spinning rim/spokes underneath and let it show through the tyre).
  const SPRITE = {
    w: 1215, h: 856,
    floorY: 855, rearX: 196, frontX: 1015, wheelbase: 819,
    wheels: [ { cx: 196, cy: 666, r: 189 }, { cx: 1015, cy: 661, r: 194 } ]
  };
  const BIKE_WHEELBASE = 152;                       // on-screen px between contacts
  const SPRITE_SCALE = BIKE_WHEELBASE / SPRITE.wheelbase;
  const HALF_WHEELBASE = BIKE_WHEELBASE / 2;
  const SPRITE_MID_X = (SPRITE.rearX + SPRITE.frontX) / 2;
  const WHEEL_WORLD_R = SPRITE.wheels[0].r * SPRITE_SCALE;   // for rolling speed
  // True rolling: the contact patch must travel at ground speed or the tyres
  // look like they are dragging. With only 9 knobs this still reads as forward
  // rotation (29% of a knob spacing per frame), so no cheat is needed.
  const SPIN_READABILITY = 1.0;

  const bikeImg = new Image();
  let bikeReady = false;
  bikeImg.onload = () => { bikeReady = true; };
  bikeImg.src = 'assets/bike.png';

  let wheelSpin = 0;

  // ---------- sand thrown off the back wheel ----------
  const dust = [];
  const DUST_MAX = 90;

  function spawnDust(worldX, worldY, strength) {
    if (dust.length >= DUST_MAX) return;
    dust.push({
      wx: worldX + (Math.random() - 0.5) * 10,
      wy: worldY + (Math.random() - 0.5) * 4,
      vx: -30 - Math.random() * 70 * strength,
      vy: 20 + Math.random() * 60 * strength,
      life: 0,
      maxLife: 0.45 + Math.random() * 0.5,
      size: 2.5 + Math.random() * 4.5 * strength
    });
  }

  function updateDust(dt) {
    for (let i = dust.length - 1; i >= 0; i--) {
      const p = dust[i];
      p.life += dt;
      if (p.life >= p.maxLife) { dust.splice(i, 1); continue; }
      p.wx += p.vx * dt;
      p.wy += p.vy * dt;
      p.vy -= 45 * dt;          // settles back down
      p.vx *= 1 - 1.4 * dt;
    }
  }

  function drawDust(screenYOf) {
    for (const p of dust) {
      const t = p.life / p.maxLife;
      const sx = (p.wx - state.cameraX) + W * BIKE_SCREEN_FRAC;
      const sy = screenYOf(p.wy);
      ctx.beginPath();
      ctx.arc(sx, sy, p.size * (1 + t * 1.6), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(198,116,64,${0.55 * (1 - t)})`;
      ctx.fill();
    }
  }

  // The whole wheel is drawn here, tyre included, because prep.py punches the
  // wheels out of the photo entirely.
  //
  // Readability, not physics, drives the numbers below. At the true rolling rate
  // (1.95 rev/s) a wheel of 22 knobs advances 72% of one knob-spacing per frame,
  // which the eye reads as stationary or running backwards — the wagon-wheel
  // effect. Few chunky features plus a slightly slowed visual rate keep the
  // per-frame step under a third of each repeat, so it reads as spinning.
  const KNOBS = 9;
  const SPOKES = 8;
  // Radial thickness of the rubber, as a fraction of wheel radius. The rim is
  // sized off this, so lowering it fattens the tyre and raising it slims it.
  const TYRE_INNER = 0.80;          // rubber spans TYRE_INNER*r .. r

  function drawSpinningWheel(wh, spin) {
    const r = wh.r;
    ctx.save();
    ctx.translate(wh.cx, wh.cy);
    ctx.rotate(spin);

    // ---- tyre carcass ----
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = '#181713';
    ctx.fill();

    // ---- chunky knobs: the main rotation cue ----
    const knobInner = r * (TYRE_INNER + 0.06);
    for (let i = 0; i < KNOBS; i++) {
      const a = (i / KNOBS) * Math.PI * 2;
      const half = 0.16;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a - half) * knobInner, Math.sin(a - half) * knobInner);
      ctx.lineTo(Math.cos(a - half * 0.6) * r, Math.sin(a - half * 0.6) * r);
      ctx.lineTo(Math.cos(a + half * 0.6) * r, Math.sin(a + half * 0.6) * r);
      ctx.lineTo(Math.cos(a + half) * knobInner, Math.sin(a + half) * knobInner);
      ctx.closePath();
      ctx.fillStyle = '#454138';
      ctx.fill();
    }

    // dark tread valley so the knobs stand off the carcass
    ctx.beginPath();
    ctx.arc(0, 0, r * (TYRE_INNER + 0.03), 0, Math.PI * 2);
    ctx.strokeStyle = '#0d0c0a';
    ctx.lineWidth = r * 0.05;
    ctx.stroke();

    // ---- gold rim, sitting right up against the rubber ----
    const rimWidth = 0.075;
    const rimMid = TYRE_INNER - rimWidth / 2;
    ctx.beginPath();
    ctx.arc(0, 0, r * rimMid, 0, Math.PI * 2);
    ctx.strokeStyle = '#c8a24c';
    ctx.lineWidth = r * rimWidth;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r * (rimMid + 0.024), 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(248,232,182,0.8)';
    ctx.lineWidth = r * 0.018;
    ctx.stroke();

    // ---- bold spokes, one accent ----
    const spokeOuter = rimMid - rimWidth / 2;
    for (let i = 0; i < SPOKES; i++) {
      const a = (i / SPOKES) * Math.PI * 2;
      ctx.strokeStyle = i === 0 ? '#4a3a1e' : '#d8c79a';
      ctx.lineWidth = i === 0 ? r * 0.062 : r * 0.034;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.16, Math.sin(a) * r * 0.16);
      ctx.lineTo(Math.cos(a) * r * spokeOuter, Math.sin(a) * r * spokeOuter);
      ctx.stroke();
    }

    // ---- valve stem ----
    ctx.save();
    ctx.rotate(0.75);
    ctx.fillStyle = '#0f0e0c';
    ctx.beginPath();
    ctx.roundRect(r * (rimMid - 0.16), -r * 0.05, r * 0.20, r * 0.10, r * 0.03);
    ctx.fill();
    ctx.restore();

    // ---- clumps of red dirt, big enough to actually see ----
    ctx.fillStyle = '#94481f';
    for (const [a, rad, size] of [[2.1, 0.46, 0.10], [4.4, 0.58, 0.085]]) {
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r * rad, Math.sin(a) * r * rad, r * size, 0, Math.PI * 2);
      ctx.fill();
    }

    // ---- hub ----
    const hub = ctx.createRadialGradient(-r * 0.03, -r * 0.03, r * 0.02, 0, 0, r * 0.18);
    hub.addColorStop(0, '#9b9ea3');
    hub.addColorStop(1, '#2b2c2f');
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.18, 0, Math.PI * 2);
    ctx.fillStyle = hub;
    ctx.fill();
    ctx.fillStyle = '#131417';
    ctx.beginPath();
    ctx.arc(r * 0.075, -r * 0.055, r * 0.055, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // A bike rotated past vertical would drive its bars and luggage down through
  // the sand if we kept pinning the tyre to the ground, so work out how far its
  // lowest point now hangs below the pivot and lift it clear. This uses the
  // silhouette's convex hull (measured by prep.py) rather than the image bounding
  // box, whose corners are transparent and would lift the bike into the air.
  const SPRITE_HULL = [[0,261],[45,142],[52,127],[60,115],[69,108],[694,0],[707,0],[1086,367],[1108,392],[1114,399],[1119,406],[1122,411],[1202,587],[1209,619],[1214,650],[1214,656],[1209,706],[1203,725],[1189,763],[1177,782],[1158,804],[1145,816],[1114,836],[1078,849],[1042,855],[171,855],[137,849],[117,842],[104,836],[81,823],[58,804],[52,798],[38,781],[25,757],[22,750],[14,731],[7,706],[0,291]];
  const CRASH_BED_IN = 10;            // sprite px it settles into the sand

  function restLift(angle, contactX) {
    const sin = Math.sin(angle), cos = Math.cos(angle);
    let maxY = -Infinity;
    for (const [hx, hy] of SPRITE_HULL) {
      const ry = (hx - contactX) * sin + (hy - SPRITE.floorY) * cos;
      if (ry > maxY) maxY = ry;
    }
    return Math.max(0, (maxY - CRASH_BED_IN) * SPRITE_SCALE);
  }

  // contactX: which point of the sprite is pinned to (pivotScreenX, pivotScreenY)
  let bikeXform = null;

  function drawBike(pivotScreenX, pivotScreenY, angle, contactX) {
    if (!bikeReady) return;
    bikeXform = { px: pivotScreenX, py: pivotScreenY, angle, contactX };
    ctx.save();
    ctx.translate(pivotScreenX, pivotScreenY);
    ctx.rotate(angle);
    ctx.scale(SPRITE_SCALE, SPRITE_SCALE);
    ctx.translate(-contactX, -SPRITE.floorY);
    for (const wh of SPRITE.wheels) drawSpinningWheel(wh, wheelSpin);
    // Explicit destination size, in sprite coordinates. Drawing at the image's
    // natural size would tie the geometry below to whatever resolution bike.png
    // happens to be stored at, so shipping a downscaled sprite would shrink the
    // body while the procedural wheels stayed put.
    ctx.drawImage(bikeImg, 0, 0, SPRITE.w, SPRITE.h);
    ctx.restore();
  }

  // A flat-bottomed sprite straddling a dune face looks tilted and floats at one
  // end. This finds the most level patch near a target position so such a sprite
  // can sit squarely on the sand — and it re-derives itself if the terrain is
  // ever retuned, rather than relying on a hand-picked number.
  function flattestNear(targetX, radius, footprintW) {
    const half = footprintW / 2;
    let best = targetX, bestScore = Infinity;
    for (let x = targetX - radius; x <= targetX + radius; x += 10) {
      let lo = Infinity, hi = -Infinity;
      for (let s = -half; s <= half; s += 6) {
        const e = nearTerrain(x + s);
        if (e < lo) lo = e;
        if (e > hi) hi = e;
      }
      const tilt = Math.abs(nearTerrain(x + half) - nearTerrain(x - half));
      const score = (hi - lo) + tilt * 1.5 + Math.abs(x - targetX) / 900;
      if (score < bestScore) { bestScore = score; best = x; }
    }
    return best;
  }

  // ---------- headlight and tail light ----------
  // Lamp positions measured in sprite space: the headlight on the front number
  // board, the tail light under the rear rack. Drawn after the day tint so they
  // add light to the scene rather than being darkened along with it.
  const LAMP_POS = { x: 880, y: 258 };
  const TAIL_POS = { x: 150, y: 402 };

  function spriteToScreen(sx, sy, xf) {
    const cos = Math.cos(xf.angle), sin = Math.sin(xf.angle);
    const lx = (sx - xf.contactX) * SPRITE_SCALE;
    const ly = (sy - SPRITE.floorY) * SPRITE_SCALE;
    return [xf.px + lx * cos - ly * sin, xf.py + lx * sin + ly * cos];
  }

  function drawBikeLights(cyc, t) {
    // come on as the sun drops, full once it is down
    const lvl = clamp((0.20 - cyc.sunAlt) / 0.32, 0, 1);
    if (lvl < 0.02 || !bikeXform || !bikeReady) return;
    const xf = bikeXform;
    const [hx, hy] = spriteToScreen(LAMP_POS.x, LAMP_POS.y, xf);
    const [tx, ty] = spriteToScreen(TAIL_POS.x, TAIL_POS.y, xf);
    const cos = Math.cos(xf.angle), sin = Math.sin(xf.angle);
    const flick = 0.94 + 0.06 * Math.sin(t * 21);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // beam thrown forward along the bike
    const len = 360 * lvl, half = 0.19;
    const dirA = xf.angle - half, dirB = xf.angle + half;
    const beam = ctx.createLinearGradient(hx, hy, hx + cos * len, hy + sin * len);
    beam.addColorStop(0,    `rgba(255,238,190,${0.34 * lvl * flick})`);
    beam.addColorStop(0.45, `rgba(255,226,160,${0.14 * lvl * flick})`);
    beam.addColorStop(1,    'rgba(255,214,140,0)');
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx + Math.cos(dirA) * len, hy + Math.sin(dirA) * len);
    ctx.lineTo(hx + Math.cos(dirB) * len, hy + Math.sin(dirB) * len);
    ctx.closePath();
    ctx.fill();

    // the lamp itself
    const lampR = 26 * lvl;
    const lamp = ctx.createRadialGradient(hx, hy, 0, hx, hy, lampR);
    lamp.addColorStop(0, `rgba(255,248,220,${0.95 * lvl * flick})`);
    lamp.addColorStop(0.35, `rgba(255,232,170,${0.5 * lvl})`);
    lamp.addColorStop(1, 'rgba(255,220,150,0)');
    ctx.fillStyle = lamp;
    ctx.beginPath();
    ctx.arc(hx, hy, lampR, 0, Math.PI * 2);
    ctx.fill();

    // tail light
    const tailR = 17 * lvl;
    const tail = ctx.createRadialGradient(tx, ty, 0, tx, ty, tailR);
    tail.addColorStop(0, `rgba(255,70,50,${0.9 * lvl})`);
    tail.addColorStop(0.4, `rgba(220,40,30,${0.45 * lvl})`);
    tail.addColorStop(1, 'rgba(180,20,20,0)');
    ctx.fillStyle = tail;
    ctx.beginPath();
    ctx.arc(tx, ty, tailR, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // ---------- the camel ----------
  // Feral dromedaries are all over the Simpson, so one stands on the near ground
  // three quarters of the way across, chewing and watching you go by.
  const CAMEL_X = FINISH_DISTANCE * 0.75;
  const CAMEL_H = 112;   // smaller, since it now stands part-way into the distance

  function drawCamel(t) {
    // sits on the mid band: it drifts past slower than the dunes you ride, and
    // the near dunes pass in front of it, which is what puts it into the distance
    const u = CAMEL_X * MID_PARALLAX;                       // its spot in the mid frame
    const sx = (CAMEL_X - state.cameraX) * MID_PARALLAX + W * BIKE_SCREEN_FRAC;
    if (sx < -220 || sx > W + 220) return;
    const groundY = midGroundY(u);
    const s = CAMEL_H / 100;                 // sprite is authored 100 units tall

    const sway = Math.sin(t * 0.7) * 0.05;   // slow head sway
    const chew = Math.sin(t * 6) * 0.6;      // jaw working
    const tail = Math.sin(t * 1.9) * 0.22;

    ctx.save();
    ctx.translate(sx, groundY);
    ctx.scale(s, s);

    // contact shadow
    ctx.save();
    ctx.filter = 'blur(2px)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 34, 4, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(24,10,4,0.3)';
    ctx.fill();
    ctx.restore();

    const hide = '#b3854f';
    const hideDark = '#8d6539';
    const hideLight = '#c99b62';

    // --- far legs first, a touch darker ---
    ctx.strokeStyle = hideDark;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-14, -44); ctx.lineTo(-19, -24); ctx.lineTo(-16, -1);
    ctx.moveTo(16, -46);  ctx.lineTo(20, -25);  ctx.lineTo(17, -1);
    ctx.stroke();

    // --- tail ---
    ctx.strokeStyle = hideDark;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(-26, -50);
    ctx.quadraticCurveTo(-33 + tail * 8, -40, -31 + tail * 12, -28);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(-31 + tail * 12, -26, 2.6, 4, tail, 0, Math.PI * 2);
    ctx.fillStyle = '#5d4326';
    ctx.fill();

    // --- body ---
    const body = ctx.createLinearGradient(0, -70, 0, -38);
    body.addColorStop(0, hideLight);
    body.addColorStop(1, hide);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(-26, -50);
    ctx.quadraticCurveTo(-24, -62, -8, -64);
    ctx.quadraticCurveTo(-2, -82, 8, -64);          // the hump
    ctx.quadraticCurveTo(22, -62, 26, -52);
    ctx.quadraticCurveTo(24, -40, 8, -38);
    ctx.quadraticCurveTo(-14, -37, -26, -50);
    ctx.closePath();
    ctx.fill();

    // shaggy shoulder tuft
    ctx.fillStyle = hideLight;
    ctx.beginPath();
    ctx.ellipse(18, -54, 7, 9, 0.3, 0, Math.PI * 2);
    ctx.fill();

    // --- near legs ---
    ctx.strokeStyle = hide;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(-10, -42); ctx.lineTo(-14, -22); ctx.lineTo(-11, -1);
    ctx.moveTo(20, -44);  ctx.lineTo(25, -24);  ctx.lineTo(22, -1);
    ctx.stroke();
    // knees
    ctx.fillStyle = hideDark;
    ctx.beginPath();
    ctx.arc(-14, -22, 3.4, 0, Math.PI * 2);
    ctx.arc(25, -24, 3.4, 0, Math.PI * 2);
    ctx.fill();
    // splayed feet
    ctx.fillStyle = '#6f5130';
    ctx.beginPath();
    ctx.ellipse(-11, -1, 5.5, 2.4, 0, 0, Math.PI * 2);
    ctx.ellipse(22, -1, 5.5, 2.4, 0, 0, Math.PI * 2);
    ctx.ellipse(-16, -1, 4.5, 2, 0, 0, Math.PI * 2);
    ctx.ellipse(17, -1, 4.5, 2, 0, 0, Math.PI * 2);
    ctx.fill();

    // --- neck and head ---
    ctx.save();
    ctx.translate(24, -60);
    ctx.rotate(sway);
    ctx.strokeStyle = hide;
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(12, -14, 14, -30);
    ctx.stroke();
    // head
    ctx.fillStyle = hideLight;
    ctx.beginPath();
    ctx.ellipse(15, -33, 8, 5.5, -0.35, 0, Math.PI * 2);
    ctx.fill();
    // muzzle, working as it chews
    ctx.beginPath();
    ctx.ellipse(21, -30 + chew * 0.4, 4.5, 3.2 + chew * 0.2, -0.2, 0, Math.PI * 2);
    ctx.fillStyle = hide;
    ctx.fill();
    // eye and ear
    ctx.fillStyle = '#2b1d10';
    ctx.beginPath();
    ctx.arc(15, -35, 1.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = hideDark;
    ctx.beginPath();
    ctx.moveTo(9, -37); ctx.lineTo(7, -42); ctx.lineTo(12, -38);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }

  // ---------- wedge-tailed eagle ----------
  // Soars past about a quarter of the way across, on its own slow parallax so it
  // reads as high up rather than nearby.
  const EAGLE_X = FINISH_DISTANCE * 0.25;
  const EAGLE_PARALLAX = 0.45;
  const EAGLE_H = 150;            // on-screen wingspan height

  function drawEagle(t) {
    const lm = LANDMARKS.eagle;
    if (!lm || !lm.ready || !lm.img.naturalHeight) return;
    const sx = (EAGLE_X - state.cameraX) * EAGLE_PARALLAX + W * BIKE_SCREEN_FRAC;
    const h = EAGLE_H, w = lm.img.naturalWidth * (h / lm.img.naturalHeight);
    if (sx + w < -80 || sx - w > W + 80) return;

    // long lazy circle, banking slightly as it comes round
    const drift = Math.sin(t * 0.19) * 90;
    const rise = Math.sin(t * 0.27 + 1.1) * 30;
    const bank = Math.sin(t * 0.19 + Math.PI / 2) * 0.13;

    ctx.save();
    ctx.translate(sx + drift, H * 0.22 + rise);
    ctx.rotate(bank);
    ctx.drawImage(lm.img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  // Sand heaped around the Tiger's wheels. The sprite is a clean studio shot with
  // no dirt of its own, so without this it reads as parked rather than bogged.
  // The mound's underside traces the terrain exactly so it blends into the sand
  // instead of sitting on it as a slab.
  function drawBogSand(screenYOf, front) {
    const sx = (BOG_TIGER_X - state.cameraX) + W * BIKE_SCREEN_FRAC;
    if (sx < -300 || sx > W + 300) return;
    const gy = (dx) => screenYOf(nearTerrain(BOG_TIGER_X + dx));

    // bell-shaped heap, taller at the wheels
    const span = 104;
    const profile = (dx) => {
      const a = Math.exp(-Math.pow((dx + 44) / 34, 2));   // rear wheel
      const b = Math.exp(-Math.pow((dx - 40) / 32, 2));   // front wheel
      const base = Math.exp(-Math.pow(dx / 82, 2)) * 0.45;
      return (Math.max(a, b) + base) * (front ? 26 : 15);
    };

    ctx.save();
    ctx.fillStyle = front ? '#b8622c' : '#a05122';
    ctx.beginPath();
    for (let dx = -span; dx <= span; dx += 6) {
      const y = gy(dx) - profile(dx) + (front ? 6 : 2);
      if (dx === -span) ctx.moveTo(sx + dx, y); else ctx.lineTo(sx + dx, y);
    }
    for (let dx = span; dx >= -span; dx -= 6) ctx.lineTo(sx + dx, gy(dx) + 3);
    ctx.closePath();
    ctx.fill();

    if (front) {
      // clods flung out either side
      ctx.fillStyle = 'rgba(150,74,32,0.85)';
      for (const [dx, dy, r] of [[-124, 1, 5], [-112, 4, 3.5], [118, 2, 4.5], [132, 5, 3]]) {
        ctx.beginPath();
        ctx.ellipse(sx + dx, gy(dx) + dy, r, r * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // a rut where it has dug itself in
      ctx.strokeStyle = 'rgba(120,56,22,0.5)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let dx = -96; dx <= 96; dx += 8) {
        const y = gy(dx) + 5;
        if (dx === -96) ctx.moveTo(sx + dx, y); else ctx.lineTo(sx + dx, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- fireworks over the pub ----------
  // World coordinates, so they sit over the pub rather than the screen. Drawn
  // additively after the day tint, like the campfire, so they actually glow.
  const fw = { rockets: [], sparks: [], flashes: [] };
  const FW_COLOURS = [
    [255, 214, 96], [255, 128, 72], [120, 214, 255],
    [190, 130, 255], [255, 96, 140], [150, 255, 160]
  ];

  // Where the pub's roofline lands on screen, refreshed each draw. Rockets need
  // it at launch so the burst lands inside the frame instead of clipping off
  // the top of a short window.
  let fwGroundY = 0;

  function launchRocket() {
    const groundY = fwGroundY || H * 0.58;
    const room = Math.max(110, groundY - 120 - H * 0.13);
    const apex = room * (0.78 + Math.random() * 0.34);
    const fuse = 0.85 + Math.random() * 0.5;
    fw.rockets.push({
      wx: FINISH_DISTANCE + (Math.random() - 0.5) * 420,
      wy: 0,
      vy: (apex + 60 * fuse * fuse) / fuse,
      vx: (Math.random() - 0.5) * 40,
      fuse,
      colour: FW_COLOURS[(Math.random() * FW_COLOURS.length) | 0]
    });
  }

  function burst(r) {
    const n = 34 + ((Math.random() * 16) | 0);
    const power = 130 + Math.random() * 90;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.2;
      const sp = power * (0.55 + Math.random() * 0.45);
      fw.sparks.push({
        wx: r.wx, wy: r.wy,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0, maxLife: 1.1 + Math.random() * 0.9,
        colour: r.colour
      });
    }
    fw.flashes.push({ wx: r.wx, wy: r.wy, life: 0, maxLife: 0.28, colour: r.colour });
  }

  function updateFireworks(dt) {
    for (let i = fw.rockets.length - 1; i >= 0; i--) {
      const r = fw.rockets[i];
      r.fuse -= dt;
      r.wy += r.vy * dt;
      r.wx += r.vx * dt;
      r.vy -= 120 * dt;
      if (r.fuse <= 0) { burst(r); fw.rockets.splice(i, 1); }
    }
    for (let i = fw.sparks.length - 1; i >= 0; i--) {
      const p = fw.sparks[i];
      p.life += dt;
      if (p.life >= p.maxLife) { fw.sparks.splice(i, 1); continue; }
      p.wx += p.vx * dt;
      p.wy += p.vy * dt;
      p.vy -= 150 * dt;
      p.vx *= 1 - 1.1 * dt;
      p.vy *= 1 - 1.1 * dt;
    }
    for (let i = fw.flashes.length - 1; i >= 0; i--) {
      fw.flashes[i].life += dt;
      if (fw.flashes[i].life >= fw.flashes[i].maxLife) fw.flashes.splice(i, 1);
    }
  }

  function drawFireworks(screenYOf) {
    if (!fw.rockets.length && !fw.sparks.length && !fw.flashes.length) return;
    const groundY = screenYOf(nearTerrain(FINISH_DISTANCE));
    fwGroundY = groundY;
    const toScreen = (wx, wy) => [
      (wx - state.cameraX) + W * BIKE_SCREEN_FRAC,
      groundY - 120 - wy
    ];

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (const f of fw.flashes) {
      const k = 1 - f.life / f.maxLife;
      const [x, y] = toScreen(f.wx, f.wy);
      const r = 120 * (1 - k * 0.5);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${f.colour[0]},${f.colour[1]},${f.colour[2]},${0.5 * k})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }

    for (const r of fw.rockets) {
      const [x, y] = toScreen(r.wx, r.wy);
      ctx.fillStyle = 'rgba(255,232,180,0.95)';
      ctx.beginPath();
      ctx.arc(x, y, 2.6, 0, Math.PI * 2);
      ctx.fill();
      const [x2, y2] = toScreen(r.wx - r.vx * 0.08, r.wy - r.vy * 0.08);
      ctx.strokeStyle = 'rgba(255,200,120,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    for (const p of fw.sparks) {
      const k = 1 - p.life / p.maxLife;
      const [x, y] = toScreen(p.wx, p.wy);
      ctx.fillStyle = `rgba(${p.colour[0]},${p.colour[1]},${p.colour[2]},${k * 0.95})`;
      ctx.beginPath();
      ctx.arc(x, y, 1.4 + k * 1.9, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  // ---------- camp outside the Birdsville pub ----------
  const CAMP_X = FINISH_DISTANCE - 620;

  function drawTent(x, groundY, w, h, canvas1, canvas2) {
    // simple A-frame, guy rope and a dark doorway
    ctx.beginPath();
    ctx.moveTo(x - w / 2, groundY);
    ctx.lineTo(x, groundY - h);
    ctx.lineTo(x + w / 2, groundY);
    ctx.closePath();
    ctx.fillStyle = canvas1;
    ctx.fill();
    // shaded right face
    ctx.beginPath();
    ctx.moveTo(x, groundY - h);
    ctx.lineTo(x + w / 2, groundY);
    ctx.lineTo(x + w * 0.16, groundY);
    ctx.closePath();
    ctx.fillStyle = canvas2;
    ctx.fill();
    // doorway
    ctx.beginPath();
    ctx.moveTo(x - w * 0.12, groundY);
    ctx.lineTo(x - w * 0.02, groundY - h * 0.62);
    ctx.lineTo(x + w * 0.08, groundY);
    ctx.closePath();
    ctx.fillStyle = 'rgba(28,22,16,0.85)';
    ctx.fill();
    // ridge pole and peg lines
    ctx.strokeStyle = 'rgba(40,32,22,0.65)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, groundY - h);
    ctx.lineTo(x + w * 0.62, groundY);
    ctx.moveTo(x, groundY - h);
    ctx.lineTo(x - w * 0.62, groundY);
    ctx.stroke();
  }

  function drawCamp(screenYOf, t) {
    const sx = (CAMP_X - state.cameraX) + W * BIKE_SCREEN_FRAC;
    if (sx < -320 || sx > W + 320) return;
    const gy = (dx) => screenYOf(nearTerrain(CAMP_X + dx));

    drawTent(sx - 74, gy(-74), 78, 52, '#cbb78d', '#a4906a');
    drawTent(sx + 26, gy(26), 62, 42, '#c2a882', '#9a8460');

    // a couple of swags by the fire
    ctx.fillStyle = '#7a6a4c';
    ctx.beginPath();
    ctx.ellipse(sx - 18, gy(-18) - 5, 15, 5.5, -0.05, 0, Math.PI * 2);
    ctx.fill();

    // fire ring
    const fx = sx + 96, fy = gy(96);
    ctx.fillStyle = '#6b5a44';
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(fx + Math.cos(a) * 17, fy + Math.sin(a) * 5, 4.5, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // logs
    ctx.strokeStyle = '#4e3a25';
    ctx.lineWidth = 4.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(fx - 11, fy - 2); ctx.lineTo(fx + 9, fy - 7);
    ctx.moveTo(fx - 9, fy - 7);  ctx.lineTo(fx + 11, fy - 2);
    ctx.stroke();

    // flames — three tongues, each on its own flicker
    for (let i = 0; i < 3; i++) {
      const ph = i * 2.1;
      const flick = 0.72 + 0.28 * Math.sin(t * (7 + i * 1.7) + ph);
      const hgt = (20 + i * 5) * flick;
      const off = (i - 1) * 5;
      ctx.beginPath();
      ctx.moveTo(fx + off - 5, fy - 4);
      ctx.quadraticCurveTo(fx + off - 4, fy - hgt * 0.6, fx + off, fy - hgt);
      ctx.quadraticCurveTo(fx + off + 4, fy - hgt * 0.6, fx + off + 5, fy - 4);
      ctx.closePath();
      ctx.fillStyle = i === 1 ? 'rgba(255,214,96,0.95)' : 'rgba(232,124,38,0.9)';
      ctx.fill();
    }
    // embers
    ctx.fillStyle = 'rgba(255,168,64,0.9)';
    for (let i = 0; i < 4; i++) {
      const rise = ((t * 34 + i * 26) % 52);
      ctx.globalAlpha = Math.max(0, 1 - rise / 52) * 0.8;
      ctx.beginPath();
      ctx.arc(fx + Math.sin(t * 2 + i) * 7, fy - 10 - rise, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Drawn after the day tint so the fire actually lights the camp rather than
  // being darkened along with everything else.
  function drawCampGlow(screenYOf, t, cyc) {
    if (cyc.night < 0.04) return;
    const sx = (CAMP_X - state.cameraX) + W * BIKE_SCREEN_FRAC;
    if (sx < -320 || sx > W + 320) return;
    const fx = sx + 96, fy = screenYOf(nearTerrain(CAMP_X + 96));
    const flick = 0.86 + 0.14 * Math.sin(t * 9.3);
    const r = 150 * flick;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(fx, fy - 12, 4, fx, fy - 12, r);
    glow.addColorStop(0, `rgba(255,168,72,${0.5 * cyc.night * flick})`);
    glow.addColorStop(0.5, `rgba(226,116,40,${0.16 * cyc.night})`);
    glow.addColorStop(1, 'rgba(180,80,20,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(fx - r, fy - 12 - r, r * 2, r * 2);
    ctx.restore();
  }

  // ---------- landmark sprites ----------
  // Drop PNGs into assets/ with these names and they replace the drawn versions
  // automatically. Anchoring convention: the bottom edge of the image is ground
  // level and the image is centred horizontally on the landmark's position, so
  // trim any empty space from the bottom of your file.
  // h: on-screen height in px (width follows each sprite's own aspect ratio).
  // bed: fraction of that height to sink into the sand. The pub and the bogged
  // bike are drawn in 3/4 view, so only their nearest corner reaches the bottom
  // of the image. Measure the drop at the OUTERMOST columns, not an inset margin:
  // Birdsville's extreme deck corners sit 13.0% of its height above its lowest
  // point (its 15% margin is only 8.7%, which is what left the corners floating).
  const LANDMARK_SIZE = {
    mtDare:     { h: 250, bed: 0 },
    birdsville: { h: 250, bed: 0.13 },
    bigRed:     { h: 200, bed: 0 },
    parkSign:   { h: 180, bed: 0 },
    stuckBike:  { h: 130, bed: 0.06, align: true },
    maccasSign: { h: 300, bed: 0.03 },
    bogTiger:   { h: 150, bed: 0.17, align: true },
    // His booted foot touches the bottom edge but the bare one sits 2.8% higher,
    // so a small bed sinks him until both read as planted in the sand.
    brendan:    { h: 210, bed: 0.028 }
  };

  function loadLandmark(file) {
    const lm = { img: new Image(), ready: false };
    lm.img.onload = () => { lm.ready = true; };
    lm.img.src = `assets/${file}`;
    return lm;
  }

  const LANDMARKS = {
    mtDare:     loadLandmark('mt-dare-hotel.png'),
    birdsville: loadLandmark('birdsville-pub.png'),
    bigRed:     loadLandmark('big-red-sign.png'),
    parkSign:   loadLandmark('park-sign.png'),
    stuckBike:  loadLandmark('stuck-bike.png'),
    maccasSign: loadLandmark('maccas-sign.png'),
    eagle:      loadLandmark('eagle-sprite.png'),
    bogTiger:   loadLandmark('tiger-sprite.png'),
    brendan:    loadLandmark('brendan-sprite.png')
  };

  // Roadside scenery: the park sign greets you on the way out of Mt Dare, and
  // some poor bugger is bogged halfway up the face of Big Red.
  // A fifth of the way in, on the most level sand nearby so the flat-bottomed
  // sign sits square instead of straddling a dune face.
  const PARK_SIGN_X = flattestNear(FINISH_DISTANCE * 0.20, 1200, 200);
  const STUCK_BIKE_X = BIG_RED_X - 670;   // ~halfway up the face
  // Brendan is having a shoey on the crest. Biased past the peak so he's clear of
  // the Big Red sign back down the climb, then settled on the most level sand
  // within reach so he stands square rather than straddling the camber.
  const BRENDAN_X = flattestNear(BIG_RED_X + 150, 180, 120);
  // Halfway across, nudged to whatever level ground is nearby: at exactly 50%
  // the sign straddled a dune face with a 49px drop across its base.
  const MACCAS_X = flattestNear(FINISH_DISTANCE * 0.5, 1500, 140);

  // Somebody's Tiger, bogged to the axles a quarter of the way in, planted on
  // level sand so it sits square rather than straddling a dune face.
  const BOG_TIGER_X = flattestNear(FINISH_DISTANCE * 0.25, 900, 160);

  // Returns true if the sprite handled the drawing, false to fall back to the
  // vector version below.
  // opts.align tilts the sprite to match the slope it is sitting on — wanted for
  // something lying in the sand, but not for buildings or signs, which stay
  // upright however steep the dune is.
  function drawLandmarkSprite(worldX, screenYOf, lm, cfg) {
    if (!lm || !lm.ready || !lm.img.naturalHeight) return false;
    const targetH = cfg.h;
    const sx = (worldX - state.cameraX) + W * BIKE_SCREEN_FRAC;
    const scale = targetH / lm.img.naturalHeight;
    const drawW = lm.img.naturalWidth * scale;
    if (sx + drawW / 2 < -60 || sx - drawW / 2 > W + 60) return true;   // off screen
    const groundY = screenYOf(nearTerrain(worldX));

    let tilt = 0;
    if (cfg.align) {
      const half = drawW / 2;
      tilt = Math.atan2(-(nearTerrain(worldX + half) - nearTerrain(worldX - half)), drawW);
    }
    const bedPx = targetH * (cfg.bed || 0);

    ctx.save();
    ctx.translate(sx, groundY);
    ctx.rotate(tilt);
    ctx.save();
    ctx.filter = 'blur(3px)';
    ctx.beginPath();
    ctx.ellipse(0, 0, drawW * 0.42, 9, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(20,10,5,0.26)';
    ctx.fill();
    ctx.restore();
    ctx.drawImage(lm.img, -drawW / 2, -targetH + bedPx, drawW, targetH);
    ctx.restore();
    return true;
  }

  // ---------- pubs & signage ----------
  function drawPub(worldX, label, screenYOf, lm, cfg) {
    if (drawLandmarkSprite(worldX, screenYOf, lm, cfg)) return;
    const sx = (worldX - state.cameraX) + W * BIKE_SCREEN_FRAC;
    if (sx < -320 || sx > W + 320) return;
    const groundY = screenYOf(nearTerrain(worldX));
    const wallW = 210, wallH = 96;
    const baseX = sx - wallW / 2;
    const wallTop = groundY - wallH;

    ctx.fillStyle = 'rgba(20,10,5,0.25)';
    ctx.beginPath();
    ctx.ellipse(sx, groundY, wallW * 0.62, 11, 0, 0, Math.PI * 2);
    ctx.fill();

    const wall = ctx.createLinearGradient(baseX, wallTop, baseX, groundY);
    wall.addColorStop(0, '#dcc79e');
    wall.addColorStop(1, '#b5966a');
    ctx.fillStyle = wall;
    ctx.fillRect(baseX, wallTop, wallW, wallH);

    ctx.fillStyle = '#8a3524';                       // corrugated roof
    ctx.beginPath();
    ctx.moveTo(baseX - 32, wallTop + 18);
    ctx.lineTo(sx, wallTop - 28);
    ctx.lineTo(baseX + wallW + 32, wallTop + 18);
    ctx.lineTo(baseX + wallW + 22, wallTop + 27);
    ctx.lineTo(sx, wallTop - 13);
    ctx.lineTo(baseX - 22, wallTop + 27);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#3d2a18';                      // veranda posts
    ctx.lineWidth = 4;
    for (let px = baseX + 14; px <= baseX + wallW - 10; px += (wallW - 24) / 3) {
      ctx.beginPath();
      ctx.moveTo(px, wallTop + 20);
      ctx.lineTo(px, groundY);
      ctx.stroke();
    }

    ctx.fillStyle = '#3a2a1c';
    ctx.fillRect(sx - 15, groundY - 50, 30, 50);
    ctx.fillStyle = '#2a3f4a';
    ctx.fillRect(baseX + 20, wallTop + 32, 28, 28);
    ctx.fillRect(baseX + wallW - 48, wallTop + 32, 28, 28);

    const signW = 186, signH = 36;                    // sign board
    ctx.fillStyle = '#efe6d2';
    ctx.strokeStyle = '#3a2a1c';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(sx - signW / 2, wallTop - 50, signW, signH, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#3a2a1c';
    ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, sx, wallTop - 50 + signH / 2 + 1);
    ctx.beginPath();
    ctx.moveTo(sx - 34, wallTop - 13); ctx.lineTo(sx - 34, wallTop - 50 + signH);
    ctx.moveTo(sx + 34, wallTop - 13); ctx.lineTo(sx + 34, wallTop - 50 + signH);
    ctx.stroke();
  }

  function drawBigRedSign(screenYOf) {
    if (drawLandmarkSprite(BIG_RED_X - 300, screenYOf, LANDMARKS.bigRed, LANDMARK_SIZE.bigRed)) return;
    const signX = BIG_RED_X - 300;   // sits on the climb, clear of the rider
    const sx = (signX - state.cameraX) + W * BIKE_SCREEN_FRAC;
    if (sx < -200 || sx > W + 200) return;
    const groundY = screenYOf(nearTerrain(signX));

    ctx.strokeStyle = '#4a3520';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(sx, groundY);
    ctx.lineTo(sx, groundY - 76);
    ctx.stroke();

    const w = 104, h = 32;
    ctx.fillStyle = '#e8dcc0';
    ctx.strokeStyle = '#4a3520';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(sx - w / 2, groundY - 76 - h, w, h, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#a5321c';
    ctx.font = 'bold 19px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('BIG RED', sx, groundY - 76 - h / 2 + 1);
  }

  // ---------- state ----------
  // Bike sits centred, which gives a clear view of Mt Dare Hotel behind it at
  // the start (and of Birdsville on arrival).
  const BIKE_SCREEN_FRAC = 0.5;

  // The hotel and the bike occupy the same world position at the start line, so
  // on the title screen the bike is drawn to the right of centre to stand beside
  // the building instead of inside it. Eased back to zero once you set off, so
  // there's no jump. Capped by the screen width, because in portrait the hotel is
  // most of the frame and a fixed nudge would push the bike off the right edge.
  const START_SHIFT = 300;
  const START_SHIFT_EASE = 2.6;      // per second

  function startShiftTarget() {
    return Math.min(START_SHIFT, Math.max(0, W * 0.5 - 130));
  }

  // The bike is nearly inverted before it lets go — very forgiving on angle.
  // Pitch response is deliberately slow. Holding a wheelie is a balance task, so
  // the rider needs time to react: with the old stiff values (14/6/3.2) the nose
  // fell from a held wheelie to the deck faster than human reaction time, which
  // made the run unwinnable rather than hard.
  const LEAN_TORQUE = 7;         // rider input on the pitch deviation
  const AIR_LEAN_TORQUE = 2.9;
  const PITCH_DAMPING = 2.9;
  const AIR_DAMPING = 0.9;

  // Gravity acting on the bike's mass about the rear contact patch, rather than a
  // linear spring. A spring's restoring torque grows without limit, so the further
  // past vertical you went the harder it shoved you back upright — it rescued you
  // from a loop-out. Real gravity torque follows cos() of the mass angle: it pulls
  // the nose down below the balance point and drives the bike over above it.
  const COM_ANGLE = 0.63;        // rear contact to centre of mass, from horizontal
  const GRAVITY_TORQUE = 2.6;
  // balance point sits at pitch = COM_ANGLE - PI/2 = -0.94 rad; past that it loops.
  const MAX_ANGLE_VEL = 9;
  const CRASH_FLIP_ANGLE = 2.05;      // mid-air somersault backstop
  const LANDING_TOLERANCE = 1.45;     // ~83 degrees off the slope on touchdown

  // ---- the whole run is a wheelie ----
  // pitch is the deviation from the ground angle: negative = nose up. The front
  // wheel is off the sand for any pitch below zero, so the rider must hold the
  // nose up the entire way without looping it over backwards.
  const FRONT_DOWN_PITCH = -0.06;     // above this the front wheel is on the deck
  const LOOP_OUT_ANGLE = -1.5;        // absolute attitude at which it goes over backwards
  const START_PITCH = -0.45;          // pops up onto the back wheel on launch
  const WHEELIE_GRACE = 1.2;          // seconds of immunity after start / a stack
  const LOOP_REST_PITCH = -2.5;       // where a looped bike comes to rest, upside down
  const GRAVITY = 2000;
  // Only a genuinely huge crest launches the bike. At 16 every one of the 19
  // crests on the course popped the wheels off the sand, which read as constant
  // little hops. The biggest ordinary dune climbs 216px and Big Red climbs 416px,
  // so this sits in the gap: ordinary dunes are ridden over, Big Red sends it.
  const MIN_CLIMB = 260;

  const state = {
    mode: 'title',                    // title | riding | finished | dead
    cameraX: 0,
    camY: 0,
    angle: 0,
    angleVel: 0,
    pitch: 0,
    pitchVel: 0,
    leanInput: 0,
    airY: 0,
    airVel: 0,
    airborne: false,
    prevElev: null,
    prevSlope: 0,
    climbAccum: 0,
    crashed: false,
    crashTimer: 0,
    squash: 0,          // suspension compression, px into the sand
    squashVel: 0,
    graceTimer: 0,
    crashReason: '',
    crashes: 0,
    arriveTimer: 0,
    rocketTimer: 0,
    fuel: FUEL_START,
    elapsed: 0,
    startShift: 0
  };

  function resetRun() {
    state.mode = 'title';
    state.cameraX = 0;
    state.camY = nearTerrain(0);
    state.angle = contactAngleAt(0);
    state.angleVel = 0;
    state.pitch = 0;
    state.pitchVel = 0;
    state.leanInput = 0;
    state.startShift = startShiftTarget();
    state.airY = 0;
    state.airVel = 0;
    state.airborne = false;
    state.prevElev = null;
    state.prevSlope = state.angle;
    state.climbAccum = 0;
    state.crashed = false;
    state.crashTimer = 0;
    state.squash = 0;
    state.squashVel = 0;
    dust.length = 0;
    state.crashes = 0;
    state.arriveTimer = 0;
    state.rocketTimer = 0;
    fw.rockets.length = fw.sparks.length = fw.flashes.length = 0;
    state.fuel = FUEL_START;
    state.elapsed = 0;
    keys.ArrowUp = keys.ArrowDown = false;
    touchLean.clear();
    startScreen.classList.remove('hidden');
    finishScreen.classList.add('hidden');
    deadScreen.classList.add('hidden');
    document.body.classList.remove('riding');
    document.body.classList.add('on-title');
  }

  function startRun() {
    state.mode = 'riding';
    document.body.classList.remove('on-title');
    state.pitch = START_PITCH;
    state.pitchVel = 0;
    state.graceTimer = WHEELIE_GRACE;
    startScreen.classList.add('hidden');
    document.body.classList.add('riding');   // reveals the touch lean zones
  }

  // Where the chassis rests: both tyres sit exactly on the sand and the chassis
  // takes the angle of the line joining them. The bike's own ground clearance
  // lets it bridge crests, so nothing is lifted off the surface.
  function chassisAt(worldX) {
    const xR = worldX - HALF_WHEELBASE;
    const xF = worldX + HALF_WHEELBASE;
    const yR = nearTerrain(xR);
    const yF = nearTerrain(xF);
    return {
      angle: Math.atan2(-(yF - yR), 2 * HALF_WHEELBASE),
      yRear: yR,
      yFront: yF
    };
  }

  function contactAngleAt(worldX) {
    return chassisAt(worldX).angle;
  }

  // ---------- simulation ----------
  function update(dt) {
    // fuel is the clock: it drains while you ride, and stacks cost you dearly
    state.fuel -= dt;
    state.elapsed += dt;
    if (state.fuel <= 0) {
      state.fuel = 0;
      state.mode = 'dead';
      document.body.classList.remove('riding');
      deadDetailEl.textContent =
        `You stacked it ${state.crashes} time${state.crashes === 1 ? '' : 's'} and ran dry ` +
        `${Math.max(0, Math.round((FINISH_DISTANCE - state.cameraX) / 12))} m short of Birdsville.`;
      deadScreen.classList.remove('hidden');
      return;
    }

    if (state.crashed) {
      state.crashTimer -= dt;
      state.angleVel = 0;
      state.pitchVel = 0;
      const ground = chassisAt(state.cameraX);
      if (state.crashReason === 'LOOPED IT') {
        // carry on over and come to rest upside down
        state.pitch += (LOOP_REST_PITCH - state.pitch) * Math.min(1, dt * 7);
      } else {
        // dropped the front wheel: nothing dramatic, the bike just stops
        state.pitch += (0 - state.pitch) * Math.min(1, dt * 14);
      }
      state.angle = ground.angle + state.pitch;
      if (state.crashTimer <= 0) {
        state.crashed = false;
        // remount already up on the back wheel, with a moment's immunity —
        // dropping the rider back at pitch 0 would trip the front-wheel rule
        state.pitch = START_PITCH;
        state.pitchVel = 0;
        state.angleVel = 0;
        state.graceTimer = WHEELIE_GRACE;
        state.angle = contactAngleAt(state.cameraX) + state.pitch;
      }
      return;
    }

    // fixed forward speed — the rider only manages pitch
    state.cameraX += RIDE_SPEED * dt;

    if (state.cameraX >= FINISH_DISTANCE) {
      // Pull up at the pub and let the town carry on for a moment before the
      // end screen drops — arriving deserves a beat.
      state.cameraX = FINISH_DISTANCE;
      state.mode = 'arriving';
      state.arriveTimer = CELEBRATION_TIME;
      state.rocketTimer = 0.25;
      const mm = Math.floor(state.elapsed / 60);
      const ss = Math.round(state.elapsed % 60).toString().padStart(2, '0');
      finishTimeEl.textContent =
        `${mm}:${ss} with ${Math.round(state.fuel)}s of fuel left — ` +
        `${state.crashes} stack${state.crashes === 1 ? '' : 's'}.`;
      return;
    }

    let leanTarget = 0;
    state.startShift += (0 - state.startShift) * Math.min(1, dt * START_SHIFT_EASE);
    if (Math.abs(state.startShift) < 0.5) state.startShift = 0;

    if (keys.ArrowUp) leanTarget += 1;
    if (keys.ArrowDown) leanTarget -= 1;
    if (!leanTarget) leanTarget = touchLeanSum();
    state.leanInput += (leanTarget - state.leanInput) * Math.min(1, dt * 7);

    // dune crest launches the bike
    const elevNow = nearTerrain(state.cameraX);
    if (state.prevElev === null) state.prevElev = elevNow;
    const dElev = elevNow - state.prevElev;
    if (dElev > 0) {
      state.climbAccum += dElev;
    } else if (state.climbAccum > 0) {
      if (!state.airborne && state.climbAccum > MIN_CLIMB) {
        state.airborne = true;
        state.angleVel = state.pitchVel;
        const strength = Math.min(state.climbAccum, 420);
        state.airVel = 70 + strength * 2.0 + RIDE_SPEED * 0.25;
      }
      state.climbAccum = 0;
    }
    state.prevElev = elevNow;

    const ground = chassisAt(state.cameraX);
    let landedHard = false;

    const xRearContact = state.cameraX - HALF_WHEELBASE;
    const yRearContact = nearTerrain(xRearContact);

    if (state.airborne) {
      state.airVel -= GRAVITY * dt;
      state.airY += state.airVel * dt;
      const impactSpeed = Math.abs(state.airVel);
      if (state.airY <= 0) {
        state.airY = 0;
        state.airVel = 0;
        state.airborne = false;
        // carry the airborne attitude over as pitch relative to the new slope
        state.pitch = state.angle - ground.angle;
        state.pitchVel = state.angleVel;
        if (Math.abs(state.pitch) > LANDING_TOLERANCE) landedHard = true;
        // suspension takes the hit: compress in proportion to descent speed
        state.squashVel += Math.min(200, impactSpeed * 0.5);
        for (let i = 0; i < 14; i++) spawnDust(xRearContact, yRearContact, 1.4);
      }
    }

    if (state.airborne) {
      // free rotation: only the rider's weight shift acts on the bike
      const accel = state.leanInput * AIR_LEAN_TORQUE - state.angleVel * AIR_DAMPING;
      state.angleVel = clamp(state.angleVel + accel * dt, -MAX_ANGLE_VEL, MAX_ANGLE_VEL);
      state.angle += state.angleVel * dt;
    } else {
      // Grounded, the chassis angle IS the ground it sits on — the rider can only
      // add a pitch deviation on top (wheelie / endo), which the suspension
      // continually pulls back to flat. No lag, so the wheels never leave the sand.
      // Gravity is a WORLD force, so the mass angle is measured from the absolute
      // chassis attitude, not from pitch. Using pitch made the bike behave as if
      // it were on the flat: landing off Big Red onto the 17-degree descent put
      // it right on its balance point and it looped every time.
      const absAngle = ground.angle + state.pitch;
      const accel = state.leanInput * LEAN_TORQUE
                  + GRAVITY_TORQUE * Math.cos(COM_ANGLE - absAngle)
                  - state.pitchVel * PITCH_DAMPING;
      state.pitchVel = clamp(state.pitchVel + accel * dt, -MAX_ANGLE_VEL, MAX_ANGLE_VEL);
      state.pitch += state.pitchVel * dt;
      state.angle = ground.angle + state.pitch;
      state.angleVel = state.pitchVel;
    }

    if (state.graceTimer > 0) state.graceTimer -= dt;

    let reason = '';
    if (landedHard) reason = 'BAD LANDING';
    else if (Math.abs(state.angle) > CRASH_FLIP_ANGLE) reason = 'LOOPED IT';
    else if (!state.airborne && state.graceTimer <= 0) {
      // the two rules that make this a wheelie run
      if (state.pitch > FRONT_DOWN_PITCH) reason = 'FRONT WHEEL DOWN';
      else if (state.angle < LOOP_OUT_ANGLE) reason = 'LOOPED IT';
    }

    if (reason) {
      state.crashed = true;
      state.crashReason = reason;
      state.crashTimer = CRASH_RECOVERY_TIME;
      state.crashes += 1;
      state.fuel -= CRASH_FUEL_PENALTY;
      state.angleVel = 0;
      state.pitchVel = 0;
    }

    // suspension: a damped spring, tuned so a dune landing compresses ~8px and
    // settles in about a third of a second — enough to see the bike take the hit
    state.squashVel += (-state.squash * 90 - state.squashVel * 11) * dt;
    state.squash = Math.max(0, state.squash + state.squashVel * dt);

    // rolling dust off the back tyre keeps the contact patch visible
    if (!state.airborne) {
      const slopeBite = Math.min(1, Math.abs(ground.angle) * 1.8);
      if (Math.random() < 0.55 + slopeBite * 0.4) {
        spawnDust(xRearContact, yRearContact, 0.5 + slopeBite * 0.7);
      }
    }
    updateDust(dt);

    wheelSpin += (RIDE_SPEED / WHEEL_WORLD_R) * SPIN_READABILITY * dt;

  }

  // Rolled to a stop outside the pub: the wheelie is over, so the nose settles
  // onto the sand and the fireworks go up.
  function updateArrival(dt) {
    state.arriveTimer -= dt;
    state.pitch += (0 - state.pitch) * Math.min(1, dt * 3);
    state.pitchVel = 0;
    state.angle = chassisAt(state.cameraX).angle + state.pitch;

    state.rocketTimer -= dt;
    if (state.rocketTimer <= 0 && state.arriveTimer > 1.1) {
      launchRocket();
      if (Math.random() < 0.35) launchRocket();      // the odd double
      state.rocketTimer = 0.38 + Math.random() * 0.42;
    }
    updateFireworks(dt);

    if (state.arriveTimer <= 0) {
      state.mode = 'finished';
      document.body.classList.remove('riding');
      finishScreen.classList.remove('hidden');
    }
  }

  // ---------- rendering ----------
  function drawSky(t, cyc) {
    const horizon = H * 0.68;
    const c = cyc.sky;
    const g = ctx.createLinearGradient(0, 0, 0, horizon);
    g.addColorStop(0,    `rgb(${c[0]|0},${c[1]|0},${c[2]|0})`);
    g.addColorStop(0.55, `rgb(${c[3]|0},${c[4]|0},${c[5]|0})`);
    g.addColorStop(1,    `rgb(${c[6]|0},${c[7]|0},${c[8]|0})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // ---- stars, out once the light goes ----
    if (cyc.starGlow > 0.01) {
      for (const st of STARS) {
        const tw = 0.55 + 0.45 * Math.sin(t * st.rate + st.phase);
        ctx.globalAlpha = cyc.starGlow * tw;
        ctx.fillStyle = '#fdfbf2';
        ctx.beginPath();
        ctx.arc(st.xf * W, st.yf * H, st.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    if (cyc.night > 0.01) {
      // ---- moon, rising in the east behind you ----
      const mx = W * 0.74, my = horizon - cyc.moonAlt * (horizon - H * 0.1);
      const mr = 30;
      const halo = ctx.createRadialGradient(mx, my, mr * 0.6, mx, my, mr * 3.4);
      halo.addColorStop(0, `rgba(226,232,246,${0.30 * cyc.night})`);
      halo.addColorStop(1, 'rgba(226,232,246,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(mx - mr * 3.4, my - mr * 3.4, mr * 6.8, mr * 6.8);
      ctx.globalAlpha = cyc.night;
      ctx.fillStyle = '#eef1fa';
      ctx.beginPath();
      ctx.arc(mx, my, mr, 0, Math.PI * 2);
      ctx.fill();
      // a couple of maria so it is not a flat disc
      ctx.fillStyle = 'rgba(198,206,226,0.75)';
      ctx.beginPath();
      ctx.arc(mx - 8, my - 6, 7, 0, Math.PI * 2);
      ctx.arc(mx + 9, my + 5, 5, 0, Math.PI * 2);
      ctx.arc(mx - 2, my + 11, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // ---- sun ----
    if (cyc.sunAlt > -0.12) {
      const sunX = W * cyc.sunXf;
      // lifted a little so the disc clears the sand at sunrise and sunset
      const sunY = horizon - 30 - cyc.sunAlt * (horizon - H * 0.12);
      // swollen and pale on the horizon, small and bright overhead
      const low = 1 - clamp(cyc.sunAlt, 0, 1);
      const r = lerp(34, 74, low * low);
      const glowR = r * lerp(2.6, 4.6, low);

      const glow = ctx.createRadialGradient(sunX, sunY, r * 0.7, sunX, sunY, glowR);
      glow.addColorStop(0, `rgba(255,226,168,${lerp(0.42, 0.66, low)})`);
      glow.addColorStop(1, 'rgba(255,214,150,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(sunX - glowR, sunY - glowR, glowR * 2, glowR * 2);

      const disc = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, r);
      disc.addColorStop(0, '#fff8e2');
      disc.addColorStop(0.75, low > 0.5 ? '#f8e2b0' : '#fff3d2');
      disc.addColorStop(1, low > 0.5 ? '#f0cf92' : '#ffeec4');
      ctx.fillStyle = disc;
      ctx.beginPath();
      ctx.arc(sunX, sunY, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // ---- flat cloud streaks, as in the reference ----
    const cloudTint = lerp(255, 150, cyc.night);
    for (let i = 0; i < 5; i++) {
      const cx = ((t * 7 + i * 330) % (W + 320)) - 160;
      const cy = H * (0.09 + i * 0.045);
      ctx.fillStyle = `rgba(${cloudTint|0},${(cloudTint*0.97)|0},${(cloudTint*0.93)|0},${0.30 - cyc.night * 0.14})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 62, 14, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + 42, cy + 4, 40, 11, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // low streaks near the horizon, lit from beneath at either end of the day
    const streak = Math.max(0, 1 - Math.abs(cyc.sunAlt) * 2.2);
    if (streak > 0.02) {
      for (let i = 0; i < 4; i++) {
        const cx = ((t * 4 + i * 420) % (W + 420)) - 210;
        const cy = horizon - 40 - i * 26;
        ctx.fillStyle = `rgba(255,206,150,${0.26 * streak})`;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 110, 7, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // The tint darkens the moon and stars along with everything else, which leaves
  // them muddy. This adds their light back on top, clipped to the sky so nothing
  // sparkles on the sand.
  function relightSky(cyc, t) {
    if (cyc.starGlow < 0.02 || terrainPts.length === 0) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(W, 0);
    ctx.lineTo(W, terrainPts[terrainPts.length - 1][1]);
    for (let i = terrainPts.length - 1; i >= 0; i--) ctx.lineTo(terrainPts[i][0], terrainPts[i][1]);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.clip();

    ctx.globalCompositeOperation = 'lighter';

    const horizon = H * 0.68;
    const mx = W * 0.74, my = horizon - cyc.moonAlt * (horizon - H * 0.1);
    const mr = 30;
    const halo = ctx.createRadialGradient(mx, my, mr * 0.5, mx, my, mr * 3.6);
    halo.addColorStop(0, `rgba(150,170,220,${0.22 * cyc.night})`);
    halo.addColorStop(1, 'rgba(150,170,220,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(mx - mr * 3.6, my - mr * 3.6, mr * 7.2, mr * 7.2);

    ctx.fillStyle = `rgba(196,206,232,${0.72 * cyc.night})`;
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, Math.PI * 2);
    ctx.fill();

    for (const st of STARS) {
      const tw = 0.5 + 0.5 * Math.sin(t * st.rate + st.phase);
      ctx.fillStyle = `rgba(210,220,245,${cyc.starGlow * tw * 0.85})`;
      ctx.beginPath();
      ctx.arc(st.xf * W, st.yf * H, st.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Multiply the finished frame by the light of the moment, so sky, sand,
  // sprites and bike all sit under one consistent light.
  function applyDayTint(cyc) {
    const [r, g, b] = cyc.tint;
    if (r > 252 && g > 252 && b > 252) return;      // midday: nothing to do
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgb(${r|0},${g|0},${b|0})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  function drawFarLayer(nowSec) {
    const parallax = 0.35;
    const base = H * 0.58;
    const shift = (elev) => base + (state.camY - elev) * parallax;

    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let sx = 0; sx <= W; sx += 12) {
      const worldX = (state.cameraX - W * BIKE_SCREEN_FRAC + sx) * parallax;
      ctx.lineTo(sx, shift(farTerrain(worldX) * 0.75));
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fillStyle = '#c97a4a';
    ctx.fill();

    const critterGround = (screenX) => {
      const worldX = (state.cameraX - W * BIKE_SCREEN_FRAC + screenX) * parallax;
      return shift(farTerrain(worldX) * 0.75);
    };

    for (const roo of roos) {
      const sx = (roo.worldX - state.cameraX * parallax) + W * BIKE_SCREEN_FRAC * parallax;
      if (sx < -70 || sx > W + 70) continue;
      const hopT = Math.abs(Math.sin(nowSec * roo.rate + roo.phase));
      drawKangaroo(sx, critterGround(sx) - hopT * roo.hop, hopT, roo.scale);
    }

    for (const emu of emus) {
      const sx = (emu.worldX - state.cameraX * parallax) + W * BIKE_SCREEN_FRAC * parallax;
      if (sx < -70 || sx > W + 70) continue;
      const bob = Math.abs(Math.sin(nowSec * emu.rate * 0.5 + emu.phase)) * 3;
      drawEmu(sx, critterGround(sx) - bob, nowSec * emu.rate + emu.phase, emu.scale);
    }
  }

  let terrainPts = [];

  const MID_PARALLAX = 0.62;

  function midGroundY(worldX) {
    const base = H * 0.635;
    return base + (state.camY - midTerrain(worldX) * 0.8) * MID_PARALLAX;
  }

  function drawMidLayer(t) {
    ctx.beginPath();
    ctx.moveTo(0, H + 200);
    for (let sx = 0; sx <= W; sx += 8) {
      // mid-frame coordinate: the band slides at MID_PARALLAX of the rider's speed
      const u = state.cameraX * MID_PARALLAX + (sx - W * BIKE_SCREEN_FRAC);
      ctx.lineTo(sx, midGroundY(u));
    }
    ctx.lineTo(W, H + 200);
    ctx.closePath();
    ctx.fillStyle = '#bd6a3c';
    ctx.fill();

    drawCamel(t);
  }

  function drawNearLayer() {
    const horizon = H * 0.68;
    const screenYOf = (elev) => horizon + (state.camY - elev);

    const pts = [];
    ctx.beginPath();
    ctx.moveTo(0, H + 400);
    for (let sx = 0; sx <= W; sx += 5) {
      const worldX = state.cameraX - W * BIKE_SCREEN_FRAC + sx;
      const y = screenYOf(nearTerrain(worldX));
      pts.push([sx, y]);
      ctx.lineTo(sx, y);
    }
    ctx.lineTo(W, H + 400);
    ctx.closePath();
    const sand = ctx.createLinearGradient(0, horizon - 260, 0, H);
    sand.addColorStop(0, '#e08245');
    sand.addColorStop(0.3, '#c85f2c');
    sand.addColorStop(1, '#7d3517');
    ctx.fillStyle = sand;
    ctx.fill();

    terrainPts = pts;

    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.strokeStyle = 'rgba(255,214,170,0.55)';
    ctx.lineWidth = 3;
    ctx.stroke();

    const x0 = state.cameraX - W * BIKE_SCREEN_FRAC - 40;
    const x1 = state.cameraX + W * (1 - BIKE_SCREEN_FRAC) + 40;

    // fine sand ripples scrolling past — without surface detail there is nothing
    // to read the bike's motion against, which makes it look like it hovers
    ctx.strokeStyle = 'rgba(126,56,24,0.20)';
    ctx.lineWidth = 1.6;
    const rippleGap = 30;
    for (let rx = Math.floor(x0 / rippleGap) * rippleGap; rx < x1; rx += rippleGap) {
      const jitter = hash(rx * 0.71) * 12;
      const wx = rx + jitter;
      const sx = (wx - state.cameraX) + W * BIKE_SCREEN_FRAC;
      const sy = screenYOf(nearTerrain(wx));
      const len = 7 + hash(rx * 0.29) * 9;
      ctx.beginPath();
      ctx.moveTo(sx, sy + 3);
      ctx.lineTo(sx + len, sy + 4.5);
      ctx.stroke();
    }

    // tyre track pressed into the sand behind the bike — a strong cue that the
    // wheels are actually touching, and it scrolls with the terrain
    const bikeSx = W * BIKE_SCREEN_FRAC;
    ctx.save();
    ctx.beginPath();
    let started = false;
    for (let sx = 0; sx <= bikeSx; sx += 5) {
      const worldX = state.cameraX - W * BIKE_SCREEN_FRAC + sx;
      const y = screenYOf(nearTerrain(worldX)) + 2.5;
      if (!started) { ctx.moveTo(sx, y); started = true; } else ctx.lineTo(sx, y);
    }
    ctx.strokeStyle = 'rgba(120,52,22,0.5)';
    ctx.lineWidth = 4;
    ctx.setLineDash([7, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    drawPub(PUB_START_X, 'MT DARE HOTEL', screenYOf, LANDMARKS.mtDare, LANDMARK_SIZE.mtDare);
    drawLandmarkSprite(PARK_SIGN_X, screenYOf, LANDMARKS.parkSign, LANDMARK_SIZE.parkSign);
    drawLandmarkSprite(STUCK_BIKE_X, screenYOf, LANDMARKS.stuckBike, LANDMARK_SIZE.stuckBike);
    drawBogSand(screenYOf, false);
    drawLandmarkSprite(BOG_TIGER_X, screenYOf, LANDMARKS.bogTiger, LANDMARK_SIZE.bogTiger);
    drawBogSand(screenYOf, true);
    drawLandmarkSprite(MACCAS_X, screenYOf, LANDMARKS.maccasSign, LANDMARK_SIZE.maccasSign);
    drawCamp(screenYOf, performance.now() * 0.001);
    drawPub(FINISH_DISTANCE, 'BIRDSVILLE PUB', screenYOf, LANDMARKS.birdsville, LANDMARK_SIZE.birdsville);
    drawLandmarkSprite(BRENDAN_X, screenYOf, LANDMARKS.brendan, LANDMARK_SIZE.brendan);
    drawBigRedSign(screenYOf);

    // scrub
    const spacing = 76;
    for (let bx = Math.floor(x0 / spacing) * spacing; bx < x1; bx += spacing) {
      const r = hash(bx * 0.13 + 7);
      if (r <= 0.45) continue;
      const wx = bx + hash(bx * 0.37) * spacing;
      const sx = (wx - state.cameraX) + W * BIKE_SCREEN_FRAC;
      const sy = screenYOf(nearTerrain(wx));
      const s = 7 + r * 8;
      ctx.fillStyle = '#5c6b3a';
      ctx.beginPath();
      ctx.ellipse(sx, sy - s * 0.4, s, s * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#3f4a26';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx, sy - s * 0.4);
      ctx.stroke();
    }

    return screenYOf;
  }

  function drawTheBike(screenYOf) {
    const bikeScreenX = W * BIKE_SCREEN_FRAC + state.startShift;
    const ground = chassisAt(state.cameraX);
    const centreGroundY = screenYOf((ground.yRear + ground.yFront) / 2);

    // Shadowing sells contact more than anything else here. A single wide, soft
    // ellipse under the middle is what a HOVERING object casts, so grounded the
    // bike gets tight dark patches directly under each loaded tyre instead.
    if (state.airborne) {
      const fade = Math.max(0.12, 1 - state.airY / 220);
      ctx.save();
      ctx.filter = 'blur(3px)';
      ctx.beginPath();
      ctx.ellipse(bikeScreenX, centreGroundY, 54 * fade, 8 * fade, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(20,10,5,${0.30 * fade})`;
      ctx.fill();
      ctx.restore();
    } else {
      // faint shadow for the bike's bulk
      ctx.save();
      ctx.filter = 'blur(4px)';
      ctx.beginPath();
      ctx.ellipse(bikeScreenX, centreGroundY + 2, 64, 6, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(30,14,6,0.16)';
      ctx.fill();
      ctx.restore();

      // hard contact patch under each tyre, fading out as that wheel unloads
      const lift = Math.min(1, Math.abs(state.pitch) / 0.45);
      const rearLoad = state.pitch > 0 ? 1 - lift : 1;
      const frontLoad = state.pitch < 0 ? 1 - lift : 1;
      ctx.save();
      ctx.filter = 'blur(1px)';
      const patches = [
        [bikeScreenX - HALF_WHEELBASE, screenYOf(ground.yRear), rearLoad],
        [bikeScreenX + HALF_WHEELBASE, screenYOf(ground.yFront), frontLoad]
      ];
      for (const [px, py, load] of patches) {
        if (load <= 0.02) continue;
        ctx.beginPath();
        ctx.ellipse(px, py + 1.5, 13 * (0.5 + load * 0.5), 4, 0, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(24,10,4,${0.55 * load})`;
        ctx.fill();
      }
      ctx.restore();
    }

    if (state.airborne) {
      // free in the air: rotate about the middle of the wheelbase
      drawBike(bikeScreenX, centreGroundY - state.airY, state.angle, SPRITE_MID_X);
      return;
    }

    // Grounded: pin the loaded wheel's contact patch exactly onto the sand, so
    // that tyre rides the surface instead of the whole bike bobbing over it.
    const noseDown = state.pitch > 0;
    const contactX = noseDown ? SPRITE.frontX : SPRITE.rearX;
    const offset = noseDown ? HALF_WHEELBASE : -HALF_WHEELBASE;
    const contactY = screenYOf(noseDown ? ground.yFront : ground.yRear);
    const looped = state.crashed && state.crashReason === 'LOOPED IT';
    const lift = looped ? restLift(state.angle, contactX) : 0;
    drawBike(bikeScreenX + offset, contactY + state.squash - lift, state.angle, contactX);
  }

  function drawCrashBanner() {
    if (!state.crashed) return;
    ctx.save();
    ctx.font = 'bold 40px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(60,18,8,0.65)';
    ctx.fillStyle = 'rgba(255,248,236,0.95)';
    const msg = state.crashReason || 'STACKED IT!';
    ctx.strokeText(msg, W / 2, H * 0.26);
    ctx.fillText(msg, W / 2, H * 0.26);
    ctx.font = 'bold 19px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.strokeText('-5s fuel', W / 2, H * 0.26 + 36);
    ctx.fillText('-5s fuel', W / 2, H * 0.26 + 36);
    ctx.restore();
  }

  function updateHud() {
    const pct = clamp(state.fuel / FUEL_START, 0, 1);
    fuelFill.style.width = `${pct * 100}%`;
    fuelFill.className = pct < 0.15 ? 'critical' : (pct < 0.35 ? 'low' : '');
    const secs = Math.max(0, Math.ceil(state.fuel));
    fuelNum.textContent = fuelCap ? secs : `${secs}s`;

    const prog = clamp(state.cameraX / FINISH_DISTANCE, 0, 1);
    progressFill.style.width = `${prog * 100}%`;
    const left = Math.max(0, Math.round(TOTAL_DUNES * (1 - prog)));
    if (dunesCap) {
      const done = state.mode === 'finished' || state.mode === 'arriving';
      dunesNum.textContent = done ? '0' : left;
      dunesCap.textContent = done ? 'arrived!' : 'dunes to go';
    } else {
      const done = state.mode === 'finished' || state.mode === 'arriving';
      dunesNum.textContent = done ? 'Arrived!' : `${left} dunes to go`;
    }
  }

  // ---------- main loop ----------
  state.camY = nearTerrain(0);
  state.angle = contactAngleAt(0);
  state.prevSlope = state.angle;

  let lastTime = performance.now();
  let loggedFrameError = false;

  function frame(now) {
    try {
      step(now);
    } catch (err) {
      // Keep animating: one bad frame used to stop requestAnimationFrame being
      // rescheduled, which froze the game outright.
      if (!loggedFrameError) { console.error('frame error', err); loggedFrameError = true; }
    }
    requestAnimationFrame(frame);
  }

  function step(now) {
    const dt = Math.min(0.033, (now - lastTime) / 1000);
    lastTime = now;
    reconcileSize();

    if (state.mode === 'riding') update(dt);
    else if (state.mode === 'arriving') updateArrival(dt);
    // Recomputed each frame while the title is up rather than set once: resetRun
    // never runs at startup, and the cap depends on a width that can change under
    // us when the phone is rotated.
    else if (state.mode === 'title') state.startShift = startShiftTarget();

    // camera tracks ground height so the huge dunes read properly
    const target = nearTerrain(state.cameraX);
    // tight follow: a laggy camera made the whole scene slosh vertically,
    // which reads as the bike floating rather than tracking the ground
    state.camY += (target - state.camY) * Math.min(1, dt * 18);

    const cyc = dayCycle();
    const t = now * 0.001;

    drawSky(t, cyc);
    drawEagle(t);
    drawFarLayer(t);
    drawMidLayer(t);
    const screenYOf = drawNearLayer();
    drawDust(screenYOf);
    drawTheBike(screenYOf);

    // one light over the whole scene, then the fire on top of it
    applyDayTint(cyc);
    relightSky(cyc, t);
    drawBikeLights(cyc, t);
    drawCampGlow(screenYOf, t, cyc);
    drawFireworks(screenYOf);

    drawCrashBanner();
    updateHud();
  }

  requestAnimationFrame(frame);
})();
