// Plain node tests for the data tools core (Base64 toolkit and file converter).
// Run: node tests/data-tools.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';

const require = createRequire(import.meta.url);
const C = require('../companion/renderer/shared/tools/data-tools-core.js');
const te = (s) => new TextEncoder().encode(s);

test('Base64 matches Node for every length and both alphabets, with and without padding', () => {
  for (let len = 0; len < 70; len++) {
    const b = randomBytes(len);
    assert.equal(C.encodeBase64(b), b.toString('base64'));
    assert.equal(C.encodeBase64(b, { alphabet: 'url', pad: false }), b.toString('base64url'));
    assert.equal(C.encodeBase64(b, { alphabet: 'url', pad: true }), b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_'));
    assert.equal(C.encodeBase64(b, { pad: false }), b.toString('base64').replace(/=+$/, ''));
  }
});

test('padding round trip: every variant and option decodes back to the same bytes (red if padding regresses)', () => {
  // This is the regression guard: lengths 1 and 2 mod 3 produce "==" and "=". If the encoder drops or
  // adds padding wrongly, strict decoding with padding on fails or the bytes differ.
  for (let len = 0; len < 40; len++) {
    const b = randomBytes(len);
    for (const alphabet of ['standard', 'url']) for (const pad of [true, false]) for (const lineLength of [0, 76, 4, 7]) {
      const opts = { alphabet, pad, lineLength };
      const enc = C.encodeBase64(b, opts);
      if (len === 0) { assert.equal(enc, ''); continue; }
      const padCount = (enc.match(/=/g) || []).length;
      assert.equal(padCount, pad ? (3 - (len % 3)) % 3 : 0, `padding count for len ${len} ${JSON.stringify(opts)}`);
      assert.deepEqual(Buffer.from(C.decodeBase64(enc, { alphabet, pad, strict: true })), b, `strict ${len} ${JSON.stringify(opts)}`);
      assert.deepEqual(Buffer.from(C.decodeBase64(enc, { alphabet, strict: false })), b, `lenient ${len} ${JSON.stringify(opts)}`);
    }
  }
  assert.equal(C.encodeBase64(te('f')), 'Zg==');
  assert.equal(C.encodeBase64(te('fo')), 'Zm8=');
  assert.equal(C.encodeBase64(te('foo')), 'Zm9v');
});

test('MIME wrapping is 76 characters with CRLF, and custom lengths work', () => {
  const b = randomBytes(300);
  const enc = C.encodeBase64(b, { lineLength: C.MIME_LINE });
  const lines = enc.split('\r\n');
  assert.ok(lines.slice(0, -1).every((l) => l.length === 76));
  assert.ok(lines.at(-1).length <= 76 && !enc.endsWith('\r\n'));
  assert.equal(lines.join(''), b.toString('base64'));
  const custom = C.encodeBase64(b, { lineLength: 10, eol: '\n' });
  assert.ok(custom.split('\n').slice(0, -1).every((l) => l.length === 10));
});

test('chunked streaming encode and decode equal one-shot output', () => {
  const b = randomBytes(10007);
  for (const opts of [{}, { lineLength: 76 }, { alphabet: 'url', pad: false, lineLength: 13 }]) {
    const e = C.createEncoder(opts); let out = '';
    for (let i = 0; i < b.length;) { const n = 1 + ((i * 7) % 997); out += e.push(b.subarray(i, i + n)); i += n; }
    out += e.end();
    assert.equal(out, C.encodeBase64(b, opts));
    const d = C.createDecoder(Object.assign({ strict: true }, opts)); const parts = [];
    for (let i = 0; i < out.length;) { const n = 1 + ((i * 13) % 501); parts.push(d.push(out.slice(i, i + n))); i += n; }
    parts.push(d.end());
    assert.deepEqual(Buffer.from(C.concatBytes(parts)), b);
  }
});

test('strict decoding reports the exact offset of the first bad character', () => {
  let r = C.tryDecodeBase64('QUJD$EVG', { strict: true });
  assert.equal(r.ok, false); assert.equal(r.code, 'invalid-char'); assert.equal(r.offset, 4);
  r = C.tryDecodeBase64('QUJD RUZH', { strict: true });
  assert.equal(r.code, 'invalid-char'); assert.equal(r.offset, 4);
  r = C.tryDecodeBase64('ab-_', { strict: true, alphabet: 'standard' });
  assert.equal(r.code, 'invalid-char'); assert.equal(r.offset, 2);
  r = C.tryDecodeBase64('ab+/', { strict: true, alphabet: 'url' });
  assert.equal(r.offset, 2);
  r = C.tryDecodeBase64('QQ', { strict: true, pad: true });
  assert.equal(r.code, 'padding-missing');
  r = C.tryDecodeBase64('QQ==', { strict: true, pad: false });
  assert.equal(r.code, 'padding-unexpected'); assert.equal(r.offset, 2);
  r = C.tryDecodeBase64('QQ==QQ==', { strict: true });
  assert.equal(r.code, 'padding-misplaced'); assert.equal(r.offset, 4);
  r = C.tryDecodeBase64('QUJDR', { strict: true });
  assert.equal(r.code, 'truncated'); assert.equal(r.offset, 4);
  r = C.tryDecodeBase64('QR==', { strict: true });
  assert.equal(r.code, 'trailing-bits');
  r = C.tryDecodeBase64('', { strict: true });
  assert.equal(r.code, 'empty');
  // Multi-line input keeps absolute offsets.
  r = C.tryDecodeBase64('QUJD\r\nRU*H', { strict: true });
  assert.equal(r.offset, 8);
});

test('lenient decoding ignores whitespace, mixes alphabets and accepts missing padding', () => {
  assert.equal(Buffer.from(C.decodeBase64(' Zm9v\n YmE ', { strict: false })).toString(), 'fooba');
  assert.deepEqual(Buffer.from(C.decodeBase64('-_+/', { strict: false })), Buffer.from('+/+/', 'base64'));
  const r = C.tryDecodeBase64('Zm9v!', { strict: false });
  assert.equal(r.ok, false); assert.equal(r.offset, 4);
});

test('text encodings round trip with correct byte counts', () => {
  const s = 'Caf\u00e9 \u4f60\u597d \ud83d\ude00';
  assert.equal(C.encodeText(s, 'utf-8').length, Buffer.byteLength(s, 'utf8'));
  assert.equal(C.encodeText(s, 'utf-16le').length, s.length * 2);
  assert.deepEqual(Buffer.from(C.encodeText(s, 'utf-16le')), Buffer.from(s, 'utf16le'));
  const be = C.encodeText(s, 'utf-16be');
  assert.equal(be[0], 0x00); assert.equal(be[1], 0x43);
  for (const enc of ['utf-8', 'utf-16le', 'utf-16be']) assert.equal(C.decodeText(C.encodeText(s, enc), enc), s);
  assert.equal(C.decodeText(C.encodeText('Caf\u00e9', 'latin1'), 'latin1'), 'Caf\u00e9');
  assert.equal(C.encodeText('Caf\u00e9', 'latin1').length, 4);
  assert.throws(() => C.encodeText('a\u4f60', 'latin1'), (e) => e.code === 'unencodable' && e.offset === 1);
  assert.throws(() => C.decodeText(Uint8Array.of(0x61, 0xC3), 'utf-8'), (e) => e.code === 'invalid-text' && e.offset === 1);
  assert.throws(() => C.decodeText(Uint8Array.of(0x61), 'utf-16le'), (e) => e.code === 'invalid-text');
  assert.throws(() => C.encodeText('x', 'ebcdic'), (e) => e.code === 'unsupported-encoding');
  assert.equal(C.utf8InvalidAt(Uint8Array.of(0xED, 0xA0, 0x80)), 0); // surrogate in UTF-8
});

test('data URLs build and parse with MIME type, parameters and bytes', () => {
  const bytes = te('hello, world');
  const url = C.buildDataUrl(bytes, 'text/plain', { charset: 'utf-8' });
  assert.equal(url, 'data:text/plain;charset=utf-8;base64,' + Buffer.from(bytes).toString('base64'));
  const p = C.parseDataUrl(url);
  assert.equal(p.mime, 'text/plain'); assert.equal(p.params.charset, 'utf-8'); assert.equal(p.base64, true);
  assert.deepEqual(Buffer.from(p.bytes), Buffer.from(bytes));
  const q = C.parseDataUrl('data:,A%20brief%20note');
  assert.equal(q.mime, 'text/plain'); assert.equal(q.params.charset, 'US-ASCII'); assert.equal(Buffer.from(q.bytes).toString(), 'A brief note');
  assert.throws(() => C.parseDataUrl('hello'), (e) => e.code === 'not-data-url');
  assert.throws(() => C.parseDataUrl('data:image/png;base64,iVB*Rw'), (e) => e.code === 'invalid-char' && e.offset === 25);
});

test('incremental SHA-256 matches Node across chunk boundaries', () => {
  for (const len of [0, 1, 55, 56, 63, 64, 65, 1000, 100003]) {
    const b = randomBytes(len);
    const h = C.createSha256();
    for (let i = 0; i < len; i += 37) h.update(b.subarray(i, i + 37));
    assert.equal(h.hex(), createHash('sha256').update(b).digest('hex'));
  }
});

test('type detection uses bytes first and names only to refine text', () => {
  const png = Uint8Array.of(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0);
  assert.equal(C.detectType(png, 'photo.txt').id, 'png');
  assert.equal(C.detectType(te('%PDF-1.7\n'), 'x.bin').id, 'pdf');
  assert.equal(C.detectType(Uint8Array.of(0x50, 0x4B, 3, 4, 0, 0), 'a.zip').id, 'zip');
  assert.equal(C.detectType(te('{"a":1}'), 'a.bin').id, 'json');
  assert.equal(C.detectType(te('a,b\n1,2\n'), 'table.csv').id, 'csv');
  assert.equal(C.detectType(te('a,b\n1,2\n'), 'table.txt').id, 'text');
  assert.equal(C.detectType(te('<?xml version="1.0"?><a/>'), 'x').id, 'xml');
  assert.equal(C.detectType(te('<svg xmlns="x"></svg>'), 'x').id, 'svg');
  assert.equal(C.detectType(Uint8Array.of(0, 1, 2, 3, 0xFF), 'x').id, 'binary');
  assert.equal(C.detectType(new Uint8Array(0), 'x').id, 'empty');
  assert.equal(C.detectType(te('MZ\x90\x00'), 'setup.png').id, 'exe');
  // bounded: a huge buffer is inspected only up to SNIFF_BYTES
  const big = new Uint8Array(5 * 1024 * 1024).fill(0x61);
  assert.equal(C.detectType(big, 'x').id, 'text');
});

test('names: base64 suffix, restore, numbered names before the extension, never overwrite', () => {
  assert.equal(C.base64NameFor('report.pdf'), 'report.pdf.base64.txt');
  assert.equal(C.restoreName('report.pdf.base64.txt'), 'report.pdf');
  assert.equal(C.restoreName('photo.png.b64'), 'photo.png');
  assert.equal(C.restoreName('notes.txt'), null);
  assert.equal(C.numberedName('report.pdf', 1), 'report (1).pdf');
  assert.equal(C.numberedName('report.pdf.base64.txt', 2), 'report.pdf (2).base64.txt');
  assert.equal(C.numberedName('Makefile', 1), 'Makefile (1)');
  const taken = new Set(['report.pdf', 'report (1).pdf']);
  assert.equal(C.uniqueName('report.pdf', (n) => taken.has(n)), 'report (2).pdf');
  assert.equal(C.safeFileName('..\\..\\evil<>.txt'), 'evil__.txt');
});

test('line endings, hex and binary text round trip with offsets on bad input', () => {
  const t = 'a\r\nb\nc\rd';
  assert.deepEqual(C.countLineEndings(t), { crlf: 1, lf: 1, cr: 1 });
  assert.equal(C.convertLineEndings(t, 'crlf'), 'a\r\nb\r\nc\r\nd');
  assert.equal(C.convertLineEndings(t, 'lf'), 'a\nb\nc\nd');
  const b = randomBytes(33);
  assert.deepEqual(Buffer.from(C.fromHex(C.toHex(b, { sep: ' ', lineBytes: 16 }))), b);
  assert.deepEqual(Buffer.from(C.fromHex('0xDE ad:BE,ef')), Buffer.from('deadbeef', 'hex'));
  assert.throws(() => C.fromHex('abz1'), (e) => e.offset === 2);
  assert.throws(() => C.fromHex('abc'), (e) => e.code === 'truncated');
  assert.deepEqual(Buffer.from(C.fromBinaryText(C.toBinaryText(b))), b);
  assert.throws(() => C.fromBinaryText('0101 012'), (e) => e.offset === 7);
});

test('CSV and TSV parse quoted fields and convert to and from JSON', () => {
  const csv = 'name,note\r\n"Smith, J","said ""hi""\nthen left"\r\nLee,\r\n';
  const rows = C.parseDelimited(csv, ',');
  assert.deepEqual(rows, [['name', 'note'], ['Smith, J', 'said "hi"\nthen left'], ['Lee', '']]);
  assert.equal(C.stringifyDelimited(rows, ','), csv);
  const objs = C.rowsToObjects(rows);
  assert.deepEqual(objs[0], { name: 'Smith, J', note: 'said "hi"\nthen left' });
  const back = C.objectsToRows(objs);
  assert.deepEqual(back.rows, rows); assert.equal(back.nested, false);
  assert.equal(C.objectsToRows([{ a: { b: 1 } }]).nested, true);
  assert.throws(() => C.parseDelimited('"open', ','), (e) => e.offset === 0);
  assert.throws(() => C.objectsToRows({ a: 1 }), (e) => e.code === 'shape');
  const tsv = C.stringifyDelimited(rows, '\t', '\n');
  assert.deepEqual(C.parseDelimited(tsv, '\t'), rows);
});

test('YAML subset round trips JSON and refuses unsupported features', () => {
  const v = { name: 'Material VM Labs', version: 3, ok: true, none: null, tags: ['a', 'b c', '1', 'true'], nested: { list: [{ x: 1, y: 'two' }, { x: 3, y: [] }], empty: {} }, 'odd key': 'colon: here', matrix: [[1, 2], [3]] };
  const y = C.toYaml(v);
  assert.deepEqual(C.parseYaml(y), v);
  assert.deepEqual(C.parseYaml('a: 1 # comment\nb:\n- x\n- y\nc: \'it\'\'s\'\n'), { a: 1, b: ['x', 'y'], c: "it's" });
  assert.throws(() => C.parseYaml('a: &x 1\n'), /anchors/);
  assert.throws(() => C.parseYaml('a: |\n  text\n'), /block text/);
  assert.throws(() => C.parseYaml('a: 1\na: 2\n'), /twice/);
  assert.throws(() => C.parseYaml('a:\n\tb: 1\n'), /tabs/);
  assert.equal(C.parseYaml('just text'), 'just text');
});

test('XML: JSON to XML and back, entities, and DOCTYPE refusal', () => {
  const v = { title: 'Fish & chips <hot>', items: [1, 2], meta: { 'bad key': 'x' } };
  const x = C.jsonToXml(v, 'root');
  assert.equal(x.renamed, true);
  const j = C.xmlToJson(x.text);
  assert.equal(j.root.title, 'Fish & chips <hot>');
  assert.deepEqual(j.root.items.item, ['1', '2']);
  assert.equal(j.root.meta.entry['@key'], 'bad key');
  assert.deepEqual(C.xmlToJson('<a x="1"><b>t</b><b>u</b>tail<![CDATA[<raw>]]></a>'), { a: { '@x': '1', b: ['t', 'u'], '#text': 'tail<raw>' } });
  assert.throws(() => C.parseXml('<!DOCTYPE a [<!ENTITY x "y">]><a/>'), /refused/);
  assert.throws(() => C.parseXml('<a>&custom;</a>'), /built-in/);
  assert.throws(() => C.parseXml('<a><b></a>'), /Expected <\/b>/);
});

test('ZIP: store and deflate archives round trip with CRC checks; tampering is caught', async () => {
  const entries = [{ name: 'a.txt', bytes: te('hello '.repeat(200)) }, { name: '../evil/b.bin', bytes: randomBytes(500) }, { name: 'a.txt', bytes: te('dup') }];
  for (const method of ['store', 'deflate']) {
    const zip = await C.buildZip(entries, { method });
    assert.equal(C.detectType(zip, 'x').id, 'zip');
    const back = await C.readZip(zip);
    assert.deepEqual(back.map((e) => e.name), ['a.txt', 'evil/b.bin', 'a (1).txt']);
    back.forEach((e, k) => { assert.equal(e.status, 'ok'); assert.deepEqual(Buffer.from(e.bytes), Buffer.from(entries[k].bytes)); });
    if (method === 'deflate') assert.equal(back[0].method, 8);
  }
  const zip = await C.buildZip([{ name: 'x.txt', bytes: te('abcdef') }], { method: 'store' });
  zip[30 + 5 + 2] ^= 0xFF; // flip a data byte
  const bad = await C.readZip(zip);
  assert.equal(bad[0].status, 'failed'); assert.match(bad[0].reason, /CRC/);
  await assert.rejects(C.readZip(te('not a zip at all, no end record here')), /No ZIP end record/);
});

test('gzip compress and decompress round trip; damaged data fails closed', async () => {
  const b = te('repeat '.repeat(1000));
  const gz = await C.compress(b, 'gzip');
  assert.equal(C.detectType(gz, 'x').id, 'gzip');
  assert.deepEqual(Buffer.from(await C.decompress(gz, 'gzip')), Buffer.from(b));
  await assert.rejects(C.decompress(gz, 'gzip', 100), /safety limit/);
  await assert.rejects(C.decompress(gz.subarray(0, 20), 'gzip'), /damaged/);
});

test('BMP writer produces a valid 24-bit header and flattens transparency', () => {
  const rgba = Uint8Array.of(255, 0, 0, 255, 0, 0, 0, 0, 0, 255, 0, 255, 0, 0, 255, 128);
  const bmp = C.encodeBmp(2, 2, rgba);
  assert.equal(C.detectType(bmp, 'x').id, 'bmp');
  const dv = new DataView(bmp.buffer);
  assert.equal(dv.getUint32(2, true), bmp.length); assert.equal(dv.getUint16(28, true), 24);
  // bottom-up: first stored row is the image's last row (green, then half-blue)
  assert.deepEqual([...bmp.subarray(54, 57)], [0, 255, 0]);
  // top row, second pixel was fully transparent: flattened to white
  assert.deepEqual([...bmp.subarray(54 + 8 + 3, 54 + 8 + 6)], [255, 255, 255]);
});

test('hex dump is bounded and readable', () => {
  const d = C.hexDump(te('Hello\x00World, more bytes here!'), 16);
  assert.equal(d.split('\n').length, 1);
  assert.match(d, /^00000000  48 65 6c 6c 6f 00 57 6f/);
  assert.match(d, /\|Hello\.World, mor\|$/);
});
