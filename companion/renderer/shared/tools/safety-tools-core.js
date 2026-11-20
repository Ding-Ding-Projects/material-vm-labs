'use strict';
// Safety tools core: pure logic shared by the renderer and the node tests. No DOM, no network.
//  - Base32 (RFC 4648) and otpauth:// URIs (Key Uri Format).
//  - HOTP (RFC 4226) and TOTP (RFC 6238) over HMAC-SHA-1, SHA-256 and SHA-512 with WebCrypto.
//  - A QR code encoder written here: byte mode, error correction level M, versions 1 to 40,
//    all eight masks scored with the standard penalty rules. Output is a module matrix and an SVG.
//  - Sealed storage: AES-GCM 256 under a key derived with PBKDF2-SHA-256 (600000 iterations) from
//    a passphrase. Credential hashing for toy-lock PINs and passwords with PBKDF2 as well.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MVLSafetyCore = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const subtle = () => {
    const c = globalThis.crypto;
    if (!c || !c.subtle) throw new Error('WebCrypto is not available here.');
    return c.subtle;
  };
  const randomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
  const utf8 = (s) => new TextEncoder().encode(String(s));

  // ---------- Base32 ----------
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  function cleanBase32(s) { return String(s == null ? '' : s).toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, ''); }
  function base32Decode(s) {
    const t = cleanBase32(s);
    if (!t) throw new Error('The secret is empty.');
    if (/[^A-Z2-7]/.test(t)) throw new Error('The secret must be base32: letters A to Z and digits 2 to 7.');
    let bits = 0, val = 0; const out = [];
    for (const ch of t) {
      val = (val << 5) | B32.indexOf(ch); bits += 5;
      if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; val &= (1 << bits) - 1; }
    }
    if (!out.length) throw new Error('The secret is too short.');
    return new Uint8Array(out);
  }
  function base32Encode(bytes) {
    let bits = 0, val = 0, out = '';
    for (const b of bytes) {
      val = (val << 8) | b; bits += 8;
      while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
      val &= (1 << bits) - 1;
    }
    if (bits > 0) out += B32[(val << (5 - bits)) & 31];
    return out;
  }
  const groupBase32 = (s) => (cleanBase32(s).match(/.{1,4}/g) || []).join(' ');
  const newSecret = (bytes) => base32Encode(randomBytes(bytes || 20));

  // ---------- HOTP and TOTP ----------
  const HASH = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' };
  function normAlg(a) {
    const k = String(a || 'SHA1').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!HASH[k]) throw new Error('The algorithm must be SHA1, SHA256 or SHA512.');
    return k;
  }
  function normDigits(d) {
    const n = d == null ? 6 : Number(d);
    if (!Number.isInteger(n) || n < 6 || n > 8) throw new Error('Codes must have 6, 7 or 8 digits.');
    return n;
  }
  function normPeriod(p) {
    const n = p == null ? 30 : Number(p);
    if (!Number.isInteger(n) || n < 1 || n > 86400) throw new Error('The period must be a whole number of seconds from 1 to 86400.');
    return n;
  }
  const keyBytes = (secret) => (secret instanceof Uint8Array ? secret : base32Decode(secret));

  async function hotp(secret, counter, opts) {
    const o = opts || {};
    const alg = normAlg(o.algorithm), digits = normDigits(o.digits);
    if (!Number.isSafeInteger(counter) || counter < 0) throw new Error('The counter must be a whole number from 0.');
    const msg = new Uint8Array(8);
    const dv = new DataView(msg.buffer);
    dv.setUint32(0, Math.floor(counter / 4294967296)); dv.setUint32(4, counter >>> 0);
    const key = await subtle().importKey('raw', keyBytes(secret), { name: 'HMAC', hash: HASH[alg] }, false, ['sign']);
    const mac = new Uint8Array(await subtle().sign('HMAC', key, msg));
    const off = mac[mac.length - 1] & 15;
    const bin = ((mac[off] & 127) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
    return String(bin % 10 ** digits).padStart(digits, '0');
  }
  // TOTP at a unix time in milliseconds. Returns the code, its counter and the seconds left in its period.
  async function totp(secret, unixMs, opts) {
    const o = opts || {};
    const period = normPeriod(o.period);
    const sec = Math.floor(unixMs / 1000);
    const counter = Math.floor(sec / period);
    const code = await hotp(secret, counter, o);
    return { code, counter, remaining: period - (sec % period), period };
  }
  // Checks a typed code within +-window periods. Returns the matching step offset or null.
  async function verifyTotp(secret, code, opts, unixMs, window) {
    const o = opts || {};
    const want = String(code || '').replace(/\s/g, '');
    if (!/^\d{6,8}$/.test(want) || want.length !== normDigits(o.digits)) return null;
    const period = normPeriod(o.period), w = window == null ? 1 : window;
    const base = Math.floor(Math.floor(unixMs / 1000) / period);
    for (let i = 0; i <= w; i++) {
      for (const s of i ? [i, -i] : [0]) {
        if (base + s < 0) continue;
        if (await hotp(secret, base + s, o) === want) return s;
      }
    }
    return null;
  }
  // Clock check against another device: finds how many seconds this clock differs from the device
  // that showed `code` for the same secret. Positive: this clock is behind. Null: no match in range.
  async function clockOffset(secret, code, opts, unixMs, maxSteps) {
    const s = await verifyTotp(secret, code, opts, unixMs, maxSteps == null ? 20 : maxSteps);
    return s == null ? null : s * normPeriod((opts || {}).period);
  }

  // ---------- otpauth:// ----------
  function parseOtpauth(uri) {
    const m = /^otpauth:\/\/(totp|hotp)\/([^?#]*)(?:\?([^#]*))?/i.exec(String(uri || '').trim());
    if (!m) throw new Error('That is not an otpauth://totp/ or otpauth://hotp/ link.');
    const type = m[1].toLowerCase();
    let label = '';
    try { label = decodeURIComponent(m[2]); } catch { throw new Error('The label in the link is not valid.'); }
    const q = new URLSearchParams(m[3] || '');
    const secret = cleanBase32(q.get('secret'));
    base32Decode(secret);
    let issuer = q.get('issuer') || '', account = label;
    const c = label.indexOf(':');
    if (c >= 0) { if (!issuer) issuer = label.slice(0, c).trim(); account = label.slice(c + 1).trim(); }
    const out = {
      type, issuer: issuer.slice(0, 120), account: account.slice(0, 200), secret,
      algorithm: normAlg(q.get('algorithm') || 'SHA1'), digits: normDigits(q.get('digits') || 6)
    };
    if (type === 'totp') out.period = normPeriod(q.get('period') || 30);
    else {
      const ctr = q.get('counter');
      out.counter = ctr == null ? 0 : Number(ctr);
      if (!Number.isSafeInteger(out.counter) || out.counter < 0) throw new Error('The counter in the link is not valid.');
    }
    return out;
  }
  function buildOtpauth(e) {
    const type = e.type === 'hotp' ? 'hotp' : 'totp';
    const label = (e.issuer ? encodeURIComponent(e.issuer) + ':' : '') + encodeURIComponent(e.account || '');
    const q = ['secret=' + cleanBase32(e.secret)];
    if (e.issuer) q.push('issuer=' + encodeURIComponent(e.issuer));
    q.push('algorithm=' + normAlg(e.algorithm), 'digits=' + normDigits(e.digits));
    if (type === 'totp') q.push('period=' + normPeriod(e.period)); else q.push('counter=' + (e.counter || 0));
    return `otpauth://${type}/${label}?${q.join('&')}`;
  }

  // ---------- QR encoder (byte mode, level M) ----------
  const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
  const NUM_BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
  const FORMAT_M = 0; // two format bits for level M
  function rawModules(v) {
    let r = (16 * v + 128) * v + 64;
    if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; }
    return r;
  }
  const dataCodewords = (v) => Math.floor(rawModules(v) / 8) - ECC_PER_BLOCK[v] * NUM_BLOCKS[v];
  function gfMul(x, y) { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z; }
  function rsDivisor(deg) {
    const r = new Array(deg - 1).fill(0); r.push(1);
    let root = 1;
    for (let i = 0; i < deg; i++) {
      for (let j = 0; j < r.length; j++) { r[j] = gfMul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
      root = gfMul(root, 2);
    }
    return r;
  }
  function rsRemainder(data, div) {
    const r = div.map(() => 0);
    for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= gfMul(c, f); }); }
    return r;
  }
  function alignPositions(v, size) {
    if (v === 1) return [];
    const n = Math.floor(v / 7) + 2;
    const step = Math.floor((v * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
    const out = [6];
    for (let pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
    return out;
  }
  const bit = (x, i) => ((x >>> i) & 1) !== 0;

  function qrEncode(text, opts) {
    const o = opts || {};
    const bytes = text instanceof Uint8Array ? text : utf8(text);
    let v = 1;
    for (; v <= 40; v++) if (4 + (v <= 9 ? 8 : 16) + bytes.length * 8 <= dataCodewords(v) * 8) break;
    if (v > 40) throw new Error('That text is too long for a QR code.');
    if (o.minVersion && o.minVersion > v) v = Math.min(40, o.minVersion);
    const size = v * 4 + 17;
    // Data bits
    const bb = [];
    const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bb.push((val >>> i) & 1); };
    push(4, 4); push(bytes.length, v <= 9 ? 8 : 16);
    for (const b of bytes) push(b, 8);
    const cap = dataCodewords(v) * 8;
    push(0, Math.min(4, cap - bb.length));
    push(0, (8 - (bb.length % 8)) % 8);
    for (let pad = 0xec; bb.length < cap; pad ^= 0xec ^ 0x11) push(pad, 8);
    const data = [];
    for (let i = 0; i < bb.length; i += 8) { let x = 0; for (let j = 0; j < 8; j++) x = (x << 1) | bb[i + j]; data.push(x); }
    // Error correction and interleaving
    const nb = NUM_BLOCKS[v], ecl = ECC_PER_BLOCK[v], raw = Math.floor(rawModules(v) / 8);
    const nShort = nb - (raw % nb), shortLen = Math.floor(raw / nb), div = rsDivisor(ecl);
    const blocks = [];
    for (let i = 0, k = 0; i < nb; i++) {
      const dat = data.slice(k, k + shortLen - ecl + (i < nShort ? 0 : 1));
      k += dat.length;
      const ecc = rsRemainder(dat, div);
      if (i < nShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    const words = [];
    for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - ecl || j >= nShort) words.push(b[i]); });
    // Matrix
    const mods = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const setF = (x, y, d) => { mods[y][x] = d; fn[y][x] = true; };
    for (let i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) setF(x, y, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    const ap = alignPositions(v, size), na = ap.length;
    for (let i = 0; i < na; i++) for (let j = 0; j < na; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setF(ap[i] + dx, ap[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    const drawFormat = (mask) => {
      const d = (FORMAT_M << 3) | mask;
      let rem = d; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const bits = ((d << 10) | rem) ^ 0x5412;
      for (let i = 0; i <= 5; i++) setF(8, i, bit(bits, i));
      setF(8, 7, bit(bits, 6)); setF(8, 8, bit(bits, 7)); setF(7, 8, bit(bits, 8));
      for (let i = 9; i < 15; i++) setF(14 - i, 8, bit(bits, i));
      for (let i = 0; i < 8; i++) setF(size - 1 - i, 8, bit(bits, i));
      for (let i = 8; i < 15; i++) setF(8, size - 15 + i, bit(bits, i));
      setF(8, size - 8, true);
    };
    drawFormat(0);
    if (v >= 7) {
      let rem = v; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const bits = (v << 12) | rem;
      for (let i = 0; i < 18; i++) { const c = bit(bits, i), a = size - 11 + (i % 3), b = Math.floor(i / 3); setF(a, b, c); setF(b, a, c); }
    }
    // Codewords in the zigzag order
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
        if (!fn[y][x] && i < words.length * 8) { mods[y][x] = bit(words[i >>> 3], 7 - (i & 7)); i++; }
      }
    }
    const applyMask = (m) => {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        if (fn[y][x]) continue;
        let inv;
        switch (m) {
          case 0: inv = (x + y) % 2 === 0; break;
          case 1: inv = y % 2 === 0; break;
          case 2: inv = x % 3 === 0; break;
          case 3: inv = (x + y) % 3 === 0; break;
          case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: inv = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: inv = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: inv = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
        }
        if (inv) mods[y][x] = !mods[y][x];
      }
    };
    let mask = o.mask;
    if (mask == null) {
      let best = Infinity;
      for (let m = 0; m < 8; m++) {
        applyMask(m); drawFormat(m);
        const p = penalty(mods);
        if (p < best) { best = p; mask = m; }
        applyMask(m);
      }
    }
    applyMask(mask); drawFormat(mask);
    return { version: v, size, mask, modules: mods };
  }
  function penalty(m) {
    const n = m.length; let p = 0, dark = 0;
    const lineScore = (get) => {
      for (let a = 0; a < n; a++) {
        let run = 1;
        for (let b = 1; b <= n; b++) {
          if (b < n && get(a, b) === get(a, b - 1)) run++;
          else { if (run >= 5) p += 3 + run - 5; run = 1; }
        }
        for (let b = 0; b + 10 < n; b++) {
          const s = []; for (let k = 0; k < 11; k++) s.push(get(a, b + k) ? 1 : 0);
          const t = s.join('');
          if (t === '10111010000' || t === '00001011101') p += 40;
        }
      }
    };
    lineScore((a, b) => m[a][b]);
    lineScore((a, b) => m[b][a]);
    for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) { const c = m[y][x]; if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3; }
    for (const row of m) for (const c of row) if (c) dark++;
    const total = n * n;
    p += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return p;
  }
  // SVG with a four-module quiet zone, always black on white so it scans in either theme.
  function qrSvg(qr, opts) {
    const o = opts || {}, quiet = o.quiet == null ? 4 : o.quiet, dim = qr.size + quiet * 2;
    let d = '';
    for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.modules[y][x]) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    const px = o.pixels || dim * 4;
    const label = String(o.label || 'QR code').replace(/[&<>"']/g, '');
    return `<svg xmlns="http://www.w3.org/2000/svg" class="qr-svg" role="img" aria-label="${label}" width="${px}" height="${px}" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges"><rect width="${dim}" height="${dim}" fill="#ffffff"/><path d="${d}" fill="#000000"/></svg>`;
  }

  // ---------- Sealed storage ----------
  const ITERATIONS = 600000;
  const AAD = utf8('mvl-safety-sealed-v1');
  const b64 = (u8) => { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };
  const unb64 = (s) => { const t = atob(String(s)); const u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u; };
  async function deriveKey(passphrase, salt, iterations) {
    const base = await subtle().importKey('raw', utf8(String(passphrase).normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
    return subtle().deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function sealWithKey(obj, key, salt, iterations) {
    const iv = randomBytes(12);
    const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, key, utf8(JSON.stringify(obj))));
    return { format: 'mvl-sealed', v: 1, kdf: 'PBKDF2-SHA-256', iterations, cipher: 'AES-GCM-256', salt: b64(salt), iv: b64(iv), ct: b64(ct) };
  }
  async function seal(obj, passphrase, opts) {
    const iterations = (opts && opts.iterations) || ITERATIONS;
    const salt = randomBytes(16);
    const key = await deriveKey(passphrase, salt, iterations);
    return { box: await sealWithKey(obj, key, salt, iterations), key, salt, iterations };
  }
  function checkBox(box) {
    if (!box || box.format !== 'mvl-sealed' || box.v !== 1) throw new Error('This is not a sealed Material VM Labs file.');
    if (!Number.isInteger(box.iterations) || box.iterations < 100000 || box.iterations > 10000000) throw new Error('The sealed file has an unsupported key setting.');
  }
  async function openWithKey(box, key) {
    checkBox(box);
    let pt;
    try { pt = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(box.iv), additionalData: AAD }, key, unb64(box.ct)); }
    catch { throw new Error('The passphrase did not open it, or the file was changed.'); }
    return JSON.parse(new TextDecoder().decode(pt));
  }
  async function unseal(box, passphrase) {
    checkBox(box);
    const salt = unb64(box.salt);
    const key = await deriveKey(passphrase, salt, box.iterations);
    return { data: await openWithKey(box, key), key, salt, iterations: box.iterations };
  }

  // ---------- Credential hashing for toy locks ----------
  const HASH_ITER = 210000;
  async function hashSecret(value) {
    const salt = randomBytes(16);
    const base = await subtle().importKey('raw', utf8(String(value).normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await subtle().deriveBits({ name: 'PBKDF2', salt, iterations: HASH_ITER, hash: 'SHA-256' }, base, 256));
    return { alg: 'PBKDF2-SHA-256', iterations: HASH_ITER, salt: b64(salt), hash: b64(bits) };
  }
  async function verifySecret(value, rec) {
    if (!rec || !rec.salt || !rec.hash) return false;
    const base = await subtle().importKey('raw', utf8(String(value).normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await subtle().deriveBits({ name: 'PBKDF2', salt: unb64(rec.salt), iterations: rec.iterations || HASH_ITER, hash: 'SHA-256' }, base, 256));
    const want = unb64(rec.hash);
    let diff = bits.length ^ want.length;
    for (let i = 0; i < Math.min(bits.length, want.length); i++) diff |= bits[i] ^ want[i];
    return diff === 0;
  }

  return {
    base32Decode, base32Encode, cleanBase32, groupBase32, newSecret,
    hotp, totp, verifyTotp, clockOffset, normAlg, normDigits, normPeriod,
    parseOtpauth, buildOtpauth,
    qrEncode, qrSvg, qrDataCodewords: dataCodewords, qrRawModules: rawModules, qrBlocks: (v) => ({ ecc: ECC_PER_BLOCK[v], blocks: NUM_BLOCKS[v] }),
    seal, sealWithKey, unseal, openWithKey, ITERATIONS,
    hashSecret, verifySecret, randomBytes, b64, unb64
  };
});
