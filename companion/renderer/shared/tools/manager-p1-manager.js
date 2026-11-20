'use strict';
// Manager wiring for the manager-p1 lane: exports of the machine list, one machine, receipts, media
// information and settings; multi-select with a bulk toolbar on machine cards and receipts; bulk tab
// closing; and the manager's own settings in the settings history. app.js passes its helpers in.
(function (root) {
  function create(d) {
    const { esc, key } = d;
    const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
    const toast = (m, k) => root.MVL.toast(m, k);

    // ---------- export rows (no secrets: guest passwords and tokens are never in these objects) ----------
    function machineRow(m) {
      const meta = d.state.metas[key(m.Name)] || {};
      const share = d.shareOf(m);
      return {
        name: m.Name, project: m.Project || '', system: m.OS || 'windows', hypervisor: m.Hypervisor || '', hypervisorVersion: meta.hypervisorVersion || '',
        status: m.Status || '', power: m.Power || '', state: d.plan(m).pill[0], network: m.Network || '', ip: m.IP || '', guestUser: m.User || meta.userName || '',
        owner: d.OWNERS[d.ownerOf(m)], sharedFolder: share ? { hostPath: share.hostPath, guestPath: share.guestPath || '' } : null,
        memoryMB: meta.memoryMB || null, cpus: meta.cpus || null, diskGB: meta.diskGB || null, secureBoot: meta.secureBoot == null ? null : !!meta.secureBoot,
        usesDefaultPassword: meta.defaultPassword == null ? null : meta.defaultPassword === true, runnersOnDuty: Number(m.Runners) || 0,
        runners: (meta.runners || []).map((r) => ({ repository: r.repo || '', labels: r.labels || '' })), baseline: m.Baseline || '', created: m.Created || ''
      };
    }
    const receiptRow = (r) => JSON.parse(JSON.stringify(r));
    // A receipt's id: its run id, or (for a receipt written without one) its repository, commit and finish time.
    const rid = (r) => String(r.runId || [r.repository || r.repo || '', r.commit || '', r.finishedUtc || ''].join('@'));
    function filterNote() {
      const parts = [];
      if (d.state.filter !== 'all') parts.push(d.state.filter === 'running' ? 'running only' : 'runners only');
      const s = d.machineSearch();
      if (s.active()) parts.push(`${s.isRegex() ? 'regex' : 'search'} "${s.term()}"`);
      return parts.length ? 'filtered: ' + parts.join(', ') : 'every machine';
    }
    function exportMachines(names, scope) {
      const ms = d.state.machines || [];
      const list = names ? ms.filter((m) => names.includes(key(m.Name))) : d.visibleMachines();
      root.MVLExport.open({ title: 'Machines', name: 'machines', schema: 'mvl.machines/1', rows: list.map(machineRow), scope: scope || filterNote() });
    }
    function exportMachine(name) {
      const m = (d.state.machines || []).find((x) => key(x.Name) === key(name));
      if (!m) { toast('That machine is not in the list any more.', 'error'); return; }
      const row = machineRow(m);
      row.receipts = d.receiptsFor(m.Name).map(receiptRow);
      root.MVLExport.open({ title: `Machine ${m.Name}`, name: 'machine-' + m.Name, schema: 'mvl.machine/1', rows: [row], scope: 'one machine with its receipts' });
    }
    function exportReceipts(ids, scope) {
      const s = d.recSearch();
      let rs = d.state.receipts;
      if (ids) rs = rs.filter((r) => ids.includes(rid(r)));
      else if (s.active() && !s.invalid()) rs = rs.filter((r) => s.test(d.receiptText(r)));
      root.MVLExport.open({ title: 'Receipts', name: 'receipts', schema: 'mvl.receipts/1', rows: rs.map(receiptRow), scope: scope || (s.active() ? `matching "${s.term()}"` : 'every receipt') + (d.state.receiptsDir ? ' in ' + d.state.receiptsDir : '') });
    }
    function exportMedia() {
      const m = d.state.media;
      if (!m) { toast('The media folder has not been read yet.', 'error'); return; }
      const rows = (m.receipts || []).map((r) => ({ entry: 'verified download', file: r.file || r.name || '', sha256: r.sha256 || '', source: r.host || '', bytes: null, folder: m.dir || '' }))
        .concat((m.files || []).map((f) => ({ entry: 'file on disk', file: f.name, sha256: '', source: '', bytes: f.bytes, folder: m.dir || '' })));
      root.MVLExport.open({ title: 'Media', name: 'media', schema: 'mvl.media/1', rows, scope: 'the evaluation media folder' + (m.dir ? ' ' + m.dir : '') });
    }

    // ---------- machine selection and the bulk toolbar ----------
    const sel = root.MVLBulk.selection(() => syncCards());
    const order = () => d.visibleMachines().map((m) => key(m.Name));
    const byKey = (k) => (d.state.machines || []).find((m) => key(m.Name) === k);
    const bar = root.MVLBulk.bar({
      label: 'Bulk actions for machines', noun: 'machine',
      actions: [{ id: 'start', label: 'Start' }, { id: 'stop', label: 'Stop' }, { id: 'reset', label: 'Reset', danger: true }, { id: 'fresh', label: 'Fresh build' }, { id: 'export', label: 'Export selection' }, { id: 'destroy', label: 'Destroy', danger: true }],
      counts: () => ({ shown: order().length, all: (d.state.machines || []).length }),
      onSelect: (k) => { if (k === 'shown') sel.add(order()); if (k === 'all') sel.add((d.state.machines || []).map((m) => key(m.Name))); if (k === 'invert') sel.invert(order()); if (k === 'none') sel.clear(); },
      onAction: (id, btn) => bulk(id, btn)
    });
    function syncCards() {
      const cards = d.P.machines.querySelectorAll('.mcard');
      for (const c of cards) { const box = c.querySelector('[data-sel-id]'); if (!box) continue; const on = sel.has(box.dataset.selId); box.checked = on; c.classList.toggle('p1-selected', on); }
      bar.update(sel.size());
      const row = d.P.machines.querySelector('.p1-selrow');
      if (row) { const n = order().length; row.querySelector('[data-p1sel]').textContent = `Select the ${n} shown`; row.querySelector('[data-p1sel]').disabled = !n; row.hidden = !(d.state.machines || []).length; }
      bar.el.hidden = sel.size() === 0 || d.state.tab !== 'machines';
    }
    const cardCheck = (name) => root.MVLBulk.checkbox(key(name), name, sel.has(key(name)));
    function afterRender() {
      if (d.state.machines) sel.prune(d.state.machines.map((m) => key(m.Name)));
      let row = d.P.machines.querySelector('.p1-selrow');
      if (!row) {
        row = root.document.createElement('div'); row.className = 'p1-selrow';
        row.innerHTML = '<button type="button" class="btn sm light" data-p1sel="shown"></button><span class="small">Tick machines to act on several at once. Shift-click selects a range; Ctrl+A selects every shown machine; Escape clears.</span>';
        const cards = d.P.machines.querySelector('#gCards'); cards.before(row);
        row.querySelector('[data-p1sel]').addEventListener('click', () => sel.add(order()));
      }
      syncCards();
    }
    d.P.machines.addEventListener('click', (e) => { const c = e.target.closest('.mcard [data-sel-id]'); if (c) { sel.toggle(c.dataset.selId, order(), e.shiftKey); setTimeout(syncCards); } });
    d.P.machines.addEventListener('keydown', (e) => {
      const inCards = e.target.closest && e.target.closest('#gCards');
      if (inCards && (e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); sel.add(order()); }
      if (inCards && e.key === 'Escape' && sel.size()) { e.preventDefault(); sel.clear(); }
    });

    const REPO_RE = d.REPO_RE;
    async function bulk(id, btn) {
      const picked = sel.list((d.state.machines || []).map((m) => key(m.Name))).map(byKey).filter(Boolean);
      if (!picked.length) return;
      if (id === 'export') { exportMachines(picked.map((m) => key(m.Name)), `${picked.length} selected`); return; }
      const change = [], skip = [];
      for (const m of picked) {
        const busy = d.state.busy.has(key(m.Name)), ready = m.Status === 'ready', on = m.Power === 'running';
        let why = '';
        if (busy) why = 'Busy with another operation.';
        else if (id === 'start') why = !ready ? `Not ready (${m.Status || 'unknown'}).` : on ? 'Already running.' : '';
        else if (id === 'stop') why = !ready ? `Not ready (${m.Status || 'unknown'}).` : !on ? 'Already off.' : '';
        else if (id === 'reset') why = !ready ? `Not ready (${m.Status || 'unknown'}).` : '';
        else if (id === 'fresh') why = d.isLinux(m) ? 'Fresh builds run on Windows machines only.' : !ready ? `Not ready (${m.Status || 'unknown'}).` : '';
        if (why) skip.push({ name: m.Name, reason: why }); else change.push({ name: m.Name, note: m.Power === 'running' ? 'Running' : 'Off', m });
      }
      const L = { start: 'Start', stop: 'Stop', reset: 'Reset to the clean baseline', fresh: 'Fresh build', destroy: 'Destroy' };
      let opts = null;
      if (id === 'reset' || id === 'destroy') {
        const ok = await root.MVLBulk.confirmDestructive({
          title: `${L[id]}: ${plural(change.length, 'machine')}`, noun: 'machine', change, skip, selected: picked.length, anchor: btn,
          consequence: id === 'reset' ? 'Everything done inside each one since its clean baseline is discarded: files, programs and settings in the guest. This cannot be undone.' : 'Each one is destroyed for good: its virtual machine, disk, snapshots, saved guest credential and runner registrations. Shared folders on this PC are kept. This cannot be undone.'
        });
        if (!ok) return;
      } else {
        const form = id === 'fresh' ? `<label class="field">Repository<input data-b="repo" class="mono" placeholder="owner/name" autocomplete="off" spellcheck="false"></label><label class="field">Ref (optional commit or branch)<input data-b="ref" class="mono" autocomplete="off" spellcheck="false"></label><div class="seg sm" role="group" aria-label="Entrypoints">${[['build', 'build.bat /s'], ['build-installer', 'build-installer.bat /s'], ['build,build-installer', 'both']].map(([v, l], i) => `<button type="button" data-be="${v}" aria-pressed="${i === 0}">${l}</button>`).join('')}</div><label class="row" style="gap:6px"><input type="checkbox" data-b="noreset"> Keep the current state (no reset)</label>` : '';
        opts = await root.MVLBulk.review({
          title: `${L[id]}: ${plural(change.length, 'machine')}`, selected: picked.length, change: change.map((c) => ({ name: c.name, note: c.note })), skip, form,
          confirmLabel: `${L[id]} ${plural(change.length, 'machine')}`,
          note: id === 'stop' ? 'Each guest is asked to shut down; after 5 minutes it is powered off. Anything not saved inside it is lost. These run one after another and change real machines, so they cannot be undone from history.' : 'These run one after another and change real machines, so they cannot be undone from history.',
          mount: (el) => el.addEventListener('click', (e) => { const b = e.target.closest('[data-be]'); if (b) for (const x of el.querySelectorAll('[data-be]')) x.setAttribute('aria-pressed', String(x === b)); }),
          validate: (el) => (id === 'fresh' && !REPO_RE.test(el.querySelector('[data-b=repo]').value.trim()) ? 'Enter the repository as owner/name.' : ''),
          read: (el) => (id === 'fresh' ? { repo: el.querySelector('[data-b=repo]').value.trim(), ref: el.querySelector('[data-b=ref]').value.trim(), entry: (el.querySelector('[data-be][aria-pressed="true"]') || {}).dataset.be || 'build', noReset: el.querySelector('[data-b=noreset]').checked } : null)
        });
        if (!opts) return;
      }
      const busy = bar.busy();
      const results = await root.MVLBulk.run(change, async (c, i) => {
        busy.progress(`${L[id]} ${i + 1} of ${change.length}: ${c.name}`);
        const name = c.m.Name, hold = { hold: key(name) };
        let r;
        if (id === 'start') r = await d.startJob(`Start ${name}`, 'start', { name }, hold);
        if (id === 'stop') r = await d.startJob(`Stop ${name}`, 'stop', { name }, hold);
        if (id === 'reset') r = await d.startJob(`Reset ${name}`, 'reset', { name }, hold);
        if (id === 'destroy') r = await d.startJob(`Destroy ${name}`, 'rm', { name }, Object.assign(hold, { after: (x) => { if (x.ok) d.closeMachineTab(name); } }));
        if (id === 'fresh') r = await d.startJob(`Fresh build ${opts.repo} on ${name}`, 'build', { name, repo: opts.repo, ref: opts.ref, entry: opts.entry, noReset: opts.noReset }, Object.assign(hold, { after: d.refreshReceipts }));
        return { name, status: r.ok ? 'ok' : r.cancelled ? 'cancelled' : 'failed', detail: r.ok ? '' : r.error };
      }, { shouldStop: busy.stopped });
      busy.done();
      const all = results.map((r) => Object.assign(r, { name: r.name || r.item.name })).concat(skip.map((s) => ({ name: s.name, status: 'skipped', detail: s.reason })));
      root.MVLBulk.showResults(`${L[id]} in bulk`, all, { undoNote: 'Machine operations cannot be undone from history.' });
      syncCards();
    }

    // ---------- receipts selection ----------
    const rsel = root.MVLBulk.selection(() => syncReceipts());
    const rorder = () => [...d.P.receipts.querySelectorAll('#rList [data-sel-id]')].map((b) => b.dataset.selId);
    const rbar = root.MVLBulk.bar({
      label: 'Bulk actions for receipts', noun: 'receipt',
      actions: [{ id: 'export', label: 'Export selection', primary: true }, { id: 'copy', label: 'Copy run ids' }],
      counts: () => ({ shown: rorder().length, all: d.state.receipts.length }),
      onSelect: (k) => { if (k === 'shown') rsel.add(rorder()); if (k === 'all') rsel.add(d.state.receipts.map(rid)); if (k === 'invert') rsel.invert(rorder()); if (k === 'none') rsel.clear(); },
      onAction: (id) => { const ids = rsel.ids(); if (id === 'export') exportReceipts(ids, `${ids.length} selected`); if (id === 'copy') root.MVLExport.copy(ids.join('\n')).then((ok) => toast(ok ? `Copied ${plural(ids.length, 'run id')}` : 'The clipboard is not available here', ok ? 'success' : 'error')); }
    });
    function syncReceipts() {
      rsel.prune(d.state.receipts.map(rid));
      for (const b of d.P.receipts.querySelectorAll('#rList [data-sel-id]')) { b.checked = rsel.has(b.dataset.selId); const c = b.closest('.rlist-sel'); if (c) c.classList.toggle('p1-selected', b.checked); }
      rbar.update(rsel.size());
      rbar.el.hidden = rsel.size() === 0 || d.state.tab !== 'receipts';
    }
    // Wraps each rendered receipt card with its checkbox.
    function afterReceipts() {
      const cards = [...d.P.receipts.querySelectorAll('#rList > article.card')];
      const shown = receiptsShown();
      cards.forEach((card, i) => {
        const r = shown[i]; if (!r) return;
        const wrap = root.document.createElement('div'); wrap.className = 'rlist-sel';
        card.replaceWith(wrap); wrap.innerHTML = root.MVLBulk.checkbox(rid(r), 'receipt ' + (r.runId || rid(r)), rsel.has(rid(r))); wrap.append(card);
      });
      syncReceipts();
    }
    function receiptsShown() { const s = d.recSearch(); return s.active() && !s.invalid() ? d.state.receipts.filter((r) => s.test(d.receiptText(r))) : d.state.receipts; }
    d.P.receipts.addEventListener('click', (e) => { const c = e.target.closest('#rList [data-sel-id]'); if (c) { rsel.toggle(c.dataset.selId, rorder(), e.shiftKey); setTimeout(syncReceipts); } });

    // ---------- tabs ----------
    function closeTabsDialog() {
      root.MVLBulk.closeTabs({
        tabs: () => d.tabItems().map((t) => ({ id: t.id, label: t.label, group: t.id.startsWith('m:') ? 'Machine' : 'Page' })),
        close: (id) => d.closeTab(id),
        reopen: (ids) => { for (const id of ids) { if (id.startsWith('m:')) d.openMachine(id.slice(2)); else d.selectTab(id); } toast(`Reopened ${plural(ids.length, 'tab')}`); }
      });
    }

    // ---------- settings history: the manager's own settings ----------
    if (root.MVLHistory) {
      root.MVLHistory.field('theme', { apply: (v) => d.saveSettings({ theme: v }) });
      root.MVLHistory.field('reduceMotion', { apply: (v) => d.saveSettings({ reduceMotion: !!v }).then(() => root.MVLMotion && root.MVLMotion.apply()) });
      root.MVLHistory.field('defaultNet', { label: 'Default network', read: () => (d.state.settings ? d.state.settings.defaultNet || 'nat' : undefined), apply: (v) => d.saveSettings({ defaultNet: String(v) }), fmt: (v) => ({ nat: 'NAT', bridged: 'Bridged', hostonly: 'Host-only' }[v] || v) });
      root.MVLHistory.field('stateRoot', {
        label: 'State root', read: () => (d.state.settings ? d.state.settings.stateRoot || '' : undefined), fmt: (v) => (v ? v : 'the default folder'),
        apply: async (v) => { v = String(v || ''); if (/[<>|"*?]/.test(v) || v.length > 400) throw new Error('That path has characters a Windows folder cannot contain.'); await d.saveSettings({ stateRoot: v }); d.reloadAll(); }
      });
    }

    // ---------- context menus and palette ----------
    if (root.MVLContext) {
      root.MVLContext.register('.mcard', (card) => {
        const box = card.querySelector('[data-sel-id]'); if (!box) return [];
        const m = byKey(box.dataset.selId); if (!m) return [];
        return [{ label: sel.has(key(m.Name)) ? 'Remove from the selection' : 'Add to the selection', shortcut: 'Space', run: () => sel.toggle(key(m.Name), order(), false) }, { label: 'Export this machine', run: () => exportMachine(m.Name) }, { label: 'Export the machine list', run: () => exportMachines() }];
      });
      root.MVLContext.register('[id^="panel-m-"]', (p) => { const n = p.querySelector('[data-mname]'); return n ? [{ label: `Export ${n.textContent}`, run: () => exportMachine(n.textContent) }] : []; });
      root.MVLContext.register('#panel-receipts', () => [{ label: 'Export receipts', run: () => exportReceipts() }]);
      root.MVLContext.register('#panel-media', () => [{ label: 'Export media information', run: exportMedia }]);
      root.MVLContext.register('#panel-settings', () => [{ label: 'Export settings', run: () => root.MVLHistory && root.MVLHistory.exportSettings() }, { label: 'Settings history', run: () => root.MVLHistory && root.MVLHistory.open() }, { label: 'Changelog', run: () => root.MVLChangelog && root.MVLChangelog.open() }]);
      root.MVLContext.register('#tabs [role="tab"]', () => [{ label: 'Close tabs in bulk...', run: closeTabsDialog }]);
      root.MVLContext.register('#notifyCentre', () => [{ label: 'Export notifications', run: exportNotifications }]);
    }
    function exportNotifications() {
      const rows = root.MVLNotify.list().map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, at: n.at, read: !!n.read }));
      root.MVLExport.open({ title: 'Notifications', name: 'notifications', schema: 'mvl.notifications/1', rows, scope: 'every notification' });
    }
    if (root.MVLPalette) {
      const reg = (id, title, hint, keywords, run) => root.MVLPalette.register({ id: 'p1-' + id, title, hint, keywords, run: () => setTimeout(run) });
      reg('ex-machines', 'Export the machine list', 'JSON, CSV, YAML, Markdown and more', ['export', 'machines', 'csv', 'json'], () => exportMachines());
      reg('ex-receipts', 'Export receipts', 'Every receipt, or those matching the search', ['export', 'receipts'], () => exportReceipts());
      reg('ex-media', 'Export media information', 'Verified media and files on disk', ['export', 'media', 'iso'], exportMedia);
      reg('ex-notify', 'Export notifications', 'The notification centre', ['export', 'notifications'], exportNotifications);
      reg('tabs-bulk', 'Close tabs in bulk', 'Search the open tabs and close the matches', ['tabs', 'close', 'bulk', 'regex'], closeTabsDialog);
      reg('sel-machines', 'Select every shown machine', 'Bulk actions for machines', ['select', 'bulk', 'machines'], () => { d.selectTab('machines'); sel.add(order()); });
    }

    return { cardCheck, afterRender, afterReceipts, exportMachines, exportMachine, exportReceipts, exportMedia, closeTabsDialog, selection: sel, syncTabs: () => { syncCards(); syncReceipts(); } };
  }
  root.MVLManagerP1 = { create };
})(typeof window !== 'undefined' ? window : globalThis);
