'use strict';
// Updates for the installed manager, in the main process only.
//
// 1. Update check: reads the public GitHub release feed, validates the unsigned Squirrel.Windows
//    RELEASES metadata against the SHA-256 table in the release notes, downloads the full package
//    in the background with a size limit, verifies SHA-1, SHA-256, size and the package header,
//    and stages it. Nothing is installed until the person chooses "Restart to install update".
// 2. Update coming soon: reads the public Actions record of the release workflow and reports an
//    in-flight build with its real stages. It never downloads, installs or restarts anything.
//
// The pure helpers at the top have no Electron dependency so tests can load this file directly.
// Nothing here is signed or claims a signature: integrity comes from HTTPS, the published hashes
// and Squirrel's own SHA-1 check.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO = 'Ding-Ding-Projects/material-vm-labs';
const API = 'https://api.github.com';
const WORKFLOW = 'release.yml';
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;      // bounded background schedule: every 4 hours
const FIRST_CHECK_MS = 20 * 1000;               // shortly after startup, never during window creation
const COMING_ACTIVE_MS = 3 * 60 * 1000;         // while a build is in flight
const COMING_IDLE_MS = 30 * 60 * 1000;          // otherwise
const MAX_PACKAGE_BYTES = 600 * 1024 * 1024;
const MAX_METADATA_BYTES = 64 * 1024;

// ---------- versions ----------
// Accepts 1.2.3, v1.2.3, 1.2.3-build42 and v1.2.3-build.42. Returns null for anything else.
function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(v || '').trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split(/[.-]/).filter(Boolean) : [] };
}
function cmpIdent(a, b) {
  // A prerelease identifier such as build42 compares by its letters, then by its number.
  const ma = /^([A-Za-z]*)(\d*)$/.exec(a), mb = /^([A-Za-z]*)(\d*)$/.exec(b);
  if (ma && mb && ma[1] === mb[1] && ma[2] && mb[2]) return Math.sign(+ma[2] - +mb[2]);
  const na = /^\d+$/.test(a), nb = /^\d+$/.test(b);
  if (na && nb) return Math.sign(+a - +b);
  if (na !== nb) return na ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}
// -1, 0 or 1; throws on an unparseable version so a bad feed is never read as "older".
function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) throw new Error(`not a version: ${!x ? a : b}`);
  for (const k of ['major', 'minor', 'patch']) if (x[k] !== y[k]) return Math.sign(x[k] - y[k]);
  // In this project a build tag (0.1.0-build.42) comes AFTER the bare version it builds on,
  // so a bare version sorts before any build of it.
  if (!x.pre.length || !y.pre.length) return Math.sign(x.pre.length - y.pre.length);
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    if (x.pre[i] === undefined) return -1;
    if (y.pre[i] === undefined) return 1;
    const c = cmpIdent(x.pre[i], y.pre[i]);
    if (c) return c;
  }
  return 0;
}

// ---------- feed metadata ----------
// Squirrel.Windows RELEASES: one "SHA1 filename size" entry per line. Strict: any malformed line
// fails the whole file, because a half-understood feed is not a feed to install from.
function parseReleases(text) {
  const s = String(text || '').replace(/^﻿/, '');
  if (!s.trim()) throw new Error('RELEASES is empty');
  const out = [];
  for (const raw of s.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([0-9A-Fa-f]{40})\s+([A-Za-z0-9._-]+\.nupkg)\s+(\d{1,12})$/.exec(line);
    if (!m) throw new Error(`RELEASES has a malformed line: ${line.slice(0, 80)}`);
    const name = m[2];
    const v = /^(.+?)-(\d+\.\d+\.\d+(?:-[0-9A-Za-z]+)?)-(full|delta)\.nupkg$/.exec(name);
    if (!v) throw new Error(`RELEASES names a package without a version: ${name}`);
    out.push({ sha1: m[1].toLowerCase(), file: name, size: Number(m[3]), id: v[1], version: v[2], kind: v[3] });
  }
  if (!out.length) throw new Error('RELEASES lists no package');
  return out;
}
// The newest full package in a RELEASES list.
function newestFull(entries) {
  const full = entries.filter((e) => e.kind === 'full');
  if (!full.length) throw new Error('RELEASES lists no full package');
  return full.reduce((a, b) => (compareVersions(b.version, a.version) > 0 ? b : a));
}
// The release notes carry a "| File | SHA-256 |" table written by the release workflow.
function parseNotesHashes(body) {
  const map = {};
  for (const m of String(body || '').matchAll(/^\|\s*([A-Za-z0-9._-]+)\s*\|\s*([0-9a-fA-F]{64})\s*\|\s*$/gm)) map[m[1]] = m[2].toLowerCase();
  return map;
}
function notesCommit(body) {
  const m = /commit `([0-9a-f]{40})`/.exec(String(body || ''));
  return m ? m[1] : null;
}
function buildNumber(tag) {
  const m = /-build\.?(\d+)$/.exec(String(tag || ''));
  return m ? Number(m[1]) : null;
}

