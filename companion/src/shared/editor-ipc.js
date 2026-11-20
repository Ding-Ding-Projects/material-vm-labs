'use strict';
// External editor hand-off, main-process side.
// Detects installed editors (Visual Studio Code first: `code` on PATH, per-user, machine-wide,
// Insiders and a portable copy you add), remembers the one you choose, and opens a file or a folder
// in it. Folders open in VS Code as a workspace root. Programs start with an argument array, never a
// shell string, and only for paths inside the roots the manager owns or a path you picked in the
// system dialog. When no editor is found it says so and offers the VS Code download page; it never
// opens some other editor you did not ask for.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const VSCODE_DOWNLOAD = 'https://code.visualstudio.com/download';
const ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;

const isFile = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };
const isDir = (f) => { try { return fs.statSync(f).isDirectory(); } catch { return false; } };

function onPath(name, env, platform) {
  const dirs = String(env.PATH || env.Path || '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
  const exts = platform === 'win32' ? ['.cmd', '.exe'] : [''];
  for (const d of dirs) for (const e of exts) { const f = path.join(d, name + e); if (isFile(f)) return f; }
  return null;
}

// Candidate editors for this platform. Each: { id, name, kind: 'vscode'|'other', exe, folders, source }.
function candidates(env = process.env, platform = process.platform) {
  const out = [];
  const add = (id, name, exe, opts = {}) => { if (exe && isFile(exe) && !out.some((x) => x.exe.toLowerCase() === exe.toLowerCase())) out.push(Object.assign({ id, name, exe, kind: 'other', folders: true, source: '' }, opts)); };
  if (platform === 'win32') {
    const la = env.LOCALAPPDATA || '', pf = env.ProgramFiles || 'C:\\Program Files', pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    // `code` on PATH is a .cmd shim in <install>\bin; run the Code.exe beside it instead of a shell.
    const shim = onPath('code', env, platform);
    if (shim && /\.cmd$/i.test(shim)) add('vscode', 'Visual Studio Code', path.join(path.dirname(path.dirname(shim)), 'Code.exe'), { kind: 'vscode', source: 'code on PATH' });
    add('vscode', 'Visual Studio Code', path.join(la, 'Programs', 'Microsoft VS Code', 'Code.exe'), { kind: 'vscode', source: 'per-user install' });
    add('vscode', 'Visual Studio Code', path.join(pf, 'Microsoft VS Code', 'Code.exe'), { kind: 'vscode', source: 'machine-wide install' });
    add('vscode', 'Visual Studio Code', path.join(pf86, 'Microsoft VS Code', 'Code.exe'), { kind: 'vscode', source: 'machine-wide install (x86)' });
    const ishim = onPath('code-insiders', env, platform);
    if (ishim && /\.cmd$/i.test(ishim)) add('vscode-insiders', 'VS Code Insiders', path.join(path.dirname(path.dirname(ishim)), 'Code - Insiders.exe'), { kind: 'vscode', source: 'code-insiders on PATH' });
    add('vscode-insiders', 'VS Code Insiders', path.join(la, 'Programs', 'Microsoft VS Code Insiders', 'Code - Insiders.exe'), { kind: 'vscode', source: 'per-user install' });
    add('vscode-insiders', 'VS Code Insiders', path.join(pf, 'Microsoft VS Code Insiders', 'Code - Insiders.exe'), { kind: 'vscode', source: 'machine-wide install' });
    add('notepad-plus-plus', 'Notepad++', path.join(pf, 'Notepad++', 'notepad++.exe'), { folders: false, source: 'machine-wide install' });
    add('sublime-text', 'Sublime Text', path.join(pf, 'Sublime Text', 'sublime_text.exe'), { source: 'machine-wide install' });
    add('notepad', 'Notepad', path.join(env.SystemRoot || 'C:\\Windows', 'notepad.exe'), { folders: false, source: 'part of Windows' });
  } else {
    add('vscode', 'Visual Studio Code', onPath('code', env, platform), { kind: 'vscode', source: 'code on PATH' });
    if (platform === 'darwin') add('vscode', 'Visual Studio Code', '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code', { kind: 'vscode', source: 'Applications folder' });
    add('vscode-insiders', 'VS Code Insiders', onPath('code-insiders', env, platform), { kind: 'vscode', source: 'code-insiders on PATH' });
    add('vscodium', 'VSCodium', onPath('codium', env, platform), { kind: 'vscode', source: 'codium on PATH' });
    add('sublime-text', 'Sublime Text', onPath('subl', env, platform), { source: 'subl on PATH' });
    add('gedit', 'gedit', onPath('gedit', env, platform), { folders: false, source: 'gedit on PATH' });
  }
  return out;
}

// A program file the person added (for example a portable VS Code). Validated before it is kept.
function validateCustom(exe, platform = process.platform) {
  if (typeof exe !== 'string' || !exe || exe.length > 500 || /[\0\r\n]/.test(exe) || !path.isAbsolute(exe)) return { ok: false, error: 'Choose the editor program file itself.' };
  if (!isFile(exe)) return { ok: false, error: 'That program file does not exist.' };
  if (platform === 'win32' && !/\.exe$/i.test(exe)) return { ok: false, error: 'On Windows choose the editor\'s .exe file.' };
  const base = path.basename(exe).toLowerCase();
  const vscode = /^code( - insiders)?(\.exe)?$|^codium(\.exe)?$/.test(base);
  const portable = vscode && isDir(path.join(path.dirname(exe), 'data'));
  return { ok: true, editor: { id: 'custom', name: vscode ? (portable ? 'Visual Studio Code (portable)' : 'Visual Studio Code') : path.basename(exe), exe, kind: vscode ? 'vscode' : 'other', folders: true, source: portable ? 'portable copy you added' : 'added by you' } };
}

const within = (root, p) => { if (!root) return false; const r = path.relative(path.resolve(root), path.resolve(p)); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

// Decides whether a target path may be opened. roots: folders the manager owns.
function checkTarget(p, roots) {
  if (typeof p !== 'string' || !p || p.length > 1000 || /[\0\r\n]/.test(p) || !path.isAbsolute(p)) return { ok: false, error: 'That is not a full path.' };
  const dir = isDir(p), file = !dir && isFile(p);
  if (!dir && !file) return { ok: false, error: 'That file or folder does not exist (yet).' };
  if (!(roots || []).some((r) => within(r, p))) return { ok: false, error: 'Only files and folders inside the manager\'s own folders open from here. Use Choose a file or folder for anything else.' };
  return { ok: true, isDir: dir };
}

// Child environment without the manager's own Electron variables, so an Electron-based editor starts cleanly.
function cleanEnv(env = process.env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) if (!/^(ELECTRON_|VSCODE_|NODE_OPTIONS$)/i.test(k)) out[k] = v;
  return out;
}

// Returns the argument array for opening target in editor. Folders open as a workspace root.
function argsFor(editor, target, isFolder) {
  if (isFolder && !editor.folders) return { ok: false, error: `${editor.name} opens files only. Choose Visual Studio Code or the system default for folders.` };
  if (editor.kind === 'vscode') return { ok: true, args: isFolder ? ['--new-window', target] : ['--reuse-window', target] };
  return { ok: true, args: [target] };
}

function register(ipcMain, app, opts = {}) {
  const { shell, dialog, BrowserWindow } = require('electron');
  const file = path.join(app.getPath('userData'), 'editor.json');
  const roots = () => [app.getPath('userData')].concat(typeof opts.roots === 'function' ? (opts.roots() || []) : []).filter(Boolean);
  const read = () => { try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return { choice: typeof j.choice === 'string' ? j.choice : '', custom: typeof j.custom === 'string' ? j.custom : '' }; } catch { return { choice: '', custom: '' }; } };
  const write = (s) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(s, null, 2)); };
  function listAll() {
    const s = read();
    const list = candidates();
    if (s.custom) { const c = validateCustom(s.custom); if (c.ok) list.push(c.editor); }
    list.push({ id: 'system', name: 'System default app', exe: '', kind: 'system', folders: true, source: 'opens files with their default app and folders in the file manager' });
    const keyOf = (e) => e.id === 'custom' ? 'custom' : e.id + '|' + e.exe;
    const chosen = list.find((e) => keyOf(e) === s.choice) || list.find((e) => e.id === s.choice) || null;
    return { s, list: list.map((e) => Object.assign({ key: keyOf(e) }, e)), chosen };
  }
  const pub = (e) => e && { key: e.key, id: e.id, name: e.name, kind: e.kind, folders: e.folders, source: e.source, exe: e.exe };
  async function open(target, isFolder, editorKey) {
    const { list, chosen } = listAll();
    let ed = editorKey === 'vscode' ? list.find((e) => e.kind === 'vscode') : editorKey ? list.find((e) => e.key === editorKey) : chosen;
    if (editorKey === 'vscode' && !ed) return { ok: false, noVsCode: true, error: 'Visual Studio Code was not found: not on PATH, not in the per-user or machine-wide folders, and no portable copy was added.', download: VSCODE_DOWNLOAD };
    if (!ed) ed = list.find((e) => e.kind === 'vscode') || list.find((e) => e.id === 'system');
    if (ed.kind === 'system') { const err = await shell.openPath(target); return err ? { ok: false, error: err } : { ok: true, editor: pub(ed), target, asWorkspace: false }; }
    const a = argsFor(ed, target, isFolder); if (!a.ok) return a;
    try {
      const child = spawn(ed.exe, a.args, { detached: true, stdio: 'ignore', shell: false, windowsHide: false, env: cleanEnv() });
      return await new Promise((resolve) => {
        let settled = false;
        child.once('error', (e) => { if (!settled) { settled = true; resolve({ ok: false, error: `${ed.name} could not start: ${e.message}` }); } });
        setTimeout(() => { if (!settled) { settled = true; child.unref(); resolve({ ok: true, editor: pub(ed), target, asWorkspace: isFolder && ed.kind === 'vscode' }); } }, 400);
      });
    } catch (e) { return { ok: false, error: `${ed.name} could not start: ${e.message}` }; }
  }
  const handle = (ch, fn) => { ipcMain.removeHandler(ch); ipcMain.handle(ch, fn); };
  handle('editor:list', () => { const { list, chosen } = listAll(); return { editors: list.map(pub), chosen: pub(chosen), hasVsCode: list.some((e) => e.kind === 'vscode'), download: VSCODE_DOWNLOAD, roots: roots() }; });
  handle('editor:choose', (_e, key) => {
    if (typeof key !== 'string' || key.length > 1100) return { ok: false, error: 'invalid request' };
    const { s, list } = listAll(); const e = list.find((x) => x.key === key); if (!e) return { ok: false, error: 'That editor is not available.' };
    write(Object.assign(s, { choice: key })); return { ok: true, chosen: pub(e) };
  });
  handle('editor:add', async (event) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { title: 'Choose an editor program', properties: ['openFile'], filters: process.platform === 'win32' ? [{ name: 'Programs', extensions: ['exe'] }] : [] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, cancelled: true };
    const c = validateCustom(r.filePaths[0]); if (!c.ok) return c;
    const s = read(); write(Object.assign(s, { custom: c.editor.exe, choice: 'custom' })); return { ok: true, editor: pub(Object.assign({ key: 'custom' }, c.editor)) };
  });
  handle('editor:forget-custom', () => { const s = read(); write({ choice: s.choice === 'custom' ? '' : s.choice, custom: '' }); return { ok: true }; });
  // Opens a file or folder the manager owns. editorKey: omitted = your choice, 'vscode' = VS Code only.
  handle('editor:open', async (_e, target, editorKey) => {
    const t = checkTarget(target, roots()); if (!t.ok) return t;
    if (editorKey != null && (typeof editorKey !== 'string' || editorKey.length > 1100)) return { ok: false, error: 'invalid request' };
    return open(path.resolve(target), t.isDir, editorKey || null);
  });
  // Opens whatever you pick in the system dialog (file or folder).
  handle('editor:pick-and-open', async (event, folder, editorKey) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { title: folder ? 'Choose a folder to open' : 'Choose a file to open', properties: [folder ? 'openDirectory' : 'openFile'] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, cancelled: true };
    return open(r.filePaths[0], !!folder, typeof editorKey === 'string' ? editorKey : null);
  });
  handle('editor:download-vscode', async () => { await shell.openExternal(VSCODE_DOWNLOAD); return { ok: true }; });
}

module.exports = { register, candidates, validateCustom, checkTarget, argsFor, cleanEnv, VSCODE_DOWNLOAD, ID_RE };
