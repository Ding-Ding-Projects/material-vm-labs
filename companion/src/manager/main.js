'use strict';
// lab machine manager: Electron main process. It drives the real CLI (src\mvl.ps1) with fixed argument arrays,
// streams long operations live, reads receipts from the state root, and embeds the documentation site reader and the build bay.
const { app, BrowserWindow, ipcMain, shell, clipboard, Tray, Menu, nativeImage, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { root } = require('../shared/repo');
// Squirrel.Windows runs the app with --squirrel-* during install, update and uninstall. Handle those
// events by creating or removing the shortcuts through Update.exe, then quit straight away.
// --squirrel-firstrun is how Setup.exe opens the app after installing, so it starts normally.
(function handleSquirrelEvent() {
  if (process.platform !== 'win32') return false;
  const action = require('../shared/squirrel-events').squirrelAction(process.argv.slice(1));
  if (action.kind === 'start') return false;
  const { spawn } = require('node:child_process');
  const updateExe = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
  const exe = path.basename(process.execPath);
  if (action.kind === 'shortcut') {
    try {
      const child = spawn(updateExe, [...action.args, exe], { detached: true, windowsHide: true, stdio: 'ignore' });
      child.on('close', () => app.quit());
      child.on('error', () => app.quit());
    } catch { app.quit(); }
  } else {
    app.quit();
  }
  process.squirrelEvent = true;
  return true;
})();

const { registerDocs } = require('../shared/docs-ipc');
const dimsum = require('../shared/dimsum-ipc');
const { registerBuild } = require('../shared/build-ipc');
const { createRunner, runGh, NAME, REPO, LABELS } = require('../shared/mvl-cli');

let win = null;
let tray = null;
const iconPath = path.join(root, 'renderer', 'manager', 'manager.png');

let makeWindow = () => {};
let quitConfirmed = false;
let requestQuit = () => app.quit();
// Reopen always works: if the window was already destroyed, build a fresh one.
function reopenWindow() {
  if (!win || win.isDestroyed()) { if (app.isReady()) makeWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = { stateRoot: '', defaultNet: 'nat', theme: 'system', reduceMotion: false };
function readSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch { return { ...DEFAULTS }; }
}
let settings = DEFAULTS;

function stateRoot() {
  if (settings.stateRoot) return settings.stateRoot;
  if (process.env.MVL_HOME) return process.env.MVL_HOME;
  return path.join(process.env.LOCALAPPDATA || path.join(require('node:os').homedir(), 'AppData', 'Local'), 'MaterialVmLabs');
}

function readReceipts() {
  const dir = path.join(stateRoot(), 'runs');
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return { dir, receipts: [], error: null }; }
  for (const n of names) {
    const f = path.join(dir, n, 'receipt.json');
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
      // Installer receipts (mvl install) are their own kind: exit 0 is a pass, and they never
      // count as the last fresh build.
      const isInstall = /installer-receipt/.test(String(j.schema || ''));
      out.push({
        kind: isInstall ? 'install' : 'build',
        runId: j.runId || n,
        verdict: isInstall ? (j.exitCode === 0 ? 'passed' : 'failed') : j.verdict,
        repository: isInstall ? (j.installer && j.installer.file) : j.repository,
        commit: isInstall ? '' : j.commit, hostMinutes: j.hostMinutes, finishedUtc: j.finishedUtc,
        machine: j.machine ? { name: j.machine.name, project: j.machine.project, hypervisor: j.machine.hypervisor, memoryMB: j.machine.memoryMB, cpus: j.machine.cpus, network: j.machine.network, guestOs: j.machine.guestOs } : null,
        entrypoints: Array.isArray(j.entrypoints) ? j.entrypoints.map((e) => ({ name: e.entrypoint || e.name || '', result: e.result, exitCode: e.exitCode })) : [],
        dependencies: j.dependenciesAcquired ? (() => {
          const s = j.dependenciesAcquired;
          const count = (v) => Array.isArray(v) ? v.length : (v && typeof v === 'object' ? Object.keys(v).length : 0);
          const folders = Array.isArray(s.newFolders) ? s.newFolders : [];
          const mb = folders.reduce((t, f) => t + (Number(f.megabytes) || 0), 0);
          return { tools: count(s.newlyAvailableTools), programs: count(s.installedPrograms), choco: count(s.chocolateyPackages), folders: folders.length, megabytes: Math.round(mb) };
        })() : null,
        path: f
      });
    } catch { /* an unreadable or partial receipt is skipped, never invented */ }
  }
  out.sort((a, b) => String(b.finishedUtc || b.runId).localeCompare(String(a.finishedUtc || a.runId)));
  return { dir, receipts: out, error: null };
}

