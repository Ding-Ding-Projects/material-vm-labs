'use strict';
// Manager extensions, main-process side.
//
// An extension is a folder with a versioned manifest (extension.json) and a program in any language.
// The manager never loads extension code into itself: each action runs the program as its own
// process, writes ONE JSON request line to its standard input and reads JSON lines from its standard
// output until ONE answer line arrives. Every run is time limited, every line and the whole output are
// size limited, the answer is validated against the extension's declared permissions, and the input is
// built from an allowlist of non-secret fields so passwords, tokens and credentials never reach it.
//
// What this cannot enforce: an extension is still a program running as you. It can read files you can
// read. The permissions limit what the manager hands over and what it accepts back, not the program.
//
// The pure parts (manifest validation, permission diff, input building, scrubbing, line framing,
// answer validation, the process runner) are exported for the tests; register(ipcMain, app) wires the
// IPC channels and the extensions folder.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const API_VERSION = 1;
const PROTOCOL = 'mvl-extension/1';
const MANIFEST = 'extension.json';
const LIMITS = Object.freeze({
  defaultTimeoutMs: 10000,
  maxTimeoutMs: 30000,
  maxStdoutBytes: 256 * 1024,
  maxLineBytes: 64 * 1024,
  maxStderrBytes: 16 * 1024,
  maxReportChars: 32000,
  maxChecks: 50,
  maxLogs: 50,
  maxManifestBytes: 32 * 1024,
  maxFolderBytes: 20 * 1024 * 1024,
  maxFolderFiles: 500,
  maxRunsKept: 20
});

// What an extension can hook. Each hook names the permission its input needs.
const HOOKS = Object.freeze({
  receipt: { title: 'A fresh-build receipt', needs: 'receive:receipt' },
  'machine-plan': { title: 'A machine you are about to create', needs: 'receive:machine-plan' },
  machine: { title: 'An existing lab machine', needs: 'receive:machine' }
});

const PERMISSIONS = Object.freeze({
  'receive:receipt': 'Read a fresh-build receipt summary: repository, commit, verdict, entrypoint results, run time, dependency counts and the machine size. Never file paths or passwords.',
  'receive:machine-plan': 'Read the choices for a machine you are about to create: name, project, system, size, network, hypervisor and guest user name. Never the password, only whether the default one is in use.',
  'receive:machine': 'Read an existing machine\'s name, project, system, hypervisor, power state and status.',
  'receive:machine-address': 'Also read an existing machine\'s IP address.',
  'answer:report': 'Show you a written report. It is rendered as plain Markdown; links open only when you click them.',
  'answer:checks': 'Show you a list of checks marked pass, warning or fail.'
});

const RUNTIMES = Object.freeze({
  node: 'Node.js, using the copy built into Material VM Labs (always present).',
  powershell: 'Windows PowerShell (always present on Windows), or pwsh elsewhere.',
  python: 'Python 3 from your PATH (py, python3 or python). Unavailable when Python is not installed.',
  executable: 'A program file inside the extension folder.'
});

const ID_RE = /^[a-z0-9][a-z0-9-]{1,47}$/;
const ACTION_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SEMVER_RE = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})(-[0-9A-Za-z.-]{1,40})?$/;
const MAIN_RE = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+){0,4}$/;
const MANIFEST_KEYS = new Set(['manifestVersion', 'id', 'name', 'version', 'apiVersion', 'description', 'author', 'runtime', 'main', 'hooks', 'actions', 'permissions', 'timeoutSeconds']);

const isStr = (v, min, max) => typeof v === 'string' && v.trim().length >= min && v.length <= max;

