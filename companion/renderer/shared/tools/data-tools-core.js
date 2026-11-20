'use strict';
// Data tools core: pure, dependency-free functions shared by the Base64 toolkit, the file converter,
// the main-process same-folder bridge (base64-ipc.js) and the node tests. Nothing here touches the
// DOM, the network or the file system. Works as a browser global (window.MVLDataCore) and as a
// CommonJS module.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MVLDataCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // ---------------------------------------------------------------- Base64 -------------------------
  const STD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const URL_SAFE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const MIME_LINE = 76;

  class CodecError extends Error {
    constructor(code, message, offset) { super(message); this.code = code; this.offset = offset == null ? -1 : offset; }
  }

  function normOpts(o) {
    o = o || {};
    const lineLength = Math.max(0, Math.floor(Number(o.lineLength) || 0));
    return { alphabet: o.alphabet === 'url' ? 'url' : 'standard', pad: o.pad !== false, lineLength, eol: o.eol === '\n' ? '\n' : '\r\n', strict: o.strict === true };
  }

  // Streaming encoder: push() any number of byte chunks, then end(). Carries up to two bytes and
  // the current line column between chunks, so chunked output equals one-shot output exactly.
  function createEncoder(opts) {
    const o = normOpts(opts);
    const A = o.alphabet === 'url' ? URL_SAFE : STD;
    let carry = new Uint8Array(0), col = 0, started = false;
    function wrap(s) {
      if (!o.lineLength || !s) return s;
      let out = '';
      for (let i = 0; i < s.length;) {
        if (col === o.lineLength) { out += o.eol; col = 0; }
        const take = Math.min(o.lineLength - col, s.length - i);
        out += s.slice(i, i + take); col += take; i += take;
      }
      return out;
    }
    function quads(b, end) {
      const parts = [];
      let i = 0;
      for (; i + 3 <= end; i += 3) {
        const n = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
        parts.push(A[n >> 18 & 63] + A[n >> 12 & 63] + A[n >> 6 & 63] + A[n & 63]);
      }
      return parts.join('');
    }
    return {
      push(bytes) {
        bytes = toBytes(bytes);
        let b = bytes;
        if (carry.length) { b = new Uint8Array(carry.length + bytes.length); b.set(carry); b.set(bytes, carry.length); }
        const whole = b.length - (b.length % 3);
        const s = quads(b, whole);
        carry = b.slice(whole);
        if (s) started = true;
        return wrap(s);
      },
      end() {
        let s = '';
        if (carry.length === 1) { const n = carry[0] << 16; s = A[n >> 18 & 63] + A[n >> 12 & 63] + (o.pad ? '==' : ''); }
        else if (carry.length === 2) { const n = (carry[0] << 16) | (carry[1] << 8); s = A[n >> 18 & 63] + A[n >> 12 & 63] + A[n >> 6 & 63] + (o.pad ? '=' : ''); }
        carry = new Uint8Array(0);
        if (s) started = true;
        return started ? wrap(s) : '';
      }
    };
  }

  function encodeBase64(bytes, opts) { const e = createEncoder(opts); return e.push(bytes) + e.end(); }

  const REV_STD = new Int16Array(128).fill(-1), REV_URL = new Int16Array(128).fill(-1), REV_ANY = new Int16Array(128).fill(-1);
  for (let i = 0; i < 64; i++) { REV_STD[STD.charCodeAt(i)] = i; REV_URL[URL_SAFE.charCodeAt(i)] = i; REV_ANY[STD.charCodeAt(i)] = i; REV_ANY[URL_SAFE.charCodeAt(i)] = i; }
  const isWs = (c) => c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 11;
  function charLabel(ch) { const cp = ch.codePointAt(0); return `"${cp < 32 || cp === 127 ? '?' : ch}" (U+${cp.toString(16).toUpperCase().padStart(4, '0')})`; }

  // Streaming decoder. Strict: only the chosen alphabet, line breaks (so MIME output decodes) and
  // correct final padding; anything else fails with the exact character offset. Lenient: ignores all
  // whitespace, accepts either alphabet and missing padding. Offsets count UTF-16 code units of the
  // whole input across every push().
  function createDecoder(opts) {
    const o = normOpts(opts);
    const rev = o.strict ? (o.alphabet === 'url' ? REV_URL : REV_STD) : REV_ANY;
    const acc = [0, 0, 0, 0];
    let n = 0, pos = 0, padSeen = 0, padAt = -1, significant = 0, lastSigAt = -1, lastSextet = 0, any = false;
    function push(str) {
      str = String(str);
      const out = new Uint8Array(Math.ceil(str.length * 3 / 4) + 3);
      let w = 0;
      for (let i = 0; i < str.length; i++, pos++) {
        const c = str.charCodeAt(i);
        if (c === 10 || c === 13) continue;
        if (isWs(c)) { if (o.strict) throw new CodecError('invalid-char', `Invalid character ${charLabel(str[i])} at offset ${pos}. Strict mode accepts line breaks but no other whitespace.`, pos); continue; }
        any = true;
        if (c === 61) { // '='
          if (o.strict && !o.pad) throw new CodecError('padding-unexpected', `Padding "=" at offset ${pos} but padding is off.`, pos);
          if (padSeen === 0) { if (n < 2) throw new CodecError('padding-misplaced', `Padding "=" at offset ${pos} comes too early in its four-character group.`, pos); padAt = pos; }
          padSeen++;
          if (padSeen + n > 4) throw new CodecError('padding-misplaced', `Too much padding at offset ${pos}.`, pos);
          continue;
        }
        const v = c < 128 ? rev[c] : -1;
        if (v < 0) { const ch = String.fromCodePoint(str.codePointAt(i)); throw new CodecError('invalid-char', `Invalid character ${charLabel(ch)} at offset ${pos}.`, pos); }
        if (padSeen) throw new CodecError('padding-misplaced', `Data at offset ${pos} follows padding at offset ${padAt}.`, pos);
        acc[n++] = v; significant++; lastSigAt = pos; lastSextet = v;
        if (n === 4) {
          out[w++] = (acc[0] << 2) | (acc[1] >> 4); out[w++] = ((acc[1] & 15) << 4) | (acc[2] >> 2); out[w++] = ((acc[2] & 3) << 6) | acc[3];
          n = 0;
        }
      }
      return out.subarray(0, w);
    }
    function end() {
      if (!any) throw new CodecError('empty', 'There is no Base64 to decode.', 0);
      if (n === 1) throw new CodecError('truncated', `The data ends with a single character at offset ${lastSigAt}; a group needs at least two.`, lastSigAt);
      if (n === 0 && padSeen) throw new CodecError('padding-misplaced', `Padding at offset ${padAt} has no data before it in its group.`, padAt);
      if (n > 0 && o.strict && o.pad && n + padSeen !== 4) throw new CodecError('padding-missing', `Padding is missing at offset ${pos}: expected ${4 - n - padSeen} more "=".`, pos);
      if (n > 0 && o.strict && ((n === 2 && (lastSextet & 15)) || (n === 3 && (lastSextet & 3)))) throw new CodecError('trailing-bits', `Unused bits are not zero in the character at offset ${lastSigAt}.`, lastSigAt);
      const out = new Uint8Array(3); let w = 0;
      if (n >= 2) out[w++] = (acc[0] << 2) | (acc[1] >> 4);
      if (n >= 3) out[w++] = ((acc[1] & 15) << 4) | (acc[2] >> 2);
      n = 0;
      return out.subarray(0, w);
    }
    return { push, end, significant: () => significant };
  }

  function decodeBase64(text, opts) {
    const d = createDecoder(opts);
    const a = d.push(text), b = d.end();
    return concatBytes([a, b]);
  }

  // Safe wrapper for UIs: never throws, never returns partial output with an error.
  function tryDecodeBase64(text, opts) {
    try { return { ok: true, bytes: decodeBase64(text, opts) }; }
    catch (e) { if (e instanceof CodecError) return { ok: false, code: e.code, offset: e.offset, message: e.message }; throw e; }
  }

  // ---------------------------------------------------------------- bytes and text ---------------
  function toBytes(x) {
    if (x instanceof Uint8Array) return x;
    if (x instanceof ArrayBuffer) return new Uint8Array(x);
    if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
    if (Array.isArray(x)) return Uint8Array.from(x);
    throw new TypeError('Expected bytes.');
  }
  function concatBytes(list) {
    let len = 0; for (const b of list) len += b.length;
    const out = new Uint8Array(len); let o = 0; for (const b of list) { out.set(b, o); o += b.length; }
    return out;
  }
  function bytesEqual(a, b) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }

  const ENCODINGS = ['utf-8', 'utf-16le', 'utf-16be', 'latin1'];
  const ENCODING_LABELS = { 'utf-8': 'UTF-8', 'utf-16le': 'UTF-16 LE', 'utf-16be': 'UTF-16 BE', latin1: 'Latin-1 (ISO-8859-1)' };

  function encodeText(str, enc, opts) {
    str = String(str); enc = enc || 'utf-8';
    const bom = opts && opts.bom;
    if (enc === 'utf-8') {
      const b = new TextEncoder().encode(str);
      return bom ? concatBytes([Uint8Array.of(0xEF, 0xBB, 0xBF), b]) : b;
    }
    if (enc === 'utf-16le' || enc === 'utf-16be') {
      const le = enc === 'utf-16le', off = bom ? 2 : 0;
      const out = new Uint8Array(str.length * 2 + off);
      if (bom) { out[0] = le ? 0xFF : 0xFE; out[1] = le ? 0xFE : 0xFF; }
      for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); out[off + 2 * i + (le ? 0 : 1)] = c & 255; out[off + 2 * i + (le ? 1 : 0)] = c >> 8; }
      return out;
    }
    if (enc === 'latin1') {
      const out = new Uint8Array(str.length);
      for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        if (c > 255) throw new CodecError('unencodable', `Character ${charLabel(String.fromCodePoint(str.codePointAt(i)))} at offset ${i} has no Latin-1 byte.`, i);
        out[i] = c;
      }
      return out;
    }
    throw new CodecError('unsupported-encoding', `The text encoding "${enc}" is not supported. Choose UTF-8, UTF-16 LE, UTF-16 BE or Latin-1.`);
  }

  // Returns the byte offset of the first invalid UTF-8 sequence, or -1.
  function utf8InvalidAt(b) {
    for (let i = 0; i < b.length;) {
      const c = b[i];
      if (c < 0x80) { i++; continue; }
      let need, min;
      if (c >= 0xC2 && c <= 0xDF) { need = 1; min = 0x80; }
      else if (c >= 0xE0 && c <= 0xEF) { need = 2; min = 0x800; }
      else if (c >= 0xF0 && c <= 0xF4) { need = 3; min = 0x10000; }
      else return i;
      let cp = c & (0x3F >> need);
      for (let k = 1; k <= need; k++) { const x = b[i + k]; if (x === undefined || (x & 0xC0) !== 0x80) return i; cp = (cp << 6) | (x & 0x3F); }
      if (cp < min || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return i;
      i += need + 1;
    }
    return -1;
  }

  function decodeText(bytes, enc) {
    bytes = toBytes(bytes); enc = enc || 'utf-8';
    if (enc === 'utf-8') {
      const bad = utf8InvalidAt(bytes);
      if (bad >= 0) throw new CodecError('invalid-text', `The bytes are not valid UTF-8 at byte ${bad}. Try another text encoding or preview as hex.`, bad);
      return new TextDecoder('utf-8', { ignoreBOM: false }).decode(bytes);
    }
    if (enc === 'utf-16le' || enc === 'utf-16be') {
      if (bytes.length % 2) throw new CodecError('invalid-text', `UTF-16 needs an even number of bytes; this has ${bytes.length}.`, bytes.length - 1);
      const le = enc === 'utf-16le';
      let start = 0;
      if (bytes.length >= 2 && ((le && bytes[0] === 0xFF && bytes[1] === 0xFE) || (!le && bytes[0] === 0xFE && bytes[1] === 0xFF))) start = 2;
      const parts = []; let chunk = [];
      for (let i = start; i < bytes.length; i += 2) {
        chunk.push(le ? bytes[i] | (bytes[i + 1] << 8) : (bytes[i] << 8) | bytes[i + 1]);
        if (chunk.length === 8192) { parts.push(String.fromCharCode.apply(null, chunk)); chunk = []; }
      }
      parts.push(String.fromCharCode.apply(null, chunk));
      return parts.join('');
    }
    if (enc === 'latin1') {
      const parts = [];
      for (let i = 0; i < bytes.length; i += 8192) parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)));
      return parts.join('');
    }
    throw new CodecError('unsupported-encoding', `The text encoding "${enc}" is not supported.`);
  }

  // ---------------------------------------------------------------- data: URLs ---------------------
  function buildDataUrl(bytes, mime, params, opts) {
    mime = String(mime || 'application/octet-stream').trim().toLowerCase();
    if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mime)) throw new CodecError('bad-mime', `"${mime}" is not a valid MIME type.`);
    let meta = mime;
    for (const [k, v] of Object.entries(params || {})) {
      if (!/^[a-z0-9!#$&^_.+-]+$/i.test(k)) throw new CodecError('bad-mime', `"${k}" is not a valid parameter name.`);
      meta += ';' + k + '=' + (/^[A-Za-z0-9!#$&^_.+-]+$/.test(v) ? v : encodeURIComponent(v));
    }
    return 'data:' + meta + ';base64,' + encodeBase64(bytes, { alphabet: 'standard', pad: true, lineLength: (opts && opts.lineLength) || 0 });
  }

  function percentDecodeBytes(s) {
    const out = [];
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c === 37 && /^[0-9a-fA-F]{2}$/.test(s.substr(i + 1, 2))) { out.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; }
      else if (c < 128) out.push(c);
      else for (const b of new TextEncoder().encode(String.fromCodePoint(s.codePointAt(i)))) { out.push(b); if (c >= 0xD800 && c <= 0xDBFF) { i++; break; } }
    }
    return Uint8Array.from(out);
  }

  function parseDataUrl(str) {
    const s = String(str).trim();
    const m = /^data:([^,]*),([\s\S]*)$/i.exec(s);
    if (!m) throw new CodecError('not-data-url', 'This is not a data: URL. It must start with "data:" and contain a comma.');
    const meta = m[1].split(';').map((x) => x.trim());
    let base64 = false;
    if (meta.length > 1 && meta[meta.length - 1].toLowerCase() === 'base64') { base64 = true; meta.pop(); }
    let mime = (meta.shift() || '').toLowerCase();
    const params = {};
    for (const p of meta) { if (!p) continue; const eq = p.indexOf('='); if (eq > 0) { let v = p.slice(eq + 1); try { v = decodeURIComponent(v); } catch { /* keep raw */ } params[p.slice(0, eq).toLowerCase()] = v; } }
    if (!mime) { mime = 'text/plain'; if (!params.charset) params.charset = 'US-ASCII'; }
    let bytes;
    if (base64) {
      const raw = percentDecodeBytes(m[2]);
      const r = tryDecodeBase64(decodeText(raw, 'latin1'), { strict: false });
      if (!r.ok) { const off = m[2] ? s.indexOf(',') + 1 + Math.max(0, r.offset) : 0; throw new CodecError(r.code, r.message.replace(/offset \d+/, 'offset ' + off), off); }
      bytes = r.bytes;
    } else bytes = percentDecodeBytes(m[2]);
    return { mime, params, base64, bytes };
  }

  // ---------------------------------------------------------------- hashing -----------------------
  const K256 = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  // Incremental SHA-256 so files of any size hash chunk by chunk in constant memory.
  function createSha256() {
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const W = new Uint32Array(64), buf = new Uint8Array(64);
    let bl = 0, total = 0, done = false;
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    function block(b, o) {
      for (let i = 0; i < 16; i++) W[i] = (b[o + 4 * i] << 24) | (b[o + 4 * i + 1] << 16) | (b[o + 4 * i + 2] << 8) | b[o + 4 * i + 3];
      for (let i = 16; i < 64; i++) { const a = W[i - 15], c = W[i - 2]; W[i] = (W[i - 16] + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + W[i - 7] + (rotr(c, 17) ^ rotr(c, 19) ^ (c >>> 10))) >>> 0; }
      let [a, bb, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + W[i]) >>> 0;
        const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & bb) ^ (a & c) ^ (bb & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = bb; bb = a; a = (t1 + t2) >>> 0;
      }
      H[0] += a; H[1] += bb; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    return {
      update(bytes) {
        if (done) throw new Error('This hash is already finished.');
        bytes = toBytes(bytes); total += bytes.length;
        let i = 0;
        if (bl) { const t = Math.min(64 - bl, bytes.length); buf.set(bytes.subarray(0, t), bl); bl += t; i = t; if (bl === 64) { block(buf, 0); bl = 0; } }
        for (; i + 64 <= bytes.length; i += 64) block(bytes, i);
        if (i < bytes.length) { buf.set(bytes.subarray(i), 0); bl = bytes.length - i; }
        return this;
      },
      hex() {
        if (!done) {
          done = true;
          const bits = total * 8;
          buf[bl++] = 0x80;
          if (bl > 56) { buf.fill(0, bl); block(buf, 0); bl = 0; }
          buf.fill(0, bl, 56);
          const hi = Math.floor(bits / 0x100000000), lo = bits >>> 0;
          buf[56] = hi >>> 24; buf[57] = hi >>> 16; buf[58] = hi >>> 8; buf[59] = hi; buf[60] = lo >>> 24; buf[61] = lo >>> 16; buf[62] = lo >>> 8; buf[63] = lo;
          block(buf, 0);
        }
        return Array.from(H, (x) => x.toString(16).padStart(8, '0')).join('');
      }
    };
  }
  const sha256Hex = (bytes) => createSha256().update(bytes).hex();

  const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(bytes, prev) { let c = (prev == null ? 0 : prev) ^ 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

  // ---------------------------------------------------------------- type detection ----------------
  const SNIFF_BYTES = 4096;
  const T = (id, mime, ext, label, category) => ({ id, mime, ext, label, category });
  function startsWith(b, sig, at) { at = at || 0; if (b.length < at + sig.length) return false; for (let i = 0; i < sig.length; i++) if (sig[i] !== null && b[at + i] !== sig[i]) return false; return true; }
  const ascii = (b, at, s) => startsWith(b, Array.from(s, (c) => c.charCodeAt(0)), at);

  // Bounded byte-signature inspection: only the first SNIFF_BYTES bytes are examined. The name is
  // used only to refine plain text (CSV, TSV, YAML, Base64 text), never to override a signature.
  function detectType(bytesIn, name) {
    const b = toBytes(bytesIn).subarray(0, SNIFF_BYTES);
    const ext = String(name || '').toLowerCase().split('.').pop();
    if (!b.length) return T('empty', 'application/octet-stream', 'bin', 'Empty file', 'binary');
    if (startsWith(b, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) return T('png', 'image/png', 'png', 'PNG image', 'images');
    if (startsWith(b, [0xFF, 0xD8, 0xFF])) return T('jpeg', 'image/jpeg', 'jpg', 'JPEG image', 'images');
    if (ascii(b, 0, 'GIF87a') || ascii(b, 0, 'GIF89a')) return T('gif', 'image/gif', 'gif', 'GIF image', 'images');
    if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) return T('webp', 'image/webp', 'webp', 'WebP image', 'images');
    if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WAVE')) return T('wav', 'audio/wav', 'wav', 'WAV audio', 'audio');
    if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'AVI ')) return T('avi', 'video/x-msvideo', 'avi', 'AVI video', 'video');
    if (ascii(b, 0, 'BM') && b.length >= 26 && (b[14] === 12 || b[14] === 40 || b[14] === 56 || b[14] === 108 || b[14] === 124)) return T('bmp', 'image/bmp', 'bmp', 'BMP image', 'images');
    if (startsWith(b, [0x00, 0x00, 0x01, 0x00])) return T('ico', 'image/x-icon', 'ico', 'Windows icon', 'images');
    if (startsWith(b, [0x49, 0x49, 0x2A, 0x00]) || startsWith(b, [0x4D, 0x4D, 0x00, 0x2A])) return T('tiff', 'image/tiff', 'tif', 'TIFF image', 'images');
    if (ascii(b, 4, 'ftyp')) {
      const brand = String.fromCharCode(...b.subarray(8, 12));
      if (/^(heic|heix|hevc|mif1|msf1)$/.test(brand)) return T('heic', 'image/heic', 'heic', 'HEIC image', 'images');
      if (/^avi[fs]$/.test(brand)) return T('avif', 'image/avif', 'avif', 'AVIF image', 'images');
      if (/^M4A /.test(brand)) return T('m4a', 'audio/mp4', 'm4a', 'MPEG-4 audio', 'audio');
      if (/^qt  $/.test(brand)) return T('mov', 'video/quicktime', 'mov', 'QuickTime video', 'video');
      return T('mp4', 'video/mp4', 'mp4', 'MPEG-4 video', 'video');
    }
    if (startsWith(b, [0x1A, 0x45, 0xDF, 0xA3])) return /webm/.test(String.fromCharCode(...b.subarray(0, 64))) ? T('webm', 'video/webm', 'webm', 'WebM video', 'video') : T('mkv', 'video/x-matroska', 'mkv', 'Matroska video', 'video');
    if (ascii(b, 0, 'OggS')) return T('ogg', 'audio/ogg', 'ogg', 'Ogg audio', 'audio');
    if (ascii(b, 0, 'fLaC')) return T('flac', 'audio/flac', 'flac', 'FLAC audio', 'audio');
    if (ascii(b, 0, 'ID3') || (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0 && (b[1] & 0x06) !== 0)) return T('mp3', 'audio/mpeg', 'mp3', 'MP3 audio', 'audio');
    if (ascii(b, 0, '%PDF-')) return T('pdf', 'application/pdf', 'pdf', 'PDF document', 'documents');
    if (ascii(b, 0, '{\\rtf')) return T('rtf', 'application/rtf', 'rtf', 'Rich Text document', 'documents');
    if (startsWith(b, [0x50, 0x4B, 0x03, 0x04]) || startsWith(b, [0x50, 0x4B, 0x05, 0x06])) {
      const head = String.fromCharCode(...b.subarray(0, Math.min(b.length, 2048)));
      if (head.includes('word/')) return T('docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx', 'Word document', 'documents');
      if (head.includes('xl/')) return T('xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx', 'Excel workbook', 'structured');
      if (head.includes('ppt/')) return T('pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx', 'PowerPoint deck', 'documents');
      if (head.includes('mimetypeapplication/vnd.oasis.opendocument')) return T('odf', 'application/vnd.oasis.opendocument.text', 'odt', 'OpenDocument file', 'documents');
      return T('zip', 'application/zip', 'zip', 'ZIP archive', 'archives');
    }
    if (startsWith(b, [0x1F, 0x8B])) return T('gzip', 'application/gzip', 'gz', 'Gzip archive', 'archives');
    if (startsWith(b, [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C])) return T('7z', 'application/x-7z-compressed', '7z', '7-Zip archive', 'archives');
    if (ascii(b, 0, 'Rar!')) return T('rar', 'application/vnd.rar', 'rar', 'RAR archive', 'archives');
    if (b.length > 262 && ascii(b, 257, 'ustar')) return T('tar', 'application/x-tar', 'tar', 'Tar archive', 'archives');
    if (startsWith(b, [0x42, 0x5A, 0x68])) return T('bzip2', 'application/x-bzip2', 'bz2', 'Bzip2 archive', 'archives');
    if (startsWith(b, [0xFD, 0x37, 0x7A, 0x58, 0x5A, 0x00])) return T('xz', 'application/x-xz', 'xz', 'XZ archive', 'archives');
    if (startsWith(b, [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])) return T('ole', 'application/x-ole-storage', 'doc', 'Legacy Office document', 'documents');
    if (ascii(b, 0, 'MZ')) return T('exe', 'application/vnd.microsoft.portable-executable', 'exe', 'Windows program (never run here)', 'binary');
    if (startsWith(b, [0x7F, 0x45, 0x4C, 0x46])) return T('elf', 'application/x-elf', 'elf', 'Linux program (never run here)', 'binary');
    if (startsWith(b, [0x00, 0x61, 0x73, 0x6D])) return T('wasm', 'application/wasm', 'wasm', 'WebAssembly module', 'binary');
    if (ascii(b, 0, 'SQLite format 3')) return T('sqlite', 'application/vnd.sqlite3', 'sqlite', 'SQLite database', 'binary');
    // Text: a byte-order mark, or valid UTF-8 with no NUL bytes in the inspected window.
    let textEnc = null;
    if (startsWith(b, [0xFF, 0xFE])) textEnc = 'utf-16le';
    else if (startsWith(b, [0xFE, 0xFF])) textEnc = 'utf-16be';
    else {
      let cut = b;
      if (b.length === SNIFF_BYTES) { let k = b.length; while (k > 0 && k > b.length - 4 && (b[k - 1] & 0xC0) === 0x80) k--; if (k > 0 && b[k - 1] >= 0xC0) k--; cut = b.subarray(0, k); }
      if (!cut.includes(0) && utf8InvalidAt(cut) < 0) textEnc = 'utf-8';
    }
    if (!textEnc) return T('binary', 'application/octet-stream', 'bin', 'Unknown binary data', 'binary');
    let head = '';
    try { head = decodeText(textEnc === 'utf-8' ? b.subarray(0, b.length - (b.length === SNIFF_BYTES ? 4 : 0)) : b.subarray(0, b.length - (b.length % 2)), textEnc); } catch { head = ''; }
    head = head.replace(/^\uFEFF/, '');
    const t = head.trimStart();
    const mk = (id, mime, e, label, cat) => Object.assign(T(id, mime, e, label, cat || 'text'), { encoding: textEnc });
    if (/^<svg[\s>]/i.test(t) || (/^<\?xml/i.test(t) && /<svg[\s>]/i.test(t))) return mk('svg', 'image/svg+xml', 'svg', 'SVG drawing (shown as text, never run)');
    if (/^<!doctype html|^<html[\s>]/i.test(t)) return mk('html', 'text/html', 'html', 'HTML page (shown as text, never run)');
    if (/^<\?xml|^<[A-Za-z_][\w.-]*[\s>/]/.test(t)) return mk('xml', 'application/xml', 'xml', 'XML document', 'structured');
    if (/^data:[^,]*,/i.test(t)) return mk('dataurl', 'text/plain', 'txt', 'data: URL text');
    if (/^[{[]/.test(t)) { if (b.length < SNIFF_BYTES) { try { JSON.parse(head); return mk('json', 'application/json', 'json', 'JSON data', 'structured'); } catch { /* not JSON */ } } else return mk('json', 'application/json', 'json', 'JSON data (by its start)', 'structured'); }
    if (ext === 'csv') return mk('csv', 'text/csv', 'csv', 'CSV table', 'structured');
    if (ext === 'tsv' || ext === 'tab') return mk('tsv', 'text/tab-separated-values', 'tsv', 'TSV table', 'structured');
    if (ext === 'yaml' || ext === 'yml') return mk('yaml', 'application/yaml', 'yaml', 'YAML document', 'structured');
    if (ext === 'b64' || /\.base64\.txt$/i.test(String(name || ''))) return mk('b64text', 'text/plain', 'txt', 'Base64 text');
    if (ext === 'hex') return mk('hextext', 'text/plain', 'hex', 'Hex text');
    return mk('text', 'text/plain', 'txt', textEnc === 'utf-8' ? 'Plain text' : 'Plain text (' + ENCODING_LABELS[textEnc] + ')');
  }

  const MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/svg+xml': 'svg', 'image/x-icon': 'ico', 'application/pdf': 'pdf', 'application/zip': 'zip', 'application/gzip': 'gz', 'application/json': 'json', 'text/plain': 'txt', 'text/csv': 'csv', 'text/html': 'html', 'application/xml': 'xml', 'text/xml': 'xml', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'video/mp4': 'mp4', 'video/webm': 'webm', 'application/octet-stream': 'bin' };
  const extForMime = (mime) => MIME_EXT[String(mime || '').toLowerCase().split(';')[0].trim()] || 'bin';

  function hexDump(bytesIn, max) {
    const b = toBytes(bytesIn).subarray(0, max || 4096);
    const lines = [];
    for (let i = 0; i < b.length; i += 16) {
      const row = b.subarray(i, i + 16);
      const hex = Array.from(row, (x) => x.toString(16).padStart(2, '0')).join(' ');
      const txt = Array.from(row, (x) => (x >= 32 && x < 127 ? String.fromCharCode(x) : '.')).join('');
      lines.push(i.toString(16).padStart(8, '0') + '  ' + hex.padEnd(47, ' ') + '  |' + txt + '|');
    }
    return lines.join('\n');
  }

  // ---------------------------------------------------------------- names -------------------------
  const B64_SUFFIX = '.base64.txt';
  function base64NameFor(name) { return String(name) + B64_SUFFIX; }
  // The original name for a Base64 text file, from the name pattern only; null when it carries none.
  function restoreName(name) {
    const s = String(name);
    if (s.toLowerCase().endsWith(B64_SUFFIX) && s.length > B64_SUFFIX.length) return s.slice(0, -B64_SUFFIX.length);
    if (/\.b64$/i.test(s) && s.length > 4) { const r = s.slice(0, -4); return /\.[A-Za-z0-9]{1,8}$/.test(r) ? r : null; }
    return null;
  }
  function numberedName(name, n) {
    const s = String(name);
    if (s.toLowerCase().endsWith(B64_SUFFIX) && s.length > B64_SUFFIX.length) return s.slice(0, -B64_SUFFIX.length) + ` (${n})` + s.slice(-B64_SUFFIX.length);
    const dot = s.lastIndexOf('.');
    return dot > 0 ? s.slice(0, dot) + ` (${n})` + s.slice(dot) : s + ` (${n})`;
  }
  // existsFn(name) -> boolean (sync). Never returns a name that exists.
  function uniqueName(name, existsFn, limit) {
    if (!existsFn(name)) return name;
    for (let n = 1; n <= (limit || 100000); n++) { const c = numberedName(name, n); if (!existsFn(c)) return c; }
    throw new CodecError('no-free-name', `No free name was found for ${name}.`);
  }
  function safeFileName(name) {
    const s = String(name || '').split(/[\\/]/).pop().replace(/[\u0000-\u001f<>:"|?*]/g, '_').replace(/^\.+$/, '_').trim();
    return s.slice(0, 200) || 'file';
  }

  // ---------------------------------------------------------------- text conversions --------------
  function countLineEndings(text) {
    const s = String(text); let crlf = 0, lf = 0, cr = 0;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c === 13) { if (s.charCodeAt(i + 1) === 10) { crlf++; i++; } else cr++; } else if (c === 10) lf++; }
    return { crlf, lf, cr };
  }
  function convertLineEndings(text, to) {
    const eol = to === 'crlf' ? '\r\n' : to === 'cr' ? '\r' : '\n';
    return String(text).replace(/\r\n|\r|\n/g, eol);
  }

  // ---------------------------------------------------------------- hex and binary text -----------
  function toHex(bytesIn, opts) {
    const b = toBytes(bytesIn); const o = opts || {}; const per = o.lineBytes || 0;
    const parts = [];
    for (let i = 0; i < b.length; i++) { let h = b[i].toString(16).padStart(2, '0'); if (o.upper) h = h.toUpperCase(); parts.push(h); }
    if (!per) return parts.join(o.sep == null ? '' : o.sep);
    const lines = []; for (let i = 0; i < parts.length; i += per) lines.push(parts.slice(i, i + per).join(o.sep == null ? ' ' : o.sep));
    return lines.join('\n');
  }
  function fromHex(text) {
    const s = String(text); const out = []; let hi = -1, hiAt = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (/\s|:|,/.test(c)) continue;
      if ((c === 'x' || c === 'X') && hi === 0 && s[i - 1] === '0') { hi = -1; continue; }
      const v = parseInt(c, 16);
      if (Number.isNaN(v)) throw new CodecError('invalid-char', `Invalid hex character ${charLabel(c)} at offset ${i}.`, i);
      if (hi < 0) { hi = v; hiAt = i; } else { out.push(hi * 16 + v); hi = -1; }
    }
    if (hi >= 0) throw new CodecError('truncated', `A lone hex digit at offset ${hiAt}; hex needs pairs.`, hiAt);
    return Uint8Array.from(out);
  }
  function toBinaryText(bytesIn) { return Array.from(toBytes(bytesIn), (x) => x.toString(2).padStart(8, '0')).join(' '); }
  function fromBinaryText(text) {
    const s = String(text); const out = []; let cur = 0, n = 0, startAt = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (/\s/.test(c)) continue;
      if (c !== '0' && c !== '1') throw new CodecError('invalid-char', `Invalid binary character ${charLabel(c)} at offset ${i}.`, i);
      if (!n) startAt = i;
      cur = cur * 2 + (c === '1' ? 1 : 0); n++;
      if (n === 8) { out.push(cur); cur = 0; n = 0; }
    }
    if (n) throw new CodecError('truncated', `An incomplete group of ${n} bits starts at offset ${startAt}; bytes need 8.`, startAt);
    return Uint8Array.from(out);
  }

  // ---------------------------------------------------------------- CSV / TSV ---------------------
  function parseDelimited(text, delim) {
    const s = String(text).replace(/^\uFEFF/, ''); delim = delim || ',';
    const rows = []; let row = [], field = '', i = 0, quoted = false, quoteAt = -1;
    while (i < s.length) {
      const c = s[i];
      if (quoted) {
        if (c === '"') { if (s[i + 1] === '"') { field += '"'; i += 2; continue; } quoted = false; i++; if (i < s.length && s[i] !== delim && s[i] !== '\n' && s[i] !== '\r') throw new CodecError('csv', `Unexpected character after a closing quote at offset ${i}.`, i); continue; }
        field += c; i++; continue;
      }
      if (c === '"' && field === '') { quoted = true; quoteAt = i; i++; continue; }
      if (c === delim) { row.push(field); field = ''; i++; continue; }
      if (c === '\r' || c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i += c === '\r' && s[i + 1] === '\n' ? 2 : 1; continue; }
      field += c; i++;
    }
    if (quoted) throw new CodecError('csv', `A quoted field that starts at offset ${quoteAt} never closes.`, quoteAt);
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }
  function stringifyDelimited(rows, delim, eol) {
    delim = delim || ','; eol = eol || '\r\n';
    const needs = new RegExp(`["\\r\\n${delim === '\t' ? '\\t' : delim.replace(/[\\^$.*+?()[\]{}|-]/g, '\\$&')}]|^\\s|\\s$`);
    return rows.map((r) => r.map((v) => { const s = v == null ? '' : String(v); return needs.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(delim)).join(eol) + (rows.length ? eol : '');
  }
  function rowsToObjects(rows) {
    if (!rows.length) return [];
    const seen = new Map();
    const head = rows[0].map((h, i) => { let k = String(h).trim() || 'column_' + (i + 1); const n = (seen.get(k) || 0) + 1; seen.set(k, n); return n > 1 ? k + '_' + n : k; });
    return rows.slice(1).filter((r) => !(r.length === 1 && r[0] === '')).map((r) => { const o = {}; head.forEach((k, i) => { o[k] = r[i] == null ? '' : r[i]; }); return o; });
  }
  function objectsToRows(value) {
    if (!Array.isArray(value)) throw new CodecError('shape', 'A table needs a JSON array of objects (or of arrays) at the top level.');
    if (value.every((r) => Array.isArray(r))) return { rows: value.map((r) => r.map(cell)), nested: value.some((r) => r.some(isNested)) };
    if (!value.every((r) => r && typeof r === 'object' && !Array.isArray(r))) throw new CodecError('shape', 'Every row must be an object; mixed rows cannot become one table.');
    const keys = []; const ks = new Set();
    for (const r of value) for (const k of Object.keys(r)) if (!ks.has(k)) { ks.add(k); keys.push(k); }
    let nested = false;
    const rows = [keys].concat(value.map((r) => keys.map((k) => { if (isNested(r[k])) nested = true; return k in r ? cell(r[k]) : ''; })));
    return { rows, nested };
  }
  function isNested(v) { return v !== null && typeof v === 'object'; }
  function cell(v) { return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); }

  // ---------------------------------------------------------------- YAML (a documented subset) ----
  const YAML_RESERVED = /^(true|false|null|yes|no|on|off|y|n|~|True|False|Null|TRUE|FALSE|NULL|Yes|No|On|Off|YES|NO|ON|OFF)$/;
  const NUM = /^[-+]?(\d+|\d*\.\d+|\d+\.\d*)([eE][-+]?\d+)?$/;
  function yamlScalarOut(v) {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'boolean') return String(v);
    if (typeof v === 'number') { if (!Number.isFinite(v)) throw new CodecError('yaml', 'Infinity and NaN have no JSON form.'); return String(v); }
    const s = String(v);
    if (/^[A-Za-z_][A-Za-z0-9_ ./()-]*$/.test(s) && !/ $/.test(s) && !YAML_RESERVED.test(s) && !NUM.test(s) && !/ #|: /.test(s)) return s;
    return JSON.stringify(s);
  }
  function yamlKeyOut(k) { const s = String(k); return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(s) && !YAML_RESERVED.test(s) ? s : JSON.stringify(s); }
  function toYaml(value) {
    const lines = [];
    const emptyColl = (v) => (Array.isArray(v) ? (v.length ? null : '[]') : v && typeof v === 'object' ? (Object.keys(v).length ? null : '{}') : null);
    function emit(v, ind, prefix) {
      const pad = ' '.repeat(ind);
      if (Array.isArray(v)) {
        for (const item of v) {
          const ec = emptyColl(item);
          if (ec || !isNested(item)) lines.push(pad + '- ' + (ec || yamlScalarOut(item)));
          else if (Array.isArray(item)) { lines.push(pad + '-'); emit(item, ind + 2); }
          else emit(item, ind + 2, pad + '- ');
        }
        return;
      }
      let first = true;
      for (const [k, val] of Object.entries(v)) {
        const lead = first && prefix ? prefix : pad; first = false;
        const ec = emptyColl(val);
        if (ec || !isNested(val)) lines.push(lead + yamlKeyOut(k) + ': ' + (ec || yamlScalarOut(val)));
        else { lines.push(lead + yamlKeyOut(k) + ':'); emit(val, ind + 2); }
      }
    }
    const ec = emptyColl(value);
    if (ec || !isNested(value)) return (ec || yamlScalarOut(value)) + '\n';
    emit(value, 0);
    return lines.join('\n') + '\n';
  }

  function parseYaml(text) {
    const raw = String(text).replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
    const lines = [];
    raw.forEach((l, idx) => {
      const no = idx + 1;
      if (/^\t| \t/.test(l.match(/^[ \t]*/)[0])) throw new CodecError('yaml', `Line ${no}: tabs cannot indent YAML.`);
      const content = stripYamlComment(l, no);
      if (!content.trim()) return;
      if (/^---\s*$/.test(content)) { if (lines.length) throw new CodecError('yaml', `Line ${no}: more than one document is not supported.`); return; }
      if (/^\.\.\.\s*$/.test(content)) return;
      if (/^%/.test(content)) throw new CodecError('yaml', `Line ${no}: YAML directives are not supported.`);
      const indent = content.match(/^ */)[0].length;
      lines.push({ indent, text: content.slice(indent).replace(/\s+$/, ''), no });
    });
    if (!lines.length) return null;
    let i = 0;
    function isSeq(t) { return t === '-' || t.startsWith('- '); }
    function keySplit(t, no) {
      let key, rest;
      if (t[0] === '"' || t[0] === "'") {
        const end = t[0] === '"' ? findDq(t) : findSq(t);
        if (end < 0) throw new CodecError('yaml', `Line ${no}: a quoted key never closes.`);
        key = scalar(t.slice(0, end + 1), no); rest = t.slice(end + 1);
        if (!/^\s*:(\s|$)/.test(rest)) return null;
        rest = rest.replace(/^\s*:/, '');
      } else {
        const m = /^([^#'"{}[\],&*!|>%@`][^:]*?|[^:]*?)\s*:(?:\s+|$)(.*)$/.exec(t);
        if (!m || /^-( |$)/.test(t) || /^[[{]/.test(t)) return null;
        key = m[1]; rest = m[2];
        if (!key) throw new CodecError('yaml', `Line ${no}: a key is empty.`);
        if (/^[&*!|>?]/.test(key)) throw new CodecError('yaml', `Line ${no}: "${key[0]}" keys (anchors, tags, complex keys) are not supported.`);
        return { key, rest: rest.trim() };
      }
      return { key: String(key), rest: rest.trim() };
    }
    function block(ind) {
      const l = lines[i];
      if (!l || l.indent < ind) return null;
      if (l.indent !== ind) throw new CodecError('yaml', `Line ${l.no}: unexpected indentation.`);
      return isSeq(l.text) ? seq(ind) : map(ind);
    }
    function child(parentInd, no, allowSameSeq) {
      const n = lines[i];
      if (n && n.indent > parentInd) return block(n.indent);
      if (allowSameSeq && n && n.indent === parentInd && isSeq(n.text)) return seq(parentInd);
      return null;
    }
    function seq(ind) {
      const out = [];
      while (i < lines.length && lines[i].indent === ind && isSeq(lines[i].text)) {
        const l = lines[i];
        const rest = l.text === '-' ? '' : l.text.slice(2).replace(/^ +/, '');
        const restInd = ind + (l.text.length - rest.length);
        if (!rest) { i++; out.push(child(ind, l.no, false)); continue; }
        if (isSeq(rest) || keySplit(rest, l.no)) { lines[i] = { indent: restInd, text: rest, no: l.no }; out.push(block(restInd)); continue; }
        i++; out.push(scalar(rest, l.no));
      }
      if (i < lines.length && lines[i].indent > ind) throw new CodecError('yaml', `Line ${lines[i].no}: unexpected indentation.`);
      return out;
    }
    function map(ind) {
      const out = {};
      while (i < lines.length && lines[i].indent === ind && !isSeq(lines[i].text)) {
        const l = lines[i];
        const kv = keySplit(l.text, l.no);
        if (!kv) throw new CodecError('yaml', `Line ${l.no}: expected "key: value".`);
        if (Object.prototype.hasOwnProperty.call(out, kv.key)) throw new CodecError('yaml', `Line ${l.no}: the key "${kv.key}" appears twice.`);
        i++;
        const v = kv.rest ? scalar(kv.rest, l.no) : child(ind, l.no, true);
        Object.defineProperty(out, kv.key, { value: v, enumerable: true, writable: true, configurable: true });
      }
      if (i < lines.length && lines[i].indent > ind) throw new CodecError('yaml', `Line ${lines[i].no}: unexpected indentation.`);
      return out;
    }
    const first = lines[0];
    let result;
    if (first.indent === 0 && !isSeq(first.text) && !keySplit(first.text, first.no)) { if (lines.length > 1) throw new CodecError('yaml', `Line ${lines[1].no}: text after a single value.`); result = scalar(first.text, first.no); i = 1; }
    else result = block(first.indent);
    if (i < lines.length) throw new CodecError('yaml', `Line ${lines[i].no}: unexpected content.`);
    return result;
  }
  function findDq(t) { for (let k = 1; k < t.length; k++) { if (t[k] === '\\') { k++; continue; } if (t[k] === '"') return k; } return -1; }
  function findSq(t) { for (let k = 1; k < t.length; k++) { if (t[k] === "'") { if (t[k + 1] === "'") { k++; continue; } return k; } } return -1; }
  function stripYamlComment(l, no) {
    let q = null;
    for (let k = 0; k < l.length; k++) {
      const c = l[k];
      if (q === '"') { if (c === '\\') k++; else if (c === '"') q = null; continue; }
      if (q === "'") { if (c === "'") { if (l[k + 1] === "'") k++; else q = null; } continue; }
      if ((c === '"' || c === "'") && (k === 0 || /[\s:\-[{,]/.test(l[k - 1]))) { q = c; continue; }
      if (c === '#' && (k === 0 || /\s/.test(l[k - 1]))) return l.slice(0, k);
    }
    if (q) throw new CodecError('yaml', `Line ${no}: a quoted value never closes (multi-line quotes are not supported).`);
    return l;
  }
  function scalar(s, no) {
    s = s.trim();
    if (s[0] === '"') { if (findDq(s) !== s.length - 1) throw new CodecError('yaml', `Line ${no}: text after a quoted value.`); try { return JSON.parse(s); } catch { throw new CodecError('yaml', `Line ${no}: a double-quoted value uses an escape this subset does not support.`); } }
    if (s[0] === "'") { if (findSq(s) !== s.length - 1) throw new CodecError('yaml', `Line ${no}: text after a quoted value.`); return s.slice(1, -1).replace(/''/g, "'"); }
    if (s[0] === '[' || s[0] === '{') { try { return JSON.parse(s); } catch { throw new CodecError('yaml', `Line ${no}: flow collections are supported only in JSON form.`); } }
    if (/^[&*!|>%@`]/.test(s)) throw new CodecError('yaml', `Line ${no}: "${s[0]}" (anchors, aliases, tags or block text) is not supported by this YAML subset.`);
    if (/^(null|Null|NULL|~)$/.test(s)) return null;
    if (/^(true|True|TRUE)$/.test(s)) return true;
    if (/^(false|False|FALSE)$/.test(s)) return false;
    if (NUM.test(s) && !/^[-+]?0\d/.test(s)) return Number(s);
    if (/^[-+]?\.(inf|Inf|INF|nan|NaN|NAN)$/.test(s)) throw new CodecError('yaml', `Line ${no}: ${s} has no JSON form.`);
    if (/:\s/.test(s)) throw new CodecError('yaml', `Line ${no}: "${s}" mixes a value and a key; quote it.`);
    return s;
  }

  // ---------------------------------------------------------------- XML (no DTDs, no entities) ----
  const XML_NAME = /^[A-Za-z_][\w.-]*$/;
  function xmlEsc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''); }
  function jsonToXml(value, rootName) {
    let renamed = false;
    const nm = (k) => { if (XML_NAME.test(k) && !/^xml/i.test(k)) return k; renamed = true; return null; };
    const out = ['<?xml version="1.0" encoding="UTF-8"?>'];
    function el(name, v, ind) {
      const pad = '  '.repeat(ind);
      let tag = nm(name), attr = '';
      if (!tag) { tag = 'entry'; attr = ` key="${xmlEsc(name)}"`; }
      if (Array.isArray(v)) { if (!v.length) out.push(`${pad}<${tag}${attr} type="array"/>`); else { out.push(`${pad}<${tag}${attr} type="array">`); for (const x of v) el('item', x, ind + 1); out.push(`${pad}</${tag}>`); } return; }
      if (v && typeof v === 'object') { const ks = Object.keys(v); if (!ks.length) out.push(`${pad}<${tag}${attr}/>`); else { out.push(`${pad}<${tag}${attr}>`); for (const k of ks) el(k, v[k], ind + 1); out.push(`${pad}</${tag}>`); } return; }
      if (v === null) { out.push(`${pad}<${tag}${attr} nil="true"/>`); return; }
      out.push(`${pad}<${tag}${attr}>${xmlEsc(v)}</${tag}>`);
    }
    el(rootName || 'root', value, 0);
    return { text: out.join('\n') + '\n', renamed };
  }
  function parseXml(text, limits) {
    const s = String(text).replace(/^\uFEFF/, ''); const maxDepth = (limits && limits.depth) || 256;
    let i = 0;
    const err = (m) => { throw new CodecError('xml', `${m} at offset ${i}.`, i); };
    const ent = (str) => str.replace(/&(#x[0-9a-fA-F]+|#\d+|[A-Za-z]+);|&/g, (m, e) => {
      if (!e) err('A bare "&" must be written &amp;');
      if (e[0] === '#') { const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); if (!(cp > 0 && cp <= 0x10FFFF)) err('An invalid character reference'); return String.fromCodePoint(cp); }
      const map = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
      if (!(e in map)) err(`The entity &${e}; is not one of XML's five built-in entities`);
      return map[e];
    });
    function skipMisc() {
      for (;;) {
        while (i < s.length && /\s/.test(s[i])) i++;
        if (s.startsWith('<?', i)) { const e = s.indexOf('?>', i); if (e < 0) err('A processing instruction never closes'); i = e + 2; continue; }
        if (s.startsWith('<!--', i)) { const e = s.indexOf('-->', i); if (e < 0) err('A comment never closes'); i = e + 3; continue; }
        if (s.startsWith('<!DOCTYPE', i) || s.startsWith('<!doctype', i)) err('Document type declarations are refused (they can expand entities)');
        return;
      }
    }
    function element(depth) {
      if (depth > maxDepth) err('Elements nest deeper than ' + maxDepth);
      if (s[i] !== '<') err('Expected an element');
      const m = /^<([A-Za-z_:][\w.:-]*)/.exec(s.slice(i, i + 256)); if (!m) err('An invalid element name');
      const node = { name: m[1], attrs: {}, children: [] }; i += m[0].length;
      for (;;) {
        while (/\s/.test(s[i] || '')) i++;
        if (s.startsWith('/>', i)) { i += 2; return node; }
        if (s[i] === '>') { i++; break; }
        const a = /^([A-Za-z_:][\w.:-]*)\s*=\s*("([^"<]*)"|'([^'<]*)')/.exec(s.slice(i, i + 65536));
        if (!a) err('An invalid attribute');
        if (a[1] in node.attrs) err(`The attribute ${a[1]} appears twice`);
        node.attrs[a[1]] = ent(a[3] != null ? a[3] : a[4]); i += a[0].length;
      }
      for (;;) {
        if (i >= s.length) err(`The element <${node.name}> never closes`);
        if (s.startsWith('</', i)) {
          const c = /^<\/([A-Za-z_:][\w.:-]*)\s*>/.exec(s.slice(i, i + 256));
          if (!c || c[1] !== node.name) err(`Expected </${node.name}>`);
          i += c[0].length; return node;
        }
        if (s.startsWith('<!--', i)) { const e = s.indexOf('-->', i); if (e < 0) err('A comment never closes'); i = e + 3; continue; }
        if (s.startsWith('<![CDATA[', i)) { const e = s.indexOf(']]>', i); if (e < 0) err('A CDATA section never closes'); node.children.push(s.slice(i + 9, e)); i = e + 3; continue; }
        if (s.startsWith('<?', i)) { const e = s.indexOf('?>', i); if (e < 0) err('A processing instruction never closes'); i = e + 2; continue; }
        if (s[i] === '<') { node.children.push(element(depth + 1)); continue; }
        const e = s.indexOf('<', i); const t = s.slice(i, e < 0 ? s.length : e); node.children.push(ent(t)); i = e < 0 ? s.length : e;
      }
    }
    skipMisc();
    const root = element(0);
    skipMisc();
    if (i < s.length) err('Content after the root element');
    return root;
  }
  // Element tree to JSON: attributes become "@name", repeated children become arrays, mixed text becomes "#text".
  function xmlToJson(text) {
    const root = parseXml(text);
    function conv(n) {
      const kids = n.children.filter((c) => typeof c !== 'string');
      const txt = n.children.filter((c) => typeof c === 'string').join('');
      const attrs = Object.keys(n.attrs);
      if (!kids.length && !attrs.length) return txt.trim() === '' && n.children.length === 0 ? null : txt;
      const o = {};
      for (const a of attrs) o['@' + a] = n.attrs[a];
      const rep = new Set();
      for (const k of kids) { const v = conv(k); if (k.name in o) { if (!rep.has(k.name)) { o[k.name] = [o[k.name]]; rep.add(k.name); } o[k.name].push(v); } else o[k.name] = v; }
      if (txt.trim()) o['#text'] = txt.trim();
      return o;
    }
    return { [root.name]: conv(root) };
  }

  // ---------------------------------------------------------------- compression and ZIP -----------
  const hasStreams = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
  async function pipeBytes(bytes, stream, maxOut) {
    const writer = stream.writable.getWriter();
    const w = writer.write(bytes).then(() => writer.close()).catch(() => { /* surfaced by the reader */ });
    const reader = stream.readable.getReader(); const parts = []; let len = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      len += value.length;
      if (maxOut && len > maxOut) { try { await reader.cancel(); } catch { /* ignore */ } throw new CodecError('too-large', `The expanded data passes the ${formatBytes(maxOut)} safety limit.`); }
      parts.push(value);
    }
    await w;
    return concatBytes(parts);
  }
  async function compress(bytes, format) { if (!hasStreams()) throw new CodecError('unavailable', 'Compression streams are not available in this runtime.'); return pipeBytes(toBytes(bytes), new CompressionStream(format)); }
  async function decompress(bytes, format, maxOut) {
    if (!hasStreams()) throw new CodecError('unavailable', 'Compression streams are not available in this runtime.');
    try { return await pipeBytes(toBytes(bytes), new DecompressionStream(format), maxOut); }
    catch (e) { if (e instanceof CodecError) throw e; throw new CodecError('corrupt', `The ${format} data is damaged or incomplete.`); }
  }

  function dosTime(d) { d = d || new Date(); return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: (Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() }; }
  // Builds a ZIP (no ZIP64, no encryption). method 'deflate' uses the runtime's deflate-raw stream
  // and falls back to store per entry when deflate would not shrink it.
  async function buildZip(entries, opts) {
    const method = opts && opts.method === 'deflate' ? 'deflate' : 'store';
    if (method === 'deflate' && !hasStreams()) throw new CodecError('unavailable', 'Deflate needs compression streams, which this runtime lacks. Use store.');
    if (entries.length > 65534) throw new CodecError('too-many', 'A ZIP without ZIP64 holds at most 65,534 entries.');
    const used = new Set(); const locals = []; const central = []; let offset = 0;
    for (const e of entries) {
      let name = String(e.name).replace(/\\/g, '/').replace(/^\/+/, '').split('/').filter((p) => p && p !== '.' && p !== '..').join('/') || 'file';
      name = uniqueName(name, (n) => used.has(n)); used.add(name);
      const data = toBytes(e.bytes); const crc = crc32(data);
      let body = data, m = 0;
      if (method === 'deflate' && data.length > 64) { const c = await compress(data, 'deflate-raw'); if (c.length < data.length) { body = c; m = 8; } }
      if (offset + body.length > 0xFFFFFFF0) throw new CodecError('too-large', 'This ZIP would pass 4 GB, which needs ZIP64 (not supported).');
      const nb = new TextEncoder().encode(name); const { time, date } = dosTime(e.date);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, m, true); lh.setUint16(10, time, true); lh.setUint16(12, date, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, body.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nb.length, true); lh.setUint16(28, 0, true);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, m, true); ch.setUint16(12, time, true); ch.setUint16(14, date, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, body.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, nb.length, true); ch.setUint32(42, offset, true);
      locals.push(new Uint8Array(lh.buffer), nb, body); central.push(new Uint8Array(ch.buffer), nb);
      offset += 30 + nb.length + body.length;
    }
    const cd = concatBytes(central);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true); end.setUint32(12, cd.length, true); end.setUint32(16, offset, true);
    return concatBytes(locals.concat([cd, new Uint8Array(end.buffer)]));
  }
  // Reads a ZIP from its central directory. Each entry is verified by CRC-32 and size; encrypted,
  // ZIP64 and methods other than store or deflate are reported, never guessed.
  async function readZip(bytesIn, opts) {
    const b = toBytes(bytesIn); const maxEntry = (opts && opts.maxEntryBytes) || 512 * 1024 * 1024;
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let eocd = -1;
    for (let k = b.length - 22; k >= Math.max(0, b.length - 22 - 65535); k--) if (dv.getUint32(k, true) === 0x06054b50) { eocd = k; break; }
    if (eocd < 0) throw new CodecError('zip', 'No ZIP end record was found; the archive is damaged or not a ZIP.');
    const count = dv.getUint16(eocd + 10, true), cdSize = dv.getUint32(eocd + 12, true), cdOff = dv.getUint32(eocd + 16, true);
    if (cdOff === 0xFFFFFFFF || count === 0xFFFF) throw new CodecError('zip', 'This is a ZIP64 archive, which is not supported.');
    if (cdOff + cdSize > b.length) throw new CodecError('zip', 'The ZIP directory points past the end of the file.');
    const out = []; let p = cdOff;
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new CodecError('zip', `Directory entry ${n + 1} is damaged.`);
      const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true), crc = dv.getUint32(p + 16, true), csize = dv.getUint32(p + 20, true), size = dv.getUint32(p + 24, true);
      const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
      const nameBytes = b.subarray(p + 46, p + 46 + nl);
      const name = flags & 0x0800 ? new TextDecoder().decode(nameBytes) : decodeText(nameBytes, 'latin1');
      p += 46 + nl + xl + cl;
      const entry = { name, size, csize, method, dir: name.endsWith('/'), status: 'ok', reason: '', bytes: null };
      if (entry.dir) { entry.status = 'skipped'; entry.reason = 'Folder entry'; out.push(entry); continue; }
      if (/(^|\/)\.\.(\/|$)|^\/|^[A-Za-z]:/.test(name)) { entry.status = 'failed'; entry.reason = 'Unsafe path (absolute or climbing out of the archive)'; out.push(entry); continue; }
      if (flags & 1) { entry.status = 'failed'; entry.reason = 'Encrypted entry; no password support'; out.push(entry); continue; }
      if (method !== 0 && method !== 8) { entry.status = 'failed'; entry.reason = `Compression method ${method} is not supported (store and deflate only)`; out.push(entry); continue; }
      if (size > maxEntry) { entry.status = 'failed'; entry.reason = `Larger than the ${formatBytes(maxEntry)} per-entry limit`; out.push(entry); continue; }
      if (dv.getUint32(lo, true) !== 0x04034b50) { entry.status = 'failed'; entry.reason = 'Local header is damaged'; out.push(entry); continue; }
      const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
      const body = b.subarray(start, start + csize);
      try {
        const data = method === 0 ? body.slice() : await decompress(body, 'deflate-raw', maxEntry);
        if (data.length !== size || crc32(data) !== crc) { entry.status = 'failed'; entry.reason = 'CRC-32 or size check failed; the entry is damaged'; }
        else entry.bytes = data;
      } catch (e) { entry.status = 'failed'; entry.reason = e.message; }
      out.push(entry);
    }
    return out;
  }

  // ---------------------------------------------------------------- BMP writer --------------------
  // 24-bit BMP from RGBA pixels. Transparency is flattened onto the given background (white).
  function encodeBmp(width, height, rgba, bg) {
    const back = bg || [255, 255, 255];
    const row = Math.ceil(width * 3 / 4) * 4, size = 54 + row * height;
    const out = new Uint8Array(size); const dv = new DataView(out.buffer);
    out[0] = 0x42; out[1] = 0x4D; dv.setUint32(2, size, true); dv.setUint32(10, 54, true);
    dv.setUint32(14, 40, true); dv.setInt32(18, width, true); dv.setInt32(22, height, true); dv.setUint16(26, 1, true); dv.setUint16(28, 24, true);
    dv.setUint32(34, row * height, true); dv.setInt32(38, 2835, true); dv.setInt32(42, 2835, true);
    for (let y = 0; y < height; y++) {
      const dst = 54 + (height - 1 - y) * row;
      for (let x = 0; x < width; x++) {
        const s = (y * width + x) * 4, a = rgba[s + 3] / 255;
        out[dst + x * 3] = Math.round(rgba[s + 2] * a + back[2] * (1 - a));
        out[dst + x * 3 + 1] = Math.round(rgba[s + 1] * a + back[1] * (1 - a));
        out[dst + x * 3 + 2] = Math.round(rgba[s] * a + back[0] * (1 - a));
      }
    }
    return out;
  }

  function formatBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + (n === 1 ? ' byte' : ' bytes');
    const u = ['KB', 'MB', 'GB', 'TB']; let v = n / 1024, k = 0;
    while (v >= 1024 && k < u.length - 1) { v /= 1024; k++; }
    return v.toFixed(v < 10 ? 2 : 1) + ' ' + u[k];
  }

  return {
    CodecError, STD, URL_SAFE, MIME_LINE, ENCODINGS, ENCODING_LABELS, SNIFF_BYTES,
    createEncoder, createDecoder, encodeBase64, decodeBase64, tryDecodeBase64,
    toBytes, concatBytes, bytesEqual, encodeText, decodeText, utf8InvalidAt,
    buildDataUrl, parseDataUrl, createSha256, sha256Hex, crc32,
    detectType, extForMime, hexDump, base64NameFor, restoreName, numberedName, uniqueName, safeFileName,
    countLineEndings, convertLineEndings, toHex, fromHex, toBinaryText, fromBinaryText,
    parseDelimited, stringifyDelimited, rowsToObjects, objectsToRows, toYaml, parseYaml, jsonToXml, parseXml, xmlToJson,
    hasStreams, compress, decompress, buildZip, readZip, encodeBmp, formatBytes
  };
});
