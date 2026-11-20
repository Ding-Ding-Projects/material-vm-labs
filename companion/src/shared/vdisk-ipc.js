'use strict';
// Windows virtual disk manager, main-process side. Each operation is validated and turned into a
// PowerShell script by vdisk-core.build (values become single-quoted literals), then run with
// spawn('powershell.exe', [...args]) and an encoded command, never a shell string. Steps that need
// administrator rights go through Windows' own UAC prompt; a cancelled prompt is reported incomplete.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const core = require('./vdisk-core');

function ps(script, timeoutMs) {
  return new Promise((resolve) => {
    let out = '', err = '';
    const c = spawn('powershell.exe', core.powershellArgs(script), { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const t = setTimeout(() => c.kill(), timeoutMs || 30 * 60 * 1000);
    c.stdout.on('data', (d) => { if (out.length < 4e6) out += d; });
    c.stderr.on('data', (d) => { if (err.length < 1e5) err += d; });
    c.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out, err: e.message }); });
    c.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }); });
  });
}
function parse(r) {
  try { return JSON.parse(r.out.trim()); } catch { return { ok: false, error: r.err.trim().slice(0, 600) || `PowerShell ended with code ${r.code} and no result.` }; }
}
const DENIED = /access is denied|0x80070005|requires elevation|administrator|privilege/i;

function register(ipcMain) {
  let dialog = null, BrowserWindow = null;
  try { ({ dialog, BrowserWindow } = require('electron')); } catch { /* tests run without Electron */ }
  const isWin = process.platform === 'win32';
  const unavailable = { ok: false, unavailable: true, error: `Virtual disks need Windows. This computer runs ${process.platform === 'darwin' ? 'macOS' : process.platform}.` };
  let routes = null;

  async function probe() {
    const r = parse(await ps(core.envelope(core.build('probe', {}, {}).body), 60000));
    if (r.ok) routes = { hyperv: !!r.hyperv, storage: !!r.storage, virtdisk: !!r.virtdisk, isAdmin: !!r.isAdmin };
    return r;
  }

  async function runOp(op, args, elevate) {
    if (!routes) await probe();
    const b = core.build(op, args, routes || {});
    const base = { route: b.route, routeName: b.routeName, equivalent: b.equivalent };
    if ((b.admin || elevate) && !(routes && routes.isAdmin)) {
      const resultFile = path.join(os.tmpdir(), `mvl-vdisk-${crypto.randomBytes(6).toString('hex')}.json`);
      const outer = parse(await ps(core.elevatedLauncher(core.envelope(b.body, resultFile))));
      if (outer.cancelled) return { ...base, ok: false, cancelled: true, incomplete: true, elevated: false, error: 'The administrator prompt was cancelled or refused, so this step did not run. Nothing was changed.' };
      if (!outer.elevated) return { ...base, ok: false, incomplete: true, elevated: false, error: outer.error || 'Windows did not start the administrator step.' };
      let res = null;
      try { res = JSON.parse(fs.readFileSync(resultFile, 'utf8').replace(/^﻿/, '')); } catch { res = { ok: false, error: 'The administrator step ended without a result. Treat it as incomplete and check the disk before retrying.' }; }
      try { fs.rmSync(resultFile, { force: true }); } catch { /* temp file */ }
      return { ...base, ...res, elevated: true, incomplete: !res.ok };
    }
    const res = parse(await ps(core.envelope(b.body)));
    return { ...base, ...res, elevated: !!(routes && routes.isAdmin), incomplete: !res.ok, needsAdmin: !res.ok && DENIED.test(String(res.error || '')) };
  }

  const handle = (ch, fn) => { ipcMain.removeHandler(ch); ipcMain.handle(ch, async (e, a) => { try { return await fn(a, e); } catch (err) { return { ok: false, error: err.message }; } }); };
  handle('vdisk:probe', async () => { if (!isWin) return unavailable; const r = await probe(); return { ...r, routes, unbuilt: core.UNBUILT }; });
  handle('vdisk:run', async (a) => {
    if (!a || typeof a !== 'object' || !core.OPS.includes(a.op) || a.op === 'probe') throw new Error('That is not an allowed virtual disk operation.');
    if (a.elevate != null && typeof a.elevate !== 'boolean') throw new Error('Bad request.');
    if (!isWin) return { ...unavailable, equivalent: safePreview(a).equivalent };
    return runOp(a.op, a.args || {}, a.elevate === true);
  });
  function safePreview(a) { try { return core.build(a.op, a.args || {}, routes || { hyperv: true }); } catch (err) { return { error: err.message, equivalent: {} }; } }
  handle('vdisk:preview', async (a) => {
    if (!a || !core.OPS.includes(a.op)) throw new Error('That is not an allowed virtual disk operation.');
    const b = core.build(a.op, a.args || {}, routes || { hyperv: !!(a.assumeHyperV) });
    return { ok: true, route: b.route, routeName: b.routeName, admin: b.admin, equivalent: b.equivalent };
  });
  handle('vdisk:browse', async (a, e) => {
    if (!a || !['open', 'save'].includes(a.mode) || !['disk', 'iso', 'any'].includes(a.kind)) throw new Error('Bad request.');
    if (!dialog) return { ok: false, error: 'No file picker is available here.' };
    const exts = a.kind === 'iso' ? ['iso'] : a.kind === 'disk' ? ['vhdx', 'vhd', 'vhds', 'avhdx', 'avhd'] : ['vhdx', 'vhd', 'vhds', 'avhdx', 'avhd', 'iso'];
    const filters = [{ name: a.kind === 'iso' ? 'Disc images' : 'Virtual disks', extensions: exts }];
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = a.mode === 'open' ? await dialog.showOpenDialog(win, { properties: ['openFile'], filters }) : await dialog.showSaveDialog(win, { filters, properties: ['showOverwriteConfirmation'] });
    const p = a.mode === 'open' ? (r.canceled ? null : r.filePaths[0]) : (r.canceled ? null : r.filePath);
    return { ok: !!p, path: p };
  });
}

module.exports = { register };
