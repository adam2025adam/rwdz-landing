/* ============================================================
   NOWY RWDZ — scroll engine (rect-based, IO-free for robustness)
   ============================================================ */
(function () {
  'use strict';

  var doc = document.documentElement;
  var body = document.body;

  /* ---- reduced motion (system + manual toggle) ---- */
  var prefersReduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var stored = localStorage.getItem('rwdz-reduce');
  var reduce = stored === '1' || (stored === null && prefersReduce);

  function applyReduce() {
    body.classList.toggle('reduce-motion', reduce);
    var t = document.getElementById('motion-toggle');
    if (t) { t.setAttribute('aria-pressed', String(reduce)); t.querySelector('.switch').setAttribute('aria-pressed', String(reduce)); }
  }
  applyReduce();

  var toggle = document.getElementById('motion-toggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      reduce = !reduce;
      localStorage.setItem('rwdz-reduce', reduce ? '1' : '0');
      applyReduce();
      if (reduce) setReducedStates(); else onScroll();
    });
  }

  /* ---- helpers ---- */
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function vh() { return window.innerHeight; }

  var revealEls = [].slice.call(document.querySelectorAll('.reveal'));
  var counters = [].slice.call(document.querySelectorAll('[data-count]'));
  var steps = [].slice.call(document.querySelectorAll('.feat-step'));
  var cks = [].slice.call(document.querySelectorAll('.ck'));
  var modal = document.getElementById('form-modal');
  var scribble = document.getElementById('scribble-path');
  var a11ySection = document.getElementById('dostepnosc');

  /* ---- counters ---- */
  function animateCount(el) {
    if (el.__done) return; el.__done = true;
    var target = parseFloat(el.getAttribute('data-count'));
    var suffix = el.getAttribute('data-suffix') || '';
    if (reduce) { el.textContent = target + suffix; return; }
    var start = performance.now(), dur = 1200;
    (function step(now) {
      var p = clamp((now - start) / dur, 0, 1);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))) + suffix;
      if (p < 1) requestAnimationFrame(step);
    })(performance.now());
  }

  /* ---- scribble setup ---- */
  if (scribble) {
    var len = scribble.getTotalLength();
    scribble.style.strokeDasharray = len;
    scribble.style.strokeDashoffset = reduce ? 0 : len;
  }
  function drawScribble() {
    if (!scribble || scribble.__done) return; scribble.__done = true;
    scribble.style.transition = 'stroke-dashoffset 1.1s ease';
    scribble.style.strokeDashoffset = 0;
  }

  /* ---- visibility check (replaces IntersectionObserver) ---- */
  function inView(el, ratio) {
    var r = el.getBoundingClientRect();
    if (r.height === 0 && r.width === 0) return false;
    var trigger = vh() * (ratio == null ? 0.88 : ratio);
    return r.top < trigger && r.bottom > 0;
  }
  function checkReveals() {
    for (var i = 0; i < revealEls.length; i++) {
      if (!revealEls[i].classList.contains('in') && inView(revealEls[i])) revealEls[i].classList.add('in');
    }
    for (var j = 0; j < counters.length; j++) { if (inView(counters[j], 0.92)) animateCount(counters[j]); }
    if (modal && !modal.classList.contains('in') && inView(modal, 0.8)) modal.classList.add('in');
    if (scribble && inView(scribble.closest('.split') || scribble, 0.7)) drawScribble();
  }

  /* ---- feature steps + checkmarks ---- */
  function setActiveStep(n) {
    steps.forEach(function (s) { s.classList.toggle('on', parseInt(s.getAttribute('data-step'), 10) === n); });
    cks.forEach(function (c) { c.classList.toggle('pop', parseInt(c.getAttribute('data-ckid'), 10) <= n); });
  }

  /* ---- transform sticky scrub ---- */
  var tfTrack = document.getElementById('tf-track');
  var tfOld = document.getElementById('tf-old');
  var tfNew = document.getElementById('tf-new');
  var tfWave = document.getElementById('tf-wave');
  var bigword = document.getElementById('bigword');

  function tfProgress() {
    if (!tfTrack) return 0;
    var r = tfTrack.getBoundingClientRect();
    var total = r.height - vh();
    return clamp((-r.top) / total, 0, 1);
  }
  function renderTransform(p) {
    if (!tfOld) return;
    var oldP = clamp((p - 0.06) / 0.45, 0, 1);
    tfOld.style.transform = 'translateX(' + (-oldP * 130) + '%) rotate(' + (-oldP * 7) + 'deg)';
    tfOld.style.opacity = String(1 - clamp((p - 0.32) / 0.22, 0, 1));
    var waveP = clamp((p - 0.26) / 0.34, 0, 1);
    tfWave.style.transform = 'translate(-50%,-50%) scale(' + (waveP * 1.05) + ')';
    var newP = clamp((p - 0.48) / 0.42, 0, 1);
    var ease = 1 - Math.pow(1 - newP, 3);
    tfNew.style.transform = 'translateX(' + (120 - ease * 120) + '%)';
    tfNew.style.opacity = String(clamp(newP * 1.4, 0, 1));
    if (bigword) bigword.style.transform = 'translate(' + (40 - p * 80) + 'vw, -50%)';
  }

  /* ---- paper plane flight ----
     Trajectory is unchanged. We sample position, derive a motion vector
     (dx, dy in px), pick one of six flight-state assets from that vector,
     and swap the visible SVG with smoothing + hysteresis (no flicker, no
     big programmatic rotation — only a subtle micro-tilt). */
  var plane = document.getElementById('plane');
  var planeSvgs = plane ? [].slice.call(plane.querySelectorAll('.plane-svg')) : [];
  var planeMap = {};
  planeSvgs.forEach(function (el) { planeMap[el.getAttribute('data-state')] = el; });

  var path = [
    [0.00, 70, 30], [0.10, 18, 55], [0.22, 80, 42],
    [0.36, 24, 60], [0.50, 60, 35], [0.64, 22, 58],
    [0.78, 78, 46], [0.90, 40, 64], [1.00, 55, 40]
  ];

  // returns {x,y} in px for a given scroll fraction (same curve as before)
  function planePosPx(frac) {
    var i = 0; for (; i < path.length - 1; i++) { if (frac <= path[i + 1][0]) break; }
    var a = path[i], b = path[Math.min(i + 1, path.length - 1)];
    var t = clamp((frac - a[0]) / ((b[0] - a[0]) || 1), 0, 1);
    var te = t * t * (3 - 2 * t);
    return {
      x: lerp(a[1], b[1], te) / 100 * window.innerWidth,
      y: lerp(a[2], b[2], te) / 100 * vh()
    };
  }

  // ---- flight-state selection ----
  // slope = dy / |dx| (screen coords: dy>0 = down). Thresholds give 3 vertical
  // bands; horizontal sign gives left/right.
  var UP_SLOPE = 0.18;    // above the horizon (slightly up)
  var STEEP_SLOPE = 0.95; // clearly diving (steep down)
  function getFlightState(dx, dy) {
    var side = dx >= 0 ? 'right' : 'left';
    var slope = dy / (Math.abs(dx) + 0.0001);
    var vert;
    if (slope < -UP_SLOPE) vert = 'slightly-up';
    else if (slope > STEEP_SLOPE) vert = 'steep-down';
    else vert = 'slightly-down';
    return vert + '-' + side;
  }

  function setPlaneAsset(state) {
    var el = planeMap[state];
    if (!el || el.classList.contains('on')) return;
    planeSvgs.forEach(function (s) { s.classList.remove('on'); });
    el.classList.add('on');
  }

  var planeReady = false;
  var prevPx = null;          // last sampled position
  var smDx = 0, smDy = 0;     // smoothed motion vector (EMA)
  var currentState = 'slightly-down-right';
  var candidateState = currentState, candidateCount = 0;
  var STABLE_FRAMES = 3;      // hysteresis: hold a candidate this long before committing
  var MOVE_EPS = 0.6;         // ignore sub-pixel jitter

  function renderPlane(frac) {
    if (!plane || reduce) return;
    var p = planePosPx(frac);

    // position (centre-anchored so asset swaps never make it jump)
    var w = plane.offsetWidth || 84, h = plane.offsetHeight || 84;
    var rawDx = prevPx ? (p.x - prevPx.x) : 0;
    var rawDy = prevPx ? (p.y - prevPx.y) : 0;
    prevPx = p;

    // only update the flight state when there is real movement
    if (Math.abs(rawDx) > MOVE_EPS || Math.abs(rawDy) > MOVE_EPS) {
      smDx = lerp(smDx, rawDx, 0.35);
      smDy = lerp(smDy, rawDy, 0.35);
      if (Math.abs(smDx) > 0.05 || Math.abs(smDy) > 0.05) {
        var want = getFlightState(smDx, smDy);
        if (want === currentState) { candidateCount = 0; candidateState = want; }
        else if (want === candidateState) {
          if (++candidateCount >= STABLE_FRAMES) { currentState = want; candidateCount = 0; }
        } else { candidateState = want; candidateCount = 1; }
      }
    }
    setPlaneAsset(currentState);

    // subtle micro-tilt only (±2.5°), derived from the smoothed vector
    var tilt = clamp(Math.atan2(smDy, Math.abs(smDx) + 0.0001) * 180 / Math.PI * 0.06, -2.5, 2.5);

    plane.style.transform = 'translate(' + (p.x - w / 2) + 'px,' + (p.y - h / 2) + 'px) rotate(' + tilt.toFixed(2) + 'deg)';
    if (!planeReady) { setPlaneAsset(currentState); planeReady = true; }
    if (!plane.classList.contains('lit')) plane.classList.add('lit');
  }

  /* ---- master scroll ---- */
  var bar = document.getElementById('scrollbar');

  function getScroll() {
    return (document.scrollingElement && document.scrollingElement.scrollTop) ||
      window.pageYOffset || doc.scrollTop || (document.body && document.body.scrollTop) || 0;
  }

  function onScroll() {
    var st = getScroll();
    var max = doc.scrollHeight - vh();
    var frac = max > 0 ? st / max : 0;
    if (bar) bar.style.width = (frac * 100) + '%';

    checkReveals();

    if (!reduce) {
      renderTransform(tfProgress());
      renderPlane(frac);
      if (steps.length) {
        var center = vh() * 0.5, best = 1, bestDist = Infinity;
        steps.forEach(function (s) {
          var r = s.getBoundingClientRect();
          var c = r.top + r.height / 2;
          var d = Math.abs(c - center);
          if (r.top < vh() * 0.85 && d < bestDist) { bestDist = d; best = parseInt(s.getAttribute('data-step'), 10); }
        });
        setActiveStep(best);
      }
    }

    // High-contrast preview: flip the accessibility section while it sits
    // near the viewport centre (works regardless of reduced-motion).
    if (a11ySection) {
      var ar = a11ySection.getBoundingClientRect();
      var secCenter = ar.top + ar.height / 2;
      var dist = Math.abs(secCenter - vh() * 0.5);
      var on = dist < vh() * 0.30 && ar.top < vh() * 0.9 && ar.bottom > vh() * 0.1;
      a11ySection.classList.toggle('hc', on);
    }
    ticking = false;
  }
  var ticking = false;
  var lastScroll = -1, lastH = -1;
  function loop() {
    var st = getScroll();
    var h = doc.scrollHeight;
    if (st !== lastScroll || h !== lastH) { lastScroll = st; lastH = h; onScroll(); }
    requestAnimationFrame(loop);
  }
  window.addEventListener('resize', function () { lastH = -1; onScroll(); });
  // Direct event bindings (work even if rAF is throttled); loop covers the rest.
  ['scroll', 'wheel', 'touchmove'].forEach(function (ev) {
    window.addEventListener(ev, onScroll, { passive: true });
    document.addEventListener(ev, onScroll, { passive: true });
  });

  /* ---- reduced-motion end states ---- */
  function setReducedStates() {
    if (tfOld) { tfOld.style.transform = 'translateX(-130%)'; tfOld.style.opacity = '0'; }
    if (tfNew) { tfNew.style.transform = 'none'; tfNew.style.opacity = '1'; }
    if (tfWave) tfWave.style.transform = 'translate(-50%,-50%) scale(1.05)';
    setActiveStep(5);
    if (modal) modal.classList.add('in');
    if (scribble) drawScribble();
    revealEls.forEach(function (el) { el.classList.add('in'); });
    counters.forEach(animateCount);
  }

  /* ---- boot ---- */
  if (reduce) setReducedStates();
  onScroll();
  requestAnimationFrame(onScroll);
  setTimeout(onScroll, 250);
  window.addEventListener('load', onScroll);
  requestAnimationFrame(loop);
})();
