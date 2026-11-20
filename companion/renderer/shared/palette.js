'use strict';
// Command palette for every companion. Ctrl+Shift+F (or MVLPalette.open()) opens a Material 3 dialog that
// searches every destination, every heading and labelled control, registered commands and live settings.
// The search box is the shared MVL.makeSearch, so the full regex builder sits right beside it.
// Choosing a page item teleports to it: its tab is activated if needed, it scrolls into view, takes focus
// and flashes a highlight ring. Settings apply at once and the palette stays open so you can change them again.
(function () {
  const LIMIT = 200;
  const GROUPS = ['Go to', 'Actions', 'Settings', 'On this page'];
  const THEMES = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']];
  const KIND = { button: 'Button', a: 'Link', input: 'Field', select: 'List', textarea: 'Field', switch: 'Switch', heading: 'Heading' };
  const commands = new Map();
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, 120);
  const motionOff = () => document.documentElement.dataset.motion === 'off' || (window.MVLMotion && window.MVLMotion.reduced && window.MVLMotion.reduced());

  let dlg = null, search = null, list = null, live = null, items = [], shown = [], active = 0, prevFocus = null, liveTimer = null, seq = 0;

  // ---------- accessible names and visibility ----------
  function nameOf(el) {
    const al = el.getAttribute('aria-label'); if (al && al.trim()) return clean(al);
    const lb = el.getAttribute('aria-labelledby');
    if (lb) { const t = lb.split(/\s+/).map((id) => { const x = document.getElementById(id); return x ? x.textContent : ''; }).join(' '); if (clean(t)) return clean(t); }
    if (el.labels && el.labels.length) { const t = [...el.labels].map((l) => l.textContent).join(' '); if (clean(t)) return clean(t); }
    const txt = clean(el.textContent); if (txt && !/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return txt;
    return clean(el.getAttribute('title') || el.getAttribute('placeholder') || (el.tagName === 'INPUT' && /^(button|submit|reset)$/.test(el.type) ? el.value : ''));
  }
  const kindOf = (el) => (/^H[1-3]$/.test(el.tagName) ? 'heading' : el.getAttribute('role') === 'switch' ? 'switch' : el.tagName.toLowerCase());
  const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  // An element hidden only because its tab panel is not the current one can still be reached.
  function hiddenOnlyByPanel(el, panel) {
    for (let a = el; a && a !== panel; a = a.parentElement) {
      if (a.hidden) return false;
      const cs = getComputedStyle(a); if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    }
    return true;
  }
  function tabForPanel(panel) {
    const id = panel.id;
    if (id) {
      const byCtl = document.querySelector(`[role=tab][aria-controls="${CSS.escape(id)}"]`); if (byCtl) return byCtl;
      const short = id.replace(/^panel-/, '');
      const byConv = document.getElementById('tab-' + short) || document.querySelector(`[data-tab="${CSS.escape(short)}"]`); if (byConv) return byConv;
    }
    const lb = panel.getAttribute('aria-labelledby'); const t = lb && document.getElementById(lb.split(/\s+/)[0]);
    return t && t.getAttribute('role') === 'tab' ? t : null;
  }
  const inPalette = (el) => !!(dlg && dlg.contains(el));

  // ---------- index ----------
  function navItems() {
    const out = [], seen = new Set();
    for (const el of document.querySelectorAll('.rail .tab, [role=tab]')) {
      if (seen.has(el) || inPalette(el)) continue; seen.add(el);
      const title = nameOf(el.querySelector('.lbl') || el) || nameOf(el); if (!title) continue;
      const current = el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-current') === 'page';
      out.push({ group: 'Go to', title, hint: current ? 'Current page' : 'Page', keywords: 'go open page tab section navigate', run: () => goTo(el) });
    }
    return out;
  }
  function goTo(el) {
    const id = el.id;
    el.click();
    close(false);
    requestAnimationFrame(() => { const t = (el.isConnected ? el : id && document.getElementById(id)); if (t) t.focus(); });
  }

  const PAGE_SEL = 'h1, h2, h3, button, a[href], input:not([type=hidden]), select, textarea, [role=switch]';
  function pageItems() {
    const out = [], seen = new Set(), names = new Set();
    const add = (el, page) => {
      if (inPalette(el) || el.closest('.skip, [aria-hidden="true"], [role=tab]') || el.matches('.skip, [role=tab]') || el.disabled) return;
      const title = nameOf(el); if (!title) return;
      const kind = kindOf(el), key = kind + '|' + title;
      if (page && names.has(key)) return; // already reachable on the current page
      if (!page) names.add(key);
      const k = key + '|' + (page ? page.name : '');
      if (seen.has(k)) return; seen.add(k);
      out.push({ group: 'On this page', title, hint: (KIND[kind] || 'Control') + (page ? ' on the ' + page.name + ' page' : ''), keywords: kind, other: !!page, run: () => teleport(el, page, title, kind) });
    };
    for (const el of document.querySelectorAll(PAGE_SEL)) if (visible(el)) add(el, null);
    for (const panel of document.querySelectorAll('[role=tabpanel]')) {
      if (visible(panel) || inPalette(panel)) continue;
      const tab = tabForPanel(panel); if (!tab) continue;
      const page = { tab, panel, name: nameOf(tab.querySelector('.lbl') || tab) };
      for (const el of panel.querySelectorAll(PAGE_SEL)) if (hiddenOnlyByPanel(el, panel)) add(el, page);
    }
    return out;
  }

  function settingItems() {
    const root = document.documentElement.dataset, out = [], M = window.MVL;
    if (M && M.setTheme) {
      const pref = root.themePref || 'system';
      for (const [v, l] of THEMES) out.push({ group: 'Settings', title: 'Theme: ' + l, value: pref === v ? 'Current' : '', keywords: 'appearance colour color mode light dark system', keep: true, run: () => { M.setTheme(v); notify({ theme: v }); say('Theme set to ' + l + '.'); } });
    }
    if (M && M.setSeed && window.MVL_SCHEMES) {
      for (const s of Object.keys(window.MVL_SCHEMES)) out.push({ group: 'Settings', title: 'Seed colour: ' + s, swatch: window.MVL_SCHEMES[s].seed, value: root.seed === s ? 'Current' : '', keywords: 'appearance accent color colour scheme seed', keep: true, run: () => { M.setSeed(s); notify({ seed: s }); say('Seed colour set to ' + s + '.'); } });
    }
    if (M && M.setReduceMotion) {
      const on = root.reduceMotion === 'true';
      out.push({ group: 'Settings', title: 'Reduce motion', value: on ? 'On' : 'Off', keywords: 'animation accessibility motion switch toggle', keep: true, run: () => { M.setReduceMotion(!on); if (window.MVLMotion) window.MVLMotion.apply(); notify({ reduceMotion: !on }); say('Reduce motion is ' + (on ? 'off.' : 'on.')); } });
    }
    if (window.MVLMotion && window.MVLMotion.setProfile) {
      const cur = (window.MVLMotion.get() || {}).profile;
      for (const p of ['Calm', 'Standard', 'Expressive', 'Playful']) out.push({ group: 'Settings', title: 'Motion profile: ' + p, value: cur === p ? 'Current' : '', keywords: 'animation motion profile speed', keep: true, run: () => { window.MVLMotion.setProfile(p); notify({ motionProfile: p }); say(p + ' motion profile applied.'); } });
    }
    if (window.MVLVocab && window.MVLVocab.status && window.MVLVocab.status().loaded) {
      out.push({ group: 'Settings', title: 'Clear personal vocabulary', hint: 'Restores the original wording', keywords: 'vocabulary wording words reset remove', keep: true, run: () => { window.MVLVocab.clear(); say('Personal vocabulary cleared. The original wording is back.'); } });
    }
    return out;
  }
  // Lets an open settings surface resync its own controls after a palette change.
  function notify(detail) { try { document.dispatchEvent(new CustomEvent('mvl-appearance', { detail })); } catch { /* ignore */ } }

  function commandItems() {
    const builtIn = [];
    if (window.MVLNotify && window.MVLNotify.openCentre) builtIn.push({ group: 'Actions', title: 'Open notifications', hint: 'Notification centre', keywords: 'notifications bell alerts messages centre center', run: () => { close(false); window.MVLNotify.openCentre(); } });
    return builtIn.concat([...commands.values()].map((c) => ({ group: c.group || 'Actions', title: clean(c.title), hint: c.hint ? clean(c.hint) : '', keywords: Array.isArray(c.keywords) ? c.keywords.join(' ') : (c.keywords || ''), keep: !!c.keepOpen, run: c.run })));
  }

  function rebuild() {
    let all = [];
    for (const f of [navItems, commandItems, settingItems, pageItems]) { try { all = all.concat(f()); } catch (e) { console.warn('Palette source skipped:', e && e.message); } }
    items = all.filter((i) => i.title && typeof i.run === 'function');
  }

  // ---------- teleport ----------
  function teleport(el, page, title, kind) {
    if (page && !visible(page.panel)) page.tab.click();
    close(false);
    requestAnimationFrame(() => {
      let t = el;
      if (!t.isConnected) { // the page re-rendered; find the same control again by its name
        t = [...document.querySelectorAll(PAGE_SEL)].find((x) => visible(x) && kindOf(x) === kind && nameOf(x) === title) || null;
      }
      if (!t) { if (window.MVL && window.MVL.toast) window.MVL.toast('That item is no longer on the page.'); return; }
      t.scrollIntoView({ block: 'center', inline: 'nearest', behavior: motionOff() ? 'auto' : 'smooth' });
      const focusable = t.matches('button, a[href], input, select, textarea, [tabindex]');
      if (!focusable) { t.setAttribute('tabindex', '-1'); t.addEventListener('blur', () => t.removeAttribute('tabindex'), { once: true }); }
      t.focus({ preventScroll: true });
      t.classList.remove('pal-flash'); void t.offsetWidth; t.classList.add('pal-flash');
      setTimeout(() => t.classList.remove('pal-flash'), 1200);
    });
  }

  // ---------- search and render ----------
  function matchText(item) {
    const m = search.test(item.title);
    if (m && m[0] !== undefined) return { m, score: m.index === 0 ? 0 : 1 };
    const rest = [item.value, item.hint, item.group, item.keywords].filter(Boolean).join(' ');
    return search.test(rest) ? { m: null, score: 2 } : null;
  }
  function highlight(title, m) {
    if (!m || !m[0]) return esc(title);
    const i = m.index, j = i + m[0].length;
    return esc(title.slice(0, i)) + '<mark>' + esc(title.slice(i, j)) + '</mark>' + esc(title.slice(j));
  }
  function render(keepActive) {
    lastTerm = search.term() + '|' + search.isRegex();
    const q = search.active();
    let rows = [];
    if (!q) rows = items.filter((i) => !i.other).map((it, n) => ({ it, m: null, score: 0, n }));
    else if (!search.invalid()) items.forEach((it, n) => { const r = matchText(it); if (r) rows.push({ it, m: r.m, score: r.score, n }); });
    const gi = (g) => { const k = GROUPS.indexOf(g); return k < 0 ? GROUPS.length - 1.5 : k; };
    rows.sort((a, b) => gi(a.it.group) - gi(b.it.group) || a.score - b.score || a.n - b.n);
    const total = rows.length;
    rows = rows.slice(0, LIMIT);
    shown = rows.map((r) => r.it);
    if (!keepActive) active = 0;
    active = Math.max(0, Math.min(active, shown.length - 1));
    let html = '', group = null;
    rows.forEach((r, n) => {
      if (r.it.group !== group) { group = r.it.group; html += `<li role="presentation" class="pal-group" aria-hidden="true">${esc(group)}</li>`; }
      const it = r.it;
      const val = it.value ? `<span class="pal-val${it.value === 'Current' || it.value === 'On' ? ' on' : ''}">${it.value === 'Current' ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"></path></svg>' : ''}${esc(it.value)}</span>` : '';
      html += `<li role="option" id="pal-opt-${n}" class="pal-opt" data-i="${n}" aria-selected="${n === active}" aria-label="${esc(it.title + (it.value ? ', ' + it.value : '') + (it.hint ? ', ' + it.hint : '') + ', ' + it.group)}">`
        + (it.swatch ? `<i class="pal-sw" style="background:${esc(it.swatch)}"></i>` : `<i class="pal-ic" data-g="${esc(gi(it.group))}"></i>`)
        + `<span class="pal-txt"><span class="pal-title">${highlight(it.title, r.m)}</span>${it.hint ? `<span class="pal-hint">${esc(it.hint)}</span>` : ''}</span>${val}</li>`;
    });
    if (!rows.length) html = `<li role="presentation" class="pal-empty">${search.invalid() ? 'That regex pattern is not valid yet, so nothing is listed. Fix the pattern or switch regex off.' : 'Nothing matches. Try fewer letters, or switch regex off.'}</li>`;
    list.innerHTML = html;
    syncActive(false);
    const msg = !rows.length ? 'No results' : total > LIMIT ? `Showing the first ${LIMIT} of ${total} results` : total === 1 ? '1 result' : total + ' results';
    if (search.setStatus && search.isRegex()) search.setStatus(msg.toLowerCase());
    clearTimeout(liveTimer); liveTimer = setTimeout(() => say(msg), 250);
  }
  function syncActive(scroll) {
    const opts = list.querySelectorAll('.pal-opt');
    opts.forEach((o, n) => o.setAttribute('aria-selected', String(n === active)));
    const cur = opts[active];
    if (cur) { search.input.setAttribute('aria-activedescendant', cur.id); if (scroll) cur.scrollIntoView({ block: 'nearest' }); }
    else search.input.removeAttribute('aria-activedescendant');
  }
  function say(t) { if (!live) return; live.textContent = ''; setTimeout(() => { live.textContent = t; }, 30); }

  function choose(n) {
    const it = shown[n]; if (!it) return;
    try { it.run(); } catch (e) { if (window.MVL && window.MVL.toast) window.MVL.toast('That command failed: ' + (e && e.message ? e.message : e)); }
    if (it.keep && dlg && dlg.open) { rebuild(); active = n; render(true); search.input.focus(); }
    else if (dlg && dlg.open) close(true); // registered commands close the palette unless they set keepOpen
  }

  // ---------- dialog ----------
  function build() {
    dlg = document.createElement('dialog');
    dlg.className = 'pal'; dlg.id = 'mvl-palette';
    dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true'); dlg.setAttribute('aria-labelledby', 'pal-title');
    dlg.innerHTML = `<div class="pal-body"><div class="pal-head"><h2 id="pal-title">Command palette</h2><span class="pal-keys" aria-hidden="true"><kbd>&uarr;</kbd><kbd>&darr;</kbd> move <kbd>Enter</kbd> choose <kbd>Esc</kbd> close</span><button type="button" class="pal-close" aria-label="Close the command palette" title="Close"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg></button></div><div class="pal-search"></div><ul class="pal-list" id="pal-list" role="listbox" aria-label="Results"></ul><div class="sr" aria-live="polite" role="status" data-pal-live></div></div>`;
    search = window.MVL.makeSearch({ placeholder: 'Type a page, setting, command or control', label: 'Search commands, pages, settings and controls', onChange: () => { if (dlg.open) render(false); } });
    dlg.querySelector('.pal-search').append(search.el);
    list = dlg.querySelector('.pal-list'); live = dlg.querySelector('[data-pal-live]');
    const input = search.input;
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-expanded', 'true'); input.setAttribute('aria-controls', 'pal-list'); input.setAttribute('aria-autocomplete', 'list');
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
      const inField = e.target === input || e.target.classList.contains('pat');
      if (!inField) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!shown.length) return; active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length; syncActive(true); }
      else if (e.key === 'Home' && e.ctrlKey) { e.preventDefault(); active = 0; syncActive(true); }
      else if (e.key === 'End' && e.ctrlKey) { e.preventDefault(); active = shown.length - 1; syncActive(true); }
      else if (e.key === 'PageDown' || e.key === 'PageUp') { e.preventDefault(); active = Math.max(0, Math.min(shown.length - 1, active + (e.key === 'PageDown' ? 8 : -8))); syncActive(true); }
      else if (e.key === 'Enter') { e.preventDefault(); flushThen(() => choose(active)); }
    }, true);
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(true); });
    dlg.addEventListener('mousedown', (e) => { if (e.target === dlg) close(true); });
    dlg.querySelector('.pal-close').addEventListener('click', () => close(true));
    list.addEventListener('mousedown', (e) => { if (e.target.closest('.pal-opt')) e.preventDefault(); });
    list.addEventListener('mousemove', (e) => { const o = e.target.closest('.pal-opt'); if (o && Number(o.dataset.i) !== active) { active = Number(o.dataset.i); syncActive(false); } });
    list.addEventListener('click', (e) => { const o = e.target.closest('.pal-opt'); if (o) choose(Number(o.dataset.i)); });
    document.body.append(dlg);
  }
  // Typing is debounced inside makeSearch; Enter right after typing renders the newest results first.
  let lastTerm = '';
  function flushThen(fn) {
    const term = search.term() + '|' + search.isRegex();
    if (term !== lastTerm) { render(false); fn(); } else fn();
  }

  function open() {
    if (!window.MVL || !window.MVL.makeSearch || !document.body) return;
    if (!dlg) build();
    if (!dlg.isConnected) document.body.append(dlg);
    if (dlg.open) { search.input.focus(); search.input.select(); return; }
    prevFocus = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    rebuild();
    lastTerm = search.term() + '|' + search.isRegex();
    dlg.showModal();
    render(false);
    search.input.focus(); search.input.select();
    document.documentElement.classList.add('pal-open');
  }
  function close(restore) {
    if (!dlg || !dlg.open) return;
    dlg.close();
    document.documentElement.classList.remove('pal-open');
    const prev = prevFocus; prevFocus = null;
    if (restore !== false && prev && prev.isConnected && prev.focus) prev.focus();
  }
  function register(cmd) {
    if (!cmd || typeof cmd.run !== 'function' || !cmd.title) throw new Error('MVLPalette.register needs a title and a run function.');
    const id = String(cmd.id || 'cmd' + (++seq));
    commands.set(id, Object.assign({}, cmd, { id }));
    if (dlg && dlg.open) refresh();
    return () => { if (commands.get(id) && commands.get(id).run === cmd.run) commands.delete(id); if (dlg && dlg.open) refresh(); };
  }
  function refresh() { rebuild(); if (dlg && dlg.open) render(true); }

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && (e.code === 'KeyF' || e.key === 'F' || e.key === 'f')) {
      e.preventDefault(); e.stopPropagation(); open();
    }
  }, true);

  window.MVLPalette = { open, close: () => close(true), register, refresh };
})();