// Non-secret facts from each machine's vm.json (never the credential file). Read-only.
function readMetas() {
  const dir = path.join(stateRoot(), 'vms');
  const out = {};
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return out; }
  for (const n of names) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, n, 'vm.json'), 'utf8').replace(/^﻿/, ''));
      out[String(j.name || n).toLowerCase()] = {
        name: j.name || n, os: j.os || 'windows', osLabel: j.osLabel || '', memoryMB: j.memoryMB, cpus: j.cpus, diskGB: j.diskGB, hypervisor: j.hypervisor, hypervisorVersion: j.hypervisorVersion,
        secureBoot: j.secureBoot, userName: j.userName, defaultPassword: typeof j.defaultPassword === 'boolean' ? j.defaultPassword : null,
        networkFallback: j.networkFallback ? { from: j.networkFallback.from, to: j.networkFallback.to, reason: j.networkFallback.reason } : null,
        status: j.status, created: j.created, baseline: j.baseline ? j.baseline.name : null,
        runners: (Array.isArray(j.runners) ? j.runners : []).map((r) => ({ repo: r && (r.repo || r.repository || ''), labels: r && r.labels ? [].concat(r.labels).join(',') : '' }))
      };
    } catch { /* unreadable state is skipped, never invented */ }
  }
  return out;
}

// Evaluation media already on disk, read from the media folder and its receipts. Read-only; nothing is fetched.
function readMedia() {
  const dir = path.join(stateRoot(), 'media');
  const out = { dir, files: [], receipts: [] };
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return out; }
  for (const n of names) {
    const f = path.join(dir, n);
    try {
      const st = fs.statSync(f);
      if (!st.isFile()) continue;
      if (/^media-.*\.json$/i.test(n)) {
        const j = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
        out.receipts.push({ name: n, file: j.file || (j.path ? path.basename(String(j.path)) : ''), sha256: j.sha256, host: j.host, bytes: j.bytes || j.size });
      } else out.files.push({ name: n, bytes: st.size });
    } catch { /* skip unreadable */ }
  }
  return out;
}

