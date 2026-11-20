'use strict';
// Base64 same-folder conversion, main-process side. Encode writes <name>.base64.txt next to the
// source; decode writes the original file back next to the Base64 text with its name restored
// (name pattern first, then a data: MIME type, then a bounded byte-signature inspection, then .bin).
// Both stream in fixed-size chunks (constant memory), write to a hidden partial file in the same
// folder, verify a SHA-256 round trip, then publish with a hard link that fails instead of
// overwriting, so an existing file is never replaced. Pause, resume and cancel are per job.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const C = require('../../renderer/shared/tools/data-tools-core.js');

const CHUNK = 3 * 256 * 1024; // a multiple of 3 keeps the encoder carry empty between chunks
const jobs = new Map();
const written = new Set();

function bad(message) { const e = new Error(message); e.code = 'invalid-argument'; return e; }
function checkJobId(id) { if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw bad('Invalid job id.'); return id; }
function checkPath(p) {
  if (typeof p !== 'string' || !p || p.length > 4096 || p.includes('\0') || !path.isAbsolute(p)) throw bad('A full file path is required.');
  return path.normalize(p);
}
function checkOpts(o) {
  o = o && typeof o === 'object' ? o : {};
  const lineLength = Number.isInteger(o.lineLength) && o.lineLength >= 0 && o.lineLength <= 100000 ? o.lineLength : 0;
  return { alphabet: o.alphabet === 'url' ? 'url' : 'standard', pad: o.pad !== false, lineLength, eol: o.eol === '\n' ? '\n' : '\r\n', strict: o.strict === true };
}

function makeJob(id, sender) {
  if (jobs.has(id)) throw bad('That job id is already running.');
  const job = { id, paused: false, cancelled: false, wake: null, last: 0, sender };
  jobs.set(id, job);
  return job;
}
async function gate(job) {
  while (job.paused && !job.cancelled) await new Promise((r) => { job.wake = r; });
  if (job.cancelled) { const e = new Error('Cancelled.'); e.code = 'cancelled'; throw e; }
}
function progress(job, phase, done, total, force) {
  const now = Date.now();
  if (!force && now - job.last < 100) return;
  job.last = now;
  if (!job.sender.isDestroyed()) job.sender.send('base64:progress', { jobId: job.id, phase, done, total });
}

async function readChunks(file, onChunk, job, phase) {
  const fh = await fsp.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const buf = Buffer.allocUnsafe(CHUNK);
    let pos = 0;
    for (;;) {
      await gate(job);
      const { bytesRead } = await fh.read(buf, 0, CHUNK, pos);
      if (!bytesRead) break;
      await onChunk(buf.subarray(0, bytesRead));
      pos += bytesRead;
      progress(job, phase, pos, size);
    }
    progress(job, phase, pos, size, true);
    return size;
  } finally { await fh.close(); }
}

// Publishes tmp under the first free name in dir; a hard link never replaces an existing file.
async function publish(tmp, dir, wanted) {
  for (let n = 0; n < 100000; n++) {
    const name = n ? C.numberedName(wanted, n) : wanted;
    const dest = path.join(dir, name);
    if (fs.existsSync(dest)) continue;
    try { await fsp.link(tmp, dest); }
    catch (e) {
      if (e.code === 'EEXIST') continue;
      if (e.code === 'EPERM' || e.code === 'ENOTSUP' || e.code === 'EXDEV' || e.code === 'ENOSYS') { // file systems without hard links
        try { await fsp.copyFile(tmp, dest, fs.constants.COPYFILE_EXCL); } catch (c) { if (c.code === 'EEXIST') continue; throw c; }
      } else throw e;
    }
    await fsp.unlink(tmp).catch(() => {});
    written.add(dest);
    return { path: dest, name };
  }
  throw new Error('No free name was found next to the source.');
}

const tmpName = (dir, wanted) => path.join(dir, `.${wanted}.${crypto.randomBytes(4).toString('hex')}.partial`);

