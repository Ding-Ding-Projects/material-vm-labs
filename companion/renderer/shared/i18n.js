'use strict';
// Language switch: English (default), Hong Kong Cantonese, or both side by side.
// The phrase table lives in i18n-zh-hk.js. Like vocab.js, this rewrites text nodes and the
// aria-label, title and placeholder attributes, follows later changes with a MutationObserver,
// and keeps the English source so English can be restored exactly.
//
// How this composes with the personal vocabulary (vocab.js):
// - Translation always starts from the original English. For every node it rewrites, this module
//   remembers { src: English, out: what it wrote }.
// - The vocabulary then works on whatever this module wrote (it sees the change as an ordinary
//   text change and re-applies its own wording on top). When this module later sees a value equal
//   to MVLVocab.translate(out), it knows the vocabulary made that change and leaves it alone.
// - If the vocabulary rewrote a node before this module ever saw it (for example a vocabulary
//   loaded before the language switch started), a reverse map of
//   MVLVocab.translate(english) -> english recovers the English for every phrase in the table.
// - Load order: include i18n-zh-hk.js and i18n.js before vocab.js and call MVLI18n.init() early,
//   so this observer is created first and runs before the vocabulary's on the same changes.
(function () {
  const KEY = 'mvl-lang';
  const MODES = ['en', 'yue', 'bi'];
  const ATTRS = ['aria-label', 'title', 'placeholder'];
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'KBD', 'SAMP', 'TEXTAREA', 'INPUT', 'SELECT', 'NOSCRIPT', 'svg']);
  const SKIP_SEL = '[data-vocab-skip], [data-i18n-skip], [data-i18n-added], code, pre, kbd, samp, textarea, [contenteditable=""], [contenteditable="true"]';
  const LONG = 28; // longer source text, or any sentence, goes on its own line in bilingual mode

  const table = (window.MVLI18nZhHK && window.MVLI18nZhHK.phrases) || {};
  const rules = (window.MVLI18nZhHK && window.MVLI18nZhHK.rules) || [];
  const lower = new Map(Object.keys(table).map((k) => [k.toLowerCase(), table[k]]));

  let current = 'en';
  let observer = null;
  let started = false;
  let reverse = new Map(); // vocabulary output -> English table key
  const texts = new WeakMap(); // text node -> { src, out, extra }
  const attrs = new WeakMap(); // element -> { attr: { src, out } }
  const listeners = new Set();

  const store = {
    get() { try { return localStorage.getItem(KEY); } catch { return null; } },
    set(v) { try { localStorage.setItem(KEY, v); } catch { /* storage may be unavailable; the mode lasts for this page */ } }
  };

  // ---------- translation of one string ----------
  function vocab(s) { return window.MVLVocab && typeof window.MVLVocab.translate === 'function' ? window.MVLVocab.translate(s) : s; }
  function rebuildReverse() {
    reverse = new Map();
    if (!window.MVLVocab) return;
    for (const k of Object.keys(table)) { const v = vocab(k); if (v !== k && !reverse.has(v)) reverse.set(v, k); }
  }

  // Returns Cantonese for an English string (trimmed), or null when nothing applies.
  function zh(s, depth) {
    depth = depth || 0;
    if (!s || depth > 3 || !/[A-Za-z]/.test(s)) return null;
    if (Object.prototype.hasOwnProperty.call(table, s)) return table[s];
    const lo = lower.get(s.toLowerCase());
    if (lo != null) return lo;
    const t = (x) => { const r = zh(x.trim(), depth + 1); return r == null ? x : r; };
    for (const [re, fn] of rules) {
      const m = re.exec(s);
      if (m) { const r = fn(m, t); if (r != null && r !== s) return r; }
    }
    // Leading markers and trailing punctuation: translate the core and keep the marker.
    let m = /^([●•+]\s*)(.+)$/.exec(s);
    if (m) { const r = zh(m[2], depth + 1); if (r != null) return m[1] + r; }
    m = /^(.+?)(…|\.\.\.|:|\?|\.)$/.exec(s);
    if (m) {
      const r = zh(m[1], depth + 1);
      if (r != null) return r + ({ ':': '：', '?': '？', '.': '。' }[m[2]] || m[2]);
    }
    // "Label: detail" where the label is known; the detail is translated when it can be.
    m = /^([^:]{2,60}): (.+)$/s.exec(s);
    if (m) { const head = zh(m[1], depth + 1); if (head != null) return head + '：' + t(m[2]); }
    // Parts joined with a middle dot, such as "Running · ready".
    if (s.includes(' · ')) {
      const parts = s.split(' · ');
      let changed = false;
      const out = parts.map((p) => { const r = zh(p.trim(), depth + 1); if (r != null) { changed = true; return r; } return p; });
      if (changed) return out.join(' · ');
    }
    return null;
  }

  // Keep the source's surrounding whitespace around a translation.
  function wrap(src, tr) { const m = /^(\s*)[\s\S]*?(\s*)$/.exec(src); return m[1] + tr + m[2]; }
  function translateText(src) { const tr = zh(src.trim()); return tr == null || tr === src.trim() ? null : wrap(src, tr); }
  // A translation that already contains the English (such as "Remote Desktop（遠端桌面）") is shown alone in bilingual mode.
  const covers = (src, tr) => tr.includes(src.trim());
  function isLong(src) { const s = src.trim(); return s.length > LONG || /[.;!?]\s|[.!?]$/.test(s); }

  // ---------- applying to the page ----------
  function skippedEl(el) {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      if (SKIP_TAGS.has(e.tagName) || SKIP_TAGS.has(e.nodeName)) return true;
    }
    return !!(el && el.closest && el.closest(SKIP_SEL));
  }

  // Works out the English source of a text value: what this module stored, else the value itself,
  // else the English phrase that the personal vocabulary turned into this value.
  function sourceFor(rec, cur) {
    if (rec && (cur === rec.out || cur === vocab(rec.out))) return rec.src;
    if (translateText(cur) != null) return cur;
    const back = reverse.get(cur.trim());
    return back != null ? wrap(cur, back) : cur;
  }

  function removeExtra(rec) { if (rec && rec.extra) { rec.extra.remove(); rec.extra = null; } }

  function makeExtra(src, tr) {
    const box = document.createElement('span');
    box.setAttribute('data-i18n-added', '');
    const long = isLong(src);
    box.className = long ? 'i18n-bi i18n-bi-block' : 'i18n-bi';
    if (!long) { const sep = document.createElement('span'); sep.setAttribute('aria-hidden', 'true'); sep.textContent = ' · '; box.append(sep); }
    const z = document.createElement('span');
    z.lang = 'zh-HK'; z.textContent = tr.trim();
    box.append(z);
    return box;
  }

  function applyText(node) {
    const parent = node.parentElement;
    if (!parent || skippedEl(parent)) return;
    const rec = texts.get(node);
    const cur = node.nodeValue;
    if (rec && (cur === rec.out || cur === vocab(rec.out)) && rec.mode === current && (current !== 'bi' || !rec.extra || (rec.extra.isConnected && rec.extra.previousSibling === node))) return;
    const src = sourceFor(rec, cur);
    const tr = translateText(src);
    if (tr == null) { if (rec) { removeExtra(rec); texts.delete(node); } return; }
    removeExtra(rec);
    // Inside an <option> or similar, spans cannot render, so bilingual text goes inline.
    const inline = parent.tagName === 'OPTION' || parent.tagName === 'TITLE';
    let out;
    if (current === 'yue' || covers(src, tr)) out = tr;
    else if (inline) out = wrap(src, src.trim() + ' · ' + tr.trim());
    else out = src;
    if (cur !== out && cur !== vocab(out)) node.nodeValue = out;
    const next = { src, out, mode: current, extra: null };
    if (current === 'bi' && !inline && !covers(src, tr)) {
      next.extra = makeExtra(src, tr);
      node.after(next.extra);
      parent.setAttribute('data-i18n-host', '');
    }
    texts.set(node, next);
  }

  function applyAttrs(el) {
    if (el.closest(SKIP_SEL) && !el.hasAttribute('data-i18n-attrs')) return;
    let store = attrs.get(el);
    for (const a of ATTRS) {
      if (!el.hasAttribute(a)) continue;
      const cur = el.getAttribute(a);
      const rec = store && store[a];
      if (rec && rec.mode === current && (cur === rec.out || cur === vocab(rec.out))) continue;
      const src = sourceFor(rec, cur);
      const tr = translateText(src);
      if (tr == null) { if (rec) delete store[a]; continue; }
      const out = current === 'yue' || covers(src, tr) ? tr : src.trim() + ' · ' + tr.trim();
      if (cur !== out && cur !== vocab(out)) el.setAttribute(a, out);
      if (!store) { store = {}; attrs.set(el, store); }
      store[a] = { src, out, mode: current };
    }
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { applyText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) { if (root.hasAttribute('data-i18n-added')) return; applyAttrs(root); }
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: (n) => (n.nodeType === 1 && (n.hasAttribute('data-i18n-added') || n.hasAttribute('data-i18n-skip')) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
    });
    const textNodes = [];
    for (let n = tw.nextNode(); n; n = tw.nextNode()) { if (n.nodeType === 3) textNodes.push(n); else applyAttrs(n); }
    for (const n of textNodes) applyText(n); // after the walk, since bilingual mode inserts siblings
  }

  function restore(root) {
    for (const el of root.querySelectorAll('[data-i18n-added]')) el.remove();
    for (const el of root.querySelectorAll('[data-i18n-host]')) el.removeAttribute('data-i18n-host');
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      if (n.nodeType === 3) {
        const rec = texts.get(n);
        if (!rec) continue;
        // Only put English back where the node still holds what this module wrote.
        if (n.nodeValue === rec.out || n.nodeValue === vocab(rec.out)) { if (n.nodeValue !== rec.src) n.nodeValue = rec.src; }
        texts.delete(n);
      } else {
        const s = attrs.get(n);
        if (!s) continue;
        for (const a in s) { const v = n.getAttribute(a); if (v === s[a].out || v === vocab(s[a].out)) n.setAttribute(a, s[a].src); }
        attrs.delete(n);
      }
    }
  }

  // ---------- title, lang attribute, styles ----------
  let titleRec = null;
  function applyTitle() {
    const cur = document.title;
    const src = titleRec && (cur === titleRec.out || cur === vocab(titleRec.out)) ? titleRec.src : cur;
    const tr = current === 'en' ? null : translateText(src);
    const out = tr == null ? src : current === 'yue' ? tr : src + ' · ' + tr;
    if (cur !== out) document.title = out;
    titleRec = { src, out };
  }

  function injectStyle() {
    if (document.getElementById('mvl-i18n-style')) return;
    const st = document.createElement('style');
    st.id = 'mvl-i18n-style';
    st.textContent = `
[data-i18n-host]{white-space:normal!important;text-overflow:clip!important;overflow-wrap:anywhere;-webkit-line-clamp:unset!important;max-height:none!important}
.i18n-bi{overflow-wrap:anywhere}
html[data-lang="bi"] .seg{border-radius:20px}
.i18n-bi-block{display:block;margin-top:2px;opacity:.86;font-size:.95em}
:where(:lang(zh-HK)){font-family:"Roboto Flex","Microsoft JhengHei UI","Microsoft JhengHei","PingFang HK","Noto Sans HK","Noto Sans CJK TC",sans-serif}
.i18n-control{display:flex;flex-direction:column;gap:8px;min-width:0}
.i18n-control h3{margin:0}
.i18n-control .i18n-seg{display:flex;flex-wrap:wrap;border-radius:24px;box-shadow:inset 0 0 0 1px var(--md-sys-color-outline,#79747E);overflow:hidden;max-width:100%}
.i18n-control .i18n-seg button{flex:1 1 auto;min-height:48px;min-width:48px;padding:0 14px;border:0;border-left:1px solid var(--md-sys-color-outline,#79747E);background:transparent;color:inherit;font:inherit;font-weight:500;cursor:pointer;white-space:normal}
.i18n-control .i18n-seg button:first-child{border-left:0}
.i18n-control .i18n-seg button[aria-pressed="true"]{background:var(--md-sys-color-secondary-container,#E8DEF8);color:var(--md-sys-color-on-secondary-container,#1D192B)}
.i18n-control .i18n-seg button:focus-visible{outline:3px solid var(--md-sys-color-primary,#6750A4);outline-offset:-3px}
.i18n-control .i18n-help{margin:0;font-size:.875rem;opacity:.85}`;
    document.head.append(st);
  }

  // ---------- observer ----------
  function connect() { observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS }); }
  function observe() {
    if (observer) return;
    observer = new MutationObserver((list) => {
      if (current === 'en') return;
      observer.disconnect();
      for (const m of list) {
        if (m.type === 'characterData') applyText(m.target);
        else if (m.type === 'attributes') applyAttrs(m.target);
        else {
          for (const n of m.addedNodes) if (!(n.nodeType === 1 && n.hasAttribute('data-i18n-added'))) walk(n);
          // A bilingual line whose English sibling was removed is removed with it.
          for (const n of m.removedNodes) { if (n.nodeType === 3) { const r = texts.get(n); if (r) removeExtra(r); } }
        }
      }
      connect();
    });
    connect();
  }
  function unobserve() { if (observer) { observer.disconnect(); observer = null; } }

  // ---------- public API ----------
  function setMode(mode, quiet) {
    if (!MODES.includes(mode)) mode = 'en';
    const prev = current;
    if (document.body) { unobserve(); restore(document.body); }
    current = mode;
    if (!quiet) store.set(mode);
    document.documentElement.lang = mode === 'yue' ? 'zh-HK' : 'en';
    document.documentElement.dataset.lang = mode;
    if (document.body && mode !== 'en') { rebuildReverse(); walk(document.body); observe(); }
    applyTitle();
    if (prev !== mode) for (const f of listeners) { try { f(mode); } catch { /* listener errors stay local */ } }
    return mode;
  }

  function init() {
    if (started) return current;
    started = true;
    injectStyle();
    if (window.MVLVocab && typeof window.MVLVocab.onChange === 'function') {
      // After a vocabulary file is loaded or cleared, refresh the reverse map and re-check the page.
      window.MVLVocab.onChange(() => { rebuildReverse(); if (current !== 'en' && document.body) { observer && observer.disconnect(); walk(document.body); observer ? connect() : observe(); } });
    }
    const saved = store.get();
    const go = () => setMode(MODES.includes(saved) ? saved : 'en', true);
    if (document.body) go(); else document.addEventListener('DOMContentLoaded', go, { once: true });
    return current;
  }

  // Material 3 segmented button group for any settings surface.
  function control() {
    injectStyle();
    const box = document.createElement('section');
    box.className = 'i18n-control';
    const id = 'i18n-h-' + Math.random().toString(36).slice(2, 7);
    box.setAttribute('aria-labelledby', id);
    box.innerHTML = `<h3 id="${id}">Language</h3>
<div class="seg i18n-seg" role="group" aria-label="Language" data-i18n-attrs>
<button type="button" data-lang-pick="en" lang="en" data-i18n-skip>English</button>
<button type="button" data-lang-pick="yue" lang="zh-HK" data-i18n-skip>廣東話</button>
<button type="button" data-lang-pick="bi" lang="en" data-i18n-skip>Bilingual</button>
</div>
<p class="i18n-help">Changes the words on screen at once. Commands, file names and paths stay as they are.</p>`;
    const sync = () => { for (const b of box.querySelectorAll('[data-lang-pick]')) b.setAttribute('aria-pressed', String(b.dataset.langPick === current)); };
    box.addEventListener('click', (e) => { const b = e.target.closest('[data-lang-pick]'); if (b) { setMode(b.dataset.langPick); sync(); } });
    box.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const bs = [...box.querySelectorAll('[data-lang-pick]')]; const i = bs.indexOf(document.activeElement); if (i < 0) return;
      e.preventDefault(); bs[(i + (e.key === 'ArrowRight' ? 1 : -1) + bs.length) % bs.length].focus();
    });
    listeners.add(sync);
    sync();
    return box;
  }

  window.MVLI18n = {
    init,
    setMode: (m) => setMode(m),
    mode: () => current,
    control,
    translate: (s) => { const r = zh(String(s == null ? '' : s).trim()); return r == null ? s : r; },
    onChange: (f) => listeners.add(f),
    count: () => Object.keys(table).length + rules.length
  };
})();
