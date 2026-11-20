'use strict';
// Bulk actions: selection, a floating Material 3 toolbar, a reviewable preview, sequential runs with
// per-item results, and the bulk surfaces for the notification centre and the tab strip.
//  - MVLBulk.selection(onChange) keeps the selected ids with click, shift-click ranges, select shown,
//    select every item, invert and clear.
//  - MVLBulk.bar({...}) is the floating toolbar; MVLBulk.review / MVLBulk.confirmDestructive say what will
//    happen before it happens; MVLBulk.run runs one item at a time and can stop after the current one.
//  - MVLBulk.showResults lists every item's result, skipped ones with their reason, and posts a summary.
//  - The notification centre gains search with the regex builder, multi-select, export of the selection
//    or the filtered list, and removal behind the super confirmation.
//  - MVLBulk.closeTabs opens a dialog that closes the tabs matching a search in one step.
(function (root) {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;

  // ---------- selection model ----------
  function selection(onChange) {
    const ids = new Set();
    let anchor = null;
    const changed = () => { if (onChange) onChange(); };
    return {
      has: (id) => ids.has(id),
      size: () => ids.size,
      ids: () => [...ids],
      list: (order) => order.filter((id) => ids.has(id)),
      // A plain click toggles one item; with shift it sets the whole range from the last clicked item.
      toggle(id, order, shift) {
        if (shift && anchor != null && order && order.includes(anchor) && order.includes(id)) {
          const a = order.indexOf(anchor), b = order.indexOf(id);
          const on = !ids.has(id) || ids.has(anchor);
          for (const x of order.slice(Math.min(a, b), Math.max(a, b) + 1)) { if (on) ids.add(x); else ids.delete(x); }
        } else if (ids.has(id)) ids.delete(id); else ids.add(id);
        anchor = id; changed();
      },
      add(list) { for (const x of list) ids.add(x); changed(); },
      set(list) { ids.clear(); for (const x of list) ids.add(x); changed(); },
      clear() { if (!ids.size) return; ids.clear(); anchor = null; changed(); },
      invert(order) { for (const x of order) { if (ids.has(x)) ids.delete(x); else ids.add(x); } changed(); },
      prune(valid) { let n = 0; for (const x of [...ids]) if (!valid.includes(x)) { ids.delete(x); n++; } if (n) changed(); return n; }
    };
  }

  // ---------- running ----------
  // fn(item) resolves { status: 'ok'|'failed'|'skipped', detail }. A thrown error counts as failed.
  async function run(items, fn, opts) {
    opts = opts || {};
    const results = [];
    for (let i = 0; i < items.length; i++) {
      if (opts.shouldStop && opts.shouldStop()) { for (const it of items.slice(i)) results.push({ item: it, status: 'cancelled', detail: 'Not started: the run was stopped before it.' }); break; }
      if (opts.onProgress) opts.onProgress(i, items.length, items[i]);
      let r;
      try { r = await fn(items[i], i); } catch (e) { r = { status: 'failed', detail: (e && e.message) || String(e) }; }
      results.push(Object.assign({ item: items[i] }, r || { status: 'ok' }));
    }
    if (opts.onProgress) opts.onProgress(items.length, items.length, null);
    return results;
  }
  function summarize(results) {
    const c = { ok: 0, failed: 0, skipped: 0, cancelled: 0 };
    for (const r of results) c[r.status] = (c[r.status] || 0) + 1;
    const parts = [];
    if (c.ok) parts.push(`${c.ok} done`);
    if (c.failed) parts.push(`${c.failed} failed`);
    if (c.skipped) parts.push(`${c.skipped} skipped`);
    if (c.cancelled) parts.push(`${c.cancelled} not started`);
    return Object.assign(c, { total: results.length, text: parts.join(', ') || 'nothing to do', kind: c.failed ? 'error' : c.ok ? 'success' : 'info' });
  }

  // ---------- sheets ----------
  function sheet(html, onMount) {
    const doc = root.document, prev = doc.activeElement;
    const scrim = doc.createElement('div'); scrim.className = 'scrim p1-scrim';
    scrim.innerHTML = `<div class="sheet p1-sheet" role="dialog" aria-modal="true">${html}</div>`;
    let done = false, onClose = null;
    const close = () => { if (done) return; done = true; scrim.remove(); if (prev && prev.isConnected && prev.focus) prev.focus(); if (onClose) onClose(); };
    scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) close(); });
    scrim.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      if (e.key === 'Tab') { const f = [...scrim.querySelectorAll('button, input, select, textarea, [tabindex="0"]')].filter((x) => !x.disabled && x.offsetParent !== null); if (!f.length) return; const i = f.indexOf(doc.activeElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); } }
    });
    (root.MVLExport ? root.MVLExport.host() : doc.body).append(scrim);
    const el = scrim.firstElementChild;
    const t = el.querySelector('h2'); if (t) { t.id = 'p1s' + Math.random().toString(36).slice(2, 7); el.setAttribute('aria-labelledby', t.id); }
    onMount(el, close, (f) => { onClose = f; });
    return close;
  }
  const listHtml = (rows, cls) => `<ul class="p1-plist ${cls || ''}">${rows.map((r) => `<li><strong>${esc(r.name)}</strong>${r.note ? `<span class="small">${esc(r.note)}</span>` : ''}</li>`).join('')}</ul>`;

  // Review a non-destructive batch: the exact count, every item that will change and every one skipped.
  function review(o) {
    return new Promise((resolve) => {
      sheet(`<span class="eyebrow">Bulk action</span><h2>${esc(o.title)}</h2>
<p class="p1-pcount">${esc(o.countText || `${plural(o.selected, 'selected')}${o.skip.length ? `, ${o.change.length} will change, ${o.skip.length} skipped` : `, all ${o.change.length} will change`}.`)}</p>
${o.change.length ? `<h3 class="p1-h3">Will change</h3>${listHtml(o.change)}` : '<p class="warn">Nothing in the selection can do this, so nothing will run.</p>'}
${o.skip.length ? `<h3 class="p1-h3">Skipped, and why</h3>${listHtml(o.skip.map((s) => ({ name: s.name, note: s.reason })), 'skip')}` : ''}
${o.form || ''}
${o.note ? `<p class="small">${esc(o.note)}</p>` : ''}
<div class="errbox" data-err hidden></div>
<div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-no>Cancel</button><button type="button" class="btn primary" data-yes ${o.change.length ? '' : 'disabled'}>${esc(o.confirmLabel || 'Run')}</button></div>`, (el, close, onClose) => {
        let answered = false;
        onClose(() => { if (!answered) resolve(false); });
        el.querySelector('[data-no]').addEventListener('click', close);
        el.querySelector('[data-yes]').addEventListener('click', () => {
          const err = el.querySelector('[data-err]');
          const bad = o.validate ? o.validate(el) : '';
          if (bad) { err.hidden = false; err.textContent = bad; return; }
          answered = true; resolve(o.read ? o.read(el) || true : true); close();
        });
        const first = el.querySelector('input, [data-yes]:not([disabled]), [data-no]'); if (first) first.focus();
        if (o.mount) o.mount(el);
      });
    });
  }
  // Destructive batches go through the two-key super confirmation listing every affected item.
  function confirmDestructive(o) {
    const lines = `${o.change.length} ${o.noun || 'item'}${o.change.length === 1 ? '' : 's'}: ${o.change.map((c) => c.name).join(', ')}. ${o.consequence || ''}${o.skip.length ? ` Skipped: ${o.skip.map((s) => s.name + ' (' + s.reason + ')').join('; ')}.` : ''}`;
    if (!o.change.length) { review(Object.assign({}, o, { selected: o.selected })); return Promise.resolve(false); }
    if (root.MVLSuperConfirm) return root.MVLExport.askSuper({ action: o.title, affected: lines.trim(), anchor: o.anchor });
    return review(Object.assign({}, o, { note: lines }));
  }

  // ---------- results ----------
  let resultsEl = null;
  function showResults(title, results, opts) {
    opts = opts || {};
    const doc = root.document;
    const s = summarize(results);
    if (resultsEl) resultsEl.remove();
    const el = doc.createElement('section');
    el.className = 'p1-results'; el.setAttribute('role', 'region'); el.setAttribute('aria-label', title + ' results');
    const pill = { ok: ['Done', 'lime'], failed: ['Failed', 'red'], skipped: ['Skipped', 'amber'], cancelled: ['Not started', 'amber'] };
    el.innerHTML = `<div class="row"><strong class="grow">${esc(title)}</strong><button type="button" class="iconbtn" data-close aria-label="Close the results">&times;</button></div>
<p class="small" role="status">${esc(s.text)} of ${esc(plural(s.total, 'item'))}.${opts.undoNote ? ' ' + esc(opts.undoNote) : ''}</p>
<ul class="p1-rlist">${results.map((r) => `<li><span class="pill ${pill[r.status][1]}">${pill[r.status][0]}</span><span class="grow"><strong>${esc(r.name || r.item)}</strong>${r.detail ? `<br><span class="small">${esc(r.detail)}</span>` : ''}</span></li>`).join('')}</ul>
${opts.undo ? `<div class="row"><button type="button" class="btn sm" data-undo>${esc(opts.undoLabel || 'Undo')}</button></div>` : ''}`;
    el.querySelector('[data-close]').addEventListener('click', () => { el.remove(); if (resultsEl === el) resultsEl = null; });
    if (opts.undo) el.querySelector('[data-undo]').addEventListener('click', () => { opts.undo(); el.remove(); });
    root.MVLExport.host().append(el);
    resultsEl = el;
    if (root.MVLNotify && !opts.quiet) root.MVLNotify.push({ kind: s.kind, title: `${title}: ${s.text}`, body: results.map((r) => `${r.name || r.item}: ${pill[r.status][0].toLowerCase()}${r.detail ? ' (' + r.detail + ')' : ''}`).join('\n') });
    return el;
  }

  // ---------- floating toolbar ----------
  // actions: [{ id, label, danger }]; counts(): { shown, all }; onSelect('shown'|'all'|'invert'|'none'); onAction(id)
  function bar(o) {
    const doc = root.document;
    const el = doc.createElement('div');
    el.className = 'p1-bulkbar'; el.setAttribute('role', 'toolbar'); el.setAttribute('aria-label', o.label || 'Bulk actions'); el.hidden = true;
    el.innerHTML = `<div class="p1-bb-top"><span class="p1-bb-count" role="status" aria-live="polite"></span><span class="grow"></span><button type="button" class="iconbtn" data-sel="none" aria-label="Clear the selection" title="Clear the selection (Escape)">&times;</button></div>
<div class="p1-bb-sel"><button type="button" class="btn sm light" data-sel="shown"></button><button type="button" class="btn sm light" data-sel="all"></button><button type="button" class="btn sm light" data-sel="invert">Invert</button></div>
<div class="p1-bb-acts">${o.actions.map((a) => `<button type="button" class="btn sm${a.danger ? ' danger' : a.primary ? ' primary' : ''}" data-act="${esc(a.id)}">${esc(a.label)}</button>`).join('')}</div>
<div class="p1-bb-prog" hidden><span class="small" role="status" data-prog></span><button type="button" class="btn sm" data-stop>Stop after this one</button></div>`;
    let running = false, stop = false;
    el.addEventListener('click', (e) => {
      const s = e.target.closest('[data-sel]'); if (s && !running) { o.onSelect(s.dataset.sel); return; }
      const a = e.target.closest('[data-act]'); if (a && !running) { o.onAction(a.dataset.act, a); return; }
      if (e.target.closest('[data-stop]')) { stop = true; el.querySelector('[data-prog]').textContent += ' Stopping after this one.'; e.target.closest('[data-stop]').disabled = true; }
    });
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !running) { e.stopPropagation(); o.onSelect('none'); } });
    (o.host || doc.body).append(el);
    const api = {
      el,
      update(size) {
        const c = o.counts();
        el.hidden = size === 0 && !running;
        el.querySelector('.p1-bb-count').textContent = `${plural(size, o.noun || 'item')} selected`;
        const shown = el.querySelector('[data-sel=shown]'), all = el.querySelector('[data-sel=all]');
        shown.textContent = `Select the ${c.shown} shown`;
        all.textContent = `Select every ${o.noun || 'item'} (${c.all})`;
        all.hidden = c.all === c.shown;
        shown.title = c.all === c.shown ? 'Every item is shown, so this selects them all' : 'Only the items the current search and filter show';
      },
      // Locks the bar while a batch runs; returns { progress(text), stopped(), done() }.
      busy() {
        running = true; stop = false; el.hidden = false; el.classList.add('running');
        const p = el.querySelector('.p1-bb-prog'); p.hidden = false; el.querySelector('[data-stop]').disabled = false;
        for (const b of el.querySelectorAll('[data-act], [data-sel]')) b.disabled = true;
        return {
          progress: (t) => { el.querySelector('[data-prog]').textContent = t + (stop ? ' Stopping after this one.' : ''); },
          stopped: () => stop,
          done: () => { running = false; el.classList.remove('running'); p.hidden = true; for (const b of el.querySelectorAll('[data-act], [data-sel]')) b.disabled = false; }
        };
      }
    };
    return api;
  }

  // A checkbox for one item, 48px target; data-sel-id carries the id.
  const checkbox = (id, name, on) => `<label class="p1-check" title="Select ${esc(name)}"><input type="checkbox" data-sel-id="${esc(id)}" aria-label="Select ${esc(name)}"${on ? ' checked' : ''}><span aria-hidden="true"></span></label>`;

  // ---------- notification centre ----------
  function enhanceCentre() {
    const doc = root.document;
    if (!root.MVLNotify || !root.MVL || !root.MVL.makeSearch) return;
    const sel = selection(() => draw());
    let search = null, dlg = null;
    const visibleIds = () => root.MVLNotify.list().filter((n) => matches(n)).map((n) => n.id);
    const matches = (n) => !search || !search.active() || search.invalid() ? !(search && search.invalid()) : !!search.test([n.title, n.body, n.kind, n.at].join(' '));
    function draw() {
      if (!dlg) return;
      const all = root.MVLNotify.list();
      sel.prune(all.map((n) => n.id));
      const shownIds = visibleIds();
      for (const li of dlg.querySelectorAll('.notify-item')) {
        const drop = li.querySelector('[data-n-act=drop]'); const id = drop && drop.dataset.id; if (!id) continue;
        let box = li.querySelector('[data-sel-id]');
        if (!box) { li.insertAdjacentHTML('afterbegin', checkbox(id, (li.querySelector('strong') || {}).textContent || 'notification', sel.has(id))); box = li.querySelector('[data-sel-id]'); }
        box.checked = sel.has(id);
        li.hidden = !shownIds.includes(id);
        li.classList.toggle('p1-selected', sel.has(id));
      }
      const bar2 = dlg.querySelector('.p1-ncbar'); if (!bar2) return;
      const n = sel.size();
      const exportN = n ? n : shownIds.length;
      bar2.querySelector('[data-nc=count]').textContent = search && search.active() ? `${shownIds.length} of ${all.length} match. ${n} selected.` : `${all.length} notification${all.length === 1 ? '' : 's'}. ${n} selected.`;
      bar2.querySelector('[data-nc=shown]').textContent = search && search.active() ? `Select the ${shownIds.length} matching` : `Select all ${shownIds.length}`;
      bar2.querySelector('[data-nc=export]').textContent = n ? `Export ${n} selected` : search && search.active() ? `Export the ${exportN} matching` : `Export all ${exportN}`;
      bar2.querySelector('[data-nc=export]').disabled = !exportN;
      bar2.querySelector('[data-nc=remove]').textContent = `Remove ${n} selected`;
      bar2.querySelector('[data-nc=remove]').disabled = !n;
      bar2.querySelector('[data-nc=invert]').disabled = !shownIds.length;
      bar2.querySelector('[data-nc=none]').disabled = !n;
      const empty = dlg.querySelector('.p1-nc-nomatch');
      if (empty) empty.hidden = !(search && search.active() && !shownIds.length && all.length);
    }
    function inject() {
      if (!dlg || dlg.querySelector('.p1-ncbar')) { draw(); return; }
      const actions = dlg.querySelector('[data-n-act=read]'); const row = actions && actions.closest('.row');
      if (!row) return;
      if (!search) search = root.MVL.makeSearch({ placeholder: 'Search notifications', label: 'Search notifications', onChange: () => draw() });
      const box = doc.createElement('div'); box.className = 'p1-ncbar';
      box.innerHTML = '<div class="p1-nc-search"></div><p class="small" data-nc="count" role="status"></p><div class="row"><button type="button" class="btn sm light" data-nc="shown"></button><button type="button" class="btn sm light" data-nc="invert">Invert</button><button type="button" class="btn sm light" data-nc="none">Clear selection</button></div><div class="row"><button type="button" class="btn sm" data-nc="export"></button><button type="button" class="btn sm danger" data-nc="remove"></button></div><p class="small p1-nc-nomatch" hidden>No notification matches this search. Clear the search to see them all.</p>';
      box.querySelector('.p1-nc-search').append(search.el);
      row.after(box);
      draw();
    }
    async function act(kind) {
      const all = root.MVLNotify.list();
      const shownIds = visibleIds();
      if (kind === 'shown') sel.add(shownIds);
      if (kind === 'invert') sel.invert(shownIds);
      if (kind === 'none') sel.clear();
      if (kind === 'export') {
        const ids = sel.size() ? sel.ids() : shownIds;
        const rows = all.filter((n) => ids.includes(n.id)).map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, at: n.at, read: !!n.read }));
        if (root.MVLExport) root.MVLExport.open({ title: 'Notifications', name: 'notifications', schema: 'mvl.notifications/1', rows, scope: sel.size() ? `${rows.length} selected` : search && search.active() ? `matching "${search.term()}"` : 'every notification' });
      }
      if (kind === 'remove') {
        const ids = sel.ids();
        const change = all.filter((n) => ids.includes(n.id)).map((n) => ({ name: n.title }));
        const ok = await confirmDestructive({ title: `Remove ${plural(change.length, 'notification')}`, noun: 'notification', change, skip: [], selected: ids.length, consequence: 'Removed notifications cannot be brought back.' });
        if (!ok || !dlg) return;
        let removed = 0;
        for (const id of ids) { const b = dlg.querySelector(`[data-n-act=drop][data-id="${CSS.escape(id)}"]`); if (b) { b.click(); removed++; } }
        sel.clear();
        if (root.MVL.toast) root.MVL.toast(`Removed ${plural(removed, 'notification')}`, 'success');
      }
    }
    function attach(d) {
      if (d.dataset.p1Bulk) return;
      dlg = d; d.dataset.p1Bulk = '1';
      new MutationObserver(() => { if (!d.querySelector('.p1-ncbar')) inject(); }).observe(d, { childList: true });
      d.addEventListener('click', (e) => {
        const b = e.target.closest('[data-nc]'); if (b && b.tagName === 'BUTTON') { e.stopPropagation(); act(b.dataset.nc); return; }
        const c = e.target.closest('[data-sel-id]'); if (c) { sel.toggle(c.dataset.selId, visibleIds(), e.shiftKey); setTimeout(draw); }
      }, true);
      d.addEventListener('keydown', (e) => {
        const typing = /^(TEXTAREA|SELECT)$/.test(e.target.tagName) || (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox');
        if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A') && !typing) { e.preventDefault(); sel.add(visibleIds()); }
      });
      if (root.MVLNotify.onChange) root.MVLNotify.onChange(() => draw());
      inject();
    }
    const found = doc.getElementById('notifyCentre'); if (found) attach(found);
    new MutationObserver(() => { const d = doc.getElementById('notifyCentre'); if (d) attach(d); }).observe(doc.body, { childList: true });
  }

  // ---------- close tabs in bulk ----------
  // o: { tabs: () => [{ id, label, group }], close(id), reopen(ids) }
  function closeTabs(o) {
    const sel = selection(() => draw());
    let search = null, list = null, el = null;
    const tabs = () => o.tabs();
    const shown = () => tabs().filter((t) => !search || !search.active() || (!search.invalid() && !!(search.test(t.label) || (t.group && search.test(t.group)))));
    function draw() {
      if (!el) return;
      const sh = shown(), all = tabs();
      sel.prune(all.map((t) => t.id));
      list.innerHTML = sh.length ? sh.map((t) => `<li class="${sel.has(t.id) ? 'p1-selected' : ''}">${checkbox(t.id, t.label, sel.has(t.id))}<span class="grow"><strong>${esc(t.label)}</strong>${t.group ? `<span class="small"> · ${esc(t.group)}</span>` : ''}</span></li>`).join('')
        : `<li class="p1-empty">${search && search.invalid() ? 'That regex pattern is not valid yet, so no tab is listed.' : all.length ? 'No open tab matches this search.' : 'No tab is open.'}</li>`;
      el.querySelector('[data-t=count]').textContent = `${sh.length} of ${all.length} open tabs shown, ${sel.size()} selected.`;
      el.querySelector('[data-t=match]').textContent = search && search.active() ? `Select the ${sh.length} matching` : `Select all ${sh.length}`;
      el.querySelector('[data-t=match]').disabled = !sh.length;
      const go = el.querySelector('[data-t=go]'); go.textContent = `Close ${plural(sel.size(), 'tab')}`; go.disabled = !sel.size();
    }
    sheet(`<span class="eyebrow">Tabs</span><h2>Close tabs in bulk</h2><p class="small">Search with plain text or a regex, pick the tabs, close them together. Closed pages reopen from New tab or Open every tab.</p><div data-t="search"></div><p class="small" data-t="count" role="status"></p>
<div class="row"><button type="button" class="btn sm light" data-t="match"></button><button type="button" class="btn sm light" data-t="invert">Invert</button><button type="button" class="btn sm light" data-t="none">Clear selection</button></div>
<ul class="p1-tlist" aria-label="Open tabs"></ul>
<div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-t="cancel">Cancel</button><button type="button" class="btn primary" data-t="go"></button></div>`, (sheetEl, close) => {
      el = sheetEl; list = el.querySelector('.p1-tlist');
      search = root.MVL.makeSearch({ placeholder: 'Search open tabs', label: 'Search open tabs', onChange: () => draw() });
      el.querySelector('[data-t=search]').append(search.el);
      el.addEventListener('click', (e) => {
        const c = e.target.closest('[data-sel-id]'); if (c) { const id = c.dataset.selId; sel.toggle(id, shown().map((t) => t.id), e.shiftKey); setTimeout(() => { draw(); const again = list.querySelector(`[data-sel-id="${CSS.escape(id)}"]`); if (again) again.focus(); }); return; }
        const b = e.target.closest('[data-t]'); if (!b || b.tagName !== 'BUTTON') return;
        if (b.dataset.t === 'match') sel.add(shown().map((t) => t.id));
        if (b.dataset.t === 'invert') sel.invert(shown().map((t) => t.id));
        if (b.dataset.t === 'none') sel.clear();
        if (b.dataset.t === 'cancel') close();
        if (b.dataset.t === 'go') {
          const ids = sel.list(tabs().map((t) => t.id));
          const names = new Map(tabs().map((t) => [t.id, t.label]));
          const results = ids.map((id) => { try { o.close(id); return { item: id, name: names.get(id), status: 'ok' }; } catch (err) { return { item: id, name: names.get(id), status: 'failed', detail: err.message }; } });
          close();
          showResults('Close tabs', results, { quiet: true, undo: o.reopen ? () => o.reopen(ids) : null, undoLabel: 'Reopen them', undoNote: 'Closed tabs reopen from New tab, or with the button below.' });
        }
      });
      draw();
      search.input.focus();
    });
  }

  root.MVLBulk = { selection, run, summarize, review, confirmDestructive, showResults, bar, checkbox, closeTabs, sheet };
  if (root.document) { const start = () => enhanceCentre(); if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start); else start(); }
})(typeof window !== 'undefined' ? window : globalThis);
