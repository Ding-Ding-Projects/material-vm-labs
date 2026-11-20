'use strict';
// Personal vocabulary: an optional local JSON file that renames words in the interface.
// Format: { "schemaVersion": 1, "entries": { "ordinary phrase": "your wording", ... } }
// Nothing ships with the app; the file is chosen by the person, validated in full, kept only in
// this device's local storage, never sent anywhere, and Clear restores the original wording.
(function () {
  const KEY = 'mvl-personal-vocabulary';
  const SKIP = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'KBD', 'SAMP', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION']);
  let map = null;       // { re, lookup } when active
  let raw = null;       // validated entries object
  let observer = null;
  const originals = new WeakMap(); // text node -> original text
  const attrOriginals = new WeakMap(); // element -> { attr: original }
  const ATTRS = ['aria-label', 'title', 'placeholder'];
  const listeners = new Set();

  // JSON.parse keeps the last of two equal keys without a word; a vocabulary with a repeated
  // phrase is ambiguous, so it is refused. This scans the "entries" object's keys as written.
  function duplicateKey(text) {
    let i = 0;
    const n = text.length;
    const ws = () => { while (i < n && /\s/.test(text[i])) i++; };
    const str = () => { let s = ''; i++; while (i < n && text[i] !== '"') { if (text[i] === '\\') { s += text[i] + text[i + 1]; i += 2; } else s += text[i++]; } i++; return JSON.parse('"' + s + '"'); };
    function value(depth, collect) {
      ws();
      const c = text[i];
      if (c === '{') {
        i++; const seen = new Set(); ws();
        if (text[i] === '}') { i++; return null; }
        for (;;) {
          ws(); const k = str(); ws(); i++; // colon
          if (collect && seen.has(k)) return k;
          seen.add(k);
          const inner = value(depth + 1, depth === 0 && k === 'entries'); if (inner) return inner;
          ws(); if (text[i] === ',') { i++; continue; } i++; return null;
        }
      }
      if (c === '[') { i++; ws(); if (text[i] === ']') { i++; return null; } for (;;) { const inner = value(depth + 1, false); if (inner) return inner; ws(); if (text[i] === ',') { i++; continue; } i++; return null; } }
      if (c === '"') { str(); return null; }
      while (i < n && !/[,}\]\s]/.test(text[i])) i++;
      return null;
    }
    try { return value(0, false); } catch { return null; }
  }

  // Validate a file's text. Returns { ok: true, entries, count } or { ok: false, error }.
  function validate(text) {
    if (typeof text !== 'string') return { ok: false, error: 'The file could not be read as text.' };
    let data;
    try { data = JSON.parse(text); } catch { return { ok: false, error: 'The file is not valid JSON.' }; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'The file must be a JSON object.' };
    const dup = duplicateKey(text);
    if (dup) return { ok: false, error: `The phrase "${dup}" appears twice in entries.` };
    if (data.schemaVersion !== 1) return { ok: false, error: 'Unsupported schemaVersion; expected 1.' };
    const e = data.entries;
    if (!e || typeof e !== 'object' || Array.isArray(e)) return { ok: false, error: 'The file needs an "entries" object.' };
    const keys = Object.keys(e);
    if (!keys.length) return { ok: false, error: 'The "entries" object is empty.' };
    const clean = {};
    for (const k of keys) {
      const v = e[k];
      if (typeof v !== 'string') return { ok: false, error: 'Every entry value must be text.' };
      if (!k.trim()) return { ok: false, error: 'An entry has an empty phrase.' };
      if (/[\u0000-\u001f]/.test(k + v)) return { ok: false, error: 'An entry contains a control character.' };
      clean[k] = v;
    }
    return { ok: true, entries: clean, count: keys.length };
  }

  function escapeRx(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // Longest phrase first, whole words only, case-insensitive with the first letter's case kept.
  function build(entries) {
    const keys = Object.keys(entries).sort((a, b) => b.length - a.length);
    const lookup = new Map(keys.map((k) => [k.toLowerCase(), entries[k]]));
    const re = new RegExp('(?<![\\p{L}\\p{N}])(' + keys.map(escapeRx).join('|') + ')(?![\\p{L}\\p{N}])', 'giu');
    return { re, lookup };
  }

  function translate(text) {
    if (!map || !text) return text;
    if (window.MVLSchool && window.MVLSchool.active()) return text; // School mode suspends personal wording
    map.re.lastIndex = 0;
    return text.replace(map.re, (m) => {
      const v = map.lookup.get(m.toLowerCase());
      if (v == null) return m;
      const up = m[0] !== m[0].toLowerCase() && v[0] === v[0].toLowerCase();
      return up ? v[0].toUpperCase() + v.slice(1) : v;
    });
  }

  function skipped(node) {
    for (let el = node.parentElement; el; el = el.parentElement) {
      if (SKIP.has(el.tagName) || el.hasAttribute('data-vocab-skip') || el.isContentEditable) return true;
    }
    return false;
  }

  function applyText(node) {
    if (skipped(node)) return;
    const orig = originals.has(node) ? originals.get(node) : node.nodeValue;
    const next = translate(orig);
    if (next !== orig) { originals.set(node, orig); if (node.nodeValue !== next) node.nodeValue = next; }
  }
  function applyAttrs(el) {
    if (el.closest('[data-vocab-skip]')) return;
    for (const a of ATTRS) {
      if (!el.hasAttribute(a)) continue;
      const store = attrOriginals.get(el) || {};
      const orig = a in store ? store[a] : el.getAttribute(a);
      const next = translate(orig);
      if (next !== orig) { store[a] = orig; attrOriginals.set(el, store); if (el.getAttribute(a) !== next) el.setAttribute(a, next); }
    }
  }
  function walk(root) {
    if (root.nodeType === 3) { applyText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) applyAttrs(root);
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) { if (n.nodeType === 3) applyText(n); else applyAttrs(n); }
  }
  function restore(root) {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      if (n.nodeType === 3) { if (originals.has(n)) { n.nodeValue = originals.get(n); originals.delete(n); } }
      else { const s = attrOriginals.get(n); if (s) { for (const a in s) n.setAttribute(a, s[a]); attrOriginals.delete(n); } }
    }
  }

  function observe() {
    if (observer) return;
    observer = new MutationObserver((list) => {
      if (!map) return;
      observer.disconnect();
      for (const m of list) {
        if (m.type === 'characterData') { originals.delete(m.target); applyText(m.target); }
        else if (m.type === 'attributes') { const s = attrOriginals.get(m.target); if (s) delete s[m.attributeName]; applyAttrs(m.target); }
        else for (const n of m.addedNodes) walk(n);
      }
      connect();
    });
    connect();
  }
  function connect() { observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS }); }

  function activate(entries) {
    raw = entries; map = build(entries);
    if (document.body) { walk(document.body); observe(); document.title = translate(document.title); }
  }

  function headline(entries) {
    // The file's own wording for "private vocabulary", if it has one; never a bundled literal.
    for (const k of Object.keys(entries)) if (k.toLowerCase() === 'private vocabulary') return entries[k];
    return 'Personal wording applied';
  }

  function celebrate(text) {
    let live = document.getElementById('vocab-live');
    if (!live) { live = document.createElement('div'); live.id = 'vocab-live'; live.className = 'sr'; live.setAttribute('aria-live', 'polite'); document.body.append(live); }
    live.textContent = ''; setTimeout(() => { live.textContent = text; }, 50);
    const el = document.createElement('div');
    el.className = 'vocab-celebrate'; el.setAttribute('aria-hidden', 'true'); el.setAttribute('data-vocab-skip', '');
    el.innerHTML = '<div class="vocab-celebrate-card"><span class="vocab-celebrate-over">Level up</span><strong></strong></div>';
    el.querySelector('strong').textContent = text;
    document.body.append(el);
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => { el.classList.remove('in'); el.classList.add('out'); setTimeout(() => el.remove(), 600); }, 3000);
  }

  function emit() { for (const f of listeners) { try { f(status()); } catch { /* listener errors stay local */ } } }

  // Load a File object (from the picker or a drop). Validates fully before changing anything.
  async function loadFile(file) {
    if (!file) return { ok: false, error: 'No file was chosen.' };
    if (file.name && !/\.json$/i.test(file.name) && file.type && !/json/.test(file.type)) return { ok: false, error: 'Choose a .json file.' };
    let text;
    try { text = await file.text(); } catch { return { ok: false, error: 'The file could not be read.' }; }
    const v = validate(text);
    if (!v.ok) return v;
    try { localStorage.setItem(KEY, JSON.stringify({ schemaVersion: 1, entries: v.entries, name: file.name || 'vocabulary.json', at: new Date().toISOString() })); }
    catch { return { ok: false, error: 'Local storage is unavailable, so the wording could not be kept.' }; }
    if (map && document.body) restore(document.body);
    activate(v.entries);
    celebrate(headline(v.entries));
    emit();
    return { ok: true, count: v.count };
  }

  function clear() {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    if (document.body) restore(document.body);
    map = null; raw = null;
    if (observer) { observer.disconnect(); observer = null; }
    emit();
  }

  function stored() {
    try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); return s && s.entries ? s : null; } catch { return null; }
  }
  function status() {
    const s = stored();
    return s ? { loaded: true, name: s.name, count: Object.keys(s.entries).length, at: s.at } : { loaded: false };
  }

  function init() {
    const s = stored();
    if (s) { const v = validate(JSON.stringify({ schemaVersion: 1, entries: s.entries })); if (v.ok) activate(v.entries); else clear(); }
    // Drop a vocabulary file anywhere on the window.
    window.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); document.documentElement.classList.add('vocab-drop'); } });
    window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.documentElement.classList.remove('vocab-drop'); });
    window.addEventListener('drop', async (e) => {
      document.documentElement.classList.remove('vocab-drop');
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f || !/\.json$/i.test(f.name)) return;
      e.preventDefault();
      const r = await loadFile(f);
      if (!r.ok && window.MVL && window.MVL.toast) window.MVL.toast('Vocabulary file refused: ' + r.error);
    });
  }

  // A complete settings control: picker, status, replace and clear. Returns an element.
  function control() {
    const box = document.createElement('section');
    box.className = 'vocab-control';
    box.setAttribute('aria-label', 'Personal vocabulary');
    box.innerHTML = `<h3 class="vocab-title">Personal vocabulary</h3>
<p class="vocab-help">Load a JSON file to rename words in this interface. It stays on this device and is never uploaded. You can also drop the file anywhere on the window.</p>
<div class="vocab-row"><label class="m3-btn tonal vocab-pick"><input type="file" accept=".json,application/json" class="sr" data-vocab-input><span data-vocab-pick-label>Choose a JSON file</span></label>
<button type="button" class="m3-btn outlined" data-vocab-clear>Clear and restore the original wording</button></div>
<p class="vocab-status" role="status" data-vocab-status></p>`;
    const input = box.querySelector('[data-vocab-input]');
    const st = box.querySelector('[data-vocab-status]');
    const clr = box.querySelector('[data-vocab-clear]');
    const pick = box.querySelector('[data-vocab-pick-label]');
    function show(msg, bad) {
      const s = status();
      st.classList.toggle('bad', !!bad);
      st.textContent = msg || (s.loaded ? `Loaded: ${s.name}, ${s.count} entries.` : 'No file loaded. The original wording is in use.');
      clr.disabled = !s.loaded;
      pick.textContent = s.loaded ? 'Replace the file' : 'Choose a JSON file';
    }
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0]; input.value = '';
      const r = await loadFile(f);
      show(r.ok ? '' : 'Refused, nothing changed: ' + r.error, !r.ok);
    });
    clr.addEventListener('click', () => { clear(); show('Cleared. The original wording is back.'); });
    listeners.add(() => show());
    show();
    return box;
  }

  window.MVLVocab = { validate, translate, loadFile, clear, status, init, control, onChange: (f) => listeners.add(f), _build: build, _activate: (e) => { map = build(e); } };
})();