async function encodeBeside(job, src, opts) {
  const st = await fsp.stat(src);
  if (!st.isFile()) throw bad('That is not a file.');
  const dir = path.dirname(src); const wanted = C.base64NameFor(path.basename(src));
  const tmp = tmpName(dir, wanted);
  const out = await fsp.open(tmp, 'wx');
  const srcHash = crypto.createHash('sha256');
  try {
    const enc = C.createEncoder(opts);
    await readChunks(src, async (chunk) => { srcHash.update(chunk); const s = enc.push(chunk); if (s) await out.write(s, null, 'latin1'); }, job, 'encode');
    const tail = enc.end(); if (tail) await out.write(tail, null, 'latin1');
    await out.sync(); await out.close();
    // Round trip: decode what was written, in chunks, and compare its SHA-256 with the source's.
    const dec = C.createDecoder(Object.assign({}, opts, { strict: true }));
    const back = crypto.createHash('sha256'); let outSize = 0;
    if (st.size) {
      outSize = await readChunks(tmp, async (chunk) => { back.update(dec.push(chunk.toString('latin1'))); }, job, 'verify');
      back.update(dec.end());
    }
    const a = srcHash.digest('hex'), b = back.digest('hex');
    if (a !== b) throw Object.assign(new Error('The SHA-256 round trip did not match; nothing was kept.'), { code: 'verify-failed' });
    await gate(job);
    const pub = await publish(tmp, dir, wanted);
    return { ok: true, direction: 'encode', path: pub.path, name: pub.name, bytesIn: st.size, bytesOut: outSize, sha256: a, verified: true };
  } catch (e) { await out.close().catch(() => {}); await fsp.unlink(tmp).catch(() => {}); throw e; }
}

async function decodeBeside(job, src, opts) {
  const st = await fsp.stat(src);
  if (!st.isFile()) throw bad('That is not a file.');
  const dir = path.dirname(src); const base = path.basename(src);
  const tmp = tmpName(dir, base + '.decoded');
  const out = await fsp.open(tmp, 'wx');
  const h = crypto.createHash('sha256');
  const normIn = crypto.createHash('sha256');
  let head = Buffer.alloc(0), mime = '', first = true, offsetBase = 0, outBytes = 0;
  try {
    const dec = C.createDecoder(opts);
    const onBytes = async (b) => { if (!b.length) return; if (head.length < C.SNIFF_BYTES) head = Buffer.concat([head, Buffer.from(b.subarray(0, C.SNIFF_BYTES - head.length))]); h.update(b); outBytes += b.length; await out.write(b); };
    const norm = (s) => s.replace(/[\s=]/g, '').replace(/-/g, '+').replace(/_/g, '/');
    await readChunks(src, async (chunk) => {
      let s = chunk.toString('latin1');
      if (first) {
        first = false;
        s = s.replace(/^﻿|^\xEF\xBB\xBF/, '');
        const lead = s.replace(/^\s+/, '');
        if (/^data:/i.test(lead)) {
          const comma = lead.indexOf(',');
          if (comma < 0 || comma > 1024) throw Object.assign(new Error('The data: URL header is missing its comma.'), { code: 'not-data-url' });
          const meta = lead.slice(5, comma).split(';');
          if (meta[meta.length - 1].toLowerCase() !== 'base64') throw Object.assign(new Error('This data: URL is not Base64 encoded.'), { code: 'not-data-url' });
          mime = meta[0].toLowerCase();
          offsetBase += s.length - lead.length + comma + 1;
          s = lead.slice(comma + 1);
        }
      }
      normIn.update(norm(s));
      try { await onBytes(dec.push(s)); }
      catch (e) { if (e instanceof C.CodecError && e.offset >= 0) { e.offset += offsetBase; e.message = e.message.replace(/offset (\d+)/, (m, n) => 'offset ' + (Number(n) + offsetBase)); } throw e; }
    }, job, 'decode');
    try { await onBytes(dec.end()); } catch (e) { if (e instanceof C.CodecError && e.offset >= 0) { e.offset += offsetBase; e.message = e.message.replace(/offset (\d+)/, (m, n) => 'offset ' + (Number(n) + offsetBase)); } throw e; }
    await out.sync(); await out.close();
    // Verify: the written file hashes the same as the decoded stream, and re-encoding it gives back
    // exactly the input's Base64 characters.
    const reread = crypto.createHash('sha256'); const reenc = crypto.createHash('sha256');
    const enc = C.createEncoder({ alphabet: 'standard', pad: false });
    await readChunks(tmp, async (chunk) => { reread.update(chunk); reenc.update(enc.push(chunk)); }, job, 'verify');
    reenc.update(enc.end());
    const a = h.digest('hex');
    if (reread.digest('hex') !== a) throw Object.assign(new Error('The written file does not match the decoded bytes; nothing was kept.'), { code: 'verify-failed' });
    if (reenc.digest('hex') !== normIn.digest('hex')) throw Object.assign(new Error('Re-encoding the result does not reproduce the input (its last character has non-zero unused bits); nothing was kept.'), { code: 'verify-failed' });
    const detected = C.detectType(new Uint8Array(head), '');
    let wanted = C.restoreName(base), source = 'name';
    if (!wanted) {
      const stem = base.replace(/\.(txt|b64|base64)$/i, '') || 'decoded';
      if (mime && C.extForMime(mime) !== 'bin') { wanted = stem + '.' + C.extForMime(mime); source = 'data-url'; }
      else if (detected.id !== 'binary' && detected.id !== 'empty') { wanted = stem + '.' + detected.ext; source = 'signature'; }
      else { wanted = stem + '.bin'; source = 'fallback'; }
    }
    await gate(job);
    const pub = await publish(tmp, dir, C.safeFileName(wanted));
    return { ok: true, direction: 'decode', path: pub.path, name: pub.name, nameSource: source, bytesIn: st.size, bytesOut: outBytes, sha256: a, verified: true, detected: { id: detected.id, label: detected.label, mime: detected.mime } };
  } catch (e) { await out.close().catch(() => {}); await fsp.unlink(tmp).catch(() => {}); throw e; }
}

