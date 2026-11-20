'use strict';
// Settings provenance, main-process side. Says, for each manager setting, whether its value was
// written to settings.json or whether the manager is falling back to its compiled-in default, and
// names that default. Read-only: it never writes settings (the Settings page and the quick-add boxes
// both write through the existing mvl:settings-set channel, so they share one stored key).
const fs = require('node:fs');
const path = require('node:path');

const FALLBACK_DEFAULTS = { stateRoot: '', defaultNet: 'nat', theme: 'system', reduceMotion: false };

function provenance(text, defaults) {
  let obj = null, error = '';
  if (text != null) { try { obj = JSON.parse(String(text).replace(/^﻿/, '')); } catch (e) { error = 'settings.json is not valid JSON, so every value is the default: ' + e.message; } }
  const out = {};
  for (const k of Object.keys(defaults)) {
    const written = !!(obj && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, k));
    out[k] = { written, value: written ? obj[k] : defaults[k], defaultValue: defaults[k] };
  }
  return { keys: out, fileExists: text != null, error };
}

function register(ipcMain, app, opts = {}) {
  const defaults = Object.assign({}, FALLBACK_DEFAULTS, opts.defaults || {});
  const file = path.join(app.getPath('userData'), 'settings.json');
  ipcMain.removeHandler('guidance:provenance');
  ipcMain.handle('guidance:provenance', () => {
    let text = null; try { text = fs.readFileSync(file, 'utf8'); } catch { /* no file yet: every value is the default */ }
    return Object.assign(provenance(text, defaults), { file });
  });
}

module.exports = { register, provenance, FALLBACK_DEFAULTS };
