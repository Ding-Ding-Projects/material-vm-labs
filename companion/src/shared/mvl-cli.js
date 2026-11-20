'use strict';
// Drives the real CLI: powershell.exe -File <repo>\src\mvl.ps1 <fixed argument array> --json.
// Arguments are always an array, never a shell string. Passwords and tokens travel only on the child's standard input,
// are never logged, and the buffer that held them is zeroed right after use.
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const REPO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9._-]{1,100}$/;
const REF = /^[A-Za-z0-9._\/-]{1,100}$/;
const USER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/;
const LABELS = /^[A-Za-z0-9._,-]{0,200}$/;
const ENTRY = /^(build|build-installer)(,(build|build-installer))?$/;
const JOB = /^[a-z0-9-]{1,48}$/;

const fail = (m) => { throw new Error(m); };
const need = (re, v, what) => { if (typeof v !== 'string' || !re.test(v)) fail(`invalid ${what}`); return v; };
const int = (v, lo, hi, what) => { const n = Number(v); if (!Number.isInteger(n) || n < lo || n > hi) fail(`invalid ${what}`); return String(n); };

// Builds the fixed argument array for one operation, or throws on anything outside the allow-list.
function buildArgs(op, p) {
  p = p || {};
  switch (op) {
    case 'hv': return p.hv ? ['hv', '--hv', need(/^(auto|vmware|virtualbox)$/, p.hv, 'hypervisor')] : ['hv'];
    case 'media': return ['media'];
    case 'server-media': {
      const iso = need(/^[A-Za-z]:\\[^\x00-\x1f"<>|?*]+\.iso$/i, p.iso, 'local Server ISO path');
      return ['server-media', '--iso', iso];
    }
    case 'ls': return ['ls'];
    case 'share': return ['share', need(NAME, p.name, 'name'), '--no-open'];
    case 'ip': return ['ip', need(NAME, p.name, 'name')];
    case 'start': case 'reset': return [op, need(NAME, p.name, 'name')];
    case 'stop': return p.hard ? ['stop', need(NAME, p.name, 'name'), '--hard'] : ['stop', need(NAME, p.name, 'name')];
    case 'rm': return ['rm', need(NAME, p.name, 'name'), '--yes'];
    case 'ssh': return ['ssh', need(NAME, p.name, 'name')];
    case 'rdp': return p.noLaunch ? ['rdp', need(NAME, p.name, 'name'), '--no-launch'] : ['rdp', need(NAME, p.name, 'name')];
    case 'net': return ['net', need(NAME, p.name, 'name'), need(/^(nat|bridged|hostonly)$/, p.mode, 'network mode')];
    case 'new': {
      const a = ['new', need(NAME, p.name, 'name')];
      if (p.project) a.push('--project', need(/^[A-Za-z0-9._-]{1,60}$/, p.project, 'project'));
      if (p.hv) a.push('--hv', need(/^(auto|vmware|virtualbox)$/, p.hv, 'hypervisor'));
      if (p.mem) a.push('--mem', int(p.mem, 2048, 65536, 'memory'));
      if (p.cpus) a.push('--cpus', int(p.cpus, 1, 32, 'cpu count'));
      if (p.disk) a.push('--disk', int(p.disk, 40, 1024, 'disk size'));
      if (p.net) a.push('--net', need(/^(nat|bridged|hostonly)$/, p.net, 'network mode'));
      if (p.user) a.push('--user', need(USER, p.user, 'user name'));
      if (p.for !== undefined && p.for !== null && p.for !== '') a.push('--for', need(/^(you|agent)$/, p.for, 'owner'));
      if (p.os) a.push('--os', need(/^(windows|ubuntu|debian)$/, p.os, 'system'));
      if (typeof p.tools === 'boolean') a.push(p.tools ? '--tools' : '--no-tools');
      if (typeof p.share === 'boolean') a.push(p.share ? '--share' : '--no-share');
      if (p.requireTpm) a.push('--require-tpm');
      if (p.randomPassword) a.push('--random-password');
      else if (p.secret) a.push('--password-stdin');
      return a;
    }
    case 'build': {
      const a = ['build', need(NAME, p.name, 'name'), '--repo', need(REPO, p.repo, 'repository (owner/name)')];
      if (p.ref) a.push('--ref', need(REF, p.ref, 'ref'));
      a.push('--entry', need(ENTRY, p.entry || 'build', 'entry list'));
      if (p.noReset) a.push('--no-reset');
      return a;
    }
    case 'runner-add': {
      if (!p.secret) fail('the registration token is required');
      const a = ['runner', 'add', need(NAME, p.name, 'name'), '--repo', need(REPO, p.repo, 'repository (owner/name)')];
      if (p.labels) a.push('--labels', need(LABELS, p.labels, 'labels'));
      return a;
    }
    case 'passwd': {
      if (!p.secret) fail('the new guest password is required');
      return ['passwd', need(NAME, p.name, 'name')];
    }
    case 'runner-rm': return ['runner', 'rm', need(NAME, p.name, 'name'), '--repo', need(REPO, p.repo, 'repository (owner/name)')];
    case 'shot': return ['shot', need(NAME, p.name, 'name'), need(/^.{3,400}\.png$/, p.file, 'file')];
    default: return fail(`unknown operation ${op}`);
  }
}

function lastJson(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (t.startsWith('{') || t.startsWith('[')) { try { return JSON.parse(t); } catch { /* keep looking */ } }
  }
  return undefined;
}

// ---- job markers: <stateRoot>/jobs/<pid>.json lets a restarted manager see what was running when it closed ----
const markerDir = (root) => path.join(root, 'jobs');
const LONG_OPS = new Set(['new', 'start', 'stop', 'reset', 'rm', 'build', 'install', 'passwd', 'net', 'media', 'runner-add', 'runner-rm']);
function writeMarker(root, m) {
  if (!root || !Number.isInteger(m.pid)) return;
  try {
    fs.mkdirSync(markerDir(root), { recursive: true });
    fs.writeFileSync(path.join(markerDir(root), `${m.pid}.json`), JSON.stringify(m));
  } catch { /* markers are best-effort and never block a job */ }
}
function removeMarker(root, pid) {
  if (!root || !Number.isInteger(Number(pid))) return false;
  try { fs.rmSync(path.join(markerDir(root), `${Number(pid)}.json`), { force: true }); return true; } catch { return false; }
}
// Best effort: the pid exists and its image is a shell host (powershell or cmd), so a recycled pid is not mistaken for the job.
function pidIsJob(pid) {
  try { process.kill(pid, 0); } catch (e) { if (e.code !== 'EPERM') return false; }
  try {
    const r = spawnSync('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true, encoding: 'utf8', timeout: 5000 });
    return /"(powershell|pwsh|cmd)\.exe"/i.test(String(r.stdout || ''));
  } catch { return true; }
}
function scanMarkers(root, skipPids) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(markerDir(root)); } catch { return out; }
  for (const n of names) {
    if (!/^\d+\.json$/.test(n)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(markerDir(root), n), 'utf8').replace(/^﻿/, ''));
      const pid = Number(j.pid);
      if (!Number.isInteger(pid) || (skipPids && skipPids.has(pid))) continue;
      out.push({ pid, op: String(j.op || ''), name: String(j.name || ''), label: String(j.label || j.op || 'operation').slice(0, 160), startedUtc: String(j.startedUtc || ''), alive: pidIsJob(pid) });
    } catch { /* an unreadable marker is skipped, never invented */ }
  }
  out.sort((a, b) => String(a.startedUtc).localeCompare(String(b.startedUtc)));
  return out;
}