function createWindow() {
  settings = readSettings();
  registerDocs(app);
  dimsum.register(ipcMain, app);
  require('../shared/safety-ipc').register(ipcMain, app);
  require('../shared/personal-ipc').register(ipcMain, app);
  require('../shared/base64-ipc').register(ipcMain, app);
  require('../shared/ollama-ipc').register(ipcMain, app); require('../shared/minecraft-ipc').register(ipcMain, app); require('../shared/vdisk-ipc').register(ipcMain, app);
  const b = registerBuild(app, () => win);
  const runner = createRunner({ getRepoDir: b.getRepoDir, getStateRoot: () => settings.stateRoot || '', getResolvedRoot: stateRoot });
  const busy = () => runner.active() + (b.isRunning() ? 1 : 0);
  require('../shared/extensions-ipc').register(ipcMain, app);
  require('../shared/editor-ipc').register(ipcMain, app, { roots: () => [stateRoot(), b.getRepoDir()] });
  require('../shared/guidance-ipc').register(ipcMain, app, { defaults: DEFAULTS });
  require('../shared/updates-ipc').register(ipcMain, app, { busy, quit: () => { runner.cancelAll(); b.cancel(); quitConfirmed = true; app.quit(); } });
  const ensureTray = () => {
    if (tray) return true;
    try {
      const icon = nativeImage.createFromPath(iconPath);
      if (icon.isEmpty()) throw new Error('Missing manager icon');
      tray = new Tray(icon);
      tray.setToolTip('Material VM Labs');
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Open lab machine', click: reopenWindow },
        { label: 'Quit', click: confirmQuit }
      ]));
      tray.on('double-click', reopenWindow);
      return true;
    } catch {
      tray?.destroy();
      tray = null;
      return false;
    }
  };
  // Hide to the tray instead of closing or quitting while a job runs. Never touches a window that is already gone.
  const hideWhileWorking = (event) => {
    if (quitConfirmed || !busy()) return;
    event.preventDefault();
    const inTray = ensureTray();
    if (!win || win.isDestroyed()) { if (!inTray) makeWindow(); return; }
    if (inTray) win.hide(); else win.minimize();
  };
  // Quit from the notification area: ask first when work is running, then cancel it and really quit.
  async function confirmQuit() {
    const n = busy();
    if (n) {
      const opts = { type: 'warning', buttons: ['Keep running', 'Cancel jobs and quit'], defaultId: 0, cancelId: 0, title: 'Material VM Labs',
        message: n === 1 ? '1 job is still running.' : `${n} jobs are still running.`, detail: 'Quitting cancels them. A cancelled job is recorded as incomplete.' };
      const { response } = win && !win.isDestroyed() && win.isVisible() ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
      if (response !== 1) return;
      runner.cancelAll();
      b.cancel();
    }
    quitConfirmed = true;
    app.quit();
  }
  requestQuit = confirmQuit;
  app.on('before-quit', hideWhileWorking);
  app.on('will-quit', () => tray?.destroy());

  ipcMain.handle('mvl:settings-get', () => ({ ...settings, resolvedRoot: stateRoot(), repo: b.getRepoDir() }));
  ipcMain.handle('mvl:settings-set', (_e, patch) => {
    const next = { ...settings };
    if (patch && typeof patch === 'object') {
      if (typeof patch.stateRoot === 'string' && patch.stateRoot.length < 400 && !/[\0<>|"*?]/.test(patch.stateRoot)) next.stateRoot = patch.stateRoot.trim();
      if (['nat', 'bridged', 'hostonly'].includes(patch.defaultNet)) next.defaultNet = patch.defaultNet;
      if (['dark', 'light', 'system'].includes(patch.theme)) next.theme = patch.theme;
      if (typeof patch.reduceMotion === 'boolean') next.reduceMotion = patch.reduceMotion;
    }
    settings = next;
    try { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch { /* settings persist best-effort */ }
    return { ...settings, resolvedRoot: stateRoot() };
  });
  ipcMain.handle('mvl:run', (_e, op, params, id, label) => {
    const jobId = typeof id === 'string' ? id : null;
    return runner.run(op, params, { id: jobId, label: typeof label === 'string' ? label.slice(0, 160) : '', onLine: jobId ? (l) => send('mvl:line', { id: jobId, ...l }) : null });
  });
  // Jobs that were running when the manager last closed. The marker file is the only source; nothing is invented.
  ipcMain.handle('mvl:recovered', () => runner.scanRecovered());
  ipcMain.handle('mvl:recovered-dismiss', (_e, pid) => runner.dismissRecovered(Number(pid)));
  // Opens a machine's shared folder. Only the machine NAME comes from the renderer; the path is read from the CLI here.
  ipcMain.handle('mvl:open-share', async (_e, name) => {
    if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(name)) return { ok: false, error: 'invalid name' };
    let hostPath = '';
    const ls = await runner.run('ls', {});
    if (ls.ok) {
      const list = Array.isArray(ls.data) ? ls.data : ls.data ? [ls.data] : [];
      const m = list.find((x) => x && String(x.Name).toLowerCase() === name.toLowerCase());
      const sf = m && m.SharedFolder;
      if (sf && typeof sf.hostPath === 'string') hostPath = sf.hostPath;
    }
    if (!hostPath) {
      const r = await runner.run('share', { name });
      if (r.ok && r.data && typeof r.data.hostPath === 'string') hostPath = r.data.hostPath;
      else if (!ls.ok) return { ok: false, error: r.error || ls.error };
    }
    if (!hostPath) return { ok: false, error: 'this machine has no shared folder' };
    try {
      if (!path.isAbsolute(hostPath) || !fs.statSync(hostPath).isDirectory()) return { ok: false, error: 'the shared folder is missing on this PC' };
    } catch { return { ok: false, error: 'the shared folder is missing on this PC' }; }
    const err = await shell.openPath(hostPath);
    return err ? { ok: false, error: err } : { ok: true, path: hostPath };
  });
  ipcMain.handle('mvl:cancel', (_e, id) => runner.cancel(String(id)));
  ipcMain.handle('mvl:receipts', () => readReceipts());
  ipcMain.handle('mvl:metas', () => readMetas());
  ipcMain.handle('mvl:media-info', () => readMedia());
  ipcMain.handle('mvl:select-server-media', async (event) => {
    if (!win || event.sender !== win.webContents) throw new Error('Server media selection requires the manager window');
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Choose Server 2025 installation media',
      properties: ['openFile'],
      filters: [{ name: 'ISO disk image', extensions: ['iso'] }]
    });
    if (canceled) return { ok: false, cancelled: true };
    return runner.run('server-media', { iso: filePaths[0] });
  });
  ipcMain.handle('mvl:shot', async (_e, name) => {
    if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(name)) return { ok: false, error: 'invalid name' };
    const dir = path.join(stateRoot(), 'screenshots');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { return { ok: false, error: e.message }; }
    const file = path.join(dir, `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
    const r = await runner.run('shot', { name, file }, {});
    if (!r.ok) return r;
    try { const buf = fs.readFileSync(file); return { ok: true, file, bytes: buf.length, dataUrl: 'data:image/png;base64,' + buf.toString('base64') }; }
    catch (e) { return { ok: false, error: `the CLI finished but the screenshot file is unreadable: ${e.message}` }; }
  });
  ipcMain.handle('mvl:copy', (_e, text) => { clipboard.writeText(String(text).slice(0, 500)); return true; });
  ipcMain.handle('mvl:open-folder', (_e, which) => {
    const target = which === 'screenshots' ? path.join(stateRoot(), 'screenshots') : which === 'runs' ? path.join(stateRoot(), 'runs') : stateRoot();
    if (fs.existsSync(target)) return shell.openPath(target);
    return 'folder does not exist yet';
  });


  // ---------- Self-hosted runner hosting assist ----------
  // Everything here runs in the main process. The registration token is read from gh into memory, handed to the CLI on
  // standard input, and dropped. It is never logged, written to a file or a job marker, or sent to the renderer.
  const hostingNow = new Set();
  const stepSend = (name, step, st, detail) => send('mvl:runner-step', { name, step, state: st, detail: detail || '' });
  const WF_PATH = /^\.github\/workflows\/[A-Za-z0-9._-]{1,100}\.ya?ml$/;
  ipcMain.handle('mvl:gh-status', async () => {
    const r = await runGh(['api', 'user', '--jq', '.login'], { timeout: 15000 });
    return r.ok ? { ok: true, login: r.out.trim() } : { ok: false, error: r.error };
  });
  // Live state of every listed self-hosted runner: one runners call per repository, names mapped to online/offline.
  // A runner GitHub does not list comes back as 'missing'; a failed call leaves its rows unchecked.
  ipcMain.handle('mvl:runner-live', async (_e, repos) => {
    const list = [...new Set((Array.isArray(repos) ? repos : []).map(String).filter((r) => REPO.test(r)))].slice(0, 30);
    const out = {}; const errors = [];
    await Promise.all(list.map(async (repo) => {
      const r = await runGh(['api', `repos/${repo}/actions/runners?per_page=100`, '--jq', '.runners[] | "\\(.name) \\(.status)"'], { timeout: 20000 });
      if (!r.ok) { errors.push(`${repo}: ${r.error}`); return; }
      const m = {};
      for (const line of r.out.split(/\r?\n/)) { const [n, s] = line.trim().split(' '); if (n) m[n] = s === 'online' ? 'online' : 'offline'; }
      out[repo] = m;
    }));
    return { ok: true, repos: out, errors, checked: new Date().toISOString() };
  });
  ipcMain.handle('mvl:gh-repos', async () => {
    const orgs = await runGh(['api', 'user/orgs', '--jq', '.[].login'], { timeout: 20000 });
    if (!orgs.ok && /Sign in|not installed|could not be started/.test(orgs.error)) return { ok: false, error: orgs.error };
    const owners = [''].concat(orgs.ok ? orgs.out.split(/\r?\n/).map((x) => x.trim()).filter((x) => /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(x)) : []);
    const seen = new Map(); const warnings = [];
    if (!orgs.ok) warnings.push('Organisations could not be read: ' + orgs.error);
    await Promise.all(owners.map(async (o) => {
      const r = await runGh(['repo', 'list', ...(o ? [o] : []), '--visibility', 'private', '--limit', '200', '--json', 'nameWithOwner,description'], { timeout: 40000 });
      if (!r.ok) { warnings.push(o ? `${o}: ${r.error}` : 'Your own repositories could not be listed: ' + r.error); return; }
      try { for (const x of JSON.parse(r.out || '[]')) if (x && REPO.test(String(x.nameWithOwner))) seen.set(x.nameWithOwner, { nameWithOwner: x.nameWithOwner, description: String(x.description || '').slice(0, 200) }); }
      catch { warnings.push('Unreadable repository list' + (o ? ' for ' + o : '')); }
    }));
    if (!seen.size && warnings.length) return { ok: false, error: warnings[0] };
    return { ok: true, repos: [...seen.values()].sort((a, b) => a.nameWithOwner.localeCompare(b.nameWithOwner)), warnings };
  });
  ipcMain.handle('mvl:runner-host', async (_e, p) => {
    p = p && typeof p === 'object' ? p : {};
    const name = p.name, repo = p.repo;
    if (typeof name !== 'string' || !NAME.test(name)) return { ok: false, error: 'invalid name' };
    if (typeof repo !== 'string' || !REPO.test(repo)) return { ok: false, error: 'invalid repository (owner/name)' };
    const labels = String(p.labels || '').split(',').map((x) => x.trim()).filter(Boolean).join(',');
    if (!LABELS.test(labels)) return { ok: false, error: 'invalid labels' };
    const hk = name.toLowerCase();
    if (hostingNow.has(hk)) return { ok: false, error: 'a self-hosted runner is already being hosted on this machine' };
    hostingNow.add(hk);
    let token = '';
    const scrub = (t) => { let x = String(t || ''); if (token) x = x.split(token).join('***'); return x; };
    const fail = (step, msg) => { const clean = scrub(msg); stepSend(name, step, 'fail', clean); return { ok: false, step, error: clean }; };
    try {
      // Machine check: it must exist and be a Windows machine.
      const ls = await runner.run('ls', {});
      if (!ls.ok) return fail('private', 'Could not read the machine list: ' + ls.error);
      const list = Array.isArray(ls.data) ? ls.data : ls.data ? [ls.data] : [];
      const m = list.find((x) => x && String(x.Name).toLowerCase() === hk);
      if (!m) return fail('private', 'That lab machine is not in the machine list.');
      if (m.OS && m.OS !== 'windows') return fail('private', 'Windows only for self-hosted runners.');
      // 1. private check
      stepSend(name, 'private', 'run', 'Asking GitHub whether the repository is private');
      const pv = await runGh(['api', `repos/${repo}`, '--jq', '.private']);
      if (!pv.ok) return fail('private', pv.error);
      if (pv.out.trim() !== 'true') return fail('private', 'This repository is not private. Self-hosted runners serve private repositories only.');
      stepSend(name, 'private', 'ok', 'Private, confirmed by GitHub');
      // 2. registration token, held in memory only
      stepSend(name, 'token', 'run', 'Asking GitHub for a one-time registration token');
      const tk = await runGh(['api', '-X', 'POST', `repos/${repo}/actions/runners/registration-token`, '--jq', '.token']);
      if (!tk.ok) return fail('token', tk.error + (/403|404|admin|Resource not accessible/i.test(tk.error) ? ' You need admin rights on this repository to add a self-hosted runner.' : ''));
      token = tk.out.trim();
      tk.out = '';
      if (!/^[A-Za-z0-9_-]{10,300}$/.test(token)) { token = ''; return fail('token', 'GitHub did not return a usable registration token.'); }
      stepSend(name, 'token', 'ok', 'Received, held in memory only, expires in about an hour');
      // 3. install through the CLI; the token goes on standard input
      stepSend(name, 'install', 'run', 'Installing the self-hosted runner inside the guest (this can take a few minutes)');
      const params = { name, repo, labels, secret: token };
      const jobId = 'gh-' + hk.replace(/[^a-z0-9]/g, '-').slice(0, 40);
      const r = await runner.run('runner-add', params, { id: jobId, label: `Host a self-hosted runner on ${name} for ${repo}` });
      params.secret = '';
      if (!r.ok) return fail('install', r.error);
      token = '';
      stepSend(name, 'install', 'ok', 'The CLI installed and started the self-hosted runner');
      // 4. wait for GitHub to see it online
      const want = `mvl-${name}`;
      const t0 = Date.now(); let last = '';
      stepSend(name, 'online', 'run', 'Waiting for GitHub to see it online');
      while (Date.now() - t0 < 120000) {
        const o = await runGh(['api', `repos/${repo}/actions/runners?per_page=100`, '--jq', `.runners[] | select(.name=="${want}") | .status`], { timeout: 20000 });
        if (o.ok) { last = o.out.trim() || 'not listed yet'; if (last === 'online') { stepSend(name, 'online', 'ok', `${want} is online in ${repo}`); return { ok: true }; } }
        else last = o.error;
        stepSend(name, 'online', 'run', `GitHub says: ${last}`);
        await new Promise((res) => setTimeout(res, 5000));
      }
      return fail('online', `Registered, but GitHub did not report ${want} online within 2 minutes (last: ${last}). It may still come online.`);
    } finally { token = ''; hostingNow.delete(hk); }
  });
  // Workflows that can be run by hand: the workflow file must say workflow_dispatch, read from the repository itself.
  ipcMain.handle('mvl:runner-workflows', async (_e, repo) => {
    if (typeof repo !== 'string' || !REPO.test(repo)) return { ok: false, error: 'invalid repository (owner/name)' };
    const l = await runGh(['workflow', 'list', '-R', repo, '--json', 'name,path,state']);
    if (!l.ok) return { ok: false, error: l.error };
    let all = []; try { all = JSON.parse(l.out || '[]'); } catch { return { ok: false, error: 'GitHub returned an unreadable workflow list.' }; }
    const out = [];
    for (const w of all.filter((x) => x && x.state === 'active' && WF_PATH.test(String(x.path))).slice(0, 20)) {
      const c = await runGh(['api', `repos/${repo}/contents/${w.path}`, '--jq', '.content'], { timeout: 15000 });
      if (!c.ok) continue;
      let text = ''; try { text = Buffer.from(c.out.replace(/\s+/g, ''), 'base64').toString('utf8'); } catch { continue; }
      if (/^\s*workflow_dispatch\b|^\s*on:.*workflow_dispatch|^\s*-\s*workflow_dispatch/m.test(text)) out.push({ name: String(w.name).slice(0, 120), path: w.path });
    }
    return { ok: true, workflows: out, total: all.length };
  });
  ipcMain.handle('mvl:runner-run-workflow', async (_e, repo, wfPath) => {
    if (typeof repo !== 'string' || !REPO.test(repo)) return { ok: false, error: 'invalid repository (owner/name)' };
    if (typeof wfPath !== 'string' || !WF_PATH.test(wfPath)) return { ok: false, error: 'invalid workflow path' };
    const r = await runGh(['workflow', 'run', wfPath, '-R', repo], { timeout: 30000 });
    if (!r.ok) return { ok: false, error: r.error };
    await new Promise((res) => setTimeout(res, 3000));
    const l = await runGh(['run', 'list', '-R', repo, '--workflow', wfPath, '--limit', '1', '--json', 'url'], { timeout: 20000 });
    let url = '';
    try { const j = JSON.parse(l.out || '[]'); url = j[0] && j[0].url ? String(j[0].url) : ''; } catch { /* no link found */ }
    if (/^https:\/\/github\.com\//.test(url)) { shell.openExternal(url); return { ok: true, url }; }
    return { ok: true, url: '', note: 'The workflow was requested, but its run page could not be found yet.' };
  });

  makeWindow = () => {
  const sz = (process.argv.find((a) => /^--size=\d+x\d+$/.test(a)) || '').slice(7).split('x').map(Number);
  win = new BrowserWindow({
    width: sz[0] || 1320, height: sz[1] || 880, minWidth: sz[0] && sz[0] < 340 ? sz[0] : 340, minHeight: 520, title: 'Material VM Labs', autoHideMenuBar: true, backgroundColor: '#141316', titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', symbolColor: '#CAC4CF', height: 32 }, 
    icon: iconPath,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:\/\//i.test(url)) shell.openExternal(url); } });
  win.loadFile(path.join(root, 'renderer', 'manager', 'index.html'));
  win.on('close', hideWhileWorking);
  win.on('closed', () => { win = null; });
  };
  makeWindow();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // A second launch reopens the window; a second launch with --quit asks the running copy to quit
  // (the same confirmed path as Quit in the notification area).
  app.on('second-instance', (_e, argv) => { if (argv.includes('--quit')) requestQuit(); else reopenWindow(); });
  if (process.argv.includes('--quit')) app.whenReady().then(() => app.quit()); // nothing running to ask
  if (!process.argv.includes('--quit') && !process.squirrelEvent) app.whenReady().then(createWindow);
}
// Last window closed: quit, unless before-quit hides the app because a job is still running.
app.on('window-all-closed', () => app.quit());