// ---------- Manifest validation ----------
// Returns { ok, errors: [plain sentences], manifest (normalised copy when ok) }.
function validateManifest(m) {
  const errors = [];
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { ok: false, errors: ['The manifest is not a JSON object.'] };
  for (const k of Object.keys(m)) if (!MANIFEST_KEYS.has(k)) errors.push(`Unknown field "${String(k).slice(0, 40)}". Check its spelling against the author guide.`);
  if (m.manifestVersion !== 1) errors.push('manifestVersion must be 1.');
  if (!(typeof m.id === 'string' && ID_RE.test(m.id))) errors.push('id must be 2 to 48 lower-case letters, digits or hyphens, starting with a letter or digit.');
  if (!isStr(m.name, 1, 60)) errors.push('name must be 1 to 60 characters.');
  if (!(typeof m.version === 'string' && SEMVER_RE.test(m.version))) errors.push('version must look like 1.2.3.');
  if (typeof m.apiVersion !== 'number' || !Number.isInteger(m.apiVersion)) errors.push('apiVersion must be a whole number.');
  else if (m.apiVersion > API_VERSION) errors.push(`apiVersion ${m.apiVersion} needs a newer Material VM Labs; this one speaks ${API_VERSION}.`);
  else if (m.apiVersion < 1) errors.push('apiVersion must be 1.');
  if (!isStr(m.description, 1, 400)) errors.push('description must be 1 to 400 characters.');
  if (m.author !== undefined && !isStr(m.author, 1, 80)) errors.push('author, when given, must be 1 to 80 characters.');
  if (!Object.prototype.hasOwnProperty.call(RUNTIMES, m.runtime)) errors.push('runtime must be one of: ' + Object.keys(RUNTIMES).join(', ') + '.');
  if (!(typeof m.main === 'string' && MAIN_RE.test(m.main) && !m.main.split('/').some((p) => p === '..' || p === '.'))) errors.push('main must be a relative path inside the extension folder, using letters, digits, dot, dash, underscore and forward slashes.');
  const hooks = Array.isArray(m.hooks) ? m.hooks : null;
  if (!hooks || !hooks.length || hooks.length > 3) errors.push('hooks must list 1 to 3 of: ' + Object.keys(HOOKS).join(', ') + '.');
  else {
    for (const h of hooks) if (!Object.prototype.hasOwnProperty.call(HOOKS, h)) errors.push(`Unknown hook "${String(h).slice(0, 40)}".`);
    if (new Set(hooks).size !== hooks.length) errors.push('hooks lists the same hook twice.');
  }
  const perms = Array.isArray(m.permissions) ? m.permissions : null;
  if (!perms) errors.push('permissions must be a list (it may not be missing).');
  else {
    for (const p of perms) if (!Object.prototype.hasOwnProperty.call(PERMISSIONS, p)) errors.push(`Unknown permission "${String(p).slice(0, 40)}".`);
    if (new Set(perms).size !== perms.length) errors.push('permissions lists the same permission twice.');
    if (hooks) for (const h of hooks) if (HOOKS[h] && !perms.includes(HOOKS[h].needs)) errors.push(`The ${h} hook needs the ${HOOKS[h].needs} permission.`);
    if (perms.includes('receive:machine-address') && !perms.includes('receive:machine')) errors.push('receive:machine-address only makes sense together with receive:machine.');
    if (!perms.includes('answer:report') && !perms.includes('answer:checks')) errors.push('permissions must include answer:report or answer:checks, or the extension could never show you anything.');
  }
  const actions = Array.isArray(m.actions) ? m.actions : null;
  if (!actions || !actions.length || actions.length > 10) errors.push('actions must list 1 to 10 actions.');
  else {
    const seen = new Set();
    actions.forEach((a, i) => {
      if (!a || typeof a !== 'object') { errors.push(`Action ${i + 1} is not an object.`); return; }
      for (const k of Object.keys(a)) if (!['id', 'title', 'hook', 'description'].includes(k)) errors.push(`Action ${i + 1} has an unknown field "${String(k).slice(0, 40)}".`);
      if (!(typeof a.id === 'string' && ACTION_RE.test(a.id))) errors.push(`Action ${i + 1} needs an id of lower-case letters, digits or hyphens.`);
      else if (seen.has(a.id)) errors.push(`Two actions share the id "${a.id}".`); else seen.add(a.id);
      if (!isStr(a.title, 1, 60)) errors.push(`Action ${i + 1} needs a title of 1 to 60 characters.`);
      if (a.description !== undefined && !isStr(a.description, 1, 300)) errors.push(`Action ${i + 1}'s description must be 1 to 300 characters.`);
      if (!hooks || !hooks.includes(a.hook)) errors.push(`Action ${i + 1}'s hook must be one of the hooks the manifest lists.`);
    });
  }
  if (m.timeoutSeconds !== undefined && !(Number.isInteger(m.timeoutSeconds) && m.timeoutSeconds >= 1 && m.timeoutSeconds <= LIMITS.maxTimeoutMs / 1000)) errors.push(`timeoutSeconds, when given, must be a whole number from 1 to ${LIMITS.maxTimeoutMs / 1000}.`);
  if (errors.length) return { ok: false, errors };
  const manifest = {
    manifestVersion: 1, id: m.id, name: m.name.trim(), version: m.version, apiVersion: m.apiVersion, description: m.description.trim(), author: m.author ? m.author.trim() : '',
    runtime: m.runtime, main: m.main, hooks: [...hooks], permissions: [...perms].sort(),
    actions: actions.map((a) => ({ id: a.id, title: a.title.trim(), hook: a.hook, description: a.description ? a.description.trim() : '' })),
    timeoutMs: m.timeoutSeconds ? m.timeoutSeconds * 1000 : LIMITS.defaultTimeoutMs
  };
  return { ok: true, errors: [], manifest };
}

function parseManifestText(text) {
  if (typeof text !== 'string') return { ok: false, errors: ['The manifest could not be read.'] };
  if (Buffer.byteLength(text, 'utf8') > LIMITS.maxManifestBytes) return { ok: false, errors: [`The manifest is larger than ${LIMITS.maxManifestBytes / 1024} KB.`] };
  let obj;
  try { obj = JSON.parse(text.replace(/^\uFEFF/, '')); } catch (e) { return { ok: false, errors: ['The manifest is not valid JSON: ' + e.message] }; }
  return validateManifest(obj);
}

// ---------- Consent ----------
// allowed: { version, permissions } the person agreed to, or null. manifest: the current one.
function permissionDiff(allowed, manifest) {
  const now = [...manifest.permissions].sort();
  if (!allowed || !Array.isArray(allowed.permissions)) return { status: 'new', added: now, removed: [], kept: [], fromVersion: null, toVersion: manifest.version };
  const before = new Set(allowed.permissions);
  const added = now.filter((p) => !before.has(p));
  const removed = [...before].filter((p) => !now.includes(p)).sort();
  const kept = now.filter((p) => before.has(p));
  const versionChanged = allowed.version !== manifest.version;
  return { status: added.length || removed.length || versionChanged ? 'changed' : 'same', added, removed, kept, fromVersion: allowed.version || null, toVersion: manifest.version, versionChanged };
}

