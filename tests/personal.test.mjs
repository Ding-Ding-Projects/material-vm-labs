// Plain Node tests for the personal tools core: colour round trips, schedule semantics including
// cross-midnight windows, PIN and password hashing, the rainbow sentinel rule and logo byte checks.
// Run: node tests/personal.test.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const P = require('../companion/renderer/shared/tools/personal-core.js');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e && e.message)); }
}

// ---------- colour ----------
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
function sameColour(a, b, tol, what) { for (const k of ['r', 'g', 'b']) near(a[k], b[k], tol, what + ' ' + k); near(a.a, b.a, 0.002, what + ' alpha'); }
function seeded(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

await test('every space round trips within tolerance for 500 random colours', () => {
  const rnd = seeded(42);
  const spaces = ['hex', 'hex8', 'rgb', 'hsl', 'hsv', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'cmyk'];
  for (let i = 0; i < 500; i++) {
    const c = { r: rnd(), g: rnd(), b: rnd(), a: i % 3 ? 1 : Math.round(rnd() * 1000) / 1000 };
    for (const sp of spaces) {
      const s = P.format(c, sp);
      const back = P.parse(s);
      assert.ok(back, `${sp} did not parse: ${s}`);
      // hex keeps 8 bits per channel; the others keep at least two decimals.
      const tol = sp === 'hex' || sp === 'hex8' ? 0.5 / 255 + 1e-9 : 0.004;
      if (sp === 'hex') { sameColour({ ...back.color, a: c.a }, c, tol, sp); continue; }
      if (sp === 'hex8') { for (const k of ['r', 'g', 'b']) near(back.color[k], c[k], tol, 'hex8 ' + k); near(back.color.a, c.a, 0.5 / 255 + 1e-9, 'hex8 alpha'); continue; }
      sameColour(back.color, c, tol, sp + ' ' + s);
    }
  }
});

await test('known reference values', () => {
  assert.equal(P.format(P.parse('rebeccapurple').color, 'hex'), '#663399');
  assert.equal(P.format(P.parse('#f00').color, 'named'), 'red');
  assert.equal(P.format(P.parse('hsl(120, 100%, 25%)').color, 'hex'), '#008000');
  const ok = P.rgbToOklab(P.parse('#ffffff').color); near(ok.l, 1, 1e-4, 'white OKLab L'); near(ok.a, 0, 1e-4, 'white a');
  const lab = P.rgbToLab(P.parse('#ffffff').color); near(lab.l, 100, 0.01, 'white LAB L'); near(lab.a, 0, 0.01, 'white LAB a');
  near(P.contrast(P.parse('#000').color, P.parse('#fff').color), 21, 1e-6, 'black on white contrast');
  assert.equal(P.format(P.parse('cmyk(0%, 100%, 100%, 0%)').color, 'hex'), '#ff0000');
});

await test('out-of-gamut input is detected rather than silently clipped', () => {
  const p = P.parse('oklch(70% 0.35 145)');
  assert.ok(p && !P.inGamut(p.color), 'very saturated OKLCH green is outside sRGB');
  assert.ok(P.inGamut(P.clip(p.color)));
  assert.ok(P.inGamut(P.parse('#123456').color));
});

await test('malformed colour strings are refused', () => {
  for (const s of ['', '#12', 'rgb(1,2)', 'hsl(a,b,c)', 'notacolour', 'x'.repeat(200), 'url(javascript:1)']) assert.equal(P.parse(s), null, s);
});

await test('the rainbow sentinel never enters the palette array', () => {
  let pal = ['#112233'];
  pal = P.addToPalette(pal, P.RAINBOW);
  assert.deepEqual(pal, ['#112233']);
  pal = P.addToPalette(pal, '#445566');
  assert.ok(!pal.includes(P.RAINBOW) && pal.length === 2);
  assert.equal(P.parse(P.RAINBOW), null, 'the sentinel is not a colour');
  assert.equal(P.rainbowSeconds(1), 30); assert.equal(P.rainbowSeconds(5), 3);
  assert.equal(P.rainbowSeconds('NaN'), P.RAINBOW_LEVELS[3], 'a bad level never yields NaN');
  assert.equal(P.rainbowSeconds(99), 3);
});

// ---------- schedules ----------
const rule = (o) => Object.assign({ id: 'rtest01', label: 'Night', enabled: true, every: true, days: [], start: '22:00', end: '06:00', setting: 'theme', value: 'dark', source: 'local' }, o);
const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi);

await test('cross-midnight window belongs to the day it started', () => {
  // 2026-11-20 is a Friday (5); 2026-11-21 is a Saturday (6).
  const fri = rule({ every: false, days: [5] });
  assert.equal(P.matches(fri, at(2026, 11, 20, 23, 0)), true, 'Friday 23:00');
  assert.equal(P.matches(fri, at(2026, 11, 21, 1, 30)), true, 'Saturday 01:30 is still Friday night');
  assert.equal(P.matches(fri, at(2026, 11, 21, 6, 0)), false, 'end is exclusive');
  assert.equal(P.matches(fri, at(2026, 11, 21, 23, 0)), false, 'Saturday 23:00 is not Friday');
  assert.equal(P.matches(fri, at(2026, 11, 20, 1, 0)), false, 'Friday 01:00 belongs to Thursday');
  assert.equal(P.matches(fri, at(2026, 11, 20, 12, 0)), false, 'midday is outside');
});

