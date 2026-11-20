'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');
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
contextBridge.exposeInMainWorld('mvlUpdates', {
  state: () => ipcRenderer.invoke('updates:state'), check: () => ipcRenderer.invoke('updates:check'),
  download: () => ipcRenderer.invoke('updates:download'), cancel: () => ipcRenderer.invoke('updates:cancel'),
  restart: (o) => ipcRenderer.invoke('updates:restart', o), later: () => ipcRenderer.invoke('updates:later'),
  setAuto: (on) => ipcRenderer.invoke('updates:set-auto', on), refreshComing: () => ipcRenderer.invoke('updates:coming-refresh'),
  openNotes: () => ipcRenderer.invoke('updates:open-notes'), openBuild: () => ipcRenderer.invoke('updates:open-build'),
  onState: (cb) => ipcRenderer.on('updates:state', (_e, s) => cb(s))
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
contextBridge.exposeInMainWorld('mvlVdisk', { probe: () => ipcRenderer.invoke('vdisk:probe'), run: (a) => ipcRenderer.invoke('vdisk:run', a), preview: (a) => ipcRenderer.invoke('vdisk:preview', a), browse: (a) => ipcRenderer.invoke('vdisk:browse', a) });
contextBridge.exposeInMainWorld('mvlExtensions', {
  list: () => ipcRenderer.invoke('ext:list'), reload: () => ipcRenderer.invoke('ext:reload'),
  setEnabled: (id, on) => ipcRenderer.invoke('ext:set-enabled', id, on),
  allow: (id, version, permissions) => ipcRenderer.invoke('ext:allow', id, version, permissions),
  master: (off) => ipcRenderer.invoke('ext:master', off),
  run: (id, action, context) => ipcRenderer.invoke('ext:run', id, action, context),
  actionsFor: (hook) => ipcRenderer.invoke('ext:actions-for', hook),
  openFolder: (id) => ipcRenderer.invoke('ext:open-folder', id), pickFolder: () => ipcRenderer.invoke('ext:pick-folder'),
  install: (token, replace) => ipcRenderer.invoke('ext:install', token, replace),
  remove: (id) => ipcRenderer.invoke('ext:remove', id), restoreBuiltins: () => ipcRenderer.invoke('ext:restore-builtins')
});
contextBridge.exposeInMainWorld('mvlEditor', {
  list: () => ipcRenderer.invoke('editor:list'), choose: (key) => ipcRenderer.invoke('editor:choose', key),
  add: () => ipcRenderer.invoke('editor:add'), forgetCustom: () => ipcRenderer.invoke('editor:forget-custom'),
  open: (target, editorKey) => ipcRenderer.invoke('editor:open', target, editorKey),
  pickAndOpen: (folder, editorKey) => ipcRenderer.invoke('editor:pick-and-open', folder, editorKey),
  downloadVsCode: () => ipcRenderer.invoke('editor:download-vscode')
});
contextBridge.exposeInMainWorld('mvlGuidance', { provenance: () => ipcRenderer.invoke('guidance:provenance') });
