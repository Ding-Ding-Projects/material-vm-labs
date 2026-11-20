'use strict';
// Shared panel behaviour for every companion:
// - collapsible(): a filter row, search bar or statistics strip that collapses behind a labelled toggle,
//   remembers its state, and says which filters are still active while it is collapsed.
// - dockable(): a panel that docks to the top or bottom of the content or floats, resizes from its
//   edges and corners, drags by its header, has a keyboard path for both, remembers its size and
//   place, stays inside the window when the window shrinks, and resets to its default.
// - sizable(): a single resize edge for a sheet or side sheet, with the same keyboard path.
(function () {
  const store = {
    get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable: the state lasts for this session */ } }
  };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const CHEVRON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"></path></svg>';

  // ---------- collapsible areas ----------
  // o: { id, label, content: Element, startCollapsed, summary: () => string }
  function collapsible(o) {
    const key = 'mvl.collapse.' + o.id;
    const saved = store.get(key);
    let collapsed = saved && typeof saved.collapsed === 'boolean' ? saved.collapsed : !!o.startCollapsed;
    const wrap = document.createElement('div');
    wrap.className = 'mvl-collapse';
    wrap.dataset.collapse = o.id;
    const bodyId = 'mvlc-' + o.id;
    wrap.innerHTML = `<div class="cbar"><button type="button" class="ctoggle" aria-controls="${bodyId}">${CHEVRON}<span class="clabel"></span></button><span class="csum" role="status"></span></div><div class="cbody" id="${bodyId}"></div>`;
    const btn = wrap.querySelector('.ctoggle'), lbl = wrap.querySelector('.clabel'), sum = wrap.querySelector('.csum'), body = wrap.querySelector('.cbody');
    if (o.content) body.append(o.content);
    function refresh() {
      const s = o.summary ? String(o.summary() || '') : '';
      sum.textContent = collapsed ? s : '';
      sum.hidden = !collapsed || !s;
    }
    function apply() {
      btn.setAttribute('aria-expanded', String(!collapsed));
      lbl.textContent = o.label;
      btn.title = (collapsed ? 'Show ' : 'Hide ') + o.label.toLowerCase();
      body.hidden = collapsed;
      wrap.classList.toggle('collapsed', collapsed);
      refresh();
    }
    function set(c) { collapsed = !!c; store.set(key, { collapsed }); apply(); }
    btn.addEventListener('click', () => set(!collapsed));
    apply();
    return { el: wrap, body, refresh, set, collapsed: () => collapsed };
  }

  // ---------- resize handles ----------
  // A handle is a focusable separator. Pointer drag reports dx, dy; arrow keys report 16 px steps (64 with Shift).
  function handle(edge, label, onDelta, onEnd) {
    const h = document.createElement('div');
    h.className = 'pn-h pn-' + edge;
    h.dataset.edge = edge;
    const horizontal = edge === 'n' || edge === 's';
    if (edge.length === 1) {
      h.tabIndex = 0;
      h.setAttribute('role', 'separator');
      h.setAttribute('aria-orientation', horizontal ? 'horizontal' : 'vertical');
      h.setAttribute('aria-label', label);
      h.title = label + '. Drag, or use the arrow keys.';
    } else h.setAttribute('aria-hidden', 'true');
    h.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      let lx = e.clientX, ly = e.clientY;
      try { h.setPointerCapture(e.pointerId); } catch { /* capture is a nicety */ }
      document.documentElement.classList.add('pn-dragging');
      const move = (ev) => { onDelta(ev.clientX - lx, ev.clientY - ly); lx = ev.clientX; ly = ev.clientY; };
      const up = () => { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up); document.documentElement.classList.remove('pn-dragging'); onEnd(); };
      h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
    });
    h.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 64 : 16;
      const map = { ArrowUp: [0, -step], ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] };
      const d = map[e.key]; if (!d) return;
      if (horizontal && d[1] === 0) return;
      if (!horizontal && d[0] === 0) return;
      e.preventDefault(); onDelta(d[0], d[1]); onEnd();
    });
    return h;
  }

  // ---------- one resizable edge (sheets and side sheets) ----------
  // o: { id, edge: 'e'|'w', min, max: () => number, centered, label }
  function sizable(el, o) {
    const key = 'mvl.panel.' + o.id;
    const max = () => (o.max ? o.max() : window.innerWidth - 32);
    let w = (store.get(key) || {}).w || 0;
    const apply = () => { if (w) el.style.width = clamp(w, o.min || 280, Math.max(o.min || 280, max())) + 'px'; };
    const add = () => {
      if (el.querySelector(':scope > .pn-h')) return;
      const h = handle(o.edge, o.label || 'Resize', (dx) => {
        const cur = el.getBoundingClientRect().width;
        const f = o.centered ? 2 : 1;
        w = clamp(cur + (o.edge === 'w' ? -dx : dx) * f, o.min || 280, Math.max(o.min || 280, max()));
        el.style.width = w + 'px';
      }, () => store.set(key, { w }));
      h.addEventListener('dblclick', () => { w = 0; el.style.width = ''; store.set(key, {}); });
      el.classList.add('pn-sizable');
      el.append(h);
    };
    add(); apply();
    const onResize = () => apply();
    window.addEventListener('resize', onResize);
    return { reattach: add, reset() { w = 0; el.style.width = ''; store.set(key, {}); }, dispose() { window.removeEventListener('resize', onResize); } };
  }

  // ---------- dockable panel ----------
  // o: { id, header: Element (drag area), label, place(mode), defaults: { mode, size, w, h }, min: { w, h }, bottomInset: () => px }
  function dockable(el, o) {
    const key = 'mvl.panel.' + o.id;
    const D = Object.assign({ mode: 'top', size: 260, w: 520, h: 320 }, o.defaults || {});
    const MIN = Object.assign({ w: 300, h: 140, size: 120 }, o.min || {});
    let s = Object.assign({}, D, store.get(key) || {});
    if (!['top', 'bottom', 'float'].includes(s.mode)) s.mode = D.mode;
    const label = o.label || 'panel';
    el.classList.add('pn');
    const bounds = () => {
      const r = el.parentElement ? el.parentElement.getBoundingClientRect() : { left: 0 };
      const inset = o.bottomInset ? o.bottomInset() : 0;
      return { W: window.innerWidth, H: window.innerHeight - inset, left: Math.max(0, r.left) };
    };
    function fixFloat() {
      const b = bounds();
      if (s.x == null || s.y == null) { s.w = Math.min(s.w, b.W - 32); s.x = b.W - s.w - 24; s.y = 72; }
      const w = clamp(s.w, Math.min(MIN.w, b.W - 16), b.W - 16), h = clamp(s.h, Math.min(MIN.h, b.H - 16), b.H - 16);
      return { w, h, x: clamp(s.x, 0, b.W - w), y: clamp(s.y, 0, b.H - h) };
    }
    function apply() {
      el.dataset.dock = s.mode;
      if (o.place) o.place(s.mode);
      if (s.mode === 'float') {
        const f = fixFloat();
        Object.assign(el.style, { left: f.x + 'px', top: f.y + 'px', width: f.w + 'px', height: f.h + 'px', maxHeight: '' });
        el.style.removeProperty('--pn-size');
      } else {
        const b = bounds();
        const size = clamp(s.size, MIN.size, Math.max(MIN.size, Math.round(b.H * 0.7)));
        Object.assign(el.style, { left: '', top: '', width: '', height: '' });
        el.style.setProperty('--pn-size', size + 'px');
      }
      for (const h of el.querySelectorAll(':scope > .pn-h')) {
        const e = h.dataset.edge;
        h.hidden = s.mode === 'top' ? e !== 's' : s.mode === 'bottom' ? e !== 'n' : false;
      }
      if (moveBtn) moveBtn.hidden = s.mode !== 'float';
      for (const b of el.querySelectorAll('[data-pn-dock]')) b.setAttribute('aria-pressed', String(b.dataset.pnDock === s.mode));
    }
    const save = () => store.set(key, { mode: s.mode, size: s.size, w: s.w, h: s.h, x: s.x, y: s.y });
    function delta(edge, dx, dy) {
      if (s.mode !== 'float') {
        const cur = Math.min(s.size, el.getBoundingClientRect().height || s.size);
        s.size = Math.max(MIN.size, cur + (s.mode === 'top' ? dy : -dy));
        apply(); return;
      }
      const f = fixFloat(); Object.assign(s, f);
      if (edge.includes('e')) s.w = f.w + dx;
      if (edge.includes('s')) s.h = f.h + dy;
      if (edge.includes('w')) { s.w = f.w - dx; s.x = f.x + dx; }
      if (edge.includes('n')) { s.h = f.h - dy; s.y = f.y + dy; }
      s.w = Math.max(MIN.w, s.w); s.h = Math.max(MIN.h, s.h);
      apply();
    }
    const names = { n: 'top', s: 'bottom', e: 'right', w: 'left' };
    for (const edge of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
      el.append(handle(edge, `Resize the ${label} from its ${names[edge] || edge} edge`, (dx, dy) => delta(edge, dx, dy), save));
    }
    // Moving a floating panel: drag the header, or focus the move button and use the arrow keys.
    let moveBtn = null;
    if (o.header) {
      moveBtn = document.createElement('button');
      moveBtn.type = 'button'; moveBtn.className = 'iconbtn pn-move';
      moveBtn.setAttribute('aria-label', `Move the ${label}. Use the arrow keys`);
      moveBtn.title = `Move the ${label}: drag the header, or use the arrow keys here`;
      moveBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"></path></svg>';
      o.header.prepend(moveBtn);
      moveBtn.addEventListener('keydown', (e) => {
        const step = e.shiftKey ? 64 : 16;
        const m = { ArrowUp: [0, -step], ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] }[e.key];
        if (!m || s.mode !== 'float') return;
        e.preventDefault(); const f = fixFloat(); Object.assign(s, f); s.x += m[0]; s.y += m[1]; apply(); Object.assign(s, fixFloat()); save();
      });
      o.header.addEventListener('pointerdown', (e) => {
        if (s.mode !== 'float' || e.button !== 0) return;
        if (e.target.closest('button:not(.pn-move), a, input, select, textarea')) return;
        e.preventDefault();
        const f = fixFloat(); Object.assign(s, f);
        let lx = e.clientX, ly = e.clientY;
        try { o.header.setPointerCapture(e.pointerId); } catch { /* capture is a nicety */ }
        document.documentElement.classList.add('pn-dragging');
        const move = (ev) => { s.x += ev.clientX - lx; s.y += ev.clientY - ly; lx = ev.clientX; ly = ev.clientY; apply(); };
        const up = () => { o.header.removeEventListener('pointermove', move); o.header.removeEventListener('pointerup', up); o.header.removeEventListener('pointercancel', up); document.documentElement.classList.remove('pn-dragging'); Object.assign(s, fixFloat()); save(); };
        o.header.addEventListener('pointermove', move); o.header.addEventListener('pointerup', up); o.header.addEventListener('pointercancel', up);
      });
    }
    let raf = 0;
    window.addEventListener('resize', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(apply); });
    const api = {
      mode: () => s.mode,
      state: () => Object.assign({}, s),
      dock(mode) { if (!['top', 'bottom', 'float'].includes(mode)) return; if (s.mode === 'float' && mode !== 'float') Object.assign(s, fixFloat()); s.mode = mode; apply(); save(); },
      reset() { s = Object.assign({}, D); store.set(key, null); try { localStorage.removeItem(key); } catch { /* fine */ } apply(); },
      apply
    };
    apply();
    return api;
  }

  window.MVLPanels = { collapsible, dockable, sizable, store };
})();
