'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('mvlBuild', {
  info: () => ipcRenderer.invoke('build:info'),
  start: (action) => ipcRenderer.invoke('build:start', action),
  cancel: () => ipcRenderer.invoke('build:cancel'),
  openFolder: (which) => ipcRenderer.invoke('build:open-folder', which),
  onLine: (cb) => ipcRenderer.on('build:line', (_e, p) => cb(p)),
  onState: (cb) => ipcRenderer.on('build:state', (_e, p) => cb(p))
});
