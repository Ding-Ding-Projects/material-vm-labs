'use strict';
// Extensions manager tool. Lists every extension in the extensions folder with its state, hooks,
// actions, permissions, limits, recent runs and any manifest error; switches each on or off behind a
// consent prompt for new or changed permissions; adds one from a folder (asking before replacing a
// different version); opens the folder; reloads; runs actions on real receipts and machines; and has
// a master off switch. All of the work happens in the main process (extensions-ipc.js).
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const STATE = { on: ['On', 'lime'], off: ['Off', ''], 'needs-consent': ['Needs your permission', 'amber'], error: ['Manifest error', 'red'], 'master-off': ['Off (master switch)', ''] };
  const FILTERS = [['all', 'All'], ['on', 'On'], ['needs-consent', 'Needs permission'], ['off', 'Off'], ['error', 'Problems']];

  function mount(el, ctx) {
    const api = window.mvlExtensions;
    if (!api) { el.innerHTML = '<div class="errbox" role="alert">Extensions are unavailable in this window: the extensions channel is not connected (the main process has not registered extensions-ipc.js).</div>'; return; }
    let data = null, filter = 'all', openRun = null;
    el.innerHTML = `<div class="gx">
<div class="card gx-top"><label class="switch-row"><span><b>Extensions</b><br><span class="small">Each extension runs as its own program only when you start one of its actions. Master switch off stops them all.</span></span><input type="checkbox" role="switch" data-gx-master aria-label="Extensions master switch"></label>
<div class="row"><button type="button" class="btn sm primary" data-gx-add>Add from a folder</button><button type="button" class="btn sm" data-gx-folder>Open the extensions folder</button><button type="button" class="btn sm" data-gx-reload>Reload</button><button type="button" class="btn sm light" data-gx-restore hidden>Restore built-in extensions</button><button type="button" class="btn sm light" data-gx-guide>Author guide</button></div>
<p class="small" data-gx-root></p><div data-gx-msg role="status" aria-live="polite"></div></div>
<div data-gx-search></div>
<div class="seg sm" role="group" aria-label="Show extensions">${FILTERS.map(([v, l]) => `<button type="button" data-gx-filter="${v}" aria-pressed="${v === 'all'}">${l}</button>`).join('')}</div>
<p class="small" data-gx-count role="status"></p>
<div class="gx-list" data-gx-list></div></div>`;
    const $ = (s) => el.querySelector(s);
    const search = window.MVL.makeSearch({ placeholder: 'Search extensions, hooks and permissions', label: 'Search extensions', onChange: render });
    $('[data-gx-search]').append(search.el);
    const msg = (t, bad) => { const m = $('[data-gx-msg]'); m.className = bad ? 'errbox' : 'small'; m.textContent = t || ''; };

    async function load(fn) { data = await (fn || api.list)(); render(); }
    function permList(perms, cls) { return perms.map((p) => `<li class="${cls || ''}"><code>${esc(p)}</code><span>${esc(data.permissions[p] || '')}</span></li>`).join(''); }
    function card(x) {
      if (!x.ok) return `<article class="card gx-card" data-folder="${esc(x.folder)}"><div class="row"><strong class="mono">${esc(x.folder)}</strong><span class="pill red">${STATE.error[0]}</span></div><ul class="gx-errors">${x.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul><div class="row"><button type="button" class="btn sm" data-gx-open="${esc(x.folder)}">Open its folder</button><button type="button" class="btn sm danger" data-gx-remove="${esc(x.folder)}">Remove</button></div></article>`;
      const m = x.manifest, [label, tone] = STATE[x.state] || [x.state, ''];
      const runs = x.runs.slice(0, 5);
      return `<article class="card gx-card" data-id="${esc(m.id)}">
<div class="row gx-head"><strong>${esc(m.name)}</strong><span class="small mono">${esc(m.id)} ${esc(m.version)}</span>${x.builtIn ? '<span class="pill">Built in</span>' : ''}${x.modified ? '<span class="pill amber" title="You changed this built-in copy, so updates no longer replace it">Modified</span>' : ''}<span class="pill ${tone}">${esc(label)}</span><span class="grow"></span>
<label class="switch-row gx-sw"><span class="small">${x.enabled && x.state !== 'needs-consent' ? 'On' : 'Off'}</span><input type="checkbox" role="switch" data-gx-toggle="${esc(m.id)}" ${x.enabled && x.state === 'on' ? 'checked' : ''} ${data.masterOff ? 'disabled title="The master switch is off"' : ''} aria-label="Switch ${esc(m.name)} on or off"></label></div>
<p>${esc(m.description)}</p>
${x.state === 'needs-consent' ? `<div class="warn row"><span>${x.diff.status === 'new' ? 'New extension: it stays off until you allow what it asks for.' : `Version ${esc(x.diff.toVersion)} ${x.diff.added.length ? 'asks for ' + x.diff.added.length + ' new permission' + (x.diff.added.length === 1 ? '' : 's') : 'changed'} since you allowed ${esc(x.diff.fromVersion)}. It stays off until you decide.`}</span><button type="button" class="btn sm amber" data-gx-review="${esc(m.id)}">Review</button></div>` : ''}
<dl class="kv"><dt>Hooks</dt><dd>${m.hooks.map((h) => esc((data.hooks[h] || {}).title || h)).join('; ')}</dd><dt>Runtime</dt><dd>${esc(m.runtime)}: ${esc(data.runtimes[m.runtime] || '')}</dd><dt>Limits</dt><dd>${Math.round(m.timeoutMs / 1000)} s per run, answer lines up to ${Math.round(data.limits.maxLineBytes / 1024)} KB, ${Math.round(data.limits.maxStdoutBytes / 1024)} KB of output in all</dd>${m.author ? `<dt>Author</dt><dd>${esc(m.author)}</dd>` : ''}</dl>
<details><summary>Permissions (${m.permissions.length})</summary><ul class="gx-perms">${permList(m.permissions)}</ul></details>
<div class="gx-actions"><span class="eyebrow">Actions</span>${m.actions.map((a) => `<div class="row"><span class="grow"><b>${esc(a.title)}</b><br><span class="small">${esc(a.description || (data.hooks[a.hook] || {}).title || '')}</span></span><button type="button" class="btn sm" data-gx-run="${esc(m.id)}" data-action="${esc(a.id)}" ${x.state === 'on' ? '' : `disabled title="${esc(x.state === 'needs-consent' ? 'Allow its permissions first' : data.masterOff ? 'The master switch is off' : 'Switch the extension on first')}"`}>Run</button></div>`).join('')}</div>
<div data-gx-runpanel="${esc(m.id)}"></div>
<details><summary>Recent runs (${x.runs.length})</summary>${runs.length ? `<ul class="gx-runs">${runs.map((r) => `<li><span class="pill ${r.ok ? 'lime' : 'red'}">${r.ok ? 'Answered' : 'Failed'}</span> <span class="small">${esc(new Date(r.at).toLocaleString())}, ${esc(r.action)}, ${r.ms} ms</span><br>${esc(r.message)}</li>`).join('')}</ul>` : '<p class="small">No runs yet.</p>'}</details>
<div class="row"><button type="button" class="btn sm" data-gx-open="${esc(m.id)}">Open its folder</button><button type="button" class="btn sm danger" data-gx-remove="${esc(m.id)}">Remove</button></div>
</article>`;
    }
    function render() {
      if (!data) return;
      $('[data-gx-master]').checked = !data.masterOff;
      $('[data-gx-root]').textContent = `Folder: ${data.root}. Protocol ${data.protocol}, API version ${data.apiVersion}.`;
      $('[data-gx-restore]').hidden = !(data.removedBuiltins && data.removedBuiltins.length);
      let list = data.extensions;
      if (filter !== 'all') list = list.filter((x) => (filter === 'off' ? x.state === 'off' || x.state === 'master-off' : x.state === filter));
      if (search.invalid()) { $('[data-gx-list]').innerHTML = '<div class="errbox">That regex pattern is not valid, so nothing was filtered.</div>'; return; }
      if (search.active()) list = list.filter((x) => search.test(x.ok ? [x.manifest.name, x.manifest.id, x.manifest.description, x.manifest.hooks.join(' '), x.manifest.permissions.join(' '), x.manifest.actions.map((a) => a.title).join(' '), (STATE[x.state] || [''])[0]].join(' ') : [x.folder, x.errors.join(' ')].join(' ')));
      $('[data-gx-count]').textContent = `${list.length} of ${data.extensions.length} extensions`;
      if (search.active()) search.setStatus(`${list.length} of ${data.extensions.length}`);
      $('[data-gx-list]').innerHTML = !data.extensions.length ? '<div class="empty"><h2>No extensions yet</h2><p>Add one from a folder, or restore the built-in ones. The author guide shows how to write your own.</p></div>' : list.length ? list.map(card).join('') : '<div class="empty"><h2>No extension matches</h2><p>Try fewer words, or another filter.</p></div>';
      if (openRun) showRun(openRun.id, openRun.action);
    }

    // ---------- Consent prompt ----------
    function consent(x) {
      return new Promise((resolve) => {
        const m = x.manifest, d = x.diff;
        const dlg = document.createElement('dialog');
        dlg.className = 'm3-dialog gx-consent'; dlg.setAttribute('aria-labelledby', 'gxcT'); dlg.setAttribute('aria-describedby', 'gxcD');
        dlg.innerHTML = `<h2 id="gxcT">${d.status === 'new' ? `Allow ${esc(m.name)} ${esc(m.version)}?` : `Allow the changes in ${esc(m.name)} ${esc(m.version)}?`}</h2>
<p id="gxcD">${d.status === 'new' ? 'It asks for exactly these permissions. It stays off unless you allow them.' : `You allowed version ${esc(d.fromVersion)}. Version ${esc(d.toVersion)} asks for the permissions below. It stays off unless you allow them.`}</p>
${d.added.length ? `<h3>${d.status === 'new' ? 'Asks for' : 'New'}</h3><ul class="gx-perms add">${permList(d.added)}</ul>` : ''}
${d.kept.length ? `<h3>Already allowed</h3><ul class="gx-perms">${permList(d.kept)}</ul>` : ''}
${d.removed.length ? `<h3>No longer asked for</h3><ul class="gx-perms">${permList(d.removed)}</ul>` : ''}
<p class="small">Limits: ${Math.round(m.timeoutMs / 1000)} seconds per run, ${Math.round(data.limits.maxStdoutBytes / 1024)} KB of output. Never handed over: guest passwords, runner tokens, credentials, keys or your vocabulary file.</p>
<p class="small">What permissions cannot stop: an extension is still a program running as you, so it can read files you can read. Permissions limit what Material VM Labs hands it and what it accepts back. Only allow extensions you trust.</p>
<div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-no>Keep it off</button><button type="button" class="btn primary" data-yes>Allow and turn on</button></div>`;
        document.body.append(dlg);
        const back = document.activeElement;
        const done = (v) => { dlg.close(); dlg.remove(); if (back && back.focus) back.focus(); resolve(v); };
        dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(false); });
        dlg.querySelector('[data-no]').addEventListener('click', () => done(false));
        dlg.querySelector('[data-yes]').addEventListener('click', async () => {
          const r = await api.allow(m.id, m.version, m.permissions);
          if (!r.ok) { ctx.toast(r.error, 'error'); done(false); return; }
          done(true);
        });
        dlg.showModal();
        dlg.querySelector('[data-no]').focus();
      });
    }
    const find = (id) => data.extensions.find((x) => x.ok && x.manifest.id === id);

    // ---------- Running an action on real data ----------
    async function showRun(id, actionId) {
      openRun = { id, action: actionId };
      const host = el.querySelector(`[data-gx-runpanel="${CSS.escape(id)}"]`); if (!host) return;
      const x = find(id); const a = x && x.manifest.actions.find((y) => y.id === actionId); if (!a) return;
      host.innerHTML = `<div class="gx-run" role="group" aria-label="Run ${esc(a.title)}"><span class="eyebrow">Run: ${esc(a.title)}</span><div data-pick><p class="small">Loading what it can run on&hellip;</p></div><div class="row"><button type="button" class="btn sm primary" data-go disabled>Run now</button><button type="button" class="btn sm" data-close>Close</button></div><div data-out aria-live="polite"></div></div>`;
      const pick = host.querySelector('[data-pick]'), go = host.querySelector('[data-go]');
      host.querySelector('[data-close]').addEventListener('click', () => { openRun = null; host.replaceChildren(); el.querySelector(`[data-gx-run="${CSS.escape(id)}"]`)?.focus(); });
      let getCtx = null;
      if (a.hook === 'receipt' || a.hook === 'machine') {
        let items = [];
        try {
          if (a.hook === 'receipt') items = ((await window.mvl.receipts()).receipts || []).map((r) => ({ label: `${r.repository || 'receipt'}@${String(r.commit || '').slice(0, 10)} ${r.verdict || ''} ${r.finishedUtc || ''}`, value: r }));
          else { const r = await window.mvl.run('ls', {}); items = (r.ok ? (Array.isArray(r.data) ? r.data : r.data ? [r.data] : []) : []).map((m) => ({ label: `${m.Name} (${m.Os || 'windows'}, ${m.Power || m.Status || ''})`, value: m })); }
        } catch (e) { pick.innerHTML = `<div class="errbox">Could not load ${a.hook === 'receipt' ? 'receipts' : 'machines'}: ${esc(e.message)}</div>`; return; }
        if (!items.length) { pick.innerHTML = `<p class="small">${a.hook === 'receipt' ? 'There are no receipts yet. Run a fresh build first.' : 'There are no machines yet. Create one first.'}</p>`; return; }
        const s = window.MVL.makeSearch({ placeholder: a.hook === 'receipt' ? 'Find a receipt' : 'Find a machine', label: a.hook === 'receipt' ? 'Find a receipt' : 'Find a machine', onChange: draw });
        pick.innerHTML = '<div data-s></div><div class="gx-pick" role="radiogroup" aria-label="Run it on"></div>';
        pick.querySelector('[data-s]').append(s.el);
        let chosen = null;
        function draw() {
          const shown = items.map((it, i) => [it, i]).filter(([it]) => !s.active() || s.test(it.label)).slice(0, 50);
          pick.querySelector('.gx-pick').innerHTML = shown.length ? shown.map(([it, i]) => `<label class="switch-row"><span class="mono small">${esc(it.label)}</span><input type="radio" name="gxp-${esc(id)}" value="${i}" ${chosen === i ? 'checked' : ''}></label>`).join('') : '<p class="small">Nothing matches.</p>';
        }
        pick.addEventListener('change', (e) => { if (e.target.name === 'gxp-' + id) { chosen = Number(e.target.value); go.disabled = false; } });
        draw();
        getCtx = () => (chosen == null ? null : a.hook === 'receipt' ? { receipt: items[chosen].value } : { machine: items[chosen].value });
      } else {
        pick.innerHTML = `<p class="small">Type the choices to check, as on the Create sheet. No password is asked for or handed over.</p><div class="row"><label class="field grow">Name<input data-p="name" class="mono" value="proof-2" autocomplete="off" spellcheck="false"></label><label class="field grow">Project<input data-p="project" value="general" autocomplete="off"></label></div><div class="row"><div class="seg sm" role="group" aria-label="System">${[['windows', 'Windows 11'], ['ubuntu', 'Ubuntu'], ['debian', 'Debian']].map(([v, l], i) => `<button type="button" data-os="${v}" aria-pressed="${i === 0}">${l}</button>`).join('')}</div><div class="seg sm" role="group" aria-label="Network">${[['nat', 'NAT'], ['bridged', 'Bridged'], ['hostonly', 'Host-only']].map(([v, l], i) => `<button type="button" data-net="${v}" aria-pressed="${i === 0}">${l}</button>`).join('')}</div></div><label class="switch-row"><span>Default guest password</span><input type="checkbox" role="switch" data-p="def" checked></label>`;
        pick.addEventListener('click', (e) => { const b = e.target.closest('[data-os],[data-net]'); if (!b) return; const attr = b.dataset.os ? 'data-os' : 'data-net'; pick.querySelectorAll(`[${attr}]`).forEach((y) => y.setAttribute('aria-pressed', String(y === b))); });
        go.disabled = false;
        getCtx = () => ({ plan: { name: pick.querySelector('[data-p=name]').value.trim(), project: pick.querySelector('[data-p=project]').value.trim(), os: pick.querySelector('[data-os][aria-pressed=true]').dataset.os, net: pick.querySelector('[data-net][aria-pressed=true]').dataset.net, hv: 'auto', mem: 12288, cpus: 8, user: 'mvlbuilder', usesDefaultSignIn: pick.querySelector('[data-p=def]').checked } });
      }
      go.addEventListener('click', async () => {
        const c = getCtx(); if (!c) return;
        go.disabled = true; const out = host.querySelector('[data-out]'); out.innerHTML = '<p class="small">Running&hellip;</p>';
        const r = await api.run(id, actionId, c);
        out.replaceChildren();
        if (r.needsConsent) { out.innerHTML = '<div class="warn">It needs your permission first.</div>'; }
        else if (!r.ok) {
          out.innerHTML = `<div class="errbox" role="alert">${esc(r.error)}</div>${r.stderr ? `<details><summary>What it wrote to its error output</summary><pre class="mono small">${esc(r.stderr)}</pre></details>` : ''}`;
          ctx.notify({ kind: 'error', title: `${x.manifest.name} failed`, body: r.error });
        } else {
          const head = document.createElement('p'); head.className = 'small'; head.textContent = `${r.answer.summary || 'Answered'} (${r.ms} ms)`; out.append(head);
          if (r.answer.report != null) { const d = document.createElement('div'); window.MVLRender ? window.MVLRender.render(d, r.answer.report, { label: `${x.manifest.name} report` }) : (d.textContent = r.answer.report); out.append(d); }
          if (r.answer.checks) { const ul = document.createElement('ul'); ul.className = 'gd-checks'; ul.innerHTML = r.answer.checks.map((c2) => `<li><span class="pill ${c2.status === 'pass' ? 'lime' : c2.status === 'warn' ? 'amber' : 'red'}">${c2.status === 'pass' ? 'Pass' : c2.status === 'warn' ? 'Warning' : 'Fail'}</span><span><b>${esc(c2.title)}</b>${c2.detail ? '<br><span class="small">' + esc(c2.detail) + '</span>' : ''}</span></li>`).join(''); out.append(ul); }
          if (r.logs && r.logs.length) { const d = document.createElement('details'); d.innerHTML = `<summary>Its log lines (${r.logs.length})</summary><pre class="mono small">${esc(r.logs.join('\n'))}</pre>`; out.append(d); }
        }
        go.disabled = false;
        data = await api.list(); // recent runs show on the next redraw; the answer stays on screen
      });
    }

    // ---------- Events ----------
    el.addEventListener('click', async (e) => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.dataset.gxFilter) { filter = t.dataset.gxFilter; el.querySelectorAll('[data-gx-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b === t))); render(); return; }
      if (t.hasAttribute('data-gx-reload')) { await load(api.reload); msg('Reloaded from the folder.'); return; }
      if (t.hasAttribute('data-gx-folder')) { const r = await api.openFolder(null); if (!r.ok) msg('Could not open the folder: ' + r.error, true); return; }
      if (t.hasAttribute('data-gx-restore')) { await api.restoreBuiltins(); await load(); msg('Built-in extensions restored. They need your permission before they run.'); return; }
      if (t.hasAttribute('data-gx-guide')) { if (window.mvlDocs && window.mvlDocs.openExternal) window.mvlDocs.openExternal('https://ding-ding-projects.github.io/material-vm-labs/extensions/'); return; }
      if (t.dataset.gxOpen) { const r = await api.openFolder(t.dataset.gxOpen); if (!r.ok) msg('Could not open the folder: ' + r.error, true); return; }
      if (t.dataset.gxReview) { const x = find(t.dataset.gxReview); if (x && await consent(x)) { ctx.toast(`${x.manifest.name} is allowed and on.`); } await load(); return; }
      if (t.dataset.gxRun) { showRun(t.dataset.gxRun, t.dataset.action); return; }
      if (t.dataset.gxRemove) {
        const id = t.dataset.gxRemove, x = find(id);
        const ok = await ctx.confirm({ action: `Remove ${x ? x.manifest.name : id}`, affected: `Deletes its folder from the extensions folder${x && x.builtIn ? '. Restore built-in extensions brings it back.' : '. Add it again from its source folder to undo.'}` });
        if (!ok) return;
        const r = await api.remove(id); if (!r.ok) msg('Not removed: ' + r.error, true); else msg('Removed.');
        await load(); return;
      }
      if (t.hasAttribute('data-gx-add')) {
        const r = await api.pickFolder();
        if (r.cancelled) return;
        if (!r.ok) { $('[data-gx-msg]').className = 'errbox'; $('[data-gx-msg]').innerHTML = `<b>${esc(r.folder || 'That folder')} was refused:</b><ul>${(r.errors || [r.error]).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`; return; }
        let res = await api.install(r.token, false);
        if (res.needsReplace) {
          const ok = await ctx.confirm({ action: `Replace ${r.manifest.name} ${res.existing.version} with ${r.manifest.version}`, affected: `The installed folder is replaced by ${r.folder}${res.existing.builtIn ? ', and the built-in copy stops updating itself' : ''}. Changes you made inside it are lost.` });
          if (!ok) { msg('Nothing was replaced.'); return; }
          res = await api.install(r.token, true);
        }
        if (!res.ok) { msg('Not added: ' + res.error, true); return; }
        await load();
        msg(`${r.manifest.name} ${r.manifest.version} added${r.skippedLinks ? `; ${r.skippedLinks} shortcut links were skipped` : ''}. It stays off until you allow it.`);
        const x = find(r.manifest.id); if (x && x.state === 'needs-consent') { await consent(x); await load(); }
      }
    });
    el.addEventListener('change', async (e) => {
      const t = e.target;
      if (t.matches('[data-gx-master]')) { await api.master(!t.checked); await load(); msg(t.checked ? 'Extensions are on.' : 'Every extension is off. Nothing runs until you switch this back on.'); return; }
      if (t.dataset.gxToggle) {
        const id = t.dataset.gxToggle, want = t.checked;
        const r = await api.setEnabled(id, want);
        if (r.needsConsent) { t.checked = false; const x = find(id); if (x) await consent(x); }
        else if (!r.ok) msg(r.error, true);
        await load();
      }
    });
    load();
  }

  if (window.MVLTools) window.MVLTools.register({ id: 'extensions', title: 'Extensions', group: 'Customise', summary: 'Add, allow, run and switch off extensions that hook receipts and machines', mount });
})();
