'use strict';
// Infinite colour picker and translator. A continuous saturation and brightness field, hue and opacity
// sliders and free entry in any notation, with a translator across named colours, HEX, HEX8, RGB, HSL,
// HSV, HWB, CIELAB, LCH, OKLab, OKLCH and CMYK. It names the active space and the display gamut, warns
// before clipping (keeping your input), shows contrast, offers the EyeDropper where the platform has
// one, and keeps saved colours that export and import as a file.
// The animated rainbow is one of the choices: a sentinel value (never a colour string, never in the
// saved palette) animated in the stylesheet around the hue wheel, with one global duration derived
// from a speed level, settling on one hue when motion is reduced.
(function () {
  const C = window.MVLPersonalCore;
  const { esc, store, history } = C;
  const PALETTE_KEY = 'mvl-colour-palette', LEVEL_KEY = 'mvl-rainbow-level', ACCENT_KEY = 'mvl-accent';
  const SPACES = ['hex', 'hex8', 'rgb', 'hsl', 'hsv', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'cmyk', 'named'];
  const listeners = new Set();

  // ---------- global rainbow speed ----------
  const level = () => { const n = Number(store.get(LEVEL_KEY, 3)); return Number.isInteger(n) && n >= 1 && n <= 5 ? n : 3; };
  function applyRainbow() {
    document.documentElement.style.setProperty('--mvl-rainbow-duration', C.rainbowSeconds(level()) + 's');
    document.documentElement.style.setProperty('--mvl-rainbow-settled', String(C.RAINBOW_SETTLED_HUE));
  }
  // The hue turns on the root element only while something on screen uses the rainbow.
  function syncRainbow() {
    const ap = window.MVLPersonal && window.MVLPersonal.appearance;
    const used = C.isRainbow(store.get(ACCENT_KEY, '')) || !!document.querySelector('.mvl-rainbow-bg') || !!(ap && Object.values(ap.edits()).some((e) => e && C.isRainbow(e.bg)));
    if (used) document.documentElement.dataset.mvlRainbow = 'on'; else delete document.documentElement.dataset.mvlRainbow;
  }
  function setLevel(n) { store.set(LEVEL_KEY, Math.min(5, Math.max(1, Math.round(n)))); applyRainbow(); for (const f of listeners) { try { f(); } catch { /* ignore */ } } }

  // ---------- app accent (one consumer of the picker) ----------
  function applyAccent() {
    let el = document.getElementById('mvl-accent-style');
    const v = store.get(ACCENT_KEY, '');
    if (!v) { if (el) el.remove(); syncRainbow(); return; }
    let primary, on;
    if (C.isRainbow(v)) { primary = 'hsl(var(--mvl-rainbow-hue) 72% 42%)'; on = '#ffffff'; }
    else { const p = C.parse(v); if (!p) { store.del(ACCENT_KEY); if (el) el.remove(); return; } const c = C.clip(p.color); primary = C.format(c, 'hex'); on = C.contrast(c, { r: 1, g: 1, b: 1, a: 1 }) >= C.contrast(c, { r: 0, g: 0, b: 0, a: 1 }) ? '#ffffff' : '#000000'; }
    if (!el) { el = document.createElement('style'); el.id = 'mvl-accent-style'; document.head.append(el); }
    el.textContent = `:root{--md-sys-color-primary:${primary} !important;--md-sys-color-on-primary:${on} !important;}`;
    syncRainbow();
  }

  // ---------- the picker component ----------
  function picker(opts) {
    opts = opts || {};
    const root = document.createElement('div');
    root.className = 'cp';
    const uid = 'cp' + Math.random().toString(36).slice(2, 7);
    root.innerHTML = `<div class="cp-top">
  <div class="cp-field" data-cp-field role="slider" tabindex="0" aria-label="Saturation and brightness" aria-valuemin="0" aria-valuemax="100" aria-describedby="${uid}-fh"><span class="cp-thumb" data-cp-thumb></span></div>
  <div class="cp-side"><div class="cp-swatch" data-cp-swatch aria-hidden="true"><i></i></div>
  <label class="switch-row cp-rainbow-row"><span>Animated rainbow</span><input type="checkbox" role="switch" data-cp-rainbow></label></div>
</div>
<p class="small" id="${uid}-fh">Arrow keys: left and right change saturation, up and down change brightness. Hold Shift for bigger steps.</p>
<label class="field cp-range"><span>Hue</span><input type="range" min="0" max="360" step="1" data-cp-hue class="cp-hue"></label>
<label class="field cp-range"><span>Opacity</span><input type="range" min="0" max="100" step="1" data-cp-alpha></label>
<div class="row"><label class="field grow"><span>Colour in any notation</span><input type="text" spellcheck="false" autocomplete="off" data-cp-entry></label>
<label class="field"><span>Show as</span><select data-cp-space>${SPACES.map((s) => `<option value="${s}">${esc(C.FORMATS[s].label)}</option>`).join('')}</select></label></div>
<p class="small" data-cp-info role="status"></p>
<div class="warn" data-cp-gamut hidden><p data-cp-gamut-text></p><button type="button" class="btn sm" data-cp-clip>Clip to sRGB and use it</button></div>
<div class="cp-rainbow-speed" data-cp-speed hidden><label class="field cp-range"><span>Rainbow speed, level 1 slowest to 5 fastest (shared by every rainbow)</span><input type="range" min="1" max="5" step="1" data-cp-level></label><p class="small" data-cp-level-text></p></div>
<p class="small" data-cp-contrast></p>
<details class="cp-trans"><summary>Translator</summary><ul class="cp-list" data-cp-list></ul><p class="small">CMYK uses a simple device-independent formula, not a print profile.</p></details>
<div class="row"><button type="button" class="btn" data-cp-eye>Pick from screen</button><span class="small" data-cp-eye-text></span></div>`;
    const $ = (s) => root.querySelector(s);
    const field = $('[data-cp-field]'), thumb = $('[data-cp-thumb]'), hue = $('[data-cp-hue]'), alpha = $('[data-cp-alpha]'), entry = $('[data-cp-entry]'), space = $('[data-cp-space]');
    let hsv = { h: 285, s: 60, v: 70 }, a = 1, rainbow = false, pending = null, shownSpace = opts.space || 'hex';

    const current = () => { const c = C.hsvToRgb(hsv.h, hsv.s, hsv.v, a); return C.clip(c); };
    const value = () => (rainbow ? C.RAINBOW : C.format(current(), a < 1 ? 'hex8' : 'hex'));
    function render(fromEntry) {
      const c = current();
      root.style.setProperty('--cp-hue', String(hsv.h));
      thumb.style.left = hsv.s + '%'; thumb.style.top = (100 - hsv.v) + '%';
      field.setAttribute('aria-valuenow', String(Math.round(hsv.s)));
      field.setAttribute('aria-valuetext', `Saturation ${Math.round(hsv.s)} percent, brightness ${Math.round(hsv.v)} percent`);
      hue.value = String(Math.round(hsv.h)); alpha.value = String(Math.round(a * 100));
      hue.setAttribute('aria-valuetext', Math.round(hsv.h) + ' degrees'); alpha.setAttribute('aria-valuetext', Math.round(a * 100) + ' percent');
      const sw = $('[data-cp-swatch]'); sw.classList.toggle('mvl-rainbow-bg', rainbow); sw.querySelector('i').style.background = rainbow ? '' : C.format(c, 'hex8');
      if (!fromEntry) entry.value = rainbow ? 'Animated rainbow' : (C.format(c, shownSpace) || C.format(c, 'hex'));
      entry.disabled = rainbow; field.setAttribute('aria-disabled', String(rainbow)); hue.disabled = rainbow; alpha.disabled = rainbow;
      $('[data-cp-rainbow]').checked = rainbow;
      syncRainbow();
      $('[data-cp-speed]').hidden = !rainbow;
      $('[data-cp-level]').value = String(level());
      const reduced = document.documentElement.dataset.reduceMotion === 'true' || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      $('[data-cp-level-text]').textContent = 'Level ' + level() + ': one full turn every ' + C.rainbowSeconds(level()) + ' seconds.' + (reduced ? ' Motion is reduced, so every rainbow rests on one violet hue.' : '');
      $('[data-cp-info]').textContent = rainbow ? 'Animated rainbow. It is a special choice rather than a colour, so it is never saved into your colours list.'
        : 'Active space: ' + C.FORMATS[shownSpace].label + '. Display gamut: sRGB.' + (shownSpace === 'named' && !C.format(c, 'named') ? ' This colour has no CSS name.' : '');
      const W = { r: 1, g: 1, b: 1, a: 1 }, K = { r: 0, g: 0, b: 0, a: 1 };
      const surf = C.parse(getComputedStyle(document.documentElement).getPropertyValue('--md-sys-color-surface').trim());
      const grade = (x) => (x >= 7 ? 'AAA' : x >= 4.5 ? 'AA' : x >= 3 ? 'AA large text only' : 'fails');
      const cw = C.contrast(c, W), ck = C.contrast(c, K), cs = surf ? C.contrast(c, surf.color) : null;
      $('[data-cp-contrast]').textContent = rainbow ? 'Contrast changes as the hue turns; check text over it at every hue.' : `Contrast with white ${cw.toFixed(2)}:1 (${grade(cw)}), with black ${ck.toFixed(2)}:1 (${grade(ck)})` + (cs ? `, with this surface ${cs.toFixed(2)}:1 (${grade(cs)}).` : '.') + (a < 1 ? ' Contrast ignores opacity.' : '');
      $('[data-cp-list]').innerHTML = rainbow ? '<li class="small">The rainbow has no single value to translate.</li>' : SPACES.map((s) => { const v = C.format(c, s); return `<li><span class="cp-lab">${esc(C.FORMATS[s].label)}</span><code>${esc(v || 'no name')}</code>${v ? `<button type="button" class="btn sm" data-copy="${esc(v)}" aria-label="Copy ${esc(C.FORMATS[s].label)} ${esc(v)}">Copy</button>` : ''}</li>`; }).join('');
    }
    function emit() { render(); if (opts.onChange) opts.onChange(value()); }
    function setFromColor(c) { const k = C.clip(c), h = C.rgbToHsv(k); hsv = { h: h.s < 0.01 ? hsv.h : h.h, s: h.s, v: h.v }; a = k.a; }
    function set(v) {
      if (C.isRainbow(v)) { rainbow = true; render(); return; }
      const p = C.parse(v); if (!p) return false;
      rainbow = false; setFromColor(p.color); render(); return true;
    }
    function fieldAt(e) { const r = field.getBoundingClientRect(); hsv.s = Math.min(100, Math.max(0, (e.clientX - r.left) / r.width * 100)); hsv.v = Math.min(100, Math.max(0, 100 - (e.clientY - r.top) / r.height * 100)); emit(); }
    field.addEventListener('pointerdown', (e) => { if (rainbow) return; field.setPointerCapture(e.pointerId); fieldAt(e); const mv = (ev) => fieldAt(ev); const up = () => { field.removeEventListener('pointermove', mv); field.removeEventListener('pointerup', up); }; field.addEventListener('pointermove', mv); field.addEventListener('pointerup', up); });
    field.addEventListener('keydown', (e) => {
      if (rainbow) return;
      const st = e.shiftKey ? 10 : 1, k = e.key;
      if (k === 'ArrowLeft') hsv.s = Math.max(0, hsv.s - st); else if (k === 'ArrowRight') hsv.s = Math.min(100, hsv.s + st);
      else if (k === 'ArrowUp') hsv.v = Math.min(100, hsv.v + st); else if (k === 'ArrowDown') hsv.v = Math.max(0, hsv.v - st);
      else if (k === 'Home') hsv.s = 0; else if (k === 'End') hsv.s = 100; else return;
      e.preventDefault(); emit();
    });
    hue.addEventListener('input', () => { hsv.h = Number(hue.value); emit(); });
    alpha.addEventListener('input', () => { a = Number(alpha.value) / 100; emit(); });
    space.value = shownSpace;
    space.addEventListener('change', () => { shownSpace = space.value; render(); });
    entry.addEventListener('change', () => {
      const p = C.parse(entry.value); const g = $('[data-cp-gamut]');
      if (!p) { $('[data-cp-info]').textContent = 'That is not a colour this picker can read. Your text is kept; nothing changed.'; return; }
      if (!C.inGamut(p.color)) {
        pending = p.color;
        $('[data-cp-gamut-text]').textContent = 'This colour is outside the sRGB display gamut. Using it clips it to ' + C.format(C.clip(p.color), 'hex') + '. Your typed value stays in the box until you choose.';
        g.hidden = false; return;
      }
      g.hidden = true; shownSpace = p.space === 'named' ? 'named' : (C.FORMATS[p.space] ? p.space : shownSpace); space.value = shownSpace;
      rainbow = false; setFromColor(p.color); render(true); if (opts.onChange) opts.onChange(value());
    });
    $('[data-cp-clip]').addEventListener('click', () => { if (pending) { setFromColor(pending); pending = null; $('[data-cp-gamut]').hidden = true; emit(); } });
    $('[data-cp-rainbow]').addEventListener('change', (e) => { rainbow = e.target.checked; emit(); });
    $('[data-cp-level]').addEventListener('input', (e) => { setLevel(Number(e.target.value)); render(); });
    root.addEventListener('click', async (e) => { const b = e.target.closest('[data-copy]'); if (b) { try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1200); } catch { b.textContent = 'Copy failed'; } } });
    const eye = $('[data-cp-eye]');
    if ('EyeDropper' in window) {
      eye.addEventListener('click', async () => { try { const r = await new window.EyeDropper().open(); rainbow = false; set(r.sRGBHex); emit(); } catch { $('[data-cp-eye-text]').textContent = 'Cancelled. Nothing changed.'; } });
    } else { eye.disabled = true; $('[data-cp-eye-text]').textContent = 'Unavailable: this platform has no EyeDropper API.'; }
    if (opts.value) set(opts.value); else render();
    listeners.add(() => render());
    return { el: root, get: value, set };
  }

  // ---------- saved colours (presets) ----------
  const palette = () => { const p = store.get(PALETTE_KEY, []); return Array.isArray(p) ? p.filter((v) => !C.isRainbow(v) && C.parse(v)).slice(0, 32) : []; };
  function presets(getValue, setValue) {
    const box = document.createElement('div');
    box.className = 'cp-presets';
    box.innerHTML = `<h4>Your colours</h4><div data-cps-search></div><div class="cp-swatches" data-cps-list role="list"></div><p class="small" data-cps-empty></p>
<div class="row"><button type="button" class="btn" data-cps-save>Save this colour</button><button type="button" class="btn" data-cps-export>Export colours</button><label class="btn personal-file">Import colours<input type="file" accept="application/json,.json" data-cps-import></label><button type="button" class="btn" data-cps-clear>Clear saved colours</button></div><p class="small" role="status" data-cps-status></p>`;
    const $ = (s) => box.querySelector(s);
    const search = window.MVL && window.MVL.makeSearch ? window.MVL.makeSearch({ placeholder: 'Search saved colours', label: 'Search saved colours', onChange: () => draw() }) : null;
    if (search) $('[data-cps-search]').append(search.el);
    function draw() {
      const all = palette(), shown = all.filter((v) => !search || !search.active() || search.test(v + ' ' + (C.format(C.parse(v).color, 'named') || '')));
      $('[data-cps-list]').innerHTML = shown.map((v) => `<button type="button" role="listitem" class="swatch" data-cps-pick="${esc(v)}" aria-label="Use ${esc(v)}" title="${esc(v)}"><i style="background:${esc(v)}"></i></button>`).join('');
      $('[data-cps-empty]').textContent = all.length ? (shown.length ? '' : 'No saved colour matches.') : 'No saved colours yet.';
      if (search) search.setStatus(shown.length + ' of ' + all.length);
    }
    const status = (m) => { $('[data-cps-status]').textContent = m; };
    box.addEventListener('click', async (e) => {
      const p = e.target.closest('[data-cps-pick]'); if (p) { setValue(p.dataset.cpsPick); status('Using ' + p.dataset.cpsPick + '.'); }
      if (e.target.closest('[data-cps-save]')) { const v = getValue(); if (C.isRainbow(v)) { status('The animated rainbow is a special choice and is not saved into your colours list.'); return; } store.set(PALETTE_KEY, C.addToPalette(palette(), v)); history.add('color-picker', 'save', 'Colour saved'); draw(); status('Saved ' + v + '.'); }
      if (e.target.closest('[data-cps-export]')) { C.download('mvl-colours.json', JSON.stringify({ v: 1, kind: 'mvl-colour-presets', colours: palette() }, null, 2)); status('Exported ' + palette().length + ' colours.'); }
      if (e.target.closest('[data-cps-clear]')) {
        const ok = window.MVLSuperConfirm ? await C.confirm({ action: 'Clear every saved colour', affected: palette().length + ' saved colours in this app. Colours already applied stay applied.' }) : true;
        if (ok) { store.set(PALETTE_KEY, []); history.add('color-picker', 'clear', 'Saved colours cleared'); draw(); status('Saved colours cleared.'); }
      }
    });
    $('[data-cps-import]').addEventListener('change', async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      try {
        const d = JSON.parse(await C.readTextFile(f, 64 * 1024));
        if (!d || d.v !== 1 || d.kind !== 'mvl-colour-presets' || !Array.isArray(d.colours)) throw new Error('This is not a Material VM Labs colours file.');
        const bad = d.colours.filter((v) => typeof v !== 'string' || !C.parse(v));
        if (bad.length) throw new Error(bad.length + ' entries are not readable colours, so nothing was imported.');
        let p = palette(); for (const v of d.colours) p = C.addToPalette(p, v);
        store.set(PALETTE_KEY, p); history.add('color-picker', 'import', 'Colours imported'); draw(); status('Imported ' + d.colours.length + ' colours.');
      } catch (ex) { status('Nothing was imported: ' + ex.message); }
    });
    draw();
    return box;
  }

  function control() {
    const box = document.createElement('section');
    box.className = 'personal-card personal-color';
    const id = 'pc-' + Math.random().toString(36).slice(2, 7);
    box.setAttribute('aria-labelledby', id);
    box.innerHTML = `<h3 id="${id}">Colour picker and accent</h3><p class="small">Pick any colour, translate it between notations, or use it as the app accent.</p><div data-pc-picker></div><div class="row"><button type="button" class="btn primary" data-pc-accent>Use as the app accent</button><button type="button" class="btn" data-pc-reset>Reset the accent</button></div><p class="small" role="status" data-pc-status></p><div data-pc-presets></div>`;
    const p = picker({ value: store.get(ACCENT_KEY, '') || getComputedStyle(document.documentElement).getPropertyValue('--md-sys-color-primary').trim() || '#6750a4' });
    box.querySelector('[data-pc-picker]').append(p.el);
    box.querySelector('[data-pc-presets]').append(presets(p.get, (v) => p.set(v)));
    const st = box.querySelector('[data-pc-status]');
    box.querySelector('[data-pc-accent]').addEventListener('click', () => { store.set(ACCENT_KEY, p.get()); applyAccent(); history.add('color-picker', 'accent', 'App accent set'); st.textContent = C.isRainbow(p.get()) ? 'The accent is now the animated rainbow.' : 'The accent is now ' + p.get() + '.'; });
    box.querySelector('[data-pc-reset]').addEventListener('click', () => { store.del(ACCENT_KEY); applyAccent(); history.add('color-picker', 'accent-reset', 'App accent reset'); st.textContent = 'The accent follows the seed colour again.'; });
    return box;
  }

  function init() {
    applyRainbow(); applyAccent();
    setInterval(syncRainbow, 4000);
    if (window.MVLTools) window.MVLTools.register({ id: 'personal-color', title: 'Colour picker', group: 'Personal', summary: 'Infinite picker, translator, rainbow and saved colours.', mount(el) { const c = control(); c.classList.add('in-tool'); el.append(c); } });
  }

  window.MVLPersonal = window.MVLPersonal || {};
  window.MVLPersonal.color = { init, control, picker, presets, setRainbowLevel: setLevel, syncRainbow, rainbowLevel: level, palette };
  if (document.head) init(); else document.addEventListener('DOMContentLoaded', init, { once: true });
})();
