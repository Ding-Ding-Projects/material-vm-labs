'use strict';
// Tab strip memory and the New tab catalog, shared by every companion that has a tab strip.
// - store(surface, pages): every page starts open in page order on a fresh install; after an update
//   only pages the strip has never offered open (once); a page the user closed stays closed across
//   restarts until the catalog or "Open every tab" reopens it.
// - catalog(o): a searchable dialog of every destination, with the shared plain text and regex search.
(function () {
  const get = (k) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } };
  const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable: lasts for this session */ } };

  function store(surface, pages) {
    const key = 'mvl.tabs.' + surface;
    const saved = get(key);
    const order = pages.slice();
    let s;
    if (!saved || !Array.isArray(saved.known)) s = { known: order.slice(), open: order.slice(), extra: [], active: order[0] };
    else {
      const fresh = order.filter((p) => !saved.known.includes(p)); // offered for the first time by this version
      const open = order.filter((p) => (Array.isArray(saved.open) && saved.open.includes(p)) || fresh.includes(p));
      s = { known: [...new Set(saved.known.concat(fresh))], open, extra: Array.isArray(saved.extra) ? saved.extra.filter((x) => typeof x === 'string') : [], active: saved.active };
    }
    const save = () => put(key, s);
    save();
    return {
      pages: order,
      isOpen: (p) => s.open.includes(p),
      openPages: () => order.filter((p) => s.open.includes(p)),
      closedPages: () => order.filter((p) => !s.open.includes(p)),
      open(p) { if (!s.open.includes(p)) { s.open.push(p); s.open = order.filter((x) => s.open.includes(x)); save(); } },
      close(p) { s.open = s.open.filter((x) => x !== p); save(); },
      openAll() { s.open = order.slice(); save(); },
      extra: () => s.extra.slice(),
      setExtra(list) { s.extra = list.slice(); save(); },
      active: () => s.active,
      setActive(id) { s.active = id; save(); }
    };
  }

  // o: { title, items: [{ id, label, group, icon (svg html), state }], onPick(id), onOpenAll, closedCount }
  function catalog(o) {
    const { esc, makeSearch } = window.MVL;
    const prev = document.activeElement;
    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.innerHTML = `<div class="sheet tabcat" role="dialog" aria-modal="true" aria-labelledby="tabcatTitle"><div class="row"><h2 id="tabcatTitle" class="grow"></h2><button type="button" class="iconbtn" data-x aria-label="Close the catalog">&times;</button></div><div data-search></div><div class="row" data-allrow><span class="small grow" data-count></span><button type="button" class="btn sm" data-all>Open every tab</button></div><div class="tabcat-list" role="listbox" aria-labelledby="tabcatTitle" tabindex="-1"></div></div>`;
    const el = scrim.firstElementChild;
    el.querySelector('h2').textContent = o.title || 'New tab';
    const list = el.querySelector('.tabcat-list');
    const search = makeSearch({ placeholder: 'Search pages and machines', label: 'Search the tab catalog', onChange: () => render() });
    el.querySelector('[data-search]').append(search.el);
    let closed = false;
    const close = () => { if (closed) return; closed = true; scrim.remove(); if (prev && prev.isConnected && prev.focus) prev.focus(); };
    let shown = [];
    function render() {
      const items = o.items();
      if (search.invalid()) { list.innerHTML = '<div class="errbox">That regex pattern is not valid, so nothing was filtered.</div>'; shown = []; return; }
      shown = search.active() ? items.filter((i) => search.test(i.label + ' ' + (i.group || '') + ' ' + (i.state || ''))) : items;
      if (search.active()) search.setStatus(shown.length + ' of ' + items.length + ' destinations');
      const closedN = items.filter((i) => i.closed).length;
      el.querySelector('[data-count]').textContent = closedN ? closedN + ' closed tab' + (closedN === 1 ? '' : 's') : 'Every tab is open';
      el.querySelector('[data-all]').disabled = !closedN;
      let group = null, h = '';
      shown.forEach((i, n) => {
        if (i.group !== group) { group = i.group; h += `<div class="tabcat-group" role="presentation">${esc(group || '')}</div>`; }
        h += `<button type="button" class="tabcat-item" role="option" aria-selected="false" data-id="${esc(i.id)}" data-n="${n}" tabindex="${n === 0 ? 0 : -1}">${i.icon || ''}<span class="grow">${esc(i.label)}</span><span class="pill ${i.closed ? 'amber' : 'lime'}">${esc(i.state || (i.closed ? 'Closed' : 'Open'))}</span></button>`;
      });
      list.innerHTML = h || '<div class="empty"><h2>No destination matches</h2><p>Try fewer words, or switch search mode.</p></div>';
    }
    function pick(id) { close(); o.onPick(id); }
    list.addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); if (b) pick(b.dataset.id); });
    list.addEventListener('keydown', (e) => {
      const btns = [...list.querySelectorAll('[data-id]')]; const i = btns.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length]; if (n) { btns.forEach((b) => { b.tabIndex = -1; b.setAttribute('aria-selected', 'false'); }); n.tabIndex = 0; n.setAttribute('aria-selected', 'true'); n.focus(); } }
      if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); const n = e.key === 'Home' ? btns[0] : btns[btns.length - 1]; if (n) n.focus(); }
    });
    search.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { const f = list.querySelector('[data-id]'); if (f) { e.preventDefault(); f.focus(); } }
      if (e.key === 'Enter') { const f = list.querySelector('[data-id]'); if (f && search.active()) { e.preventDefault(); pick(f.dataset.id); } }
    });
    el.querySelector('[data-x]').addEventListener('click', close);
    el.querySelector('[data-all]').addEventListener('click', () => { close(); o.onOpenAll(); });
    scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) close(); });
    scrim.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      if (e.key === 'Tab') { const f = [...scrim.querySelectorAll('button,input,[tabindex="0"]')].filter((x) => !x.disabled && x.offsetParent !== null); if (!f.length) return; const first = f[0], last = f[f.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
    });
    document.body.append(scrim);
    render();
    search.input.focus();
    return { close, search };
  }

  window.MVLTabs = { store, catalog };
})();
