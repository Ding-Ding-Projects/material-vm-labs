// Plumbing tests for the System tools' main-process modules, run in plain Node with a fake ipcMain.
// They talk to stand-ins only: a local HTTP server that imitates Ollama's documented API on
// 127.0.0.1:11434, and a tiny Java program that imitates a server console. Neither is the real
// Ollama or a real Minecraft server; those were never run here.
// Run: node --test tests/system-suites-ipc.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

function fakeIpc() {
  const handlers = new Map();
  return { handlers, removeHandler: (ch) => handlers.delete(ch), handle: (ch, fn) => handlers.set(ch, fn) };
}
function fakeSender() { const events = []; return { events, sender: { send: (ch, d) => events.push({ ch, ...d }), isDestroyed: () => false } }; }
const until = async (fn, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); } throw new Error('timed out waiting'); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mvl-sys-'));
const app = { getPath: () => tmp, on: () => {} };

// ---------------- Ollama stand-in ----------------
let ollamaServer = null;
before(async () => {
  ollamaServer = http.createServer((req, res) => {
    let body = ''; req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const j = body ? JSON.parse(body) : {};
      const send = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url === '/api/version') return send({ version: '0.0.0-standin' });
      if (req.url === '/api/tags') return send({ models: [{ name: 'standin:1b', size: 1024 ** 3, digest: 'abc', modified_at: '2026-01-01T00:00:00Z', details: { parameter_size: '1.0B', quantization_level: 'Q4_0', family: 'standin' } }] });
      if (req.url === '/api/ps') return send({ models: [] });
      if (req.url === '/api/show') return send({ capabilities: ['completion'], details: { family: 'standin' }, parameters: 'stop "<x>"', template: '{{ .Prompt }}' });
      if (req.url === '/api/delete') return j.model === 'standin:1b' ? send({}) : (res.writeHead(404), res.end('{"error":"model not found"}'));
      if (req.url === '/api/generate') return send({ done: true });
      if (req.url === '/api/pull') {
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        let n = 0; const t = setInterval(() => { n++; if (res.destroyed) return clearInterval(t); res.write(JSON.stringify({ status: 'pulling abc', total: 100, completed: n * 10 }) + '\n'); if (n === (j.model === 'slow:1b' ? 1000 : 10)) { clearInterval(t); res.end(JSON.stringify({ status: 'success' }) + '\n'); } }, 10);
        return;
      }
      if (req.url === '/api/chat') {
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        for (const w of ['Hello', ' there']) res.write(JSON.stringify({ message: { role: 'assistant', content: w }, done: false }) + '\n');
        res.end(JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, eval_count: 2 }) + '\n');
        return;
      }
      res.writeHead(404); res.end();
    });
  });
  await new Promise((r, j) => { ollamaServer.once('error', j); ollamaServer.listen(11434, '127.0.0.1', r); }).catch(() => { ollamaServer = null; });
});
after(() => { if (ollamaServer) ollamaServer.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('ollama ipc against a local stand-in of the documented API', async (t) => {
  if (!ollamaServer) return t.skip('port 11434 is busy');
  const ipc = fakeIpc(); require('../companion/src/shared/ollama-ipc.js').register(ipc, app);
  const { events, sender } = fakeSender(); const call = (ch, a) => ipc.handlers.get(ch)({ sender }, a);
  const st = await call('ollama:status'); assert.equal(st.running, true); assert.equal(st.version, '0.0.0-standin');
  const list = await call('ollama:list'); assert.equal(list.models[0].name, 'standin:1b'); assert.ok(['Runs with limits', 'Unlikely'].includes(list.models[0].fit.verdict));
  assert.deepEqual((await call('ollama:show', 'standin:1b')).capabilities, ['completion']);
  assert.equal((await call('ollama:show', '../x')).ok, false);
  const p = await call('ollama:pull', 'standin:1b');
  await until(() => events.find((e) => e.id === p.id && e.type === 'done'));
  assert.ok(events.filter((e) => e.id === p.id && e.type === 'progress').length >= 5);
  const slow = await call('ollama:pull', 'slow:1b');
  await until(() => events.find((e) => e.id === slow.id && e.type === 'progress'));
  assert.equal((await call('ollama:cancel', slow.id)).found, true);
  await until(() => events.find((e) => e.id === slow.id && e.type === 'cancelled'));
  const c = await call('ollama:chat', { model: 'standin:1b', messages: [{ role: 'user', content: 'hi' }] });
  await until(() => events.find((e) => e.id === c.id && e.type === 'done'));
  assert.equal(events.filter((e) => e.id === c.id && e.type === 'token').map((e) => e.content).join(''), 'Hello there');
  assert.equal((await call('ollama:delete', 'missing:1b')).ok, false);
  assert.equal((await call('ollama:delete', 'standin:1b')).ok, true);
  assert.equal((await call('ollama:unload', 'standin:1b')).ok, true);
  ollamaServer.close(); ollamaServer = null; await new Promise((r) => setTimeout(r, 50));
  const down = await call('ollama:status'); assert.equal(down.running, false); assert.match(down.reason, /127\.0\.0\.1:11434|answer/);
});

// ---------------- Minecraft with a stand-in console ----------------
function buildStandinJar() {
  try { execFileSync('javac', ['-version'], { stdio: 'ignore' }); } catch { return null; }
  const dir = path.join(tmp, 'standin'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'Standin.java'), `import java.io.*;
public class Standin { public static void main(String[] a) throws Exception {
  System.out.println("[Server thread/INFO]: Starting stand-in server");
  System.out.println("[Server thread/INFO]: Done (0.1s)! For help, type \\"help\\"");
  BufferedReader r = new BufferedReader(new InputStreamReader(System.in)); String l;
  while ((l = r.readLine()) != null) { if (l.equals("stop")) { System.out.println("[Server thread/INFO]: Stopping the server"); System.exit(0); } System.out.println("[Server thread/INFO]: Unknown or incomplete command: " + l); }
} }`);
  execFileSync('javac', ['Standin.java'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'manifest.txt'), 'Main-Class: Standin\n');
  execFileSync('jar', ['cfm', 'server.jar', 'manifest.txt', 'Standin.class'], { cwd: dir });
  return path.join(dir, 'server.jar');
}

test('minecraft ipc: EULA gate, start, console, command, stop, properties and backup', { timeout: 60000 }, async (t) => {
  const jar = buildStandinJar(); if (!jar) return t.skip('no Java compiler here');
  const ipc = fakeIpc(); require('../companion/src/shared/minecraft-ipc.js').register(ipc, app);
  const { events, sender } = fakeSender(); const call = (ch, a) => ipc.handlers.get('minecraft:' + ch)({ sender }, a);
  assert.equal(ipc.handlers.has('minecraft:exec'), false);
  const id = 'standin-abc123'; const dir = path.join(tmp, 'minecraft', 'servers', id); fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(jar, path.join(dir, 'server.jar'));
  fs.writeFileSync(path.join(dir, 'mvl-server.json'), JSON.stringify({ id, name: 'Stand-in', flavour: 'vanilla', version: 'standin', javaMajor: null, jar: { digest: 'x' }, memMb: 512, javaPath: null }));
  assert.equal((await call('list')).servers.length, 1);
  const java = await call('java'); assert.ok(java.runtimes.length >= 1, 'a Java runtime is detected');
  const refused = await call('start', id); assert.equal(refused.ok, false); assert.match(refused.error, /EULA/);
  assert.equal((await call('acceptEula', { id })).ok, false, 'needs the person flag');
  assert.equal((await call('acceptEula', { id, personAccepted: true })).accepted, true);
  assert.equal((await call('eula', id)).accepted, true);
  const started = await call('start', id); assert.equal(started.ok, true, started.error);
  await until(() => events.find((e) => e.kind === 'console' && /Done \(/.test(e.line)));
  assert.equal((await call('command', { id, command: 'say hello' })).ok, true);
  await until(() => events.find((e) => e.kind === 'console' && /say hello/.test(e.line)));
  assert.equal((await call('command', { id, command: 'say a\nstop' })).ok, false);
  const stopped = await call('stop', id); assert.equal(stopped.stopped, true);
  assert.ok(events.find((e) => e.kind === 'state' && e.state === 'stopped'));
  const w = await call('writeProperties', { id, changes: { 'server-port': '25570', pvp: 'false' } }); assert.equal(w.ok, true);
  const r = await call('readProperties', id); assert.equal(r.values['server-port'], '25570'); assert.equal(r.values.pvp, 'false');
  assert.equal((await call('writeProperties', { id, changes: { 'server-port': 'abc' } })).ok, false);
  assert.match((await call('backup', id)).error, /no world folder/);
  fs.mkdirSync(path.join(dir, 'world', 'region'), { recursive: true }); fs.writeFileSync(path.join(dir, 'world', 'level.dat'), 'level'); fs.writeFileSync(path.join(dir, 'world', 'region', 'r.0.0.mca'), Buffer.alloc(8192, 7));
  const b = await call('backup', id); assert.equal(b.ok, true, b.error); assert.equal(b.files, 2); assert.ok(fs.existsSync(b.file));
  const gen = await call('generate', { id, area: { cx: 0, cz: 0, w: 2, d: 2 } }); assert.equal(gen.ok, false);
  const targets = await call('targets'); assert.equal(targets.targets.length, 4); assert.equal(targets.targets.find((x) => x.id === 'ssh').available, false);
});

test('vdisk ipc on a non-Windows host says it needs Windows and still previews scripts', async () => {
  const ipc = fakeIpc(); require('../companion/src/shared/vdisk-ipc.js').register(ipc, app);
  const call = (ch, a) => ipc.handlers.get(ch)({ sender: {} }, a);
  if (process.platform === 'win32') return;
  const p = await call('vdisk:probe'); assert.equal(p.unavailable, true); assert.match(p.error, /need Windows/);
  const r = await call('vdisk:run', { op: 'create', args: { path: 'D:\\a.vhdx', type: 'dynamic', sizeBytes: 1024 ** 3 } });
  assert.equal(r.unavailable, true); assert.match(r.equivalent.powershell, /New-VHD/);
  assert.equal((await call('vdisk:run', { op: 'format' })).ok, false);
  const pv = await call('vdisk:preview', { op: 'attach', args: { path: 'D:\\a.iso' } }); assert.equal(pv.admin, false);
});