await test('every day, equal start and end, same-day windows', () => {
  assert.equal(P.matches(rule({ start: '09:00', end: '17:00' }), at(2026, 11, 22, 9, 0)), true);
  assert.equal(P.matches(rule({ start: '09:00', end: '17:00' }), at(2026, 11, 22, 17, 0)), false);
  assert.equal(P.matches(rule({ start: '08:00', end: '08:00' }), at(2026, 11, 22, 3, 0)), true, 'equal start and end is the whole day');
  assert.equal(P.matches(rule({ enabled: false }), at(2026, 11, 22, 23, 0)), false);
});

await test('date range applies to the day the window started', () => {
  const r = rule({ startDate: '2026-11-20', endDate: '2026-11-20' });
  assert.equal(P.matches(r, at(2026, 11, 21, 2, 0)), true, 'the Friday window continues past midnight');
  assert.equal(P.matches(r, at(2026, 11, 21, 23, 0)), false, 'Saturday is after the end date');
  assert.equal(P.matches(r, at(2026, 11, 20, 2, 0)), false, 'Thursday night is before the start date');
});

await test('precedence: the first matching rule for a setting wins; unavailable sources are skipped', () => {
  const sched = { v: 1, rules: [
    rule({ id: 'rapi0001', source: 'api', value: 'light' }),
    rule({ id: 'rfirst01', value: 'dark' }),
    rule({ id: 'rsecond1', value: 'light' }),
    rule({ id: 'rlang001', setting: 'lang', value: 'bi' })
  ] };
  const r = P.resolve(sched, at(2026, 11, 20, 23, 0), () => false);
  assert.deepEqual(r.values.theme, { value: 'dark', ruleId: 'rfirst01' });
  assert.equal(r.values.lang.value, 'bi');
  assert.deepEqual(r.skipped, ['rapi0001']);
  assert.deepEqual(P.resolve({ v: 1, rules: [] }, at(2026, 11, 20, 23, 0)).values, {}, 'empty schedule changes nothing');
});

await test('invalid partial rules are reported and never applied', () => {
  assert.ok(P.validateRule(rule({ start: '25:00' })).length);
  assert.ok(P.validateRule(rule({ every: false, days: [] })).length);
  assert.ok(P.validateRule(rule({ value: 'purple' })).length);
  assert.ok(P.validateRule(rule({ startDate: '2026-12-01', endDate: '2026-11-01' })).length);
  assert.equal(P.validateRule(rule({})).length, 0);
  const r = P.resolve({ v: 1, rules: [rule({ end: '' })] }, at(2026, 11, 20, 23, 0));
  assert.deepEqual(r.values, {});
  assert.deepEqual(P.migrateSchedule([rule({})]).v, 1, 'a bare array migrates to the versioned schema');
});

// ---------- credential ----------
await test('PIN hash verifies the right PIN and rejects a wrong one', async () => {
  const rec = await P.hashSecret('pin', '2468');
  assert.equal(rec.alg, 'PBKDF2-SHA-256');
  assert.ok(rec.iterations >= 100000);
  assert.ok(!JSON.stringify(rec).includes('2468'), 'the record never holds the PIN');
  assert.equal(await P.verifySecret('2468', rec), true);
  assert.equal(await P.verifySecret('2469', rec), false);
  assert.equal(await P.verifySecret('', rec), false);
  const again = await P.hashSecret('pin', '2468');
  assert.notEqual(again.salt, rec.salt, 'every hash gets a fresh salt');
});

await test('password rules and tampered records', async () => {
  await assert.rejects(P.hashSecret('pin', '12'));
  await assert.rejects(P.hashSecret('password', 'short'));
  const rec = await P.hashSecret('password', 'correct horse battery');
  assert.equal(await P.verifySecret('correct horse battery', rec), true);
  assert.equal(await P.verifySecret('correct horse battery', { ...rec, iterations: 10 }), false, 'weak iteration counts are refused');
  assert.equal(await P.verifySecret('correct horse battery', { ...rec, hash: 'AAAA' }), false);
});

// ---------- logo byte checks ----------
function png({ w = 64, h = 32, ct = 6, actl = false } = {}) {
  const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'latin1'); data.copy(b, 8); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = ct;
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), actl ? chunk('acTL', Buffer.alloc(8)) : Buffer.alloc(0), chunk('IDAT', Buffer.alloc(4)), chunk('IEND', Buffer.alloc(0))]));
}
await test('logo bytes: signatures, bounds and animation', () => {
  const ok = P.sniffImage(png());
  assert.deepEqual([ok.ok, ok.type, ok.width, ok.height, ok.alpha], [true, 'png', 64, 32, true]);
  assert.equal(P.sniffImage(png({ actl: true })).ok, false, 'animated PNG refused');
  assert.equal(P.sniffImage(png({ w: 9000, h: 10 })).ok, false, 'too wide');
  assert.equal(P.sniffImage(png({ w: 8000, h: 8000 })).ok, false, 'too many pixels');
  assert.equal(P.sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).ok, false, 'SVG refused');
  assert.equal(P.sniffImage(new TextEncoder().encode('GIF89a....')).ok, false, 'GIF refused');
  assert.equal(P.sniffImage(new Uint8Array([1, 2, 3, 4, 5])).ok, false, 'random bytes refused');
  assert.equal(P.sniffImage(new Uint8Array(0)).ok, false, 'empty refused');
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x20, 0x00, 0x40, 0x03, 0, 0, 0, 0]);
  const j = P.sniffImage(jpg); assert.deepEqual([j.ok, j.type, j.width, j.height, j.alpha], [true, 'jpeg', 64, 32, false]);
  const claim = P.claimedType('logo.png', 'image/png'); assert.equal(claim.byExt, 'png');
  assert.notEqual(P.sniffImage(jpg).type, claim.byExt, 'a JPEG named .png is detected as a mismatch');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
