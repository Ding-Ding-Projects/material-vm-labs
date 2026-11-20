'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('mvl', {
  settings: () => ipcRenderer.invoke('mvl:settings-get'),
  setSettings: (patch) => ipcRenderer.invoke('mvl:settings-set', patch),
  run: (op, params, id, label) => ipcRenderer.invoke('mvl:run', op, params, id, label),
  recovered: () => ipcRenderer.invoke('mvl:recovered'),
  dismissRecovered: (pid) => ipcRenderer.invoke('mvl:recovered-dismiss', pid),
  openShare: (name) => ipcRenderer.invoke('mvl:open-share', name),
  cancel: (id) => ipcRenderer.invoke('mvl:cancel', id),
  receipts: () => ipcRenderer.invoke('mvl:receipts'),
  metas: () => ipcRenderer.invoke('mvl:metas'),
  mediaInfo: () => ipcRenderer.invoke('mvl:media-info'),
  selectServerMedia: () => ipcRenderer.invoke('mvl:select-server-media'),
  shot: (name) => ipcRenderer.invoke('mvl:shot', name),
  copy: (text) => ipcRenderer.invoke('mvl:copy', text),
  openFolder: (which) => ipcRenderer.invoke('mvl:open-folder', which),
  onLine: (cb) => ipcRenderer.on('mvl:line', (_e, p) => cb(p)),
  ghStatus: () => ipcRenderer.invoke('mvl:gh-status'),
  runnerLive: (repos) => ipcRenderer.invoke('mvl:runner-live', repos),
  ghRepos: () => ipcRenderer.invoke('mvl:gh-repos'),
  runnerHost: (p) => ipcRenderer.invoke('mvl:runner-host', p),
  runnerWorkflows: (repo) => ipcRenderer.invoke('mvl:runner-workflows', repo),
  runnerRunWorkflow: (repo, path) => ipcRenderer.invoke('mvl:runner-run-workflow', repo, path),
  onRunnerStep: (cb) => ipcRenderer.on('mvl:runner-step', (_e, p) => cb(p))
});
contextBridge.exposeInMainWorld('mvlDocs', {
  load: () => ipcRenderer.invoke('docs:data'),
  openExternal: (url) => ipcRenderer.invoke('docs:open-external', url)
});
contextBridge.exposeInMainWorld('mvlBuild', {
  info: () => ipcRenderer.invoke('build:info'),
  start: (action) => ipcRenderer.invoke('build:start', action),
  cancel: () => ipcRenderer.invoke('build:cancel'),
  openFolder: (which) => ipcRenderer.invoke('build:open-folder', which),
  onLine: (cb) => ipcRenderer.on('build:line', (_e, p) => cb(p)),
  onState: (cb) => ipcRenderer.on('build:state', (_e, p) => cb(p))
});
