'use strict';
// documentation site reader: Electron main process (the standalone Docs exe). Everything is bundled, no network is ever used.
const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');
const { root } = require('../shared/repo');
const { registerDocs } = require('../shared/docs-ipc');

function createWindow() {
  registerDocs(app);
  const win = new BrowserWindow({
    width: 1240, height: 820, minWidth: 340, minHeight: 480, title: 'Lab machine Docs', autoHideMenuBar: true, backgroundColor: '#0E1214', titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', symbolColor: '#8FA0A6', height: 32 }, 
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:\/\//i.test(url)) shell.openExternal(url); } });
  win.loadFile(path.join(root, 'renderer', 'docs', 'index.html'));
}

// Each companion keeps its own profile: sharing the manager's meant the second one to start lost
// the single-instance lock and quit (seen 2026-11-19 with Docs and Build open together).
app.setPath('userData', path.join(app.getPath('appData'), 'Lab machine Docs'));
if (!app.requestSingleInstanceLock()) app.quit();
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
