'use strict';
// Real actions over the root build.bat and build-installer.bat. Output is streamed, the exit code is the child's own,
// cancel kills the whole process tree, and nothing here ever reports success it did not see.
const { ipcMain, shell } = require('electron');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { readEmbedded, locate } = require('./repo');

const SCRIPTS = { build: 'build.bat', run: 'build.bat', installer: 'build-installer.bat' };

function registerBuild(app, getWindow) {
  let running = null; // { action, startedAt, pid, cancelled }
  const loc = locate(app);
  const repoDir = loc.dir || null;
  const repoNote = loc.error || loc.note;

  const send = (channel, payload) => { const w = getWindow(); if (w && !w.isDestroyed()) w.webContents.send(channel, payload); };

  function info() {
    let embedded = null;
    try { const m = readEmbedded().manifest; embedded = { commit: m.commit, version: m.version, files: m.files.length }; } catch { /* not embedded in dev */ }
    return { version: app.getVersion(), repo: repoDir, repoNote, embedded, running: running ? running.action : null };
  }

  function runBat(cwd, bat) {
    return new Promise((resolve) => {
      // MVL_BUILD_FROM_GUI tells build-companion.ps1 not to rebuild the exe that is running this very build.
      const env = { ...process.env, MVL_BUILD_FROM_GUI: '1', SILENT: '1' };
      const full = path.join(cwd, bat);
      const p = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${full}" /s"`], { cwd, env, windowsHide: true, windowsVerbatimArguments: true });
      running.pid = p.pid;
      const feed = (stream, kind) => {
        let buf = '';
        stream.on('data', (d) => {
          buf += d.toString('utf8');
          const lines = buf.split(/\r?\n|\r/);
          buf = lines.pop();
          for (const l of lines) send('build:line', { stream: kind, text: l.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '') });
        });
        stream.on('end', () => { if (buf) send('build:line', { stream: kind, text: buf }); });
      };
      feed(p.stdout, 'out'); feed(p.stderr, 'err');
      p.on('error', (e) => { send('build:line', { stream: 'err', text: `could not start ${bat}: ${e.message}` }); resolve({ code: 1, signal: null, spawnError: true }); });
      p.on('close', (code, signal) => resolve({ code, signal }));
    });
  }

  async function start(action) {
    if (running) return { ok: false, error: `a ${running.action} run is already in progress` };
    if (!SCRIPTS[action]) return { ok: false, error: `unknown action ${action}` };
    if (!repoDir) return { ok: false, error: 'no checkout or embedded source is available' };
    running = { action, startedAt: Date.now(), pid: 0, cancelled: false };
    send('build:state', { state: 'running', action });
    const verdict = { action, code: null, cancelled: false, incomplete: false, ranConsole: false, message: '' };
    const r = await runBat(repoDir, SCRIPTS[action]);
    if (running.cancelled) { verdict.cancelled = true; verdict.code = r.code; verdict.message = 'Cancelled. The build is incomplete; nothing was finished.'; }
    else {
      verdict.code = r.code;
      if (r.code === 0 && action === 'run') {
        send('build:line', { stream: 'out', text: '[gui] build finished with exit code 0; opening mvl.bat tui in a new console' });
        try {
          spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `start "Lab machine" cmd.exe /k ""${path.join(repoDir, 'mvl.bat')}" tui"`], { cwd: repoDir, detached: true, stdio: 'ignore', windowsHide: false, windowsVerbatimArguments: true }).unref();
          verdict.ranConsole = true;
        } catch (e) { verdict.incomplete = true; verdict.message = `Build passed but the TUI console could not be opened: ${e.message}`; }
      }
      if (!verdict.message) verdict.message = r.code === 0 ? `${action === 'installer' ? 'Installer build' : 'Build'} exited with code 0.` : `Failed: the child exited with code ${r.code}.`;
    }
    const dur = Math.round((Date.now() - running.startedAt) / 1000);
    running = null;
    const final = { ...verdict, seconds: dur, state: verdict.cancelled ? 'cancelled' : (verdict.code === 0 && !verdict.incomplete ? 'succeeded' : 'failed') };
    send('build:state', final);
    return { ok: true, ...final };
  }

  function cancel() {
    if (!running || !running.pid) return false;
    running.cancelled = true;
    spawnSync('taskkill.exe', ['/pid', String(running.pid), '/T', '/F'], { windowsHide: true });
    return true;
  }

  ipcMain.handle('build:info', () => info());
  ipcMain.handle('build:start', (_e, action) => start(action));
  ipcMain.handle('build:cancel', () => cancel());
  ipcMain.handle('build:open-folder', (_e, which) => {
    const target = which === 'dist' && repoDir ? path.join(repoDir, 'dist') : repoDir;
    if (target && fs.existsSync(target)) return shell.openPath(target);
    return 'folder does not exist yet';
  });
  // Quitting is decided by the manager: it parks while work runs and cancels only after the person confirms.
  return { getRepoDir: () => repoDir, isRunning: () => Boolean(running), cancel };
}

module.exports = { registerBuild };
