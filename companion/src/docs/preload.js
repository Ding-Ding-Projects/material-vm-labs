'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('mvlDocs', {
  load: () => ipcRenderer.invoke('docs:data'),
  openExternal: (url) => ipcRenderer.invoke('docs:open-external', url)
});
contextBridge.exposeInMainWorld('mvlDimsum', { pick: () => ipcRenderer.invoke('dimsum:pick') });
