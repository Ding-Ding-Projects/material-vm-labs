'use strict';
// lab machine manager renderer. Every action is a real call into the CLI through the main process;
// nothing here pretends to succeed. Long operations stream into the activity panel and can be cancelled.
(function () {
  const { esc, ring, makeSearch, toast } = window.MVL;
  const $ = (s, r = document) => r.querySelector(s);
  const api = window.mvl;

  const state = {
    settings: null, machines: null, metas: {}, receipts: [], media: null, hv: null, vbox: null,
    tab: 'machines', machineTabs: [], jobs: new Map(), filter: 'all', loadError: '', busy: new Set(), recovered: []
  };
  const SECTIONS = [['machines', 'Machines'], ['runner', 'Runners'], ['receipts', 'Receipts'], ['media', 'Media'], ['build', 'Build'], ['docs', 'Docs'], ['settings', 'Settings']];
  const ICONS = {
    machines: 'M3 21V9l9-6 9 6v12M7 21v-6h10v6', runner: 'M3 12h4l2-6 4 12 2-6h6', receipts: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
    media: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', build: 'M14 6l4 4-8 8H6v-4zM16 4l4 4',
    docs: 'M5 4h10l4 4v12H5zM14 4v5h5', settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 12h2M18 12h2M12 4v2M12 18v2', machine: 'M4 6h16v10H4zM9 20h6M12 16v4'
  };
  const icon = (d) => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"></path></svg>`;
  const OWNERS = { you: 'You', agent: 'Claude' };
  const WHO_NOTE = {
    you: 'Setup and the sign-in assist open at your first sign-in. You type your own password; nothing is stored by the tooling.',
    agent: 'No Setup and no sign-in at first logon. Tools and sharing are off unless you switch them on.'
  };
  const SIZES = [{ id: 's', label: '8 GB · 4', mem: 8192, cpus: 4 }, { id: 'm', label: '12 GB · 8', mem: 12288, cpus: 8 }, { id: 'l', label: '16 GB · 12', mem: 16384, cpus: 12 }];
  const NETS = [['nat', 'NAT'], ['bridged', 'Bridged'], ['hostonly', 'Host-only']];
  const NET_HELP = {
    nat: 'Private address behind your PC. Reaches the internet; only this PC reaches it.',
    bridged: 'Its own address on your LAN, like another PC on the network.',
    hostonly: 'Only this PC and other lab machines. No internet, so builds cannot fetch dependencies.'
  };
  const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
  const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9._-]{1,100}$/;

  let gh = null; // the self-hosted runner assist, created below once the helpers exist
  const panels = $('#panels');
  const mk = (id, cls) => { const d = document.createElement('section'); d.id = 'panel-' + id; d.className = 'page'; d.setAttribute('role', 'tabpanel'); d.hidden = true; if (cls) d.classList.add(cls); panels.append(d); return d; };
  const P = {};
  for (const [id] of SECTIONS) P[id] = mk(id);
  // Every section starts with the same page header: eyebrow, big heading, optional search, and the primary button.
  const heads = {};
  function pageHead(id, eyebrow, title, searchEl) {
    const h = document.createElement('div'); h.className = 'phead';
    h.innerHTML = `<div class="ttl"><span class="eyebrow"></span><h1></h1></div>${searchEl ? '<div class="srch"></div>' : ''}<button type="button" class="btn primary" data-create>Create machine</button>`;
    $('.eyebrow', h).textContent = eyebrow; $('h1', h).textContent = title;
    if (searchEl) $('.srch', h).append(searchEl);
    $('[data-create]', h).addEventListener('click', () => openCreate());
    P[id].prepend(h); heads[id] = $('h1', h);
    return h;
  }
  const setHead = (id, t) => { if (heads[id]) heads[id].textContent = t; };

  // ---------- helpers ----------
  const key = (n) => String(n).toLowerCase();
  const emptyText = (text) => (window.MVLFunny ? window.MVLFunny.html('empty', text) : esc(text));
  const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
  const fmtGB = (mb) => (mb ? Math.round(mb / 1024) + ' GB' : '');
  const when = (s) => { if (!s) return ''; const d = new Date(s); return isNaN(d) ? String(s) : d.toLocaleString([], { hour12: false, year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }); };
  const bytes = (n) => (n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(0) + ' MB' : (n || 0) + ' B');
  function receiptsFor(name) { return state.receipts.filter((r) => r.machine && key(r.machine.name) === key(name)); }
  function plan(m) {
    const meta = state.metas[key(m.Name)] || {};
    const power = m.Power, status = m.Status;
    const duty = Number(m.Runners) > 0;
    let pill = ['Idle', 'lime'], rg = ['var(--ok)', 1, 'OFF'];
    if (status && status !== 'ready') { pill = [String(status).replace(/^./, (c) => c.toUpperCase()), /fail|error/i.test(status) ? 'red' : 'cyan']; rg = [/fail|error/i.test(status) ? 'var(--bad)' : 'var(--busy)', /fail|error/i.test(status) ? 0.4 : 0.5, /fail|error/i.test(status) ? 'ERR' : '...']; }
    else if (power === 'running') { pill = ['Running', 'cyan']; rg = ['var(--busy)', 1, 'RUN']; }
    else if (power === 'unavailable' || power === 'unknown') { pill = ['Unavailable', 'amber']; rg = ['var(--warn)', 0.3, '?']; }
    if (duty) pill = ['Runner on duty', 'amber'];
    return { meta, pill, ring: rg, duty };
  }
  const ownerOf = (m) => (m && m.Owner === 'you' ? 'you' : 'agent'); // a machine from before owners existed was made by an agent
  const shareOf = (m) => (m && m.SharedFolder && typeof m.SharedFolder === 'object' && m.SharedFolder.hostPath ? m.SharedFolder : null);
  const chipsFor = (m) => `<span class="chip"><i class="${ownerOf(m) === 'you' ? 'on' : ''}"></i>${esc(OWNERS[ownerOf(m)])}</span><span class="chip"><i class="${shareOf(m) ? 'on' : ''}"></i>${shareOf(m) ? 'Shared folder' : 'no shared folder'}</span>`;
  function lastLine(m) {
    const r = receiptsFor(m.Name).find((x) => x.kind !== 'install');
    if (!r) return ['No fresh build yet', ''];
    return [`${(r.entrypoints[0] && r.entrypoints.length === 1 ? r.entrypoints[0].name : 'build') || 'build'} ${r.verdict}${r.hostMinutes != null ? ' · ' + r.hostMinutes + ' min' : ''}`, r.verdict === 'passed' ? 'v-lime' : 'v-red'];
  }

  async function cli(op, params, id, label) { return api.run(op, params || {}, id, label); }

  // ---------- activity panel ----------
  const actBox = $('#activity');
  // The running operations panel docks to the top or bottom of the content, or floats; it resizes from
  // its edges (arrow keys on a focused edge too), drags by its header when floating, and remembers both.
  const actPanel = $('#actPanel');
  const actDock = window.MVLPanels.dockable(actPanel, {
    id: 'manager-activity', label: 'running operations panel', header: $('.act-head', actPanel),
    defaults: { mode: 'top', size: 320, w: 560, h: 380 }, min: { w: 320, h: 160, size: 140 },
    bottomInset: () => (narrowView() ? 80 : 0),
    place: (mode) => { const stage = $('.stage'); if (mode === 'bottom') stage.append(actPanel); else if (actPanel.nextElementSibling !== panels) stage.insertBefore(actPanel, panels); }
  });
  function narrowView() { return window.matchMedia('(max-width: 720px)').matches; }
  $('.act-head', actPanel).addEventListener('click', (e) => { const b = e.target.closest('[data-pn-dock]'); if (b) actDock.dock(b.dataset.pnDock); });
  $('#actReset').addEventListener('click', () => { actDock.reset(); toast('The running operations panel is back at the top at its default size'); });
  const actSync = () => {
    const n = actBox.children.length, live = state.jobs.size;
    actPanel.hidden = n === 0;
    $('#actCount').textContent = n ? (live ? live + ' running' : 'none running') + (n - live > 0 ? ', ' + (n - live) + ' finished' : '') : '';
  };
  new MutationObserver(actSync).observe(actBox, { childList: true });
  let jobSeq = 0;
  function startJob(title, op, params, opts) {
    opts = opts || {};
    const id = 'j' + (++jobSeq) + '-' + Date.now().toString(36);
    const card = document.createElement('section');
    card.className = 'activity'; card.id = 'job-' + id;
    card.innerHTML = `<div class="row"><span class="chipst cyan" data-st>Running</span><strong class="grow" data-title></strong><span class="small mono" data-tm></span><button type="button" class="btn danger sm" data-cancel>Cancel</button><button type="button" class="btn sm" data-close hidden>Dismiss</button></div><div class="bar run"><i></i></div><pre class="log" tabindex="0" role="log" aria-live="off"></pre>`;
    $('[data-title]', card).textContent = title;
    actBox.append(card);
    const log = $('.log', card), st = $('[data-st]', card), bar = $('.bar', card), tm = $('[data-tm]', card);
    const t0 = Date.now();
    const timer = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); tm.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }, 500);
    state.jobs.set(id, { log, card, count: 0 });
    $('[data-cancel]', card).addEventListener('click', () => { api.cancel(id); st.textContent = 'Cancelling'; st.className = 'chipst amber'; });
    $('[data-close]', card).addEventListener('click', () => card.remove());
    const holdKey = opts.hold || null;
    if (holdKey) state.busy.add(holdKey);
    renderAll(true);
    return cli(op, params, id, title).then(async (r) => {
      clearInterval(timer);
      state.jobs.delete(id); actSync();
      if (holdKey) state.busy.delete(holdKey);
      $('[data-cancel]', card).hidden = true; $('[data-close]', card).hidden = false;
      const note = document.createElement('div');
      if (r.ok) { st.textContent = 'Done'; st.className = 'chipst lime'; bar.className = 'bar done'; note.textContent = '[gui] ' + (opts.okText || 'The CLI finished with exit code 0.'); }
      else if (r.cancelled) { st.textContent = 'Cancelled, incomplete'; st.className = 'chipst amber'; bar.className = 'bar fail'; note.className = 'err'; note.textContent = '[gui] ' + r.error; }
      else { st.textContent = 'Failed'; st.className = 'chipst red'; bar.className = 'bar fail'; note.className = 'err'; note.textContent = '[gui] ' + r.error; }
      log.append(note); log.scrollTop = log.scrollHeight;
      if (r.ok && opts.autoDismiss) setTimeout(() => card.remove(), 6000);
      // Installs (create, reset+create, installer tests, hypervisor install) get the full-screen takeover;
      // everything else lands in the notification centre. Real values only.
      const installLike = ['new', 'up', 'install', 'hv-install'].includes(op) || (op === 'hv' && params && params.install);
      const facts = { title, what: title, where: params && params.name ? 'Lab machine ' + params.name : 'This PC', command: r.command, code: r.code, ms: Date.now() - t0, lines: r.tail || [...log.querySelectorAll('div')].slice(-12).map((d) => d.textContent) };
      if (window.MVLNotify && !r.cancelled) {
        if (installLike && r.ok) window.MVLNotify.success(facts);
        else if (installLike) window.MVLNotify.failure(Object.assign(facts, { onRetry: () => startJob(title, op, params, opts), onOpenLog: () => { card.scrollIntoView({ block: 'center' }); log.focus(); } }));
        else window.MVLNotify.push({ kind: r.ok ? 'success' : 'error', title: title + (r.ok ? ' finished' : ' failed'), body: r.ok ? (r.command || '') : r.error });
      }
      await refreshMachines();
      if (opts.after) opts.after(r);
      return r;
    });
  }
  api.onLine((p) => {
    const j = state.jobs.get(p.id); if (!j) return;
    const div = document.createElement('div'); if (p.stream === 'err') div.className = 'err'; div.textContent = p.text;
    const stick = j.log.scrollTop + j.log.clientHeight >= j.log.scrollHeight - 30;
    j.log.append(div); if (++j.count > 3000) { j.log.firstChild.remove(); j.count--; }
    if (stick) j.log.scrollTop = j.log.scrollHeight;
  });

  // Destructive actions use the two-key super confirmation when it is loaded, else the plain sheet.
  function superConfirm(o) { return window.MVLSuperConfirm ? window.MVLSuperConfirm.ask(Object.assign({ anchor: document.activeElement }, o)) : confirmSheet({ title: o.action + '?', body: o.affected, label: o.action, danger: true }); }

  // ---------- sheets ----------
  function openSheet(html, onMount, onClose) {
    const scrim = document.createElement('div'); scrim.className = 'scrim';
    scrim.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
    const prev = document.activeElement;
    let closed = false;
    let size = null;
    const close = () => { if (closed) return; closed = true; if (size) size.dispose(); scrim.remove(); if (prev && prev.focus) prev.focus(); if (onClose) onClose(); };
    scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) close(); });
    scrim.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
      if (e.key === 'Tab') { const f = [...scrim.querySelectorAll('button,input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent !== null); if (!f.length) return; const first = f[0], last = f[f.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
    });
    document.body.append(scrim);
    // sheets resize from their right edge (drag, or arrow keys on the focused edge); double-click resets
    size = window.MVLPanels.sizable(scrim.firstElementChild, { id: 'manager-sheet', edge: 'e', centered: true, min: 360, label: 'Resize the sheet' });
    const first = scrim.querySelector('input,button'); if (first) first.focus();
    onMount(scrim.firstElementChild, close);
    return close;
  }
  function confirmSheet({ title, body, label, danger, typeName }) {
    return new Promise((resolve) => {
      openSheet(`<h2>${esc(title)}</h2><p class="muted" style="margin:0">${esc(body)}</p>${typeName ? `<label class="field">Type <b class="mono">${esc(typeName)}</b> to confirm<input data-t class="mono" autocomplete="off" spellcheck="false"></label>` : ''}<div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-no>Keep it</button><button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-yes ${typeName ? 'disabled' : ''}>${esc(label)}</button></div>`, (el, cl) => {
        const yes = $('[data-yes]', el);
        const t = $('[data-t]', el);
        if (t) t.addEventListener('input', () => { yes.disabled = t.value !== typeName; });
        yes.addEventListener('click', () => { resolve(true); cl(); });
        $('[data-no]', el).addEventListener('click', () => cl());
      }, () => resolve(false));
    });
  }

  // ---------- tabs ----------
  // Every page starts open in page order. A page the user closed stays closed (across restarts and
  // updates) until the New tab catalog or "Open every tab" reopens it; a page added by an update
  // opens once. Machine tabs are one per machine and are remembered too.
  const tabsEl = $('#tabs');
  const tabStore = window.MVLTabs.store('manager', SECTIONS.map(([id]) => id));
  state.machineTabs = tabStore.extra();
  const savedActive = tabStore.active();
  state.tab = savedActive && (savedActive.startsWith('m:') ? state.machineTabs.some((n) => 'm:' + n === savedActive) : tabStore.isOpen(savedActive)) ? savedActive : (tabStore.openPages()[0] || '');
  const noTabs = mk('none');
  noTabs.innerHTML = '<div class="empty tabs-empty"><h2>Every tab is closed</h2><p>' + emptyText('Open a page from the New tab catalog, or open every tab again in page order.') + '</p><div class="row"><button type="button" class="btn primary" data-none-all>Open every tab</button><button type="button" class="btn" data-none-new>New tab</button></div></div>';
  noTabs.addEventListener('click', (e) => { if (e.target.closest('[data-none-all]')) openEveryTab(); if (e.target.closest('[data-none-new]')) openCatalog(); });
  const label = (id) => (SECTIONS.find((x) => x[0] === id) || [id, id])[1];
  function tabItems() {
    return [...tabStore.openPages().map((id) => ({ id, label: label(id), ic: ICONS[id] })), ...state.machineTabs.map((n) => ({ id: 'm:' + n, label: n.toUpperCase(), ic: ICONS.machine }))];
  }
  const narrow = window.matchMedia('(max-width: 720px)');
  function renderTabs() {
    const items = tabItems();
    if (!items.some((t) => t.id === state.tab)) state.tab = items.length ? items[0].id : '';
    tabsEl.setAttribute('aria-orientation', narrow.matches ? 'horizontal' : 'vertical');
    tabsEl.innerHTML = items.map((t) => `<button type="button" class="tab" role="tab" id="tab-${esc(t.id)}" data-tab="${esc(t.id)}" aria-controls="panel-${esc(t.id.startsWith('m:') ? 'm-' + key(t.id.slice(2)) : t.id)}" title="${esc(t.label)}" aria-selected="${state.tab === t.id}" ${state.tab === t.id ? 'aria-current="page"' : ''} tabindex="${state.tab === t.id ? 0 : -1}">${icon(t.ic)}<span class="lbl">${esc(t.label)}</span><span class="x" data-close-tab="${esc(t.id)}" role="button" aria-label="Close the ${esc(t.label)} tab" title="Close tab (Delete)" tabindex="-1">&times;</span></button>`).join('');
    for (const p of Object.values(P)) p.hidden = true;
    const active = !state.tab ? noTabs : state.tab.startsWith('m:') ? machinePanel(state.tab.slice(2)) : P[state.tab];
    if (active) { active.hidden = false; active.setAttribute('aria-labelledby', 'tab-' + state.tab); }
    for (const el of panels.querySelectorAll('[role=tabpanel]')) if (el !== active) el.hidden = true;
    noTabs.hidden = active !== noTabs;
    tabStore.setActive(state.tab);
  }
  narrow.addEventListener('change', renderTabs);
  tabsEl.addEventListener('click', (e) => {
    const x = e.target.closest('[data-close-tab]');
    if (x) { e.stopPropagation(); closeTab(x.dataset.closeTab); return; }
    const t = e.target.closest('[data-tab]');
    if (t) selectTab(t.dataset.tab);
  });
  tabsEl.addEventListener('keydown', (e) => {
    const t = e.target.closest('[data-tab]'); if (!t) return;
    if (e.key === 'Delete') { e.preventDefault(); closeTab(t.dataset.tab, true); return; }
    const tabs = [...tabsEl.querySelectorAll('[data-tab]')]; const i = tabs.indexOf(t);
    // A vertical strip moves with Up and Down (Left and Right also work); the phone-width bottom bar is horizontal.
    const step = (narrow.matches ? { ArrowRight: 1, ArrowLeft: -1 } : { ArrowDown: 1, ArrowUp: -1, ArrowRight: 1, ArrowLeft: -1 })[e.key];
    let n = null;
    if (step) n = tabs[(i + step + tabs.length) % tabs.length];
    else if (e.key === 'Home') n = tabs[0]; else if (e.key === 'End') n = tabs[tabs.length - 1];
    if (!n) return;
    e.preventDefault(); selectTab(n.dataset.tab); const f = $('#tab-' + CSS.escape(n.dataset.tab)); if (f) f.focus();
  });
  function selectTab(id) {
    if (!id) return;
    if (!id.startsWith('m:') && !tabStore.isOpen(id)) tabStore.open(id); // an explicit visit reopens a closed page
    state.tab = id; renderTabs();
    const t = $('#tab-' + CSS.escape(id)); if (t && t.scrollIntoView) t.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    if (id === 'receipts') refreshReceipts(); if (id === 'media') refreshMedia();
    if (id === 'runner' && gh) gh.show();
  }
  function closeTab(id, keepFocus) {
    const items = tabItems(); const i = items.findIndex((t) => t.id === id);
    if (state.tab === id) { const n = items[i + 1] || items[i - 1]; state.tab = n ? n.id : ''; }
    if (id.startsWith('m:')) { closeMachineTab(id.slice(2)); } else { tabStore.close(id); renderTabs(); }
    if (state.tab === 'receipts') refreshReceipts(); if (state.tab === 'media') refreshMedia(); if (state.tab === 'runner' && gh) gh.show();
    const f = state.tab ? $('#tab-' + CSS.escape(state.tab)) : $('#tabNew');
    if (keepFocus && f) f.focus();
  }
  function openEveryTab() {
    tabStore.openAll();
    if (!state.tab) state.tab = tabStore.openPages()[0];
    renderTabs(); toast('Every tab is open again, in page order');
  }
  function openCatalog() {
    window.MVLTabs.catalog({
      title: 'New tab',
      items: () => [
        ...SECTIONS.map(([id, l]) => ({ id, label: l, group: 'Pages', icon: icon(ICONS[id]), closed: !tabStore.isOpen(id), state: tabStore.isOpen(id) ? 'Open' : 'Closed' })),
        ...(state.machines || []).map((m) => { const open = state.machineTabs.some((n) => key(n) === key(m.Name)); return { id: 'm:' + m.Name, label: m.Name, group: 'Machines', icon: icon(ICONS.machine), state: open ? 'Open' : 'No tab' }; })
      ],
      onPick: (id) => { if (id.startsWith('m:')) openMachine(id.slice(2)); else selectTab(id); const t = $('#tab-' + CSS.escape(id)); if (t) t.focus(); },
      onOpenAll: openEveryTab
    });
  }
  $('#tabNew').addEventListener('click', openCatalog);
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === 't' || e.key === 'T') && !document.querySelector('.scrim, .onb')) { e.preventDefault(); openCatalog(); }
  });
  if (window.MVLContext) window.MVLContext.register('#tabs [role="tab"], #tabNew', (el) => {
    const items = [];
    const id = el.dataset && el.dataset.tab;
    if (id) items.push({ label: 'Close tab', shortcut: 'Delete', run: () => closeTab(id, true) });
    items.push({ label: 'New tab...', shortcut: 'Ctrl+T', run: openCatalog });
    if (tabStore.closedPages().length) items.push({ label: 'Open every tab', run: openEveryTab });
    return items;
  });
  if (window.MVLPalette) {
    window.MVLPalette.register({ title: 'New tab', hint: 'Every page and machine, searchable', keywords: ['catalog', 'tab', 'open'], run: () => setTimeout(openCatalog) });
    window.MVLPalette.register({ title: 'Open every tab', hint: 'Reopen closed tabs in page order', keywords: ['tabs', 'reopen'], run: openEveryTab });
  }
  function openMachine(name) {
    if (!state.machineTabs.some((n) => key(n) === key(name))) { state.machineTabs.push(name); tabStore.setExtra(state.machineTabs); }
    const n = state.machineTabs.find((x) => key(x) === key(name));
    selectTab('m:' + n);
  }
  function closeMachineTab(name) {
    state.machineTabs = state.machineTabs.filter((n) => key(n) !== key(name));
    tabStore.setExtra(state.machineTabs);
    const el = $('#panel-m-' + CSS.escape(key(name))); if (el) el.remove();
    delete machineUI[key(name)];
    if (state.tab === 'm:' + name) { const items = tabItems(); state.tab = items.length ? items[0].id : ''; }
    renderTabs();
  }

  // ---------- Machines ----------
  const machineSearch = makeSearch({ placeholder: 'Search machines', label: 'Search machines', onChange: () => renderMachines() });
  P.machines.innerHTML = '<div id="gRecov"></div><div class="row" id="gFilter"></div><div class="stats" id="gStats"></div><div id="gError"></div><div class="mcards" id="gCards"></div>';
  pageHead('machines', 'Machines', 'Loading machines', machineSearch.el);
  $('#gFilter', P.machines).innerHTML = '<div class="seg sm" role="group" aria-label="Filter machines">' + [['all', 'All'], ['running', 'Running'], ['runner', 'Runners']].map(([id, l]) => `<button type="button" data-f="${id}" aria-pressed="${id === 'all'}">${l}</button>`).join('') + '</div>';
  $('#gFilter', P.machines).addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (!b) return; state.filter = b.dataset.f; for (const x of $('#gFilter', P.machines).querySelectorAll('[data-f]')) x.setAttribute('aria-pressed', String(x === b)); renderMachines(); });
  // The filter row and the statistics strip collapse behind labelled toggles. Statistics only describe
  // the list, so they start collapsed; the filter row changes it, so it starts open. Collapsed, each
  // still says what it holds, and the filter summary always names an active filter.
  const FILTER_NAMES = { all: 'All machines', running: 'Running only', runner: 'Runners only' };
  const searchNote = (s) => (s.active() ? ` and search "${s.term()}"` : '');
  const filterBox = window.MVLPanels.collapsible({
    id: 'machines-filter', label: 'Filters', content: (() => { const g = $('#gFilter', P.machines); const ph = document.createElement('div'); g.replaceWith(ph); ph.id = 'gFilterSlot'; return g; })(),
    summary: () => (state.filter === 'all' ? 'No filter on: all machines shown' : 'Filter on: ' + FILTER_NAMES[state.filter]) + searchNote(machineSearch)
  });
  $('#gFilterSlot', P.machines).replaceWith(filterBox.el);
  const statsSlot = $('#gStats', P.machines); const statsPh = document.createElement('div'); statsSlot.replaceWith(statsPh);
  const statsBox = window.MVLPanels.collapsible({
    id: 'machines-stats', label: 'Statistics', content: statsSlot, startCollapsed: true,
    summary: () => { const ms = state.machines || []; const run = ms.filter((m) => m.Power === 'running').length; const duty = ms.reduce((a, m) => a + (Number(m.Runners) || 0), 0); return state.machines === null ? 'Loading' : `${ms.length} machine${ms.length === 1 ? '' : 's'}, ${run} running, ${duty} runner${duty === 1 ? '' : 's'} on duty`; }
  });
  statsPh.replaceWith(statsBox.el);
  // A header search that can collapse; collapsed, it says whether a search is still narrowing the list.
  function collapsibleSearch(id, search) {
    const c = window.MVLPanels.collapsible({ id, label: 'Search', content: search.el, summary: () => (search.active() ? `Search on: "${search.term()}"` : 'No search on') });
    search.input.addEventListener('input', () => c.refresh());
    return c;
  }

  function machineText(m) { const p = plan(m); return [m.Name, m.Project, m.Hypervisor, m.Status, m.Power, m.Network, m.IP, m.User, p.pill[0], p.meta.hypervisorVersion].join(' '); }
  // Machine summary in the navigation rail: one cell per machine, running, idle, or on runner duty.
  function updateGauge() {
    const g = $('#gauge'), ms = state.machines;
    if (ms === null) { g.innerHTML = '<i></i><i></i><i></i><i></i><i></i><i></i>'; g.setAttribute('aria-label', 'Machines: loading'); return; }
    const kind = (m) => (Number(m.Runners) > 0 ? 'duty' : m.Power === 'running' ? 'run' : 'idle');
    const order = { run: 0, idle: 1, duty: 2 };
    const ks = ms.map(kind).sort((a, b) => order[a] - order[b]).slice(0, 12);
    const cells = ks.concat(Array(Math.max(0, 6 - ks.length)).fill(''));
    g.innerHTML = cells.map((c) => `<i class="${c}"></i>`).join('');
    const n = (k) => ms.filter((m) => kind(m) === k).length;
    g.setAttribute('aria-label', ms.length ? `Machines: ${n('run')} running, ${n('idle')} idle, ${n('duty')} hosting a runner` : 'Machines: none yet');
  }
  function renderRecovered() {
    const box = $('#gRecov', P.machines), list = state.recovered;
    if (!list.length) { box.innerHTML = ''; return; }
    const now = Date.now();
    const mins = (iso) => { const t = Date.parse(iso); return isNaN(t) ? '' : Math.max(0, Math.round((now - t) / 60000)) + ' min in'; };
    box.innerHTML = `<div class="recov" role="status"><div class="rhead">${icon('M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5')}<strong>Recovered after the manager closed unexpectedly</strong></div><ul>${list.map((r) => {
      const msg = r.alive ? `still running (pid ${r.pid}${mins(r.startedUtc) ? ', ' + mins(r.startedUtc) : ''}); its receipt appears in Receipts when it finishes. The manager cannot reattach to its live output.`
        : r.wasAlive ? 'has ended since the manager reopened. If it finished, its receipt is in Receipts.'
        : 'stopped while the manager was closed: recorded as incomplete.';
      return `<li><span class="what"><b>${esc(r.label)}</b>${r.name ? ' on ' + esc(r.name.toUpperCase()) : ''}: ${esc(msg)}</span><button type="button" class="btn sm" data-recov-receipts>Open Receipts</button><button type="button" class="btn sm" data-recov-dismiss="${r.pid}">Dismiss</button></li>`;
    }).join('')}</ul></div>`;
  }
  $('#gRecov', P.machines).addEventListener('click', async (e) => {
    const d = e.target.closest('[data-recov-dismiss]');
    if (d) { const pid = Number(d.dataset.recovDismiss); await api.dismissRecovered(pid); state.recovered = state.recovered.filter((r) => r.pid !== pid); renderRecovered(); return; }
    if (e.target.closest('[data-recov-receipts]')) selectTab('receipts');
  });
  async function loadRecovered(first) {
    let found = []; try { found = await api.recovered(); } catch { return; }
    const prev = new Map(state.recovered.map((r) => [r.pid, r]));
    const next = found.map((r) => { const o = prev.get(r.pid); return { ...r, wasAlive: first ? r.alive : !!(o && (o.alive || o.wasAlive)) }; });
    // a dismissed entry is gone from disk, so only entries still on disk remain; ones that ended keep their marker until dismissed
    if (JSON.stringify(next) !== JSON.stringify(state.recovered)) { state.recovered = next; renderRecovered(); }
  }
  function renderMachines() {
    const ms = state.machines;
    updateGauge(); renderRecovered(); filterBox.refresh(); statsBox.refresh();
    if (ms === null) setHead('machines', 'Loading machines');
    else { const run = ms.filter((m) => m.Power === 'running').length; setHead('machines', !ms.length ? 'No machines yet' : `${ms.length - run} idle${run ? `, ${run} running` : ''}`); }
    const stats = $('#gStats', P.machines), cards = $('#gCards', P.machines), err = $('#gError', P.machines);
    err.innerHTML = state.loadError ? `<div class="errbox" role="alert">${esc(state.loadError)}</div>` : '';
    if (ms === null) { stats.innerHTML = ''; cards.innerHTML = '<div class="empty"><h2>Loading machines</h2><p>' + emptyText('Asking the CLI for every lab machine...') + '</p></div>'; return; }
    const running = ms.filter((m) => m.Power === 'running').length;
    const duty = ms.reduce((a, m) => a + (Number(m.Runners) || 0), 0);
    const last = state.receipts.find((x) => x.kind !== 'install' && x.verdict);
    const S = [['Idle', String(ms.length - running), 'var(--ink)'], ['Running', String(running), 'var(--cyan)'], ['Runners on duty', String(duty), 'var(--amber)'], ['Last fresh build', last ? last.verdict : 'none yet', last ? (last.verdict === 'passed' ? 'var(--lime-text)' : 'var(--red)') : 'var(--mute)']];
    stats.innerHTML = S.map(([k, v, c]) => `<div class="stat"><span class="k">${esc(k)}</span><span class="v" style="color:${c}">${esc(v)}</span></div>`).join('');
    let list = ms.filter((m) => state.filter === 'all' || (state.filter === 'running' && m.Power === 'running') || (state.filter === 'runner' && Number(m.Runners) > 0));
    if (machineSearch.invalid()) { cards.innerHTML = '<div class="errbox">That regex pattern is not valid, so nothing was filtered.</div>'; return; }
    if (machineSearch.active()) list = list.filter((m) => machineSearch.test(machineText(m)));
    if (machineSearch.active()) machineSearch.setStatus(list.length + ' of ' + ms.length + ' machines');
    if (!ms.length) { cards.innerHTML = '<div class="empty"><h2>No machines yet</h2><p>' + emptyText('Create a fresh Windows 11 machine. It installs unattended from official media and takes about 13 minutes.') + '</p><p><button type="button" class="btn primary" data-act="create">+ Create your first machine</button></p></div>'; return; }
    if (!list.length) { cards.innerHTML = '<div class="empty"><h2>No machine matches</h2><p>' + emptyText('Try fewer words, or switch search mode.') + '</p></div>'; return; }
    cards.innerHTML = list.map((m) => {
      const p = plan(m), meta = p.meta, busy = state.busy.has(key(m.Name)); const [ll, lc] = lastLine(m);
      const spec = [meta.memoryMB ? fmtGB(meta.memoryMB) : '', meta.cpus ? meta.cpus + ' vCPU' : '', (m.Network || '').toUpperCase()].filter(Boolean).join(' · ');
      const hv = [isLinux(m) ? (meta.osLabel || m.OS) : '', m.Hypervisor === 'vmware' ? 'VMware' : m.Hypervisor === 'virtualbox' ? 'VirtualBox' : m.Hypervisor, meta.hypervisorVersion ? String(meta.hypervisorVersion).split(' ')[0] : '', meta.secureBoot ? 'Secure Boot' : ''].filter(Boolean).join(' · ');
      const ready = m.Status === 'ready'; const on = m.Power === 'running';
      return `<article class="mcard" aria-label="${esc(m.Name)}"><div class="row" style="flex-wrap:nowrap"><span class="mname">${esc(m.Name)}</span><span class="small grow" style="min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(m.Project || '')}">${esc(m.Project || '')}</span><span class="pill ${p.pill[1]}">${esc(p.pill[0])}</span></div>
<div class="row" style="gap:18px;flex-wrap:nowrap">${ring(92, p.ring[1], p.ring[0], p.ring[2])}<div class="facts"><span>${esc(hv)}</span><span>${esc(spec)}</span>${m.IP ? `<span class="mono" style="color:var(--ink)">${esc(m.IP)}</span>` : ''}<span class="${lc}">${esc(ll)}</span></div></div>
<div class="chips" aria-label="Owner and shared folder">${chipsFor(m)}</div>
<div class="row" style="gap:8px"><button type="button" class="btn light" data-act="open" data-n="${esc(m.Name)}">Open</button><button type="button" class="btn" data-act="power" data-n="${esc(m.Name)}" ${!ready || busy ? 'disabled' : ''}>${on ? 'Stop' : 'Start'}</button><button type="button" class="btn" data-act="reset" data-n="${esc(m.Name)}" ${!ready || busy ? 'disabled' : ''}>Reset</button>${shareOf(m) ? `<button type="button" class="btn" data-act="share" data-n="${esc(m.Name)}">Shared folder</button>` : ''}${isLinux(m) ? '' : `<button type="button" class="btn go" data-act="fresh" data-n="${esc(m.Name)}">Fresh build</button>`}${on && m.IP ? `<button type="button" class="btn primary sm" data-act="rdp" data-n="${esc(m.Name)}">${isLinux(m) ? 'SSH' : 'Remote Desktop'}</button>` : ''}</div></article>`;
    }).join('');
  }
  P.machines.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const n = b.dataset.n;
    if (b.dataset.act === 'create') return openCreate();
    if (b.dataset.act === 'open') return openMachine(n);
    if (b.dataset.act === 'fresh') { openMachine(n); const el = machineUI[key(n)]; if (el) el.repo.focus(); return; }
    return machineAction(b.dataset.act, n);
  });

  function isLinux(m) { return !!(m && m.OS && m.OS !== 'windows'); }
  async function machineAction(act, name) {
    const m = (state.machines || []).find((x) => key(x.Name) === key(name)); if (!m) return;
    if (act === 'power') {
      if (m.Power === 'running') { if (!(await confirmSheet({ title: `Stop ${name}?`, body: 'The guest is asked to shut down; after 5 minutes it is powered off. Anything not saved inside it is lost.', label: 'Stop' }))) return; return startJob(`Stop ${name}`, 'stop', { name }, { hold: key(name) }); }
      return startJob(`Start ${name}`, 'start', { name }, { hold: key(name) });
    }
    if (act === 'reset') {
      if (!(await superConfirm({ action: `Reset ${name} to its clean baseline`, affected: `Everything done inside ${name} since the clean baseline is discarded: files, installed programs and settings in the guest. This cannot be undone.` }))) return;
      return startJob(`Reset ${name}`, 'reset', { name }, { hold: key(name) });
    }
    if (act === 'share') {
      const r = await api.openShare(name);
      if (r.ok) toast('Opened the shared folder for ' + name); else toast('Shared folder: ' + r.error, 'error');
      return;
    }
    if (act === 'rdp' && isLinux(m)) {
      const r = await cli('ssh', { name });
      if (r.ok) toast('SSH is opening for ' + name); else toast('SSH: ' + r.error, 'error');
      return;
    }
    if (act === 'rdp') {
      const r = await cli('rdp', { name });
      if (r.ok) toast('Remote Desktop is opening for ' + name); else toast('Remote Desktop: ' + r.error, 'error');
    }
  }

  // ---------- Create a machine ----------
  function openCreate(preset, onStarted) {
    const hvUse = state.hv && state.hv.ok ? state.hv.data : null;
    const vboxOk = !!(state.vbox && state.vbox.ok);
    const form = { hv: 'auto', size: 'm', net: (state.settings && state.settings.defaultNet) || 'nat', who: 'you', tools: true, share: true, os: 'windows' };
    if (preset && preset.who === 'agent') { form.who = 'agent'; form.tools = false; form.share = false; }
    if (preset && preset.os === 'windows') form.os = 'windows';
    openSheet(`<h2>Create a machine</h2>
<div class="row"><label class="field grow">Name<input data-f="name" class="mono" value="proof-1" autocomplete="off" spellcheck="false"><span class="small" data-hint-name></span></label><label class="field grow">Project<input data-f="project" value="general" autocomplete="off"></label></div>
<fieldset class="who"><legend>System</legend><div class="seg" role="group" aria-label="System"><button type="button" data-os="windows" aria-pressed="true">Windows 11</button><button type="button" data-os="ubuntu" aria-pressed="false">Ubuntu 24.04</button><button type="button" data-os="debian" aria-pressed="false">Debian 13</button></div><span class="small" data-osnote></span></fieldset>
<fieldset class="who"><legend>Who uses it</legend><div class="seg" role="group" aria-label="Who uses it"><button type="button" data-who="you" aria-pressed="true">You</button><button type="button" data-who="agent" aria-pressed="false">Claude</button></div><span class="small" data-whonote></span></fieldset>
<div class="chips" style="flex-direction:column;align-items:stretch"><button type="button" class="sw" role="switch" data-sw="tools" aria-checked="true" data-winonly><span class="trk"><span class="knob"></span></span><span>Preinstall tools and Codex (Git, Chocolatey, GitHub CLI, Codex desktop and CLI)</span></button><button type="button" class="sw" role="switch" data-sw="share" aria-checked="true"><span class="trk"><span class="knob"></span></span><span>Share a folder with this PC and open it here</span></button></div>
<div data-winonly><div class="eyebrow" style="margin-bottom:6px">Hypervisor</div><div class="seg" role="group" aria-label="Hypervisor"><button type="button" data-hv="auto" aria-pressed="true">Auto</button><button type="button" data-hv="vmware" aria-pressed="false">VMware</button><button type="button" data-hv="virtualbox" aria-pressed="false" ${vboxOk ? '' : 'disabled'} title="${esc(vboxOk ? '' : (state.vbox && state.vbox.error) || 'VirtualBox is not usable here')}">VirtualBox</button></div>${vboxOk ? '' : `<p class="small" style="margin:6px 0 0">VirtualBox is unavailable: ${esc((state.vbox && state.vbox.error) || 'not usable here')}</p>`}</div>
<div><div class="eyebrow" style="margin-bottom:6px">Size</div><div class="seg" role="group" aria-label="Size">${SIZES.map((s) => `<button type="button" data-size="${s.id}" aria-pressed="${s.id === 'm'}">${s.label}</button>`).join('')}</div></div>
<div><div class="eyebrow" style="margin-bottom:6px">Network</div><div class="seg" role="group" aria-label="Network">${NETS.map(([id, l]) => `<button type="button" data-net="${id}" aria-pressed="${id === form.net}">${l}</button>`).join('')}</div><p class="small" style="margin:6px 0 0" data-nethelp></p></div>
<div class="warn" data-lanwarn hidden>On your LAN with the default password: anyone on the LAN can sign in to this guest. Choose a password below, or stay on NAT.</div>
<div class="row"><label class="field grow">Guest user<input data-f="user" class="mono" value="mvlbuilder" autocomplete="off"></label><label class="field grow">Guest password (optional)<input data-f="pw" type="password" autocomplete="new-password" placeholder="empty = default password"></label></div>
<label class="row" style="gap:8px"><input type="checkbox" data-f="rand"> Make a random password (saved encrypted for this PC)</label>
<label class="row" style="gap:8px" data-winonly><input type="checkbox" data-f="tpm"> Require a TPM</label>
<div class="errbox" data-err hidden></div>
<div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-no>Cancel</button><button type="button" class="btn primary" data-go>Create</button></div>`, (el, close) => {
      const f = (n) => $(`[data-f="${n}"]`, el);
      const sync = () => {
        for (const b of el.querySelectorAll('[data-hv]')) b.setAttribute('aria-pressed', String(b.dataset.hv === form.hv));
        for (const b of el.querySelectorAll('[data-size]')) b.setAttribute('aria-pressed', String(b.dataset.size === form.size));
        for (const b of el.querySelectorAll('[data-net]')) b.setAttribute('aria-pressed', String(b.dataset.net === form.net));
        for (const b of el.querySelectorAll('[data-who]')) b.setAttribute('aria-pressed', String(b.dataset.who === form.who));
        for (const b of el.querySelectorAll('[data-os]')) b.setAttribute('aria-pressed', String(b.dataset.os === form.os));
        const linux = form.os !== 'windows';
        for (const w of el.querySelectorAll('[data-winonly]')) w.hidden = linux;
        $('[data-osnote]', el).textContent = linux ? 'Official cloud image with Docker and the Codex CLI, ready in a few minutes. VMware only; open it with mvl ssh.' : 'Unattended Windows 11 Enterprise Evaluation, about 13 minutes.';
        $('[data-go]', el).textContent = linux ? 'Create · a few minutes' : 'Create · about 13 min';
        for (const b of el.querySelectorAll('[data-sw]')) b.setAttribute('aria-checked', String(!!form[b.dataset.sw]));
        $('[data-whonote]', el).textContent = WHO_NOTE[form.who];
        $('[data-nethelp]', el).textContent = NET_HELP[form.net];
        const def = !f('pw').value && !f('rand').checked;
        $('[data-lanwarn]', el).hidden = !(form.net === 'bridged' && def);
        const ok = NAME_RE.test(f('name').value); $('[data-hint-name]', el).textContent = ok ? '' : 'Letters, digits, dash and underscore; up to 40.';
        if (state.machines && state.machines.some((x) => key(x.Name) === key(f('name').value))) $('[data-hint-name]', el).textContent = 'A machine with this name already exists.';
      };
      el.addEventListener('click', (e) => {
        const t = e.target.closest('button'); if (!t) return;
        if (t.dataset.os) { form.os = t.dataset.os; if (form.os !== 'windows') { form.hv = 'vmware'; if (/^mvlbuilder$/.test(f('user').value) === false) f('user').value = f('user').value.toLowerCase(); } sync(); return; }
        if (t.dataset.who) { form.who = t.dataset.who; form.tools = form.who === 'you'; form.share = form.who === 'you'; sync(); return; }
        if (t.dataset.sw) { form[t.dataset.sw] = !form[t.dataset.sw]; sync(); return; }
        if (t.dataset.hv && !t.disabled) form.hv = t.dataset.hv; if (t.dataset.size) form.size = t.dataset.size; if (t.dataset.net) form.net = t.dataset.net; sync();
      });
      el.addEventListener('input', sync);
      $('[data-no]', el).addEventListener('click', close);
      $('[data-go]', el).addEventListener('click', () => {
        const name = f('name').value.trim(); const err = $('[data-err]', el);
        const bad = !NAME_RE.test(name) ? 'The name needs letters, digits, dash or underscore.' : (state.machines || []).some((x) => key(x.Name) === key(name)) ? 'A machine with this name already exists.' : '';
        if (bad) { err.hidden = false; err.textContent = bad; return; }
        const size = SIZES.find((s) => s.id === form.size);
        const pw = f('pw').value;
        const params = { name, project: f('project').value.trim() || 'general', hv: form.hv, mem: size.mem, cpus: size.cpus, net: form.net, user: f('user').value.trim() || 'mvlbuilder', for: form.who, os: form.os, tools: form.os === 'windows' ? form.tools : undefined, share: form.share, requireTpm: form.os === 'windows' && f('tpm').checked, randomPassword: f('rand').checked, secret: f('rand').checked ? '' : pw };
        f('pw').value = ''; close();
        const job = startJob(`Create ${name} (unattended install, about 13 minutes)`, 'new', params, { okText: 'The lab machine is ready at a clean baseline.' });
        if (onStarted) onStarted(name, job);
        params.secret = '';
      });
      sync(); void hvUse;
    });
  }

  // ---------- Machine detail ----------
  const machineUI = {};
  function machinePanel(name) {
    const id = 'm-' + key(name);
    let el = $('#panel-' + CSS.escape(id));
    if (!el) { el = document.createElement('section'); el.id = 'panel-' + id; el.className = 'page'; el.setAttribute('role', 'tabpanel'); panels.append(el); buildMachine(el, name); }
    return el;
  }
  function buildMachine(el, name) {
    el.innerHTML = `<div class="row" style="gap:14px"><button type="button" class="iconbtn" data-back aria-label="Back to Machines"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 6l-6 6 6 6"></path></svg></button><span class="mname" style="font-size:18px;padding:8px 14px" data-mname></span><span class="pill" data-pill></span><span class="chips" data-chips></span><span class="grow"></span>
<button type="button" class="btn" data-d="power">Start</button><button type="button" class="btn" data-d="share" hidden>Shared folder</button><button type="button" class="btn" data-d="reset">Reset to baseline</button><button type="button" class="btn" data-d="shot">screenshot</button><button type="button" class="btn danger" data-d="scrap">Scrap</button></div>
<div class="cols">
<section class="card" aria-label="Connect"><span class="eyebrow">Connect</span><div class="row" style="align-items:baseline;gap:12px"><span class="ipbig" data-ip>no address</span><button type="button" class="btn sm" data-d="copy" aria-label="Copy the IP address">Copy</button><button type="button" class="btn sm" data-d="ip">Refresh</button></div>
<div class="row"><button type="button" class="btn big" data-d="rdp">Remote Desktop</button><span class="small" data-rdphint style="max-width:260px"></span></div>
<div class="inset"><span class="small">Guest sign-in</span><div class="row"><span class="mono" data-user></span><span class="mono muted">&bull;&bull;&bull;&bull;</span><span class="pill amber" data-defpw hidden>default password</span></div><span class="small">The password is stored encrypted for this PC and is never shown here.</span><div class="row"><label class="field grow">New guest password<input data-f="newpw" type="password" autocomplete="new-password" placeholder="at least 4 characters"></label><button type="button" class="btn" data-d="passwd">Change password</button></div><div class="errbox" data-pwerr hidden></div><span class="small">Changing it resets to the clean baseline, sets the password and retakes the baseline with it.</span></div></section>
<section class="card" aria-label="Network"><span class="eyebrow">Network</span><div class="seg" role="group" aria-label="Network mode">${NETS.map(([n, l]) => `<button type="button" data-net="${n}" aria-pressed="false">${l}</button>`).join('')}</div><p class="muted" style="margin:0;font-size:14px;line-height:21px" data-nethelp></p><div class="warn" data-lanwarn hidden>On your LAN with the default password: anyone on the LAN can sign in to this guest. Change the password, or stay on NAT.</div><div class="warn" data-fallback hidden></div><div class="note">Fallback: a bridged machine with no address after 3 minutes switches itself to NAT, and the machine list says so. The mode can only change while the machine is off.</div></section>
<section class="card" aria-label="Fresh builds"><span class="eyebrow">Fresh builds</span>
<label class="field">repository<input data-f="repo" class="mono" placeholder="owner/name" autocomplete="off" spellcheck="false"></label>
<div class="row"><label class="field grow">Ref (optional commit or branch)<input data-f="ref" class="mono" autocomplete="off" spellcheck="false"></label></div>
<div class="row"><div class="seg sm" role="group" aria-label="Entrypoints">${[['build', 'build.bat /s'], ['build-installer', 'build-installer.bat /s'], ['build,build-installer', 'both']].map(([v, l], i) => `<button type="button" data-entry="${v}" aria-pressed="${i === 0}">${l}</button>`).join('')}</div><label class="row" style="gap:6px;font-size:13px"><input type="checkbox" data-f="noreset"> keep current state (no reset)</label><button type="button" class="btn cyan" style="margin-left:auto" data-d="build">Run fresh build</button></div>
<div class="errbox" data-builderr hidden></div><div class="runlist" data-runs></div></section>
<section class="card" aria-label="self-hosted runners"><span class="eyebrow">self-hosted runners</span><p class="muted" style="margin:0;font-size:14px">Private repositories only. Paste the registration token; it goes to the CLI on standard input and never touches a file.</p>
<label class="field">Private repository<input data-f="ghrepo" class="mono" placeholder="owner/name" autocomplete="off" spellcheck="false"></label><label class="field">Labels (optional, comma separated)<input data-f="ghlabels" class="mono" autocomplete="off"></label><label class="field">Registration token<input data-f="ghtoken" type="password" class="mono" placeholder="kept in memory only" autocomplete="off"></label>
<div class="errbox" data-gherr hidden></div><div class="row"><button type="button" class="btn amber" data-d="hire">Host a self-hosted runner</button></div><div class="runlist" data-gh></div></section>
<section class="card" aria-label="screenshot" data-shotcard hidden><span class="eyebrow">screenshot</span><p class="small" data-shotinfo></p><img class="shotimg" alt="screenshot of the guest screen" data-shotimg></section>
<section class="card" aria-label="Details"><span class="eyebrow">Details</span><dl class="kv" data-kv></dl></section>
</div>`;
    const ui = { el, repo: $('[data-f=repo]', el), net: null, entry: 'build' };
    machineUI[key(name)] = ui;
    $('[data-mname]', el).textContent = name;
    el.addEventListener('click', async (e) => {
      const m = (state.machines || []).find((x) => key(x.Name) === key(name));
      const entry = e.target.closest('[data-entry]'); if (entry) { ui.entry = entry.dataset.entry; for (const b of el.querySelectorAll('[data-entry]')) b.setAttribute('aria-pressed', String(b === entry)); return; }
      const net = e.target.closest('[data-net]'); if (net && !net.disabled && m) {
        const r = await cli('net', { name, mode: net.dataset.net }); if (r.ok) toast(`Network set to ${net.dataset.net}`); else toast('Network: ' + r.error, 'error'); await refreshMachines(); return;
      }
      if (e.target.closest('[data-back]')) return closeMachineTab(name);
      const d = e.target.closest('[data-d]'); if (!d || !m) return;
      const act = d.dataset.d;
      if (act === 'power') return machineAction('power', name);
      if (act === 'reset') return machineAction('reset', name);
      if (act === 'rdp') return machineAction('rdp', name);
      if (act === 'share') return machineAction('share', name);
      if (act === 'copy') { if (m.IP) { await api.copy(m.IP); toast('Copied ' + m.IP); } return; }
      if (act === 'ip') { const r = await cli('ip', { name }); if (r.ok && r.data && r.data.ip) { m.IP = r.data.ip; updateMachine(name); } else toast('IP: ' + (r.error || 'no address'), 'error'); return; }
      if (act === 'shot') {
        d.disabled = true; d.textContent = 'Capturing…';
        const r = await api.shot(name); d.disabled = false; d.textContent = 'screenshot';
        const card = $('[data-shotcard]', el); card.hidden = false;
        if (r.ok) { $('[data-shotimg]', el).src = r.dataUrl; $('[data-shotinfo]', el).textContent = `Saved ${r.file} (${bytes(r.bytes)})`; $('[data-shotimg]', el).hidden = false; }
        else { $('[data-shotimg]', el).hidden = true; $('[data-shotinfo]', el).textContent = 'screenshot failed: ' + r.error; }
        return;
      }
      if (act === 'scrap') {
        if (!(await superConfirm({ action: `Destroy ${name}`, affected: `${name} is destroyed for good: its virtual machine, disk, snapshots, saved guest credential and self-hosted runner registrations. The shared folder on this PC is kept. This cannot be undone.` }))) return;
        return startJob(`Destroy ${name}`, 'rm', { name }, { hold: key(name), after: (r) => { if (r.ok) closeMachineTab(name); } });
      }
      if (act === 'build') {
        const repo = ui.repo.value.trim(), err = $('[data-builderr]', el);
        if (!REPO_RE.test(repo)) { err.hidden = false; err.textContent = 'Enter the repository as owner/name.'; return; }
        err.hidden = true;
        if (m.Power !== 'running') { /* the CLI starts the machine as part of a build */ }
        return startJob(`Fresh build ${repo} on ${name}`, 'build', { name, repo, ref: $('[data-f=ref]', el).value.trim(), entry: ui.entry, noReset: $('[data-f=noreset]', el).checked }, { hold: key(name), okText: 'The fresh build passed; the receipt is in Receipts.', after: refreshReceipts });
      }
      if (act === 'passwd') {
        const pwEl = $('[data-f=newpw]', el), err = $('[data-pwerr]', el);
        if (!pwEl.value || pwEl.value.length < 4) { err.hidden = false; err.textContent = 'Use at least 4 characters.'; return; }
        if ((m.Runners || 0) > 0) { err.hidden = false; err.textContent = 'Remove the self-hosted runner first: changing the password retakes the baseline.'; return; }
        err.hidden = true;
        const params = { name, secret: pwEl.value };
        pwEl.value = '';
        const p = startJob(`Change the guest password on ${name}`, 'passwd', params, { hold: key(name), okText: 'Guest password changed; the baseline was retaken with it.' });
        params.secret = '';
        return p;
      }
      if (act === 'hire') {
        const repo = $('[data-f=ghrepo]', el).value.trim(), labels = $('[data-f=ghlabels]', el).value.trim(), tokenEl = $('[data-f=ghtoken]', el), err = $('[data-gherr]', el);
        if (!REPO_RE.test(repo)) { err.hidden = false; err.textContent = 'Enter the private repository as owner/name.'; return; }
        if (!tokenEl.value) { err.hidden = false; err.textContent = 'Paste the registration token first.'; return; }
        err.hidden = true;
        const params = { name, repo, labels, secret: tokenEl.value };
        tokenEl.value = '';
        const p = startJob(`Hire a self-hosted runner on ${name} for ${repo}`, 'runner-add', params, { hold: key(name), okText: 'The self-hosted runner is registered.' });
        params.secret = '';
        return p;
      }
      const rm = e.target.closest('[data-ghrm]');
      if (rm) return startJob(`Remove self-hosted runner ${rm.dataset.ghrm} from ${name}`, 'runner-rm', { name, repo: rm.dataset.ghrm }, { hold: key(name) });
    });
    updateMachine(name);
  }
  function updateMachine(name) {
    const ui = machineUI[key(name)]; if (!ui) return;
    const el = ui.el;
    const m = (state.machines || []).find((x) => key(x.Name) === key(name));
    if (!m) { $('[data-ip]', el).textContent = state.machines === null ? 'loading…' : 'not found'; return; }
    const p = plan(m), meta = p.meta, busy = state.busy.has(key(name)), on = m.Power === 'running', ready = m.Status === 'ready';
    const pill = $('[data-pill]', el); pill.textContent = (on ? '● ' : '') + p.pill[0]; pill.className = 'pill ' + p.pill[1];
    $('[data-chips]', el).innerHTML = chipsFor(m);
    $('[data-d=share]', el).hidden = !shareOf(m);
    $('[data-ip]', el).textContent = on && m.IP ? m.IP : (on ? 'waiting for an address…' : 'off, no address');
    const pw = $('[data-d=power]', el); pw.textContent = on ? 'Stop' : 'Start'; pw.disabled = !ready || busy;
    $('[data-d=reset]', el).disabled = !ready || busy; $('[data-d=shot]', el).disabled = !on; $('[data-d=scrap]', el).disabled = busy;
    $('[data-d=rdp]', el).disabled = !(on && m.IP); $('[data-d=copy]', el).disabled = !(on && m.IP); $('[data-d=ip]', el).disabled = !on;
    $('[data-d="rdp"]', el).textContent = isLinux(m) ? 'SSH' : 'Remote Desktop';
    $('[data-rdphint]', el).textContent = isLinux(m) ? (on && m.IP ? 'Opens an SSH session with the key made for this machine.' : 'Start the machine to get an address.') : on && m.IP ? 'Opens Remote Desktop signed in with the credential saved for this address.' : 'Start the machine to get an address.';
    $('[data-user]', el).textContent = m.User || meta.userName || '';
    const dp = $('[data-defpw]', el); dp.hidden = meta.defaultPassword !== true; if (meta.defaultPassword === null || meta.defaultPassword === undefined) dp.hidden = true;
    for (const b of el.querySelectorAll('[data-net]')) { b.setAttribute('aria-pressed', String(b.dataset.net === m.Network)); b.disabled = on || busy; b.title = on ? 'Stop the machine to change the network mode' : ''; }
    $('[data-nethelp]', el).textContent = NET_HELP[m.Network] || '';
    $('[data-lanwarn]', el).hidden = !(m.Network === 'bridged' && meta.defaultPassword === true);
    const fb = $('[data-fallback]', el); if (meta.networkFallback) { fb.hidden = false; fb.textContent = `This machine fell back from ${meta.networkFallback.from} to ${meta.networkFallback.to}: ${meta.networkFallback.reason}.`; } else fb.hidden = true;
    const runs = receiptsFor(name);
    const rl = $('[data-runs]', el);
    rl.innerHTML = runs.length ? runs.slice(0, 6).map(runRow).join('') : '<div class="small">No fresh build run on this machine yet.</div>';
    const gh = $('[data-gh]', el); const rs = meta.runners || [];
    gh.innerHTML = rs.length ? rs.map((r) => `<div class="run"><span class="dot amber"></span><span class="what">${esc(r.repo || 'registered')}${r.labels ? ' · ' + esc(r.labels) : ''}</span>${r.repo ? `<button type="button" class="btn sm danger" data-ghrm="${esc(r.repo)}">Remove</button>` : ''}</div>`).join('') : '<div class="small">No self-hosted runner is registered on this machine.</div>';
    const kv = [['State', p.pill[0] + ' · ' + (m.Status || '')], ['Project', m.Project], ['Hypervisor', [m.Hypervisor, meta.hypervisorVersion].filter(Boolean).join(' ')], ['Size', [meta.memoryMB ? fmtGB(meta.memoryMB) : '', meta.cpus ? meta.cpus + ' vCPU' : '', meta.diskGB ? meta.diskGB + ' GB disk' : ''].filter(Boolean).join(' · ')], ['Owner', OWNERS[ownerOf(m)]], ['Shared folder', shareOf(m) ? shareOf(m).hostPath + (shareOf(m).guestPath ? ' (guest: ' + shareOf(m).guestPath + ')' : '') : 'none'], ['Baseline', m.Baseline], ['Created', when(m.Created)]].filter(([, v]) => v);
    $('[data-kv]', el).innerHTML = kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  }
  function runRow(r) {
    const c = r.verdict === 'passed' ? 'lime' : 'red';
    const what = r.kind === 'install' ? `install ${r.repository || ''}` : `${(r.repository || '') + '@' + String(r.commit || '').slice(0, 7)} · ${r.entrypoints.map((e) => e.name).filter(Boolean).join('+') || 'build'}`;
    return `<div class="run"><span class="dot ${c}"></span><span class="what">${esc(what)}</span><span class="verdict v-${c}">${esc(r.verdict || '')}${r.hostMinutes != null ? ' · ' + esc(r.hostMinutes) + ' min' : ''}</span></div>`;
  }

  // ---------- Receipts ----------
  const recSearch = makeSearch({ placeholder: 'Search receipts', label: 'Search receipts', onChange: () => renderReceipts() });
  P.receipts.innerHTML = '<div class="row"><span class="small" id="rInfo"></span><span class="grow"></span><button type="button" class="btn sm" id="rFolder">Open runs folder</button><button type="button" class="btn sm" id="rRefresh">Refresh</button></div><div class="runlist" id="rList"></div>';
  pageHead('receipts', 'Receipts', 'No receipts yet', collapsibleSearch('receipts-search', recSearch).el);
  $('#rFolder', P.receipts).addEventListener('click', () => api.openFolder('runs'));
  $('#rRefresh', P.receipts).addEventListener('click', refreshReceipts);
  function renderReceipts() {
    const list = $('#rList', P.receipts), info = $('#rInfo', P.receipts);
    setHead('receipts', state.receipts.length ? `${state.receipts.length} receipt${state.receipts.length === 1 ? '' : 's'}` : 'No receipts yet');
    info.textContent = state.receiptsDir ? `${state.receipts.length} receipts in ${state.receiptsDir}` : '';
    if (recSearch.invalid()) { list.innerHTML = '<div class="errbox">That regex pattern is not valid, so nothing was filtered.</div>'; return; }
    let rs = state.receipts;
    if (recSearch.active()) { rs = rs.filter((r) => recSearch.test([r.runId, r.repository, r.commit, r.verdict, r.machine && r.machine.name, r.machine && r.machine.project].join(' '))); recSearch.setStatus(rs.length + ' of ' + state.receipts.length + ' receipts'); }
    if (!state.receipts.length) { list.innerHTML = '<div class="empty"><h2>No receipts yet</h2><p>' + emptyText('A receipt is written for every fresh-host build, bound to the exact commit. Run a fresh build from a machine.') + '</p></div>'; return; }
    if (!rs.length) { list.innerHTML = '<div class="empty"><h2>No receipt matches</h2></div>'; return; }
    list.innerHTML = rs.map((r) => {
      const c = r.verdict === 'passed' ? 'lime' : 'red';
      const sf = r.dependencies ? `dependencies acquired: ${r.dependencies.folders || 0} new folders (${r.dependencies.megabytes || 0} MB), ${r.dependencies.tools} tools on PATH, ${r.dependencies.programs} programs, ${r.dependencies.choco} Chocolatey packages` : '';
      return `<article class="card" style="padding:20px"><div class="row"><span class="dot ${c}" style="width:12px;height:12px;border-radius:6px"></span><strong class="mono" style="overflow-wrap:anywhere">${esc(r.repository || '')}@${esc(String(r.commit || '').slice(0, 10))}</strong><span class="pill ${c === 'lime' ? 'lime' : 'red'}">${esc(r.verdict || '')}</span><span class="grow"></span><span class="small">${esc(when(r.finishedUtc))}</span></div>
<dl class="kv"><dt>Machine</dt><dd>${r.machine ? `<span class="mname">${esc(r.machine.name)}</span> ${esc([r.machine.hypervisor, r.machine.memoryMB ? fmtGB(r.machine.memoryMB) : '', r.machine.cpus ? r.machine.cpus + ' vCPU' : '', r.machine.network].filter(Boolean).join(' · '))}` : 'unknown'}</dd><dt>Run time</dt><dd>${esc(r.hostMinutes != null ? r.hostMinutes + ' min' : 'unknown')}</dd><dt>Entrypoints</dt><dd>${r.entrypoints.map((e) => esc((e.name || 'entry') + ': ' + (e.result || '?'))).join(' · ') || 'none recorded'}</dd>${sf ? `<dt>Acquired</dt><dd>${esc(sf.replace('dependencies acquired: ', ''))}</dd>` : ''}<dt>Run id</dt><dd class="mono">${esc(r.runId)}</dd></dl></article>`;
    }).join('');
  }
  async function refreshReceipts() { const r = await api.receipts(); state.receipts = r.receipts || []; state.receiptsDir = r.dir; renderReceipts(); renderMachines(); for (const n of state.machineTabs) updateMachine(n); }

  // ---------- Media ----------
  P.media.innerHTML = '<section class="card"><span class="eyebrow">Evaluation media</span><p class="muted" style="margin:0">Official Microsoft evaluation media used for unattended installs. Checking re-verifies the stored file; if it is missing, the CLI downloads it (several GB).</p><div id="mList" class="runlist"></div><div class="row"><button type="button" class="btn cyan" id="mCheck">Check media</button><button type="button" class="btn sm" id="mFolder">Open media folder</button></div></section>';
  pageHead('media', 'Media', 'Evaluation media');
  function renderMedia() {
    const m = state.media, list = $('#mList', P.media);
    if (!m) { list.innerHTML = '<div class="small">Reading the media folder…</div>'; return; }
    const rows = m.receipts.map((r) => `<div class="run"><span class="dot lime"></span><span class="what">${esc(r.file || r.name)}<br><span class="small">sha256 ${esc(r.sha256 || 'unknown')}${r.host ? ' · from ' + esc(r.host) : ''}</span></span></div>`);
    for (const f of m.files) rows.push(`<div class="run"><span class="dot cyan"></span><span class="what">${esc(f.name)}</span><span class="verdict v-cyan">${esc(bytes(f.bytes))}</span></div>`);
    list.innerHTML = rows.length ? rows.join('') : '<div class="small">No media downloaded yet in ' + esc(m.dir) + '.</div>';
  }
  async function refreshMedia() { state.media = await api.mediaInfo(); renderMedia(); }
  $('#mCheck', P.media).addEventListener('click', async () => {
    if (!(await confirmSheet({ title: 'Check the evaluation media?', body: 'This runs mvl media. If the media is not on disk yet it is downloaded from Microsoft, which is several GB.', label: 'Run media check' }))) return;
    startJob('Check the evaluation media', 'media', {}, { okText: 'The media is present and verified.', after: refreshMedia });
  });
  $('#mFolder', P.media).addEventListener('click', () => api.openFolder('media'));
  const serverMedia = document.createElement('section');
  serverMedia.className = 'card';
  serverMedia.innerHTML = `<span class="eyebrow">Server 2025 installation media</span>
    <div class="row"><button type="button" class="btn cyan" id="serverMediaChoose">Inspect Server ISO</button></div>
    <p class="small" role="status" id="serverMediaStatus"></p>
    <div class="runlist" id="serverMediaEditions"></div>`;
  P.media.append(serverMedia);
  const serverMediaButton = $('#serverMediaChoose', serverMedia);
  serverMediaButton.addEventListener('click', async () => {
    const status = $('#serverMediaStatus', serverMedia);
    const editions = $('#serverMediaEditions', serverMedia);
    serverMediaButton.disabled = true;
    editions.replaceChildren();
    status.textContent = 'Choose a local ISO to inspect.';
    try {
      const result = await api.selectServerMedia();
      if (result.cancelled) { status.textContent = 'Media selection canceled.'; return; }
      if (!result.ok || !result.data?.editions?.length) {
        status.textContent = result.error || 'Media inspection returned no supported editions.';
        return;
      }
      const media = result.data;
      editions.innerHTML = media.editions.map((edition) =>
        `<div class="run"><span class="what">${esc(edition.name)}<br><span class="small">${esc(edition.installation)}</span></span><span class="verdict">Image ${esc(edition.index)}</span></div>`
      ).join('');
      status.textContent = `Verified ${media.path.split('\\').pop()}. SHA-256 ${media.sha256}`;
    } catch (error) {
      status.textContent = error.message || 'Server media inspection could not start.';
    } finally {
      serverMediaButton.disabled = false;
    }
  });

  // ---------- Build and Docs ----------
  P.build.innerHTML = '<div id="bayRoot"></div>';
  pageHead('build', 'Build', 'Fresh-host builds');
  MvlBuildPanel.mount($('#bayRoot', P.build), window.mvlBuild);
  P.docs.innerHTML = '<div id="docRoot"></div>';
  pageHead('docs', 'Docs', 'Read the docs');
  MvlDocsReader.mount($('#docRoot', P.docs), window.mvlDocs);

  // ---------- Settings ----------
  P.settings.innerHTML = `<div class="cols"><section class="card"><span class="eyebrow">State</span><label class="field">State root (machines, runs, media)<input id="sRoot" class="mono" autocomplete="off" spellcheck="false"></label><p class="small" id="sResolved"></p><div class="row"><button type="button" class="btn primary sm" id="sApply">Apply state root</button><button type="button" class="btn sm" id="sFolder">Open it</button></div><p class="small">Leave it empty to use MVL_HOME or %LOCALAPPDATA%\\MaterialVmLabs. Applying reloads the machine list.</p><div class="errbox" id="sErr" hidden></div></section>
<section class="card"><span class="eyebrow">New machines</span><div class="seg" role="group" aria-label="Default network" id="sNet">${NETS.map(([n, l]) => `<button type="button" data-n="${n}" aria-pressed="false">${l}</button>`).join('')}</div><p class="small">The network mode the Create sheet starts with. Bridged exposes the guest on your LAN.</p></section>
<section class="card"><span class="eyebrow">Appearance</span><div id="sAppearance"></div></section>
<section class="card" id="sLang"></section>
<section class="card" id="sVocab"></section>
<section class="card" id="sMotionEditor"></section>
<section class="card"><span class="eyebrow">Notifications and sounds</span><div id="sNotify"></div></section>
<section class="card" id="sFunny"></section><section class="card"><span class="eyebrow">Dim sum</span><div id="sDimsum"></div></section><section class="card" id="sNarrator"></section>
<section class="card"><span class="eyebrow">Setup</span><p class="small" id="sSetupState"></p><div class="row"><button type="button" class="btn sm" id="sSetup">Run setup again</button></div></section>
<section class="card"><span class="eyebrow">Tabs and panels</span><p class="small">Closed tabs stay closed until you reopen them from New tab or Open every tab. The running operations panel remembers where you put it.</p><div class="row"><button type="button" class="btn sm" id="sTabsAll">Open every tab</button><button type="button" class="btn sm" id="sTabsNew">New tab</button><button type="button" class="btn sm" id="sPanelReset">Reset the running operations panel</button></div></section>
<section class="card"><span class="eyebrow">About</span><dl class="kv" id="sAbout"></dl></section></div>`;
  pageHead('settings', 'Settings', 'Settings');
  function renderSettings() {
    const s = state.settings; if (!s) return;
    $('#sRoot', P.settings).value = s.stateRoot || '';
    $('#sRoot', P.settings).placeholder = s.resolvedRoot || '';
    $('#sResolved', P.settings).textContent = 'Currently using ' + s.resolvedRoot;
    for (const b of $('#sNet', P.settings).querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.n === s.defaultNet));
    $('#sAbout', P.settings).innerHTML = [['CLI source', s.repo || 'none'], ['Fonts', 'Roboto Flex and Roboto Mono (SIL OFL), bundled'], ['Network use', 'none by the app; the CLI fetches media and dependencies only when you ask']].map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  }
  async function saveSettings(patch) {
    state.settings = await api.setSettings(patch); state.settings.repo = (await api.settings()).repo; renderSettings();
    window.MVL.setTheme(state.settings.theme || 'system'); window.MVL.setReduceMotion(!!state.settings.reduceMotion);
  }
  $('#sApply', P.settings).addEventListener('click', async () => {
    const v = $('#sRoot', P.settings).value.trim(), err = $('#sErr', P.settings);
    if (/[<>|"*?]/.test(v) || v.length > 400) { err.hidden = false; err.textContent = 'That path has characters a Windows folder cannot contain.'; return; }
    err.hidden = true; await saveSettings({ stateRoot: v }); toast('State root applied'); reloadAll();
  });
  $('#sFolder', P.settings).addEventListener('click', () => api.openFolder('root'));
  $('#sNet', P.settings).addEventListener('click', (e) => { const b = e.target.closest('[data-n]'); if (b) saveSettings({ defaultNet: b.dataset.n }); });
  $('#sAppearance', P.settings).append(window.MVL.appearanceControls((p) => { if ('theme' in p || 'reduceMotion' in p) saveSettings(p); }));
  $('#sVocab', P.settings).append(window.MVLVocab.control());
  if (window.MVLI18n) $('#sLang', P.settings).append(window.MVLI18n.control());
  if (window.MVLMotion) $('#sMotionEditor', P.settings).append(window.MVLMotion.editor());
  if (window.MVLNotify) $('#sNotify', P.settings).append(window.MVLNotify.control());
  if (window.MVLFunny) $('#sFunny', P.settings).append(window.MVLFunny.control());
  if (window.MVLDimsum) $('#sDimsum', P.settings).append(window.MVLDimsum.control());
  if (window.MVLNarrator) $('#sNarrator', P.settings).append(window.MVLNarrator.control());

  // ---------- self-hosted runners: the hosting assist (renderer/manager/runner.js) ----------
  gh = window.MVLRunner.create({ state, $, esc, makeSearch, toast, api, key, panel: P.runner, openCreate, confirmSheet, startJob, refreshMachines });
  pageHead('runner', 'Runners', 'Host a self-hosted runner for a private repository', collapsibleSearch('runners-search', gh.dutySearch).el);

  // Context menu items for a machine card: the same actions as its buttons, with their shortcuts.
  if (window.MVLContext) window.MVLContext.register('.mcard', (card) => {
    const btn = (re) => [...card.querySelectorAll('button')].find((b) => re.test(b.textContent) && !b.disabled);
    return [[/^Open$/, 'Open the machine', 'Enter'], [/Remote Desktop/, 'Remote Desktop', 'Ctrl+R'], [/^Start$/, 'Start', 'Ctrl+Shift+S'], [/^Stop$/, 'Stop', 'Ctrl+Shift+S'], [/^Reset$/, 'Reset to baseline', 'Ctrl+Shift+R'], [/Fresh build/, 'Fresh build', 'Ctrl+B']]
      .map(([re, label, shortcut]) => { const b = btn(re); return b ? { label, shortcut, run: () => b.click() } : null; }).filter(Boolean);
  });
  document.addEventListener('keydown', (e) => {
    const card = document.activeElement && document.activeElement.closest && document.activeElement.closest('.mcard'); if (!card || !e.ctrlKey) return;
    const click = (re) => { const b = [...card.querySelectorAll('button')].find((x) => re.test(x.textContent) && !x.disabled); if (b) { e.preventDefault(); b.click(); } };
    if (!e.shiftKey && (e.key === 'r' || e.key === 'R')) click(/Remote Desktop/);
    else if (e.shiftKey && (e.key === 'S' || e.key === 's')) click(/^(Start|Stop)$/);
    else if (e.shiftKey && (e.key === 'R' || e.key === 'r')) click(/^Reset$/);
    else if (!e.shiftKey && (e.key === 'b' || e.key === 'B')) click(/Fresh build/);
  });

  // ---------- first-run setup ----------
  // Every step runs the same real call the rest of the manager uses and shows what it returned.
  const hvName = (d) => (d && (d.kind === 'vmware' ? 'VMware' : d.kind === 'virtualbox' ? 'VirtualBox' : d.kind)) || 'hypervisor';
  const setup = window.MVLOnboarding.create({
    id: 'manager', app: 'Material VM Labs', subtitle: 'First-run setup', finishLabel: 'Open the workspace',
    skipHint: (st) => `Skipped. You can do this later from ${st.id === 'media' ? 'Media' : 'Machines, Create machine'}.`,
    steps: [
      { id: 'welcome', label: 'Welcome', note: 'What it does', info: true, title: 'Throwaway machines for honest proof',
        intro: 'Material VM Labs creates clean Windows 11, Ubuntu and Debian machines on this PC, so you can prove a repository builds and installs on a fresh host, test installers, and host self-hosted runners for private repositories.',
        render(body) { body.innerHTML = '<div class="onb-tiles"><div class="onb-tile"><strong>Machines</strong><span class="small">Unattended install to a clean baseline, Remote Desktop or SSH ready.</span></div><div class="onb-tile"><strong>Fresh builds</strong><span class="small">One exact commit, entrypoints run silently, a receipt bound to it.</span></div><div class="onb-tile"><strong>Runners</strong><span class="small">Self-hosted runners for private repositories only.</span></div></div><p class="small" style="margin:0">A few minutes. Optional steps can be skipped and done later. Close this at any time with Save and finish later; it picks up where you stopped.</p>'; } },
      { id: 'hv', label: 'Hypervisor', note: 'Required check', title: 'Check the hypervisor',
        intro: 'VMware Workstation is used first. VirtualBox is the fallback, and the one used for a required TPM.',
        render(body, ctx) {
          body.innerHTML = '<div class="onb-rows" data-rows></div><div class="row"><button type="button" class="btn" data-check>Check this PC</button></div>';
          const rows = $('[data-rows]', body), btn = $('[data-check]', body);
          const draw = () => {
            const d = ctx.data;
            if (!d.a) { rows.innerHTML = '<div><span class="small">Not checked yet. Checking asks vmrun and VBoxManage on this PC.</span></div>'; return; }
            const line = (r, what) => `<div><span class="pill ${r.ok ? 'lime' : 'red'}">${r.ok ? 'Found' : 'Not usable'}</span><span class="grow"><strong>${esc(what)}</strong><br><span class="small">${esc(r.ok ? (r.data && r.data.reason) || 'Answers normally.' : r.error || 'No answer')}</span></span></div>`;
            rows.innerHTML = line(d.a, d.a.ok ? `${hvName(d.a.data)} ${String((d.a.data && d.a.data.version) || '').split(' ')[0]}` : 'Default hypervisor') + line(d.b, d.b.ok ? `VirtualBox ${String((d.b.data && d.b.data.version) || '').split(' ')[0]}` : 'VirtualBox');
          };
          const run = async () => {
            btn.disabled = true; btn.textContent = 'Checking...'; ctx.setResult('run', 'Asking vmrun and VBoxManage on this PC...');
            rows.innerHTML = '<div><span class="pill cyan">Checking</span><span class="grow small">Asking vmrun and VBoxManage...</span></div>';
            let a, b;
            try { [a, b] = await loadHv(); } catch (e) { a = { ok: false, error: e.message || String(e) }; b = { ok: false, error: 'not checked' }; }
            ctx.data.a = { ok: !!a.ok, data: a.data || null, error: a.error || '' }; ctx.data.b = { ok: !!b.ok, data: b.data || null, error: b.error || '' }; ctx.save();
            if (!btn.isConnected) { ctx.setResult(a.ok ? 'ok' : 'fail', a.ok ? `${hvName(a.data)} answers. New machines use it.` : 'No usable hypervisor: ' + (a.error || 'unknown')); return; }
            btn.disabled = false; btn.textContent = 'Check again'; draw();
            ctx.setResult(a.ok ? 'ok' : 'fail', a.ok ? `${hvName(a.data)} ${String((a.data && a.data.version) || '').split(' ')[0]} answers. New machines use it.` : 'No usable hypervisor: ' + (a.error || 'unknown') + '. Install VMware Workstation or VirtualBox, then check again. You can continue, but machines cannot be created until this passes.');
          };
          btn.addEventListener('click', run);
          draw();
          if (ctx.data.a) btn.textContent = 'Check again';
          if (!ctx.result || ctx.result.status === 'stale') run();
        } },
      { id: 'root', label: 'State folder', note: 'Where machines live', title: 'Choose the state folder',
        intro: 'Machines, run receipts and media are kept here. Leave it empty to use MVL_HOME or the default folder in your local app data.',
        render(body, ctx) {
          const s = state.settings || {};
          body.innerHTML = `<label class="field">State root (machines, runs, media)<input data-root class="mono" autocomplete="off" spellcheck="false"></label><p class="small" data-now></p><div class="errbox" data-err hidden></div>`;
          const inp = $('[data-root]', body);
          inp.value = ctx.data.value != null ? ctx.data.value : (s.stateRoot || ''); inp.placeholder = s.resolvedRoot || '';
          $('[data-now]', body).textContent = 'Currently using ' + (s.resolvedRoot || 'the default folder') + '. Next applies your choice.';
          inp.addEventListener('input', () => { ctx.data.value = inp.value; ctx.save(); });
          ctx.el = body;
        },
        async onNext(ctx) {
          const body = ctx.el; const inp = body && $('[data-root]', body); const err = body && $('[data-err]', body);
          const v = inp ? inp.value.trim() : String(ctx.data.value || '').trim();
          if (/[<>|"*?]/.test(v) || v.length > 400) { if (err) { err.hidden = false; err.textContent = 'That path has characters a Windows folder cannot contain.'; } ctx.setResult('fail', 'Not applied: that path has characters a Windows folder cannot contain.'); return false; }
          if (err) err.hidden = true;
          const changed = v !== ((state.settings && state.settings.stateRoot) || '');
          if (changed) { await saveSettings({ stateRoot: v }); reloadAll(); }
          ctx.setResult('ok', (changed ? 'Applied. Using ' : 'Kept. Using ') + ((state.settings && state.settings.resolvedRoot) || v || 'the default folder'));
          return true;
        } },
      { id: 'net', label: 'Network', note: 'Default for new machines', title: 'Choose the default network',
        intro: 'The network mode the Create sheet starts with. You can still pick another one for each machine.',
        render(body, ctx) {
          const cur = ctx.data.net || (state.settings && state.settings.defaultNet) || 'nat';
          ctx.data.net = cur;
          body.innerHTML = `<div class="seg" role="group" aria-label="Default network">${NETS.map(([n, l]) => `<button type="button" data-n="${n}" aria-pressed="${n === cur}">${l}</button>`).join('')}</div><p class="small" data-help style="margin:0"></p>`;
          const help = () => { $('[data-help]', body).textContent = NET_HELP[ctx.data.net] + (ctx.data.net === 'bridged' ? ' Bridged exposes the guest on your LAN.' : ''); };
          body.addEventListener('click', (e) => { const b = e.target.closest('[data-n]'); if (!b) return; ctx.data.net = b.dataset.n; ctx.save(); for (const x of body.querySelectorAll('[data-n]')) x.setAttribute('aria-pressed', String(x === b)); help(); });
          help();
        },
        async onNext(ctx) {
          const want = ctx.data.net || 'nat';
          await saveSettings({ defaultNet: want });
          const got = state.settings && state.settings.defaultNet;
          if (got !== want) { ctx.setResult('fail', `The setting did not save: the manager still reports ${got || 'nothing'}.`); return false; }
          ctx.setResult('ok', `Saved. New machines start on ${(NETS.find((x) => x[0] === got) || [got, got])[1]}.`);
          return true;
        } },
      { id: 'media', label: 'Windows media', optional: true, title: 'Get the Windows media',
        intro: 'The official Windows 11 Enterprise evaluation ISO from Microsoft, several GB, checked with SHA-256. Optional now: the first Windows machine downloads it anyway.',
        render(body, ctx) {
          body.innerHTML = '<div class="onb-rows" data-have></div><div class="row"><button type="button" class="btn cyan" data-go>Download and verify now</button></div><p class="small" style="margin:0">This runs mvl media. If the media is already on disk it is only verified. The live output appears in the running operations panel.</p>';
          const have = $('[data-have]', body), btn = $('[data-go]', body);
          const draw = () => {
            const m = state.media;
            if (!m) { have.innerHTML = '<div><span class="small">Reading the media folder...</span></div>'; return; }
            const n = (m.receipts || []).length, f = (m.files || []).length;
            have.innerHTML = `<div><span class="pill ${n ? 'lime' : 'amber'}">${n ? 'Verified before' : 'None yet'}</span><span class="grow small">${n ? esc(n + ' verified file' + (n === 1 ? '' : 's') + ' in ' + (m.dir || 'the media folder')) : esc('No verified media in ' + (m.dir || 'the media folder') + (f ? ' (' + f + ' file' + (f === 1 ? '' : 's') + ' present, not verified)' : ''))}</span></div>`;
          };
          if (!state.media) refreshMedia().then(() => { if (have.isConnected) draw(); });
          draw();
          const r = ctx.result; if (r && r.status === 'run') btn.disabled = true; if (r && (r.status === 'fail' || r.status === 'stale')) btn.textContent = 'Try again';
          btn.addEventListener('click', () => {
            btn.disabled = true;
            ctx.setResult('run', 'Checking the media. The live output is in the running operations panel; you can keep going.');
            startJob('Check the evaluation media', 'media', {}, { okText: 'The media is present and verified.', after: refreshMedia }).then((res) => {
              ctx.setResult(res.ok ? 'ok' : 'fail', res.ok ? 'The media is present and verified.' : (res.cancelled ? 'Cancelled before it finished. ' : 'The media check failed: ') + (res.error || 'no detail'));
              if (btn.isConnected) { btn.disabled = false; btn.textContent = res.ok ? 'Check again' : 'Try again'; draw(); }
            });
          });
        } },
      { id: 'machine', label: 'First machine', optional: true, title: 'Create your first machine',
        intro: 'The Create sheet asks for a name, the system, who uses it and its size. A Windows 11 machine takes about 13 minutes; you can keep working while it installs.',
        render(body, ctx) {
          const n = (state.machines || []).length;
          body.innerHTML = `<p class="small" style="margin:0" data-have></p><div class="row"><button type="button" class="btn primary" data-go>Open the Create sheet</button></div>`;
          $('[data-have]', body).textContent = state.machines === null ? 'Reading the machine list...' : n ? `You already have ${n} machine${n === 1 ? '' : 's'}. Another one is optional.` : 'You have no machines yet.';
          const btn = $('[data-go]', body);
          if (ctx.result && ctx.result.status === 'run') btn.disabled = true;
          btn.addEventListener('click', () => openCreate(null, (name, job) => {
            btn.disabled = true;
            ctx.setResult('run', `Creating ${name}. Follow it in the running operations panel; you can finish setup meanwhile.`);
            job.then((r) => { ctx.setResult(r.ok ? 'ok' : 'fail', r.ok ? `${name} is ready at a clean baseline.` : (r.cancelled ? `Creating ${name} was cancelled.` : `Creating ${name} failed: ${r.error || 'no detail'}`)); if (btn.isConnected) { btn.disabled = false; btn.textContent = r.ok ? 'Create another' : 'Try again'; } });
          }));
        } }
    ],
    onFinish: () => { setupState(); selectTab('machines'); const h = heads.machines; if (h) { h.tabIndex = -1; h.focus(); } },
    onLater: () => { setupState(); const t = $('#tab-' + CSS.escape(state.tab)); if (t) t.focus(); }
  });
  const setupState = () => { const el = $('#sSetupState', P.settings); if (el) el.textContent = setup.isDone() ? 'First-run setup is complete. Run it again to recheck the hypervisor, the state folder, the network, the media or to create a machine.' : 'First-run setup is not finished. It continues where you stopped.'; };
  $('#sSetup', P.settings).addEventListener('click', () => { setup.start(true); });
  $('#sTabsAll', P.settings).addEventListener('click', openEveryTab);
  $('#sTabsNew', P.settings).addEventListener('click', openCatalog);
  $('#sPanelReset', P.settings).addEventListener('click', () => { actDock.reset(); toast('The running operations panel is back at the top at its default size'); });
  if (window.MVLPalette) window.MVLPalette.register({ title: 'Run setup again', hint: 'First-run setup', keywords: ['onboarding', 'wizard', 'setup'], run: () => setup.start(true) });
  // The notification centre side sheet resizes from its left edge; it re-renders, so the edge is re-added.
  new MutationObserver(() => {
    const d = document.getElementById('notifyCentre');
    if (!d || d.dataset.sized) return;
    d.dataset.sized = '1';
    const sz = window.MVLPanels.sizable(d, { id: 'manager-notify', edge: 'w', min: 320, label: 'Resize the notifications sheet' });
    new MutationObserver(() => sz.reattach()).observe(d, { childList: true });
  }).observe(document.body, { childList: true });

  // ---------- loading ----------
  function renderAll(soft) { renderMachines(); for (const n of state.machineTabs) updateMachine(n); if (gh) gh.update(); if (!soft) renderTabs(); }
  async function refreshMachines() {
    const r = await cli('ls', {});
    if (r.ok) {
      state.machines = arr(r.data); state.loadError = '';
      // a machine tab whose machine no longer exists closes; one tab per machine stays the rule
      const keep = state.machineTabs.filter((n) => state.machines.some((m) => key(m.Name) === key(n)));
      if (keep.length !== state.machineTabs.length) { for (const n of state.machineTabs.filter((x) => !keep.includes(x))) closeMachineTab(n); }
    }
    else { if (state.machines === null) state.machines = []; state.loadError = 'Could not read the machine list: ' + r.error; }
    state.metas = await api.metas();
    renderAll(true);
  }
  async function loadHv() {
    const [a, b] = await Promise.all([cli('hv', {}), cli('hv', { hv: 'virtualbox' })]);
    state.hv = a; state.vbox = b;
    const chip = $('#hvchip');
    if (a.ok && a.data) chip.textContent = `${a.data.kind === 'vmware' ? 'VMware' : a.data.kind === 'virtualbox' ? 'VirtualBox' : a.data.kind} ${String(a.data.version || '').split(' ')[0]}` + (b.ok ? '' : ' · VirtualBox unusable');
    else chip.textContent = /^No usable hypervisor/i.test(a.error || '') ? a.error : 'No usable hypervisor: ' + (a.error || 'unknown');
    chip.title = (a.ok && a.data && a.data.reason) || a.error || '';
    return [a, b];
  }
  function reloadAll() { state.machines = null; renderMachines(); loadHv(); refreshMachines(); refreshReceipts(); refreshMedia(); }

  document.addEventListener('keydown', (e) => { if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && state.tab === 'machines') { e.preventDefault(); machineSearch.input.focus(); } });
  setInterval(() => { if (!document.hidden && state.jobs.size === 0 && (state.tab === 'machines' || state.tab === 'runner' || state.tab.startsWith('m:'))) refreshMachines(); if (!document.hidden && state.recovered.length) loadRecovered(false); }, 30000);

  (async function init() {
    state.settings = await api.settings();
    window.MVL.applyTheme(state.settings.theme, state.settings.reduceMotion);
    renderSettings(); renderTabs(); renderMachines(); renderReceipts(); renderMedia();
    loadHv(); refreshMachines(); refreshReceipts(); refreshMedia(); loadRecovered(true);
    setup.startIfNeeded(); setupState();
    window.__mvlReady = true;
  })();
})();