// Verifies downloaded bytes against what the feed and the notes promised.
// Returns { ok: true } or { ok: false, kind: 'corrupt' | 'invalid', reason }.
function verifyPackage(buf, expect) {
  if (!Buffer.isBuffer(buf)) return { ok: false, kind: 'corrupt', reason: 'No package data was read.' };
  if (buf.length !== expect.size) return { ok: false, kind: 'corrupt', reason: `The package is ${buf.length} bytes; the feed says ${expect.size}.` };
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b || buf[2] !== 0x03 || buf[3] !== 0x04) return { ok: false, kind: 'corrupt', reason: 'The package is not a readable package archive.' };
  const sha1 = crypto.createHash('sha1').update(buf).digest('hex');
  if (sha1 !== expect.sha1) return { ok: false, kind: 'invalid', reason: `SHA-1 ${sha1} does not match the feed (${expect.sha1}).` };
  if (expect.sha256) {
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    if (sha256 !== expect.sha256) return { ok: false, kind: 'invalid', reason: `SHA-256 ${sha256} does not match the release notes (${expect.sha256}).` };
  }
  return { ok: true };
}

// Turns a GitHub release object plus its RELEASES text into the offer, or throws a reason.
function readOffer(release, releasesText) {
  if (!release || typeof release !== 'object' || typeof release.tag_name !== 'string') throw new Error('The release feed did not return a release.');
  if (release.draft || release.prerelease) throw new Error('The latest release is a draft or a prerelease.');
  const entries = parseReleases(releasesText);
  const pkg = newestFull(entries);
  const hashes = parseNotesHashes(release.body);
  const asset = (release.assets || []).find((a) => a && a.name === pkg.file);
  if (!asset) throw new Error(`RELEASES names ${pkg.file}, which is not attached to the release.`);
  if (Number(asset.size) !== pkg.size) throw new Error(`${pkg.file} is ${asset.size} bytes on the release; RELEASES says ${pkg.size}.`);
  if (!hashes[pkg.file]) throw new Error(`The release notes give no SHA-256 for ${pkg.file}.`);
  if (pkg.size > MAX_PACKAGE_BYTES) throw new Error(`${pkg.file} is larger than the ${MAX_PACKAGE_BYTES / 1048576} MB limit.`);
  return {
    tag: release.tag_name, build: buildNumber(release.tag_name), commit: notesCommit(release.body),
    version: pkg.version, packageId: pkg.id, file: pkg.file, size: pkg.size, sha1: pkg.sha1, sha256: hashes[pkg.file],
    url: asset.browser_download_url, notesUrl: release.html_url, publishedAt: release.published_at || null
  };
}