// ---- GitHub CLI helper: gh is always spawned with an argument array, never a shell string ----
const GH_SIGNIN = 'Sign in to GitHub with gh auth login first.';
function runGh(args, opts) {
  opts = opts || {};
  const timeout = opts.timeout || 20000;
  return new Promise((resolve) => {
    if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) return resolve({ ok: false, out: '', error: 'invalid gh arguments' });
    const env = { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1', GH_NO_UPDATE_NOTIFIER: '1' };
    let child;
    try { child = spawn('gh', args, { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { return resolve({ ok: false, out: '', error: 'The GitHub CLI (gh) could not be started: ' + e.message }); }
    let out = ''; let err = ''; let done = false; let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { child.kill(); } catch { /* already gone */ } }, timeout);
    const end = (r) => { if (done) return; done = true; clearTimeout(timer); resolve(r); };
    child.stdout.on('data', (d) => { if (out.length < 2000000) out += d.toString('utf8'); });
    child.stderr.on('data', (d) => { if (err.length < 20000) err += d.toString('utf8'); });
    child.on('error', (e) => end({ ok: false, out: '', error: e.code === 'ENOENT' ? 'The GitHub CLI (gh) is not installed. Install it, then sign in with gh auth login.' : 'The GitHub CLI (gh) failed to start: ' + e.message }));
    child.on('close', (code) => {
      if (timedOut) return end({ ok: false, out, code, error: 'The GitHub CLI did not answer in time.' });
      if (code === 0) return end({ ok: true, out, code });
      const msg = err.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' ');
      const signin = /gh auth login|not logged in|authentication|HTTP 401|bad credentials|GH_TOKEN/i.test(msg);
      end({ ok: false, out, code, error: signin ? GH_SIGNIN : (msg || `gh exited with code ${code}`) });
    });
  });
}

