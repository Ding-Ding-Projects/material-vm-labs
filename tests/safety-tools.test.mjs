// Safety tools: OTP standards vectors, the in-house QR encoder, sealed storage and the unlock-ladder engine.
// Run: node --test tests/safety-tools.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../companion/renderer/shared/tools/safety-tools-core.js');
const E = require('../companion/src/shared/safety-engine.js');

const ascii = (s) => new TextEncoder().encode(s);
const SEED = { SHA1: ascii('12345678901234567890'), SHA256: ascii('12345678901234567890123456789012'), SHA512: ascii('1234567890123456789012345678901234567890123456789012345678901234') };

// RFC 6238 Appendix B (8 digits, 30-second step, T0 = 0).
const RFC6238 = [
  [59, { SHA1: '94287082', SHA256: '46119246', SHA512: '90693936' }],
  [1111111109, { SHA1: '07081804', SHA256: '68084774', SHA512: '25091201' }],
  [1111111111, { SHA1: '14050471', SHA256: '67062674', SHA512: '99943326' }],
  [1234567890, { SHA1: '89005924', SHA256: '91819424', SHA512: '93441116' }],
  [2000000000, { SHA1: '69279037', SHA256: '90698825', SHA512: '38618901' }],
  [20000000000, { SHA1: '65353130', SHA256: '77737706', SHA512: '47863826' }]
];

test('RFC 6238 vectors for SHA-1, SHA-256 and SHA-512 at 8 and 6 digits', async () => {
  for (const [t, want] of RFC6238) for (const alg of ['SHA1', 'SHA256', 'SHA512']) {
    const r8 = await C.totp(SEED[alg], t * 1000, { algorithm: alg, digits: 8, period: 30 });
    assert.equal(r8.code, want[alg], `${alg} at ${t}`);
    const r6 = await C.totp(SEED[alg], t * 1000, { algorithm: alg, digits: 6, period: 30 });
    assert.equal(r6.code, want[alg].slice(2), `${alg} at ${t}, 6 digits`);
    const b32 = C.base32Encode(SEED[alg]);
    assert.equal((await C.totp(b32, t * 1000, { algorithm: alg, digits: 8 })).code, want[alg], 'same result from the base32 secret');
  }
});

test('RFC 4226 HOTP vectors (SHA-1, 6 digits)', async () => {
  const want = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
  for (let i = 0; i < want.length; i++) assert.equal(await C.hotp(SEED.SHA1, i, {}), want[i]);
});

test('period boundary, countdown, next code and the verification window', async () => {
  const s = 'JBSWY3DPEHPK3PXP';
  const a = await C.totp(s, 59999, {}), b = await C.totp(s, 60000, {});
  assert.equal(a.remaining, 1); assert.equal(b.remaining, 30); assert.equal(b.counter, a.counter + 1);
  assert.equal(await C.verifyTotp(s, b.code, {}, 59999, 1), 1, 'the next code is accepted one step ahead');
  assert.equal(await C.verifyTotp(s, a.code, {}, 60000, 1), -1);
  assert.equal(await C.verifyTotp(s, a.code, {}, 60000 + 30000 * 3, 1), null, 'outside the window is refused');
  assert.equal(await C.verifyTotp(s, '12345', {}, 0, 1), null, 'wrong length is refused');
  const p60 = await C.totp(s, 61000, { period: 60, digits: 7, algorithm: 'SHA512' });
  assert.equal(p60.code.length, 7); assert.equal(p60.remaining, 59);
  const ahead = await C.totp(s, 1700000000000 + 90000, {});
  assert.equal(await C.clockOffset(s, ahead.code, {}, 1700000000000, 20), 90, 'a clock 90 seconds behind is reported');
});

