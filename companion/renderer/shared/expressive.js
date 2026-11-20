'use strict';
// Expressive motion helpers shared by the three companions. Every duration and easing is read from
// the --mv-<kind>-* properties that the animation and transition editor (motion.js) writes, so the
// editor, its master switch and reduced motion (system or app) all apply: when motion is off the
// helpers do nothing and every element simply shows its final state.
// - The rail indicator: one pill behind the selected destination that stretches as it travels.
// - Shared-axis page changes: the page that appears slides in from the side of its destination.
// - Container transform: a card grows into the page it opens.
// - Morph: a button (the Create machine FAB) grows into the sheet it opens.
// - Pulse: a live number that changed pulses once.
(function () {
  const root = document.documentElement;
  const css = (name) => getComputedStyle(root).getPropertyValue(name).trim();
  function still() {
    if (root.dataset.motion === 'off' || root.dataset.reduceMotion === 'true') return true;
    const os = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return os && root.dataset.reduceMotion !== 'false';
  }
  function dur(kind, factor) {
    if (still() || !Element.prototype.animate) return 0;
    const v = css('--mv-' + kind + '-dur'); const n = parseFloat(v);
    if (!isFinite(n) || n <= 0) return 0;
    return (/ms$/.test(v) ? n : /s$/.test(v) ? n * 1000 : n) * (factor || 1);
  }
  const ease = (kind) => css('--mv-' + kind + '-ease') || 'cubic-bezier(.2, 0, 0, 1)';
  const px = (kind, fallback) => { const n = parseFloat(css('--mv-' + kind + '-dist')); return isFinite(n) ? n : fallback; };
  const EMPHASIZED = 'cubic-bezier(.2, 0, 0, 1)';
  const DECEL = 'cubic-bezier(.05, .7, .1, 1)';

  // ---------- the stretching rail indicator ----------
  const SELECTED = '[aria-selected="true"], [aria-current="page"], [aria-pressed="true"]';
  function railIndicator(rail) {
    const cells = rail && rail.querySelector('.cells');
    if (!cells || rail.querySelector(':scope > .rail-ind')) return;
    const ind = document.createElement('span');
    ind.className = 'rail-ind'; ind.setAttribute('aria-hidden', 'true');
    rail.prepend(ind); rail.classList.add('has-ind');
    let last = null, frame = 0;
    function place(animate) {
      const sel = cells.querySelector(SELECTED);
      const icon = sel && sel.querySelector(':scope > svg, :scope > b');
      if (!icon || !icon.getClientRects().length) { ind.style.opacity = '0'; last = null; return; }
      const r = icon.getBoundingClientRect(), rr = rail.getBoundingClientRect();
      const x = Math.round(r.left - rr.left + rail.scrollLeft), y = Math.round(r.top - rr.top + rail.scrollTop);
      ind.style.width = r.width + 'px'; ind.style.height = r.height + 'px';
      ind.style.transform = `translate(${x}px, ${y}px)`; ind.style.opacity = '1';
      const d = dur('tab', 1.6);
      if (animate && last && d && (last.x !== x || last.y !== y)) {
        const vertical = Math.abs(y - last.y) >= Math.abs(x - last.x);
        const stretch = vertical ? 'scale(.72, 1.9)' : 'scale(1.6, .72)';
        ind.animate([
          { transform: `translate(${last.x}px, ${last.y}px)` },
          { transform: `translate(${(x + last.x) / 2}px, ${(y + last.y) / 2}px) ${stretch}`, offset: 0.45 },
          { transform: `translate(${x}px, ${y}px)` }
        ], { duration: d, easing: ease('tab') });
      }
      last = { x, y };
    }
    let pending = false;
    const later = (animate) => { pending = pending || animate; cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { const a = pending; pending = false; place(a); }); };
    // Anything in the rail can move the selected destination (the gauge above it grows, labels
    // change language), so every change re-measures; only a new selection travels.
    let selKey = null;
    const selNow = () => { const el = cells.querySelector(SELECTED); return el ? (el.id || el.dataset.tab || el.dataset.act || el.getAttribute('href') || el.textContent) : null; };
    new MutationObserver(() => { const k = selNow(); later(k !== selKey); selKey = k; }).observe(rail, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-selected', 'aria-current', 'aria-pressed', 'hidden', 'class'] });
    selKey = selNow();
    window.addEventListener('resize', () => later(false));
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => later(false));
    if (window.ResizeObserver) new ResizeObserver(() => later(false)).observe(rail);
    later(false);
  }

  // ---------- shared-axis page changes ----------
  // container: the element whose child panels ([role=tabpanel]) are shown one at a time.
  function pageAxis(container, rail) {
    if (!container) return;
    const shown = () => [...container.children].find((c) => c.getAttribute('role') === 'tabpanel' && !c.hidden) || null;
    const order = () => { const tabs = rail ? [...rail.querySelectorAll('.cells [role="tab"]')] : []; return tabs.findIndex((t) => t.matches(SELECTED)); };
    let cur = shown(), idx = order(), queued = false;
    new MutationObserver(() => {
      if (queued) return; queued = true;
      queueMicrotask(() => {
        queued = false;
        const v = shown(); if (!v || v === cur) return;
        const i = order(); const dir = i >= idx ? 1 : -1;
        cur = v; idx = i;
        if (v.dataset.mvTransform) { delete v.dataset.mvTransform; return; } // a container transform runs instead
        const d = dur('page', 1.5); if (!d) return;
        const dist = Math.max(32, px('page', 24) * 2.6) * dir;
        v.animate([
          { opacity: 0, transform: `translateX(${dist}px)` },
          { opacity: 0, offset: 0.25 },
          { opacity: 1, transform: 'none' }
        ], { duration: d, easing: EMPHASIZED });
      });
    }).observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  }

  // ---------- container transform: a card grows into its page ----------
  // from: the card's rectangle measured before the page changed; el: the page now shown.
  function containerTransform(from, el, opts) {
    if (!from || !el) return;
    el.dataset.mvTransform = '1';
    const d = dur('card', 2);
    if (!d) { delete el.dataset.mvTransform; return; }
    const scroller = document.scrollingElement || document.documentElement;
    if (scroller.scrollTop) scroller.scrollTop = 0;
    const to = el.getBoundingClientRect();
    const t = Math.max(0, from.top - to.top), l = Math.max(0, from.left - to.left);
    const r = Math.max(0, to.right - from.right), b = Math.max(0, to.bottom - from.bottom);
    const card = (opts && opts.color) || css('--md-sys-color-surface-container-low');
    const page = css('--md-sys-color-surface');
    el.animate([
      { clipPath: `inset(${t}px ${r}px ${b}px ${l}px round 32px)`, backgroundColor: card },
      { clipPath: 'inset(0px 0px 0px 0px round 36px)', backgroundColor: page }
    ], { duration: d, easing: EMPHASIZED });
    let i = 0;
    for (const c of el.children) {
      c.animate([{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 0, offset: 0.35 }, { opacity: 1, transform: 'none' }],
        { duration: d * 0.9, delay: Math.min(i, 6) * Math.min(60, d / 12), easing: DECEL, fill: 'backwards' });
      i++;
    }
    setTimeout(() => { delete el.dataset.mvTransform; }, 50);
  }

  // ---------- morph: a button grows into the sheet it opens ----------
  function morph(fromEl, sheet) {
    if (!fromEl || !sheet || !fromEl.getClientRects().length) return;
    const d = dur('sheet', 1.7); if (!d) return;
    const a = fromEl.getBoundingClientRect(), z = sheet.getBoundingClientRect();
    if (!z.width || !z.height) return;
    const fs = getComputedStyle(fromEl);
    sheet.classList.add('mv-morphing');
    // The scrim only darkens behind the growing sheet; it does not fade the sheet itself.
    const scrim = sheet.parentElement;
    if (scrim && scrim.classList.contains('scrim')) { scrim.style.animation = 'none'; scrim.animate([{ backgroundColor: 'rgba(0, 0, 0, 0)' }], { duration: d * 0.6, easing: 'linear' }); }
    const sx = a.width / z.width, sy = a.height / z.height;
    const dx = a.left - z.left, dy = a.top - z.top;
    const anim = sheet.animate([
      { transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, borderRadius: `${22 / sx}px / ${22 / sy}px`, backgroundColor: fs.backgroundColor, boxShadow: fs.boxShadow },
      { transformOrigin: '0 0', transform: 'none', borderRadius: getComputedStyle(sheet).borderRadius }
    ], { duration: d, easing: EMPHASIZED });
    let i = 0;
    for (const c of sheet.children) {
      if (c.classList.contains('pn-h')) continue;
      c.animate([{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 0, offset: 0.45 }, { opacity: 1, transform: 'none' }],
        { duration: d, delay: Math.min(i++, 8) * Math.min(28, d / 20), easing: DECEL, fill: 'backwards' });
    }
    anim.finished.then(() => sheet.classList.remove('mv-morphing'), () => sheet.classList.remove('mv-morphing'));
  }

  // ---------- a live value that changed pulses once ----------
  function pulse(el) {
    if (!el || still()) return;
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
    el.addEventListener('animationend', () => el.classList.remove('bump'), { once: true });
  }

  function init() {
    for (const rail of document.querySelectorAll('.rail')) railIndicator(rail);
    const panels = document.getElementById('panels');
    if (panels) pageAxis(panels, document.querySelector('.rail'));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else setTimeout(init);

  window.MVLExpressive = { railIndicator, pageAxis, containerTransform, morph, pulse, still, dur };
})();
