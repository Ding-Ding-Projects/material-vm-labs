'use strict';
// Shared School mode record, main-process side. One small JSON file in the shared application-data
// folder used by every Material VM Labs companion, so turning the mode on in one app turns it on in
// all of them, live: each app watches the file and tells its pages when it changes.
// The record holds the on/off state, the chosen name and a PBKDF2 hash of the unlock PIN or
// password (never the PIN or password itself). It is a user-experience lock, not a security
// boundary: deleting the file resets it, and the app says so.
const fs = require('node:fs');
const path = require('node:path');

const SHARED_DIR_NAME = 'Material VM Labs Shared'; // identity constant, never derived from a display name
const FILE_NAME = 'school-mode.json';
const MAX_BYTES = 8 * 1024;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

function validate(rec) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return 'The record is not an object.';
  const keys = Object.keys(rec);
  if (keys.some((k) => !['v', 'on', 'name', 'cred', 'updatedAt'].includes(k))) return 'The record has unknown fields.';
  if (rec.v !== 1) return 'Unsupported record version.';
  if (typeof rec.on !== 'boolean') return 'The on field must be true or false.';
  if (typeof rec.name !== 'string' || rec.name.length > 40 || /[\u0000-\u001f]/.test(rec.name)) return 'The name must be at most 40 printable characters.';
  if (rec.updatedAt != null && (typeof rec.updatedAt !== 'string' || rec.updatedAt.length > 40)) return 'Invalid timestamp.';
  if (rec.cred != null) {
    const c = rec.cred;
    if (typeof c !== 'object' || Array.isArray(c)) return 'Invalid credential record.';
    if (Object.keys(c).some((k) => !['kind', 'alg', 'iterations', 'salt', 'hash'].includes(k))) return 'The credential record has unknown fields.';
    if (!['pin', 'password'].includes(c.kind) || c.alg !== 'PBKDF2-SHA-256') return 'Unsupported credential kind.';
    if (!Number.isInteger(c.iterations) || c.iterations < 100000 || c.iterations > 5000000) return 'Invalid iteration count.';
    if (typeof c.salt !== 'string' || !B64.test(c.salt) || c.salt.length > 64) return 'Invalid salt.';
    if (typeof c.hash !== 'string' || !B64.test(c.hash) || c.hash.length > 64) return 'Invalid hash.';
  }
  if (rec.on && !rec.cred) return 'The mode cannot be on without an unlock credential.';
  return '';
}

function register(ipcMain, app, getWindows) {
  const dir = path.join(app.getPath('appData'), SHARED_DIR_NAME);
  const file = path.join(dir, FILE_NAME);
  const windows = typeof getWindows === 'function' ? getWindows : () => require('electron').BrowserWindow.getAllWindows();

  function read() {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); }
    catch (e) { if (e.code === 'ENOENT') return { ok: true, record: null, file }; return { ok: false, error: 'The shared record could not be read (' + e.code + ').', file }; }
    if (text.length > MAX_BYTES) return { ok: false, error: 'The shared record is larger than expected.', file };
    let rec; try { rec = JSON.parse(text); } catch { return { ok: false, error: 'The shared record is not valid JSON.', file }; }
    const err = validate(rec);
    return err ? { ok: false, error: 'The shared record is invalid: ' + err, file } : { ok: true, record: rec, file };
  }
  function write(rec) {
    const err = validate(rec);
    if (err) return { ok: false, error: err };
    try {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = file + '.' + process.pid + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(rec));
      fs.renameSync(tmp, file);
      return { ok: true };
    } catch (e) { return { ok: false, error: 'The shared record could not be saved (' + (e.code || 'error') + ').' }; }
  }

  let timer = null, watcher = null;
  function broadcast() {
    clearTimeout(timer);
    timer = setTimeout(() => { const r = read(); for (const w of windows()) { try { if (!w.isDestroyed()) w.webContents.send('personal:school-changed', r); } catch { /* window closing */ } } }, 80);
  }
  function watch() {
    try { fs.mkdirSync(dir, { recursive: true }); watcher = fs.watch(dir, (_ev, name) => { if (!name || name === FILE_NAME) broadcast(); }); watcher.on('error', () => { watcher = null; }); }
    catch { watcher = null; }
  }
  watch();

  ipcMain.removeHandler('personal:school-read');
  ipcMain.handle('personal:school-read', () => Object.assign(read(), { watching: !!watcher }));
  ipcMain.removeHandler('personal:school-write');
  ipcMain.handle('personal:school-write', (_e, rec) => { const r = write(rec); if (r.ok) broadcast(); return r; });
}

module.exports = { register, validate, SHARED_DIR_NAME, FILE_NAME };
