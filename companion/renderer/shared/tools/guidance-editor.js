'use strict';
// External editor tool. Shows the editors the main process detected (VS Code first), lets you choose
// one or add a program (for example a portable VS Code), and opens the state root, the runs folder or a
// receipt in it. Folders open in VS Code as a workspace root. With no VS Code installed it says so and
// offers the download page instead of opening something else. Also adds "Open in VS Code" to the
// right-click menu of receipt cards.
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = () => window.mvlEditor;

  // Shared result handling: the no-editor path offers the download, every other failure says why.
  async function report(r, toast) {
    if (r.cancelled) return;
    if (r.ok) { toast(`Opened in ${r.editor.name}${r.asWorkspace ? ' as a workspace root' : ''}.`); return; }
    if (r.noVsCode) {
      const box = document.createElement('dialog');
      box.className = 'm3-dialog'; box.setAttribute('aria-labelledby', 'gedT');
      box.innerHTML = `<h2 id="gedT">Visual Studio Code is not installed</h2><p>${esc(r.error)}</p><p class="small">Nothing else was opened. Install it, or add a portable copy in Tools, External editor.</p><div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-no>Close</button><button type="button" class="btn primary" data-dl>Open the download page</button></div>`;
      document.body.append(box);
      const back = document.activeElement;
      const done = () => { box.close(); box.remove(); if (back && back.focus) back.focus(); };
      box.addEventListener('cancel', (e) => { e.preventDefault(); done(); });
      box.querySelector('[data-no]').addEventListener('click', done);
      box.querySelector('[data-dl]').addEventListener('click', async () => { await api().downloadVsCode(); done(); });
      box.showModal(); box.querySelector('[data-dl]').focus();
      return;
    }
    toast('Could not open it: ' + r.error, 'error');
  }

  async function receiptPathFor(card) {
    const head = card.querySelector('strong.mono'); if (!head || !window.mvl) return null;
    const list = (await window.mvl.receipts()).receipts || [];
    const r = list.find((x) => `${x.repository || ''}@${String(x.commit || '').slice(0, 10)}` === head.textContent.trim());
    return r && r.path ? r.path : null;
  }

  function mount(el, ctx) {
    if (!api()) { el.innerHTML = '<div class="errbox" role="alert">External editors are unavailable in this window: the editor channel is not connected (the main process has not registered editor-ipc.js).</div>'; return; }
    el.innerHTML = `<div class="ged">
<section class="card"><span class="eyebrow">Your editor</span><p class="small">Files and folders open in the editor you choose here. Your choice is remembered.</p><div class="ged-list" role="radiogroup" aria-label="Editor" data-list><p class="small">Looking for editors&hellip;</p></div>
<div class="row"><button type="button" class="btn sm" data-add>Add an editor program</button><button type="button" class="btn sm light" data-forget hidden>Forget the added program</button></div><div data-vs role="status"></div></section>
<section class="card"><span class="eyebrow">Open</span><div class="row"><button type="button" class="btn sm primary" data-open="root" data-ed="vscode">State root in VS Code</button><button type="button" class="btn sm" data-open="root">State root in your editor</button><button type="button" class="btn sm" data-open="runs" data-ed="vscode">Runs folder in VS Code</button></div>
<div class="row"><button type="button" class="btn sm" data-pick="file">Choose a file to open</button><button type="button" class="btn sm" data-pick="folder">Choose a folder to open</button></div></section>
<section class="card"><span class="eyebrow">Receipts</span><p class="small">Open a fresh-build receipt (receipt.json) in VS Code, or its whole run folder as a workspace.</p><div data-rs></div><div class="ged-receipts" data-receipts></div></section>
<p class="small" data-msg role="status" aria-live="polite"></p></div>`;
    const $ = (s) => el.querySelector(s);
    const say = (t, kind) => { $('[data-msg]').textContent = t; if (kind === 'error') $('[data-msg]').classList.add('bad'); else $('[data-msg]').classList.remove('bad'); };
    const toast = (m, k) => { say(m, k); ctx.toast(m, k); };
    let info = null, receipts = [], root = '';

    async function loadEditors() {
      info = await api().list();
      $('[data-list]').innerHTML = info.editors.map((e) => `<label class="switch-row ged-row"><span><b>${esc(e.name)}</b><br><span class="small">${esc(e.source)}${e.exe ? ' &middot; <span class="mono">' + esc(e.exe) + '</span>' : ''}${e.folders ? '' : ' &middot; files only'}</span></span><input type="radio" name="ged-editor" value="${esc(e.key)}" ${info.chosen && info.chosen.key === e.key ? 'checked' : ''}></label>`).join('');
      $('[data-forget]').hidden = !info.editors.some((e) => e.id === 'custom');
      $('[data-vs]').innerHTML = info.hasVsCode ? '' : `<div class="warn">Visual Studio Code was not found: not on PATH, not in the per-user or machine-wide folders, and no portable copy was added. <button type="button" class="btn sm" data-dl>Open the download page</button></div>`;
    }
    async function loadReceipts() {
      try { const s = await window.mvl.settings(); root = s.resolvedRoot || ''; receipts = ((await window.mvl.receipts()).receipts || []).filter((r) => r.path); } catch { receipts = []; }
      drawReceipts();
    }
    const search = window.MVL.makeSearch({ placeholder: 'Find a receipt', label: 'Find a receipt', onChange: drawReceipts });
    $('[data-rs]').append(search.el);
    function drawReceipts() {
      const box = $('[data-receipts]');
      if (!receipts.length) { box.innerHTML = '<p class="small">No receipts yet. A receipt is written for every fresh build.</p>'; return; }
      const shown = receipts.filter((r) => !search.active() || search.test([r.repository, r.commit, r.verdict, r.runId].join(' '))).slice(0, 30);
      box.innerHTML = shown.length ? shown.map((r) => `<div class="run"><span class="what mono small">${esc(r.repository || r.runId)}@${esc(String(r.commit || '').slice(0, 10))} &middot; ${esc(r.verdict || '')}</span><button type="button" class="btn sm" data-file="${esc(r.path)}">receipt.json in VS Code</button><button type="button" class="btn sm" data-dir="${esc(r.path)}">Run folder as workspace</button></div>`).join('') : '<p class="small">No receipt matches.</p>';
    }
    const dirOf = (p) => p.replace(/[\\/][^\\/]*$/, '');
    const join = (a, b) => a.replace(/[\\/]+$/, '') + (a.includes('\\') ? '\\' : '/') + b;

    el.addEventListener('change', async (e) => {
      if (e.target.name !== 'ged-editor') return;
      const r = await api().choose(e.target.value);
      if (r.ok) toast(`${r.chosen.name} is now your editor.`); else toast(r.error, 'error');
    });
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-dl')) { await api().downloadVsCode(); return; }
      if (b.hasAttribute('data-add')) { const r = await api().add(); if (r.cancelled) return; if (!r.ok) { toast(r.error, 'error'); return; } toast(`${r.editor.name} added and chosen.`); await loadEditors(); return; }
      if (b.hasAttribute('data-forget')) { await api().forgetCustom(); await loadEditors(); toast('The added program was forgotten.'); return; }
      if (b.dataset.open) {
        if (!root) { toast('The state root is not known yet.', 'error'); return; }
        const target = b.dataset.open === 'runs' ? join(root, 'runs') : root;
        report(await api().open(target, b.dataset.ed || null), toast); return;
      }
      if (b.dataset.pick) { report(await api().pickAndOpen(b.dataset.pick === 'folder', null), toast); return; }
      if (b.dataset.file) { report(await api().open(b.dataset.file, 'vscode'), toast); return; }
      if (b.dataset.dir) { report(await api().open(dirOf(b.dataset.dir), 'vscode'), toast); }
    });
    loadEditors(); loadReceipts();
  }

  if (window.MVLTools) window.MVLTools.register({ id: 'external-editor', title: 'External editor', group: 'Files', summary: 'Open the state root, runs and receipts in VS Code or your chosen editor', mount });
  if (window.MVLContext && window.mvlEditor) {
    window.MVLContext.register('#rList article.card', (card) => [
      { label: 'Open receipt.json in VS Code', shortcut: '', run: async () => { const p = await receiptPathFor(card); if (!p) { window.MVL.toast('This receipt has no file path.', 'error'); return; } report(await api().open(p, 'vscode'), (m, k) => window.MVL.toast(m, k)); } },
      { label: 'Open the run folder in VS Code', shortcut: '', run: async () => { const p = await receiptPathFor(card); if (!p) { window.MVL.toast('This receipt has no file path.', 'error'); return; } report(await api().open(p.replace(/[\\/][^\\/]*$/, ''), 'vscode'), (m, k) => window.MVL.toast(m, k)); } }
    ]);
  }
})();