test('base32 and otpauth:// parse and build, honouring the parameters', () => {
  for (let n = 1; n < 40; n++) { const b = C.randomBytes(n); assert.deepEqual(C.base32Decode(C.base32Encode(b)), b); }
  assert.deepEqual(C.base32Decode('jbsw y3dp-ehpk3pxp=='), C.base32Decode('JBSWY3DPEHPK3PXP'));
  assert.throws(() => C.base32Decode('ABC1'), /base32/);
  const p = C.parseOtpauth('otpauth://totp/ACME%20Co:alice%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=ACME%20Co&algorithm=SHA256&digits=8&period=60');
  assert.deepEqual(p, { type: 'totp', issuer: 'ACME Co', account: 'alice@example.com', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA256', digits: 8, period: 60 });
  assert.deepEqual(C.parseOtpauth(C.buildOtpauth(p)), p, 'round trip keeps every parameter');
  const d = C.parseOtpauth('otpauth://totp/bob?secret=JBSWY3DPEHPK3PXP');
  assert.equal(d.algorithm, 'SHA1'); assert.equal(d.digits, 6); assert.equal(d.period, 30); assert.equal(d.issuer, '');
  assert.equal(C.parseOtpauth('otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP&counter=7').counter, 7);
  assert.throws(() => C.parseOtpauth('https://example.com'), /otpauth/);
  assert.throws(() => C.parseOtpauth('otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=9'), /6, 7 or 8/);
  assert.throws(() => C.parseOtpauth('otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&algorithm=MD5'), /SHA/);
  assert.throws(() => C.parseOtpauth('otpauth://totp/x'), /empty/);
});

// Module rows from an independent encoder (python qrcode 8.x, byte mode, level M, fixed mask).
const KNOWN = [
  { text: 'HELLO', mask: 2, version: 1, rows: '1fc27f,104541,17585d,17555d,17595d,105e41,1fd57f,1800,17c67c,dafcc,7d16e,d0fcc,bf125,1528,1fce96,10543e,175a96,175be8,175964,104fdc,1fd916' },
  { text: 'otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example&algorithm=SHA1&digits=6&period=30', mask: 5, version: 7, rows: '1fcf8d65f17f,105388340a41,1751bc307a5d,1757eddb335d,17449ff3e75d,104ed51c2841,1fd55555557f,1cff139d00,105375f0e6ce,89adf1ff7f6,dd6a4258fce,159f57837f9f,1e62b6039658,11bd430af323,134843390674,bbe5948a66f,dce6610accc,12bc6bd9c1a6,cc2cdd9d225,b87faa0dc94,17fabdf0e3f0,71ec514d71c,d5ff9538756,171ab31d5d1c,1bfe03fdd3f2,18da75ac8e9,153e18615ae,1801d37e0a2f,16c4ed0ee498,81b3c08e824,12c63e55935d,e893819fe44,8dcd03ee0f1,ab9821fef3f,14f5464b8a2,f28a07cfb6f,1363e5f9dbfb,13c91e5117,1fc1b551ad56,10404b1cad1f,174b15f86bf2,174ef2e0ea17,174091c2991d,104ae565939c,1fd33e18a4c2' }
];
const rowsOf = (qr) => qr.modules.map((r) => BigInt('0b' + r.map((c) => (c ? '1' : '0')).join('')).toString(16)).join(',');

test('QR encoder matches known module patterns from an independent encoder', () => {
  for (const k of KNOWN) {
    const qr = C.qrEncode(k.text, { mask: k.mask });
    assert.equal(qr.version, k.version);
    assert.equal(rowsOf(qr), k.rows, k.text.slice(0, 20));
  }
});

// A tiny decoder written separately from the encoder: reads the format bits, unmasks, walks the
// zigzag, de-interleaves the blocks, checks every block's Reed-Solomon syndromes and parses byte mode.
function decode(m) {
  const n = m.length, v = (n - 17) / 4;
  const fmt = (() => { let b = 0; for (let i = 0; i <= 5; i++) b |= (m[i][8] ? 1 : 0) << i; b |= (m[7][8] ? 1 : 0) << 6; b |= (m[8][8] ? 1 : 0) << 7; b |= (m[8][7] ? 1 : 0) << 8; for (let i = 9; i < 15; i++) b |= (m[8][14 - i] ? 1 : 0) << i; return b ^ 0x5412; })();
  let rem = fmt >>> 10; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  if ((((fmt >>> 10) << 10) | rem) !== fmt) throw new Error('format BCH check failed');
  const level = fmt >>> 13, mask = (fmt >>> 10) & 7;
  const fn = Array.from({ length: n }, () => new Array(n).fill(false));
  const box = (x0, y0, w) => { for (let y = y0; y < y0 + w; y++) for (let x = x0; x < x0 + w; x++) if (x >= 0 && y >= 0 && x < n && y < n) fn[y][x] = true; };
  box(0, 0, 9); box(n - 8, 0, 9); box(0, n - 8, 9);
  for (let i = 0; i < n; i++) { fn[6][i] = true; fn[i][6] = true; }
  if (v >= 2) {
    const na = Math.floor(v / 7) + 2, step = Math.floor((v * 8 + na * 3 + 5) / (na * 4 - 4)) * 2, pos = [6];
    for (let p = n - 7; pos.length < na; p -= step) pos.splice(1, 0, p);
    const last = pos[pos.length - 1];
    for (const a of pos) for (const b of pos) if (!((a === 6 && b === 6) || (a === 6 && b === last) || (a === last && b === 6))) box(a - 2, b - 2, 5);
  }
  if (v >= 7) { box(n - 11, 0, 3); box(n - 11, 3, 3); box(0, n - 11, 3); box(3, n - 11, 3); }
  const maskFn = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0, (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0, (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0][mask];
  const bits = [];
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let k = 0; k < n; k++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = ((right + 1) & 2) === 0 ? n - 1 - k : k;
      if (!fn[y][x]) bits.push(m[y][x] !== maskFn(x, y) ? 1 : 0);
    }
  }
  const words = []; for (let i = 0; i + 8 <= bits.length; i += 8) words.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  const { ecc, blocks: nb } = C.qrBlocks(v);
  const total = Math.floor(C.qrRawModules(v) / 8), short = Math.floor(total / nb), nShort = nb - (total % nb);
  const blocks = Array.from({ length: nb }, (_, i) => ({ data: [], ecc: [], dlen: short - ecc + (i < nShort ? 0 : 1) }));
  let w = 0;
  for (let i = 0; i < short - ecc + 1; i++) for (const b of blocks) if (i < b.dlen) b.data.push(words[w++]);
  for (let i = 0; i < ecc; i++) for (const b of blocks) b.ecc.push(words[w++]);
  const exp = [], log = []; for (let i = 0, x = 1; i < 255; i++) { exp[i] = x; log[x] = i; x = (x << 1) ^ (x & 0x80 ? 0x11d : 0); }
  const mul = (a, b) => (a && b ? exp[(log[a] + log[b]) % 255] : 0);
  for (const b of blocks) {
    const cw = b.data.concat(b.ecc);
    for (let i = 0; i < ecc; i++) { let s = 0; for (const c of cw) s = mul(s, exp[i]) ^ c; if (s) throw new Error('Reed-Solomon syndrome is not zero'); }
  }
  const data = blocks.flatMap((b) => b.data), db = data.flatMap((x) => [7, 6, 5, 4, 3, 2, 1, 0].map((i) => (x >>> i) & 1));
  const take = (k) => { let r = 0; for (let i = 0; i < k; i++) r = (r << 1) | db.shift(); return r; };
  if (take(4) !== 4) throw new Error('not byte mode');
  const len = take(v <= 9 ? 8 : 16), out = [];
  for (let i = 0; i < len; i++) out.push(take(8));
  return { level, mask, version: v, text: new TextDecoder().decode(new Uint8Array(out)) };
}

test('QR output decodes back to the exact text at every size class, with level M', () => {
  const uri = C.buildOtpauth({ issuer: 'Material VM Labs', account: 'me@example.com', secret: C.newSecret(20), algorithm: 'SHA256', digits: 8, period: 60 });
  for (const text of ['HELLO', uri, 'x'.repeat(300), 'y'.repeat(1200), 'z'.repeat(2331), 'Unicode: 蝦餃 and 燒賣']) {
    const qr = C.qrEncode(text);
    const d = decode(qr.modules);
    assert.equal(d.text, text); assert.equal(d.level, 0, 'level M'); assert.equal(d.mask, qr.mask);
  }
  for (let v = 1; v <= 40; v++) { const { ecc, blocks } = C.qrBlocks(v); assert.ok(C.qrDataCodewords(v) > 0 && ecc > 0 && blocks > 0); }
  assert.throws(() => C.qrEncode('q'.repeat(2400)), /too long/);
  const svg = C.qrSvg(C.qrEncode(uri), { label: 'Pairing QR' });
  assert.match(svg, /fill="#ffffff"/); assert.match(svg, /fill="#000000"/); assert.match(svg, /aria-label="Pairing QR"/);
});

test('sealed storage round trip; a wrong passphrase or a changed byte fails', async () => {
  const data = { v: 1, entries: [{ issuer: 'ACME', secret: 'JBSWY3DPEHPK3PXP' }] };
  const s = await C.seal(data, 'correct horse battery');
  assert.equal(s.box.iterations, C.ITERATIONS); assert.ok(C.ITERATIONS >= 600000);
  assert.ok(!JSON.stringify(s.box).includes('JBSWY3DPEHPK3PXP'), 'no plaintext secret in the box');
  assert.deepEqual((await C.unseal(s.box, 'correct horse battery')).data, data);
  await assert.rejects(() => C.unseal(s.box, 'correct horse batterY'), /did not open/);
  const ct = C.unb64(s.box.ct); ct[3] ^= 1;
  await assert.rejects(() => C.unseal(Object.assign({}, s.box, { ct: C.b64(ct) }), 'correct horse battery'), /did not open/);
  const again = await C.sealWithKey(data, s.key, s.salt, s.iterations);
  assert.notEqual(again.iv, s.box.iv, 'every save uses a fresh IV');
  assert.deepEqual(await C.openWithKey(again, s.key), data);
  await assert.rejects(() => C.unseal({ format: 'other' }, 'x'), /not a sealed/);
});

test('toy-lock credential hashing verifies the right value only', async () => {
  const h = await C.hashSecret('2468');
  assert.ok(!JSON.stringify(h).includes('2468'));
  assert.equal(await C.verifySecret('2468', h), true);
  assert.equal(await C.verifySecret('2469', h), false);
  assert.equal(await C.verifySecret('2468', null), false);
});

function clock(start) { const c = { t: start || 1e12 }; c.now = () => c.t; return c; }
const lockOut = (e, key) => { let s; for (let i = 0; i < E.ATTEMPTS; i++) s = e.attempt(key, false); return s; };
const dishAnswer = (ch) => E.DISHES.find((d) => d.clue === ch.clue).en;

test('lockout after five misses, doubling waits, and a served wait refills the same budget', () => {
  const c = clock(), e = E.createEngine({ now: c.now });
  assert.equal(e.attempt('a', false).remaining, 4);
  const s1 = lockOut(e, 'a'); // 1 earlier + 5 = locked on the fifth
  assert.equal(s1.locked, true); assert.equal(s1.waitMs, E.BASE_WAIT);
  assert.equal(e.attempt('a', true).refused, true, 'no attempts while waiting');
  c.t += E.BASE_WAIT;
  assert.equal(e.status('a').locked, false); assert.equal(e.status('a').remaining, E.ATTEMPTS);
  assert.equal(lockOut(e, 'a').waitMs, E.BASE_WAIT * 2, 'escalates');
  c.t += E.BASE_WAIT * 2;
  e.attempt('a', true);
  assert.equal(lockOut(e, 'a').waitMs, E.BASE_WAIT, 'a success resets the escalation');
  for (let i = 0; i < 12; i++) { c.t += E.MAX_WAIT; lockOut(e, 'a'); }
  assert.equal(e.status('a').waitMs, E.MAX_WAIT, 'capped');
});

test('ladder: dim sum clears the wait only; nonces are single use; budget 3 per rolling hour', () => {
  const c = clock(), e = E.createEngine({ now: c.now });
  assert.equal(e.challenge('a').error, 'not-locked');
  lockOut(e, 'a');
  const ch = e.challenge('a', { school: false });
  assert.equal(ch.rung, 'dimsum'); assert.equal(ch.choices.length, 4); assert.equal(ch.answer, undefined, 'the answer never leaves the engine');
  const r = e.answer('a', ch.nonce, dishAnswer(ch));
  assert.equal(r.cleared, true); assert.equal(r.locked, false);
  assert.equal(r.remaining, E.ATTEMPTS, 'refills exactly what serving the wait refills');
  assert.equal(r.lockouts, 1, 'escalation count untouched');
  assert.equal(e.answer('a', ch.nonce, dishAnswer(ch)).error, 'unknown-or-used-nonce', 'replay refused');
  assert.equal(lockOut(e, 'a').waitMs, E.BASE_WAIT * 2, 'the next wait is still longer');
  // two more skips this hour, then the clock only
  for (let i = 0; i < 2; i++) { const x = e.challenge('a'); assert.equal(e.answer('a', x.nonce, dishAnswer(x)).cleared, true); lockOut(e, 'a'); }
  const st = e.status('a');
  assert.equal(st.budgetLeft, 0); assert.equal(st.ladder.available, false); assert.equal(st.ladder.reason, 'hourly-budget-spent');
  assert.equal(e.challenge('a').error, 'hourly-budget-spent');
  c.t += 60 * 60 * 1000 + 1;
  assert.equal(e.budgetLeft(), 3, 'the budget refills after a rolling hour');
});

test('ladder: wrong answers, expiry, wrong kinds and the fall through every rung', () => {
  const c = clock(), e = E.createEngine({ now: c.now });
  lockOut(e, 'b'); c.t += E.BASE_WAIT; lockOut(e, 'b'); c.t += E.BASE_WAIT * 2; lockOut(e, 'b'); // a 120-second wait
  let ch = e.challenge('b');
  c.t += 61000;
  assert.equal(e.answer('b', ch.nonce, dishAnswer(ch)).error, 'expired');
  assert.equal(e.answer('b', ch.nonce, dishAnswer(ch)).error, 'unknown-or-used-nonce', 'consumed even when expired');
  for (let i = 0; i < E.DIM_SUM_TRIES; i++) { ch = e.challenge('b'); assert.equal(ch.rung, 'dimsum'); const r = e.answer('b', ch.nonce, 42); assert.equal(r.correct, false, 'an answer of the wrong kind is wrong'); }
  ch = e.challenge('b');
  assert.equal(ch.rung, 'sums'); assert.equal(ch.sums.length, 10);
  const right = ch.sums.map((s) => (s.op === '+' ? s.a + s.b : s.op === '-' ? s.a - s.b : s.a * s.b));
  assert.ok(right.every((x) => x >= 0 && x < 100));
  const wrong = right.slice(); wrong[9] += 1;
  assert.deepEqual(e.answer('b', ch.nonce, wrong).wrong, [9]);
  ch = e.challenge('b');
  assert.equal(ch.rung, 'mole');
  c.t += ch.leadInMs + ch.durationMs - 1;
  const early = e.answer('b', ch.nonce, ch.moles.map((m) => ({ cell: m.cell, t: m.at + 10 })));
  assert.equal(early.early, true); assert.equal(early.cleared, false, 'a round cannot be won before it has run');
  assert.equal(e.status('b').ladder.rung, 'clock');
  assert.equal(e.challenge('b').error, 'submitted-early', 'the ladder is over for this wait');
  c.t += E.MAX_WAIT;
  assert.equal(e.status('b').locked, false);
});

test('ladder: each mole counts once, only in its cell while visible; a full round clears', () => {
  const c = clock(), e = E.createEngine({ now: c.now });
  const toMole = () => { lockOut(e, 'm'); for (let i = 0; i < E.DIM_SUM_TRIES; i++) { const x = e.challenge('m'); e.answer('m', x.nonce, 'nope'); } const s = e.challenge('m'); e.answer('m', s.nonce, []); return e.challenge('m'); };
  let ch = toMole();
  c.t += ch.leadInMs + ch.durationMs;
  const m0 = ch.moles[0];
  const spam = Array.from({ length: 300 }, () => ({ cell: m0.cell, t: m0.at + 5 }));
  const empty = ch.moles.map((m) => ({ cell: (m.cell + 1) % 9, t: m.at + 5 })).filter((h) => !ch.moles.some((m) => m.cell === h.cell && h.t >= m.at - 150 && h.t <= m.at + m.dur + 150));
  const r = e.answer('m', ch.nonce, spam.concat(empty));
  assert.equal(r.hits, 1, 'spamming one cell and hitting empty cells earns one hit'); assert.equal(r.cleared, false);
  c.t += E.MAX_WAIT;
  e.attempt('m', true); // serve, then a success resets escalation for a clean second run
  ch = toMole();
  c.t += ch.leadInMs + ch.durationMs;
  const all = ch.moles.map((m) => ({ cell: m.cell, t: m.at + 50 }));
  const ok = e.answer('m', ch.nonce, all);
  assert.equal(ok.cleared, true); assert.ok(ok.hits >= E.MOLE.need);
});

test('School mode starts the ladder at the sums', () => {
  assert.equal(E.startRung(true), 'sums'); assert.equal(E.startRung(false), 'dimsum');
  const e = E.createEngine({ now: clock().now });
  lockOut(e, 's');
  assert.equal(e.challenge('s', { school: true }).rung, 'sums');
});

test('engine state survives a restart without pending challenges', () => {
  const c = clock(), e = E.createEngine({ now: c.now });
  lockOut(e, 'r');
  const ch = e.challenge('r');
  const e2 = E.createEngine({ now: c.now, state: e.exportState() });
  assert.equal(e2.status('r').locked, true);
  assert.equal(e2.answer('r', ch.nonce, dishAnswer(ch)).error, 'unknown-or-used-nonce');
});
