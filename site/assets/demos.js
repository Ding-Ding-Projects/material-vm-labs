'use strict';
// Interactive demonstrations: the controls change example commands; nothing is executed.
(function () {
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const reduced = () => (window.MVLSettings ? window.MVLSettings.reduced() : matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Reads every [data-control] in a demo: radios by fieldset, checkboxes as booleans, others as text.
  function read(root) {
    const v = {};
    for (const c of $$('[data-control]', root)) {
      const k = c.dataset.control;
      if (c.tagName === 'FIELDSET') { const r = $('input:checked', c); v[k] = r ? r.value : ''; }
      else if (c.type === 'checkbox') v[k] = c.checked;
      else v[k] = c.value.trim();
    }
    return v;
  }
  function out(root, name, text, html) {
    const el = $(`[data-out="${name}"]`, root);
    if (!el) return;
    if (html ? el.innerHTML === text : el.textContent === text) return;
    if (html) el.innerHTML = text; else el.textContent = text;
    if (el.tagName === 'CODE') { el.classList.remove('updated'); void el.offsetWidth; el.classList.add('updated'); }
  }
  const nameOf = (s, fallback) => (/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(s) ? s : fallback);
  const repoOf = (s) => (/^[\w.-]+\/[\w.-]+$/.test(s) ? s : 'owner/name');
  const notes = (items) => items.map(([cls, t]) => `<li class="${cls}">${t}</li>`).join('');
  function wire(root, render) {
    root.addEventListener('input', render);
    root.addEventListener('change', render);
    render();
  }

  // ---------- home: build your first command ----------
  for (const root of $$('[data-demo="new-command"]')) {
    wire(root, () => {
      const v = read(root);
      const name = nameOf(v.name, 'proof-1');
      const n = [];
      let cmd;
      if (v.os === 'server') {
        cmd = 'mvl server-media --iso D:\\iso\\server-2025.iso';
        n.push(['warn', 'Windows Server 2025 is in preview: today you can inspect your own Server 2025 ISO, from a console or with <strong>Inspect Server ISO</strong> on the manager\'s Media page, and see its supported image indexes. Creating a Server 2025 lab machine is not yet offered by <code>mvl new</code>.']);
      } else {
        const parts = ['mvl new', name];
        if (v.os !== 'windows') parts.push('--os', v.os);
        if (v.for === 'agent') parts.push('--for agent');
        if (v.net !== 'nat') parts.push('--net', v.net);
        cmd = parts.join(' ');
        if (v.os === 'windows') n.push(['', 'Installed unattended from the official Windows 11 Enterprise evaluation ISO; typically 25 to 50 minutes to the clean baseline.']);
        else n.push(['', `${v.os === 'ubuntu' ? 'Ubuntu 24.04 LTS' : 'Debian 13'} from the verified official cloud image, with Docker, Git, Node.js and the Codex CLI inside. Connect with <code>mvl ssh ${esc(name)}</code>.`]);
        n.push(v.for === 'you'
          ? ['', 'For you: developer tools and the shared folder with this PC are added. In a console, <code>--for</code> already defaults to <code>you</code>.']
          : ['', 'For an agent: the machine stays bare on purpose, so a build must fetch every dependency itself. With <code>--json</code>, <code>--for</code> defaults to <code>agent</code>.']);
        if (v.net === 'bridged') n.push(['warn', 'Bridged gives the machine its own LAN address. With the default password <code>1234</code>, anyone on your LAN can sign in over Remote Desktop, and <code>mvl</code> warns about it. With no address in 3 minutes it falls back to NAT.']);
        if (v.net === 'hostonly') n.push(['warn', 'Host-only has no internet, so a build cannot fetch its dependencies.']);
      }
      out(root, 'command', cmd);
      out(root, 'notes', notes(n), true);
    });
  }

  // ---------- fresh build ----------
  for (const root of $$('[data-demo="fresh-build"]')) {
    wire(root, () => {
      const v = read(root);
      const name = nameOf(v.name, 'proof-1');
      const json = v.json ? ' --json' : '';
      const entries = [v['entry-build'] && 'build', v['entry-installer'] && 'build-installer'].filter(Boolean);
      const refOk = !v.ref || /^[0-9a-fA-F]{7,40}$/.test(v.ref);
      out(root, 'hv', 'mvl hv' + json);
      out(root, 'media', 'mvl media' + json);
      out(root, 'new', `mvl new ${name} --for agent${v.hv !== 'auto' ? ' --hv ' + v.hv : ''}${json}`);
      const b = [`mvl build ${name} --repo ${repoOf(v.repo)}`];
      if (v.ref && refOk) b.push('--ref ' + v.ref.toLowerCase());
      if (entries.length) b.push('--entry ' + entries.join(','));
      if (v.evidence) b.push('--evidence evidence\\receipts');
      if (v.noreset) b.push('--no-reset');
      out(root, 'build', b.join(' ') + json);
      const st = $('[data-out="ref-status"]', root);
      st.textContent = !v.ref ? "Leave empty to build the default branch's head." : refOk ? 'The build checks out this commit. The receipt also records the remote head at run time.' : 'A commit is 7 to 40 hexadecimal characters.';
      st.classList.toggle('bad', !refOk);
      const n = [];
      if (!entries.length) n.push(['warn', 'Choose at least one entrypoint. Each runs as <code>&lt;entry&gt;.bat /s</code> with <code>SILENT=1</code>, stopping at the first failure.']);
      else n.push(['', `Runs ${entries.map((e) => `<code>${e}.bat /s</code>`).join(' then ')} inside the guest, stopping at the first failure.`]);
      if (v.noreset) n.push(['warn', 'Skipping the reset means the guest may not be a clean baseline; the receipt records the reset flag.']);
      if (v.hv === 'virtualbox') n.push(['', 'VirtualBox has a real virtual TPM 2.0. On a PC where Hyper-V is on it runs in a slow mode; see <a href="reference/hypervisors.html#virtualbox-under-hyper-v-2026-11-17">VirtualBox under Hyper-V</a>.']);
      if (v.json) n.push(['', 'Each command prints one compact JSON line; errors look like <code>{"ok":false,"error":"..."}</code>.']);
      out(root, 'notes', notes(n), true);
      out(root, 'evidence-note', v.evidence ? ', and the receipt and logs are also copied to evidence\\receipts' : '');
    });
  }

  // ---------- installer ----------
  for (const root of $$('[data-demo="installer"]')) {
    wire(root, () => {
      const v = read(root);
      const name = nameOf(v.name, 'proof-1');
      const file = v.kind === 'msi' ? 'dist\\installer\\App.msi' : 'dist\\installer\\Setup.exe';
      out(root, 'wait-value', v.wait);
      out(root, 'up', `mvl up ${name}`);
      const parts = [`mvl install ${name} --file ${file}`];
      if (v.args) parts.push(`--args "${v.args.replace(/"/g, '')}"`);
      if (v.wait !== '60') parts.push('--wait ' + v.wait);
      if (v.evidence) parts.push('--evidence evidence\\installs');
      out(root, 'install', parts.join(' '));
      const n = [];
      if (v.runner) n.push(['warn', 'Refused: this machine hosts a self-hosted runner, and the reset to the baseline would remove it. Use a separate lab machine for installer tests.']);
      n.push(['', v.kind === 'msi' ? 'An <code>.msi</code> runs through <code>msiexec /i</code>.' : 'The installer runs in the signed-in guest session, so a Squirrel installer installs and then launches the app the way a person would see it.']);
      out(root, 'notes', notes(n), true);
      root.classList.toggle('refused', v.runner);
      out(root, 'timeline', [
        'Reset to <code>mvl-baseline</code> and start.',
        'List the folders under LocalAppData, AppData, ProgramData and Program Files.',
        `Copy the installer in and run it${v.args ? ` with <code>${esc(v.args.replace(/"/g, ''))}</code>` : ''}.`,
        `Wait ${esc(v.wait)} seconds, list the folders again and take a guest screenshot.`,
        `Write <code>receipt.json</code> (schema <code>material-vm-labs/installer-receipt/1</code>) with the installer's SHA-256, arguments, exit code and new folders${v.evidence ? ', and copy it with the screenshot to evidence\\installs' : ''}.`,
      ].map((t) => `<li>${t}</li>`).join(''), true);
    });
  }

  // ---------- self-hosted runner ----------
  for (const root of $$('[data-demo="runner"]')) {
    wire(root, () => {
      const v = read(root);
      const name = nameOf(v.name, 'runner-1');
      const project = nameOf(v.project, 'my-project');
      const repo = repoOf(v.repo);
      const extra = v.labels.split(',').map((s) => s.trim()).filter((s) => /^[\w.-]+$/.test(s));
      const pub = v.visibility === 'public';
      $('[data-out="refusal"]', root).hidden = !pub;
      root.classList.toggle('refused', pub);
      out(root, 'new', `mvl new ${name} --project ${project} --for agent`);
      out(root, 'add', `gh api -X POST repos/${repo}/actions/runners/registration-token --jq .token | mvl runner add ${name} --repo ${repo}${extra.length ? ' --labels ' + extra.join(',') : ''}`);
      const labels = ['self-hosted', 'Windows', 'X64', 'material-vm-labs', 'mvl-' + project, ...extra];
      out(root, 'labels', labels.map((l) => `<code>${esc(l)}</code>`).join(', '), true);
      out(root, 'yaml', `jobs:\n  build:\n    runs-on: [self-hosted, windows, material-vm-labs, mvl-${project}]\n    steps:\n      - uses: actions/checkout@v4\n      - run: .\\build.bat /s`);
      out(root, 'rm', `mvl runner rm ${name} --repo ${repo}`);
    });
  }

  // ---------- Linux ----------
  for (const root of $$('[data-demo="linux"]')) {
    wire(root, () => {
      const v = read(root);
      const name = nameOf(v.name, v.os === 'debian' ? 'deb-1' : 'ubu-1');
      const parts = [`mvl new ${name} --os ${v.os}`];
      if (v.for === 'agent') parts.push('--for agent');
      if (v.hv === 'virtualbox') parts.push('--hv virtualbox');
      out(root, 'new', parts.join(' '));
      out(root, 'image', v.os === 'ubuntu'
        ? 'Image: <code>noble-server-cloudimg-amd64.vmdk</code> from cloud-images.ubuntu.com, verified against the published <code>SHA256SUMS</code>.'
        : 'Image: <code>debian-13-genericcloud-amd64.raw</code> from cloud.debian.org, verified against the published <code>SHA512SUMS</code>.', true);
      out(root, 'ssh', `mvl ssh ${name}`);
      out(root, 'rm', `mvl reset ${name}\nmvl rm ${name} --yes`);
      const n = [['', '<code>mvl build</code>, <code>install</code>, <code>rdp</code>, <code>passwd</code> and <code>runner</code> are Windows only and refuse a Linux machine.']];
      if (v.for === 'you') n.push(v.hv === 'vmware' ? ['', 'For you on VMware: the shared folder is mounted at <code>/mnt/shared</code> and <code>~/shared</code>.'] : ['warn', 'On VirtualBox there is no shared folder; use <code>scp</code> instead.']);
      if (v.hv === 'virtualbox') n.push(['warn', 'On VirtualBox, SSH goes through a NAT forward on <code>127.0.0.1</code> (<code>mvl ssh</code> picks the port). On a PC with Hyper-V on, cloud-init may not finish; VMware is the route there.']);
      out(root, 'notes', notes(n), true);
    });
  }

  // ---------- step progress, kept per walkthrough ----------
  const PKEY = 'mvl-site-guide-progress';
  let progress = {};
  try { progress = JSON.parse(localStorage.getItem(PKEY) || '{}') || {}; } catch { progress = {}; }
  for (const g of $$('[data-guide]')) {
    const id = g.dataset.guide;
    const boxes = $$('[data-step]', g);
    const done = new Set(progress[id] || []);
    for (const b of boxes) b.checked = done.has(b.dataset.step);
    const update = () => {
      const n = boxes.filter((b) => b.checked).length;
      $('.progress span', g).style.width = (n / boxes.length) * 100 + '%';
      $('.progress-text', g).textContent = `${n} of ${boxes.length} steps done`;
    };
    g.addEventListener('change', (e) => {
      if (!e.target.matches('[data-step]')) return;
      progress[id] = boxes.filter((b) => b.checked).map((b) => b.dataset.step);
      try { localStorage.setItem(PKEY, JSON.stringify(progress)); } catch { /* progress lasts for this page only */ }
      update();
    });
    update();
  }

  // ---------- receipt flow diagram ----------
  const STAGES = [
    { name: 'Fresh clone', where: 'host', text: 'The repository is cloned over HTTPS on your PC with your own git credentials, checked out at --ref or the default head, then zipped.', fields: ['repository', 'commit', 'remoteHeadAtRun'] },
    { name: 'Reset to baseline', where: 'host', text: 'The lab machine goes back to the mvl-baseline snapshot and starts. Skip with --no-reset; the receipt records it.', fields: ['machine'] },
    { name: 'Copy in', where: 'host', text: 'The zip and run-build.ps1 are copied in through the hypervisor guest channel: VMware Tools or VirtualBox Guest Additions.', fields: ['media'] },
    { name: 'Record before', where: 'guest', text: 'Installed programs, PATH entries, tools on PATH and Chocolatey packages are recorded before anything runs.', fields: [] },
    { name: 'Run entrypoints', where: 'guest', text: 'Each entrypoint runs as <entry>.bat /s with SILENT=1 as the generated mvlbuilder account, stopping at the first failure.', fields: ['entrypoints', 'guestElevated'] },
    { name: 'Record after', where: 'guest', text: 'Everything is recorded again; the difference is what the build had to download and install.', fields: ['dependenciesAcquired'] },
    { name: 'Collect artifacts', where: 'guest', text: 'Installers, packages and archives written during the run are collected (up to 1.5 GB copied) and every one is hashed.', fields: ['artifacts'] },
    { name: 'Write the receipt', where: 'host', text: 'Logs, result.json and artifacts come back to the runs folder and receipt.json is written. The exit code is 0 only when every entrypoint passed.', fields: ['verdict'] },
  ];
  function sample(fail) {
    return {
      schema: 'material-vm-labs/fresh-build-receipt/1',
      verdict: fail ? 'failed' : 'passed',
      repository: 'owner/name',
      commit: '3f9c2e1a7b',
      remoteHeadAtRun: '3f9c2e1a7b',
      entrypoints: fail
        ? [{ name: 'build', exitCode: 0, minutes: 6.4 }, { name: 'build-installer', exitCode: 1, minutes: 1.2 }]
        : [{ name: 'build', exitCode: 0, minutes: 6.4 }, { name: 'build-installer', exitCode: 0, minutes: 3.1 }],
      guestElevated: false,
      machine: { name: 'proof-1', hypervisor: 'vmware', baseline: 'mvl-baseline', reset: true, network: 'nat' },
      media: { sha256: 'bc3f2408...0e38', signature: 'Valid' },
      dependenciesAcquired: { toolsOnPath: ['node', 'npm'], chocolatey: ['nodejs-lts'] },
      artifacts: fail ? [] : [{ file: 'Setup.exe', bytes: 84213760, sha256: '9a1e...c04d' }],
    };
  }
  function receiptHtml(obj, hl) {
    const lines = JSON.stringify(obj, null, 2).split('\n');
    return lines.map((line) => {
      const m = /^ {2}"(\w+)":/.exec(line);
      let h = esc(line).replace(/"(passed|failed)"/, (x, v) => `<span class="verdict-${v}">"${v}"</span>`);
      return m && hl.includes(m[1]) ? `<span class="hl">${h}</span>` : h;
    }).join('\n');
  }
  for (const root of $$('[data-demo="receipt-flow"]')) {
    const list = $('.flow-stages', root);
    const detail = $('.flow-detail', root);
    const code = $('.receipt-sample code', root);
    const failBox = $('[data-flow="fail"]', root);
    let current = -1, timer = null;
    list.innerHTML = STAGES.map((s, i) => `<li class="flow-stage" data-i="${i}"><button type="button" aria-pressed="false"><span class="dot" aria-hidden="true">${i + 1}</span><span class="name">${esc(s.name)}</span><span class="where${s.where === 'guest' ? ' guest' : ''}">${s.where === 'guest' ? 'In the guest' : 'On your PC'}</span></button></li>`).join('');
    function show(i) {
      current = i;
      const fail = failBox.checked;
      $$('.flow-stage', list).forEach((li, j) => {
        li.classList.toggle('active', j === i);
        li.classList.toggle('done', j < i);
        li.classList.toggle('failed', fail && j === 4 && i >= 4);
        $('button', li).setAttribute('aria-pressed', String(j === i));
      });
      if (i < 0) {
        detail.innerHTML = '<h3>Ready</h3><p>Play the run or pick a stage. Stages on your PC are outlined; stages in the guest are tinted.</p>';
        code.innerHTML = receiptHtml(sample(fail), []);
        return;
      }
      const s = STAGES[i];
      let extra = '';
      if (fail && i === 4) extra = '<p><strong>Demonstration failure:</strong> build-installer exits 1, so the run stops there. Recording and collection still happen.</p>';
      if (fail && i === 7) extra = '<p><strong>Verdict: failed.</strong> <code>mvl build</code> exits 1.</p>';
      if (!fail && i === 7) extra = '<p><strong>Verdict: passed.</strong> <code>mvl build</code> exits 0.</p>';
      detail.innerHTML = `<h3>${i + 1}. ${esc(s.name)}</h3><p>${esc(s.text)}</p>${extra}<p class="small">${s.fields.length ? 'Fills: ' + s.fields.map((f) => `<code>${f}</code>`).join(', ') : 'Feeds the comparison in stage 6.'}</p>`;
      code.innerHTML = receiptHtml(sample(fail), s.fields);
    }
    function stop() { clearInterval(timer); timer = null; $('[data-flow="play"]', root).textContent = 'Play the run'; }
    list.addEventListener('click', (e) => { const li = e.target.closest('.flow-stage'); if (li) { stop(); show(+li.dataset.i); } });
    $('[data-flow="next"]', root).addEventListener('click', () => { stop(); show((current + 1) % STAGES.length); });
    $('[data-flow="reset"]', root).addEventListener('click', () => { stop(); show(-1); });
    failBox.addEventListener('change', () => show(current));
    $('[data-flow="play"]', root).addEventListener('click', (e) => {
      if (timer) { stop(); return; }
      if (reduced()) { show(STAGES.length - 1); return; }
      e.target.textContent = 'Pause';
      show(0);
      timer = setInterval(() => { if (current >= STAGES.length - 1) stop(); else show(current + 1); }, 1400);
    });
    show(-1);
  }
})();