// ---------- state machine ----------
// Every state the update surface can show. The reducer is the only way the state changes, so a
// state can never be reached without the event that justifies it.
const STATES = ['idle', 'checking', 'none', 'available', 'downloading', 'ready', 'restarting', 'offline', 'invalid', 'corrupt', 'cancelled', 'rolledback', 'unsupported', 'blocked', 'error'];
const ALLOWED = {
  CHECK: ['idle', 'none', 'available', 'offline', 'invalid', 'corrupt', 'cancelled', 'rolledback', 'unsupported', 'blocked', 'error'],
  NO_UPDATE: ['checking'],
  FOUND: ['checking'],
  UNSUPPORTED: ['checking'],
  BLOCKED: ['checking'],
  OFFLINE: ['checking', 'downloading'],
  INVALID: ['checking', 'downloading', 'ready'],
  ERROR: ['checking', 'downloading'],
  DOWNLOAD: ['available', 'cancelled', 'invalid', 'corrupt', 'offline'],
  PROGRESS: ['downloading'],
  CORRUPT: ['downloading', 'ready'],
  VERIFIED: ['downloading'],
  CANCEL: ['downloading', 'checking'],
  RESTART: ['ready'],
  UNSAVED: ['ready', 'restarting'],
  APPLY_FAILED: ['restarting'],
  RESTORE_READY: ['idle', 'checking'],
  LATER: ['ready']
};
function reduce(state, event) {
  const s = state || { status: 'idle' };
  const ok = ALLOWED[event.type];
  if (!ok) throw new Error(`unknown update event ${event.type}`);
  if (!ok.includes(s.status)) return { ...s, ignored: event.type };
  const base = { ...s, ignored: undefined, reason: undefined };
  switch (event.type) {
    case 'CHECK': return { ...base, status: 'checking', manual: !!event.manual };
    case 'NO_UPDATE': return { ...base, status: 'none', offer: null, note: event.note || null, checkedAt: event.at };
    case 'FOUND': return { ...base, status: 'available', offer: event.offer, checkedAt: event.at, note: null };
    case 'UNSUPPORTED': return { ...base, status: 'unsupported', offer: event.offer || null, reason: event.reason, checkedAt: event.at };
    case 'BLOCKED': return { ...base, status: 'blocked', offer: event.offer || null, reason: event.reason, checkedAt: event.at };
    case 'OFFLINE': return { ...base, status: 'offline', reason: event.reason, checkedAt: event.at || s.checkedAt };
    case 'INVALID': return { ...base, status: 'invalid', reason: event.reason, staged: null, offer: s.status === 'checking' ? null : s.offer };
    case 'ERROR': return { ...base, status: 'error', reason: event.reason };
    case 'DOWNLOAD': return { ...base, status: 'downloading', received: 0, total: s.offer ? s.offer.size : 0 };
    case 'PROGRESS': return { ...base, status: 'downloading', received: event.received, total: event.total };
    case 'CORRUPT': return { ...base, status: 'corrupt', reason: event.reason, staged: null };
    case 'VERIFIED': return { ...base, status: 'ready', staged: event.staged, dismissed: false };
    case 'CANCEL': return { ...base, status: 'cancelled', received: 0 };
    case 'RESTART': return { ...base, status: 'restarting' };
    case 'UNSAVED': return { ...base, status: 'ready', reason: event.reason, dismissed: false };
    case 'APPLY_FAILED': return { ...base, status: 'rolledback', reason: event.reason, staged: null };
    case 'RESTORE_READY': return { ...base, status: 'ready', offer: event.offer, staged: event.staged, dismissed: false };
    case 'LATER': return { ...base, status: 'ready', dismissed: true };
    default: return s;
  }
}

