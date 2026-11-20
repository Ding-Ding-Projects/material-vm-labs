'use strict';
// Minecraft server manager and world generator, main-process side. Every request passes the strict
// allowlist in minecraft-core.validateRequest before anything runs. Downloads come only from Mojang's
// and PaperMC's official hosts and are checked against the published SHA-1 or SHA-256 before use.
// Java runs through spawn with an argument array; console commands go to the server's stdin, never a shell.
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const net = require('net');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');
const core = require('./minecraft-core');

const ALLOWED_HOSTS = new Set([...core.META_HOSTS, ...core.SERVER_HOSTS, ...core.PAPER_HOSTS]);

function get(url, { asStream, signal, maxBytes = 16 * 1024 * 1024, redirects = 0 } = {}) {
  return new Promise((resolve, reject) => {
    if (!core.hostIn(url, ALLOWED_HOSTS)) return reject(new Error('That address is not one of the official download hosts.'));
    const req = https.get(url, { headers: { 'User-Agent': 'material-vm-labs', Accept: '*/*' }, timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) { res.resume(); return resolve(get(new URL(res.headers.location, url).href, { asStream, signal, maxBytes, redirects: redirects + 1 })); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`${new URL(url).hostname} answered ${res.statusCode}.`)); }
      if (asStream) return resolve(res);
      const chunks = []; let size = 0;
      res.on('data', (c) => { size += c.length; if (size > maxBytes) { req.destroy(new Error('The answer was larger than expected.')); return; } chunks.push(c); });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    if (signal) signal.addEventListener('abort', () => req.destroy(Object.assign(new Error('Cancelled.'), { cancelled: true })), { once: true });
    req.on('timeout', () => req.destroy(new Error('The download host did not answer in time.')));
    req.on('error', reject);
  });
}

async function sha256File(f) { const h = crypto.createHash('sha256'); for await (const c of fs.createReadStream(f)) h.update(c); return h.digest('hex'); }
async function walk(dir, base = dir) {
  const out = [];
  for (const d of await fsp.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) out.push(...await walk(p, base)); else if (d.isFile()) out.push(path.relative(base, p));
  }
  return out;
}
function freeName(dir, name, ext) {
  for (let i = 0; i < 1000; i++) { const n = i ? `${name} (${i})${ext}` : `${name}${ext}`; if (!fs.existsSync(path.join(dir, n))) return n; }
  throw new Error('Could not find a free name in that folder.');
}
function freePort() { return new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); }); }
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    let out = '', err = '', done = false;
    const c = spawn(cmd, args, { windowsHide: true, cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const t = setTimeout(() => { if (!done) c.kill(); }, opts.timeout || 15000);
    c.stdout.on('data', (d) => { if (out.length < 1e6) out += d; });
    c.stderr.on('data', (d) => { if (err.length < 1e6) err += d; });
    c.on('error', (e) => { done = true; clearTimeout(t); resolve({ code: -1, out, err: e.message, missing: e.code === 'ENOENT' }); });
    c.on('close', (code) => { done = true; clearTimeout(t); resolve({ code, out, err }); });
  });
}