// ---------- What the manager hands over ----------
const SECRET_KEY_RE = /pass(word|wd|phrase)?|secret|token|credential|cookie|api[-_]?key|private[-_]?key|auth|session|dpapi|\bkey\b/i;
const SECRET_VALUE_RES = [
  /gh[pousr]_[A-Za-z0-9]{20,}/g, /github_pat_[A-Za-z0-9_]{20,}/g, /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /xox[abprs]-[A-Za-z0-9-]{10,}/g, /AKIA[0-9A-Z]{16}/g, /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,
  /https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/[^\s"']+/gi
];
// Long mixed-case base64-like runs (keys, tokens). Pure hex such as a commit id is kept.
const looksLikeKey = (m) => !/^[0-9a-f]+$/i.test(m) && /[A-Z]/.test(m) && /[a-z]/.test(m) && /\d/.test(m);
// Defence in depth after the allowlist: drops secret-looking keys and blanks secret-looking values.
function scrubSensitive(v, depth = 0) {
  if (depth > 6) return null;
  if (typeof v === 'string') { let s = v.length > 2000 ? v.slice(0, 2000) : v; for (const re of SECRET_VALUE_RES) s = s.replace(re, '[removed]'); return s.replace(/[A-Za-z0-9+/_-]{40,}={0,2}/g, (m) => (looksLikeKey(m) ? '[removed]' : m)); }
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean' || v === null) return v;
  if (Array.isArray(v)) return v.slice(0, 200).map((x) => scrubSensitive(x, depth + 1));
  if (typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) { if (SECRET_KEY_RE.test(k)) continue; if (x === undefined) continue; o[k] = scrubSensitive(x, depth + 1); }
    return o;
  }
  return null;
}
const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : v == null ? null : String(v).slice(0, max));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null));
const MACHINE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;

// Builds the request input for a hook from the context the page sent, keeping only allowlisted
// fields the extension's permissions cover. Returns { ok, input } or { ok:false, error }.
function buildInput(hook, permissions, context) {
  const perms = new Set(permissions || []);
  const c = context && typeof context === 'object' ? context : {};
  if (!HOOKS[hook]) return { ok: false, error: 'unknown hook' };
  if (!perms.has(HOOKS[hook].needs)) return { ok: false, error: `the extension was not allowed ${HOOKS[hook].needs}` };
  let input;
  if (hook === 'receipt') {
    const r = c.receipt; if (!r || typeof r !== 'object') return { ok: false, error: 'pick a receipt first' };
    const m = r.machine && typeof r.machine === 'object' ? r.machine : null;
    const d = r.dependencies && typeof r.dependencies === 'object' ? r.dependencies : null;
    input = {
      receipt: {
        kind: r.kind === 'install' ? 'install' : 'build', runId: str(r.runId, 120), verdict: str(r.verdict, 40), repository: str(r.repository, 200), commit: str(r.commit, 64),
        hostMinutes: num(r.hostMinutes), finishedUtc: str(r.finishedUtc, 40),
        entrypoints: Array.isArray(r.entrypoints) ? r.entrypoints.slice(0, 20).map((e) => ({ name: str(e && e.name, 80), result: str(e && e.result, 40), exitCode: num(e && e.exitCode) })) : [],
        dependencies: d ? { tools: num(d.tools), programs: num(d.programs), choco: num(d.choco), folders: num(d.folders), megabytes: num(d.megabytes) } : null,
        machine: m ? { name: str(m.name, 40), project: str(m.project, 80), hypervisor: str(m.hypervisor, 40), memoryMB: num(m.memoryMB), cpus: num(m.cpus), network: str(m.network, 20), guestOs: str(m.guestOs, 60) } : null
      }
    };
  } else if (hook === 'machine-plan') {
    const p = c.plan; if (!p || typeof p !== 'object') return { ok: false, error: 'there is no machine plan to check' };
    input = {
      plan: {
        name: str(p.name, 60), project: str(p.project, 80), os: ['windows', 'ubuntu', 'debian'].includes(p.os) ? p.os : null, hypervisor: ['auto', 'vmware', 'virtualbox'].includes(p.hv) ? p.hv : null,
        memoryMB: num(p.mem), cpus: num(p.cpus), network: ['nat', 'bridged', 'hostonly'].includes(p.net) ? p.net : null, guestUser: str(p.user, 40),
        usesDefaultSignIn: !!p.usesDefaultSignIn, forWhom: p.for === 'agent' ? 'agent' : 'you', requireTpm: !!p.requireTpm
      }
    };
  } else {
    const m = c.machine; if (!m || typeof m !== 'object' || !MACHINE_NAME_RE.test(String(m.Name || m.name || ''))) return { ok: false, error: 'pick a machine first' };
    input = { machine: { name: str(m.Name || m.name, 40), project: str(m.Project || m.project, 80), os: str(m.Os || m.os, 20), hypervisor: str(m.Hypervisor || m.hypervisor, 40), power: str(m.Power || m.power, 20), status: str(m.Status || m.status, 40), runners: num(m.Runners != null ? m.Runners : m.runners) } };
    if (perms.has('receive:machine-address')) input.machine.ip = /^[0-9a-fA-F:.]{2,45}$/.test(String(m.IP || m.ip || '')) ? String(m.IP || m.ip) : null;
  }
  return { ok: true, input: scrubSensitive(input) };
}

