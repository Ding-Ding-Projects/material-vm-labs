'use strict';
// Site shell: settings, tabs, search with its regex builder, the command palette, copy buttons
// and the personal vocabulary. Everything is local; nothing is fetched from the network.
(function () {
  const INDEX = window.MVL_INDEX || { pages: [], sections: [], tops: [] };
  const body = document.body;
  const ROOT = body.dataset.root || '';
  const PAGE = body.dataset.page || 'index.html';
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const pageByUrl = new Map(INDEX.pages.map((p) => [p.url, p]));
  const hrefOf = (url, id) => ROOT + url + (id ? '#' + id : '');

  function load(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fallback : v; } catch { return fallback; } }
  function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable: settings last for this page only */ } }

  // ---------- toast ----------
  let toastTimer;
  function toast(text) {
    const t = $('.toast');
    if (!t) return;
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }
  window.MVL = Object.assign(window.MVL || {}, { toast });

  // ---------- settings ----------
  const SKEY = 'mvl-site-settings';
  const DEFAULTS = { theme: 'system', motion: 'system', textSize: '100' };
  const settings = Object.assign({}, DEFAULTS, load(SKEY, {}));
  const LABELS = {
    theme: { name: 'Theme', options: [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], target: 'set-theme' },
    motion: { name: 'Motion', options: [['system', 'Follow the system'], ['full', 'Full'], ['reduced', 'Reduced']], target: 'set-motion' },
    textSize: { name: 'Text size', options: [['90', 'Small'], ['100', 'Default'], ['115', 'Large'], ['130', 'Larger']], target: 'set-text-size' },
  };
  const darkQuery = matchMedia('(prefers-color-scheme: dark)');
  function applySettings() {
    const d = document.documentElement;
    d.setAttribute('data-theme', settings.theme === 'system' ? (darkQuery.matches ? 'dark' : 'light') : settings.theme);
    if (settings.motion === 'reduced') d.setAttribute('data-reduce-motion', 'true');
    else if (settings.motion === 'full') d.setAttribute('data-reduce-motion', 'false');
    else d.removeAttribute('data-reduce-motion');
    d.style.fontSize = settings.textSize === '100' ? '' : settings.textSize + '%';
    for (const fs of $$('[data-setting]')) {
      const v = settings[fs.dataset.setting];
      for (const r of $$('input[type=radio]', fs)) r.checked = r.value === v;
    }
    const tb = $('.theme-btn');
    if (tb) { const l = 'Theme: ' + labelOf('theme', settings.theme) + '. Change theme'; tb.setAttribute('aria-label', l); tb.title = l; }
  }
  function labelOf(key, value) { const o = LABELS[key].options.find((x) => x[0] === value); return o ? o[1] : value; }
  function setSetting(key, value, quiet) {
    settings[key] = value;
    save(SKEY, settings);
    applySettings();
    if (!quiet) toast(`${LABELS[key].name}: ${labelOf(key, value)}`);
  }
  darkQuery.addEventListener('change', () => { if (settings.theme === 'system') applySettings(); });
  window.MVLSettings = { get: () => Object.assign({}, settings), set: setSetting, reduced: () => getComputedStyle(document.documentElement).getPropertyValue('--mvl-motion-scale').trim() === '0' };
  applySettings();
  for (const fs of $$('[data-setting]')) fs.addEventListener('change', (e) => { if (e.target.matches('input[type=radio]')) setSetting(fs.dataset.setting, e.target.value); });
  const themeBtn = $('.theme-btn');
  if (themeBtn) themeBtn.addEventListener('click', () => {
    const order = ['system', 'light', 'dark'];
    setSetting('theme', order[(order.indexOf(settings.theme) + 1) % order.length]);
  });

  // ---------- tabs ----------
  const TKEY = 'mvl-site-tabs';
  const tops = INDEX.tops;
  const tabs = load(TKEY, null) || { open: tops.slice(), closed: [], seen: tops.slice() };
  tabs.open = (tabs.open || []).filter((u) => pageByUrl.has(u));
  tabs.closed = (tabs.closed || []).filter((u) => pageByUrl.has(u));
  tabs.seen = tabs.seen || [];
  // An update opens only top-level pages the strip has never offered; closed tabs stay closed.
  for (const u of tops) if (!tabs.seen.includes(u)) { tabs.seen.push(u); if (!tabs.open.includes(u)) tabs.open.push(u); }
  if (!tabs.open.includes(PAGE) && pageByUrl.has(PAGE)) { tabs.open.push(PAGE); tabs.closed = tabs.closed.filter((u) => u !== PAGE); }
  save(TKEY, tabs);
  const strip = $('.tabs');
  function renderTabs(fresh) {
    if (!strip) return;
    strip.innerHTML = tabs.open.map((u) => {
      const p = pageByUrl.get(u);
      const active = u === PAGE;
      const kind = p.kind === 'article' ? ' article' : '';
      return `<li class="tab${active ? ' active' : ''}${kind}${fresh && fresh.includes(u) ? ' opening' : ''}" data-key="${esc(u)}"><a href="${esc(hrefOf(u))}"${active ? ' aria-current="page"' : ''} title="${esc(p.title)}"><span class="tab-kind" aria-hidden="true"></span>${esc(p.title)}</a><button type="button" class="tab-close" aria-label="Close tab: ${esc(p.title)}" title="Close tab">&times;</button></li>`;
    }).join('');
    const act = $('.tab.active', strip);
    if (act) strip.scrollLeft = Math.max(0, act.offsetLeft - strip.clientWidth / 2 + act.offsetWidth / 2);
    const cc = $('[data-out="closed-count"]');
    if (cc) cc.textContent = tabs.closed.length ? `${tabs.closed.length} closed tab${tabs.closed.length === 1 ? '' : 's'}: ${tabs.closed.map((u) => pageByUrl.get(u).title).join(', ')}.` : 'No tabs are closed.';
  }
  function closeTab(u) {
    const i = tabs.open.indexOf(u);
    if (i < 0) return;
    tabs.open.splice(i, 1);
    if (!tabs.closed.includes(u)) tabs.closed.push(u);
    save(TKEY, tabs);
    const title = pageByUrl.get(u).title;
    if (u === PAGE) {
      const next = tabs.open[i] || tabs.open[i - 1];
      location.href = next ? hrefOf(next) : hrefOf('index.html');
      return;
    }
    renderTabs();
    const focusTo = $$('.tab a', strip)[Math.min(i, tabs.open.length - 1)];
    if (focusTo) focusTo.focus();
    toast(`Closed ${title}`);
  }
  function openEveryTab() {
    const before = new Set(tabs.open);
    const articles = tabs.open.filter((u) => !tops.includes(u));
    tabs.open = [...tops, ...articles];
    tabs.closed = [];
    save(TKEY, tabs);
    const fresh = tabs.open.filter((u) => !before.has(u));
    renderTabs(fresh);
    toast(fresh.length ? `Opened ${fresh.length} tab${fresh.length === 1 ? '' : 's'}` : 'Every tab is already open');
  }
  window.MVLTabs = { openEveryTab, state: () => JSON.parse(JSON.stringify(tabs)) };
  renderTabs();
  if (strip) {
    strip.addEventListener('click', (e) => {
      const b = e.target.closest('.tab-close');
      if (b) { e.preventDefault(); closeTab(b.closest('.tab').dataset.key); }
    });
    strip.addEventListener('auxclick', (e) => {
      const t = e.target.closest('.tab');
      if (t && e.button === 1) { e.preventDefault(); closeTab(t.dataset.key); }
    });
    strip.addEventListener('keydown', (e) => {
      const t = e.target.closest('.tab');
      if (!t || !e.target.matches('a')) return;
      const links = $$('.tab a', strip);
      const i = links.indexOf(e.target);
      if (e.key === 'Delete') { e.preventDefault(); closeTab(t.dataset.key); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const n = links[(i + (e.key === 'ArrowRight' ? 1 : -1) + links.length) % links.length]; n.focus(); }
      else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); links[e.key === 'Home' ? 0 : links.length - 1].focus(); }
    });
  }
  for (const b of $$('.open-all, [data-action="open-all"]')) b.addEventListener('click', openEveryTab);

  // ---------- rail drawer (narrow screens) ----------
  const menuBtn = $('.menu-btn');
  const rail = $('#rail');
  function setRail(open) {
    body.classList.toggle('rail-open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
    if (open) { const a = $('a[aria-current="page"]', rail) || $('a', rail); if (a) a.focus(); } else menuBtn.focus();
  }
  if (menuBtn && rail) {
    menuBtn.addEventListener('click', () => setRail(!body.classList.contains('rail-open')));
    document.addEventListener('click', (e) => { if (body.classList.contains('rail-open') && !rail.contains(e.target) && !menuBtn.contains(e.target)) setRail(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && body.classList.contains('rail-open')) setRail(false); });
  }

  // ---------- search ----------
  const q = $('#q');
  const results = $('#search-results');
  const regexBtn = $('.regex-toggle');
  const builder = $('#regex-builder');
  const status = $('.regex-status');
  const RKEY = 'mvl-site-regex';
  const rx = Object.assign({ on: false, flags: 'iu' }, load(RKEY, {}));
  let selected = -1;

  function matcher(query) {
    if (rx.on) {
      if (!query) return { error: null, empty: true };
      try { const re = new RegExp(query, rx.flags.replace(/g/g, '') + 'g'); return { test: (s) => { re.lastIndex = 0; return re.test(s); }, re }; }
      catch (err) { return { error: err.message }; }
    }
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return { empty: true };
    const re = new RegExp(terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');
    return { test: (s) => { const l = s.toLowerCase(); return terms.every((t) => l.includes(t)); }, re };
  }
  function snippet(text, re) {
    re.lastIndex = 0;
    const m = re.exec(text);
    let start = 0;
    if (m) start = Math.max(0, m.index - 60);
    let s = (start ? '…' : '') + text.slice(start, start + 190) + (text.length > start + 190 ? '…' : '');
    re.lastIndex = 0;
    let out = '', last = 0, mm, guard = 0;
    while ((mm = re.exec(s)) && guard++ < 50) {
      if (!mm[0].length) { re.lastIndex++; continue; }
      out += esc(s.slice(last, mm.index)) + '<mark>' + esc(mm[0]) + '</mark>';
      last = mm.index + mm[0].length;
    }
    return out + esc(s.slice(last));
  }
  function search(query) {
    const m = matcher(query);
    if (m.empty || m.error) return m;
    const hits = [];
    for (const s of INDEX.sections) {
      const page = pageByUrl.get(s.url);
      const hay = page.title + ' ' + s.heading + ' ' + s.text;
      if (!m.test(hay)) continue;
      let score = 0;
      if (m.test(s.heading)) score += 5;
      if (m.test(page.title)) score += 3;
      if (page.kind === 'article') score += 2; else if (page.kind === 'category') score += 1;
      hits.push({ s, page, score });
    }
    hits.sort((a, b) => b.score - a.score);
    return { hits, re: m.re };
  }
  function updateStatus(r) {
    if (!status) return;
    status.classList.remove('ok', 'bad');
    if (!rx.on) { status.textContent = ''; return; }
    if (r.error) { status.textContent = 'Invalid pattern: ' + r.error.replace(/^Invalid regular expression: \/.*\/[a-z]*: /, ''); status.classList.add('bad'); }
    else if (r.empty) status.textContent = 'Type a pattern, or insert a token below.';
    else { status.textContent = `Valid: /${q.value}/${rx.flags}, ${r.hits.length} match${r.hits.length === 1 ? '' : 'es'}`; status.classList.add('ok'); }
  }
  function renderResults() {
    const query = q.value.trim() && rx.on ? q.value : q.value.trim();
    const r = search(query);
    updateStatus(r);
    selected = -1;
    q.removeAttribute('aria-activedescendant');
    if (r.empty) { results.hidden = true; q.setAttribute('aria-expanded', 'false'); return; }
    if (r.error) { results.innerHTML = '<p class="count">No results while the pattern is invalid.</p>'; }
    else {
      const shown = r.hits.slice(0, 40);
      results.innerHTML = `<p class="count" id="search-count">${r.hits.length ? `${r.hits.length} result${r.hits.length === 1 ? '' : 's'}${r.hits.length > shown.length ? `, showing ${shown.length}` : ''}` : 'No results. Try fewer words, or turn on regex mode.'}</p>` +
        shown.map((h, i) => `<a class="result" role="option" id="sr-${i}" aria-selected="false" href="${esc(hrefOf(h.s.url, h.s.id))}"><span class="r-crumb">${esc(h.page.crumb ? h.page.crumb + ' / ' + h.page.title : h.page.title)}</span><span class="r-title">${esc(h.s.heading)}</span><span class="r-snip">${snippet(h.s.text || h.page.summary || '', h.re ? h.re : r.re)}</span></a>`).join('');
    }
    results.hidden = false;
    q.setAttribute('aria-expanded', 'true');
  }
  function moveSel(d) {
    const opts = $$('.result', results);
    if (!opts.length) return;
    if (selected >= 0) opts[selected].setAttribute('aria-selected', 'false');
    selected = (selected + d + opts.length) % opts.length;
    opts[selected].setAttribute('aria-selected', 'true');
    opts[selected].scrollIntoView({ block: 'nearest' });
    q.setAttribute('aria-activedescendant', opts[selected].id);
  }
  function setRegex(on) {
    rx.on = on;
    save(RKEY, rx);
    regexBtn.setAttribute('aria-pressed', String(on));
    builder.hidden = !on;
    q.placeholder = on ? 'Regular expression, for example --\\w+' : 'Search the documentation';
    for (const c of $$('[data-flag]', builder)) c.setAttribute('aria-pressed', String(rx.flags.includes(c.dataset.flag)));
    renderResults();
  }
  if (q) {
    q.addEventListener('input', renderResults);
    q.addEventListener('focus', () => { if (q.value) renderResults(); });
    q.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSel(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveSel(-1); }
      else if (e.key === 'Enter') {
        const opts = $$('.result', results);
        const t = opts[selected >= 0 ? selected : 0];
        if (t && !results.hidden) { e.preventDefault(); go(t.getAttribute('href')); }
      } else if (e.key === 'Escape') {
        if (!results.hidden) { results.hidden = true; q.setAttribute('aria-expanded', 'false'); } else if (rx.on) setRegex(false); else q.blur();
      }
    });
    regexBtn.addEventListener('click', () => { setRegex(!rx.on); q.focus(); });
    for (const c of $$('[data-flag]', builder)) c.addEventListener('click', () => {
      const f = c.dataset.flag;
      rx.flags = (rx.flags.includes(f) ? rx.flags.replace(f, '') : rx.flags + f).split('').sort().join('');
      setRegex(true);
    });
    for (const c of $$('[data-token]', builder)) c.addEventListener('click', () => {
      const t = c.dataset.token;
      const a = q.selectionStart ?? q.value.length, b = q.selectionEnd ?? q.value.length;
      q.value = q.value.slice(0, a) + t + q.value.slice(b);
      q.focus();
      q.setSelectionRange(a + t.length, a + t.length);
      renderResults();
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('.search')) { results.hidden = true; q.setAttribute('aria-expanded', 'false'); } });
    if (rx.on) setRegex(true); else for (const c of $$('[data-flag]', builder)) c.setAttribute('aria-pressed', String(rx.flags.includes(c.dataset.flag)));
  }
  const searchBtn = $('.search-btn');
  function openSearch() {
    body.classList.add('search-open');
    if (searchBtn) searchBtn.setAttribute('aria-expanded', 'true');
    setTimeout(() => q.focus(), 0);
  }
  if (searchBtn) searchBtn.addEventListener('click', () => {
    const open = !body.classList.contains('search-open');
    if (open) openSearch(); else { body.classList.remove('search-open'); searchBtn.setAttribute('aria-expanded', 'false'); }
  });
  for (const b of $$('[data-focus-search]')) b.addEventListener('click', () => { scrollTo({ top: 0 }); openSearch(); });
  window.MVLSearch = { search: (s) => search(s), setRegex };

  // Navigates; on the same page it scrolls to the element and flashes it instead.
  function go(href) {
    const u = new URL(href, location.href);
    if (u.pathname === location.pathname && u.hash) {
      history.pushState(null, '', u.hash);
      reveal(decodeURIComponent(u.hash.slice(1)));
      return;
    }
    location.href = u.href;
  }
  function reveal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ block: 'start' });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    if (!el.matches('a, button, input, select, textarea, [tabindex]')) el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
  }
  if (location.hash) setTimeout(() => reveal(decodeURIComponent(location.hash.slice(1))), 60);
  window.addEventListener('hashchange', () => reveal(decodeURIComponent(location.hash.slice(1))));

  // ---------- command palette ----------
  const pal = $('.palette');
  const pin = $('.palette-input');
  const plist = $('#palette-list');
  let pitems = [], psel = 0;
  function paletteItems(query) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const ok = (s) => { const l = s.toLowerCase(); return terms.every((t) => l.includes(t)); };
    const out = [];
    for (const key of Object.keys(LABELS)) {
      for (const [v, label] of LABELS[key].options) {
        const title = `${LABELS[key].name}: ${label}`;
        if (ok(title + ' setting appearance')) out.push({ group: 'Settings (apply live)', title, sub: 'Applies at once', state: settings[key] === v ? 'Current' : '', run: () => { setSetting(key, v); return 'stay'; } });
      }
      const gt = `Go to the ${LABELS[key].name} setting`;
      if (ok(gt + ' settings')) out.push({ group: 'Settings (apply live)', title: gt, sub: 'Settings page', run: () => go(hrefOf('settings.html', LABELS[key].target)) });
    }
    if (window.MVLI18n) {
      for (const [m, label] of [['en', 'English'], ['yue', 'Cantonese (廣東話)'], ['bi', 'Bilingual']]) {
        const title = `Language: ${label}`;
        if (ok(title + ' setting language')) out.push({ group: 'Settings (apply live)', title, sub: 'Applies at once', state: window.MVLI18n.mode() === m ? 'Current' : '', run: () => { window.MVLI18n.setMode(m); toast(title); return 'stay'; } });
      }
      if (ok('Go to the Language setting settings')) out.push({ group: 'Settings (apply live)', title: 'Go to the Language setting', sub: 'Settings page', run: () => go(hrefOf('settings.html', 'language-setting')) });
    }
    const actions = [
      { title: 'Download for Windows', sub: 'Latest release on GitHub, not code-signed', run: () => { const a = document.querySelector('.dl-btn'); if (a) location.href = a.href; } },
      { title: 'Open every tab', sub: 'Reopens closed tabs', run: () => { openEveryTab(); return 'stay'; } },
      { title: 'Personal vocabulary', sub: 'Settings page', run: () => go(hrefOf('settings.html', 'vocabulary')) },
      { title: 'Download the PDF edition', sub: 'Every article at phone size', run: () => { location.href = ROOT + 'material-vm-labs-docs.pdf'; } },
      { title: 'Search the documentation', sub: 'Focus the search field', run: () => { setTimeout(() => q.focus(), 0); } },
      { title: 'Toggle regex search', sub: rx.on ? 'Regex mode is on' : 'Regex mode is off', run: () => { setRegex(!rx.on); setTimeout(() => q.focus(), 0); } },
    ];
    for (const a of actions) if (ok(a.title + ' ' + a.sub + ' action')) out.push(Object.assign({ group: 'Actions' }, a));
    for (const p of INDEX.pages) if (ok(p.title + ' ' + (p.crumb || '') + ' page')) out.push({ group: 'Pages', title: p.title, sub: p.crumb || 'Page', kind: p.kind === 'article' ? 'Article' : 'Page', run: () => go(hrefOf(p.url)) });
    if (terms.length) {
      for (const s of INDEX.sections) {
        if (!s.id) continue;
        const p = pageByUrl.get(s.url);
        if (ok(s.heading + ' ' + p.title)) out.push({ group: 'Headings', title: s.heading, sub: p.title, kind: 'Heading', run: () => go(hrefOf(s.url, s.id)) });
      }
    }
    return out.slice(0, 80);
  }
  function renderPalette(keepSel) {
    pitems = paletteItems(pin.value.trim());
    if (!keepSel) psel = 0;
    psel = Math.min(psel, Math.max(0, pitems.length - 1));
    let group = '', h = '';
    pitems.forEach((it, i) => {
      if (it.group !== group) { group = it.group; h += `<li class="group" role="presentation">${esc(group)}</li>`; }
      h += `<li role="option" id="po-${i}" aria-selected="${i === psel}" data-i="${i}"><span class="p-main"><span class="p-title">${esc(it.title)}</span><span class="p-sub">${esc(it.sub || '')}</span></span>${it.state ? `<span class="p-state">${esc(it.state)}</span>` : ''}${it.kind ? `<span class="p-kind">${esc(it.kind)}</span>` : ''}</li>`;
    });
    plist.innerHTML = h || '<li class="group" role="presentation">Nothing matches</li>';
    if (pitems.length) { pin.setAttribute('aria-activedescendant', 'po-' + psel); const s = $('#po-' + psel, plist); if (s) s.scrollIntoView({ block: 'nearest' }); }
    else pin.removeAttribute('aria-activedescendant');
  }
  function runItem(i) {
    const it = pitems[i];
    if (!it) return;
    const r = it.run();
    if (r === 'stay') renderPalette(true); else pal.close();
  }
  function openPalette() {
    if (!pal) return;
    if (!pal.open) pal.showModal();
    pin.value = '';
    renderPalette();
    pin.focus();
  }
  window.MVLPalette = { open: openPalette };
  if (pal) {
    pin.addEventListener('input', () => renderPalette());
    pin.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (pitems.length) { psel = (psel + (e.key === 'ArrowDown' ? 1 : -1) + pitems.length) % pitems.length; renderPalette(true); } }
      else if (e.key === 'Enter') { e.preventDefault(); runItem(psel); }
    });
    plist.addEventListener('click', (e) => { const o = e.target.closest('[role=option]'); if (o) { psel = +o.dataset.i; runItem(psel); } });
    pal.addEventListener('click', (e) => { if (e.target === pal) pal.close(); });
    $('.palette-btn').addEventListener('click', openPalette);
    const pc = $('.palette-close');
    if (pc) pc.addEventListener('click', () => pal.close());
  }
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'F' || e.key === 'f')) { e.preventDefault(); openPalette(); }
    else if (e.key === '/' && !e.target.closest('input, textarea, [contenteditable]') && !(pal && pal.open)) { e.preventDefault(); openSearch(); }
  });

  // ---------- copy buttons ----------
  for (const pre of $$('main pre')) {
    let card = pre.closest('.code-card');
    if (!card) {
      card = document.createElement('div');
      card.className = 'code-card';
      const lang = ($('code', pre) || pre).className.match(/language-(\w+)/);
      card.innerHTML = `<span class="code-label">${lang && /^(bat|cmd)$/.test(lang[1]) ? 'Command prompt' : lang ? esc(lang[1]) : 'Example'}</span>`;
      pre.replaceWith(card);
      card.append(pre);
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'copy-btn';
    b.textContent = 'Copy';
    b.setAttribute('aria-label', 'Copy: ' + ($('.code-label', card) ? $('.code-label', card).textContent : 'code'));
    b.addEventListener('click', async () => {
      const text = ($('code', pre) || pre).textContent;
      try { await navigator.clipboard.writeText(text); toast('Copied to the clipboard'); }
      catch { toast('Copy is not available here; select the text instead'); }
    });
    card.append(b);
  }

  // ---------- on this page: highlight the section being read ----------
  const tocLinks = $$('.toc a');
  if (tocLinks.length && 'IntersectionObserver' in window) {
    const map = new Map(tocLinks.map((a) => [decodeURIComponent(a.hash.slice(1)), a]));
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) { for (const a of tocLinks) a.classList.remove('current'); const a = map.get(en.target.id); if (a) a.classList.add('current'); }
    }, { rootMargin: '-20% 0px -70% 0px' });
    for (const id of map.keys()) { const el = document.getElementById(id); if (el) io.observe(el); }
  }

  // ---------- links to the repository, when the site knows it ----------
  (function repoLinks() {
    const meta = $('meta[name="mvl-repo"]');
    let repo = meta ? meta.content : '';
    if (!repo && /\.github\.io$/.test(location.hostname)) {
      const seg = location.pathname.split('/').filter(Boolean)[0];
      if (seg) repo = location.hostname.split('.')[0] + '/' + seg;
    }
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return;
    for (const a of $$('[data-repo-link]')) { a.href = 'https://github.com/' + repo + (a.dataset.repoLink ? '/' + a.dataset.repoLink : ''); a.hidden = false; }
    for (const s of $$('.repo-links')) s.hidden = false;
  })();

  // ---------- top bar: a shadow once the page scrolls ----------
  const topbar = $('.topbar');
  if (topbar) {
    const onScroll = () => topbar.classList.toggle('scrolled', scrollY > 8);
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ---------- task articles: checklist, steps, route switch, feedback (all local) ----------
  const AKEY = 'mvl-site-article';
  const astate = load(AKEY, {});
  const mine = () => {
    const m = (astate[PAGE] = astate[PAGE] || {});
    m.checks = m.checks || [];
    m.done = m.done || [];
    return m;
  };
  for (const c of $$('.checklist input[data-check]')) {
    c.checked = mine().checks.includes(c.dataset.check);
    c.addEventListener('change', () => {
      mine().checks = $$('.checklist input[data-check]').filter((x) => x.checked).map((x) => x.dataset.check);
      save(AKEY, astate);
    });
  }
  function paintDone(b, on) {
    b.setAttribute('aria-pressed', String(on));
    b.textContent = on ? 'Done, undo' : 'Mark as done';
    b.closest('.task-step').classList.toggle('done', on);
  }
  for (const b of $$('.done-btn[data-done]')) {
    paintDone(b, mine().done.includes(b.dataset.done));
    b.addEventListener('click', () => {
      const m = mine();
      const on = !m.done.includes(b.dataset.done);
      m.done = on ? m.done.concat(b.dataset.done) : m.done.filter((x) => x !== b.dataset.done);
      save(AKEY, astate);
      paintDone(b, on);
      if (on) toast('Step marked as done. Saved in this browser.');
    });
  }
  const route = $('.route-switch');
  if (route) {
    const tabsR = $$('[role="tab"]', route);
    const pick = (t, focus) => {
      for (const x of tabsR) {
        const on = x === t;
        x.setAttribute('aria-selected', String(on));
        x.tabIndex = on ? 0 : -1;
        document.getElementById(x.getAttribute('aria-controls')).hidden = !on;
      }
      if (focus) t.focus();
      save('mvl-site-route', t.id);
    };
    const saved = load('mvl-site-route', '');
    const first = tabsR.find((t) => t.id === saved);
    if (first) pick(first);
    route.addEventListener('click', (e) => { const t = e.target.closest('[role="tab"]'); if (t) pick(t); });
    route.addEventListener('keydown', (e) => {
      const i = tabsR.indexOf(document.activeElement);
      if (i < 0) return;
      let n = -1;
      if (e.key === 'ArrowRight') n = (i + 1) % tabsR.length;
      else if (e.key === 'ArrowLeft') n = (i - 1 + tabsR.length) % tabsR.length;
      else if (e.key === 'Home') n = 0;
      else if (e.key === 'End') n = tabsR.length - 1;
      if (n >= 0) { e.preventDefault(); pick(tabsR[n], true); }
    });
  }
  const useful = $('.useful');
  if (useful) {
    const paint = () => { for (const b of $$('[data-useful-answer]', useful)) b.setAttribute('aria-pressed', String(mine().useful === b.dataset.usefulAnswer)); };
    paint();
    useful.addEventListener('click', (e) => {
      const b = e.target.closest('[data-useful-answer]');
      if (!b) return;
      mine().useful = b.dataset.usefulAnswer;
      save(AKEY, astate);
      paint();
      toast(b.dataset.usefulAnswer === 'yes' ? 'Thanks. Your answer stays in this browser.' : 'Thanks. Search or the related articles may help; nothing was sent.');
    });
  }

  // ---------- language mode ----------
  if (window.MVLI18n) {
    window.MVLI18n.init();
    const langMount = $('#lang-mount');
    if (langMount) langMount.append(window.MVLI18n.control());
  }

  // ---------- personal vocabulary ----------
  if (window.MVLVocab) {
    window.MVLVocab.init();
    const mount = $('#vocab-mount');
    if (mount) mount.append(window.MVLVocab.control());
  }
})();