function banner(r) { const lines = String(r.err + '\n' + r.out).split(/\r?\n/); return (lines.find((l) => /version "/.test(l)) || lines[0] || '').slice(0, 200); }
function javaCandidates() {
  const c = new Set();
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  if (process.env.JAVA_HOME) c.add(path.join(process.env.JAVA_HOME, 'bin', exe));
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) if (dir) { const p = path.join(dir, exe); if (fs.existsSync(p)) c.add(p); }
  const roots = process.platform === 'win32'
    ? [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).flatMap((p) => ['Java', 'Eclipse Adoptium', 'Microsoft', 'Zulu', 'Amazon Corretto', 'BellSoft'].map((v) => path.join(p, v)))
    : ['/usr/lib/jvm', '/Library/Java/JavaVirtualMachines'];
  for (const r of roots) {
    let list = []; try { list = fs.readdirSync(r); } catch { continue; }
    for (const d of list) for (const p of [path.join(r, d, 'bin', exe), path.join(r, d, 'Contents', 'Home', 'bin', exe)]) if (fs.existsSync(p)) c.add(p);
  }
  return [...c];
}

function register(ipcMain, app) {
  let shell = null, dialog = null, BrowserWindow = null;
  try { ({ shell, dialog, BrowserWindow } = require('electron')); } catch { /* tests run without Electron */ }
  const root = path.join(app.getPath('userData'), 'minecraft');
  const serversDir = path.join(root, 'servers');
  const cacheDir = path.join(root, 'cache');
  const running = new Map();
  const jobs = new Map();
  let javaCache = null;
  const send = (wc, d) => { try { if (!wc.isDestroyed()) wc.send('minecraft:event', d); } catch { /* window gone */ } };
  const sdir = (id) => path.join(serversDir, id);
  const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const meta = (id) => { const m = readJson(path.join(sdir(id), 'mvl-server.json')); if (!m) throw new Error('That server does not exist.'); return m; };
  const saveMeta = (m) => fs.writeFileSync(path.join(sdir(m.id), 'mvl-server.json'), JSON.stringify(m, null, 2));

  async function manifest(force) {
    const f = path.join(cacheDir, 'version-manifest.json');
    const cached = readJson(f);
    if (cached && !force && Date.now() - cached.fetchedAt < 60 * 60 * 1000) return { ...cached, stale: false, offline: false };
    try {
      const body = await get(core.MANIFEST_URL);
      const parsed = core.parseVersionManifest(body.toString('utf8'));
      const rec = { source: core.MANIFEST_URL, fetchedAt: Date.now(), sha256: core.digestHex(body, 'sha256'), ...parsed };
      await fsp.mkdir(cacheDir, { recursive: true }); await fsp.writeFile(f, JSON.stringify(rec));
      return { ...rec, stale: false, offline: false };
    } catch (err) {
      if (cached) return { ...cached, stale: true, offline: true, error: err.message };
      throw new Error(`The official version catalogue could not be read and nothing is cached yet: ${err.message}`);
    }
  }
  async function versionInfo(id) {
    const m = await manifest(false);
    const v = m.versions.find((x) => x.id === id);
    if (!v) throw new Error('That version is not in the official catalogue.');
    const f = path.join(cacheDir, 'meta', v.sha1 + '.json');
    let body = null; try { body = await fsp.readFile(f); } catch { /* fetch */ }
    if (!body) {
      body = await get(v.url);
      const check = core.verifyDigest(body, 'sha1', v.sha1);
      if (!check.ok) throw new Error(`The metadata for ${id} did not match its published SHA-1 (expected ${check.expected}, got ${check.actual}).`);
      await fsp.mkdir(path.dirname(f), { recursive: true }); await fsp.writeFile(f, body);
    }
    return { ...core.parseVersionMeta(body.toString('utf8'), id), type: v.type, releaseTime: v.releaseTime };
  }
  async function javaList(force) {
    if (javaCache && !force) return javaCache;
    const out = [];
    for (const p of javaCandidates()) { const r = await run(p, ['-version'], { timeout: 8000 }); const major = core.parseJavaVersion(r.err + r.out); if (major) out.push({ path: p, major, banner: banner(r) }); }
    if (!out.length) { const r = await run(process.platform === 'win32' ? 'java.exe' : 'java', ['-version'], { timeout: 8000 }); const major = core.parseJavaVersion(r.err + r.out); if (major) out.push({ path: 'java', major, banner: banner(r) }); }
    javaCache = out; return out;
  }
  async function pickJava(m) {
    const list = await javaList(false);
    if (m.javaPath) { const j = list.find((x) => x.path === m.javaPath); if (j) return j; }
    const okList = list.filter((j) => !m.javaMajor || j.major >= m.javaMajor).sort((a, b) => a.major - b.major);
    return okList[0] || null;
  }

  async function download(e, url, dest, algo, expected, size, jobId, ac) {
    const tmp = dest + '.partial';
    const res = await get(url, { asStream: true, signal: ac.signal });
    const h = crypto.createHash(algo); let got = 0, last = 0;
    const out = fs.createWriteStream(tmp);
    try {
      for await (const c of res) {
        got += c.length; if (size && got > size) throw new Error('The download was larger than its published size.');
        h.update(c); if (!out.write(c)) await new Promise((r) => out.once('drain', r));
        if (Date.now() - last > 200) { last = Date.now(); send(e.sender, { jobId, kind: 'download', type: 'progress', received: got, total: size || 0 }); }
      }
      await new Promise((r, j) => out.end((err) => (err ? j(err) : r())));
      const actual = h.digest('hex');
      if (actual !== expected) throw new Error(`The server file did not match its published ${algo.toUpperCase()} (expected ${expected}, got ${actual}). It was not kept.`);
      await fsp.rename(tmp, dest);
      return { received: got, digest: actual };
    } catch (err) { out.destroy(); await fsp.rm(tmp, { force: true }); throw err; }
  }

  const h = {};
  h.versions = async (a) => { const m = await manifest(!!(a && a.refresh)); return { ok: true, latest: m.latest, versions: m.versions, fetchedAt: m.fetchedAt, stale: m.stale, offline: m.offline, error: m.error || '', source: m.source, count: m.versions.length }; };
  h.versionInfo = async (id) => ({ ok: true, ...(await versionInfo(id)) });
  h.paperVersions = async () => ({ ok: true, versions: core.parsePaperVersions((await get(core.PAPER_PROJECT_URL)).toString('utf8')), source: core.PAPER_PROJECT_URL });
  h.paperBuilds = async (v) => ({ ok: true, builds: core.parsePaperBuilds((await get(`${core.PAPER_PROJECT_URL}/versions/${encodeURIComponent(v)}/builds`)).toString('utf8')) });
  h.java = async () => ({ ok: true, runtimes: await javaList(true) });
  h.targets = async () => {
    const d = await run('docker', ['version', '--format', '{{.Server.Version}}'], { timeout: 6000 });
    const java = await javaList(false);
    return { ok: true, targets: [
      { id: 'local', label: 'Local process', available: true, detail: java.length ? `Java found: ${java.map((j) => j.major).join(', ')}` : 'No Java runtime was found; servers cannot start until one is installed.' },
      { id: 'local-docker', label: 'Local Docker', available: false, detail: d.code === 0 ? `Docker Engine ${d.out.trim()} answered, but running servers in Docker from this app is not built yet.` : d.missing ? 'Docker is not installed or not on PATH.' : 'Docker is installed but its engine did not answer.' },
      { id: 'ssh', label: 'SSH process', available: false, detail: 'Not built yet: this app has no SSH host approval or credential handling for server management.' },
      { id: 'ssh-docker', label: 'SSH Docker', available: false, detail: 'Not built yet: needs SSH host approval plus a remote Docker adapter.' },
    ] };
  };
  h.list = async () => {
    let ids = []; try { ids = await fsp.readdir(serversDir); } catch { /* none yet */ }
    const servers = [];
    for (const id of ids) { const m = readJson(path.join(sdir(id), 'mvl-server.json')); if (m) servers.push({ ...m, running: running.has(id), eula: /^\s*eula\s*=\s*true\s*$/m.test(fs.existsSync(path.join(sdir(id), 'eula.txt')) ? fs.readFileSync(path.join(sdir(id), 'eula.txt'), 'utf8') : '') }); }
    return { ok: true, servers, root: serversDir };
  };
  h.create = async (a, e) => {
    let url, algo, expected, size, javaMajor = null, build = null;
    if (a.flavour === 'vanilla') {
      const info = await versionInfo(a.version);
      if (!info.server) throw new Error(info.reason);
      ({ url, sha1: expected, size } = info.server); algo = 'sha1'; javaMajor = info.javaMajor;
    } else {
      const builds = core.parsePaperBuilds((await get(`${core.PAPER_PROJECT_URL}/versions/${encodeURIComponent(a.version)}/builds`)).toString('utf8'));
      const b = builds.find((x) => x.id === a.build); if (!b) throw new Error('That Paper build is not in the official list.');
      ({ url, sha256: expected, size } = b); algo = 'sha256'; build = b.id;
      try { javaMajor = (await versionInfo(a.version)).javaMajor; } catch { /* Paper versions match vanilla ids; unknown stays unknown */ }
    }
    const id = (a.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'server') + '-' + crypto.randomBytes(3).toString('hex');
    await fsp.mkdir(sdir(id), { recursive: true });
    const jobId = 'dl-' + crypto.randomBytes(4).toString('hex'); const ac = new AbortController(); jobs.set(jobId, ac);
    send(e.sender, { jobId, kind: 'download', type: 'started', id, total: size || 0 });
    try {
      const r = await download(e, url, path.join(sdir(id), 'server.jar'), algo, expected, size, jobId, ac);
      const m = { id, name: a.name, flavour: a.flavour, version: a.version, build, javaMajor, jar: { source: url, algo, digest: r.digest, size: r.received }, memMb: 2048, javaPath: null, target: 'local', createdAt: new Date().toISOString() };
      saveMeta(m); send(e.sender, { jobId, kind: 'download', type: 'done', id });
      return { ok: true, server: m };
    } catch (err) { await fsp.rm(sdir(id), { recursive: true, force: true }); send(e.sender, { jobId, kind: 'download', type: err.cancelled ? 'cancelled' : 'error', error: err.message }); throw err; }
    finally { jobs.delete(jobId); }
  };
  h.remove = async (id) => { if (running.has(id)) throw new Error('Stop the server before removing it.'); meta(id); await fsp.rm(sdir(id), { recursive: true, force: true }); return { ok: true }; };
  h.readProperties = async (id) => {
    const m = meta(id); const f = path.join(sdir(id), 'server.properties');
    const exists = fs.existsSync(f);
    const doc = core.parseProperties(exists ? await fsp.readFile(f, 'latin1') : '');
    const values = core.propsToObject(doc); if ('rcon.password' in values) values['rcon.password'] = values['rcon.password'] ? '(set)' : '';
    const ex = readJson(path.join(sdir(id), 'extracted.json'));
    return { ok: true, exists, values, descriptors: core.PROPERTY_DESCRIPTORS, presets: ex ? ex.presets : null, version: m.version, running: running.has(id) };
  };
  h.writeProperties = async (a) => {
    meta(a.id); const f = path.join(sdir(a.id), 'server.properties');
    const before = fs.existsSync(f) ? await fsp.readFile(f, 'latin1') : '';
    const doc = core.parseProperties(before);
    for (const [k, v] of Object.entries(a.changes)) { if (k === 'rcon.password' && v === '(set)') continue; core.setProperty(doc, k, v); }
    if (before) await fsp.writeFile(f + '.previous', before, 'latin1');
    await fsp.writeFile(f + '.tmp', core.serializeProperties(doc), 'latin1'); await fsp.rename(f + '.tmp', f);
    return { ok: true, changed: Object.keys(a.changes).length, appliesAfterRestart: running.has(a.id), backup: before ? 'server.properties.previous' : null };
  };
  h.eula = async (id) => { meta(id); const f = path.join(sdir(id), 'eula.txt'); const t = fs.existsSync(f) ? await fsp.readFile(f, 'utf8') : ''; return { ok: true, accepted: /^\s*eula\s*=\s*true\s*$/m.test(t), url: core.EULA_URL }; };
  h.acceptEula = async (a) => { meta(a.id); await fsp.writeFile(path.join(sdir(a.id), 'eula.txt'), `#Accepted by the person using this computer in Material VM Labs on ${new Date().toISOString()}\n#${core.EULA_URL}\neula=true\n`); return { ok: true, accepted: true }; };
  h.setRuntime = async (a) => {
    const m = meta(a.id);
    if (a.javaPath) { const list = await javaList(false); if (!list.some((j) => j.path === a.javaPath)) throw new Error('Pick one of the detected Java runtimes.'); }
    Object.assign(m, { javaPath: a.javaPath || null, memMb: a.memMb }); saveMeta(m); return { ok: true, server: m };
  };
  h.start = async (id, e) => {
    if (running.has(id)) return { ok: true, already: true };
    const m = meta(id);
    if (!(await h.eula(id)).accepted) throw new Error('The server will not start until you accept the Minecraft EULA on the EULA card.');
    const j = await pickJava(m);
    if (!j) throw new Error(m.javaMajor ? `No Java ${m.javaMajor} or newer was found. Minecraft ${m.version} asks for Java ${m.javaMajor}; install it, then press Detect Java.` : 'No Java runtime was found on this computer. Install one, then press Detect Java.');
    if (m.javaMajor && j.major < m.javaMajor) throw new Error(`The chosen Java is ${j.major}, but Minecraft ${m.version} asks for Java ${m.javaMajor} or newer.`);
    const child = spawn(j.path, [`-Xms${Math.min(1024, m.memMb)}M`, `-Xmx${m.memMb}M`, '-jar', 'server.jar', 'nogui'], { cwd: sdir(id), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const st = { child, startedAt: Date.now(), java: j, buf: '' };
    running.set(id, st);
    const line = (stream) => (d) => { st.buf += d.toString('utf8'); const parts = st.buf.split(/\r?\n/); st.buf = parts.pop(); for (const l of parts) send(e.sender, { kind: 'console', id, stream, line: l.slice(0, 4000) }); };
    child.stdout.on('data', line('out')); child.stderr.on('data', line('err'));
    child.on('error', (err) => send(e.sender, { kind: 'state', id, state: 'failed', error: err.message }));
    child.on('exit', (code, sig) => { running.delete(id); send(e.sender, { kind: 'state', id, state: 'stopped', code, signal: sig }); });
    send(e.sender, { kind: 'state', id, state: 'starting', pid: child.pid, java: j });
    return { ok: true, pid: child.pid, java: j };
  };
  const waitExit = (st, ms) => new Promise((r) => { if (st.child.exitCode != null) return r(true); const t = setTimeout(() => r(false), ms); st.child.once('exit', () => { clearTimeout(t); r(true); }); });
  h.stop = async (id) => { const st = running.get(id); if (!st) return { ok: true, wasRunning: false }; st.child.stdin.write('stop\n'); const done = await waitExit(st, 60000); return { ok: done, stopped: done, error: done ? '' : 'The server did not stop within 60 seconds. You can force it to stop.' }; };
  h.kill = async (id) => { const st = running.get(id); if (!st) return { ok: true, wasRunning: false }; st.child.kill(); const done = await waitExit(st, 10000); return { ok: done, stopped: done }; };
  h.command = async (a) => { const st = running.get(a.id); if (!st) throw new Error('The server is not running.'); st.child.stdin.write(a.command.replace(/^\//, '') + '\n'); return { ok: true }; };
  h.backup = async (id) => {
    if (running.has(id)) throw new Error('Stop the server before making a backup, so the world files are complete.');
    meta(id);
    const props = core.propsToObject(core.parseProperties(fs.existsSync(path.join(sdir(id), 'server.properties')) ? fs.readFileSync(path.join(sdir(id), 'server.properties'), 'latin1') : ''));
    const level = props['level-name'] || 'world'; const wdir = path.join(sdir(id), level);
    if (!fs.existsSync(wdir)) throw new Error(`There is no world folder "${level}" yet. Start the server once to create it.`);
    const files = []; for (const rel of await walk(wdir)) files.push({ name: `${level}/${rel.split(path.sep).join('/')}`, data: await fsp.readFile(path.join(wdir, rel)) });
    const zip = core.createZip(files); const bdir = path.join(sdir(id), 'backups'); await fsp.mkdir(bdir, { recursive: true });
    const name = freeName(bdir, `${level}-${new Date().toISOString().replace(/[:.]/g, '-')}`, '.zip');
    await fsp.writeFile(path.join(bdir, name + '.partial'), zip);
    const back = await fsp.readFile(path.join(bdir, name + '.partial')); for (const en of core.listZip(back)) core.readZipEntry(back, en);
    await fsp.rename(path.join(bdir, name + '.partial'), path.join(bdir, name));
    return { ok: true, file: path.join(bdir, name), files: files.length, bytes: zip.length };
  };
  h.openFolder = async (id) => { meta(id); if (shell) await shell.openPath(sdir(id)); return { ok: !!shell }; };
  h.openEula = async () => { if (shell) await shell.openExternal(core.EULA_URL); return { ok: !!shell, url: core.EULA_URL }; };
  h.browse = async (_a, e) => {
    if (!dialog) return { ok: false, error: 'No folder picker is available here.' };
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { properties: ['openDirectory', 'createDirectory'], title: 'Choose where to save the world' });
    return { ok: !r.canceled, path: r.canceled ? null : r.filePaths[0] };
  };

  function innerJar(outer) {
    const entries = core.listZip(outer);
    const list = entries.find((x) => x.name === 'META-INF/versions.list');
    if (!list) return { jar: outer, entries };
    const line = core.readZipEntry(outer, list).toString('utf8').trim().split(/\r?\n/)[0].split('\t');
    const inner = entries.find((x) => x.name === 'META-INF/versions/' + line[2]);
    if (!inner) throw new Error('The server jar lists an inner jar that is missing.');
    const jar = core.readZipEntry(outer, inner);
    return { jar, entries: core.listZip(jar), outerEntries: entries };
  }
  const stems = (entries, dir) => entries.filter((x) => x.name.startsWith(dir) && x.name.endsWith('.json') && !x.name.slice(dir.length).includes('/')).map((x) => 'minecraft:' + x.name.slice(dir.length, -5)).sort();
  function jarJson(jar, entries, name) { const en = entries.find((x) => x.name === name); return en ? JSON.parse(core.readZipEntry(jar, en).toString('utf8')) : null; }

  h.extract = async (id) => {
    const m = meta(id);
    if (m.flavour !== 'vanilla') throw new Error('Extraction reads the vanilla server jar. Create a vanilla server of the same version to use the world generator.');
    const j = await pickJava(m); if (!j) throw new Error('Extraction runs the data generator inside the server jar, which needs Java. No suitable Java was found.');
    const outDir = path.join(sdir(id), 'extract');
    await fsp.rm(outDir, { recursive: true, force: true }); await fsp.mkdir(outDir, { recursive: true });
    const r = await run(j.path, ['-DbundlerMainClass=net.minecraft.data.Main', '-jar', path.join(sdir(id), 'server.jar'), '--reports', '--output', path.join(outDir, 'generated')], { cwd: outDir, timeout: 5 * 60 * 1000 });
    const rep = path.join(outDir, 'generated', 'reports');
    const commands = readJson(path.join(rep, 'commands.json')); const registries = readJson(path.join(rep, 'registries.json'));
    const { jar, entries, outerEntries } = innerJar(await fsp.readFile(path.join(sdir(id), 'server.jar')));
    const vj = jarJson(jar, entries, 'version.json') || (outerEntries && jarJson(await fsp.readFile(path.join(sdir(id), 'server.jar')), outerEntries, 'version.json'));
    const w = 'data/minecraft/worldgen/';
    const ex = {
      version: m.version, extractedAt: new Date().toISOString(), jarDigest: m.jar.digest,
      reportsOk: !!(commands && registries), reportsError: commands && registries ? '' : `The data generator did not write its reports (exit ${r.code}). ${String(r.err).slice(0, 400)}`,
      packFormat: vj ? core.packFormatFromVersionJson(vj) : null,
      presets: stems(entries, w + 'world_preset/'), flatPresets: stems(entries, w + 'flat_level_generator_preset/'),
      biomes: stems(entries, w + 'biome/'), structureSets: stems(entries, w + 'structure_set/'),
      noiseSettings: stems(entries, w + 'noise_settings/'), dimensionTypes: stems(entries, 'data/minecraft/dimension_type/'),
      blocks: registries ? core.registryEntries(registries, 'minecraft:block') : [], gamerules: commands ? core.gameRulesFromCommands(commands) : [],
    };
    ex.dataDriven = ex.presets.length > 0;
    if (!ex.dataDriven) ex.dataDrivenReason = 'This version predates data-driven world presets, so only seed, level type and structures apply.';
    await fsp.writeFile(path.join(sdir(id), 'extracted.json'), JSON.stringify(ex));
    return { ok: true, extracted: ex };
  };

  h.generate = async (a, e) => {
    const m = meta(a.id);
    const ex = readJson(path.join(sdir(a.id), 'extracted.json'));
    if (!ex) throw new Error('Extract this version\'s settings first.');
    if (!ex.presets.includes(a.preset) && ex.dataDriven) throw new Error('Pick a preset read from this version.');
    if (a.flat) { for (const l of a.flat.layers) if (!ex.blocks.includes(l.block)) throw new Error(`${l.block} is not a block in ${m.version}.`); if (!ex.biomes.includes(a.flat.biome)) throw new Error('Pick a biome from this version.'); for (const s of a.flat.structures) if (!ex.structureSets.includes(s)) throw new Error(`${s} is not a structure set in ${m.version}.`); }
    if (a.singleBiome && !ex.biomes.includes(a.singleBiome)) throw new Error('Pick a biome from this version.');
    const rules = new Map(ex.gamerules.map((g) => [g.name, g]));
    for (const [k, v] of Object.entries(a.gamerules)) { const g = rules.get(k); if (!g || g.type === 'unknown' || (g.type === 'bool') !== (typeof v === 'boolean')) throw new Error(`Game rule ${k} does not match this version.`); }
    if (!fs.existsSync(a.dest) || !fs.statSync(a.dest).isDirectory()) throw new Error('The destination folder does not exist.');
    const j = await pickJava(m); if (!j) throw new Error('Generating a world runs the server, which needs Java. No suitable Java was found.');

    const jobId = 'gen-' + crypto.randomBytes(4).toString('hex'); const ac = new AbortController(); jobs.set(jobId, ac);
    const say = (o) => send(e.sender, { jobId, kind: 'generate', ...o });
    const stage = path.join(root, 'staging', jobId);
    let child = null;
    (async () => {
      try {
        say({ type: 'step', step: 'Preparing a private staging server' });
        await fsp.mkdir(path.join(stage, 'world', 'datapacks'), { recursive: true });
        await fsp.copyFile(path.join(sdir(a.id), 'server.jar'), path.join(stage, 'server.jar'));
        await fsp.writeFile(path.join(stage, 'eula.txt'), `#Accepted by the person using this computer in Material VM Labs on ${new Date().toISOString()} for world generation\n#${core.EULA_URL}\neula=true\n`);
        const { jar, entries } = innerJar(await fsp.readFile(path.join(stage, 'server.jar')));
        const presetFile = `data/minecraft/worldgen/world_preset/${a.preset.split(':')[1]}.json`;
        const pack = core.buildWorldPack({ preset: a.preset, flat: a.flat, singleBiome: a.singleBiome, noise: a.noise, packFormat: ex.packFormat, vanillaPreset: jarJson(jar, entries, presetFile), vanillaNoise: jarJson(jar, entries, 'data/minecraft/worldgen/noise_settings/overworld.json') });
        for (const [rel, text] of Object.entries(pack.files)) { const f = path.join(stage, 'world', 'datapacks', 'materialvmlabs', ...rel.split('/')); await fsp.mkdir(path.dirname(f), { recursive: true }); await fsp.writeFile(f, text); }
        const port = await freePort();
        const doc = core.parseProperties('');
        for (const [k, v] of Object.entries({ 'level-name': 'world', 'level-seed': a.seed, 'level-type': pack.levelType, 'generate-structures': a.structures, difficulty: a.difficulty, gamemode: a.gamemode, hardcore: a.hardcore, 'server-ip': '127.0.0.1', 'server-port': port, 'online-mode': true, 'enable-rcon': false, 'enable-query': false, 'max-players': 1, 'spawn-protection': 0, 'white-list': true })) core.setProperty(doc, k, String(v));
        await fsp.writeFile(path.join(stage, 'server.properties'), core.serializeProperties(doc), 'latin1');

        say({ type: 'step', step: 'Starting the staging server' });
        child = spawn(j.path, ['-Xms1024M', `-Xmx${m.memMb}M`, '-jar', 'server.jar', 'nogui'], { cwd: stage, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        const waiters = []; let buf = '', exited = false;
        child.on('exit', () => { exited = true; for (const w of waiters.splice(0)) w.reject(new Error('The staging server stopped unexpectedly.')); });
        child.stdout.on('data', (d) => { buf += d; const parts = buf.split(/\r?\n/); buf = parts.pop(); for (const l of parts) { say({ type: 'console', line: l.slice(0, 2000) }); for (const w of waiters.slice()) if (w.rx.test(l)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(l); } } });
        const waitFor = (rx, ms) => new Promise((resolve, reject) => { const w = { rx, resolve, reject }; waiters.push(w); setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); reject(new Error('The staging server did not answer in time.')); } }, ms); ac.signal.addEventListener('abort', () => reject(Object.assign(new Error('Cancelled.'), { cancelled: true })), { once: true }); });
        const cmd = (c) => { if (!exited) child.stdin.write(c + '\n'); };
        await waitFor(/Done \(/, 10 * 60 * 1000);
        for (const [k, v] of Object.entries(a.gamerules)) cmd(`gamerule ${k} ${v}`);
        const cxb = (a.area.cx + a.area.w / 2) * 16, czb = (a.area.cz + a.area.d / 2) * 16;
        if (a.borderFollows) { cmd(`worldborder center ${cxb} ${czb}`); cmd(`worldborder set ${Math.max(a.area.w, a.area.d) * 16}`); }
        if (a.spawn) cmd(`setworldspawn ${a.spawn.x} ~ ${a.spawn.z}`);
        const batches = core.planForceload(a.area);
        const settle = Math.max(1000, Math.min(60000, Number(a.settleMs) || 4000));
        for (let i = 0; i < batches.length; i++) {
          if (ac.signal.aborted) throw Object.assign(new Error('Cancelled.'), { cancelled: true });
          cmd(batches[i].command);
          await waitFor(/Marked|force ?loaded|forceload/i, 60000);
          await new Promise((r) => setTimeout(r, settle));
          cmd('forceload remove all');
          say({ type: 'progress', batch: i + 1, batches: batches.length, chunks: batches[i].chunks });
        }
        say({ type: 'step', step: 'Saving and stopping the staging server' });
        cmd('save-all flush'); await waitFor(/Saved the game|saved/i, 5 * 60 * 1000).catch(() => {});
        cmd('stop'); await new Promise((r) => { if (exited) return r(); const t = setTimeout(() => { child.kill(); r(); }, 120000); child.once('exit', () => { clearTimeout(t); r(); }); });

        const regionDir = path.join(stage, 'world', 'region');
        const missing = core.regionsForArea(a.area).filter((r) => !fs.existsSync(path.join(regionDir, r)));
        say({ type: 'step', step: 'Writing and verifying the output' });
        const wroot = path.join(stage, 'world'); const rels = await walk(wroot);
        const digests = new Map(); for (const rel of rels) digests.set(rel, await sha256File(path.join(wroot, rel)));
        let outPath;
        if (a.output === 'folder') {
          outPath = path.join(a.dest, freeName(a.dest, a.worldName, ''));
          await fsp.mkdir(outPath, { recursive: false });
          for (const rel of rels) { const t = path.join(outPath, rel); await fsp.mkdir(path.dirname(t), { recursive: true }); await fsp.copyFile(path.join(wroot, rel), t, fs.constants.COPYFILE_EXCL); }
          for (const rel of rels) if (await sha256File(path.join(outPath, rel)) !== digests.get(rel)) throw new Error(`Verification failed for ${rel}; the folder was left for you to inspect.`);
        } else {
          const name = freeName(a.dest, a.worldName, '.zip'); outPath = path.join(a.dest, name);
          const files = []; for (const rel of rels) files.push({ name: `${a.worldName}/${rel.split(path.sep).join('/')}`, data: await fsp.readFile(path.join(wroot, rel)) });
          const tmp = outPath + '.partial'; await fsp.writeFile(tmp, core.createZip(files), { flag: 'wx' });
          const back = await fsp.readFile(tmp); const byName = new Map(core.listZip(back).map((x) => [x.name, x]));
          for (const rel of rels) { const en = byName.get(`${a.worldName}/${rel.split(path.sep).join('/')}`); if (!en || core.digestHex(core.readZipEntry(back, en), 'sha256') !== digests.get(rel)) { await fsp.rm(tmp, { force: true }); throw new Error(`Verification failed for ${rel}; the ZIP was not kept.`); } }
          if (fs.existsSync(outPath)) throw new Error('A file with that name appeared while writing; nothing was overwritten.');
          await fsp.rename(tmp, outPath);
        }
        await fsp.rm(stage, { recursive: true, force: true });
        say({ type: 'done', path: outPath, files: rels.length, missingRegions: missing, levelType: pack.levelType, note: 'Vanilla servers do not report per-chunk completion; every region file the area touches was checked for presence.' });
      } catch (err) {
        if (child && child.exitCode == null) { try { child.stdin.write('stop\n'); } catch { /* closed */ } setTimeout(() => { if (child.exitCode == null) child.kill(); }, 30000); }
        say({ type: err.cancelled ? 'cancelled' : 'error', error: err.message, staging: stage });
      } finally { jobs.delete(jobId); }
    })();
    return { ok: true, jobId, batches: core.planForceload(a.area).length };
  };
  h.cancel = async (jobId) => { const j = jobs.get(jobId); if (j) j.abort(); return { ok: true, found: !!j }; };

  for (const action of Object.keys(core.ALLOWED)) {
    const ch = 'minecraft:' + action;
    ipcMain.removeHandler(ch);
    ipcMain.handle(ch, async (e, arg) => {
      try { core.validateRequest(action, arg); return await h[action](arg, e); }
      catch (err) { return { ok: false, error: err.message, cancelled: !!err.cancelled }; }
    });
  }
  app.on('before-quit', () => { for (const st of running.values()) { try { st.child.stdin.write('stop\n'); } catch { /* closed */ } } });
}

module.exports = { register };
