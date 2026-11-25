'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('mvlDocs', {
  load: () => ipcRenderer.invoke('docs:data'),
  openExternal: (url) => ipcRenderer.invoke('docs:open-external', url)
});
contextBridge.exposeInMainWorld('mvlDimsum', { pick: () => ipcRenderer.invoke('dimsum:pick') });
contextBridge.exposeInMainWorld('mvlSafety', {
  info: () => ipcRenderer.invoke('safety:info'),
  openAppData: () => ipcRenderer.invoke('safety:open-app-data'),
  vaultGet: (k) => ipcRenderer.invoke('safety:vault-get', k),
  vaultSet: (k, v) => ipcRenderer.invoke('safety:vault-set', k, v),
  vaultDelete: (k) => ipcRenderer.invoke('safety:vault-delete', k),
  status: (k) => ipcRenderer.invoke('safety:status', k),
  attempt: (k, ok) => ipcRenderer.invoke('safety:attempt', k, ok),
  challenge: (k, o) => ipcRenderer.invoke('safety:challenge', k, o),
  answer: (k, n, a) => ipcRenderer.invoke('safety:answer', k, n, a),
  forget: (k) => ipcRenderer.invoke('safety:forget', k)
});
contextBridge.exposeInMainWorld('mvlPersonal', {
  schoolRead: () => ipcRenderer.invoke('personal:school-read'),
  schoolWrite: (rec) => ipcRenderer.invoke('personal:school-write', rec),
  onSchoolChanged: (cb) => ipcRenderer.on('personal:school-changed', (_e, r) => cb(r))
});
contextBridge.exposeInMainWorld('mvlBase64', {
  pathFor: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch { return ''; } },
  pick: (mode) => ipcRenderer.invoke('base64:pick', mode),
  encodeBeside: (jobId, filePath, opts) => ipcRenderer.invoke('base64:encode-beside', jobId, filePath, opts),
  decodeBeside: (jobId, filePath, opts) => ipcRenderer.invoke('base64:decode-beside', jobId, filePath, opts),
  control: (jobId, action) => ipcRenderer.invoke('base64:control', jobId, action),
  showInFolder: (p) => ipcRenderer.invoke('base64:show', p),
  onProgress: (cb) => ipcRenderer.on('base64:progress', (_e, d) => cb(d))
});

const sub = (ch) => (cb) => { const f = (_e, d) => cb(d); ipcRenderer.on(ch, f); return () => ipcRenderer.removeListener(ch, f); };
contextBridge.exposeInMainWorld('mvlOllama', { status: () => ipcRenderer.invoke('ollama:status'), system: () => ipcRenderer.invoke('ollama:system'), setOverhead: (g) => ipcRenderer.invoke('ollama:setOverhead', g), list: () => ipcRenderer.invoke('ollama:list'), ps: () => ipcRenderer.invoke('ollama:ps'), show: (m) => ipcRenderer.invoke('ollama:show', m), delete: (m) => ipcRenderer.invoke('ollama:delete', m), copy: (a) => ipcRenderer.invoke('ollama:copy', a), unload: (m) => ipcRenderer.invoke('ollama:unload', m), pull: (m) => ipcRenderer.invoke('ollama:pull', m), chat: (r) => ipcRenderer.invoke('ollama:chat', r), cancel: (id) => ipcRenderer.invoke('ollama:cancel', id), start: () => ipcRenderer.invoke('ollama:start'), openDownload: () => ipcRenderer.invoke('ollama:openDownload'), onEvent: sub('ollama:event') });
const MC = ['versions', 'versionInfo', 'paperVersions', 'paperBuilds', 'java', 'targets', 'list', 'create', 'remove', 'readProperties', 'writeProperties', 'eula', 'acceptEula', 'setRuntime', 'start', 'stop', 'kill', 'command', 'backup', 'openFolder', 'openEula', 'extract', 'browse', 'generate', 'cancel'];
contextBridge.exposeInMainWorld('mvlMinecraft', Object.assign(Object.fromEntries(MC.map((a) => [a, (x) => ipcRenderer.invoke('minecraft:' + a, x)])), { onEvent: sub('minecraft:event') }));
contextBridge.exposeInMainWorld('mvlVdisk', { probe: () => ipcRenderer.invoke('vdisk:probe'), run: (a) => ipcRenderer.invoke('vdisk:run', a), preview: (a) => ipcRenderer.invoke('vdisk:preview', a), browse: (a) => ipcRenderer.invoke('vdisk:browse', a), pathFor: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch { return ''; } } });
