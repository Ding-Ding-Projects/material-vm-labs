'use strict';
// Animation and transition editor. Every animated element kind has its own settings, written to
// CSS custom properties (--mv-<kind>-dur, -delay, -stagger, -ease, -dist, -scale, -on) that the
// stylesheet reads. Reduced motion (operating system or the app's own switch) always wins.
(function () {
  const KEY = 'mvl-motion';
  const KINDS = [
    ['page', 'Page entry'], ['list', 'List stagger'], ['card', 'Cards'], ['dialog', 'Dialogs'], ['menu', 'Menus'],
    ['sheet', 'Sheets'], ['tooltip', 'Tooltips'], ['toast', 'Toasts'], ['switch', 'Switches'], ['chart', 'Charts'],
    ['progress', 'Progress'], ['pulse', 'Live pulses'], ['tab', 'Tab changes'], ['hover', 'Hover lift'], ['takeover', 'Install takeovers']
  ];
  const EASINGS = {
    standard: 'cubic-bezier(.2, 0, 0, 1)',
    emphasized: 'cubic-bezier(.05, .7, .1, 1)',
    spring: 'cubic-bezier(.34, 1.56, .64, 1)',
    linear: 'linear'
  };
  const BASE = { on: true, dur: 300, delay: 0, stagger: 40, ease: 'emphasized', dist: 16, scale: 0.94 };
  const PROFILES = {
    Calm: { speed: 1.4, over: { dur: 220, dist: 8, scale: 0.98, ease: 'standard', stagger: 20 } },
    Standard: { speed: 1, over: {} },
    Expressive: { speed: 1, over: { dur: 420, dist: 24, scale: 0.9, ease: 'spring', stagger: 50 } },
    Playful: { speed: 0.85, over: { dur: 520, dist: 36, scale: 0.84, ease: 'spring', stagger: 70 } }
  };
  const DEFAULT_PROFILE = 'Expressive';

  function profileState(name) {
    const p = PROFILES[name] || PROFILES[DEFAULT_PROFILE];
    const kinds = {};
    for (const [k] of KINDS) kinds[k] = Object.assign({}, BASE, p.over);
    kinds.takeover = Object.assign({}, kinds.takeover, { dur: Math.max(kinds.takeover.dur, 500) });
    return { master: true, speed: p.speed, profile: name, kinds, custom: {} };
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s && s.kinds) { const d = profileState(DEFAULT_PROFILE); for (const [k] of KINDS) s.kinds[k] = Object.assign({}, d.kinds[k], s.kinds[k]); return s; }
    } catch { /* fall through to defaults */ }
    return profileState(DEFAULT_PROFILE);
  }
  let state = load();
  const listeners = new Set();

  function reducedByAccessibility() {
    const os = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const app = document.documentElement.dataset.reduceMotion;
    return app === 'true' || (os && app !== 'false');
  }

  function apply() {
    const root = document.documentElement.style;
    const off = !state.master || reducedByAccessibility();
    for (const [k] of KINDS) {
      const c = state.kinds[k], on = c.on && !off;
      const f = 1 / Math.max(0.1, state.speed);
      root.setProperty(`--mv-${k}-on`, on ? '1' : '0');
      root.setProperty(`--mv-${k}-dur`, on ? Math.round(c.dur * f) + 'ms' : '0ms');
      root.setProperty(`--mv-${k}-delay`, on ? Math.round(c.delay * f) + 'ms' : '0ms');
      root.setProperty(`--mv-${k}-stagger`, on ? Math.round(c.stagger * f) + 'ms' : '0ms');
      root.setProperty(`--mv-${k}-ease`, EASINGS[c.ease] || c.ease || EASINGS.standard);
      root.setProperty(`--mv-${k}-dist`, on ? c.dist + 'px' : '0px');
      root.setProperty(`--mv-${k}-scale`, on ? String(c.scale) : '1');
    }
    document.documentElement.dataset.motion = off ? 'off' : 'on';
    for (const f of listeners) { try { f(); } catch { /* ignore */ } }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage may be unavailable */ } apply(); }

  function setProfile(name) {
    if (state.custom && state.custom[name]) state = Object.assign(JSON.parse(JSON.stringify(state.custom[name])), { custom: state.custom, profile: name });
    else state = Object.assign(profileState(name), { custom: state.custom || {} });
    save();
  }
  function exportJson() { const { custom, ...rest } = state; return JSON.stringify({ format: 'material-vm-labs-motion', version: 1, ...rest }, null, 2); }
  function importJson(text) {
    let d; try { d = JSON.parse(text); } catch { return { ok: false, error: 'The file is not valid JSON.' }; }
    if (!d || d.format !== 'material-vm-labs-motion' || !d.kinds) return { ok: false, error: 'This is not a motion settings file.' };
    const next = profileState(DEFAULT_PROFILE);
    for (const [k] of KINDS) {
      const c = d.kinds[k]; if (!c) continue;
      const n = next.kinds[k];
      if (typeof c.on === 'boolean') n.on = c.on;
      for (const f of ['dur', 'delay', 'stagger', 'dist']) if (Number.isFinite(c[f]) && c[f] >= 0 && c[f] <= 5000) n[f] = c[f];
      if (Number.isFinite(c.scale) && c.scale >= 0.5 && c.scale <= 1.5) n.scale = c.scale;
      if (typeof c.ease === 'string' && (EASINGS[c.ease] || /^cubic-bezier\([\d.,\s-]+\)$/.test(c.ease))) n.ease = c.ease;
    }
    next.master = d.master !== false; next.speed = Number.isFinite(d.speed) && d.speed > 0 && d.speed <= 4 ? d.speed : 1;
    next.profile = 'Imported'; next.custom = state.custom || {};
    state = next; save(); return { ok: true };
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // The editor: a self-contained element for any settings surface.
  function editor() {
    const box = document.createElement('section');
    box.className = 'motion-editor';
    box.setAttribute('aria-label', 'Animation and transition editor');
    function render() {
      const reduced = reducedByAccessibility();
      const names = Object.keys(PROFILES).concat(Object.keys(state.custom || {}));
      box.innerHTML = `<h3 class="me-title">Animation and transitions</h3>
<p class="me-help">Tune how every kind of element moves. Changes apply at once. Reduced motion always wins over these settings.</p>
${reduced ? '<p class="warn" role="status">Reduced motion is on, so nothing moves right now. Your settings are kept for when it is off.</p>' : ''}
<label class="switch-row"><span>All animations</span><input type="checkbox" role="switch" data-me="master" ${state.master ? 'checked' : ''}></label>
<label class="me-range">Global speed <output>${state.speed.toFixed(2)}x</output><input type="range" min="0.25" max="3" step="0.05" value="${state.speed}" data-me="speed" aria-label="Global speed"></label>
<div class="me-profiles" role="group" aria-label="Motion profile">${names.map((n) => `<button type="button" class="chipbtn" data-me-profile="${esc(n)}" aria-pressed="${state.profile === n}">${esc(n)}</button>`).join('')}</div>
<div class="row"><button type="button" class="btn sm" data-me-act="save">Save as my profile</button><button type="button" class="btn sm" data-me-act="reset">Reset all</button><button type="button" class="btn sm" data-me-act="export">Export JSON</button><label class="btn sm">Import JSON<input type="file" accept=".json,application/json" class="sr" data-me-act="import"></label></div>
<p class="small" role="status" data-me-status></p>
<div class="me-kinds">${KINDS.map(([k, label]) => { const c = state.kinds[k]; return `<details class="me-kind" data-kind="${k}"><summary><span>${esc(label)}</span><span class="me-demo me-demo-${k}" aria-hidden="true"></span><input type="checkbox" role="switch" aria-label="${esc(label)} on" data-k="on" ${c.on ? 'checked' : ''}></summary>
<div class="me-grid">
<label>Duration <output>${c.dur} ms</output><input type="range" min="0" max="1500" step="10" value="${c.dur}" data-k="dur"></label>
<label>Delay <output>${c.delay} ms</output><input type="range" min="0" max="800" step="10" value="${c.delay}" data-k="delay"></label>
<label>Stagger <output>${c.stagger} ms</output><input type="range" min="0" max="300" step="5" value="${c.stagger}" data-k="stagger"></label>
<label>Distance <output>${c.dist} px</output><input type="range" min="0" max="80" step="1" value="${c.dist}" data-k="dist"></label>
<label>Scale <output>${c.scale}</output><input type="range" min="0.5" max="1.2" step="0.01" value="${c.scale}" data-k="scale"></label>
<label>Easing<select data-k="ease">${Object.keys(EASINGS).map((e) => `<option value="${e}" ${c.ease === e ? 'selected' : ''}>${e}</option>`).join('')}${EASINGS[c.ease] ? '' : `<option value="${esc(c.ease)}" selected>custom</option>`}</select></label>
<label class="me-curve">Curve (cubic-bezier x1, y1, x2, y2)<input data-k="curve" value="${esc((EASINGS[c.ease] || c.ease).replace(/^cubic-bezier\(|\)$/g, ''))}" spellcheck="false"></label>
<svg class="me-curve-view" viewBox="-10 -40 120 160" aria-hidden="true"><path d="${curvePath(c.ease)}" fill="none" stroke="currentColor" stroke-width="3"/></svg>
<div class="row"><button type="button" class="btn sm" data-me-preview="${k}">Preview</button><button type="button" class="btn sm" data-me-reset="${k}">Reset this kind</button></div>
</div></details>`; }).join('')}</div>`;
    }
    function curvePath(ease) {
      const m = String(EASINGS[ease] || ease).match(/cubic-bezier\(([^)]+)\)/);
      const [a, b, c, d] = m ? m[1].split(',').map(Number) : [0, 0, 1, 1];
      return `M0 100 C ${a * 100} ${100 - b * 100}, ${c * 100} ${100 - d * 100}, 100 0`;
    }
    const status = (t) => { const s = box.querySelector('[data-me-status]'); if (s) s.textContent = t; };
    box.addEventListener('input', (e) => {
      const t = e.target;
      if (t.dataset.me === 'speed') { state.speed = Number(t.value); t.previousElementSibling.textContent = state.speed.toFixed(2) + 'x'; state.profile = 'Custom'; save(); return; }
      const kind = t.closest('[data-kind]'); if (!kind || !t.dataset.k || t.dataset.k === 'on' || t.dataset.k === 'curve' || t.dataset.k === 'ease') return;
      const c = state.kinds[kind.dataset.kind]; c[t.dataset.k] = Number(t.value);
      const out = t.previousElementSibling; if (out && out.tagName === 'OUTPUT') out.textContent = t.value + (t.dataset.k === 'scale' ? '' : t.dataset.k === 'dist' ? ' px' : ' ms');
      state.profile = 'Custom'; save();
    });
    box.addEventListener('change', async (e) => {
      const t = e.target;
      if (t.dataset.me === 'master') { state.master = t.checked; save(); return; }
      if (t.dataset.meAct === 'import') { const f = t.files && t.files[0]; t.value = ''; if (!f) return; const r = importJson(await f.text()); render(); status(r.ok ? 'Imported.' : 'Refused, nothing changed: ' + r.error); return; }
      const kind = t.closest('[data-kind]'); if (!kind) return;
      const c = state.kinds[kind.dataset.kind];
      if (t.dataset.k === 'on') c.on = t.checked;
      else if (t.dataset.k === 'ease') c.ease = t.value;
      else if (t.dataset.k === 'curve') {
        const v = t.value.split(',').map((x) => Number(x.trim()));
        if (v.length === 4 && v.every(Number.isFinite) && v[0] >= 0 && v[0] <= 1 && v[2] >= 0 && v[2] <= 1) c.ease = `cubic-bezier(${v.join(', ')})`;
        else { status('That curve is not valid: give four numbers, the first and third between 0 and 1.'); return; }
      }
      state.profile = 'Custom'; save(); render();
      const again = box.querySelector(`[data-kind="${kind.dataset.kind}"]`); if (again) again.open = true;
    });
    box.addEventListener('click', (e) => {
      const p = e.target.closest('[data-me-profile]'); if (p) { setProfile(p.dataset.meProfile); render(); status(p.dataset.meProfile + ' profile applied.'); return; }
      const a = e.target.closest('[data-me-act]');
      if (a && a.dataset.meAct === 'reset') { setProfile(DEFAULT_PROFILE); render(); status('Every kind is back to the default.'); return; }
      if (a && a.dataset.meAct === 'save') {
        const name = 'Mine ' + (Object.keys(state.custom || {}).length + 1);
        state.custom = state.custom || {}; const { custom, ...snap } = state; state.custom[name] = JSON.parse(JSON.stringify(snap)); state.profile = name; save(); render(); status(`Saved as ${name}.`); return;
      }
      if (a && a.dataset.meAct === 'export') {
        const blob = new Blob([exportJson()], { type: 'application/json' }); const url = URL.createObjectURL(blob);
        const link = document.createElement('a'); link.href = url; link.download = 'motion-settings.json'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        status('Exported motion-settings.json.'); return;
      }
      const r = e.target.closest('[data-me-reset]');
      if (r) { state.kinds[r.dataset.meReset] = Object.assign({}, profileState(DEFAULT_PROFILE).kinds[r.dataset.meReset]); save(); render(); status('That kind is back to the default.'); return; }
      const pv = e.target.closest('[data-me-preview]');
      if (pv) { const d = box.querySelector('.me-demo-' + pv.dataset.mePreview); if (d) { d.classList.remove('play'); void d.offsetWidth; d.classList.add('play'); } }
    });
    render();
    listeners.add(() => { if (!box.isConnected) return; });
    return box;
  }

  // List stagger: each list item learns its position so the stagger delay can grow with it.
  const ITEM = '.mcard, .task, .cardlink, div.run, .gh-opt, .stat';
  function index(root) {
    const items = root.matches && root.matches(ITEM) ? [root] : [];
    if (root.querySelectorAll) items.push(...root.querySelectorAll(ITEM));
    for (const el of items) { const i = Array.prototype.indexOf.call(el.parentElement ? el.parentElement.children : [], el); el.style.setProperty('--mv-i', String(Math.min(Math.max(i, 0), 12))); }
  }
  function watchLists() {
    index(document.body);
    new MutationObserver((list) => { for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1) index(n); }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.body) watchLists(); else document.addEventListener('DOMContentLoaded', watchLists);

  if (window.matchMedia) window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', apply);
  new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ['data-reduce-motion'] });
  apply();

  window.MVLMotion = { editor, apply, setProfile, exportJson, importJson, kinds: KINDS.map(([k, l]) => ({ id: k, label: l })), get: () => JSON.parse(JSON.stringify(state)), onChange: (f) => listeners.add(f), reduced: reducedByAccessibility };
})();