function createRunner({ getRepoDir, getStateRoot, getResolvedRoot }) {
  const jobs = new Map(); // id -> { pid, cancelled }
  const activeJobs = new Set();
  const markerRoot = () => { try { return (getResolvedRoot && getResolvedRoot()) || getStateRoot() || ''; } catch { return ''; } };

  function run(op, params, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      let args;
      try { args = buildArgs(op, params); } catch (e) { return resolve({ ok: false, error: e.message }); }
      const repo = getRepoDir();
      if (!repo) return resolve({ ok: false, error: 'no lab machine source is available to run the CLI' });
      const script = path.join(repo, 'src', 'mvl.ps1');
      if (!fs.existsSync(script)) return resolve({ ok: false, error: `the CLI is missing: ${script}` });
      const id = opts.id && JOB.test(opts.id) ? opts.id : null;
      if (id && jobs.has(id)) return resolve({ ok: false, error: 'an operation with this id is already running' });
      const env = { ...process.env };
      delete env.PSModulePath; // the child must use its own module path, never the Electron parent's
      const stateRoot = getStateRoot();
      if (stateRoot) env.MVL_HOME = stateRoot;
      const sysRoot = process.env.SystemRoot || 'C:\\Windows';
      const ps = path.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const child = spawn(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args, '--json'], { cwd: repo, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      const job = { pid: child.pid, cancelled: false };
      activeJobs.add(job);
      if (id) jobs.set(id, job);
      // The marker never holds standard input, a password or a token: only the operation, its fixed arguments and a label.
      const mRoot = markerRoot();
      // Only long, state-changing actions get a marker: quick reads such as the ls refresh would
      // otherwise show up as 'stopped while the manager was closed' (seen 2026-11-19).
      if (child.pid && LONG_OPS.has(op)) writeMarker(mRoot, { pid: child.pid, op, args, name: params && typeof params.name === 'string' ? params.name : '', startedUtc: new Date().toISOString(), label: String(opts.label || op).slice(0, 160) });
      const finish = () => {
        if (child.pid) removeMarker(mRoot, child.pid);
        activeJobs.delete(job);
        if (id && jobs.get(id) === job) jobs.delete(id);
      };
      const lines = []; const errLines = [];
      const feed = (stream, kind, sink) => {
        let buf = '';
        stream.on('data', (d) => {
          buf += d.toString('utf8');
          const parts = buf.split(/\r?\n|\r/);
          buf = parts.pop();
          for (const l of parts) { const t = l.replace(/\x1b\[[0-9;]*[A-Za-z]/g, ''); sink.push(t); if (opts.onLine) opts.onLine({ stream: kind, text: t }); }
        });
        stream.on('end', () => { if (buf) { sink.push(buf); if (opts.onLine) opts.onLine({ stream: kind, text: buf }); } });
      };
      feed(child.stdout, 'out', lines); feed(child.stderr, 'err', errLines);
      // Secrets go on standard input only; the buffer is zeroed as soon as it has been written.
      const secret = typeof (params && params.secret) === 'string' && params.secret && (op === 'runner-add' || (op === 'new' && !params.randomPassword)) ? params.secret : '';
      if (secret) {
        const buf = Buffer.from(secret + '\n', 'utf8');
        child.stdin.on('error', () => {});
        child.stdin.end(buf, () => buf.fill(0));
      } else { child.stdin.end(); }
      child.on('error', (e) => { finish(); resolve({ ok: false, error: `could not start powershell.exe: ${e.message}` }); });
      child.on('close', (code) => {
        finish();
        const json = lastJson(lines);
        if (job.cancelled) return resolve({ ok: false, cancelled: true, code, error: 'Cancelled. The operation is incomplete; nothing was finished.' });
        if (json && json.ok === false) return resolve({ ok: false, code, error: String(json.error || 'the CLI reported a problem') });
        if (code !== 0) {
          const tail = [...errLines, ...lines].filter(Boolean).slice(-3).join(' | ');
          return resolve({ ok: false, code, data: json, error: `the CLI exited with code ${code}${tail ? ': ' + tail : ''}` });
        }
        resolve({ ok: true, code, data: json, lines: lines.length });
      });
    });
  }

  function cancel(id) {
    const job = jobs.get(id);
    if (!job || !job.pid) return false;
    job.cancelled = true;
    spawnSync('taskkill.exe', ['/pid', String(job.pid), '/T', '/F'], { windowsHide: true });
    return true;
  }
  function cancelAll() {
    for (const job of activeJobs) {
      if (!job.pid) continue;
      job.cancelled = true;
      spawnSync('taskkill.exe', ['/pid', String(job.pid), '/T', '/F'], { windowsHide: true });
    }
  }
  const livePids = () => new Set([...activeJobs].map((j) => j.pid).filter(Boolean));
  return {
    run, cancel, cancelAll, active: () => activeJobs.size,
    scanRecovered: () => scanMarkers(markerRoot(), livePids()),
    dismissRecovered: (pid) => removeMarker(markerRoot(), pid)
  };
}

module.exports = { buildArgs, createRunner, lastJson, runGh, GH_SIGNIN, NAME, REPO, LABELS };
