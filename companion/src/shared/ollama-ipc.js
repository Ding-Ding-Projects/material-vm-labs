'use strict';
// Local Ollama manager, main-process side. Only this file talks to Ollama, and only to the fixed
// loopback endpoint http://127.0.0.1:11434 through the documented API paths listed in ROUTES.
// Streaming pulls and chats report back on the 'ollama:event' channel and can be cancelled.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const core = require('./ollama-core');

const ROUTES = Object.freeze({
  version: ['GET', '/api/version'], tags: ['GET', '/api/tags'], ps: ['GET', '/api/ps'],
  show: ['POST', '/api/show'], pull: ['POST', '/api/pull'], delete: ['DELETE', '/api/delete'],
  copy: ['POST', '/api/copy'], chat: ['POST', '/api/chat'], generate: ['POST', '/api/generate'],
});

function request(route, body, opts = {}) {
  const [method, p] = ROUTES[route];
  return new Promise((resolve, reject) => {
    const data = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({ host: core.BASE.host, port: core.BASE.port, path: p, method, timeout: opts.timeout != null ? opts.timeout : 10000,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {} }, (res) => {
      if (opts.onChunk) {
        if (res.statusCode !== 200) { let t = ''; res.on('data', (c) => { if (t.length < 4096) t += c; }); res.on('end', () => reject(new Error(errText(res.statusCode, t)))); return; }
        res.setEncoding('utf8'); res.on('data', opts.onChunk); res.on('end', () => resolve({ status: res.statusCode })); res.on('error', reject);
        return;
      }
      const chunks = []; let size = 0;
      res.on('data', (c) => { size += c.length; if (size > core.LIMITS.response) { req.destroy(new Error('Ollama sent more than 8 MB.')); return; } chunks.push(c); });
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) return reject(new Error(errText(res.statusCode, text)));
        if (!text.trim()) return resolve({});
        try { resolve(JSON.parse(text)); } catch { reject(new Error('Ollama answered with something that is not JSON.')); }
      });
    });
    if (opts.signal) opts.signal.addEventListener('abort', () => req.destroy(Object.assign(new Error('Cancelled.'), { cancelled: true })), { once: true });
    req.on('timeout', () => { if (opts.timeout !== 0) req.destroy(new Error('Ollama did not answer in time.')); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
function errText(code, text) { let m = ''; try { m = JSON.parse(text).error || ''; } catch { m = String(text || '').slice(0, 300); } return `Ollama answered ${code}${m ? ': ' + m : ''}`; }

function installedExe() {
  const cands = [];
  if (process.platform === 'win32') {
    const la = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    cands.push(path.join(la, 'Programs', 'Ollama', 'ollama app.exe'), path.join(la, 'Programs', 'Ollama', 'ollama.exe'));
  } else if (process.platform === 'darwin') cands.push('/Applications/Ollama.app/Contents/Resources/ollama', '/usr/local/bin/ollama');
  else cands.push('/usr/local/bin/ollama', '/usr/bin/ollama');
  for (const c of cands) { try { if (fs.statSync(c).isFile()) return c; } catch { /* not there */ } }
  return null;
}

function modelsDir() { return process.env.OLLAMA_MODELS || path.join(os.homedir(), '.ollama', 'models'); }
function freeDisk(dir) {
  let d = dir;
  for (let i = 0; i < 6 && d; i++) { try { const s = fs.statfsSync(d); return s.bavail * s.bsize; } catch { d = path.dirname(d); } }
  return null;
}
function sysFacts() { return { totalRam: os.totalmem(), freeRam: os.freemem(), cpus: os.cpus().length, arch: process.arch, platform: process.platform, vram: null, freeDisk: freeDisk(modelsDir()), modelsDir: modelsDir() }; }

function register(ipcMain, app) {
  let shell = null;
  try { ({ shell } = require('electron')); } catch { /* tests run without Electron */ }
  const jobs = new Map();
  let nextId = 1;
  const settings = { contextOverheadBytes: 1024 ** 3 };
  const send = (wc, d) => { try { if (!wc.isDestroyed()) wc.send('ollama:event', d); } catch { /* window gone */ } };
  const handle = (ch, fn) => { ipcMain.removeHandler(ch); ipcMain.handle(ch, async (e, arg) => { try { return await fn(e, arg); } catch (err) { return { ok: false, error: err.message, cancelled: !!err.cancelled }; } }); };

  handle('ollama:status', async () => {
    const exe = installedExe();
    try { const v = await request('version', null, { timeout: 2500 }); return { ok: true, running: true, version: v.version || 'unknown', installed: !!exe, exe, platform: process.platform }; }
    catch (err) { return { ok: true, running: false, installed: !!exe, exe, platform: process.platform, reason: /ECONNREFUSED/.test(err.message) ? 'Nothing is listening on 127.0.0.1:11434.' : err.message }; }
  });
  handle('ollama:system', async () => ({ ok: true, ...sysFacts(), settings }));
  handle('ollama:setOverhead', async (_e, gb) => {
    const n = Number(gb); if (!Number.isFinite(n) || n < 0 || n > 64) throw new Error('Overhead must be 0 to 64 GB.');
    settings.contextOverheadBytes = Math.round(n * 1024 ** 3); return { ok: true, settings };
  });
  handle('ollama:list', async () => {
    const [t, p] = await Promise.all([request('tags'), request('ps').catch(() => ({ models: [] }))]);
    const sys = sysFacts();
    const running = new Map((p.models || []).map((m) => [m.name, m]));
    const models = (t.models || []).slice(0, 5000).map((m) => ({ name: String(m.name), size: Number(m.size) || 0, digest: String(m.digest || ''), modified: String(m.modified_at || ''), details: m.details || {}, running: running.has(m.name), fit: core.fitVerdict(m, sys, settings) }));
    return { ok: true, models, sys };
  });
  handle('ollama:ps', async () => { const p = await request('ps'); return { ok: true, models: (p.models || []).map((m) => ({ name: m.name, size: m.size, sizeVram: m.size_vram, expires: m.expires_at, details: m.details || {} })) }; });
  handle('ollama:show', async (_e, model) => {
    if (!core.validModel(model)) throw new Error('That is not a valid model name.');
    const s = await request('show', { model });
    return { ok: true, model, capabilities: Array.isArray(s.capabilities) ? s.capabilities : null, details: s.details || {}, parameters: String(s.parameters || ''), template: String(s.template || '').slice(0, 20000), license: String(s.license || '').slice(0, 20000), modelInfo: s.model_info || {}, modified: s.modified_at || '' };
  });
  handle('ollama:delete', async (_e, model) => { if (!core.validModel(model)) throw new Error('That is not a valid model name.'); await request('delete', { model }); return { ok: true }; });
  handle('ollama:copy', async (_e, a) => {
    if (!a || !core.validModel(a.source) || !core.validModel(a.destination)) throw new Error('Both names must be valid model names.');
    await request('copy', { source: a.source, destination: a.destination }); return { ok: true };
  });
  handle('ollama:unload', async (_e, model) => { if (!core.validModel(model)) throw new Error('That is not a valid model name.'); await request('generate', { model, keep_alive: 0 }); return { ok: true }; });

  function stream(e, route, body, kind, onObj) {
    const id = String(nextId++);
    const ac = new AbortController();
    let failed = false;
    jobs.set(id, ac);
    const split = core.makeLineSplitter((o) => { if (o.error) throw new Error(o.error); onObj(id, o); });
    request(route, body, { timeout: 0, signal: ac.signal, onChunk: (c) => { try { split.push(c); } catch (err) { failed = true; ac.abort(); send(e.sender, { id, kind, type: 'error', error: err.message }); } } })
      .then(() => { split.end(); send(e.sender, { id, kind, type: 'done' }); })
      .catch((err) => { if (!failed) send(e.sender, { id, kind, type: ac.signal.aborted ? 'cancelled' : 'error', error: err.message }); })
      .finally(() => jobs.delete(id));
    return { ok: true, id };
  }
  handle('ollama:pull', async (e, model) => {
    if (!core.validModel(model)) throw new Error('That is not a valid model name.');
    return stream(e, 'pull', { model, stream: true }, 'pull', (id, o) => send(e.sender, { id, kind: 'pull', type: 'progress', model, status: String(o.status || ''), total: Number(o.total) || 0, completed: Number(o.completed) || 0, digest: String(o.digest || '') }));
  });
  handle('ollama:chat', async (e, req) => {
    const body = core.validateChat(req);
    return stream(e, 'chat', body, 'chat', (id, o) => send(e.sender, { id, kind: 'chat', type: o.done ? 'stats' : 'token', content: (o.message && typeof o.message.content === 'string') ? o.message.content : '', evalCount: o.eval_count, evalDuration: o.eval_duration, totalDuration: o.total_duration, doneReason: o.done_reason }));
  });
  handle('ollama:cancel', async (_e, id) => { const j = jobs.get(String(id)); if (j) j.abort(); return { ok: true, found: !!j }; });

  handle('ollama:start', async () => {
    const exe = installedExe();
    if (!exe) return { ok: false, error: 'Ollama is not installed in its usual place on this computer.' };
    const args = path.basename(exe).toLowerCase() === 'ollama app.exe' ? [] : ['serve'];
    const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => { /* reported through the health check below */ });
    child.unref();
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 750));
      try { const v = await request('version', null, { timeout: 1500 }); return { ok: true, version: v.version }; } catch { /* keep waiting */ }
    }
    return { ok: false, error: 'Ollama was started but did not answer on 127.0.0.1:11434 within 15 seconds.' };
  });
  handle('ollama:openDownload', async () => { if (shell) await shell.openExternal(core.DOWNLOAD_PAGE); return { ok: !!shell, url: core.DOWNLOAD_PAGE }; });
}

module.exports = { register, ROUTES };
