'use strict';
// Virtual disks tool (Windows VHD, VHDX, VHD Set and ISO). Operations run in the main process
// through window.mvlVdisk; each result names the route that did the work and offers the equivalent
// script. Steps that need administrator rights use Windows' own prompt; a cancel is reported as
// incomplete. On other systems the tool says Windows is needed and only previews scripts.
(function () {
  const S = window.MVLSys;
  const { esc, fmtBytes } = S;
  const GiB = 1024 ** 3;
  const HIST = 'mvl.vdisk.history.v1', RECENT = 'mvl.vdisk.recent.v1';
  const MODES = { Quick: 'Reclaims unused blocks without scanning for zeros. The VHDX default. Needs the disk detached or attached read-only.', Full: 'Scans for zero blocks and reclaims unused blocks. The VHD default and the slowest. Needs the disk detached or attached read-only.', Retrim: 'Only sends trims for space already freed. Needs the disk detached or attached read-only.', Pretrimmed: 'Like Quick but cannot ask NTFS for free space, so it finds less. For disks used by Windows 8 or later, or after Retrim.', Prezeroed: 'Like Quick, for disks whose free space a tool already zeroed or that hold another file system.' };

  function mount(el, ctx) {
    const api = window.mvlVdisk;
    el.classList.add('sys-root');
    if (!api) { el.innerHTML = S.unavailable('Virtual disk tools are not connected', 'This window was opened without the virtual disk bridge.'); return; }
    let probe = null, preview = false;
    el.innerHTML = `<section class="sys-status" data-status aria-live="polite"><h3>Checking this computer...</h3></section><div data-tabs></div><section class="card" aria-labelledby="vd-res"><h3 id="vd-res">Last result</h3><div data-result><p class="sys-meta">Results appear here with the route that did the work.</p></div></section><details class="sys-details"><summary>History on this device</summary><ul class="sys-list" data-history></ul></details>`;
    const statusEl = el.querySelector('[data-status]'), resultEl = el.querySelector('[data-result]');
    const tabs = S.subtabs([{ id: 'library', label: 'Library' }, { id: 'create', label: 'Create' }, { id: 'attach', label: 'Attach' }, { id: 'resize', label: 'Resize' }, { id: 'compact', label: 'Compact' }, { id: 'convert', label: 'Convert' }, { id: 'quickpack', label: 'Quick pack' }, { id: 'more', label: 'More' }], (id, panel) => draw(id, panel), 'Virtual disk sections');
    el.querySelector('[data-tabs]').append(tabs.el);

    async function doProbe() {
      probe = await api.probe();
      preview = !!probe.unavailable;
      if (probe.unavailable) statusEl.innerHTML = `<span class="pill red"><span class="dot"></span>Needs Windows</span><h3>${esc(probe.error)}</h3><p class="sys-meta">You can still fill in every form and copy the PowerShell or DiskPart script it would run on a Windows computer.</p>`;
      else if (!probe.ok) statusEl.innerHTML = `<span class="pill red"><span class="dot"></span>Check failed</span><h3>PowerShell could not report the available routes</h3><p class="errbox">${esc(probe.error)}</p><button type="button" class="btn sm" data-act="reprobe">Check again</button>`;
      else {
        const r = probe.routes;
        statusEl.innerHTML = `<h3>${esc(probe.os || 'Windows')} build ${esc(probe.build || '')}</h3><div class="chips">${[['VirtDisk API', r.virtdisk], ['Storage module', r.storage], ['Hyper-V module', r.hyperv]].map(([n, ok]) => `<span class="pill ${ok ? 'lime' : ''}">${esc(n)}: ${ok ? 'available' : 'not found'}</span>`).join('')}<span class="pill ${r.isAdmin ? 'amber' : ''}">${r.isAdmin ? 'Running as administrator' : 'Standard rights; administrator steps ask Windows first'}</span></div>${r.hyperv ? '' : '<p class="sys-meta">Without the Hyper-V module, create, grow and compact use the VirtDisk API; shrink, convert and chain tests need Hyper-V and say so. This app never turns Hyper-V on or restarts the computer.</p>'}<button type="button" class="btn sm" data-act="reprobe">Check again</button>`;
      }
      draw(tabs.current || 'library', tabs.panel);
    }
    statusEl.addEventListener('click', (e) => { if (e.target.closest('[data-act="reprobe"]')) doProbe(); });
    const routes = () => (probe && probe.routes) || {};

    function pathField(key, label, help, kind, mode) { return `<div class="field sys-ctl"><label for="vd-${key}">${esc(label)}</label><div class="sys-step"><input id="vd-${key}" data-k="${key}" spellcheck="false" placeholder="D:\\Disks\\data.vhdx"><button type="button" class="btn sm" data-browse="${key}" data-kind="${kind}" data-mode="${mode}">Browse...</button></div>${help ? `<small class="sys-help">${esc(help)}</small>` : ''}</div>`; }
    const sizeField = (key, label, help) => `<div class="field sys-ctl"><label for="vd-${key}">${esc(label)}</label><div class="sys-step"><input id="vd-${key}" data-k="${key}" inputmode="decimal" value="64"><select data-k="${key}-unit" aria-label="${esc(label)} unit"><option>MB</option><option selected>GB</option><option>TB</option></select></div>${help ? `<small class="sys-help">${esc(help)}</small>` : ''}</div>`;
    const sizeOf = (panel, key) => { const n = Number(S.value(panel, key)); const u = { MB: 1024 ** 2, GB: GiB, TB: 1024 ** 4 }[S.value(panel, key + '-unit')]; return Number.isFinite(n) && n > 0 ? Math.round(n * u) : NaN; };
    const actions = (op, extra) => `<div class="sys-row"><button type="button" class="btn primary" data-run="${op}" ${preview ? 'disabled title="Needs Windows"' : ''}>${esc(extra || 'Run')}</button><button type="button" class="btn" data-preview="${op}">Show the script</button></div><div data-script></div>`;

    function draw(id, panel) {
      panel.onclick = null; panel.oninput = null;
      if (id === 'library') return drawLibrary(panel);
      if (id === 'create') {
        panel.innerHTML = `<div class="sys-row"><span class="sys-meta">Presets:</span><button type="button" class="btn sm" data-preset="data">Portable data disk</button><button type="button" class="btn sm" data-preset="scratch">Differencing scratch copy</button></div>
          ${pathField('path', 'New disk file', 'The extension picks the format: .vhdx (recommended), .vhd or .vhds. An existing file is never overwritten.', 'disk', 'save')}
          <div class="seg sm" role="group" aria-label="Disk type">${[['dynamic', 'Dynamically expanding'], ['fixed', 'Fixed size'], ['differencing', 'Differencing']].map(([k, l], i) => `<button type="button" data-type="${k}" aria-pressed="${i === 0}">${l}</button>`).join('')}</div>
          <div data-sizebox>${sizeField('size', 'Maximum size', 'At least 3 MB. A VHD holds at most 2,040 GB, a VHDX at most 64 TB. A dynamic disk does not reserve this space up front, so it can promise more than the drive holds.')}</div>
          <div data-parentbox hidden>${pathField('parent', 'Parent disk', 'The parent becomes read-only for as long as this child depends on it.', 'disk', 'open')}</div>
          <details class="sys-details"><summary>VHDX geometry</summary><div class="sys-grid">${S.sel('block', 'Block size', '', [['', 'Default'], ...[1, 2, 4, 8, 16, 32, 64, 128, 256].map((n) => [n, n + ' MB'])], 'A power of two from 1 MB to 256 MB.')}${S.sel('lsec', 'Logical sector', '', [['', 'Default'], [512, '512 bytes'], [4096, '4096 bytes']])}${S.sel('psec', 'Physical sector', '', [['', 'Default'], [512, '512 bytes'], [4096, '4096 bytes']])}</div></details>
          ${S.sw('init', 'Initialize and format after creating', false, 'Attaches the new disk, creates one partition and formats it. Needs administrator rights.')}
          <div data-initbox hidden class="sys-grid">${S.sel('style', 'Partition style', 'GPT', ['GPT', 'MBR'])}${S.sel('fs', 'File system', 'NTFS', ['NTFS', 'ReFS', 'exFAT', 'FAT32'], 'ReFS only where this Windows edition supports it.')}${S.txt('label', 'Volume label', 'Data', '', 'maxlength="32"')}${S.sw('letter', 'Assign a drive letter', true)}</div>
          ${actions('create', 'Create disk')}`;
        let type = 'dynamic';
        panel.onclick = async (e) => {
          const t = e.target.closest('[data-type]'); if (t) { type = t.dataset.type; for (const b of panel.querySelectorAll('[data-type]')) b.setAttribute('aria-pressed', String(b === t)); panel.querySelector('[data-sizebox]').hidden = type === 'differencing'; panel.querySelector('[data-parentbox]').hidden = type !== 'differencing'; return; }
          const p = e.target.closest('[data-preset]');
          if (p) { const set = (k, v) => { panel.querySelector(`[data-k="${k}"]`).value = v; }; if (p.dataset.preset === 'data') { panel.querySelector('[data-type="dynamic"]').click(); set('size', '64'); set('size-unit', 'GB'); set('fs', 'NTFS'); const i = panel.querySelector('[data-k="init"]'); if (!i.checked) i.click(); } else panel.querySelector('[data-type="differencing"]').click(); return; }
          await common(e, panel, 'create', () => {
            const args = { path: S.value(panel, 'path').trim(), type };
            if (type === 'differencing') args.parentPath = S.value(panel, 'parent').trim(); else args.sizeBytes = sizeOf(panel, 'size');
            if (S.value(panel, 'block')) args.blockSizeMB = Number(S.value(panel, 'block'));
            if (S.value(panel, 'lsec')) args.logicalSector = Number(S.value(panel, 'lsec'));
            if (S.value(panel, 'psec')) args.physicalSector = Number(S.value(panel, 'psec'));
            if (S.value(panel, 'init')) args.init = { style: S.value(panel, 'style'), fs: S.value(panel, 'fs'), label: S.value(panel, 'label'), letter: S.value(panel, 'letter') };
            return args;
          });
        };
        panel.querySelector('[data-k="init"]').addEventListener('change', (e) => { panel.querySelector('[data-initbox]').hidden = !e.target.checked; });
        return;
      }
      if (id === 'attach') {
        panel.innerHTML = `${pathField('path', 'Disk or ISO file', 'VHD, VHDX, VHD Set or ISO. ISO files always attach read-only. A file that is already attached is shown as attached, not as an error.', 'any', 'open')}${S.sw('ro', 'Read-only', false)}${S.sw('noletter', 'Do not assign drive letters', false)}
          <div class="sys-row"><button type="button" class="btn primary" data-run="attach" ${preview ? 'disabled' : ''}>Attach</button><button type="button" class="btn" data-run="detach" ${preview ? 'disabled' : ''}>Detach</button><button type="button" class="btn" data-preview="attach">Show the attach script</button><button type="button" class="btn" data-preview="detach">Show the detach script</button></div><div data-script></div>
          <p class="sys-meta">Attaching a VHD or VHDX needs administrator rights; Windows asks first. Not built yet: attach at every sign-in, VHD Set checkpoint choice, bringing a disk online and clearing read-only.</p>`;
        panel.onclick = (e) => common(e, panel, null, (op) => op === 'attach' ? { path: S.value(panel, 'path').trim(), readOnly: S.value(panel, 'ro'), noDriveLetter: S.value(panel, 'noletter') } : { path: S.value(panel, 'path').trim() });
        return;
      }
      if (id === 'resize') {
        const hv = routes().hyperv;
        panel.innerHTML = `${pathField('path', 'Disk file', '', 'disk', 'open')}
          <section class="card"><h3>Grow</h3>${sizeField('size', 'New maximum size', 'Must be larger than the current size.')}${S.sw('extend', 'Extend the last partition into the new space', true, 'Only when the disk is attached. Needs administrator rights.')}${actions('expand', 'Grow')}</section>
          <section class="card"><h3>Shrink (VHDX)</h3>${hv || preview ? '' : '<p class="warn">Shrinking uses Resize-VHD from the Hyper-V module, which was not found here.</p>'}${S.sw('tomin', 'Shrink to the smallest safe size', true, 'The smallest size that does not cut a partition. Shrink the last partition first to go lower.')}<div data-shrinksize hidden>${sizeField('ssize', 'New size')}</div><div class="sys-row"><button type="button" class="btn danger" data-run="shrink" ${preview || !hv ? 'disabled' : ''}>Shrink</button><button type="button" class="btn" data-preview="shrink">Show the script</button></div><div data-script></div></section>`;
        panel.querySelector('[data-k="tomin"]').addEventListener('change', (e) => { panel.querySelector('[data-shrinksize]').hidden = e.target.checked; });
        panel.onclick = (e) => common(e, panel, null, (op) => op === 'expand' ? { path: S.value(panel, 'path').trim(), sizeBytes: sizeOf(panel, 'size'), extendPartition: S.value(panel, 'extend') } : (S.value(panel, 'tomin') ? { path: S.value(panel, 'path').trim(), toMinimum: true } : { path: S.value(panel, 'path').trim(), sizeBytes: sizeOf(panel, 'ssize') }));
        return;
      }
      if (id === 'compact') {
        const hv = routes().hyperv;
        panel.innerHTML = `${pathField('path', 'Dynamic or differencing disk', 'Fixed disks cannot be compacted.', 'disk', 'open')}${hv || preview ? S.sel('mode', 'Mode', 'Quick', Object.keys(MODES)) + '<p class="sys-meta" data-modehelp></p>' : '<p class="note">Without the Hyper-V module this uses the VirtDisk API, which has no mode choice.</p>'}<p class="sys-meta">Detach the disk first, or attach it read-only, for Full, Quick and Retrim. The result reports the file size before and after and the mode that actually ran.</p>${actions('compact', 'Compact')}`;
        const mh = panel.querySelector('[data-modehelp]'); const upd = () => { if (mh) mh.textContent = MODES[S.value(panel, 'mode')]; }; upd();
        const ms = panel.querySelector('[data-k="mode"]'); if (ms) ms.addEventListener('change', upd);
        panel.onclick = (e) => common(e, panel, null, () => ({ path: S.value(panel, 'path').trim(), mode: S.value(panel, 'mode') }));
        return;
      }
      if (id === 'convert') {
        const hv = routes().hyperv;
        panel.innerHTML = `${hv || preview ? '' : '<p class="warn">Converting uses Convert-VHD from the Hyper-V module, which was not found here.</p>'}${pathField('path', 'Source disk', 'Must be detached. It is kept; this app never deletes the source.', 'disk', 'open')}${pathField('dest', 'New file', 'The extension picks the new format. A VHD cannot hold more than 2,040 GB; that is checked before anything starts.', 'disk', 'save')}${S.sel('vtype', 'Type', '', [['', 'Keep the source type'], ['Dynamic', 'Dynamically expanding'], ['Fixed', 'Fixed size']])}
          <div class="sys-row"><button type="button" class="btn primary" data-run="convert" ${preview || !hv ? 'disabled' : ''}>Convert</button><button type="button" class="btn" data-preview="convert">Show the script</button><button type="button" class="btn" data-run="test" ${preview || !hv ? 'disabled' : ''}>Test the chain</button></div><div data-script></div>`;
        panel.onclick = (e) => common(e, panel, null, (op) => op === 'test' ? { path: S.value(panel, 'path').trim() } : { path: S.value(panel, 'path').trim(), dest: S.value(panel, 'dest').trim(), vhdType: S.value(panel, 'vtype') || null });
        return;
      }
      if (id === 'quickpack') return drawQuickPack(panel);
      const unbuilt = (probe && probe.unbuilt) || { merge: 'Merging differencing chains is not built yet.', sets: 'VHD Set checkpoints are not built yet.', metadata: 'VHDX metadata and identifiers are not built yet.', mirror: 'Mirroring and change tracking are not built yet.', devdrive: 'Dev Drive creation is not built yet.', nativeboot: 'Native boot preparation is not built yet.', reparent: 'Reconnecting a moved parent is not built yet.' };
      panel.innerHTML = `<p class="sys-meta">These parts of the full manager are not built in this release. They stay listed so nothing looks finished that is not.</p>${Object.entries(unbuilt).map(([k, v]) => S.unavailable({ merge: 'Merge', sets: 'VHD Set checkpoints', metadata: 'Identity and metadata', mirror: 'Mirror and change tracking', devdrive: 'Dev Drive', nativeboot: 'Native boot', reparent: 'Reconnect a parent' }[k] || k, v)).join('')}`;
    }

    // Quick pack: drop or choose files and folders; they go into a new dynamic VHDX, every copy is
    // hashed again on the disk and compared with its source, and SHA256SUMS.txt lists them all.
    let packItems = [];
    function drawQuickPack(panel) {
      panel.innerHTML = `<p class="sys-meta">Drop files or folders here, or choose them. They are copied into a new VHDX, each copy is hashed again on the disk and compared with its source, and SHA256SUMS.txt on the disk lists every file. Windows asks for administrator rights to format and fill the disk.</p>
        <button type="button" class="sys-drop" data-act="pickfiles" ${preview ? 'disabled' : ''}><strong>Drop files or folders here</strong><span class="sys-meta">or press to choose files</span></button>
        <div class="sys-row"><button type="button" class="btn sm" data-act="pickfolder" ${preview ? 'disabled' : ''}>Choose folders...</button><button type="button" class="btn sm" data-act="clear">Clear the list</button></div>
        <h4>To pack <span data-count></span></h4><ul class="sys-list" data-items></ul>
        ${pathField('path', 'New VHDX file', 'An existing file is never overwritten. The disk is sized to fit what you pack, with some room to spare.', 'disk', 'save')}
        <div class="sys-grid">${S.sel('fs', 'File system', 'NTFS', ['NTFS', 'exFAT'], 'exFAT also opens on macOS and Linux.')}${S.txt('label', 'Volume label', 'Pack', '', 'maxlength="32"')}</div>
        ${actions('quickpack', 'Pack')}`;
      const drawItems = () => {
        panel.querySelector('[data-count]').textContent = packItems.length ? `(${packItems.length})` : '';
        panel.querySelector('[data-items]').innerHTML = packItems.length ? packItems.map((p, i) => `<li class="sys-item"><div class="sys-row"><span class="grow">${esc(p)}</span><button type="button" class="btn sm" data-remove="${i}" aria-label="Remove ${esc(p)}">Remove</button></div></li>`).join('') : '<li class="sys-meta">Nothing yet.</li>';
      };
      const add = (paths) => {
        const fresh = paths.filter((p) => p && !packItems.some((x) => x.toLowerCase() === p.toLowerCase()));
        packItems = packItems.concat(fresh).slice(0, 500); drawItems();
        if (fresh.length && !S.value(panel, 'path')) { const first = fresh[0].replace(/[\\]+$/, ''); panel.querySelector('[data-k="path"]').value = first.replace(/\.[^.\\]*$/, '') + '-pack.vhdx'; }
      };
      drawItems();
      const zone = panel.querySelector('.sys-drop');
      zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('over'));
      zone.addEventListener('drop', (e) => {
        e.preventDefault(); zone.classList.remove('over');
        const files = [...((e.dataTransfer && e.dataTransfer.files) || [])];
        const paths = api.pathFor ? files.map((f) => api.pathFor(f)).filter(Boolean) : [];
        if (files.length && !paths.length) return ctx.toast('These items have no file path on this computer, so they cannot be packed. Choose them instead.', 'error');
        add(paths);
      });
      panel.onclick = async (e) => {
        const act = e.target.closest('[data-act]');
        if (act && (act.dataset.act === 'pickfiles' || act.dataset.act === 'pickfolder')) { const r = await api.browse({ mode: 'open', kind: act.dataset.act === 'pickfiles' ? 'files' : 'folder' }); if (r.ok) add(r.paths || []); else if (r.error) ctx.toast(r.error, 'error'); return; }
        if (act && act.dataset.act === 'clear') { packItems = []; return drawItems(); }
        const rm = e.target.closest('[data-remove]'); if (rm) { packItems.splice(Number(rm.dataset.remove), 1); return drawItems(); }
        await common(e, panel, 'quickpack', () => ({ path: S.value(panel, 'path').trim(), sources: packItems.slice(), fs: S.value(panel, 'fs'), label: S.value(panel, 'label') }));
      };
    }

    let libSearch = null;
    async function drawLibrary(panel) {
      panel.innerHTML = `<div class="sys-row"><button type="button" class="btn" data-act="list" ${preview ? 'disabled' : ''}>Refresh attached disks</button><button type="button" class="btn" data-browse="lib" data-kind="any" data-mode="open">Add a file...</button><input type="hidden" data-k="lib"></div><div data-lsearch></div><h4>Attached virtual disks</h4><ul class="sys-list" data-attached><li class="sys-meta">${preview ? 'Needs Windows.' : 'Press Refresh to list them.'}</li></ul><h4>Files you added</h4><ul class="sys-list" data-recent></ul><div data-inspect></div>`;
      if (!libSearch) libSearch = S.search('Search disks', () => filterLib());
      panel.querySelector('[data-lsearch]').append(libSearch.el);
      const filterLib = () => { for (const li of panel.querySelectorAll('[data-text]')) li.hidden = !libSearch.test(li.dataset.text); };
      const drawRecent = () => { const r = S.store.get(RECENT, []); panel.querySelector('[data-recent]').innerHTML = r.length ? r.map((p) => `<li class="sys-item" data-text="${esc(p)}"><div class="sys-row"><h4 class="grow">${esc(p)}</h4><button type="button" class="btn sm" data-inspect="${esc(p)}" ${preview ? 'disabled' : ''}>Inspect</button><button type="button" class="btn sm" data-forget="${esc(p)}">Forget</button></div></li>`).join('') : '<li class="sys-meta">Add a file with Browse to see its details here.</li>'; filterLib(); };
      drawRecent();
      panel.onclick = async (e) => {
        const b = e.target.closest('[data-browse]'); if (b) { const r = await api.browse({ mode: 'open', kind: 'any' }); if (r.ok) { S.store.set(RECENT, [r.path].concat(S.store.get(RECENT, []).filter((x) => x !== r.path)).slice(0, 50)); drawRecent(); } else if (r.error) ctx.toast(r.error, 'error'); return; }
        const f = e.target.closest('[data-forget]'); if (f) { S.store.set(RECENT, S.store.get(RECENT, []).filter((x) => x !== f.dataset.forget)); return drawRecent(); }
        const i = e.target.closest('[data-inspect]');
        if (i) { const r = await run('inspect', { path: i.dataset.inspect }); const box = panel.querySelector('[data-inspect]'); box.innerHTML = r.ok && r.info ? `<section class="card"><h3>${esc(i.dataset.inspect)}</h3><dl class="sys-kv">${Object.entries({ ...r.info, fileBytes: r.fileBytes, modified: r.modified }).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(/size|bytes/i.test(k) && Number(v) ? fmtBytes(v) + ' (' + v + ')' : v == null || v === '' ? 'not reported by ' + r.routeName : v)}</dd>`).join('')}</dl></section>` : ''; return; }
        if (e.target.closest('[data-act="list"]')) {
          const r = await run('list', {});
          const ul = panel.querySelector('[data-attached]');
          if (!r.ok) { ul.innerHTML = `<li class="errbox">${esc(r.error)}</li>`; return; }
          const disks = [].concat(r.disks || []);
          ul.innerHTML = disks.length ? disks.map((d) => `<li class="sys-item" data-text="${esc(d.path + ' ' + d.number)}"><div class="sys-row"><h4 class="grow">Disk ${esc(d.number)}: ${esc(d.path)}</h4><span class="pill">${esc(d.status)}</span>${d.readOnly ? '<span class="pill amber">Read-only</span>' : ''}</div><div class="sys-meta">${fmtBytes(d.size)} &middot; ${esc(d.style)} &middot; ${[].concat(d.volumes || []).map((v) => `${v.letter ? v.letter + ':' : 'no letter'} ${esc(v.fs || 'no file system')} ${esc(v.label || '')} ${v.free != null ? fmtBytes(v.free) + ' free' : ''}`).join('; ') || 'no partitions'}</div></li>`).join('') : '<li class="sys-meta">No virtual disks are attached. Attached ISO files are listed by Windows as drives, not here.</li>';
          filterLib();
        }
      };
    }

    async function common(e, panel, onlyOp, argsFor) {
      const b = e.target.closest('[data-browse]');
      if (b) { const r = await api.browse({ mode: b.dataset.mode, kind: b.dataset.kind }); if (r.ok) panel.querySelector(`[data-k="${b.dataset.browse}"]`).value = r.path; else if (r.error) ctx.toast(r.error, 'error'); return; }
      const pv = e.target.closest('[data-preview]');
      if (pv) {
        const r = await api.preview({ op: pv.dataset.preview, args: argsFor(pv.dataset.preview), assumeHyperV: true });
        const box = pv.closest('section, .sys-panel').querySelector('[data-script]') || panel.querySelector('[data-script]');
        box.innerHTML = r.ok ? scriptBlock(r) : `<p class="errbox">${esc(r.error)}</p>`;
        return;
      }
      const rb = e.target.closest('[data-run]'); if (!rb) return;
      const op = rb.dataset.run; const args = argsFor(op);
      if (op === 'shrink' && !(await ctx.confirm({ action: `Shrink ${args.path}`, affected: 'The disk gets smaller. Data past the new end of the disk is lost if a partition still reaches there. Make a copy first if the data matters.' }))) return ctx.toast('Nothing was changed.');
      if (op === 'detach' && !(await ctx.confirm({ action: `Detach ${args.path}`, affected: 'Its drive letters disappear. Programs with files open on it can lose unsaved work. The file itself is kept.' }))) return ctx.toast('Nothing was changed.');
      rb.disabled = true; const label = rb.textContent; rb.textContent = 'Working...';
      await run(op, args); rb.disabled = false; rb.textContent = label;
    }
    function scriptBlock(r) {
      return `<p class="sys-meta">Route: ${esc(r.routeName)}${r.admin ? ', needs administrator rights' : ''}.</p><h4>PowerShell</h4><pre class="sys-code" data-pre="ps">${esc(r.equivalent.powershell)}</pre><button type="button" class="btn sm" data-copyscript="ps">Copy PowerShell</button>${r.equivalent.diskpart ? `<h4>DiskPart</h4><pre class="sys-code" data-pre="dp">${esc(r.equivalent.diskpart)}</pre><p class="sys-meta">${esc(r.equivalent.diskpartNote)}</p><button type="button" class="btn sm" data-copyscript="dp">Copy DiskPart</button>` : ''}`;
    }
    el.addEventListener('click', (e) => { const c = e.target.closest('[data-copyscript]'); if (c) S.copy(c.parentElement.querySelector(`[data-pre="${c.dataset.copyscript}"]`).textContent, ctx); });

    async function run(op, args, elevate) {
      resultEl.innerHTML = `<div class="sys-progress indeterminate" role="progressbar" aria-label="Working"><span></span></div><p class="sys-meta">${esc(op)} is running. Windows may ask for administrator rights.</p>`;
      const r = await api.run({ op, args, elevate: !!elevate });
      const state = r.ok ? 'Done' : r.cancelled ? 'Cancelled, incomplete' : r.unavailable ? 'Unavailable' : 'Failed, incomplete';
      const details = Object.entries(r).filter(([k]) => !['ok', 'route', 'routeName', 'equivalent', 'error', 'incomplete', 'cancelled', 'elevated', 'needsAdmin', 'unavailable', 'disks', 'info', 'hresult'].includes(k));
      resultEl.innerHTML = `<div class="sys-row"><span class="pill ${r.ok ? 'lime' : r.cancelled ? 'amber' : 'red'}">${esc(state)}</span><strong>${esc(op)}</strong></div>${r.routeName ? `<p class="sys-meta">Route: ${esc(r.routeName)}${r.elevated ? ', as administrator' : ''}</p>` : ''}${r.error ? `<p class="${r.cancelled ? 'warn' : 'errbox'}">${esc(r.error)}</p>` : ''}${details.length ? `<dl class="sys-kv">${details.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(/size|before|after|bytes/i.test(k) && Number(v) ? fmtBytes(v) + ' (' + v + ')' : typeof v === 'object' ? JSON.stringify(v) : v)}</dd>`).join('')}</dl>` : ''}${r.needsAdmin ? '<button type="button" class="btn" data-elevate>Try again with administrator rights</button>' : ''}${r.equivalent ? `<details class="sys-details"><summary>Equivalent script</summary>${scriptBlock({ routeName: r.routeName || 'not run', equivalent: r.equivalent })}</details>` : ''}`;
      const el2 = resultEl.querySelector('[data-elevate]'); if (el2) el2.addEventListener('click', () => run(op, args, true));
      if (op !== 'list' && op !== 'inspect') {
        const h = S.store.get(HIST, []); h.unshift({ at: new Date().toISOString(), op, path: args.path || '', state, route: r.routeName || '' }); S.store.set(HIST, h.slice(0, 100)); drawHistory();
        if (args.path) S.store.set(RECENT, [args.path].concat(S.store.get(RECENT, []).filter((x) => x !== args.path)).slice(0, 50));
        if (r.ok) ctx.notify({ kind: 'success', title: 'Virtual disk: ' + op, body: (args.path || '') + ' via ' + r.routeName });
      }
      return r;
    }
    function drawHistory() { const h = S.store.get(HIST, []); el.querySelector('[data-history]').innerHTML = h.length ? h.map((x) => `<li class="sys-meta">${esc(x.at.replace('T', ' ').slice(0, 19))} &middot; ${esc(x.op)} &middot; ${esc(x.path)} &middot; ${esc(x.state)}${x.route ? ' &middot; ' + esc(x.route) : ''}</li>`).join('') : '<li class="sys-meta">No operations yet.</li>'; }

    drawHistory();
    tabs.select('library');
    doProbe();
  }

  window.MVLTools.register({ id: 'virtual-disk-manager', title: 'Virtual disks', group: 'System', summary: 'Create, attach, grow, compact and convert VHD, VHDX and ISO files', mount });
})();