function failure(e) {
  if (e && e.code === 'cancelled') return { ok: false, cancelled: true, code: 'cancelled', message: 'Cancelled. Nothing was written.' };
  return { ok: false, code: (e && e.code) || 'error', offset: e && Number.isInteger(e.offset) ? e.offset : -1, message: (e && e.message) || 'The conversion failed.' };
}

function register(ipcMain) {
  const run = (fn) => async (event, jobId, filePath, opts) => {
    let job;
    try { job = makeJob(checkJobId(jobId), event.sender); return await fn(job, checkPath(filePath), checkOpts(opts)); }
    catch (e) { return failure(e); }
    finally { if (job) jobs.delete(job.id); }
  };
  ipcMain.handle('base64:encode-beside', run(encodeBeside));
  ipcMain.handle('base64:decode-beside', run(decodeBeside));
  ipcMain.handle('base64:control', (_e, jobId, action) => {
    const job = typeof jobId === 'string' && jobs.get(jobId);
    if (!job || !['pause', 'resume', 'cancel'].includes(action)) return false;
    if (action === 'pause') job.paused = true;
    else { if (action === 'cancel') job.cancelled = true; job.paused = false; if (job.wake) { job.wake(); job.wake = null; } }
    return true;
  });
  ipcMain.handle('base64:pick', async (event) => {
    const { dialog, BrowserWindow } = require('electron');
    const win = BrowserWindow.fromWebContents(event.sender);
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
    return r.canceled ? [] : r.filePaths;
  });
  ipcMain.handle('base64:show', (_e, p) => {
    if (typeof p !== 'string' || !written.has(p)) return false; // only files this toolkit wrote
    require('electron').shell.showItemInFolder(p);
    return true;
  });
}

module.exports = { register, encodeBeside, decodeBeside, _makeJob: makeJob, _jobs: jobs };
