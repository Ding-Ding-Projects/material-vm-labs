'use strict';
// Display name: the person using the app can rename what it calls itself on screen (window title,
// rail label, About, notifications and any text that introduces the app). Only the display changes:
// the data folder, installer and package ids, update feed and markers derive from IDENTITY, a
// constant this module never writes. Diagnostics and crash reports keep the shipped name.
(function () {
  const C = window.MVLPersonalCore;
  const { store, history } = C;
  const IDENTITY = Object.freeze({ shippedName: 'Material VM Labs', appId: 'material-vm-labs-companion' });
  const KEY = 'mvl-display-name';
  const SKIP = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'KBD', 'SAMP', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION']);
  const ATTRS = ['aria-label', 'title', 'placeholder'];
  const textOrig = new WeakMap(), attrOrig = new WeakMap();
  const listeners = new Set();
  let override = null, observer = null, applying = false;

  const saved = () => { const v = store.get(KEY, ''); return typeof v === 'string' ? v : ''; };
  const get = () => (override || saved() || IDENTITY.shippedName);
  const valid = (v) => typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= 40 && !/[\u0000-\u001f<>]/.test(v);
  const rx = /Material VM Labs/g;
  function label(text) { const n = get(); return n === IDENTITY.shippedName ? String(text) : String(text).replace(rx, n); }

  function skipped(node) {
    for (let el = node.nodeType === 1 ? node : node.parentElement; el; el = el.parentElement) {
      if (SKIP.has(el.tagName) || el.hasAttribute('data-name-skip') || el.hasAttribute('data-identity')) return true;
    }
    return false;
  }
  function applyText(node) {
    const orig = textOrig.has(node) ? textOrig.get(node) : node.nodeValue;
    if (!textOrig.has(node)) { if (!orig || orig.indexOf('Material VM Labs') < 0) return; textOrig.set(node, orig); }
    const next = label(orig);
    if (node.nodeValue !== next) node.nodeValue = next;
  }
  function applyAttrs(el) {
    let rec = attrOrig.get(el);
    for (const a of ATTRS) {
      if (!el.hasAttribute(a)) continue;
      const cur = el.getAttribute(a);
      if (!(rec && a in rec)) { if (cur.indexOf('Material VM Labs') < 0) continue; rec = rec || {}; rec[a] = cur; attrOrig.set(el, rec); }
      const next = label(rec[a]);
      if (cur !== next) el.setAttribute(a, next);
    }
  }
  function walk(root) {
    if (!root || skipped(root)) return;
    if (root.nodeType === 3) { applyText(root); return; }
    if (root.nodeType !== 1) return;
    applyAttrs(root);
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, { acceptNode: (n) => (n.nodeType === 1 && (SKIP.has(n.tagName) || n.hasAttribute('data-name-skip') || n.hasAttribute('data-identity')) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    for (let n = tw.nextNode(); n; n = tw.nextNode()) { if (n.nodeType === 3) applyText(n); else applyAttrs(n); }
  }
  function applyTitle() {
    const t = document.title;
    const base = document.documentElement.dataset.shippedTitle || t;
    if (!document.documentElement.dataset.shippedTitle && t.indexOf('Material VM Labs') >= 0) document.documentElement.dataset.shippedTitle = t;
    const next = label(document.documentElement.dataset.shippedTitle || base);
    if (document.documentElement.dataset.shippedTitle && document.title !== next) document.title = next;
  }
  function applyAll() {
    if (!document.body || applying) return;
    applying = true;
    try { walk(document.body); applyTitle(); } finally { applying = false; }
    for (const f of listeners) { try { f(get()); } catch { /* listener errors stay local */ } }
  }
  function observe() {
    if (observer || !document.body) return;
    observer = new MutationObserver((list) => {
      if (applying) return;
      applying = true;
      try {
        for (const m of list) {
          if (m.type === 'characterData') { if (!skipped(m.target)) { if (textOrig.has(m.target) && m.target.nodeValue !== label(textOrig.get(m.target))) textOrig.delete(m.target); applyText(m.target); } }
          else if (m.type === 'attributes') { const r = attrOrig.get(m.target); if (r && m.target.getAttribute(m.attributeName) !== label(r[m.attributeName])) delete r[m.attributeName]; if (!skipped(m.target)) applyAttrs(m.target); }
          else for (const n of m.addedNodes) walk(n);
        }
        applyTitle();
      } finally { applying = false; }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    const t = document.querySelector('title'); if (t) new MutationObserver(() => { if (!applying) { const cur = document.title; if (cur.indexOf(get()) < 0 && cur.indexOf('Material VM Labs') >= 0) document.documentElement.dataset.shippedTitle = cur; applying = true; try { applyTitle(); } finally { applying = false; } } }).observe(t, { childList: true, characterData: true, subtree: true });
  }

  function set(v) {
    if (!valid(v)) throw new Error('A display name is 1 to 40 characters, without angle brackets.');
    const before = get();
    store.set(KEY, v.trim());
    history.add('display-name', 'rename', 'Display name changed');
    applyAll();
    return before;
  }
  function reset() { store.del(KEY); history.add('display-name', 'reset', 'Display name reset to the shipped name'); applyAll(); }
  function setOverride(v) { override = v && valid(v) ? v.trim() : null; applyAll(); }

  function control() {
    const box = document.createElement('section');
    box.className = 'personal-card personal-name';
    const id = 'pn-' + Math.random().toString(36).slice(2, 7);
    box.setAttribute('aria-labelledby', id);
    box.innerHTML = `<h3 id="${id}">App name</h3>
<label class="field"><span>Name shown in the title bar, the rail, About and notifications</span><input type="text" maxlength="40" autocomplete="off" spellcheck="false" data-pn-input></label>
<div class="row"><button type="button" class="btn primary" data-pn-save>Rename</button><button type="button" class="btn" data-pn-reset>Reset to <span data-name-skip>Material VM Labs</span></button></div>
<p class="small" role="status" data-pn-status></p>
<p class="small">Only the name you see changes. The data folder, installer and package ids, update feed and anything written into your repositories stay exactly as they are, and diagnostics and crash reports still say <span data-name-skip>Material VM Labs</span> so a reader knows what software it is.</p>
<dl class="kv small" data-pn-identity><dt>Identity, unchanged</dt><dd data-identity>${C.esc(IDENTITY.appId)}</dd></dl>`;
    const input = box.querySelector('[data-pn-input]'), status = box.querySelector('[data-pn-status]');
    const sync = () => {
      if (document.activeElement !== input) input.value = saved();
      input.placeholder = IDENTITY.shippedName;
      input.setAttribute('data-name-skip', '');
      status.textContent = override ? 'A schedule is showing "' + override + '" right now. Your saved name returns when the rule ends.' : 'Now showing: ' + get() + '.';
    };
    box.querySelector('[data-pn-save]').addEventListener('click', () => {
      try { set(input.value); sync(); status.textContent = 'Renamed. Now showing: ' + get() + '.'; } catch (e) { status.textContent = e.message; input.focus(); }
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') box.querySelector('[data-pn-save]').click(); });
    box.querySelector('[data-pn-reset]').addEventListener('click', () => { reset(); input.value = ''; sync(); status.textContent = 'Reset. Now showing the shipped name.'; });
    listeners.add(sync);
    sync();
    return box;
  }

  function init() {
    if (observer) return;
    const go = () => { applyAll(); observe(); };
    if (document.body) go(); else document.addEventListener('DOMContentLoaded', go, { once: true });
    if (window.MVLTools) window.MVLTools.register({ id: 'personal-name', title: 'App name', group: 'Personal', summary: 'Rename what the app calls itself on screen.', mount(el) { const c = control(); c.classList.add('in-tool'); el.append(c); } });
    if (window.MVLPalette) window.MVLPalette.register({ id: 'personal-name-reset', title: 'Reset the app name', group: 'Personal', keywords: ['rename', 'display name'], run: reset });
  }

  window.MVLPersonal = window.MVLPersonal || {};
  window.MVLPersonal.displayName = { init, control, get, set, reset, label, setOverride, identity: IDENTITY, onChange: (f) => listeners.add(f) };
  init();
})();