function makeRequest(manifest, actionId, hook, input) {
  return { protocol: PROTOCOL, type: 'run', apiVersion: API_VERSION, extension: { id: manifest.id, version: manifest.version }, action: actionId, hook, input, limits: { timeoutMs: manifest.timeoutMs, maxAnswerBytes: LIMITS.maxLineBytes, maxReportChars: LIMITS.maxReportChars, maxChecks: LIMITS.maxChecks } };
}

// ---------- Framing: JSON lines with limits ----------
function createLineParser(opts = {}) {
  const maxLine = opts.maxLineBytes || LIMITS.maxLineBytes;
  const maxTotal = opts.maxTotalBytes || LIMITS.maxStdoutBytes;
  let buf = Buffer.alloc(0), total = 0, failed = null;
  return {
    push(chunk) {
      if (failed) return { lines: [], error: failed };
      total += chunk.length;
      if (total > maxTotal) { failed = `wrote more than ${Math.round(maxTotal / 1024)} KB to standard output`; return { lines: [], error: failed }; }
      buf = Buffer.concat([buf, chunk]);
      const lines = [];
      let i;
      while ((i = buf.indexOf(0x0a)) >= 0) {
        const raw = buf.subarray(0, i); buf = buf.subarray(i + 1);
        if (raw.length > maxLine) { failed = `wrote a line longer than ${Math.round(maxLine / 1024)} KB`; return { lines, error: failed }; }
        const t = raw.toString('utf8').replace(/\r$/, '');
        if (t.trim()) lines.push(t);
      }
      if (buf.length > maxLine) { failed = `wrote a line longer than ${Math.round(maxLine / 1024)} KB`; return { lines, error: failed }; }
      return { lines, error: null };
    },
    end() { const t = buf.toString('utf8').replace(/\r$/, ''); buf = Buffer.alloc(0); return t.trim() && !failed ? [t] : []; }
  };
}

// Validates one answer object against the permissions. Returns { ok, answer } or { ok:false, error }.
function validateAnswer(a, permissions) {
  const perms = new Set(permissions || []);
  if (!a || typeof a !== 'object' || Array.isArray(a)) return { ok: false, error: 'the answer is not a JSON object' };
  if (a.type !== 'answer') return { ok: false, error: 'the answer line has no "type": "answer"' };
  for (const k of Object.keys(a)) if (!['type', 'summary', 'report', 'checks'].includes(k)) return { ok: false, error: `the answer has an unknown field "${String(k).slice(0, 40)}"` };
  const out = { summary: '', report: null, checks: null };
  if (a.summary !== undefined) { if (typeof a.summary !== 'string' || a.summary.length > 200) return { ok: false, error: 'summary must be text of at most 200 characters' }; out.summary = a.summary; }
  if (a.report !== undefined) {
    if (!perms.has('answer:report')) return { ok: false, error: 'the answer contains a report, but the extension was not allowed answer:report' };
    if (typeof a.report !== 'string') return { ok: false, error: 'report must be text' };
    if (a.report.length > LIMITS.maxReportChars) return { ok: false, error: `the report is longer than ${LIMITS.maxReportChars} characters` };
    out.report = a.report;
  }
  if (a.checks !== undefined) {
    if (!perms.has('answer:checks')) return { ok: false, error: 'the answer contains checks, but the extension was not allowed answer:checks' };
    if (!Array.isArray(a.checks)) return { ok: false, error: 'checks must be a list' };
    if (a.checks.length > LIMITS.maxChecks) return { ok: false, error: `more than ${LIMITS.maxChecks} checks` };
    out.checks = [];
    for (const [i, c] of a.checks.entries()) {
      if (!c || typeof c !== 'object' || !['pass', 'warn', 'fail'].includes(c.status) || !isStr(c.title, 1, 120) || (c.detail !== undefined && (typeof c.detail !== 'string' || c.detail.length > 1000))) return { ok: false, error: `check ${i + 1} needs a status of pass, warn or fail, a title up to 120 characters and an optional detail up to 1000` };
      out.checks.push({ status: c.status, title: c.title, detail: c.detail || '' });
    }
  }
  if (!out.summary && out.report == null && out.checks == null) return { ok: false, error: 'the answer has no summary, report or checks' };
  return { ok: true, answer: out };
}

