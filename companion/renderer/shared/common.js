'use strict';
// Shared renderer helpers: escaping, theme, toast, progress ring, and the search box with its adjacent regex builder.
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Theme: light, dark or system; seed: one of the preset schemes in schemes.js.
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage may be unavailable */ } } };
  const mql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function resolvedTheme(t) { return t === 'light' || t === 'dark' ? t : (mql && !mql.matches ? 'light' : 'dark'); }
  function applySeed(name) {
    const all = window.MVL_SCHEMES || {}; const s = all[name] ? name : 'Violet';
    const scheme = all[s] && all[s][document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'];
    const root = document.documentElement.style;
    if (scheme) for (const k in scheme) root.setProperty('--md-sys-color-' + k, scheme[k]);
    document.documentElement.dataset.seed = s;
    return s;
  }
  function applyTheme(t, reduce) {
    document.documentElement.dataset.themePref = t || 'system';
    document.documentElement.dataset.theme = resolvedTheme(t);
    if (reduce === true) document.documentElement.dataset.reduceMotion = 'true'; else if (reduce === false) delete document.documentElement.dataset.reduceMotion;
    applySeed(document.documentElement.dataset.seed || store.get('mvl-seed') || 'Violet');
  }
  function initTheme() {
    applyTheme(store.get('mvl-theme') || 'system', store.get('mvl-reduce-motion') === 'true' ? true : undefined);
    if (mql) mql.addEventListener('change', () => { if (document.documentElement.dataset.themePref === 'system') applyTheme('system'); });
    return document.documentElement.dataset.theme;
  }
  function setTheme(t) { store.set('mvl-theme', t); applyTheme(t); }
  function setSeed(name) { store.set('mvl-seed', name); return applySeed(name); }
  function setReduceMotion(on) { store.set('mvl-reduce-motion', String(!!on)); if (on) document.documentElement.dataset.reduceMotion = 'true'; else delete document.documentElement.dataset.reduceMotion; }
  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    return next;
  }

  // Appearance controls (theme, seed colour, motion) for any settings surface.
  function appearanceControls(onChange) {
    const box = document.createElement('div');
    box.className = 'appearance';
    const seeds = Object.keys(window.MVL_SCHEMES || { Violet: 1 });
    box.innerHTML = `<div class="seg" role="group" aria-label="Theme">${[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<button type="button" data-theme-pick="${v}">${l}</button>`).join('')}</div>
