// Same-folder Base64 conversion (companion/src/shared/base64-ipc.js) against a real temporary folder.
// Run: node tests/data-tools-ipc.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ipc = require('../companion/src/shared/base64-ipc.js');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const sender = { sent: [], isDestroyed: () => false, send(ch, d) { this.sent.push([ch, d]); } };
let n = 0;
const job = () => ipc._makeJob('t' + (n++), sender);
const done = (j) => ipc._jobs.delete(j.id);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mvl-b64-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

test('encode writes name.ext.base64.txt beside the source, verified, and never overwrites', async () => {
  const src = path.join(tmp, 'report.pdf');
  const bytes = Buffer.concat([Buffer.from('%PDF-1.7\n'), randomBytes(2 * 1024 * 1024 + 1)]);
  fs.writeFileSync(src, bytes);
  let j = job();
  const r1 = await ipc.encodeBeside(j, src, { lineLength: 76 }); done(j);
  assert.equal(r1.ok, true); assert.equal(r1.name, 'report.pdf.base64.txt'); assert.equal(r1.sha256, sha(bytes));
  const text = fs.readFileSync(r1.path, 'latin1');
  assert.equal(text.replace(/\r\n/g, ''), bytes.toString('base64'));
  assert.ok(text.split('\r\n').slice(0, -1).every((l) => l.length === 76));
  j = job();
  const r2 = await ipc.encodeBeside(j, src, {}); done(j);
  assert.equal(r2.name, 'report.pdf (1).base64.txt');
  assert.equal(fs.readFileSync(r1.path, 'latin1'), text, 'the first output is untouched');
  assert.deepEqual(fs.readdirSync(tmp).filter((f) => f.endsWith('.partial')), []);
  assert.ok(sender.sent.some(([ch, d]) => ch === 'base64:progress' && d.phase === 'verify'));
});

test('decode restores the original name and extension, numbered on a clash, byte-identical', async () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'd-'));
  const bytes = randomBytes(100000);
  fs.writeFileSync(path.join(dir, 'photo.png'), Buffer.from('existing'));
  fs.writeFileSync(path.join(dir, 'photo.png.base64.txt'), bytes.toString('base64').replace(/(.{76})/g, '$1\r\n'));
  const j = job();
  const r = await ipc.decodeBeside(j, path.join(dir, 'photo.png.base64.txt'), { strict: false }); done(j);
  assert.equal(r.ok, true); assert.equal(r.name, 'photo (1).png'); assert.equal(r.nameSource, 'name');
  assert.deepEqual(fs.readFileSync(r.path), bytes);
  assert.equal(fs.readFileSync(path.join(dir, 'photo.png'), 'utf8'), 'existing');
});

test('decode falls back to a data: MIME type, then byte signatures, then .bin', async () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'f-'));
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), randomBytes(64)]);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'data:application/pdf;base64,' + Buffer.from('%PDF-x').toString('base64'));
  fs.writeFileSync(path.join(dir, 'b.txt'), png.toString('base64'));
  fs.writeFileSync(path.join(dir, 'c.b64'), Buffer.from([0, 1, 2, 3, 250]).toString('base64'));
  const out = {};
  for (const f of ['a.txt', 'b.txt', 'c.b64']) { const j = job(); out[f] = await ipc.decodeBeside(j, path.join(dir, f), {}); done(j); }
  assert.equal(out['a.txt'].name, 'a.pdf'); assert.equal(out['a.txt'].nameSource, 'data-url');
  assert.equal(out['b.txt'].name, 'b.png'); assert.equal(out['b.txt'].nameSource, 'signature');
  assert.equal(out['c.b64'].name, 'c.bin'); assert.equal(out['c.b64'].nameSource, 'fallback');
});

test('a strict decode failure reports the offset and leaves nothing behind', async () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'e-'));
  fs.writeFileSync(path.join(dir, 'x.bin.base64.txt'), 'QUJD\r\nRU*H');
  const j = job();
  await assert.rejects(ipc.decodeBeside(j, path.join(dir, 'x.bin.base64.txt'), { strict: true }), (e) => e.code === 'invalid-char' && e.offset === 8); done(j);
  assert.deepEqual(fs.readdirSync(dir), ['x.bin.base64.txt']);
});

test('cancel removes the partial file and reports cancellation', async () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'c-'));
  fs.writeFileSync(path.join(dir, 'big.bin'), randomBytes(8 * 1024 * 1024));
  const j = job();
  j.paused = true;
  const p = ipc.encodeBeside(j, path.join(dir, 'big.bin'), {});
  setTimeout(() => { j.cancelled = true; j.paused = false; if (j.wake) j.wake(); }, 50);
  await assert.rejects(p, (e) => e.code === 'cancelled'); done(j);
  assert.deepEqual(fs.readdirSync(dir), ['big.bin']);
});