// ---------- Runtime resolution ----------
function findOnPath(names, env, platform) {
  const dirs = String(env.PATH || env.Path || '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
  const exts = platform === 'win32' ? ['.exe'] : [''];
  for (const n of names) for (const d of dirs) for (const e of exts) {
    const f = path.join(d, n + e);
    try { if (fs.statSync(f).isFile()) return f; } catch { /* keep looking */ }
  }
  return null;
}

// Returns { ok, command, args, env } or { ok:false, error }. Never uses a shell.
function resolveCommand(manifest, folder, opts = {}) {
  const platform = opts.platform || process.platform;
  const hostEnv = opts.env || process.env;
  const main = path.join(folder, ...manifest.main.split('/'));
  const rel = path.relative(folder, main);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return { ok: false, error: 'main points outside the extension folder' };
  try { const st = fs.lstatSync(main); if (!st.isFile()) return { ok: false, error: `${manifest.main} is not a file` }; } catch { return { ok: false, error: `${manifest.main} is missing from the extension folder` }; }
  const env = {};
  for (const k of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'windir', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'PATHEXT']) if (hostEnv[k]) env[k] = hostEnv[k];
  Object.assign(env, { MVL_EXTENSION_API: String(API_VERSION), MVL_EXTENSION_ID: manifest.id, MVL_EXTENSION_DIR: folder });
  if (manifest.runtime === 'node') return { ok: true, command: opts.execPath || process.execPath, args: [main], env: Object.assign(env, { ELECTRON_RUN_AS_NODE: '1' }) };
  if (manifest.runtime === 'powershell') {
    if (platform === 'win32') {
      const ps = path.join(hostEnv.SystemRoot || hostEnv.SYSTEMROOT || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      return { ok: true, command: ps, args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', main], env };
    }
    const pwsh = findOnPath(['pwsh'], hostEnv, platform);
    return pwsh ? { ok: true, command: pwsh, args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', main], env } : { ok: false, error: 'PowerShell (pwsh) is not installed on this computer' };
  }
  if (manifest.runtime === 'python') {
    const py = platform === 'win32' ? findOnPath(['py'], hostEnv, platform) : null;
    if (py) return { ok: true, command: py, args: ['-3', main], env };
    const p3 = findOnPath(['python3', 'python'], hostEnv, platform);
    return p3 ? { ok: true, command: p3, args: [main], env } : { ok: false, error: 'Python 3 is not installed or not on PATH' };
  }
  if (manifest.runtime === 'executable') {
    if (platform === 'win32' && !/\.exe$/i.test(main)) return { ok: false, error: 'on Windows an executable extension\'s main must be an .exe file' };
    return { ok: true, command: main, args: [], env };
  }
  return { ok: false, error: 'unknown runtime' };
}

// ---------- Running one action ----------
// Starts the program, sends the request, collects lines, enforces limits. Resolves (never rejects) with
// { ok, answer?, logs, error?, ms, exitCode, stderr }.
function runProcess({ command, args, env, cwd, request, timeoutMs, permissions, spawnImpl, platform }) {
  const t0 = Date.now();
  return new Promise((resolve) => {
    let child;
    try { child = (spawnImpl || spawn)(command, args, { cwd, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (e) { resolve({ ok: false, error: 'could not start: ' + e.message, logs: [], ms: 0, exitCode: null, stderr: '' }); return; }
    const parser = createLineParser();
    const logs = []; let answer = null, error = null, stderr = '', done = false;
    const finish = (extra) => {
      if (done) return; done = true; clearTimeout(timer);
      const r = Object.assign({ ok: !!answer && !error, answer: answer || undefined, logs, error: error || (answer ? null : 'the extension ended without an answer line'), ms: Date.now() - t0, stderr }, extra || {});
      if (r.error) r.ok = false;
      resolve(r);
    };
    const kill = () => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      if ((platform || process.platform) === 'win32' && child.pid) { try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* best effort */ } }
    };
    const timer = setTimeout(() => { if (!answer) { error = `did not answer within ${Math.round(timeoutMs / 1000)} seconds and was stopped`; kill(); finish({ exitCode: null }); } }, timeoutMs);
    const take = (line) => {
      if (answer || error) return;
      let obj;
      try { obj = JSON.parse(line); } catch { error = 'wrote a line that is not JSON: ' + line.slice(0, 80); kill(); return; }
      if (obj && obj.type === 'log') { if (logs.length < LIMITS.maxLogs) logs.push(String(obj.message == null ? '' : obj.message).slice(0, 500)); return; }
      const v = validateAnswer(obj, permissions);
      if (!v.ok) { error = 'gave an answer the manager refused: ' + v.error; kill(); return; }
      answer = v.answer;
    };
    child.stdout.on('data', (c) => { const r = parser.push(c); r.lines.forEach(take); if (r.error && !error) { error = r.error; kill(); } });
    child.stderr.on('data', (c) => { if (stderr.length < LIMITS.maxStderrBytes) stderr += c.toString('utf8').slice(0, LIMITS.maxStderrBytes - stderr.length); });
    child.on('error', (e) => { if (!error) error = 'could not start: ' + e.message; finish({ exitCode: null }); });
    child.on('close', (code) => { parser.end().forEach(take); if (!answer && !error && code !== 0) error = `exited with code ${code} without an answer`; finish({ exitCode: code }); });
    child.stdin.on('error', () => { /* the program may close its input early; its answer still counts */ });
    child.stdin.end(JSON.stringify(request) + '\n');
  });
}

// ---------- Folder helpers ----------
function hashDir(dir) {
  const h = crypto.createHash('sha256');
  const walk = (d, rel) => {
    for (const n of fs.readdirSync(d).sort()) {
      const f = path.join(d, n), r = rel ? rel + '/' + n : n; const st = fs.lstatSync(f);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) walk(f, r); else { h.update(r + '\0'); h.update(fs.readFileSync(f)); h.update('\0'); }
    }
  };
  walk(dir, '');
  return h.digest('hex');
}
function measureDir(dir) {
  let bytes = 0, files = 0, links = 0;
  const walk = (d) => { for (const n of fs.readdirSync(d)) { const f = path.join(d, n); const st = fs.lstatSync(f); if (st.isSymbolicLink()) { links++; continue; } if (st.isDirectory()) walk(f); else { bytes += st.size; files++; } } };
  walk(dir);
  return { bytes, files, links };
}
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const n of fs.readdirSync(src)) {
    const s = path.join(src, n), d = path.join(dst, n); const st = fs.lstatSync(s);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}
const inside = (root, p) => { const r = path.relative(root, p); return !!r && !r.startsWith('..') && !path.isAbsolute(r); };

// ---------- The store: folder, state and built-ins ----------
function createStore({ root, stateFile, builtinDir, execPath, platform, env }) {
  const readState = () => {
    try { const s = JSON.parse(fs.readFileSync(stateFile, 'utf8')); if (s && s.v === 1) return Object.assign({ masterOff: false, removedBuiltins: [], ext: {} }, s); } catch { /* first run */ }
    return { v: 1, masterOff: false, removedBuiltins: [], ext: {} };
  };
  let state = readState();
  const save = () => { try { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(state, null, 2)); } catch { /* state is best-effort; consent then asks again */ } };
  const rec = (id) => (state.ext[id] = state.ext[id] || { enabled: false, allowed: null, builtIn: false, builtInHash: '', runs: [] });

  // Copies built-ins in when absent, and updates them only while the person has not modified them.
  function syncBuiltins() {
    let names = [];
    try { names = fs.readdirSync(builtinDir); } catch { return; }
    fs.mkdirSync(root, { recursive: true });
    for (const n of names) {
      const src = path.join(builtinDir, n);
      let v; try { v = parseManifestText(fs.readFileSync(path.join(src, MANIFEST), 'utf8')); } catch { continue; }
      if (!v.ok || state.removedBuiltins.includes(v.manifest.id)) continue;
      const dst = path.join(root, v.manifest.id), r = rec(v.manifest.id);
      if (!fs.existsSync(dst)) { copyDir(src, dst); r.builtIn = true; r.builtInHash = hashDir(dst); continue; }
      if (!r.builtIn) continue;
      let cur; try { cur = parseManifestText(fs.readFileSync(path.join(dst, MANIFEST), 'utf8')); } catch { cur = { ok: false }; }
      const unmodified = r.builtInHash && hashDir(dst) === r.builtInHash;
      if (unmodified && (!cur.ok || cur.manifest.version !== v.manifest.version)) { fs.rmSync(dst, { recursive: true, force: true }); copyDir(src, dst); r.builtInHash = hashDir(dst); }
    }
    save();
  }

  function scan() {
    const out = []; const ids = new Set();
    let names = [];
    try { names = fs.readdirSync(root).sort(); } catch { return out; }
    for (const n of names) {
      const dir = path.join(root, n);
      try { if (!fs.lstatSync(dir).isDirectory()) continue; } catch { continue; }
      let v;
      try { v = parseManifestText(fs.readFileSync(path.join(dir, MANIFEST), 'utf8')); } catch { v = { ok: false, errors: [`There is no ${MANIFEST} in this folder.`] }; }
      if (v.ok && ids.has(v.manifest.id)) v = { ok: false, errors: [`Another folder already uses the id "${v.manifest.id}".`] };
      if (v.ok && v.manifest.id !== n) v = { ok: false, errors: [`The folder is named "${n}" but the manifest id is "${v.manifest.id}". Rename one so they match.`] };
      if (!v.ok) { out.push({ folder: n, dir, ok: false, errors: v.errors, state: 'error' }); continue; }
      ids.add(v.manifest.id);
      const r = state.ext[v.manifest.id] || { enabled: false, allowed: null, builtIn: false, runs: [] };
      const diff = permissionDiff(r.allowed, v.manifest);
      const st = state.masterOff ? 'master-off' : diff.status !== 'same' ? 'needs-consent' : r.enabled ? 'on' : 'off';
      let modified = false;
      if (r.builtIn && r.builtInHash) { try { modified = hashDir(dir) !== r.builtInHash; } catch { modified = true; } }
      out.push({ folder: n, dir, ok: true, manifest: v.manifest, state: st, enabled: !!r.enabled, diff, builtIn: !!r.builtIn, modified, runs: (r.runs || []).slice(-LIMITS.maxRunsKept).reverse() });
    }
    return out;
  }

  const find = (id) => scan().find((e) => e.ok && e.manifest.id === id);

  function setEnabled(id, on) {
    const e = find(id); if (!e) return { ok: false, error: 'no such extension' };
    if (on && e.diff.status !== 'same') return { ok: false, needsConsent: true, diff: e.diff };
    rec(id).enabled = !!on; save(); return { ok: true };
  }
  // The page must echo exactly the version and permissions it showed; anything else is refused.
  function allow(id, version, permissions) {
    const e = find(id); if (!e) return { ok: false, error: 'no such extension' };
    const want = Array.isArray(permissions) ? [...permissions].map(String).sort() : null;
    if (version !== e.manifest.version || !want || want.join('\n') !== e.manifest.permissions.join('\n')) return { ok: false, error: 'the extension changed while you were deciding; review it again' };
    const r = rec(id); r.allowed = { version, permissions: want, at: new Date().toISOString() }; r.enabled = true; save();
    return { ok: true };
  }
  function setMaster(off) { state.masterOff = !!off; save(); return { ok: true, masterOff: state.masterOff }; }

  async function run(id, actionId, context, runOpts = {}) {
    if (state.masterOff) return { ok: false, error: 'Extensions are switched off with the master switch.' };
    const e = find(id); if (!e) return { ok: false, error: 'That extension is not installed or its manifest has an error.' };
    if (e.diff.status !== 'same') return { ok: false, needsConsent: true, diff: e.diff, error: `${e.manifest.name} needs your permission first.` };
    if (!e.enabled) return { ok: false, error: `${e.manifest.name} is switched off.` };
    const action = e.manifest.actions.find((a) => a.id === actionId); if (!action) return { ok: false, error: 'That action is not in the manifest.' };
    const allowedPerms = state.ext[id].allowed.permissions;
    const inp = buildInput(action.hook, allowedPerms, context);
    if (!inp.ok) return { ok: false, error: `${e.manifest.name}: ${inp.error}.` };
    const cmd = resolveCommand(e.manifest, e.dir, { execPath, platform, env });
    let res;
    if (!cmd.ok) res = { ok: false, error: cmd.error, logs: [], ms: 0, stderr: '' };
    else res = await runProcess({ command: cmd.command, args: cmd.args, env: cmd.env, cwd: e.dir, request: makeRequest(e.manifest, action.id, action.hook, inp.input), timeoutMs: Math.min(runOpts.timeoutMs || e.manifest.timeoutMs, LIMITS.maxTimeoutMs), permissions: allowedPerms, spawnImpl: runOpts.spawnImpl, platform });
    const r = rec(id);
    r.runs = (r.runs || []).concat([{ at: new Date().toISOString(), action: action.id, ok: res.ok, ms: res.ms, message: res.ok ? (res.answer.summary || 'Answered') : String(res.error).slice(0, 300) }]).slice(-LIMITS.maxRunsKept);
    save();
    return Object.assign({ extension: { id, name: e.manifest.name, version: e.manifest.version }, action: { id: action.id, title: action.title } }, res, res.ok ? {} : { error: `${e.manifest.name} ${res.error}` });
  }

  // Validates a folder for adding. Returns a description, or what stands in the way.
  function inspectFolder(src) {
    let v; try { v = parseManifestText(fs.readFileSync(path.join(src, MANIFEST), 'utf8')); } catch { return { ok: false, errors: [`That folder has no ${MANIFEST}.`] }; }
    if (!v.ok) return v;
    let m; try { m = measureDir(src); } catch (e) { return { ok: false, errors: ['The folder could not be read: ' + e.message] }; }
    if (m.bytes > LIMITS.maxFolderBytes || m.files > LIMITS.maxFolderFiles) return { ok: false, errors: [`The folder is larger than ${LIMITS.maxFolderBytes / 1048576} MB or ${LIMITS.maxFolderFiles} files.`] };
    if (path.resolve(src) === path.resolve(path.join(root, v.manifest.id))) return { ok: false, errors: ['That folder is already the installed copy.'] };
    const existing = find(v.manifest.id);
    return { ok: true, manifest: v.manifest, existing: existing ? { version: existing.manifest.version, builtIn: existing.builtIn } : null, skippedLinks: m.links };
  }
  function install(src, manifest) {
    const dst = path.join(root, manifest.id);
    if (!inside(root, dst)) return { ok: false, error: 'invalid id' };
    const tmp = dst + '.incoming-' + process.pid;
    fs.rmSync(tmp, { recursive: true, force: true });
    copyDir(src, tmp);
    fs.rmSync(dst, { recursive: true, force: true });
    fs.renameSync(tmp, dst);
    const r = rec(manifest.id); r.builtIn = false; r.builtInHash = ''; r.enabled = false; save();
    return { ok: true };
  }
  function remove(id) {
    const e = find(id); const dir = e ? e.dir : path.join(root, String(id));
    if (!ID_RE.test(String(id)) || !inside(root, dir)) return { ok: false, error: 'invalid id' };
    if (!fs.existsSync(dir)) return { ok: false, error: 'no such extension folder' };
    fs.rmSync(dir, { recursive: true, force: true });
    if (state.ext[id] && state.ext[id].builtIn && !state.removedBuiltins.includes(id)) state.removedBuiltins.push(id);
    delete state.ext[id]; save();
    return { ok: true };
  }
  function restoreBuiltins() { state.removedBuiltins = []; save(); syncBuiltins(); return { ok: true }; }
  function reload() { state = readState(); syncBuiltins(); return scan(); }
  const summary = () => ({ root, masterOff: !!state.masterOff, removedBuiltins: [...state.removedBuiltins] });
  return { syncBuiltins, scan, find, setEnabled, allow, setMaster, run, inspectFolder, install, remove, restoreBuiltins, reload, summary };
}

// ---------- IPC ----------
function register(ipcMain, app) {
  const { dialog, shell, BrowserWindow } = require('electron');
  const root = path.join(app.getPath('userData'), 'extensions');
  const store = createStore({ root, stateFile: path.join(app.getPath('userData'), 'extensions-state.json'), builtinDir: path.join(__dirname, 'extensions-builtin') });
  try { store.syncBuiltins(); } catch { /* the manager shows the folder state as it is */ }
  const pending = new Map(); // token -> folder chosen through the dialog; the page never names a path
  const idOk = (v) => typeof v === 'string' && ID_RE.test(v);
  const view = () => {
    const list = store.scan().map((e) => (e.ok ? { folder: e.folder, ok: true, manifest: e.manifest, state: e.state, enabled: e.enabled, diff: e.diff, builtIn: e.builtIn, modified: e.modified, runs: e.runs } : { folder: e.folder, ok: false, errors: e.errors, state: 'error' }));
    return Object.assign(store.summary(), { limits: LIMITS, hooks: HOOKS, permissions: PERMISSIONS, runtimes: RUNTIMES, apiVersion: API_VERSION, protocol: PROTOCOL, extensions: list });
  };
  const handle = (ch, fn) => { ipcMain.removeHandler(ch); ipcMain.handle(ch, fn); };
  handle('ext:list', () => view());
  handle('ext:reload', () => { store.reload(); return view(); });
  handle('ext:set-enabled', (_e, id, on) => (idOk(id) && typeof on === 'boolean' ? store.setEnabled(id, on) : { ok: false, error: 'invalid request' }));
  handle('ext:allow', (_e, id, version, perms) => (idOk(id) && typeof version === 'string' && Array.isArray(perms) && perms.length <= 20 ? store.allow(id, version, perms) : { ok: false, error: 'invalid request' }));
  handle('ext:master', (_e, off) => (typeof off === 'boolean' ? store.setMaster(off) : { ok: false, error: 'invalid request' }));
  handle('ext:run', (_e, id, actionId, context) => {
    if (!idOk(id) || typeof actionId !== 'string' || !ACTION_RE.test(actionId)) return { ok: false, error: 'invalid request' };
    let ctx = {}; try { ctx = JSON.parse(JSON.stringify(context && typeof context === 'object' ? context : {}).slice(0, 200000)); } catch { return { ok: false, error: 'the context is too large' }; }
    return store.run(id, actionId, ctx);
  });
  // Cheap and local: which allowed, switched-on actions hook this point. Starts no program.
  handle('ext:actions-for', (_e, hook) => {
    if (!HOOKS[hook]) return [];
    const s = store.summary(); if (s.masterOff) return [];
    return store.scan().filter((e) => e.ok && e.state === 'on').flatMap((e) => e.manifest.actions.filter((a) => a.hook === hook).map((a) => ({ id: e.manifest.id, name: e.manifest.name, action: a.id, title: a.title })));
  });
  handle('ext:open-folder', async (_e, id) => {
    const dir = id == null ? root : (idOk(id) ? path.join(root, id) : null);
    if (!dir) return { ok: false, error: 'invalid request' };
    try { fs.mkdirSync(root, { recursive: true }); } catch { /* reported below */ }
    if (!fs.existsSync(dir)) return { ok: false, error: 'that folder does not exist' };
    const err = await shell.openPath(dir); return err ? { ok: false, error: err } : { ok: true, path: dir };
  });
  handle('ext:pick-folder', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const r = await dialog.showOpenDialog(win, { title: 'Choose an extension folder', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, cancelled: true };
    const info = store.inspectFolder(r.filePaths[0]);
    if (!info.ok) return { ok: false, errors: info.errors, folder: path.basename(r.filePaths[0]) };
    const token = crypto.randomBytes(12).toString('hex'); pending.clear(); pending.set(token, { src: r.filePaths[0], manifest: info.manifest });
    return { ok: true, token, manifest: info.manifest, existing: info.existing, skippedLinks: info.skippedLinks, folder: path.basename(r.filePaths[0]) };
  });
  // Installs what pick-folder validated. Replacing a different version needs replace === true.
  handle('ext:install', (_e, token, replace) => {
    const p = typeof token === 'string' && pending.get(token); if (!p) return { ok: false, error: 'choose the folder again' };
    const info = store.inspectFolder(p.src);
    if (!info.ok) return { ok: false, error: info.errors.join(' ') };
    if (info.manifest.version !== p.manifest.version || info.manifest.id !== p.manifest.id) return { ok: false, error: 'the folder changed after you chose it; choose it again' };
    if (info.existing && replace !== true) return { ok: false, needsReplace: true, existing: info.existing };
    pending.delete(token);
    try { return store.install(p.src, info.manifest); } catch (e) { return { ok: false, error: 'could not copy the folder: ' + e.message }; }
  });
  handle('ext:remove', (_e, id) => (idOk(id) ? store.remove(id) : { ok: false, error: 'invalid request' }));
  handle('ext:restore-builtins', () => store.restoreBuiltins());
  return store;
}

module.exports = { register, createStore, validateManifest, parseManifestText, permissionDiff, buildInput, scrubSensitive, makeRequest, createLineParser, validateAnswer, resolveCommand, runProcess, hashDir, API_VERSION, PROTOCOL, LIMITS, HOOKS, PERMISSIONS, RUNTIMES };
