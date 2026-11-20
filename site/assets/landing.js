'use strict';
// Landing page motion: the hero illustration loop, scroll-driven reveals, light parallax, the
// timeline that draws, counters and the seed preview. Everything stops on the reduced-motion path
// (the system setting or the site's Motion setting) and shows its end state instead.
(function () {
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
  const root = document.documentElement;
  const sysReduce = matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => {
    const m = root.getAttribute('data-reduce-motion');
    if (m === 'true') return true;
    if (m === 'false') return false;
    return sysReduce.matches;
  };

  // ---------- hero loop: about 14 seconds ----------
  // Beats: 0 cards in, 1 creating, 2 running with its IP, 3 a build runs, 4 passed and the receipt
  // arrives (also the poster frame), 5 reset to baseline, then the loop starts again.
  const stage = $('.hero-stage');
  const pauseBtn = $('.stage-pause');
  const BEATS = [[0, 0], [1200, 1], [3600, 2], [5200, 3], [8000, 4], [12000, 5], [13600, 0]];
  const LOOP = 14000;
  let timers = [], running = false, paused = false, visible = true;
  const setBeat = (b) => { if (stage) stage.dataset.beat = String(b); };
  function clear() { timers.forEach(clearTimeout); timers = []; }
  function loop() {
    clear();
    for (const [t, b] of BEATS) timers.push(setTimeout(() => setBeat(b), t));
    timers.push(setTimeout(loop, LOOP));
  }
  function sync() {
    const want = !!stage && !reduced() && !paused && visible && !document.hidden;
    if (want && !running) { running = true; loop(); }
    else if (!want && running) { running = false; clear(); setBeat(4); }
    else if (!want) setBeat(4);
  }
  if (stage) {
    if (!reduced()) { stage.classList.add('intro'); setTimeout(() => stage.classList.remove('intro'), 2200); }
    if (pauseBtn) {
      pauseBtn.hidden = reduced();
      pauseBtn.addEventListener('click', () => {
        paused = !paused;
        pauseBtn.setAttribute('aria-pressed', String(paused));
        $('.stage-pause-label', pauseBtn).textContent = paused ? 'Play animation' : 'Pause animation';
        sync();
      });
    }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((es) => { visible = es[0].isIntersecting; sync(); }, { threshold: 0.05 }).observe(stage);
    }
    document.addEventListener('visibilitychange', sync);
  }

  // ---------- reveals, the timeline and counters ----------
  const targets = $$('.reveal, .reveal-s, .steps3, [data-count]');
  let io = null;
  function counter(el) {
    const n = +el.dataset.count;
    if (!n || reduced()) { el.textContent = String(n); return; }
    const t0 = performance.now(), dur = 900;
    const tick = (t) => { const k = Math.min(1, (t - t0) / dur); el.textContent = String(Math.round(n * (1 - Math.pow(1 - k, 3)))); if (k < 1) requestAnimationFrame(tick); };
    el.textContent = '0';
    requestAnimationFrame(tick);
  }
  function show(el) {
    if (el.matches('.steps3')) el.classList.add('drawn');
    else if (el.matches('[data-count]')) { if (!el.dataset.done) { el.dataset.done = '1'; counter(el); } }
    else el.classList.add('in');
  }
  function armReveals() {
    if (io) { io.disconnect(); io = null; }
    if (reduced() || !('IntersectionObserver' in window)) { targets.forEach(show); return; }
    io = new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting) { show(e.target); io.unobserve(e.target); }
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });
    for (const el of targets) {
      const done = el.classList.contains('in') || el.classList.contains('drawn') || el.dataset.done;
      if (!done) io.observe(el);
    }
  }

  // ---------- light parallax on the feature visuals ----------
  const pars = $$('.par');
  let ticking = false;
  function parallax() {
    ticking = false;
    if (reduced()) { for (const p of pars) p.style.removeProperty('--py'); return; }
    const vh = innerHeight;
    for (const p of pars) {
      const r = p.parentElement.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh) continue;
      const k = (r.top + r.height / 2 - vh / 2) / vh; // -1 .. 1 around the middle of the screen
      p.style.setProperty('--py', (k * -28).toFixed(1) + 'px');
    }
  }
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(parallax); } }, { passive: true });

  // ---------- motion switch ----------
  function applyMotion() {
    root.classList.toggle('motion-ok', !reduced());
    if (pauseBtn) pauseBtn.hidden = reduced();
    armReveals();
    parallax();
    sync();
  }
  sysReduce.addEventListener('change', applyMotion);
  new MutationObserver(applyMotion).observe(root, { attributes: true, attributeFilter: ['data-reduce-motion'] });
  applyMotion();

  // ---------- seed preview on the Material 3 card ----------
  const demo = $('.seed-demo');
  for (const b of $$('.swatch')) {
    b.addEventListener('click', () => {
      for (const o of $$('.swatch')) o.setAttribute('aria-pressed', String(o === b));
      if (demo) demo.style.setProperty('--seed', b.dataset.seed);
      if (window.MVL && window.MVL.toast) window.MVL.toast('Seed preview: ' + b.getAttribute('aria-label') + '. The apps use it for every colour role.');
    });
  }

  // ---------- FAQ: one answer open at a time, also where details[name] is not supported ----------
  const qs = $$('.faq details');
  for (const d of qs) d.addEventListener('toggle', () => { if (d.open) for (const o of qs) if (o !== d && o.open) o.open = false; });
})();
