'use strict';
// Ollama models tool. Everything that touches Ollama goes through window.mvlOllama (main process,
// fixed loopback endpoint). This page never reaches the network itself. When Ollama is missing or
// stopped it says so and offers the next step; it never shows invented models.
(function () {
  const S = window.MVLSys;
  const { esc, fmtBytes } = S;
  const CHAT_KEY = 'mvl.ollama.chats.v1';
  const PARAMS = [['temperature', 'Temperature', 0.8, 0, 2, 0.1, 'Higher is more varied, lower is more focused.'], ['top_p', 'Top P', 0.9, 0, 1, 0.05, 'Only sample from the most likely words that add up to this share.'], ['top_k', 'Top K', 40, 1, 1000, 1, 'Only sample from this many likely words.'], ['num_ctx', 'Context window', 4096, 256, 131072, 256, 'How many tokens the model keeps in mind. More uses more memory.'], ['seed', 'Seed', '', -2147483648, 2147483647, 1, 'Leave empty for a different answer each time; set it to repeat one.']];

  function mount(el, ctx) {
    const api = window.mvlOllama;
    el.classList.add('sys-root');
    if (!api) { el.innerHTML = S.unavailable('Ollama tools are not connected', 'This window was opened without the Ollama bridge, so nothing here can reach Ollama.'); return; }
    let status = null, models = [], sys = null, caps = new Map();
    const pulls = new Map(); // id -> item
    let queue = store('mvl.ollama.queue.v1', []);
    let chats = S.store.get(CHAT_KEY, []);
    let chatId = chats[0] ? chats[0].id : null, chatJob = null;
    let tabs = null, offEvent = null;
    function store(k, d) { return S.store.get(k, d); }

    el.innerHTML = `<section class="sys-status" aria-live="polite" data-status><h3>Checking for Ollama...</h3></section><div data-tabs></div>`;
    const statusEl = el.querySelector('[data-status]');
    tabs = S.subtabs([{ id: 'installed', label: 'Installed' }, { id: 'pull', label: 'Pull' }, { id: 'chat', label: 'Chat' }, { id: 'running', label: 'Running' }, { id: 'more', label: 'Store and profiles' }], (id, panel) => draw(id, panel), 'Ollama sections');
    el.querySelector('[data-tabs]').append(tabs.el);

    function renderStatus() {
      const s = status;
      if (!s) return;
      if (s.ok === false) { statusEl.innerHTML = `<h3>Ollama status unknown</h3><p class="errbox">${esc(s.error)}</p><button type="button" class="btn" data-act="recheck">Check again</button>`; return; }
      if (s.running) { statusEl.innerHTML = `<span class="pill lime"><span class="dot"></span>Running</span><h3>Ollama ${esc(s.version)} on 127.0.0.1:11434</h3><button type="button" class="btn sm" data-act="recheck">Check again</button>`; return; }
      statusEl.innerHTML = s.installed
        ? `<span class="pill amber"><span class="dot"></span>Installed, not running</span><h3>Ollama is installed but not answering</h3><p class="sys-meta">${esc(s.reason || '')} Start it to list, pull and chat with models.</p><div class="sys-row"><button type="button" class="btn primary" data-act="start">Start Ollama</button><button type="button" class="btn" data-act="recheck">Check again</button></div>`
        : `<span class="pill red"><span class="dot"></span>Not installed</span><h3>Ollama was not found on this computer</h3><p class="sys-meta">${esc(s.reason || '')} The one-click managed installer is not built into this release yet. Get Ollama opens the official download page in your browser; after installing, press Check again.</p><div class="sys-row"><button type="button" class="btn primary" data-act="download">Get Ollama</button><button type="button" class="btn" data-act="recheck">Check again</button></div>`;
    }
    statusEl.addEventListener('click', async (e) => {
      const a = e.target.closest('[data-act]'); if (!a) return;
      if (a.dataset.act === 'recheck') return refresh();
      if (a.dataset.act === 'download') { const r = await api.openDownload(); ctx.toast(r.ok ? 'Opened ' + r.url + ' in your browser.' : 'Could not open the browser.', r.ok ? undefined : 'error'); }
      if (a.dataset.act === 'start') { a.disabled = true; a.textContent = 'Starting...'; const r = await api.start(); ctx.toast(r.ok ? 'Ollama ' + r.version + ' is running.' : r.error, r.ok ? undefined : 'error'); refresh(); }
    });

    async function refresh() {
      status = await api.status(); renderStatus();
      sys = await api.system().catch(() => null);
      if (status.running) { const l = await api.list(); models = l.ok ? l.models : []; if (!l.ok) ctx.toast(l.error, 'error'); } else models = [];
      draw(tabs.current || 'installed', tabs.panel);
    }
    const notRunning = () => S.unavailable(status && status.installed ? 'Ollama is not running' : 'Ollama is not installed', status && status.installed ? 'Start Ollama with the button above, then this section fills in.' : 'Install Ollama with Get Ollama above, then press Check again.');

    function draw(id, panel) {
      if (id === 'installed') return drawInstalled(panel);
      if (id === 'pull') return drawPull(panel);
      if (id === 'chat') return drawChat(panel);
      if (id === 'running') return drawRunning(panel);
      return drawMore(panel);
    }

    // ---- Installed ----
    let instSearch = null, fitFilter = 'all', sortBy = 'name';
    function drawInstalled(panel) {
      if (!status || !status.running) { panel.innerHTML = notRunning(); return; }
      panel.innerHTML = `<div data-search></div><div class="sys-row"><div class="seg sm" role="group" aria-label="Filter by fit">${['all', 'Runs well', 'Runs with limits', 'Unlikely', 'Unknown'].map((f) => `<button type="button" data-fit="${esc(f)}" aria-pressed="${fitFilter === f}">${esc(f === 'all' ? 'All' : f)}</button>`).join('')}</div>${S.sel('sort', 'Sort by', sortBy, [['name', 'Name'], ['size', 'Size'], ['modified', 'Last changed']])}</div>
        <details class="sys-details"><summary>How the fit verdict is worked out</summary><p class="sys-meta">Each verdict uses the model's real file size from Ollama, its published parameter count and quantization, this computer's memory${sys ? ' (' + fmtBytes(sys.totalRam) + ')' : ''} and a context overhead you can change. GPU memory is not detected in this release, so the best verdict without it is Runs with limits. A model's name is never used.</p>${S.num('overhead', 'Context overhead', sys && sys.settings ? (sys.settings.contextOverheadBytes / 1024 ** 3).toFixed(1) : 1, 0, 64, 0.5, 'Memory set aside for the context window and runtime.', 'GB')}<button type="button" class="btn sm" data-act="overhead">Recalculate</button></details>
        <p class="sys-meta" role="status" data-count></p><ul class="sys-list" data-list></ul><div data-detail></div>`;
      if (!instSearch) instSearch = S.search('Search installed models', () => listInstalled(panel));
      panel.querySelector('[data-search]').append(instSearch.el);
      S.wireSteppers(panel);
      panel.querySelector('[data-k="sort"]').addEventListener('change', (e) => { sortBy = e.target.value; listInstalled(panel); });
      panel.onclick = (e) => onInstalledClick(e, panel);
      listInstalled(panel);
    }
    function listInstalled(panel) {
      const list = panel.querySelector('[data-list]'); if (!list) return;
      let rows = models.filter((m) => instSearch.test([m.name, m.details.family, m.details.parameter_size, m.details.quantization_level, m.fit.verdict].join(' ')));
      if (fitFilter !== 'all') rows = rows.filter((m) => m.fit.verdict === fitFilter);
      rows.sort((a, b) => sortBy === 'size' ? b.size - a.size : sortBy === 'modified' ? String(b.modified).localeCompare(String(a.modified)) : a.name.localeCompare(b.name));
      panel.querySelector('[data-count]').textContent = models.length ? `${rows.length} of ${models.length} installed models` : 'No models are installed yet. Use Pull to download one.';
      list.innerHTML = rows.map((m) => `<li class="sys-item"><div class="sys-row"><h4 class="grow">${esc(m.name)}</h4>${m.running ? '<span class="pill cyan"><span class="dot"></span>Loaded</span>' : ''}<span class="pill ${S.pill(m.fit.verdict)}">${esc(m.fit.verdict)}</span></div>
        <div class="sys-meta">${esc(fmtBytes(m.size))} &middot; ${esc(m.details.parameter_size || 'parameters not published')} &middot; ${esc(m.details.quantization_level || 'quantization not published')} &middot; ${esc(m.details.family || 'family not published')}</div>
        <details class="sys-details"><summary>Fit evidence</summary><ul>${m.fit.evidence.concat(m.fit.assumptions).map((x) => `<li class="sys-meta">${esc(x)}</li>`).join('')}</ul></details>
        <div class="sys-row"><button type="button" class="btn sm" data-show="${esc(m.name)}">Details</button><button type="button" class="btn sm" data-chat="${esc(m.name)}">Chat</button><button type="button" class="btn sm" data-copy="${esc(m.name)}">Copy as...</button><button type="button" class="btn sm danger" data-del="${esc(m.name)}">Delete</button></div></li>`).join('');
    }
    async function onInstalledClick(e, panel) {
      const t = e.target;
      const f = t.closest('[data-fit]'); if (f) { fitFilter = f.dataset.fit; for (const b of panel.querySelectorAll('[data-fit]')) b.setAttribute('aria-pressed', String(b === f)); return listInstalled(panel); }
      if (t.closest('[data-act="overhead"]')) { const r = await api.setOverhead(S.value(panel, 'overhead')); if (!r.ok) return ctx.toast(r.error, 'error'); return refresh(); }
      const show = t.closest('[data-show]');
      if (show) {
        const d = panel.querySelector('[data-detail]'); d.innerHTML = '<p class="sys-meta">Reading model details...</p>';
        const r = await api.show(show.dataset.show);
        if (!r.ok) { d.innerHTML = `<p class="errbox">${esc(r.error)}</p>`; return; }
        caps.set(r.model, r.capabilities);
        d.innerHTML = `<section class="card" aria-label="Details for ${esc(r.model)}"><h3>${esc(r.model)}</h3><dl class="sys-kv"><dt>Capabilities</dt><dd>${r.capabilities ? esc(r.capabilities.join(', ') || 'none listed') : 'This Ollama version does not report capabilities.'}</dd><dt>Family</dt><dd>${esc(r.details.family || 'not published')}</dd><dt>Parameters</dt><dd>${esc(r.details.parameter_size || 'not published')}</dd><dt>Quantization</dt><dd>${esc(r.details.quantization_level || 'not published')}</dd><dt>Format</dt><dd>${esc(r.details.format || 'not published')}</dd></dl>${r.parameters ? `<h4>Default parameters</h4><pre class="sys-code">${esc(r.parameters)}</pre>` : ''}${r.template ? `<details class="sys-details"><summary>Prompt template</summary><pre class="sys-code">${esc(r.template)}</pre></details>` : ''}${r.license ? `<details class="sys-details"><summary>License</summary><pre class="sys-code">${esc(r.license.slice(0, 4000))}</pre></details>` : ''}</section>`;
        d.querySelector('h3').scrollIntoView({ block: 'nearest' });
        return;
      }
      const c = t.closest('[data-chat]'); if (c) { newChat(c.dataset.chat); tabs.select('chat', true); return; }
      const cp = t.closest('[data-copy]');
      if (cp) {
        const d = panel.querySelector('[data-detail]');
        d.innerHTML = `<section class="card"><h3>Copy ${esc(cp.dataset.copy)}</h3>${S.txt('dest', 'New name', cp.dataset.copy.split(':')[0] + ':copy', 'Letters, numbers, dots, dashes, slashes and one colon before the tag.')}<div class="sys-row"><button type="button" class="btn primary" data-docopy="${esc(cp.dataset.copy)}">Make the copy</button></div></section>`;
        d.querySelector('input').focus(); return;
      }
      const dc = t.closest('[data-docopy]');
      if (dc) { const r = await api.copy({ source: dc.dataset.docopy, destination: S.value(panel, 'dest') }); ctx.toast(r.ok ? 'Copied.' : r.error, r.ok ? undefined : 'error'); if (r.ok) refresh(); return; }
      const del = t.closest('[data-del]');
      if (del) {
        const m = models.find((x) => x.name === del.dataset.del);
        const ok = await ctx.confirm({ action: `Delete the model ${del.dataset.del}`, affected: `Its ${fmtBytes(m ? m.size : 0)} of files are removed from this computer. Chats that used it stay. Pull it again to get it back.` });
        if (!ok) return ctx.toast('Nothing was deleted.');
        const r = await api.delete(del.dataset.del); ctx.toast(r.ok ? 'Deleted ' + del.dataset.del + '.' : r.error, r.ok ? undefined : 'error'); if (r.ok) refresh();
      }
    }

    // ---- Pull (batch) ----
    function drawPull(panel) {
      const free = sys && sys.freeDisk != null ? fmtBytes(sys.freeDisk) + ' free where models are stored' : 'Free space where models are stored could not be read';
      panel.innerHTML = `<section class="card"><h3>Pull models</h3><p class="sys-meta">A pull downloads a model from the Ollama library into this computer. There is no price, account or purchase. ${esc(free)}.</p>
        ${S.txt('model', 'Model and tag', '', 'For example llama3.2:3b or qwen3:8b. The full library browser is not built yet, so type the exact name shown on the model page.', 'autocomplete="off" aria-describedby=""')}
        <p class="errbox" data-err hidden></p>
        <div class="sys-row"><button type="button" class="btn" data-act="add">Add to batch</button>${S.num('par', 'Pulls at once', store('mvl.ollama.par', 1), 1, 3, 1, 'More at once can be faster but shares your connection.')}</div>
        <ul class="sys-list" data-queue aria-label="Batch"></ul>
        <div class="sys-row"><button type="button" class="btn primary" data-act="go" ${status && status.running ? '' : 'disabled'}>Start pulls</button>${status && status.running ? '' : '<span class="sys-meta">Start Ollama first.</span>'}<button type="button" class="btn" data-act="clear">Clear finished</button></div></section>`;
      S.wireSteppers(panel);
      renderQueue(panel);
      panel.querySelector('[data-k="model"]').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addToQueue(panel); } });
      panel.onclick = async (e) => {
        const a = e.target.closest('[data-act]'); const cancel = e.target.closest('[data-pullcancel]'); const rm = e.target.closest('[data-rm]');
        if (cancel) { await api.cancel(cancel.dataset.pullcancel); return; }
        if (rm) { queue = queue.filter((q) => q.key !== rm.dataset.rm); saveQueue(); return renderQueue(panel); }
        if (!a) return;
        if (a.dataset.act === 'add') addToQueue(panel);
        if (a.dataset.act === 'clear') { queue = queue.filter((q) => !['pulled', 'cancelled', 'failed'].includes(q.state)); saveQueue(); renderQueue(panel); }
        if (a.dataset.act === 'go') { S.store.set('mvl.ollama.par', S.value(panel, 'par')); runQueue(panel); }
      };
    }
    const validName = (n) => /^[A-Za-z0-9][A-Za-z0-9._\-/:]*$/.test(n) && n.length <= 200 && !n.includes('..') && !n.includes('//') && (n.match(/:/g) || []).length <= 1 && !/[:/]$/.test(n);
    function addToQueue(panel) {
      const name = String(S.value(panel, 'model') || '').trim(); const err = panel.querySelector('[data-err]');
      if (!validName(name)) { err.hidden = false; err.textContent = 'Use a model name such as llama3.2 or llama3.2:3b, without spaces.'; return; }
      err.hidden = true;
      if (queue.some((q) => q.name === name && q.state === 'waiting')) return ctx.toast('That model is already in the batch.');
      queue.push({ key: name + '-' + Date.now(), name, state: 'waiting', completed: 0, total: 0, status: '' }); saveQueue(); renderQueue(panel);
      panel.querySelector('[data-k="model"]').value = '';
    }
    function saveQueue() { S.store.set('mvl.ollama.queue.v1', queue.map((q) => ({ ...q, state: q.state === 'pulling' ? 'waiting' : q.state }))); }
    function renderQueue(panel) {
      const ul = panel.querySelector('[data-queue]'); if (!ul) return;
      ul.innerHTML = queue.length ? queue.map((q) => { const pct = q.total ? Math.round(q.completed / q.total * 100) : 0; return `<li class="sys-item"><div class="sys-row"><h4 class="grow">${esc(q.name)}</h4><span class="pill ${{ pulled: 'lime', failed: 'red', cancelled: 'amber', pulling: 'cyan' }[q.state] || ''}">${esc({ waiting: 'Waiting', pulling: 'Pulling', pulled: 'Pulled', failed: 'Failed', cancelled: 'Cancelled' }[q.state])}</span></div>${q.state === 'pulling' ? `<div class="sys-progress ${q.total ? '' : 'indeterminate'}" role="progressbar" aria-label="Pull progress for ${esc(q.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>` : ''}<div class="sys-meta">${esc(q.status || '')}${q.total ? ` &middot; ${fmtBytes(q.completed)} of ${fmtBytes(q.total)}` : ''}${q.error ? ` &middot; ${esc(q.error)}` : ''}</div><div class="sys-row">${q.state === 'pulling' && q.id ? `<button type="button" class="btn sm" data-pullcancel="${esc(q.id)}">Cancel</button>` : ''}${q.state !== 'pulling' ? `<button type="button" class="btn sm" data-rm="${esc(q.key)}">Remove from batch</button>` : ''}</div></li>`; }).join('') : '<li class="sys-meta">The batch is empty.</li>';
      const done = queue.filter((q) => q.state === 'pulled').length, bad = queue.filter((q) => q.state === 'failed' || q.state === 'cancelled').length;
      if (queue.length && !queue.some((q) => q.state === 'waiting' || q.state === 'pulling')) ul.insertAdjacentHTML('beforeend', `<li class="${bad ? 'warn' : 'note'}" role="status">${done} pulled, ${bad} not pulled${bad ? '. The batch is partial; models that were already installed were left as they were.' : '.'}</li>`);
    }
    function runQueue(panel) {
      const par = Math.max(1, Math.min(3, Number(S.value(panel, 'par')) || 1));
      const active = () => queue.filter((q) => q.state === 'pulling').length;
      const next = async () => {
        while (active() < par) {
          const q = queue.find((x) => x.state === 'waiting'); if (!q) break;
          q.state = 'pulling'; q.status = 'Starting'; renderQueue(tabs.panel);
          const r = await api.pull(q.name);
          if (!r.ok) { q.state = 'failed'; q.error = r.error; renderQueue(tabs.panel); continue; }
          q.id = r.id; pulls.set(r.id, { q, next });
        }
        saveQueue(); renderQueue(tabs.panel);
      };
      next();
    }

    // ---- Chat ----
    function saveChats() { if (!S.store.set(CHAT_KEY, chats.slice(0, 200))) ctx.toast('Chats could not be saved on this device.', 'error'); }
    function newChat(model) { const c = { id: 'c' + Date.now().toString(36), title: 'New chat', model: model || (models[0] && models[0].name) || '', system: '', options: {}, messages: [], updated: Date.now() }; chats.unshift(c); chatId = c.id; saveChats(); return c; }
    let chatSearch = null;
    function drawChat(panel) {
      const c = chats.find((x) => x.id === chatId) || null;
      panel.innerHTML = `<div class="sys-split"><nav aria-label="Chats" class="sys-panel"><button type="button" class="btn primary" data-act="new">New chat</button><div data-csearch></div><ul class="sys-list" data-chats></ul><button type="button" class="btn sm" data-act="exportall" ${chats.length ? '' : 'disabled'}>Export all chats</button></nav><section data-chatmain class="sys-panel"></section></div>`;
      if (!chatSearch) chatSearch = S.search('Search chats', () => listChats(panel));
      panel.querySelector('[data-csearch]').append(chatSearch.el);
      listChats(panel);
      drawChatMain(panel.querySelector('[data-chatmain]'), c);
      panel.onclick = (e) => onChatClick(e, panel);
    }
    function listChats(panel) {
      const ul = panel.querySelector('[data-chats]'); if (!ul) return;
      const rows = chats.filter((c) => chatSearch.test(c.title + ' ' + c.model + ' ' + c.messages.map((m) => m.content).join(' ')));
      ul.innerHTML = rows.length ? rows.map((c) => `<li><button type="button" class="tools-item" data-open="${esc(c.id)}" aria-current="${c.id === chatId}"><strong>${esc(c.title)}</strong><span>${esc(c.model || 'no model')} &middot; ${c.messages.length} messages</span></button></li>`).join('') : `<li class="sys-meta">${chats.length ? 'No chat matches.' : 'No chats yet.'}</li>`;
    }
    function drawChatMain(main, c) {
      const prevInput = main.dataset.chat === (c && c.id) && main.querySelector('[data-k="input"]') ? main.querySelector('[data-k="input"]').value : '';
      main.dataset.chat = c ? c.id : '';
      if (!c) { main.innerHTML = '<p class="sys-meta">Start a new chat to talk to an installed model. Chats stay on this device.</p>'; return; }
      const cap = caps.get(c.model);
      const vision = Array.isArray(cap) && cap.includes('vision');
      const attachReason = !c.model ? 'Pick a model first.' : cap === undefined ? 'Open Details for this model once so its capabilities are known.' : cap === null ? 'This Ollama version does not report capabilities, so image attachments stay off.' : vision ? '' : `${c.model} does not list vision, so it cannot read images. Pick a model whose Details list vision.`;
      main.innerHTML = `<div class="sys-row">${S.txt('title', 'Chat name', c.title)}${S.sel('model', 'Model', c.model, models.length ? models.map((m) => m.name) : [['', status && status.running ? 'No models installed' : 'Ollama is not running']])}</div>
        <details class="sys-details"><summary>System prompt and settings</summary><div class="field"><label for="sys-prompt-${esc(c.id)}">System prompt</label><textarea id="sys-prompt-${esc(c.id)}" data-k="system" maxlength="20000">${esc(c.system)}</textarea><small class="sys-help">Instructions the model reads before every message.</small></div><div class="sys-grid">${PARAMS.map(([k, l, d, mn, mx, st, h]) => S.num('p-' + k, l, c.options[k] != null ? c.options[k] : d, mn, mx, st, h)).join('')}</div><p class="sys-meta">Recommended defaults are filled in. Empty fields use the model's own default.</p></details>
        <div class="sys-chat" data-msgs aria-live="polite" aria-label="Messages">${c.messages.map((m) => `<div class="sys-msg ${m.role}"><span data-c>${esc(m.content)}</span>${m.images && m.images.length ? `<span class="sys-meta">${m.images.length} image(s) attached</span>` : ''}${m.stats ? `<span class="sys-meta">${esc(m.stats)}</span>` : ''}</div>`).join('') || '<p class="sys-meta">No messages yet.</p>'}</div>
        <div class="field"><label for="sys-input-${esc(c.id)}">Message</label><textarea id="sys-input-${esc(c.id)}" data-k="input" maxlength="100000" placeholder="Ask something. Ctrl+Enter sends."></textarea></div>
        <div class="sys-row"><label class="btn sm" ${attachReason ? 'aria-disabled="true"' : ''}><input type="file" accept="image/png,image/jpeg,image/webp" multiple data-k="images" class="sr" ${attachReason ? 'disabled' : ''}>Attach images</label><span class="sys-meta" data-attach>${esc(attachReason)}</span></div>
        <div class="sys-row"><button type="button" class="btn primary" data-act="send" ${chatJob || !c.model ? 'disabled' : ''}>Send</button><button type="button" class="btn" data-act="stop" ${chatJob ? '' : 'disabled'}>Stop</button><button type="button" class="btn" data-act="regen" ${chatJob || !c.messages.some((m) => m.role === 'assistant') ? 'disabled' : ''}>Regenerate</button><button type="button" class="btn sm" data-act="export">Export this chat</button><button type="button" class="btn sm danger" data-act="delchat">Delete chat</button></div>`;
      S.wireSteppers(main);
      main.querySelector('[data-k="input"]').value = prevInput;
      const msgs = main.querySelector('[data-msgs]'); msgs.scrollTop = msgs.scrollHeight;
      main.querySelector('[data-k="title"]').addEventListener('change', (e) => { c.title = e.target.value.slice(0, 80) || 'Chat'; saveChats(); listChats(tabs.panel); });
      main.querySelector('[data-k="model"]').addEventListener('change', (e) => { c.model = e.target.value; saveChats(); drawChatMain(main, c); });
      main.querySelector('[data-k="system"]').addEventListener('change', (e) => { c.system = e.target.value; saveChats(); });
      main.querySelector('[data-k="input"]').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); main.querySelector('[data-act="send"]').click(); } });
    }
    function readOptions(main) {
      const o = {};
      for (const [k, , , mn, mx] of PARAMS) { const v = S.value(main, 'p-' + k); if (v == null || v === '' || Number.isNaN(v)) continue; if (v < mn || v > mx) throw new Error(`Setting ${k} must be from ${mn} to ${mx}.`); o[k] = v; }
      return o;
    }
    async function readImages(main) {
      const inp = main.querySelector('[data-k="images"]'); if (!inp || !inp.files || !inp.files.length) return [];
      if (inp.files.length > 4) throw new Error('Attach at most 4 images.');
      const out = [];
      for (const f of inp.files) { if (f.size > 15 * 1024 * 1024) throw new Error(f.name + ' is larger than 15 MB.'); const b = new Uint8Array(await f.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode.apply(null, b.subarray(i, i + 32768)); out.push(btoa(s)); }
      return out;
    }
    async function sendChat(c, main, regen) {
      let options;
      try { options = readOptions(main); } catch (e) { return ctx.toast(e.message, 'error'); }
      c.options = options;
      if (regen) { while (c.messages.length && c.messages[c.messages.length - 1].role === 'assistant') c.messages.pop(); }
      else {
        const text = S.value(main, 'input').trim(); if (!text) return ctx.toast('Type a message first.');
        let images = []; try { images = await readImages(main); } catch (e) { return ctx.toast(e.message, 'error'); }
        c.messages.push(images.length ? { role: 'user', content: text, images } : { role: 'user', content: text });
        if (c.title === 'New chat') c.title = text.slice(0, 40);
        main.querySelector('[data-k="input"]').value = '';
      }
      const reply = { role: 'assistant', content: '' }; c.messages.push(reply); c.updated = Date.now();
      const r = await api.chat({ model: c.model, system: c.system, options, messages: c.messages.slice(0, -1).slice(-100).map((m) => (m.images ? { role: m.role, content: m.content, images: m.images } : { role: m.role, content: m.content })) });
      if (!r.ok) { c.messages.pop(); ctx.toast(r.error, 'error'); drawChatMain(main, c); return; }
      chatJob = { id: r.id, chat: c, reply, main }; saveChats(); drawChatMain(main, c); listChats(tabs.panel);
    }
    async function onChatClick(e, panel) {
      const o = e.target.closest('[data-open]'); if (o) { chatId = o.dataset.open; return drawChat(panel); }
      const a = e.target.closest('[data-act]'); if (!a) return;
      const c = chats.find((x) => x.id === chatId); const main = panel.querySelector('[data-chatmain]');
      if (a.dataset.act === 'new') { newChat(); return drawChat(panel); }
      if (a.dataset.act === 'exportall') return S.download('ollama-chats.json', JSON.stringify(chats.map(redact), null, 2));
      if (!c) return;
      if (a.dataset.act === 'send') return sendChat(c, main, false);
      if (a.dataset.act === 'regen') return sendChat(c, main, true);
      if (a.dataset.act === 'stop' && chatJob) return api.cancel(chatJob.id);
      if (a.dataset.act === 'export') return S.download(`chat-${c.id}.json`, JSON.stringify(redact(c), null, 2));
      if (a.dataset.act === 'delchat') {
        const ok = await ctx.confirm({ action: `Delete the chat "${c.title}"`, affected: `Its ${c.messages.length} messages are removed from this device. Export it first if you want a copy.` });
        if (!ok) return; chats = chats.filter((x) => x !== c); chatId = chats[0] ? chats[0].id : null; saveChats(); drawChat(panel);
      }
    }
    const redact = (c) => ({ title: c.title, model: c.model, system: c.system, options: c.options, messages: c.messages.map((m) => ({ role: m.role, content: m.content, images: m.images ? m.images.length + ' image(s) not exported' : undefined })) });

    // ---- Running ----
    async function drawRunning(panel) {
      if (!status || !status.running) { panel.innerHTML = notRunning(); return; }
      panel.innerHTML = '<p class="sys-meta">Reading loaded models...</p>';
      const r = await api.ps();
      if (tabs.current !== 'running') return;
      if (!r.ok) { panel.innerHTML = `<p class="errbox">${esc(r.error)}</p>`; return; }
      panel.innerHTML = `<div class="sys-row"><button type="button" class="btn sm" data-act="reload">Refresh</button></div><ul class="sys-list">${r.models.length ? r.models.map((m) => `<li class="sys-item"><div class="sys-row"><h4 class="grow">${esc(m.name)}</h4><button type="button" class="btn sm" data-unload="${esc(m.name)}">Unload</button></div><div class="sys-meta">${fmtBytes(m.size)} in memory, ${fmtBytes(m.sizeVram)} of it on the GPU &middot; unloads at ${esc(m.expires || 'unknown')}</div></li>`).join('') : '<li class="sys-meta">No model is loaded right now. Models load when a chat starts.</li>'}</ul>`;
      panel.onclick = async (e) => {
        if (e.target.closest('[data-act="reload"]')) return drawRunning(panel);
        const u = e.target.closest('[data-unload]'); if (!u) return;
        const x = await api.unload(u.dataset.unload); ctx.toast(x.ok ? 'Unloaded ' + u.dataset.unload + '.' : x.error, x.ok ? undefined : 'error'); drawRunning(panel);
      };
    }
    function drawMore(panel) {
      panel.onclick = null;
      panel.innerHTML = [
        S.unavailable('Model Store (not built yet)', 'Ollama does not publish a documented catalogue API, and a complete, paginated library listing with every tag is not built in this release. Rather than show a hand-picked list, this section stays empty. Use Pull with an exact model name.'),
        S.unavailable('One-click managed installer (not built yet)', 'This release does not download or install Ollama for you. Get Ollama opens the official download page, ollama.com/download, in your browser.'),
        S.unavailable('Local harness profiles (not built yet)', 'Launching other programs against a local model, with preflight, snapshots and rollback, is not built in this release. Nothing here can run a program or a shell command.'),
        S.unavailable('GPU detection (not built yet)', 'GPU model and memory are not read in this release, so fit verdicts assume system memory and never say Runs well.'),
      ].join('');
    }

    offEvent = api.onEvent((d) => {
      if (!d) return;
      if (d.kind === 'pull') {
        const p = pulls.get(d.id); if (!p) return;
        const q = p.q;
        if (d.type === 'progress') { q.status = d.status; if (d.total) { q.total = d.total; q.completed = d.completed; } }
        else { q.state = d.type === 'done' ? 'pulled' : d.type === 'cancelled' ? 'cancelled' : 'failed'; q.error = d.error || ''; pulls.delete(d.id); saveQueue(); if (d.type === 'done') ctx.notify({ kind: 'success', title: 'Model pulled', body: q.name + ' is ready.' }); p.next(); if (d.type === 'done') refresh(); }
        if (tabs.current === 'pull') renderQueue(tabs.panel);
      }
      if (d.kind === 'chat' && chatJob && d.id === chatJob.id) {
        const j = chatJob;
        if (d.type === 'token') { j.reply.content += d.content; const last = j.main.isConnected && j.main.querySelector('[data-msgs] .sys-msg.assistant:last-child [data-c]'); if (last) { last.textContent = j.reply.content; const box = j.main.querySelector('[data-msgs]'); box.scrollTop = box.scrollHeight; } return; }
        else if (d.type === 'stats') { if (d.evalCount && d.evalDuration) j.reply.stats = `${d.evalCount} tokens at ${(d.evalCount / (d.evalDuration / 1e9)).toFixed(1)} per second`; }
        else { if (d.type !== 'done') j.reply.stats = d.type === 'cancelled' ? 'Stopped before the end.' : 'Failed: ' + d.error; chatJob = null; saveChats(); }
        if (tabs.current === 'chat' && j.main.isConnected) drawChatMain(j.main, j.chat);
      }
    }) || null;

    tabs.select('installed');
    refresh();
    return () => { if (typeof offEvent === 'function') offEvent(); };
  }

  let cleanup = null;
  window.MVLTools.register({ id: 'ollama-suite', title: 'Ollama models', group: 'System', summary: 'Local models: install state, pull, chat and unload', mount(el, ctx) { cleanup = mount(el, ctx); }, unmount() { if (typeof cleanup === 'function') cleanup(); cleanup = null; } });
})();
