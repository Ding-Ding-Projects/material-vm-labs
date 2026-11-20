'use strict';
// Safety tools, main-process side.
//  - safety:info            the application-data folder path, the platform and whether the
//                           operating-system credential store (Electron safeStorage) is usable.
//  - safety:open-app-data   opens that folder in the platform file manager. It never deletes.
//  - safety:vault-get/set/delete  small values sealed with safeStorage (DPAPI on Windows, Keychain
//                           on macOS, the desktop secret service on Linux) in one file in the
//                           application-data folder. Refuses when only plain-text storage exists.
//  - safety:attempt/status/challenge/answer  the toy-lock attempt budget, lockout clock and unlock
//                           ladder, graded here against single-use nonces (safety-engine.js).
// Every argument is validated; nothing here touches the network or runs a process.
const fs = require('node:fs');
const path = require('node:path');
const { createEngine } = require('./safety-engine');

const KEY_RX = /^[A-Za-z0-9:._-]{1,120}$/;
const NONCE_RX = /^[0-9a-f]{32}$/;
const MAX_VALUE = 512 * 1024;

function register(ipcMain, app) {
  const { shell, safeStorage } = require('electron');
  const dir = () => app.getPath('userData');
  const vaultFile = () => path.join(dir(), 'safety-vault.json');
  const stateFile = () => path.join(dir(), 'safety-lockouts.json');
  const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(v)); fs.renameSync(tmp, f); };

  function vaultState() {
    try {
      if (!safeStorage.isEncryptionAvailable()) return { available: false, reason: 'The operating-system credential store is not available on this computer.' };
      if (process.platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function' && safeStorage.getSelectedStorageBackend() === 'basic_text') return { available: false, reason: 'No desktop secret service is running, so the credential store would only hold plain text.' };
      return { available: true };
    } catch (e) { return { available: false, reason: 'The credential store could not be checked: ' + e.message }; }
  }
  const checkKey = (k) => { if (typeof k !== 'string' || !KEY_RX.test(k)) throw new Error('Invalid key.'); return k; };

  const engine = createEngine({ state: readJson(stateFile()) || undefined });
  const save = () => { try { writeJson(stateFile(), engine.exportState()); } catch { /* lockout state is best effort; the clock still runs in memory */ } };

  const handle = (ch, fn) => { ipcMain.removeHandler(ch); ipcMain.handle(ch, (_e, ...a) => { try { return fn(...a); } catch (err) { return { ok: false, error: err.message }; } }); };

  handle('safety:info', () => ({ ok: true, appData: dir(), platform: process.platform, vault: vaultState() }));
  handle('safety:open-app-data', async () => {
    const p = dir();
    try { fs.mkdirSync(p, { recursive: true }); } catch { /* opening still reports below */ }
    const err = await shell.openPath(p);
    return err ? { ok: false, path: p, error: err } : { ok: true, path: p };
  });

  handle('safety:vault-get', (key) => {
    checkKey(key);
    const v = vaultState(); if (!v.available) return { ok: false, error: v.reason };
    const all = readJson(vaultFile()) || {};
    if (!Object.prototype.hasOwnProperty.call(all, key)) return { ok: true, value: null };
    try { return { ok: true, value: safeStorage.decryptString(Buffer.from(all[key], 'base64')) }; }
    catch { return { ok: false, error: 'The stored value could not be read with this account\'s credential store.' }; }
  });
  handle('safety:vault-set', (key, value) => {
    checkKey(key);
    if (typeof value !== 'string' || value.length > MAX_VALUE) throw new Error('Invalid value.');
    const v = vaultState(); if (!v.available) return { ok: false, error: v.reason };
    const all = readJson(vaultFile()) || {};
    all[key] = safeStorage.encryptString(value).toString('base64');
    writeJson(vaultFile(), all);
    return { ok: true };
  });
  handle('safety:vault-delete', (key) => {
    checkKey(key);
    const all = readJson(vaultFile()) || {};
    delete all[key];
    writeJson(vaultFile(), all);
    return { ok: true };
  });

  handle('safety:status', (key) => Object.assign({ ok: true }, engine.status(checkKey(key))));
  handle('safety:attempt', (key, ok) => {
    checkKey(key);
    if (typeof ok !== 'boolean') throw new Error('Invalid attempt.');
    const r = engine.attempt(key, ok); save(); return Object.assign({ ok: true }, r);
  });
  handle('safety:challenge', (key, opts) => {
    checkKey(key);
    const school = !!(opts && typeof opts === 'object' && opts.school === true);
    const r = engine.challenge(key, { school }); save(); return r;
  });
  handle('safety:answer', (key, nonce, answer) => {
    checkKey(key);
    if (typeof nonce !== 'string' || !NONCE_RX.test(nonce)) throw new Error('Invalid nonce.');
    let size = 0; try { size = JSON.stringify(answer === undefined ? null : answer).length; } catch { throw new Error('Invalid answer.'); }
    if (size > 16 * 1024) throw new Error('Invalid answer.');
    const r = engine.answer(key, nonce, answer); save(); return r;
  });
  handle('safety:forget', (key) => { engine.forget(checkKey(key)); save(); return { ok: true }; });
}

module.exports = { register };
