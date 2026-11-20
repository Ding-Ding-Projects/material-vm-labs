'use strict';
// lab machine build GUI: Electron main process (the standalone Build exe).
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const { root } = require('../shared/repo');
const { registerBuild } = require('../shared/build-ipc');
const dimsum = require('../shared/dimsum-ipc');
const { registerDocs } = require('../shared/docs-ipc');

let win = null;
function createWindow() {
  registerBuild(app, () => win);
  win = new BrowserWindow({
    width: 1100, height: 760, minWidth: 360, minHeight: 520, title: 'Material VM Labs Build', autoHideMenuBar: true, backgroundColor: '#141316', titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', symbolColor: '#CAC4CF', height: 32 }, 
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) e.preventDefault(); });
  win.loadFile(path.join(root, 'renderer', 'build', 'index.html'));
  win.on('closed', () => { win = null; });
}

// Each companion keeps its own profile: sharing the manager's meant the second one to start lost
// the single-instance lock and quit (seen 2026-11-19 with Docs and Build open together).
app.setPath('userData', path.join(app.getPath('appData'), 'Material VM Labs Build'));
if (!app.requestSingleInstanceLock()) app.quit();
app.whenReady().then(() => { registerDocs(app); dimsum.register(require('electron').ipcMain, app); require('../shared/safety-ipc').register(require('electron').ipcMain, app); require('../shared/personal-ipc').register(require('electron').ipcMain, app); require('../shared/base64-ipc').register(require('electron').ipcMain, app); require('../shared/ollama-ipc').register(require('electron').ipcMain, app); require('../shared/minecraft-ipc').register(require('electron').ipcMain, app); require('../shared/vdisk-ipc').register(require('electron').ipcMain, app); }).then(createWindow);
app.on('window-all-closed', () => app.quit());
