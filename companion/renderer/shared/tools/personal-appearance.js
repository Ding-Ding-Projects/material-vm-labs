'use strict';
// Per-element appearance editor. "Edit appearance..." in every element's context menu, or
// Ctrl+Shift+E on the focused element, opens a non-modal editor anchored beside that element. The
// capability matrix below is the single list of what the editor can and cannot do; rows that are not
// built stay visible with the reason. Edits are stored per stable element selector, applied through
// one generated stylesheet, undoable, resettable per property, per element and globally, and export
// and import as a file. Nothing here changes element identity or behaviour.
(function () {
  const C = window.MVLPersonalCore;
  const { esc, store, history } = C;
  const KEY = 'mvl-appearance-edits';
  const ROLES = ['primary', 'primary-container', 'secondary', 'secondary-container', 'tertiary', 'tertiary-container', 'surface', 'surface-container-low', 'surface-container', 'surface-container-high', 'surface-container-highest', 'inverse-surface', 'error', 'error-container'];
  const ON = (r) => (r === 'surface' || r.startsWith('surface-container') ? 'on-surface' : r === 'inverse-surface' ? 'inverse-on-surface' : 'on-' + r);
  // Capability matrix: id, label, status, what it changes or why it is not available.
  const MATRIX = [
    { id: 'radius', label: 'Corner radius', status: 'supported', note: '0 to 48 pixels, applied as border-radius.' },
    { id: 'bg', label: 'Colour role', status: 'supported', note: 'Background from a Material 3 colour role (with its matching text colour), or a custom colour from the infinite picker, including the animated rainbow.' },
    { id: 'elevation', label: 'Elevation', status: 'supported', note: 'Material 3 levels 0 to 5, applied as a shadow.' },
    { id: 'weight', label: 'Type weight', status: 'supported', note: '100 to 900. The bundled Roboto Flex is variable, so every step renders.' },
    { id: 'width', label: 'Type width', status: 'supported', note: '75 to 125 percent through the Roboto Flex width axis. Text in other fonts keeps its normal width.' },
    { id: 'morph', label: 'Shape morph', status: 'supported', note: 'The corner radius morphs to a second shape on hover and keyboard focus. With motion reduced it changes at once.' },
    { id: 'layers', label: 'Layers, masks and blend modes', status: 'unavailable', note: 'Not built yet: this editor has no layer stack, so layered image editing is not offered.' },
    { id: 'states', label: 'Per-state editing (hover, pressed, disabled and others)', status: 'unavailable', note: 'Not built yet: edits apply to the element in every state, except the shape morph target.' },
    { id: 'typography', label: 'Full typography (font family, decoration, spacing)', status: 'unavailable', note: 'Not built yet: only weight and width are editable here.' },
    { id: 'motion', label: 'Animation and transition tracks', status: 'unavailable', note: 'Not built yet: no keyframe or timeline editing. Only the shape morph transition exists.' },
    { id: 'transform', label: 'Transforms, warp and perspective', status: 'unavailable', note: 'Not built yet.' }
  ];
  const listeners = new Set();
  let edits = load();
  const undo = [], redo = [];
  let pop = null, anchor = null, styleEl = null, picking = false;

  function load() { const v = store.get(KEY, {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
  const snapshot = () => JSON.stringify(edits);
  function commit(before, summary) { undo.push(before); if (undo.length > 100) undo.shift(); redo.length = 0; store.set(KEY, edits); history.add('appearance-editor', 'edit', summary); render(); }
  function render() {
    if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = 'mvl-appearance-edits'; document.head.append(styleEl); }
    let css = '';
    for (const sel of Object.keys(edits)) {
      const e = edits[sel]; if (!e || !validSelector(sel)) continue;
      const d = [];
      if (Number.isFinite(e.radius)) d.push(`border-radius:${e.radius}px`);
      if (e.bg) {
        if (C.isRainbow(e.bg)) d.push('background-color:hsl(var(--mvl-rainbow-hue) 72% 45%)', 'color:#fff');
        else if (ROLES.includes(e.bg)) d.push(`background-color:var(--md-sys-color-${e.bg})`, `color:var(--md-sys-color-${ON(e.bg)})`);
        else if (e.bg.startsWith('#')) { const p = C.parse(e.bg); if (p) { const c = C.clip(p.color); d.push('background-color:' + C.format(c, 'hex8'), 'color:' + (C.contrast(c, { r: 1, g: 1, b: 1, a: 1 }) >= C.contrast(c, { r: 0, g: 0, b: 0, a: 1 }) ? '#fff' : '#000')); } }
      }
      if (Number.isFinite(e.elevation)) d.push('box-shadow:' + ['none', 'var(--e1, 0 1px 3px rgb(0 0 0/.2))', '0 2px 6px rgb(0 0 0/.2),0 1px 2px rgb(0 0 0/.15)', '0 4px 10px rgb(0 0 0/.2),0 2px 3px rgb(0 0 0/.15)', '0 8px 16px rgb(0 0 0/.22),0 3px 5px rgb(0 0 0/.15)', '0 14px 28px rgb(0 0 0/.25),0 6px 10px rgb(0 0 0/.15)'][e.elevation]);
      if (Number.isFinite(e.weight)) d.push(`font-weight:${e.weight}`, `font-variation-settings:"wght" ${e.weight}${Number.isFinite(e.width) ? `,"wdth" ${e.width}` : ''}`);
      if (Number.isFinite(e.width)) d.push(`font-stretch:${e.width}%`);
      if (Number.isFinite(e.morph)) d.push('transition:border-radius calc(300ms * var(--mvl-motion-scale, 1)) var(--md-sys-motion-easing-spring, ease)');
      if (d.length) css += `${sel}{${d.map((x) => x + ' !important').join(';')}}\n`;
      if (Number.isFinite(e.morph)) css += `${sel}:hover,${sel}:focus-visible{border-radius:${e.morph}px !important}\n`;
    }
    styleEl.textContent = css;
    if (window.MVLPersonal && window.MVLPersonal.color) window.MVLPersonal.color.syncRainbow();
    for (const f of listeners) { try { f(); } catch { /* ignore */ } }
  }
  function validSelector(s) { if (typeof s !== 'string' || s.length > 400) return false; try { document.querySelector(s); return !/[{}]/.test(s); } catch { return false; } }

  // A stable selector: an id when the element has one, otherwise a short path from the nearest id.
  function selectorFor(el) {
    const parts = [];
    for (let n = el, depth = 0; n && n.nodeType === 1 && n !== document.documentElement && depth < 8; n = n.parentElement, depth++) {
      if (n.id && /^[A-Za-z][\w-]*$/.test(n.id)) { parts.unshift('#' + n.id); break; }
      let p = n.tagName.toLowerCase();
      const cls = [...n.classList].filter((c) => /^[A-Za-z][\w-]*$/.test(c) && !/^(is-|has-|open|active)/.test(c)).slice(0, 2);
      if (cls.length) p += '.' + cls.join('.');
      const sib = n.parentElement ? [...n.parentElement.children].filter((x) => x.tagName === n.tagName) : [];
      if (sib.length > 1) p += `:nth-of-type(${sib.indexOf(n) + 1})`;
      parts.unshift(p);
    }
    return parts.join(' > ');
  }
  const nameOf = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || (el.textContent || '').replace(/\s+/g, ' ').trim()).slice(0, 40) || el.tagName.toLowerCase();

  // ---------- the anchored editor ----------
  function place() {
    if (!pop || !anchor || !anchor.isConnected) return;
    const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight, vw = innerWidth, vh = innerHeight;
    let x = r.right + 12, y = r.top;
    if (x + w > vw - 8) x = r.left - w - 12;
    if (x < 8) { x = Math.max(8, Math.min(vw - w - 8, r.left)); y = r.bottom + 12; if (y + h > vh - 8) y = Math.max(8, r.top - h - 12); }
    y = Math.max(8, Math.min(vh - h - 8, y));
    pop.style.left = x + 'px'; pop.style.top = y + 'px';
  }
  function close() {
    if (!pop) return;
    pop.remove(); pop = null;
    removeEventListener('scroll', place, true); removeEventListener('resize', place);
    if (anchor && anchor.isConnected) { if (!anchor.hasAttribute('tabindex') && !anchor.matches('a[href],button,input,select,textarea,[tabindex]')) { anchor.setAttribute('tabindex', '-1'); } anchor.focus(); }
    anchor = null;
  }
  function open(el) {
    if (!el || el.nodeType !== 1) return;
    close();
    anchor = el;
    const sel = selectorFor(el);
    pop = document.createElement('div');
    pop.className = 'ae-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-modal', 'false');
    const hid = 'ae-' + Math.random().toString(36).slice(2, 7);
    pop.setAttribute('aria-labelledby', hid);
    pop.innerHTML = `<header class="ae-head"><h3 id="${hid}">Edit appearance</h3><button type="button" class="iconbtn" data-ae-close aria-label="Close the appearance editor">&times;</button></header>
<p class="small">Editing: <strong>${esc(nameOf(el))}</strong></p>
<div class="ae-body" data-ae-body></div>
<div class="row"><button type="button" class="btn sm" data-ae-undo>Undo</button><button type="button" class="btn sm" data-ae-redo>Redo</button><button type="button" class="btn sm" data-ae-reset-el>Reset this element</button></div>
<details><summary>What this editor can do</summary><ul class="ae-matrix">${MATRIX.map((m) => `<li><strong>${esc(m.label)}</strong> <span class="chipst ${m.status === 'supported' ? 'lime' : 'amber'}">${m.status === 'supported' ? 'Available' : 'Not available'}</span><br><span class="small">${esc(m.note)}</span></li>`).join('')}</ul></details>
<p class="small" role="status" data-ae-status></p>`;
    document.body.append(pop);
    const body = pop.querySelector('[data-ae-body]'), status = pop.querySelector('[data-ae-status]');
    const cur = () => edits[sel] || {};
    function setProp(k, v, label) {
      const before = snapshot();
      const e = Object.assign({}, cur());
      if (v == null || v === '') delete e[k]; else e[k] = v;
      if (Object.keys(e).length) edits[sel] = e; else delete edits[sel];
      commit(before, label);
      status.textContent = label + '.';
    }
    function draw() {
      const e = cur();
      const comp = getComputedStyle(el);
      const num = (k, min, max, step, now, unit, label) => `<div class="ae-row"><label class="field cp-range"><span>${label}: <output data-out="${k}">${Number.isFinite(e[k]) ? e[k] + unit : 'default (' + now + ')'}</output></span><input type="range" min="${min}" max="${max}" step="${step}" value="${Number.isFinite(e[k]) ? e[k] : min}" data-num="${k}" aria-valuetext="${Number.isFinite(e[k]) ? e[k] + unit : 'default'}"></label><button type="button" class="btn sm" data-reset="${k}" ${k in e ? '' : 'disabled'} aria-label="Reset ${label}">Reset</button></div>`;
      body.innerHTML = num('radius', 0, 48, 1, comp.borderTopLeftRadius, 'px', 'Corner radius')
        + `<div class="ae-row"><label class="field"><span>Colour role</span><select data-ae-role><option value="">Default</option>${ROLES.map((r) => `<option value="${r}"${e.bg === r ? ' selected' : ''}>${esc(r.replace(/-/g, ' '))}</option>`).join('')}<option value="custom"${e.bg && !ROLES.includes(e.bg) ? ' selected' : ''}>Custom colour</option></select></label><button type="button" class="btn sm" data-reset="bg" ${'bg' in e ? '' : 'disabled'} aria-label="Reset colour">Reset</button></div><div data-ae-picker></div>`
        + num('elevation', 0, 5, 1, 'level 0', '', 'Elevation level')
        + num('weight', 100, 900, 50, comp.fontWeight, '', 'Type weight')
        + num('width', 75, 125, 1, comp.fontStretch, '%', 'Type width')
        + num('morph', 0, 48, 1, 'off', 'px', 'Shape morph target radius');
      if (e.bg && !ROLES.includes(e.bg)) mountPicker(e.bg);
      pop.querySelector('[data-ae-undo]').disabled = !undo.length; pop.querySelector('[data-ae-redo]').disabled = !redo.length;
      place();
    }
    function mountPicker(v) {
      const host = body.querySelector('[data-ae-picker]'); host.innerHTML = '';
      if (!window.MVLPersonal.color) { host.textContent = 'The colour picker is not loaded in this window.'; return; }
      const p = window.MVLPersonal.color.picker({ value: v || '#6750a4', onChange: (nv) => { clearTimeout(mountPicker.t); mountPicker.t = setTimeout(() => setProp('bg', nv, 'Custom colour set'), 150); } });
      host.append(p.el);
    }
    body.addEventListener('input', (e) => { const k = e.target.dataset.num; if (k) { const o = body.querySelector(`[data-out="${k}"]`); o.textContent = e.target.value + (k === 'radius' || k === 'morph' ? 'px' : k === 'width' ? '%' : ''); } });
    body.addEventListener('change', (e) => {
      const k = e.target.dataset.num;
      if (k) { setProp(k, Number(e.target.value), MATRIX.find((m) => m.id === k).label + ' set to ' + e.target.value); draw(); }
      if (e.target.matches('[data-ae-role]')) { const v = e.target.value; if (v === 'custom') { mountPicker(cur().bg && !ROLES.includes(cur().bg) ? cur().bg : '#6750a4'); setProp('bg', cur().bg && !ROLES.includes(cur().bg) ? cur().bg : '#6750a4', 'Custom colour set'); } else { setProp('bg', v || null, v ? 'Colour role set to ' + v : 'Colour reset'); draw(); } }
    });
    pop.addEventListener('click', (e) => {
      const r = e.target.closest('[data-reset]'); if (r) { setProp(r.dataset.reset, null, 'Reset ' + r.dataset.reset); draw(); }
      if (e.target.closest('[data-ae-close]')) close();
      if (e.target.closest('[data-ae-undo]')) { doUndo(); draw(); }
      if (e.target.closest('[data-ae-redo]')) { doRedo(); draw(); }
      if (e.target.closest('[data-ae-reset-el]')) { const before = snapshot(); delete edits[sel]; commit(before, 'Element reset'); draw(); status.textContent = 'This element is back to its default look.'; }
    });
    pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } });
    addEventListener('scroll', place, true); addEventListener('resize', place);
    draw();
    pop.querySelector('h3').setAttribute('tabindex', '-1'); pop.querySelector('h3').focus();
  }
  function doUndo() { if (!undo.length) return; redo.push(snapshot()); edits = JSON.parse(undo.pop()); store.set(KEY, edits); history.add('appearance-editor', 'undo', 'Undo'); render(); }
  function doRedo() { if (!redo.length) return; undo.push(snapshot()); edits = JSON.parse(redo.pop()); store.set(KEY, edits); history.add('appearance-editor', 'redo', 'Redo'); render(); }

  function pick() {
    if (picking) return; picking = true;
    const tip = document.createElement('div'); tip.className = 'ae-picktip'; tip.setAttribute('role', 'status'); tip.textContent = 'Click the element to edit. Press Escape to cancel.';
    document.body.append(tip);
    const done = () => { picking = false; tip.remove(); document.removeEventListener('click', onClick, true); document.removeEventListener('keydown', onKey, true); };
    const onClick = (e) => { if (e.target.closest('.ae-pop, .ae-picktip')) return; e.preventDefault(); e.stopPropagation(); done(); open(e.target); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(); } };
    setTimeout(() => { document.addEventListener('click', onClick, true); document.addEventListener('keydown', onKey, true); });
  }

  // ---------- settings card ----------
  function control() {
    const box = document.createElement('section');
    box.className = 'personal-card personal-appearance';
    const id = 'pae-' + Math.random().toString(36).slice(2, 7);
    box.setAttribute('aria-labelledby', id);
    box.innerHTML = `<h3 id="${id}">Per-element appearance</h3>
<p class="small">Right-click anything and choose Edit appearance, or focus it and press Ctrl+Shift+E. The editor opens beside the element.</p>
<div class="row"><button type="button" class="btn primary" data-pae-pick>Pick an element to edit</button><button type="button" class="btn" data-pae-undo>Undo</button><button type="button" class="btn" data-pae-redo>Redo</button></div>
<p class="small" data-pae-count role="status"></p>
<div class="row"><button type="button" class="btn" data-pae-export>Export appearance</button><label class="btn personal-file">Import appearance<input type="file" accept="application/json,.json" data-pae-import></label><button type="button" class="btn danger" data-pae-reset>Reset every element</button></div>
<details><summary>Capability matrix</summary><ul class="ae-matrix">${MATRIX.map((m) => `<li><strong>${esc(m.label)}</strong> <span class="chipst ${m.status === 'supported' ? 'lime' : 'amber'}">${m.status === 'supported' ? 'Available' : 'Not available'}</span><br><span class="small">${esc(m.note)}</span></li>`).join('')}</ul></details>`;
    const $ = (s) => box.querySelector(s), count = $('[data-pae-count]');
    const sync = () => { const n = Object.keys(edits).length; count.textContent = n ? n + (n === 1 ? ' element has' : ' elements have') + ' custom appearance.' : 'No element has custom appearance.'; $('[data-pae-undo]').disabled = !undo.length; $('[data-pae-redo]').disabled = !redo.length; };
    $('[data-pae-pick]').addEventListener('click', () => { const d = box.closest('dialog[open]'); if (d) d.close(); pick(); });
    $('[data-pae-undo]').addEventListener('click', doUndo);
    $('[data-pae-redo]').addEventListener('click', doRedo);
    $('[data-pae-export]').addEventListener('click', () => { C.download('mvl-appearance.json', JSON.stringify({ v: 1, kind: 'mvl-appearance', edits }, null, 2)); count.textContent = 'Exported ' + Object.keys(edits).length + ' element styles.'; });
    $('[data-pae-import]').addEventListener('change', async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      try {
        const d = JSON.parse(await C.readTextFile(f));
        if (!d || d.v !== 1 || d.kind !== 'mvl-appearance' || !d.edits || typeof d.edits !== 'object') throw new Error('This is not a Material VM Labs appearance file.');
        const clean = {}, kept = [];
        for (const [sel, v] of Object.entries(d.edits)) {
          if (!validSelector(sel) || !v || typeof v !== 'object') { kept.push(sel); continue; }
          const o = {};
          for (const k of ['radius', 'elevation', 'weight', 'width', 'morph']) if (Number.isFinite(v[k])) o[k] = v[k];
          if (typeof v.bg === 'string' && (ROLES.includes(v.bg) || C.isRainbow(v.bg) || (v.bg.startsWith('#') && C.parse(v.bg)))) o.bg = v.bg;
          clean[sel] = o;
        }
        const before = snapshot(); edits = Object.assign({}, edits, clean); commit(before, 'Appearance imported');
        count.textContent = 'Imported ' + Object.keys(clean).length + ' element styles.' + (kept.length ? ' ' + kept.length + ' entries could not be applied and were left out: ' + kept.slice(0, 3).join(', ') : '');
      } catch (ex) { count.textContent = 'Nothing was imported: ' + ex.message; }
    });
    $('[data-pae-reset]').addEventListener('click', async () => {
      const n = Object.keys(edits).length; if (!n) return;
      const ok = window.MVLSuperConfirm ? await C.confirm({ action: 'Reset the appearance of every element', affected: n + ' customised elements return to their default look. Undo can bring them back in this session.' }) : true;
      if (ok) { const before = snapshot(); edits = {}; commit(before, 'Global reset'); }
    });
    listeners.add(sync); sync();
    return box;
  }

  function init() {
    render();
    if (window.MVLContext) window.MVLContext.register('body *', (el) => (el.closest('.ae-pop') ? [] : [{ label: 'Edit appearance…', shortcut: 'Ctrl+Shift+E', run: () => open(el) }]));
    document.addEventListener('keydown', (e) => { if (e.ctrlKey && e.shiftKey && !e.altKey && (e.key === 'E' || e.key === 'e')) { const t = document.activeElement; if (t && t !== document.body && !t.closest('.ae-pop')) { e.preventDefault(); open(t); } } });
    if (window.MVLTools) window.MVLTools.register({ id: 'personal-appearance', title: 'Appearance editor', group: 'Personal', summary: 'Corner radius, colour role, elevation, type weight and width, shape morph.', mount(el) { const c = control(); c.classList.add('in-tool'); el.append(c); } });
    if (window.MVLPalette) window.MVLPalette.register({ id: 'personal-appearance-pick', title: 'Edit the appearance of an element', group: 'Personal', keywords: ['appearance', 'style', 'radius'], run: pick });
  }

  window.MVLPersonal = window.MVLPersonal || {};
  window.MVLPersonal.appearance = { init, control, open, close, pick, matrix: MATRIX.slice(), selectorFor, edits: () => JSON.parse(snapshot()) };
  if (document.head) init(); else document.addEventListener('DOMContentLoaded', init, { once: true });
})();