<div class="swatches" role="group" aria-label="Seed colour">${seeds.map((s) => `<button type="button" class="swatch" data-seed-pick="${esc(s)}" aria-label="${esc(s)}" title="${esc(s)}"><i style="background:${esc((window.MVL_SCHEMES || {})[s] ? window.MVL_SCHEMES[s].seed : '#6750A4')}"></i></button>`).join('')}</div>
<label class="switch-row"><span>Reduce motion</span><input type="checkbox" role="switch" data-motion-pick></label>`;
    function sync() {
      const pref = document.documentElement.dataset.themePref || 'system';
      for (const b of box.querySelectorAll('[data-theme-pick]')) b.setAttribute('aria-pressed', String(b.dataset.themePick === pref));
      for (const b of box.querySelectorAll('[data-seed-pick]')) b.setAttribute('aria-pressed', String(b.dataset.seedPick === document.documentElement.dataset.seed));
      box.querySelector('[data-motion-pick]').checked = document.documentElement.dataset.reduceMotion === 'true';
    }
    box.addEventListener('click', (e) => {
      const t = e.target.closest('[data-theme-pick]'); if (t) { setTheme(t.dataset.themePick); if (onChange) onChange({ theme: t.dataset.themePick }); }
      const s = e.target.closest('[data-seed-pick]'); if (s) { setSeed(s.dataset.seedPick); if (onChange) onChange({ seed: s.dataset.seedPick }); }
      sync();
    });
    box.querySelector('[data-motion-pick]').addEventListener('change', (e) => { setReduceMotion(e.target.checked); if (onChange) onChange({ reduceMotion: e.target.checked }); });
    sync();
    return box;
  }

  // Settings dialog for the standalone docs reader and build GUI.
  function settingsDialog() {
    let dlg = document.getElementById('settingsDialog');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'settingsDialog'; dlg.className = 'm3-dialog'; dlg.setAttribute('aria-labelledby', 'settingsDialogTitle');
      dlg.innerHTML = '<h2 id="settingsDialogTitle">Settings</h2><section class="dlg-sec"><h3>Appearance</h3><div data-app></div></section><section class="dlg-sec" data-lang></section><section class="dlg-sec" data-funny></section><section class="dlg-sec" data-narr></section><section class="dlg-sec"><h3>Dim sum</h3><div data-dimsum></div></section><section class="dlg-sec" data-vocab></section><section class="dlg-sec" data-motion></section><section class="dlg-sec"><h3>Notifications and sounds</h3><div data-notify></div></section><div class="dlg-actions"><button type="button" class="btn" data-close>Close</button></div>';
      dlg.querySelector('[data-app]').append(appearanceControls());
      if (window.MVLI18n) dlg.querySelector('[data-lang]').append(window.MVLI18n.control());
      if (window.MVLFunny) dlg.querySelector('[data-funny]').append(window.MVLFunny.control());
      if (window.MVLNarrator) dlg.querySelector('[data-narr]').append(window.MVLNarrator.control());
      if (window.MVLDimsum) dlg.querySelector('[data-dimsum]').append(window.MVLDimsum.control());
      if (window.MVLVocab) dlg.querySelector('[data-vocab]').append(window.MVLVocab.control());
      if (window.MVLMotion) dlg.querySelector('[data-motion]').append(window.MVLMotion.editor());
      if (window.MVLNotify) dlg.querySelector('[data-notify]').append(window.MVLNotify.control());
      dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
      document.body.append(dlg);
    }
    dlg.showModal();
  }

  let toastTimer = null;
  function toast(msg, category) {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); }
    // A modal dialog sits in the top layer, so the toast goes inside the topmost open one to stay visible.
    const host = [...document.querySelectorAll('dialog[open]')].pop() || document.body;
    if (t.parentElement !== host) host.append(t);
    if (window.MVLFunny) window.MVLFunny.fill(t, category || 'info', msg); else t.textContent = msg;
    t.hidden = false;
    if (window.MVLNarrator) window.MVLNarrator.say(category || 'info', msg);
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  const MARK = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4" width="17" height="7" rx="2"></rect><rect x="3.5" y="13" width="17" height="7" rx="2"></rect><path d="M7.5 7.5h.01M7.5 16.5h.01"></path></svg>';
  const logo = () => '<span class="logo">' + MARK + '</span>';

  // Progress ring: frac 0..1 filled, colour from the CSS token name.
  function ring(size, frac, color, text) {
    const r = size * 0.413, c = size / 2, sw = size * 0.098, circ = 2 * Math.PI * r;
    const f = Math.max(0, Math.min(1, frac));
    return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--s3)" stroke-width="${sw}"/><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${(circ * (1 - f)).toFixed(1)}" transform="rotate(-90 ${c} ${c})"/>${text ? `<text x="${c}" y="${c + size * 0.065}" text-anchor="middle" font-size="${size * 0.195}">${esc(text)}</text>` : ''}</svg>`;
  }

  // Search with adjacent independent regex builder. Returns { el, input, active(), invalid(), isRegex(),
  // term(), test(text), setStatus(t) } plus state() and setPattern(pattern, flags).
  // Each call owns its own query, pattern, flags, validation, mode, history and snippets; nothing is
  // shared between fields. Plain text is the default. The builder explains the pattern with the
  // regex core when it is loaded (tools/regex-core.js), refuses patterns at risk of catastrophic
  // backtracking until the person explicitly allows them (then each item is cut to 2,000 characters),
  // and opens the full Regex workbench on this field's own session.
  const RX_TOKENS = [
    ['Any character', '.'], ['Digit', '\\d'], ['Word character', '\\w'], ['Whitespace', '\\s'], ['Not whitespace', '\\S'],
    ['Set', ['[', ']']], ['Not in set', ['[^', ']']], ['Start', '^'], ['End', '$'], ['Word boundary', '\\b'],
    ['Group', ['(', ')']], ['Group without capture', ['(?:', ')']], ['Or', '|'], ['Zero or more', '*'], ['One or more', '+'],
    ['Optional', '?'], ['Lazy', '*?'], ['Followed by', ['(?=', ')']], ['Not followed by', ['(?!', ')']], ['Escape selection', null]
  ];
  function makeSearch(opts) {
    opts = opts || {};
    const id = 's' + Math.random().toString(36).slice(2, 7);
    const snipKey = 'mvl-rx-snippets:' + (opts.snippetKey || opts.label || 'search');
    const wrap = document.createElement('div');
    wrap.className = 'rtop';
    wrap.style.display = 'flex'; wrap.style.flexDirection = 'column'; wrap.style.gap = '12px';
    wrap.innerHTML = `<div class="search" role="search"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" style="color:var(--mute);flex:none"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg><input type="search" placeholder="${esc(opts.placeholder || 'Search')}" aria-label="${esc(opts.label || 'Search')}" autocomplete="off" spellcheck="false"><span class="kbd" aria-hidden="true">/</span><button type="button" class="rxbtn" aria-pressed="false" aria-expanded="false" aria-controls="${id}" title="Switch between plain text and regex search">.* regex</button></div>
<section id="${id}" class="rxpanel" aria-label="Regex builder for ${esc(opts.label || 'this search')}" hidden><input class="pat" spellcheck="false" autocomplete="off" aria-label="Regex pattern" aria-describedby="${id}st"><span role="group" aria-label="Flags" class="row" style="gap:6px">${[['i', 'ignore case'], ['m', 'multiline: ^ and $ match at line breaks'], ['s', 'dot matches line breaks'], ['u', 'Unicode code points and properties'], ['v', 'Unicode sets']].map(([f, t]) => `<button type="button" class="chipbtn" data-flag="${f}" aria-pressed="${f === 'i'}" title="${t}" aria-label="${f}: ${t}">${f}</button>`).join('')}</span><span class="rxstatus" id="${id}st" role="status"></span>
<div class="rxb-more"><span class="rxb-lab">Insert a token</span><span role="group" aria-label="Insert a token" class="rxb-row">${RX_TOKENS.map(([l, t], k) => `<button type="button" class="chipbtn" data-tok="${k}" title="${esc(l)}" aria-label="${esc(l)}">${esc(t == null ? 'Escape selection' : Array.isArray(t) ? t[0] + ' ' + t[1] : t)}</button>`).join('')}</span>
<p class="rxb-risk" data-risk hidden></p><div class="rxb-row" data-allow-row hidden><button type="button" class="btn sm" data-allow aria-pressed="false">Run this pattern anyway, limited to 2,000 characters per item</button></div>
<ul class="rxb-expl" data-expl aria-label="Pattern explanation"></ul>
<div class="rxb-row" data-hist-row hidden><span class="rxb-lab">Recent in this field</span><span class="rxb-row" data-hist></span></div>
<div class="rxb-row" data-snip-row><span class="rxb-lab">Snippets for this field</span><span class="rxb-row" data-snips></span><button type="button" class="btn sm light" data-snip-save>Save as snippet</button></div>
<div class="rxb-row"><button type="button" class="btn sm" data-workbench>Open in the Regex workbench</button><span class="small" data-wb-note></span></div></div></section>`;
    const input = wrap.querySelector('input[type=search]');
    const btn = wrap.querySelector('.rxbtn');
    const panel = wrap.querySelector('.rxpanel');
    const pat = wrap.querySelector('.pat');
    const status = wrap.querySelector('.rxstatus');
    const riskEl = panel.querySelector('[data-risk]'), allowRow = panel.querySelector('[data-allow-row]'), allowBtn = panel.querySelector('[data-allow]');
    const st = { regex: false, flags: new Set(['i']), rx: null, bad: '', risk: '', allowed: false, history: [] };
    let timer = null, histTimer = null;
    const core = () => window.MVLRegex || null;
    const flagStr = () => [...st.flags].join('');
    const snips = { get() { try { return JSON.parse(localStorage.getItem(snipKey) || '[]'); } catch { return []; } }, set(v) { try { localStorage.setItem(snipKey, JSON.stringify(v)); return true; } catch { return false; } } };

    function compile() {
      st.rx = null; st.bad = ''; st.risk = '';
      if (!st.regex || !pat.value) return;
      if (pat.value.length > 5000) { st.bad = 'The pattern is longer than 5000 characters.'; return; }
      try { st.rx = new RegExp(pat.value, flagStr()); } catch (e) { st.bad = e.message; return; }
      const c = core();
      if (c) { const r = c.riskOf(pat.value, flagStr()); if (r.length) st.risk = r[0].text; }
    }
    function renderExtras() {
      const c = core(); const ex = panel.querySelector('[data-expl]');
      riskEl.hidden = !st.risk; riskEl.textContent = st.risk ? st.risk + (st.allowed ? ' You allowed it, so each item is cut to 2,000 characters.' : ' It is not run in this search until you allow it.') : '';
      allowRow.hidden = !st.risk; allowBtn.setAttribute('aria-pressed', String(st.allowed));
      if (!c) { ex.innerHTML = '<li>The explanation needs the regex core, which is not loaded on this page.</li>'; }
      else if (!st.regex || !pat.value || st.bad) ex.innerHTML = '';
      else { try { const t = c.explain(pat.value, flagStr()).tree; const items = t.children.length && (t.type === 'seq' || t.type === 'alt') ? [t].concat(t.children) : [t]; ex.innerHTML = items.slice(0, 12).map((n) => `<li><code>${esc(n.raw)}</code> ${esc(n.text)}</li>`).join('') + (items.length > 12 ? '<li>More in the Regex workbench.</li>' : ''); } catch (e) { ex.innerHTML = `<li>${esc(e.message)}</li>`; } }
      const hr = panel.querySelector('[data-hist-row]'); hr.hidden = !st.history.length;
      panel.querySelector('[data-hist]').innerHTML = st.history.map((h, k) => `<button type="button" class="chipbtn" data-hist-k="${k}" title="Use this pattern again">${esc(h.p)}</button>`).join('');
      panel.querySelector('[data-snips]').innerHTML = snips.get().map((h, k) => `<span class="rxb-row"><button type="button" class="chipbtn" data-snip-k="${k}" title="Use this snippet">${esc(h.p)}</button><button type="button" class="chipbtn" data-snip-del="${k}" aria-label="Remove snippet ${esc(h.p)}">&times;</button></span>`).join('');
      const wb = panel.querySelector('[data-workbench]'); const note = panel.querySelector('[data-wb-note]');
      const ok = !!(window.MVLRegexWorkbench && window.MVLTools);
      wb.disabled = !ok; note.textContent = ok ? '' : 'The Regex workbench is not loaded on this page.';
    }
    function fire() {
      compile();
      status.className = 'rxstatus' + (st.bad ? ' bad' : st.risk && !st.allowed ? ' risk' : '');
      status.textContent = st.regex ? (st.bad ? 'Invalid pattern: ' + st.bad : st.risk && !st.allowed ? 'Not run: backtracking risk' : (pat.value ? 'valid' : 'type a pattern')) : '';
      if (st.regex) renderExtras();
      if (opts.onChange) opts.onChange();
      clearTimeout(histTimer);
      if (st.regex && st.rx) histTimer = setTimeout(() => { const v = pat.value, f = flagStr(); if (!st.history.length || st.history[0].p !== v || st.history[0].f !== f) { st.history = [{ p: v, f }].concat(st.history.filter((h) => h.p !== v || h.f !== f)).slice(0, 10); renderExtras(); } }, 1500);
    }
    const debounced = () => { clearTimeout(timer); timer = setTimeout(fire, 120); };
    function setFlags(f) { st.flags = new Set(String(f || '').replace(/[^imsuv]/g, '').split('').filter(Boolean)); if (st.flags.has('u') && st.flags.has('v')) st.flags.delete('u'); for (const b of panel.querySelectorAll('[data-flag]')) b.setAttribute('aria-pressed', String(st.flags.has(b.dataset.flag))); }
    function setMode(on) { st.regex = on; btn.setAttribute('aria-pressed', String(on)); btn.setAttribute('aria-expanded', String(on)); panel.hidden = !on; }
    function setPattern(p, f) { if (!st.regex) setMode(true); pat.value = p; input.value = p; if (f != null) setFlags(f); st.allowed = false; fire(); }
    input.addEventListener('input', () => { if (st.regex) pat.value = input.value; debounced(); });
    pat.addEventListener('input', () => { input.value = pat.value; st.allowed = false; debounced(); });
    pat.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); input.focus(); } });
    btn.addEventListener('click', () => {
      setMode(!st.regex);
      if (st.regex) pat.value = input.value;
      fire();
    });
    for (const f of panel.querySelectorAll('[data-flag]')) f.addEventListener('click', () => {
      const k = f.dataset.flag; if (st.flags.has(k)) st.flags.delete(k); else { st.flags.add(k); if (k === 'u') st.flags.delete('v'); if (k === 'v') st.flags.delete('u'); }
      setFlags(flagStr()); st.allowed = false; fire();
    });
    panel.addEventListener('click', (e) => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.dataset.tok != null) {
        const tok = RX_TOKENS[+t.dataset.tok][1];
        const a = pat.selectionStart == null ? pat.value.length : pat.selectionStart, z = pat.selectionEnd == null ? a : pat.selectionEnd; const sel = pat.value.slice(a, z);
        const ins = tok == null ? sel.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&') : Array.isArray(tok) ? tok[0] + sel + tok[1] : tok;
        pat.value = pat.value.slice(0, a) + ins + pat.value.slice(z); input.value = pat.value;
        const caret = Array.isArray(tok) && !sel ? a + tok[0].length : a + ins.length;
        pat.focus(); pat.setSelectionRange(caret, caret); st.allowed = false; fire();
      } else if (t.dataset.allow != null) { st.allowed = !st.allowed; fire(); }
      else if (t.dataset.histK != null) { const h = st.history[+t.dataset.histK]; setPattern(h.p, h.f); pat.focus(); }
      else if (t.dataset.snipK != null) { const h = snips.get()[+t.dataset.snipK]; if (h) { setPattern(h.p, h.f); pat.focus(); } }
      else if (t.dataset.snipDel != null) { const list = snips.get(); list.splice(+t.dataset.snipDel, 1); snips.set(list); renderExtras(); pat.focus(); }
      else if (t.dataset.snipSave != null) {
        if (!pat.value || st.bad) { status.textContent = 'There is no valid pattern to save.'; return; }
        const list = snips.get().filter((h) => h.p !== pat.value || h.f !== flagStr()); list.unshift({ p: pat.value, f: flagStr() });
        status.textContent = snips.set(list.slice(0, 20)) ? 'Snippet saved for this field.' : 'Snippets cannot be saved here: storage is unavailable.'; renderExtras();
      } else if (t.dataset.workbench != null && window.MVLRegexWorkbench) {
        window.MVLRegexWorkbench.openWith({ key: id, label: opts.label || 'Search', pattern: pat.value, flags: flagStr(), onApply: (r) => {
          setPattern(r.pattern, r.flags);
          const d = document.querySelector('dialog.tools-host[open]'); if (d) d.close();
          setTimeout(() => pat.focus(), 0);
        } });
      }
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { input.value = ''; pat.value = ''; fire(); } });
    return {
      el: wrap, input,
      active: () => !!(st.regex ? pat.value : input.value.trim()),
      invalid: () => !!st.bad || !!(st.risk && !st.allowed),
      isRegex: () => st.regex,
      term: () => (st.regex ? pat.value : input.value.trim()),
      // returns a match-like object or null
      test(text) {
        text = String(text == null ? '' : text);
        if (st.regex) {
          if (!st.rx || (st.risk && !st.allowed)) return null;
          const cap = st.risk ? 2000 : 200000;
          st.rx.lastIndex = 0; return st.rx.exec(text.length > cap ? text.slice(0, cap) : text);
        }
        const low = input.value.trim().toLowerCase();
        if (!low) return null;
        const i = text.toLowerCase().indexOf(low);
        return i < 0 ? null : { index: i, 0: text.substr(i, low.length) };
      },
      setStatus(t) { if (!st.bad && !(st.risk && !st.allowed)) status.textContent = (st.regex ? 'valid · ' : '') + t; },
      state: () => ({ regex: st.regex, query: input.value, pattern: pat.value, flags: flagStr(), invalid: st.bad, risk: st.risk, allowed: st.allowed, history: st.history.slice() }),
      setPattern
    };
  }

  window.MVL = { esc, initTheme, toggleTheme, applyTheme, setTheme, setSeed, setReduceMotion, appearanceControls, settingsDialog, toast, ring, logo, makeSearch };
  const addBell = () => { const r = document.querySelector('.rail .rail-grow'); if (r && window.MVLNotify && !document.querySelector('.notify-bell')) r.after(window.MVLNotify.bell()); };
  if (document.readyState !== 'loading') setTimeout(addBell); else document.addEventListener('DOMContentLoaded', addBell);
  const boot = () => { if (window.MVLI18n) window.MVLI18n.init(); if (window.MVLVocab) window.MVLVocab.init(); };
  if (window.MVLVocab) boot(); else document.addEventListener('DOMContentLoaded', boot);
})();
