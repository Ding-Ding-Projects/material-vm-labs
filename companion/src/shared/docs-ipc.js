'use strict';
// IPC for the bundled documentation site reader. Everything is bundled; nothing here touches the network.
const { ipcMain, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { root } = require('./repo');

function registerDocs(app) {
  ipcMain.handle('docs:data', () => {
    try {
      return JSON.parse(fs.readFileSync(path.join(root, 'generated', 'docs.json'), 'utf8'));
    } catch (e) {
      return { version: app.getVersion(), commit: 'unknown', docs: [], error: String(e.message || e) };
    }
  });
  ipcMain.handle('docs:open-external', (_e, url) => {
    if (/^https?:\/\//i.test(String(url))) return shell.openExternal(String(url));
    return false;
  });
}

module.exports = { registerDocs };
