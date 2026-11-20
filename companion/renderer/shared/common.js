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
    if (reduce !== undefined) document.documentElement.dataset.reduceMotion = String(!!reduce);
    applySeed(document.documentElement.dataset.seed || store.get('mvl-seed') || 'Violet');
  }
  function initTheme() {
    applyTheme(store.get('mvl-theme') || 'system', store.get('mvl-reduce-motion') === 'true' ? true : undefined);
    if (mql) mql.addEventListener('change', () => { if (document.documentElement.dataset.themePref === 'system') applyTheme('system'); });
    return document.documentElement.dataset.theme;
  }
  function setTheme(t) { store.set('mvl-theme', t); applyTheme(t); }
  function setSeed(name) { store.set('mvl-seed', name); return applySeed(name); }
  function setReduceMotion(on) { store.set('mvl-reduce-motion', String(!!on)); document.documentElement.dataset.reduceMotion = String(!!on); }
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
      dlg.innerHTML = '<h2 id="settingsDialogTitle">Settings</h2><section class="dlg-sec"><h3>Appearance</h3><div data-app></div></section><section class="dlg-sec" data-vocab></section><section class="dlg-sec" data-motion></section><section class="dlg-sec"><h3>Notifications and sounds</h3><div data-notify></div></section><div class="dlg-actions"><button type="button" class="btn" data-close>Close</button></div>';
      dlg.querySelector('[data-app]').append(appearanceControls());
      if (window.MVLVocab) dlg.querySelector('[data-vocab]').append(window.MVLVocab.control());
      if (window.MVLMotion) dlg.querySelector('[data-motion]').append(window.MVLMotion.editor());
      if (window.MVLNotify) dlg.querySelector('[data-notify]').append(window.MVLNotify.control());
      dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
      document.body.append(dlg);
    }
    dlg.showModal();
  }

  let toastTimer = null;
  function toast(msg) {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
    t.textContent = msg; t.hidden = false;
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

  // Search with adjacent independent regex builder. Returns { el, builder, test(text) -> match|null, active() }.
  // State (query, pattern, flags, mode, validity) is kept in step per search owner. Execution is bounded by the caller's item count.
  function makeSearch(opts) {
    const id = 's' + Math.random().toString(36).slice(2, 7);
    const wrap = document.createElement('div');
    wrap.className = 'rtop';
    wrap.style.display = 'flex'; wrap.style.flexDirection = 'column'; wrap.style.gap = '12px';
    wrap.innerHTML = `<div class="search" role="search"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" style="color:var(--mute);flex:none"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg><input type="search" placeholder="${esc(opts.placeholder || 'Search')}" aria-label="${esc(opts.label || 'Search')}" autocomplete="off" spellcheck="false"><span class="kbd" aria-hidden="true">/</span><button type="button" class="rxbtn" aria-pressed="false" aria-controls="${id}" title="Switch between plain text and regex search">.* regex</button></div>
<section id="${id}" class="rxpanel" aria-label="Regex builder" hidden><input class="pat" spellcheck="false" aria-label="Regex pattern"><span role="group" aria-label="Flags" class="row" style="gap:6px"><button type="button" class="chipbtn" data-flag="i" aria-pressed="true" title="ignore case">i</button><button type="button" class="chipbtn" data-flag="m" aria-pressed="false" title="multiline">m</button><button type="button" class="chipbtn" data-flag="s" aria-pressed="false" title="dot matches newline">s</button><button type="button" class="chipbtn" data-flag="u" aria-pressed="false" title="unicode">u</button></span><span role="group" aria-label="Insert a token" class="row" style="gap:6px"><button type="button" class="chipbtn" data-tok="\\d+">\\d+</button><button type="button" class="chipbtn" data-tok="\\s">\\s</button><button type="button" class="chipbtn" data-tok="\\w+">\\w+</button><button type="button" class="chipbtn" data-tok="(a|b)">( a | b )</button><button type="button" class="chipbtn" data-tok="^">^</button><button type="button" class="chipbtn" data-tok="$">$</button></span><span class="rxstatus" role="status"></span></section>`;
    const input = wrap.querySelector('input[type=search]');
    const btn = wrap.querySelector('.rxbtn');
    const panel = wrap.querySelector('.rxpanel');
    const pat = wrap.querySelector('.pat');
    const status = wrap.querySelector('.rxstatus');
    const st = { regex: false, flags: new Set(['i']), rx: null, bad: '' };
    let timer = null;

    function compile() {
      st.rx = null; st.bad = '';
      if (!st.regex || !pat.value) return;
      try { st.rx = new RegExp(pat.value, [...st.flags].join('')); } catch (e) { st.bad = e.message; }
    }
    function fire() { compile(); status.className = 'rxstatus' + (st.bad ? ' bad' : ''); status.textContent = st.regex ? (st.bad ? 'Invalid pattern: ' + st.bad : (pat.value ? 'valid' : 'type a pattern')) : ''; if (opts.onChange) opts.onChange(); }
    const debounced = () => { clearTimeout(timer); timer = setTimeout(fire, 120); };
    input.addEventListener('input', () => { if (st.regex) pat.value = input.value; debounced(); });
    pat.addEventListener('input', () => { input.value = pat.value; debounced(); });
    btn.addEventListener('click', () => {
      st.regex = !st.regex;
      btn.setAttribute('aria-pressed', String(st.regex)); panel.hidden = !st.regex;
      if (st.regex) pat.value = input.value;
      fire();
    });
    for (const f of panel.querySelectorAll('[data-flag]')) f.addEventListener('click', () => {
      const k = f.dataset.flag; if (st.flags.has(k)) st.flags.delete(k); else st.flags.add(k);
      f.setAttribute('aria-pressed', String(st.flags.has(k))); fire();
    });
    for (const t of panel.querySelectorAll('[data-tok]')) t.addEventListener('click', () => { pat.value += t.dataset.tok; input.value = pat.value; pat.focus(); fire(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { input.value = ''; pat.value = ''; fire(); } });
    return {
      el: wrap, input,
      active: () => !!(st.regex ? pat.value : input.value.trim()),
      invalid: () => !!st.bad,
      isRegex: () => st.regex,
      term: () => (st.regex ? pat.value : input.value.trim()),
      // returns a match-like object or null
      test(text) {
        text = String(text == null ? '' : text);
        if (st.regex) { if (!st.rx) return null; st.rx.lastIndex = 0; return st.rx.exec(text.length > 200000 ? text.slice(0, 200000) : text); }
        const low = input.value.trim().toLowerCase();
        if (!low) return null;
        const i = text.toLowerCase().indexOf(low);
        return i < 0 ? null : { index: i, 0: text.substr(i, low.length) };
      },
      setStatus(t) { if (!st.bad) status.textContent = (st.regex ? 'valid · ' : '') + t; }
    };
  }

  window.MVL = { esc, initTheme, toggleTheme, applyTheme, setTheme, setSeed, setReduceMotion, appearanceControls, settingsDialog, toast, ring, logo, makeSearch };
  const addBell = () => { const r = document.querySelector('.rail .rail-grow'); if (r && window.MVLNotify && !document.querySelector('.notify-bell')) r.after(window.MVLNotify.bell()); };
  if (document.readyState !== 'loading') setTimeout(addBell); else document.addEventListener('DOMContentLoaded', addBell);
  if (window.MVLVocab) window.MVLVocab.init(); else document.addEventListener('DOMContentLoaded', () => { if (window.MVLVocab) window.MVLVocab.init(); });
})();