// ---------- update coming soon ----------
const ACTIVE = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending']);
function stepState(st) {
  if (!st) return 'waiting';
  if (st.status === 'completed') {
    if (st.conclusion === 'success') return 'done';
    if (st.conclusion === 'skipped') return 'skipped';
    if (st.conclusion === 'cancelled') return 'failed';
    return 'failed';
  }
  if (st.status === 'in_progress') return 'running';
  return 'waiting';
}
function median(xs) {
  const a = xs.filter((x) => Number.isFinite(x) && x > 0).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
// Builds the coming-soon view from the public run record. Returns null when no build is in
// flight (the block is then absent, not empty).
//   runs: workflow runs, newest first; jobs: jobs of the newest relevant run;
//   installedCommit: the running build's commit; published: true once a release for the run's
//   commit exists; now: ms.
function comingSoon({ runs, jobs, installedCommit, published, now, previous }) {
  const list = Array.isArray(runs) ? runs : [];
  const relevant = list.filter((r) => r && r.head_sha !== installedCommit);
  const run = relevant[0];
  if (!run) return null;
  const durations = list.filter((r) => r.status === 'completed' && r.conclusion === 'success' && r.run_started_at && r.updated_at)
    .slice(0, 8).map((r) => Date.parse(r.updated_at) - Date.parse(r.run_started_at));
  const typical = median(durations);
  const started = Date.parse(run.run_started_at || run.created_at);
  const elapsed = Number.isFinite(started) ? Math.max(0, now - started) : null;
  let phase;
  if (ACTIVE.has(run.status)) phase = 'building';
  else if (run.status === 'completed' && run.conclusion === 'success') phase = published ? 'published' : 'publishing';
  else if (run.status === 'completed' && run.conclusion === 'cancelled') phase = list.some((r) => r !== run && ACTIVE.has(r.status) && Date.parse(r.created_at) > Date.parse(run.created_at)) ? 'replaced' : 'failed';
  else if (run.status === 'completed') phase = 'failed';
  else phase = 'unknown';
  // A newer run that started after the one we were showing replaces it.
  let replacedFrom = null;
  if (previous && previous.runId && previous.runId !== run.id && previous.phase !== 'published' && Date.parse(run.created_at) > Date.parse(previous.createdAt || 0)) replacedFrom = previous.build;
  // A published build becomes the ordinary update offer; a failure older than a day is no longer "coming".
  if (phase === 'published') return { phase, build: run.run_number, runId: run.id, url: run.html_url };
  if (phase === 'failed' && now - Date.parse(run.updated_at || run.created_at) > 24 * 3600 * 1000) return null;
  const job = (jobs || [])[0];
  const stages = [{ name: 'Source received', state: 'done' }];
  const queued = run.status === 'queued' || run.status === 'waiting' || run.status === 'requested' || run.status === 'pending' || (job && job.status === 'queued');
  stages.push({ name: 'Waiting its turn', state: queued ? 'running' : 'done' });
  for (const st of (job && job.steps) || []) {
    if (/^(Set up job|Complete job)$/i.test(st.name) || /^Post /i.test(st.name)) continue;
    stages.push({ name: st.name, state: stepState(st), startedAt: st.started_at || null, completedAt: st.completed_at || null });
  }
  stages.push({ name: 'Update feed moved', state: phase === 'publishing' ? 'running' : 'waiting' });
  if (phase === 'failed' || phase === 'replaced') for (const s of stages) if (s.state === 'running' || s.state === 'waiting') s.state = 'skipped';
  const running = stages.find((s) => s.state === 'running');
  let stalled = false;
  if (phase === 'building' && running && running.startedAt && typical) stalled = now - Date.parse(running.startedAt) > Math.max(20 * 60 * 1000, typical);
  else if (phase === 'building' && typical && elapsed) stalled = elapsed > typical * 2;
  const estimateLeft = phase === 'building' && typical && elapsed !== null ? Math.max(0, typical - elapsed) : null;
  return {
    phase, build: run.run_number, runId: run.id, url: run.html_url, commit: run.head_sha, createdAt: run.created_at,
    startedAt: Number.isFinite(started) ? new Date(started).toISOString() : null, elapsedMs: elapsed,
    estimate: estimateLeft === null ? null : { leftMs: estimateLeft, typicalMs: typical, from: durations.length },
    stalled, replacedFrom, stages,
    contains: [] // filled by the caller from the compare record
  };
}

// ---------- Electron wiring ----------
function register(ipcMain, app, opts = {}) {
  const { BrowserWindow, shell, net } = require('electron');
  const doFetch = (url, init) => (net && net.fetch ? net.fetch(url, init) : fetch(url, init));
  const repo = opts.repo || REPO;
  const busy = typeof opts.busy === 'function' ? opts.busy : () => 0;
  const userData = app.getPath('userData');
  const dir = path.join(userData, 'updates');
  const prefsFile = path.join(dir, 'prefs.json');
  const stageFile = path.join(dir, 'staged.json');
  const updateExe = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
  const squirrel = process.platform === 'win32' && app.isPackaged && fs.existsSync(updateExe);
  let installed = { version: app.getVersion(), commit: null };
  try {
    const gen = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'generated', 'docs.json'), 'utf8'));
    installed = { version: gen.version || app.getVersion(), commit: /^[0-9a-f]{40}$/.test(gen.commit) ? gen.commit : null };
  } catch { /* no build metadata: the commit stays unknown and the check says so */ }

  let prefs = { auto: true };
  try { prefs = { ...prefs, ...JSON.parse(fs.readFileSync(prefsFile, 'utf8')) }; } catch { /* defaults */ }
  let state = { status: 'idle', auto: prefs.auto, squirrel, installed, offer: null };
  let coming = null;
  let comingInfo = { status: 'idle', checkedAt: null, reason: null };
  let abort = null;
  const etags = new Map();

  const broadcast = () => {
    const payload = snapshot();
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('updates:state', payload);
  };
  const snapshot = () => ({ ...state, auto: prefs.auto, squirrel, installed, coming, comingInfo });
  const apply = (event) => { state = { ...reduce(state, event), auto: prefs.auto, squirrel, installed }; broadcast(); return state; };
  const now = () => new Date().toISOString();

  async function getJson(url) {
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'material-vm-labs-updater', 'X-GitHub-Api-Version': '2022-11-28' };
    const cached = etags.get(url);
    if (cached) headers['If-None-Match'] = cached.etag;
    let res;
    try { res = await doFetch(url, { headers, signal: AbortSignal.timeout(20000) }); }
    catch (e) { const err = new Error(`No connection to GitHub (${e.message || e}).`); err.offline = true; throw err; }
    if (res.status === 304 && cached) return cached.body;
    if (res.status === 403 || res.status === 429) {
      const reset = Number(res.headers.get('x-ratelimit-reset'));
      throw new Error(`GitHub refused the request (HTTP ${res.status}${reset ? `; the hourly limit resets at ${new Date(reset * 1000).toISOString()}` : ''}).`);
    }
    if (res.status === 404) { const e = new Error('Not found'); e.notFound = true; throw e; }
    if (!res.ok) throw new Error(`GitHub answered HTTP ${res.status}.`);
    const body = await res.json();
    const etag = res.headers.get('etag');
    if (etag) etags.set(url, { etag, body });
    return body;
  }
  async function getBytes(url, limit, onProgress, signal) {
    let res;
    try { res = await doFetch(url, { headers: { 'User-Agent': 'material-vm-labs-updater' }, signal }); }
    catch (e) { if (signal && signal.aborted) throw Object.assign(new Error('cancelled'), { cancelled: true }); const err = new Error(`No connection (${e.message || e}).`); err.offline = true; throw err; }
    if (!res.ok) throw new Error(`Download answered HTTP ${res.status}.`);
    if (!/^https:/.test(res.url || url)) throw new Error('The download left HTTPS.');
    const chunks = []; let n = 0; let last = Date.now();
    const reader = res.body.getReader();
    for (;;) {
      let r;
      try { r = await reader.read(); } catch (e) { if (signal && signal.aborted) throw Object.assign(new Error('cancelled'), { cancelled: true }); const err = new Error(`The download stopped (${e.message || e}).`); err.offline = true; throw err; }
      if (r.done) break;
      n += r.value.length;
      if (n > limit) throw Object.assign(new Error(`The download passed its ${limit} byte limit.`), { corrupt: true });
      chunks.push(Buffer.from(r.value));
      if (onProgress && Date.now() - last > 250) { last = Date.now(); onProgress(n); }
    }
    if (onProgress) onProgress(n);
    return Buffer.concat(chunks);
  }

  async function check(manual) {
    if (state.status === 'checking' || state.status === 'downloading' || state.status === 'restarting') return snapshot();
    if (state.status === 'ready') return snapshot(); // already staged; a new check waits until it is installed or replaced
    apply({ type: 'CHECK', manual });
    let release;
    try { release = await getJson(`${API}/repos/${repo}/releases/latest`); }
    catch (e) {
      if (e.offline) return apply({ type: 'OFFLINE', reason: e.message, at: now() }), snapshot();
      if (e.notFound) return apply({ type: 'NO_UPDATE', at: now(), note: 'No release has been published yet.' }), snapshot();
      return apply({ type: 'ERROR', reason: e.message }), snapshot();
    }
    let offer;
    try {
      const rel = (release.assets || []).find((a) => a && a.name === 'RELEASES');
      if (!rel) throw new Error('The latest release has no RELEASES file, so it carries no installer update.');
      const text = (await getBytes(rel.browser_download_url, MAX_METADATA_BYTES)).toString('utf8');
      offer = readOffer(release, text);
    } catch (e) {
      if (e.offline) return apply({ type: 'OFFLINE', reason: e.message, at: now() }), snapshot();
      return apply({ type: 'INVALID', reason: `Feed metadata is not valid: ${e.message}` }), snapshot();
    }
    // Is the release newer than this copy? The commit decides; the version cannot, because a
    // release reuses the version until it is bumped.
    if (installed.commit && offer.commit === installed.commit) return apply({ type: 'NO_UPDATE', at: now() }), snapshot();
    if (installed.commit && offer.commit) {
      try {
        const cmp = await getJson(`${API}/repos/${repo}/compare/${installed.commit}...${offer.commit}`);
        if (cmp.status === 'behind' || cmp.status === 'identical') return apply({ type: 'NO_UPDATE', at: now(), note: 'This copy is the same as or newer than the latest release.' }), snapshot();
        offer.commits = Array.isArray(cmp.commits) ? cmp.commits.slice(-20).map((c) => String((c.commit && c.commit.message) || '').split('\n')[0]).filter(Boolean) : [];
      } catch (e) { if (e.offline) return apply({ type: 'OFFLINE', reason: e.message, at: now() }), snapshot(); }
    }
    let same = false;
    try { same = compareVersions(offer.version, installed.version) <= 0; } catch { same = true; }
    if (squirrel && same) {
      return apply({ type: 'BLOCKED', offer, at: now(), reason: `The newer build ${offer.tag} carries package version ${offer.version}, the same as or lower than this copy (${installed.version}), so Squirrel.Windows would not apply it. Install it from the release page instead.` }), snapshot();
    }
    if (!squirrel) {
      return apply({ type: 'UNSUPPORTED', offer, at: now(), reason: 'This copy was not installed with the Squirrel.Windows installer (portable or development copy), so it cannot update itself. Download the new version from the release page.' }), snapshot();
    }
    apply({ type: 'FOUND', offer, at: now() });
    if (prefs.auto) download();
    return snapshot();
  }

  async function download() {
    if (!squirrel) return snapshot();
    const offer = state.offer;
    if (!offer) return snapshot();
    apply({ type: 'DOWNLOAD' });
    if (state.status !== 'downloading') return snapshot();
    abort = new AbortController();
    const stage = path.join(dir, 'staging', offer.tag.replace(/[^A-Za-z0-9._-]/g, '_'));
    try {
      const buf = await getBytes(offer.url, offer.size + 1, (n) => apply({ type: 'PROGRESS', received: n, total: offer.size }), abort.signal);
      const v = verifyPackage(buf, offer);
      if (!v.ok) { apply({ type: v.kind === 'corrupt' ? 'CORRUPT' : 'INVALID', reason: v.reason }); return snapshot(); }
      fs.rmSync(stage, { recursive: true, force: true });
      fs.mkdirSync(stage, { recursive: true });
      fs.writeFileSync(path.join(stage, offer.file), buf);
      fs.writeFileSync(path.join(stage, 'RELEASES'), `${offer.sha1.toUpperCase()} ${offer.file} ${offer.size}`);
      const staged = { dir: stage, file: offer.file };
      fs.writeFileSync(stageFile, JSON.stringify({ offer, staged, installedCommit: installed.commit }));
      apply({ type: 'VERIFIED', staged });
    } catch (e) {
      if (e.cancelled) apply({ type: 'CANCEL' });
      else if (e.offline) apply({ type: 'OFFLINE', reason: e.message });
      else if (e.corrupt) apply({ type: 'CORRUPT', reason: e.message });
      else apply({ type: 'ERROR', reason: e.message });
    } finally { abort = null; }
    return snapshot();
  }

  function cancel() {
    if (abort) abort.abort();
    return snapshot();
  }

  function spawnWait(args) {
    return new Promise((resolve) => {
      const { spawn } = require('node:child_process');
      let child;
      try { child = spawn(updateExe, args, { windowsHide: true, stdio: 'ignore' }); } catch (e) { resolve({ code: -1, error: e.message }); return; }
      const t = setTimeout(() => { try { child.kill(); } catch { /* gone */ } resolve({ code: -2, error: 'timed out after 10 minutes' }); }, 10 * 60 * 1000);
      child.on('error', (e) => { clearTimeout(t); resolve({ code: -1, error: e.message }); });
      child.on('exit', (code) => { clearTimeout(t); resolve({ code }); });
    });
  }

  async function restart(arg) {
    const o = arg && typeof arg === 'object' ? arg : {};
    if (state.status !== 'ready' || !state.staged) return snapshot();
    const jobs = Number(busy()) || 0;
    if (jobs > 0 && o.confirmedJobs !== true) { apply({ type: 'UNSAVED', reason: jobs === 1 ? '1 job is still running. Restarting now would cancel it.' : `${jobs} jobs are still running. Restarting now would cancel them.` }); return { ...snapshot(), needsConfirm: 'jobs', jobs }; }
    apply({ type: 'RESTART' });
    // Re-verify the staged bytes: a file changed after staging is never installed.
    let buf;
    try { buf = fs.readFileSync(path.join(state.staged.dir, state.staged.file)); } catch (e) { apply({ type: 'APPLY_FAILED', reason: `The staged package is missing (${e.message}). Nothing was installed; this version keeps running.` }); return snapshot(); }
    const v = verifyPackage(buf, state.offer);
    if (!v.ok) { apply({ type: 'APPLY_FAILED', reason: `The staged package changed after it was checked: ${v.reason} Nothing was installed.` }); try { fs.rmSync(stageFile, { force: true }); } catch { /* ignore */ } return snapshot(); }
    const r = await spawnWait(['--update', state.staged.dir]);
    if (r.code !== 0) {
      apply({ type: 'APPLY_FAILED', reason: `Squirrel.Windows could not apply the update (exit ${r.code}${r.error ? `, ${r.error}` : ''}). The current version is still installed and keeps running.` });
      return snapshot();
    }
    try { fs.rmSync(stageFile, { force: true }); } catch { /* ignore */ }
    app.once('will-quit', () => {
      try { require('node:child_process').spawn(updateExe, ['--processStart', path.basename(process.execPath)], { detached: true, stdio: 'ignore' }).unref(); } catch { /* the next manual start runs the new version */ }
    });
    if (typeof opts.quit === 'function') opts.quit({ forUpdate: true }); else app.quit();
    return snapshot();
  }

  function later() { apply({ type: 'LATER' }); return snapshot(); }
  function setAuto(on) {
    if (typeof on !== 'boolean') throw new Error('auto must be true or false');
    prefs.auto = on;
    try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(prefsFile, JSON.stringify(prefs)); } catch { /* the choice still applies to this session */ }
    state = { ...state, auto: on }; broadcast();
    return snapshot();
  }

  // ---- update coming soon ----
  let comingTimer = null;
  async function refreshComing() {
    comingInfo = { ...comingInfo, status: 'checking' };
    try {
      const runs = (await getJson(`${API}/repos/${repo}/actions/workflows/${WORKFLOW}/runs?per_page=12&branch=main`)).workflow_runs || [];
      const candidate = runs.find((r) => r.head_sha !== installed.commit);
      let jobs = [];
      let published = false;
      if (candidate && ACTIVE.has(candidate.status)) jobs = (await getJson(`${API}/repos/${repo}/actions/runs/${candidate.id}/jobs?per_page=10`)).jobs || [];
      if (candidate && candidate.status === 'completed' && candidate.conclusion === 'success') {
        try { const rel = await getJson(`${API}/repos/${repo}/releases/latest`); published = notesCommit(rel.body) === candidate.head_sha; } catch { published = false; }
      }
      const view = comingSoon({ runs, jobs, installedCommit: installed.commit, published, now: Date.now(), previous: coming });
      if (view && view.phase !== 'published' && installed.commit && candidate) {
        try {
          const cmp = await getJson(`${API}/repos/${repo}/compare/${installed.commit}...${candidate.head_sha}`);
          view.contains = (cmp.commits || []).slice(-20).map((c) => String((c.commit && c.commit.message) || '').split('\n')[0]).filter(Boolean);
        } catch { view.contains = []; }
      } else if (view && candidate && candidate.head_commit) view.contains = [String(candidate.head_commit.message || '').split('\n')[0]];
      if (view && view.phase === 'published') { coming = null; check(false); }
      else coming = view;
      comingInfo = { status: 'ok', checkedAt: now(), reason: null };
    } catch (e) {
      comingInfo = { status: e.offline ? 'offline' : 'unknown', checkedAt: now(), reason: e.message };
    }
    broadcast();
    clearTimeout(comingTimer);
    comingTimer = setTimeout(refreshComing, coming && coming.phase === 'building' ? COMING_ACTIVE_MS : COMING_IDLE_MS);
    if (comingTimer.unref) comingTimer.unref();
    return snapshot();
  }

  // Restore a package staged by an earlier session, re-verified before it is offered again.
  try {
    const saved = JSON.parse(fs.readFileSync(stageFile, 'utf8'));
    if (squirrel && saved && saved.offer && saved.staged && saved.installedCommit === installed.commit) {
      const buf = fs.readFileSync(path.join(saved.staged.dir, saved.staged.file));
      if (verifyPackage(buf, saved.offer).ok) state = reduce(state, { type: 'RESTORE_READY', offer: saved.offer, staged: saved.staged });
      else fs.rmSync(stageFile, { force: true });
    } else if (saved) fs.rmSync(stageFile, { force: true });
  } catch { /* nothing staged */ }

  const strictBool = (v) => v === true;
  ipcMain.handle('updates:state', () => snapshot());
  ipcMain.handle('updates:check', () => check(true));
  ipcMain.handle('updates:download', () => download());
  ipcMain.handle('updates:cancel', () => cancel());
  ipcMain.handle('updates:restart', (_e, o) => restart({ confirmedJobs: strictBool(o && o.confirmedJobs) }));
  ipcMain.handle('updates:later', () => later());
  ipcMain.handle('updates:set-auto', (_e, on) => setAuto(on));
  ipcMain.handle('updates:coming-refresh', () => refreshComing());
  ipcMain.handle('updates:open-notes', () => {
    const url = (state.offer && state.offer.notesUrl) || `https://github.com/${repo}/releases/latest`;
    if (/^https:\/\/github\.com\//.test(url)) return shell.openExternal(url).then(() => true);
    return false;
  });
  ipcMain.handle('updates:open-build', () => {
    const url = coming && coming.url;
    if (url && /^https:\/\/github\.com\//.test(url)) return shell.openExternal(url).then(() => true);
    return false;
  });

  const first = setTimeout(() => { if (prefs.auto) check(false); refreshComing(); }, FIRST_CHECK_MS);
  const every = setInterval(() => { if (prefs.auto) check(false); }, CHECK_EVERY_MS);
  if (first.unref) first.unref();
  if (every.unref) every.unref();
  return { check, snapshot };
}

module.exports = {
  register, parseVersion, compareVersions, parseReleases, newestFull, parseNotesHashes, notesCommit, buildNumber,
  verifyPackage, readOffer, reduce, STATES, comingSoon, median
};
