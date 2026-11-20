'use strict';
// Minecraft servers tool: creator, manager and world generator. All work happens in the main
// process through window.mvlMinecraft (strict allowlist). The EULA is shown here and accepted only
// by the person ticking the box; nothing accepts it on their behalf.
(function () {
  const S = window.MVLSys;
  const { esc, fmtBytes } = S;
  const TYPES = [['release', 'Releases'], ['snapshot', 'Snapshots'], ['old_beta', 'Old beta'], ['old_alpha', 'Old alpha']];

  function mount(el, ctx) {
    const api = window.mvlMinecraft;
    el.classList.add('sys-root');
    if (!api) { el.innerHTML = S.unavailable('Minecraft tools are not connected', 'This window was opened without the Minecraft bridge, so servers cannot be created or managed here.'); return; }
    let servers = [], selected = null, view = 'list', catalogue = null, typeFilter = new Set(['release']), verSearch = null, javaList = null;
    const consoles = new Map(); const states = new Map();
    let dl = null, gen = null, extracted = new Map();

    el.innerHTML = `<section class="card" aria-labelledby="mc-targets"><h3 id="mc-targets">Where servers run</h3><ul class="sys-grid sys-list" data-targets><li class="sys-meta">Checking targets...</li></ul></section><div class="sys-split"><nav class="sys-panel" aria-label="Servers"><button type="button" class="btn primary" data-act="new">New server</button><ul class="sys-list" data-servers></ul></nav><section class="sys-panel" data-main aria-live="polite"></section></div>`;
    const main = el.querySelector('[data-main]');
    el.querySelector('nav').addEventListener('click', (e) => {
      if (e.target.closest('[data-act="new"]')) { selected = null; view = 'new'; return drawMain(); }
      const s = e.target.closest('[data-server]'); if (s) { selected = s.dataset.server; view = 'server'; drawMain(); }
    });

    async function loadTargets() {
      const r = await api.targets();
      el.querySelector('[data-targets]').innerHTML = r.ok ? r.targets.map((t) => `<li class="sys-item"><div class="sys-row"><h4 class="grow">${esc(t.label)}</h4><span class="pill ${t.available ? 'lime' : ''}">${t.available ? 'Available' : 'Unavailable'}</span></div><span class="sys-meta">${esc(t.detail)}</span></li>`).join('') : `<li class="errbox">${esc(r.error)}</li>`;
    }
    async function loadServers() {
      const r = await api.list();
      servers = r.ok ? r.servers : [];
      el.querySelector('[data-servers]').innerHTML = servers.length ? servers.map((s) => `<li><button type="button" class="tools-item" data-server="${esc(s.id)}" aria-current="${s.id === selected}"><strong>${esc(s.name)}</strong><span>${esc(s.flavour === 'paper' ? 'Paper' : 'Vanilla')} ${esc(s.version)} &middot; ${states.get(s.id) === 'running' || s.running ? 'running' : 'stopped'}</span></button></li>`).join('') : '<li class="sys-meta">No servers yet.</li>';
      if (!selected && view === 'list') { view = servers.length ? 'server' : 'new'; selected = servers[0] ? servers[0].id : null; drawMain(); }
    }

    function drawMain() {
      for (const b of el.querySelectorAll('[data-server]')) b.setAttribute('aria-current', String(b.dataset.server === selected));
      if (view === 'new') return drawNew();
      const s = servers.find((x) => x.id === selected); if (!s) { main.innerHTML = '<p class="sys-meta">Pick a server or create a new one.</p>'; return; }
      main.innerHTML = `<h3>${esc(s.name)}</h3><div data-stabs></div>`;
      const t = S.subtabs([{ id: 'overview', label: 'Overview' }, { id: 'console', label: 'Console' }, { id: 'settings', label: 'Settings' }, { id: 'world', label: 'World generator' }], (id, panel) => drawServerTab(s, id, panel), 'Server sections');
      main.querySelector('[data-stabs]').append(t.el); t.select('overview');
    }

    // ---- New server ----
    let flavour = 'vanilla', pickedVersion = null, paperVersions = null, paperBuilds = null;
    async function drawNew() {
      main.innerHTML = `<h3>New server</h3><div class="seg sm" role="group" aria-label="Flavour"><button type="button" data-fl="vanilla" aria-pressed="${flavour === 'vanilla'}">Vanilla Java</button><button type="button" data-fl="paper" aria-pressed="${flavour === 'paper'}">Paper</button><button type="button" data-fl="bedrock" aria-pressed="${flavour === 'bedrock'}">Bedrock</button></div><div data-new class="sys-panel"></div>`;
      main.onclick = (e) => { const f = e.target.closest('[data-fl]'); if (f) { flavour = f.dataset.fl; pickedVersion = null; drawNew(); } };
      const box = main.querySelector('[data-new]');
      if (flavour === 'bedrock') { box.innerHTML = S.unavailable('Bedrock servers are not built yet', 'Mojang publishes Bedrock server downloads only on a web page, with no machine-readable catalogue or published checksums, so this release cannot list or verify them.'); return; }
      if (flavour === 'paper') return drawPaper(box);
      box.innerHTML = '<p class="sys-meta">Reading the official version catalogue...</p>';
      const r = await api.versions({ refresh: false });
      if (!r.ok) { box.innerHTML = `<p class="errbox">${esc(r.error)}</p><button type="button" class="btn" data-act="retry">Try again</button>`; box.onclick = (e) => { if (e.target.closest('[data-act="retry"]')) drawNew(); }; return; }
      catalogue = r;
      box.innerHTML = `<p class="sys-meta">${r.count} versions from Mojang's official catalogue, read ${esc(new Date(r.fetchedAt).toLocaleString())}${r.stale ? `. <strong>Offline: showing the last saved copy.</strong> ${esc(r.error)}` : ''}. Every entry is listed; whether a version has a dedicated server download is checked when you pick it.</p>
        <div class="sys-row"><div class="seg sm" role="group" aria-label="Channels">${TYPES.map(([k, l]) => `<button type="button" data-type="${k}" aria-pressed="${typeFilter.has(k)}">${l} <span class="n">${r.versions.filter((v) => v.type === k).length}</span></button>`).join('')}</div><button type="button" class="btn sm" data-act="refresh">Refresh catalogue</button></div>
        <div data-vsearch></div><ul class="sys-list" data-versions aria-label="Versions"></ul><div data-pick></div>`;
      if (!verSearch) verSearch = S.search('Search versions', () => listVersions(box));
      box.querySelector('[data-vsearch]').append(verSearch.el);
      listVersions(box);
      box.onclick = async (e) => {
        const ty = e.target.closest('[data-type]'); if (ty) { if (typeFilter.has(ty.dataset.type)) typeFilter.delete(ty.dataset.type); else typeFilter.add(ty.dataset.type); ty.setAttribute('aria-pressed', String(typeFilter.has(ty.dataset.type))); return listVersions(box); }
        if (e.target.closest('[data-act="refresh"]')) { await api.versions({ refresh: true }); return drawNew(); }
        if (e.target.closest('[data-act="more"]')) { box.dataset.limit = String((Number(box.dataset.limit) || 100) + 200); return listVersions(box); }
        const v = e.target.closest('[data-ver]'); if (v) pickVersion(box, v.dataset.ver);
        if (e.target.closest('[data-act="create"]')) createServer(box);
        if (e.target.closest('[data-act="cancel-dl"]') && dl) api.cancel(dl);
      };
    }
    function listVersions(box) {
      const ul = box.querySelector('[data-versions]'); if (!ul || !catalogue) return;
      const limit = Number(box.dataset.limit) || 100;
      const rows = catalogue.versions.filter((v) => typeFilter.has(v.type) && verSearch.test(v.id + ' ' + v.type));
      ul.innerHTML = rows.slice(0, limit).map((v) => `<li><button type="button" class="tools-item" data-ver="${esc(v.id)}" aria-current="${v.id === pickedVersion}"><strong>${esc(v.id)}</strong><span>${esc(v.type)} &middot; ${esc(String(v.releaseTime).slice(0, 10))}</span></button></li>`).join('') + (rows.length > limit ? `<li><button type="button" class="btn sm" data-act="more">Show more (${rows.length - limit} left)</button></li>` : '') + (rows.length ? '' : '<li class="sys-meta">No version matches.</li>');
    }
    async function pickVersion(box, id) {
      pickedVersion = id; listVersions(box);
      const pick = box.querySelector('[data-pick]'); pick.innerHTML = '<p class="sys-meta">Checking the version metadata...</p>';
      const r = await api.versionInfo(id);
      if (!r.ok) { pick.innerHTML = `<p class="errbox">${esc(r.error)}</p>`; return; }
      pick.innerHTML = `<section class="card"><h3>${esc(id)}</h3><dl class="sys-kv"><dt>Server download</dt><dd>${r.server ? `${fmtBytes(r.server.size)}, SHA-1 ${esc(r.server.sha1)}` : esc(r.reason)}</dd><dt>Java</dt><dd>${r.javaMajor ? 'Java ' + r.javaMajor + ' or newer' : esc(r.javaReason)}</dd></dl>${r.server ? `${S.txt('name', 'Server name', 'Server ' + id, 'Shown in this app only.', 'maxlength="60"')}<div class="sys-row"><button type="button" class="btn primary" data-act="create">Download and create</button></div><div data-dl></div>` : ''}</section>`;
    }
    async function drawPaper(box) {
      box.innerHTML = '<p class="sys-meta">Reading Paper versions from PaperMC...</p>';
      const r = paperVersions || await api.paperVersions();
      if (!r.ok) { box.innerHTML = `<p class="errbox">${esc(r.error)}</p>`; return; }
      paperVersions = r;
      box.innerHTML = `<p class="sys-meta">${r.versions.length} Paper versions from ${esc(r.source)}. Paper is a third-party server; downloads are checked against PaperMC's published SHA-256.</p>${S.sel('pv', 'Paper version', pickedVersion || r.versions[0], r.versions)}<div data-builds></div>`;
      const load = async () => {
        pickedVersion = S.value(box, 'pv'); const b = box.querySelector('[data-builds]'); b.innerHTML = '<p class="sys-meta">Reading builds...</p>';
        const x = await api.paperBuilds(pickedVersion); paperBuilds = x.ok ? x.builds : [];
        b.innerHTML = x.ok ? (paperBuilds.length ? `${S.sel('build', 'Build', paperBuilds[0].id, paperBuilds.map((y) => [y.id, `#${y.id} ${y.channel} ${y.time.slice(0, 10)} (${fmtBytes(y.size)})`]), 'The newest build is recommended. Builds marked BETA or ALPHA are experimental.')}${S.txt('name', 'Server name', 'Paper ' + pickedVersion, '', 'maxlength="60"')}<div class="sys-row"><button type="button" class="btn primary" data-act="create">Download and create</button></div><div data-dl></div>` : '<p class="sys-meta">PaperMC lists no builds with a verifiable download for this version.</p>') : `<p class="errbox">${esc(x.error)}</p>`;
      };
      box.querySelector('[data-k="pv"]').addEventListener('change', load); load();
      box.onclick = (e) => { if (e.target.closest('[data-act="create"]')) createServer(box); if (e.target.closest('[data-act="cancel-dl"]') && dl) api.cancel(dl); };
    }
    async function createServer(box) {
      const name = String(S.value(box, 'name') || '').trim();
      const req = flavour === 'paper' ? { name, flavour, version: pickedVersion, build: Number(S.value(box, 'build')) } : { name, flavour, version: pickedVersion };
      const d = box.querySelector('[data-dl]');
      d.innerHTML = `<div class="sys-progress indeterminate" role="progressbar" aria-label="Download progress"><span></span></div><p class="sys-meta" data-dlt>Starting the download...</p><button type="button" class="btn sm" data-act="cancel-dl">Cancel</button>`;
      for (const b of box.querySelectorAll('[data-act="create"]')) b.disabled = true;
      const r = await api.create(req); dl = null;
      if (!r.ok) { d.innerHTML = `<p class="${r.cancelled ? 'warn' : 'errbox'}">${esc(r.cancelled ? 'Cancelled. The partial file was removed.' : r.error)}</p>`; for (const b of box.querySelectorAll('[data-act="create"]')) b.disabled = false; return; }
      ctx.notify({ kind: 'success', title: 'Server created', body: `${r.server.name} downloaded and verified (${r.server.jar.algo.toUpperCase()} matched).` });
      selected = r.server.id; view = 'server'; await loadServers(); drawMain();
    }

    // ---- Server tabs ----
    function drawServerTab(s, id, panel) {
      panel.onclick = null; panel.oninput = null; panel.onchange = null;
      if (id === 'overview') return drawOverview(s, panel);
      if (id === 'console') return drawConsole(s, panel);
      if (id === 'settings') return drawSettings(s, panel);
      return drawWorld(s, panel);
    }
    async function drawOverview(s, panel) {
      const [eula, jl] = await Promise.all([api.eula(s.id), javaList ? Promise.resolve({ ok: true, runtimes: javaList }) : api.java()]);
      javaList = jl.ok ? jl.runtimes : [];
      const running = states.get(s.id) === 'running' || states.get(s.id) === 'starting' || s.running;
      const fits = javaList.filter((j) => !s.javaMajor || j.major >= s.javaMajor);
      panel.innerHTML = `<dl class="sys-kv"><dt>Flavour</dt><dd>${s.flavour === 'paper' ? 'Paper build ' + esc(s.build) : 'Vanilla'}</dd><dt>Version</dt><dd>${esc(s.version)}</dd><dt>Server file</dt><dd>${fmtBytes(s.jar.size)}, ${esc(s.jar.algo.toUpperCase())} ${esc(s.jar.digest)} (verified at download)</dd><dt>Java needed</dt><dd>${s.javaMajor ? 'Java ' + s.javaMajor + ' or newer' : 'Not stated in the version metadata'}</dd><dt>State</dt><dd>${running ? 'Running' : 'Stopped'}</dd></dl>
        ${eula.accepted ? '<p class="note">You accepted the Minecraft EULA for this server.</p>' : `<section class="card" aria-labelledby="eula-h"><h3 id="eula-h">Minecraft End User License Agreement</h3><p>Running a Minecraft server requires agreeing to the Minecraft EULA. Read it, then tick the box if you agree. This app never accepts it for you.</p><div class="sys-row"><button type="button" class="btn" data-act="openeula">Read the EULA in your browser</button></div><label class="switch-row"><span>I have read and accept the Minecraft EULA</span><input type="checkbox" role="switch" data-k="eulaok"></label><button type="button" class="btn primary" data-act="accepteula" disabled>Accept and save</button></section>`}
        <section class="card"><h3>Java and memory</h3>${javaList.length ? S.sel('java', 'Java runtime', s.javaPath || (fits[0] && fits[0].path) || javaList[0].path, javaList.map((j) => [j.path, `Java ${j.major}: ${j.path}${s.javaMajor && j.major < s.javaMajor ? ' (too old for this version)' : ''}`])) : '<p class="warn">No Java runtime was found on this computer. Install Java' + (s.javaMajor ? ' ' + s.javaMajor + ' or newer' : '') + ', then press Detect Java.</p>'}
        ${S.num('mem', 'Maximum memory', s.memMb, 512, 262144, 256, 'The most memory the server may use.', 'MB')}<div class="sys-row"><button type="button" class="btn sm" data-act="detect">Detect Java</button><button type="button" class="btn sm" data-act="saveruntime">Save</button></div></section>
        <div class="sys-row"><button type="button" class="btn primary" data-act="start" ${running ? 'disabled' : ''}>Start</button><button type="button" class="btn" data-act="stop" ${running ? '' : 'disabled'}>Stop</button><button type="button" class="btn danger" data-act="kill" ${running ? '' : 'disabled'}>Force stop</button><button type="button" class="btn" data-act="backup" ${running ? 'disabled' : ''}>Back up world</button><button type="button" class="btn" data-act="folder">Open folder</button><button type="button" class="btn danger" data-act="remove" ${running ? 'disabled' : ''}>Remove server</button></div>
        <details class="sys-details"><summary>Not built yet</summary><ul class="sys-meta"><li>Players, operators, allowlist and bans editors.</li><li>Plugin, mod and pack installers.</li><li>Restoring a backup, version switching and rollback.</li><li>Scheduled restarts and resource monitoring.</li></ul></details>`;
      S.wireSteppers(panel);
      const ok = panel.querySelector('[data-k="eulaok"]'); if (ok) ok.addEventListener('change', () => { panel.querySelector('[data-act="accepteula"]').disabled = !ok.checked; });
      panel.onclick = async (e) => {
        const a = e.target.closest('[data-act]'); if (!a) return;
        const act = a.dataset.act; let r;
        if (act === 'openeula') r = await api.openEula();
        if (act === 'accepteula') { if (!ok || !ok.checked) return; r = await api.acceptEula({ id: s.id, personAccepted: true }); if (r.ok) return drawOverview(s, panel); }
        if (act === 'detect') { javaList = null; return drawOverview(s, panel); }
        if (act === 'saveruntime') { r = await api.setRuntime({ id: s.id, javaPath: S.value(panel, 'java') || null, memMb: Number(S.value(panel, 'mem')) }); if (r.ok) { Object.assign(s, r.server); ctx.toast('Saved.'); } }
        if (act === 'start') { r = await api.start(s.id); if (r.ok) { states.set(s.id, 'starting'); ctx.toast('Starting with Java ' + r.java.major + '.'); return drawOverview(s, panel); } }
        if (act === 'stop') { a.disabled = true; a.textContent = 'Stopping...'; r = await api.stop(s.id); if (r.ok) ctx.toast('The server stopped.'); }
        if (act === 'kill') { if (!(await ctx.confirm({ action: `Force stop ${s.name}`, affected: 'The server is ended without saving. Changes since the last save can be lost and the world can be left inconsistent.' }))) return; r = await api.kill(s.id); }
        if (act === 'backup') { a.disabled = true; r = await api.backup(s.id); if (r.ok) ctx.notify({ kind: 'success', title: 'World backed up', body: `${r.files} files, ${fmtBytes(r.bytes)}, verified: ${r.file}` }); a.disabled = false; }
        if (act === 'folder') r = await api.openFolder(s.id);
        if (act === 'remove') { if (!(await ctx.confirm({ action: `Remove the server ${s.name}`, affected: 'Its folder is deleted from this computer: the server file, every world, backups and settings. This cannot be undone.' }))) return; r = await api.remove(s.id); if (r.ok) { selected = null; view = 'list'; await loadServers(); return; } }
        if (r && !r.ok) ctx.toast(r.error, 'error');
        if (['stop', 'kill'].includes(act)) drawOverview(s, panel);
      };
    }
    function drawConsole(s, panel) {
      const lines = consoles.get(s.id) || [];
      panel.innerHTML = `<pre class="log sys-console" role="log" aria-label="Server console" tabindex="0" data-log>${esc(lines.join('\n')) || 'The console shows output once the server starts.'}</pre>
        <div class="field"><label for="mc-cmd-${esc(s.id)}">Command</label><input id="mc-cmd-${esc(s.id)}" data-k="cmd" maxlength="1000" spellcheck="false" placeholder="say Hello" autocomplete="off"><small class="sys-help">Sent to the server's own console, one line at a time. It is never run as a shell command.</small></div>
        <div class="sys-row"><button type="button" class="btn primary" data-act="send">Send</button><button type="button" class="btn sm" data-q="list">Who is online</button><button type="button" class="btn sm" data-q="save-all">Save the world</button><button type="button" class="btn sm" data-q="time set day">Set day</button><button type="button" class="btn sm" data-q="weather clear">Clear weather</button></div>`;
      const log = panel.querySelector('[data-log]'); log.scrollTop = log.scrollHeight;
      const send = async (c) => { if (!c) return; const r = await api.command({ id: s.id, command: c }); if (!r.ok) ctx.toast(r.error, 'error'); else panel.querySelector('[data-k="cmd"]').value = ''; };
      panel.querySelector('[data-k="cmd"]').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(e.target.value.trim()); } });
      panel.onclick = (e) => { if (e.target.closest('[data-act="send"]')) send(S.value(panel, 'cmd').trim()); const q = e.target.closest('[data-q]'); if (q) send(q.dataset.q); };
    }
    let propSearch = null;
    async function drawSettings(s, panel) {
      panel.innerHTML = '<p class="sys-meta">Reading server.properties...</p>';
      const r = await api.readProperties(s.id);
      if (!r.ok) { panel.innerHTML = `<p class="errbox">${esc(r.error)}</p>`; return; }
      const known = new Set(r.descriptors.map((d) => d.key));
      const extra = Object.keys(r.values).filter((k) => !known.has(k));
      const control = (d) => {
        const v = r.values[d.key] != null ? r.values[d.key] : String(d.def);
        if (d.type === 'bool') return S.sw(d.key, d.key, v === 'true', d.help);
        if (d.type === 'int') return S.num(d.key, d.key, v, d.min, d.max, 1, d.help);
        if (d.type === 'enum') return S.sel(d.key, d.key, v, d.choices, d.help);
        if (d.type === 'preset') return r.presets && r.presets.length ? S.sel(d.key, d.key, v, r.presets.includes(v) ? r.presets : [v].concat(r.presets), d.help) : S.txt(d.key, d.key, v, d.help + ' Run Extract on the World generator tab to get a picker for this version.');
        if (d.type === 'secret') return `<div class="field sys-ctl"><label for="mc-${esc(d.key)}">${esc(d.key)}</label><input id="mc-${esc(d.key)}" type="password" data-k="${esc(d.key)}" value="${esc(v)}" autocomplete="new-password"><small class="sys-help">${esc(d.help)}</small></div>`;
        return S.txt(d.key, d.key, v, d.help, `maxlength="${d.max}"`);
      };
      panel.innerHTML = `<p class="${r.exists ? 'note' : 'warn'}">${r.exists ? 'Editing server.properties. A copy of the previous file is kept as server.properties.previous.' : 'server.properties does not exist yet. The server writes it on first start; saving here creates it with only the settings you change.'} These typed controls come from this app's own list of vanilla settings and are not yet checked against each exact version. A setting a version no longer reads stays in the file unchanged.${r.running ? ' The server is running: changes apply after a restart.' : ''}</p>
        <div data-psearch></div><div class="sys-grid" data-props>${r.descriptors.map((d) => `<div data-prop="${esc(d.key)}" data-text="${esc(d.key + ' ' + d.help)}">${control(d)}</div>`).join('')}</div>
        ${extra.length ? `<h4>Other settings in the file</h4><p class="sys-meta">These keys have no typed control yet, often because a plugin or a newer version added them. Their values are kept as text.</p><div class="sys-grid">${extra.map((k) => `<div data-prop="${esc(k)}" data-text="${esc(k)}">${S.txt(k, k, r.values[k], 'No typed control for this key yet.')}</div>`).join('')}</div>` : ''}
        <div class="sys-row"><button type="button" class="btn primary" data-act="save">Save changes</button><span class="sys-meta" data-changed>No changes.</span></div>`;
      S.wireSteppers(panel);
      if (!propSearch) propSearch = S.search('Search settings', () => filterProps());
      panel.querySelector('[data-psearch]').append(propSearch.el);
      function filterProps() { for (const p of panel.querySelectorAll('[data-prop]')) p.hidden = !propSearch.test(p.dataset.text); }
      filterProps();
      const original = {}; for (const p of panel.querySelectorAll('[data-prop]')) original[p.dataset.prop] = String(S.value(p, p.dataset.prop));
      const changes = () => { const c = {}; for (const p of panel.querySelectorAll('[data-prop]')) { const v = String(S.value(p, p.dataset.prop)); if (v !== original[p.dataset.prop]) c[p.dataset.prop] = v; } return c; };
      panel.oninput = () => { const n = Object.keys(changes()).length; panel.querySelector('[data-changed]').textContent = n ? n + ' unsaved change' + (n > 1 ? 's' : '') + '.' : 'No changes.'; };
      panel.onchange = () => panel.oninput();
      panel.onclick = async (e) => {
        if (!e.target.closest('[data-act="save"]')) return;
        const c = changes(); if (!Object.keys(c).length) return ctx.toast('Nothing changed.');
        const w = await api.writeProperties({ id: s.id, changes: c });
        if (!w.ok) return ctx.toast(w.error, 'error');
        ctx.toast(`Saved ${w.changed} setting${w.changed > 1 ? 's' : ''}${w.appliesAfterRestart ? '. Restart the server to apply them.' : '.'}`); drawSettings(s, panel);
      };
    }

    // ---- World generator ----
    function drawWorld(s, panel) {
      const ex = extracted.get(s.id);
      if (s.flavour !== 'vanilla') { panel.innerHTML = S.unavailable('The world generator reads a vanilla server', 'Settings are extracted from the vanilla server file of the exact version. Create a vanilla server of version ' + s.version + ' and use its World generator tab.'); return; }
      if (!ex) {
        panel.innerHTML = `<p>The generator reads the world presets, biomes, blocks, structure sets and game rules from this exact version's server file, so every picker matches ${esc(s.version)}. This runs the data generator that ships inside the server file; it does not start the server and does not need the EULA.</p><div class="sys-row"><button type="button" class="btn primary" data-act="extract">Extract settings from ${esc(s.version)}</button></div><div data-exst></div>`;
        panel.onclick = async (e) => {
          if (!e.target.closest('[data-act="extract"]')) return;
          const st = panel.querySelector('[data-exst]'); st.innerHTML = '<div class="sys-progress indeterminate" role="progressbar" aria-label="Extracting"><span></span></div><p class="sys-meta">Running the data generator. This can take a minute.</p>';
          const r = await api.extract(s.id);
          if (!r.ok) { st.innerHTML = `<p class="errbox">${esc(r.error)}</p>`; return; }
          extracted.set(s.id, r.extracted); drawWorld(s, panel);
        };
        return;
      }
      const w = gen && gen.server === s.id ? gen.form : { area: { cx: -50, cz: -50, w: 100, d: 100 }, custom: 'none', layers: [{ block: 'minecraft:bedrock', height: 1 }, { block: 'minecraft:dirt', height: 2 }, { block: 'minecraft:grass_block', height: 1 }] };
      const has = (list, v) => list.includes(v);
      const blocks = ex.blocks; const biomes = ex.biomes;
      const datalist = S.uid('blocks');
      panel.innerHTML = `${ex.reportsOk ? '' : `<p class="warn">${esc(ex.reportsError)} Block and game rule pickers are unavailable until extraction succeeds.</p>`}${ex.dataDriven ? '' : `<p class="warn">${esc(ex.dataDrivenReason)}</p>`}
        <p class="sys-meta">Read from ${esc(ex.version)}: ${ex.presets.length} world presets, ${biomes.length} biomes, ${blocks.length} blocks, ${ex.structureSets.length} structure sets, ${ex.gamerules.length} game rules. Data pack format ${ex.packFormat ? ex.packFormat.major : 'not reported'}.</p>
        <section class="card"><h3>World</h3><div class="sys-grid">${S.txt('worldName', 'World name', w.worldName || 'Generated world', 'Used for the folder or ZIP name. Nothing is overwritten; a number is added if the name is taken.', 'maxlength="60"')}<div class="field sys-ctl"><label for="mc-seed">Seed</label><div class="sys-step"><input id="mc-seed" data-k="seed" value="${esc(w.seed || '')}" maxlength="100" spellcheck="false"><button type="button" class="btn sm" data-act="randseed">Random</button></div><small class="sys-help">Empty lets the server pick one.</small></div>
          ${S.sel('preset', 'World preset', w.preset || (has(ex.presets, 'minecraft:normal') ? 'minecraft:normal' : ex.presets[0]), ex.presets.length ? ex.presets : ['minecraft:normal'], 'Read from this version.')}
          ${S.sel('difficulty', 'Difficulty', w.difficulty || 'easy', ['peaceful', 'easy', 'normal', 'hard'])}${S.sel('gamemode', 'Game mode', w.gamemode || 'survival', ['survival', 'creative', 'adventure', 'spectator'])}</div>
          ${S.sw('hardcore', 'Hardcore', !!w.hardcore, 'Players are banned when they die.')}${S.sw('structures', 'Generate structures', w.structures !== false, 'Villages, temples and other structures.')}</section>
        <section class="card"><h3>Customize the overworld</h3><div class="seg sm" role="group" aria-label="Customization">${[['none', 'Preset as is'], ['flat', 'Superflat layers'], ['single', 'Single biome'], ['noise', 'Noise tweaks']].map(([k, l]) => `<button type="button" data-custom="${k}" aria-pressed="${w.custom === k}" ${!ex.dataDriven && k !== 'none' ? 'disabled' : ''}>${l}</button>`).join('')}</div><div data-custombox></div></section>
        <section class="card"><h3>Area to generate</h3><p class="sys-meta">Default 100 by 100 chunks (1,600 by 1,600 blocks) around spawn. Drag on the grid to draw, drag inside to move, drag the corner to resize. With the grid focused, arrow keys move it and Shift with arrows resizes.</p>
          <div class="sys-row"><div class="sys-canvas-wrap"><canvas class="sys-canvas" width="360" height="360" tabindex="0" role="img" data-canvas aria-label="Generation area"></canvas></div><div class="sys-grid grow">${S.num('aw', 'Width', w.area.w, 1, 1024, 1, '', 'chunks')}${S.num('ad', 'Depth', w.area.d, 1, 1024, 1, '', 'chunks')}${S.num('ax', 'West edge', w.area.cx, -1874999, 1874999, 1, '', 'chunk')}${S.num('az', 'North edge', w.area.cz, -1874999, 1874999, 1, '', 'chunk')}</div></div>
          <p class="sys-meta" role="status" data-estimate></p>${S.sw('borderFollows', 'World border follows the area', w.borderFollows !== false, 'Sets the border centre and size to the rectangle.')}${S.num('settle', 'Wait per batch', w.settle || 4, 1, 60, 1, 'Seconds to let each batch of up to 256 chunks generate. The vanilla server does not report when chunks finish.', 'seconds')}
          <div class="sys-grid">${S.num('spx', 'Spawn X', w.spawn ? w.spawn.x : 0, -29999984, 29999984, 1, '', 'block')}${S.num('spz', 'Spawn Z', w.spawn ? w.spawn.z : 0, -29999984, 29999984, 1, '', 'block')}</div>${S.sw('setspawn', 'Set the spawn point', !!w.spawn, 'Off keeps the spawn the server chooses.')}</section>
        <section class="card"><h3>Game rules</h3><div data-grsearch></div><div class="sys-grid" data-rules>${ex.gamerules.map((g) => `<div data-rule="${esc(g.name)}">${g.type === 'bool' ? S.sw('gr:' + g.name, g.name, w.rules && w.rules[g.name] != null ? w.rules[g.name] : false, 'Leave unchanged unless you set it here.') : g.type === 'int' ? S.num('gr:' + g.name, g.name, w.rules && w.rules[g.name] != null ? w.rules[g.name] : '', g.min, g.max, 1, 'Empty leaves the version default.') : `<div class="sys-unavail"><strong>${esc(g.name)}</strong><span>Its value type ${esc(g.parser)} has no typed control yet.</span></div>`}<label class="sys-meta"><input type="checkbox" data-use="${esc(g.name)}" ${w.rules && w.rules[g.name] != null ? 'checked' : ''} ${g.type === 'unknown' ? 'disabled' : ''}> Set this rule</label></div>`).join('') || '<p class="sys-meta">No game rules were extracted.</p>'}</div></section>
        <section class="card"><h3>Output</h3><div class="seg sm" role="group" aria-label="Output format"><button type="button" data-out="folder" aria-pressed="${(w.output || 'folder') === 'folder'}">Folder</button><button type="button" data-out="zip" aria-pressed="${w.output === 'zip'}">ZIP</button></div><div class="sys-row"><button type="button" class="btn" data-act="browse">Browse...</button><span class="sys-meta" data-dest>${esc(w.dest || 'No destination chosen.')}</span></div>
          <label class="switch-row"><span>I accept the Minecraft EULA for this generation run. Generating runs the ${esc(ex.version)} server once in a private staging folder.</span><input type="checkbox" role="switch" data-k="eulaGen"></label><div class="sys-row"><button type="button" class="btn" data-act="openeula">Read the EULA</button><button type="button" class="btn primary" data-act="generate">Generate world</button><button type="button" class="btn" data-act="cancelgen" ${gen && gen.running ? '' : 'disabled'}>Cancel</button></div><div data-genst aria-live="polite"></div></section>
        <datalist id="${datalist}">${blocks.map((b) => `<option value="${esc(b)}">`).join('')}</datalist>`;
      S.wireSteppers(panel);
      const form = { ...w, area: { ...w.area } };
      gen = gen && gen.server === s.id ? gen : { server: s.id, form };
      gen.form = form;
      const customBox = panel.querySelector('[data-custombox]');
      function drawCustom() {
        if (form.custom === 'flat') {
          customBox.innerHTML = `<div class="sys-layers" data-layers>${form.layers.map((l, i) => `<div class="sys-layer">${S.txt('lb' + i, 'Layer ' + (i + 1) + ' block (bottom first)', l.block, '', `list="${datalist}"`)}${S.num('lh' + i, 'Height', l.height, 1, 4064, 1)}<div class="sys-row"><button type="button" class="iconbtn" data-lup="${i}" aria-label="Move layer ${i + 1} up">&uarr;</button><button type="button" class="iconbtn" data-ldown="${i}" aria-label="Move layer ${i + 1} down">&darr;</button><button type="button" class="iconbtn" data-ldel="${i}" aria-label="Remove layer ${i + 1}">&times;</button></div></div>`).join('')}</div><button type="button" class="btn sm" data-act="addlayer">Add layer</button>
            ${S.sel('flatBiome', 'Biome', form.flatBiome || (has(biomes, 'minecraft:plains') ? 'minecraft:plains' : biomes[0]), biomes)}${S.sw('features', 'Features (trees, ores)', !!form.features)}${S.sw('lakes', 'Lakes', !!form.lakes)}
            <fieldset><legend class="sys-meta">Structure sets</legend><div class="sys-checks">${ex.structureSets.map((x) => `<label><input type="checkbox" data-sset="${esc(x)}" ${(form.sets || []).includes(x) ? 'checked' : ''}>${esc(x.replace('minecraft:', ''))}</label>`).join('')}</div></fieldset>`;
        } else if (form.custom === 'single') customBox.innerHTML = S.sel('singleBiome', 'Biome everywhere', form.singleBiome || biomes[0], biomes, 'The whole overworld uses this biome.');
        else if (form.custom === 'noise') customBox.innerHTML = `<div class="sys-grid">${S.num('sea', 'Sea level', form.sea != null ? form.sea : 63, -64, 319, 1, 'Vanilla overworld uses 63.')}</div>${S.sw('aquifers', 'Aquifers', form.aquifers !== false)}${S.sw('oreVeins', 'Ore veins', form.oreVeins !== false)}${S.sw('noMobs', 'Turn off mob generation at world creation', !!form.noMobs)}`;
        else customBox.innerHTML = '<p class="sys-meta">The preset is used exactly as this version ships it.</p>';
        S.wireSteppers(customBox);
      }
      drawCustom();
      const canvas = panel.querySelector('[data-canvas]');
      const syncFields = () => { for (const [k, f] of [['aw', 'w'], ['ad', 'd'], ['ax', 'cx'], ['az', 'cz']]) panel.querySelector(`[data-k="${k}"]`).value = form.area[f]; estimate(); paint(); };
      function estimate() {
        const a = form.area; const n = Math.ceil(a.w / 16) * Math.ceil(a.d / 16);
        panel.querySelector('[data-estimate]').textContent = `${a.w} by ${a.d} chunks (${a.w * 16} by ${a.d * 16} blocks), ${a.w * a.d} chunks in ${n} batches. At ${Number(S.value(panel, 'settle')) || 4} seconds per batch, about ${Math.ceil(n * (Number(S.value(panel, 'settle')) || 4) / 60)} minutes plus server start.`;
        canvas.setAttribute('aria-label', `Generation area: ${a.w} by ${a.d} chunks, west edge ${a.cx}, north edge ${a.cz}.`);
      }
      const view = () => { const a = form.area; const span = Math.max(256, Math.abs(a.cx) + a.w, Math.abs(a.cz) + a.d, Math.abs(a.cx), Math.abs(a.cz)) * 2.2; return { span, scale: canvas.width / span, ox: canvas.width / 2, oz: canvas.height / 2 }; };
      function paint() {
        const g = canvas.getContext('2d'); if (!g) return;
        const cs = getComputedStyle(panel); const v = view(); const a = form.area;
        g.clearRect(0, 0, canvas.width, canvas.height);
        g.strokeStyle = cs.getPropertyValue('--md-sys-color-outline-variant') || '#999'; g.lineWidth = 1;
        const stepC = Math.pow(2, Math.ceil(Math.log2(v.span / 12)));
        for (let c = -Math.ceil(v.span / 2 / stepC) * stepC; c <= v.span / 2; c += stepC) { const p = v.ox + c * v.scale; g.beginPath(); g.moveTo(p, 0); g.lineTo(p, canvas.height); g.stroke(); const q = v.oz + c * v.scale; g.beginPath(); g.moveTo(0, q); g.lineTo(canvas.width, q); g.stroke(); }
        g.fillStyle = cs.getPropertyValue('--md-sys-color-primary') || '#6750a4'; g.globalAlpha = 0.3;
        const x = v.ox + a.cx * v.scale, z = v.oz + a.cz * v.scale, ww = a.w * v.scale, dd = a.d * v.scale;
        g.fillRect(x, z, ww, dd); g.globalAlpha = 1; g.lineWidth = 2; g.strokeStyle = g.fillStyle; g.strokeRect(x, z, ww, dd); g.fillRect(x + ww - 6, z + dd - 6, 12, 12);
        g.fillStyle = cs.getPropertyValue('--md-sys-color-on-surface') || '#000'; g.beginPath(); g.arc(v.ox, v.oz, 3, 0, Math.PI * 2); g.fill();
      }
      let drag = null;
      const toChunk = (ev) => { const r = canvas.getBoundingClientRect(); const v = view(); const px = (ev.clientX - r.left) * canvas.width / r.width, pz = (ev.clientY - r.top) * canvas.height / r.height; return { x: Math.round((px - v.ox) / v.scale), z: Math.round((pz - v.oz) / v.scale), px, pz }; };
      const clampA = () => { const a = form.area; a.w = Math.max(1, Math.min(1024, a.w)); a.d = Math.max(1, Math.min(1024, a.d)); };
      canvas.addEventListener('pointerdown', (ev) => {
        const c = toChunk(ev), a = form.area, v = view(); canvas.setPointerCapture(ev.pointerId);
        const cx2 = v.ox + (a.cx + a.w) * v.scale, cz2 = v.oz + (a.cz + a.d) * v.scale;
        if (Math.abs(c.px - cx2) < 12 && Math.abs(c.pz - cz2) < 12) drag = { mode: 'resize' };
        else if (c.x >= a.cx && c.x <= a.cx + a.w && c.z >= a.cz && c.z <= a.cz + a.d) drag = { mode: 'move', dx: c.x - a.cx, dz: c.z - a.cz };
        else drag = { mode: 'draw', x0: c.x, z0: c.z };
      });
      canvas.addEventListener('pointermove', (ev) => {
        if (!drag) return; const c = toChunk(ev), a = form.area;
        if (drag.mode === 'move') { a.cx = c.x - drag.dx; a.cz = c.z - drag.dz; }
        else if (drag.mode === 'resize') { a.w = c.x - a.cx; a.d = c.z - a.cz; }
        else { a.cx = Math.min(drag.x0, c.x); a.cz = Math.min(drag.z0, c.z); a.w = Math.abs(c.x - drag.x0); a.d = Math.abs(c.z - drag.z0); }
        clampA(); syncFields();
      });
      canvas.addEventListener('pointerup', () => { drag = null; });
      canvas.addEventListener('keydown', (ev) => {
        const m = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key]; if (!m) return;
        ev.preventDefault(); const a = form.area; const k = ev.ctrlKey ? 16 : 1;
        if (ev.shiftKey) { a.w += m[0] * k; a.d += m[1] * k; } else { a.cx += m[0] * k; a.cz += m[1] * k; }
        clampA(); syncFields();
      });
      panel.oninput = (e) => {
        const k = e.target.dataset && e.target.dataset.k; const map = { aw: 'w', ad: 'd', ax: 'cx', az: 'cz' };
        if (map[k]) { const n = Number(e.target.value); if (Number.isInteger(n)) { form.area[map[k]] = n; clampA(); estimate(); paint(); } }
        if (k === 'settle') estimate();
      };
      syncFields();
      const ruleSearch = S.search('Search game rules', () => { for (const r of panel.querySelectorAll('[data-rule]')) r.hidden = !ruleSearch.test(r.dataset.rule); });
      panel.querySelector('[data-grsearch]').append(ruleSearch.el);
      function collect() {
        form.worldName = S.value(panel, 'worldName'); form.seed = S.value(panel, 'seed'); form.preset = S.value(panel, 'preset'); form.difficulty = S.value(panel, 'difficulty'); form.gamemode = S.value(panel, 'gamemode');
        form.hardcore = S.value(panel, 'hardcore'); form.structures = S.value(panel, 'structures'); form.borderFollows = S.value(panel, 'borderFollows'); form.settle = S.value(panel, 'settle');
        form.spawn = S.value(panel, 'setspawn') ? { x: S.value(panel, 'spx'), z: S.value(panel, 'spz') } : null;
        if (form.custom === 'flat') { form.layers = form.layers.map((l, i) => ({ block: String(S.value(panel, 'lb' + i) || '').trim(), height: S.value(panel, 'lh' + i) })); form.flatBiome = S.value(panel, 'flatBiome'); form.features = S.value(panel, 'features'); form.lakes = S.value(panel, 'lakes'); form.sets = [...panel.querySelectorAll('[data-sset]:checked')].map((x) => x.dataset.sset); }
        if (form.custom === 'single') form.singleBiome = S.value(panel, 'singleBiome');
        if (form.custom === 'noise') { form.sea = S.value(panel, 'sea'); form.aquifers = S.value(panel, 'aquifers'); form.oreVeins = S.value(panel, 'oreVeins'); form.noMobs = S.value(panel, 'noMobs'); }
        form.rules = {}; for (const u of panel.querySelectorAll('[data-use]:checked')) { const v = S.value(panel, 'gr:' + u.dataset.use); if (v != null && v !== '') form.rules[u.dataset.use] = v; }
      }
      panel.onclick = async (e) => {
        const c = e.target.closest('[data-custom]'); if (c) { collect(); form.custom = c.dataset.custom; for (const b of panel.querySelectorAll('[data-custom]')) b.setAttribute('aria-pressed', String(b === c)); return drawCustom(); }
        const o = e.target.closest('[data-out]'); if (o) { form.output = o.dataset.out; for (const b of panel.querySelectorAll('[data-out]')) b.setAttribute('aria-pressed', String(b === o)); return; }
        const lu = e.target.closest('[data-lup],[data-ldown],[data-ldel]');
        if (lu) { collect(); const i = Number(lu.dataset.lup ?? lu.dataset.ldown ?? lu.dataset.ldel); const L = form.layers; if (lu.dataset.ldel != null) { if (L.length > 1) L.splice(i, 1); } else { const j = lu.dataset.lup != null ? i - 1 : i + 1; if (j >= 0 && j < L.length) [L[i], L[j]] = [L[j], L[i]]; } return drawCustom(); }
        const a = e.target.closest('[data-act]'); if (!a) return;
        if (a.dataset.act === 'addlayer') { collect(); form.layers.push({ block: 'minecraft:stone', height: 1 }); return drawCustom(); }
        if (a.dataset.act === 'randseed') { const b = new Uint32Array(2); crypto.getRandomValues(b); panel.querySelector('[data-k="seed"]').value = String((BigInt(b[0]) << 32n | BigInt(b[1])) - (1n << 63n)); return; }
        if (a.dataset.act === 'openeula') return api.openEula();
        if (a.dataset.act === 'browse') { const r = await api.browse('folder'); if (r.ok) { form.dest = r.path; panel.querySelector('[data-dest]').textContent = r.path; } return; }
        if (a.dataset.act === 'cancelgen' && gen.jobId) return api.cancel(gen.jobId);
        if (a.dataset.act === 'generate') {
          collect();
          if (!S.value(panel, 'eulaGen')) return ctx.toast('Tick the EULA switch first. Generating runs the server.', 'error');
          if (!form.dest) return ctx.toast('Browse for a destination folder first.', 'error');
          if (form.custom === 'flat') for (const l of form.layers) if (!blocks.includes(l.block)) return ctx.toast(`${l.block || 'An empty block'} is not a block in ${ex.version}. Pick one from the list.`, 'error');
          const req = { id: s.id, area: { ...form.area }, seed: form.seed || '', preset: form.preset, difficulty: form.difficulty, gamemode: form.gamemode, hardcore: form.hardcore, structures: form.structures, borderFollows: form.borderFollows, personAcceptedEula: true, output: form.output || 'folder', dest: form.dest, worldName: form.worldName, gamerules: form.rules, settleMs: (form.settle || 4) * 1000 };
          if (form.spawn) req.spawn = form.spawn;
          if (form.custom === 'flat') req.flat = { layers: form.layers, biome: form.flatBiome, features: form.features, lakes: form.lakes, structures: form.sets };
          if (form.custom === 'single') req.singleBiome = form.singleBiome;
          if (form.custom === 'noise') req.noise = { seaLevel: form.sea, aquifers: form.aquifers, oreVeins: form.oreVeins, disableMobGeneration: form.noMobs };
          const r = await api.generate(req);
          const st = panel.querySelector('[data-genst]');
          if (!r.ok) { st.innerHTML = `<p class="errbox">${esc(r.error)}</p>`; return; }
          gen.jobId = r.jobId; gen.running = true; gen.batches = r.batches; gen.done = 0; gen.step = 'Starting'; gen.tail = [];
          panel.querySelector('[data-act="cancelgen"]').disabled = false; renderGen(panel);
        }
      };
    }
    function renderGen(panel) {
      const st = panel && panel.querySelector('[data-genst]'); if (!st || !gen) return;
      const pct = gen.batches ? Math.round(gen.done / gen.batches * 100) : 0;
      st.innerHTML = gen.result ? gen.result : `<p class="sys-meta">${esc(gen.step)} &middot; batch ${gen.done} of ${gen.batches}</p><div class="sys-progress" role="progressbar" aria-label="World generation" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div><pre class="log sys-console" aria-label="Staging server output">${esc(gen.tail.slice(-12).join('\n'))}</pre>`;
    }

    const off = api.onEvent((d) => {
      if (!d) return;
      if (d.kind === 'download') {
        if (d.type === 'started') dl = d.jobId;
        const t = main.querySelector('[data-dlt]'); const bar = main.querySelector('[data-dl] .sys-progress');
        if (d.type === 'progress' && t) { t.textContent = `${fmtBytes(d.received)} of ${fmtBytes(d.total)}`; if (bar && d.total) { bar.classList.remove('indeterminate'); bar.firstChild.style.width = Math.round(d.received / d.total * 100) + '%'; bar.setAttribute('aria-valuenow', String(Math.round(d.received / d.total * 100))); } }
        if (d.type === 'done' && t) t.textContent = 'Downloaded and verified.';
      }
      if (d.kind === 'console') { const a = consoles.get(d.id) || []; a.push(d.line); if (a.length > 2000) a.splice(0, a.length - 2000); consoles.set(d.id, a); if (/Done \(/.test(d.line)) { states.set(d.id, 'running'); loadServers(); } const log = selected === d.id && main.querySelector('[data-log]'); if (log) { log.textContent = a.join('\n'); log.scrollTop = log.scrollHeight; } }
      if (d.kind === 'state') { states.set(d.id, d.state === 'starting' ? 'starting' : d.state === 'stopped' ? 'stopped' : d.state); if (d.state === 'stopped') { const a = consoles.get(d.id) || []; a.push(`[Material VM Labs] The server process ended${d.code != null ? ' with code ' + d.code : ''}.`); consoles.set(d.id, a); } if (d.state === 'failed') ctx.toast(d.error, 'error'); loadServers(); }
      if (d.kind === 'generate' && gen && d.jobId === gen.jobId) {
        if (d.type === 'step') gen.step = d.step;
        if (d.type === 'progress') { gen.done = d.batch; gen.batches = d.batches; }
        if (d.type === 'console') { gen.tail.push(d.line); if (gen.tail.length > 200) gen.tail.shift(); }
        if (d.type === 'done') { gen.running = false; gen.result = `<p class="note">World written and verified file by file: ${esc(d.path)} (${d.files} files). ${d.missingRegions.length ? `<strong>${d.missingRegions.length} region files the area touches were not written, so parts of the area may be ungenerated.</strong> ` : 'Every region file the area touches is present. '}${esc(d.note)}</p>`; ctx.notify({ kind: 'success', title: 'World generated', body: d.path }); }
        if (d.type === 'error' || d.type === 'cancelled') { gen.running = false; gen.result = `<p class="${d.type === 'cancelled' ? 'warn' : 'errbox'}">${esc(d.type === 'cancelled' ? 'Generation was cancelled. Nothing was written to your destination.' : d.error)}</p>`; }
        renderGen(main.querySelector('[data-genst]') ? main : null);
        const cb = main.querySelector('[data-act="cancelgen"]'); if (cb) cb.disabled = !gen.running;
      }
    });
    loadTargets(); loadServers();
    return () => { if (typeof off === 'function') off(); };
  }

  let cleanup = null;
  window.MVLTools.register({ id: 'minecraft-server-manager', title: 'Minecraft servers', group: 'System', summary: 'Create, run and configure servers, and generate worlds', mount(el, ctx) { cleanup = mount(el, ctx); }, unmount() { if (typeof cleanup === 'function') cleanup(); cleanup = null; } });
})();
