'use strict';
// Data tools UI helpers shared by the Base64 toolkit and the file converter: safe previews,
// chunked file streaming with pause/resume/cancel, downloads, clipboard and a local history store
// with undo and redo. Requires data-tools-core.js (window.MVLDataCore).
(function () {
  const C = window.MVLDataCore;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => C.formatBytes(n);
  let uid = 0;
  const id = (p) => (p || 'dt') + (++uid) + Math.random().toString(36).slice(2, 6);

  function frag(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

  // A single-choice button group (.seg) with aria-pressed. onPick(value) fires on change.
  function seg(label, options, value, onPick, small) {
    const el = frag(`<div class="seg${small ? ' sm' : ''} dt-seg" role="group" aria-label="${esc(label)}"></div>`);
    for (const [v, text] of options) {
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.v = v; b.textContent = text; b.setAttribute('aria-pressed', String(v === value));
      b.addEventListener('click', () => { for (const x of el.children) x.setAttribute('aria-pressed', String(x === b)); onPick(v); });
      el.append(b);
    }
    el.set = (v) => { for (const x of el.children) x.setAttribute('aria-pressed', String(x.dataset.v === v)); };
    return el;
  }

  // Pause / resume / cancel control shared by every streamed job.
  function control() {
    const c = { paused: false, cancelled: false, waiters: [] };
    c.pause = () => { c.paused = true; };
    c.resume = () => { c.paused = false; c.waiters.splice(0).forEach((r) => r()); };
    c.cancel = () => { c.cancelled = true; c.resume(); };
    c.gate = async () => { while (c.paused && !c.cancelled) await new Promise((r) => c.waiters.push(r)); if (c.cancelled) throw Object.assign(new Error('Cancelled.'), { code: 'cancelled' }); };
    return c;
  }

  const CHUNK = 3 * 512 * 1024;
  // Reads a Blob or File slice by slice; never holds more than one chunk.
  async function eachChunk(blob, ctl, onChunk, onProgress) {
    let pos = 0;
    while (pos < blob.size) {
      if (ctl) await ctl.gate();
      const end = Math.min(blob.size, pos + CHUNK);
      const buf = new Uint8Array(await blob.slice(pos, end).arrayBuffer());
      await onChunk(buf, pos);
      pos = end;
      if (onProgress) onProgress(pos, blob.size);
    }
    if (onProgress) onProgress(blob.size, blob.size);
  }
  const latin1 = (u8) => C.decodeText(u8, 'latin1');

  // Streams a file to Base64 text (as a Blob), then decodes that Blob again chunk by chunk and
  // compares SHA-256 hashes before reporting success.
  async function streamEncode(file, opts, ctl, onProgress) {
    const enc = C.createEncoder(opts); const hs = C.createSha256(); const parts = [];
    await eachChunk(file, ctl, (b) => { hs.update(b); const s = enc.push(b); if (s) parts.push(s); }, (d, t) => onProgress && onProgress('encode', d, t));
    const tail = enc.end(); if (tail) parts.push(tail);
    const out = new Blob(parts, { type: 'text/plain' });
    const srcHash = hs.hex();
    const hv = C.createSha256();
    if (file.size) {
      const dec = C.createDecoder(Object.assign({}, opts, { strict: true }));
      await eachChunk(out, ctl, (b) => { hv.update(dec.push(latin1(b))); }, (d, t) => onProgress && onProgress('verify', d, t));
      hv.update(dec.end());
    }
    if (hv.hex() !== srcHash) throw Object.assign(new Error('The SHA-256 round trip did not match, so the result was discarded.'), { code: 'verify-failed' });
    return { blob: out, sha256: srcHash, bytesIn: file.size, bytesOut: out.size };
  }

  // Streams Base64 text (optionally a data: URL) back to bytes; verifies the decoded Blob's hash and
  // that re-encoding reproduces the input's Base64 characters.
  async function streamDecode(file, opts, ctl, onProgress) {
    const dec = C.createDecoder(opts); const hs = C.createSha256(); const hin = C.createSha256(); const parts = [];
    let head = new Uint8Array(0), mime = '', first = true, offsetBase = 0;
    const norm = (s) => s.replace(/[\s=]/g, '').replace(/-/g, '+').replace(/_/g, '/');
    const shift = (e) => { if (e instanceof C.CodecError && e.offset >= 0 && offsetBase) { e.offset += offsetBase; e.message = e.message.replace(/offset (\d+)/, (m, n) => 'offset ' + (Number(n) + offsetBase)); } return e; };
    const take = (b) => { if (!b.length) return; if (head.length < C.SNIFF_BYTES) head = C.concatBytes([head, b.subarray(0, C.SNIFF_BYTES - head.length)]); hs.update(b); parts.push(b.slice()); };
    await eachChunk(file, ctl, (u8) => {
      let s = latin1(u8);
      if (first) {
        first = false;
        const before = s.length; s = s.replace(/^\xEF\xBB\xBF/, ''); offsetBase = before - s.length;
        const lead = s.replace(/^\s+/, '');
        if (/^data:/i.test(lead)) {
          const comma = lead.indexOf(',');
          if (comma < 0 || comma > 1024) throw new C.CodecError('not-data-url', 'The data: URL header is missing its comma.');
          const meta = lead.slice(5, comma).split(';');
          if (meta[meta.length - 1].toLowerCase() !== 'base64') throw new C.CodecError('not-data-url', 'This data: URL is not Base64 encoded.');
          mime = meta[0].toLowerCase(); offsetBase += s.length - lead.length + comma + 1; s = lead.slice(comma + 1);
        }
      }
      hin.update(C.encodeText(norm(s), 'latin1'));
      try { take(dec.push(s)); } catch (e) { throw shift(e); }
    }, (d, t) => onProgress && onProgress('decode', d, t));
    try { take(dec.end()); } catch (e) { throw shift(e); }
    const out = new Blob(parts);
    const sha = hs.hex();
    const hr = C.createSha256(), he = C.createSha256(); const enc = C.createEncoder({ pad: false });
    await eachChunk(out, ctl, (b) => { hr.update(b); he.update(C.encodeText(enc.push(b), 'latin1')); }, (d, t) => onProgress && onProgress('verify', d, t));
    he.update(C.encodeText(enc.end(), 'latin1'));
    if (hr.hex() !== sha) throw Object.assign(new Error('The decoded result changed while it was stored, so it was discarded.'), { code: 'verify-failed' });
    if (he.hex() !== hin.hex()) throw Object.assign(new Error('Re-encoding the result does not reproduce the input (its last character has non-zero unused bits).'), { code: 'verify-failed' });
    const detected = C.detectType(head, '');
    return { blob: out, sha256: sha, bytesIn: file.size, bytesOut: out.size, mime, detected, head };
  }

  // Suggested name for decoded output: the name pattern, then the data: MIME type, then the
  // byte signature, then .bin.
  function decodedName(srcName, mime, detected) {
    const r = C.restoreName(srcName); if (r) return { name: r, source: 'name pattern' };
    const stem = String(srcName || 'decoded').replace(/\.(txt|b64|base64)$/i, '') || 'decoded';
    if (mime && C.extForMime(mime) !== 'bin') return { name: stem + '.' + C.extForMime(mime), source: 'data: MIME type' };
    if (detected && detected.id !== 'binary' && detected.id !== 'empty') return { name: stem + '.' + detected.ext, source: 'byte signature' };
    return { name: stem + '.bin', source: 'no type found' };
  }

  function download(data, name, mime) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = C.safeFileName(name); a.rel = 'noopener';
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function copyText(text, ctx) {
    try { await navigator.clipboard.writeText(text); ctx && ctx.toast('Copied to the clipboard.', 'ok'); return true; }
    catch { ctx && ctx.toast('The clipboard refused the copy. Select the text and press Ctrl+C.', 'error'); return false; }
  }
  async function readClipboard(ctx) {
    try { return await navigator.clipboard.readText(); }
    catch { ctx && ctx.toast('The clipboard could not be read here. Click the box and press Ctrl+V instead.', 'error'); return null; }
  }

  async function blobToDataUrl(blob, mime) {
    const parts = []; const enc = C.createEncoder({});
    await eachChunk(blob, null, (b) => { parts.push(enc.push(b)); });
    parts.push(enc.end());
    return 'data:' + (mime || blob.type || 'application/octet-stream') + ';base64,' + parts.join('');
  }

  const PREVIEW_TEXT = 256 * 1024, PREVIEW_MEDIA = 24 * 1024 * 1024, PREVIEW_HEX = 4096;
  // Safe preview chosen by detected type. Text renders as text (HTML and SVG included, never
  // interpreted); raster images and media render from a data: URL with no autoplay; everything else
  // is a hex dump. Nothing is executed or opened.
  async function preview(el, blob, detected, encoding) {
    el.innerHTML = '';
    el.classList.add('dt-preview');
    const det = detected || C.detectType(new Uint8Array(await blob.slice(0, C.SNIFF_BYTES).arrayBuffer()), '');
    const head = frag(`<p class="small">Detected: <strong>${esc(det.label)}</strong> &middot; ${esc(fmt(blob.size))}</p>`);
    el.append(head);
    const raster = ['png', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif'].includes(det.id);
    const media = det.category === 'audio' || det.category === 'video';
    if ((raster || media) && blob.size > PREVIEW_MEDIA) { el.append(frag(`<p class="note">Too large to preview (${esc(fmt(blob.size))}; the limit is ${esc(fmt(PREVIEW_MEDIA))}). A hex dump of the start is shown instead.</p>`)); return hex(); }
    if (raster) {
      const img = new Image(); img.alt = 'Preview of the decoded ' + det.label; img.className = 'dt-img';
      img.src = await blobToDataUrl(blob, det.mime);
      img.addEventListener('error', () => { img.replaceWith(frag('<p class="errbox">This image could not be drawn; it may be damaged. A hex dump follows.</p>')); hex(); });
      el.append(img); return;
    }
    if (media) {
      const m = document.createElement(det.category === 'audio' ? 'audio' : 'video');
      m.controls = true; m.preload = 'metadata'; m.className = 'dt-media'; m.setAttribute('aria-label', 'Preview of the decoded ' + det.label);
      m.addEventListener('error', () => { m.replaceWith(frag('<p class="note">Audio and video preview is unavailable in this window: its security policy does not allow media sources, or the format cannot play here. A hex dump follows.</p>')); hex(); });
      m.src = await blobToDataUrl(blob, det.mime);
      el.append(m); return;
    }
    if (det.category === 'text' || det.category === 'structured' || det.encoding) {
      const bytes = new Uint8Array(await blob.slice(0, PREVIEW_TEXT).arrayBuffer());
      let text;
      try { text = C.decodeText(trimPartial(bytes, blob.size > PREVIEW_TEXT), encoding || det.encoding || 'utf-8'); }
      catch (e) { el.append(frag(`<p class="note">${esc(e.message)}</p>`)); return hex(); }
      const pre = document.createElement('pre'); pre.className = 'log dt-pre'; pre.tabIndex = 0; pre.setAttribute('aria-label', 'Text preview'); pre.textContent = text;
      el.append(pre);
      if (blob.size > PREVIEW_TEXT) el.append(frag(`<p class="small">Showing the first ${esc(fmt(PREVIEW_TEXT))}.</p>`));
      return;
    }
    return hex();
    async function hex() {
      const bytes = new Uint8Array(await blob.slice(0, PREVIEW_HEX).arrayBuffer());
      const pre = document.createElement('pre'); pre.className = 'log dt-pre'; pre.tabIndex = 0; pre.setAttribute('aria-label', 'Hex dump'); pre.textContent = C.hexDump(bytes, PREVIEW_HEX) || '(empty)';
      el.append(pre);
      if (blob.size > PREVIEW_HEX) el.append(frag(`<p class="small">Hex dump of the first ${esc(fmt(PREVIEW_HEX))}.</p>`));
    }
  }
  function trimPartial(b, truncated) {
    if (!truncated) return b;
    let k = b.length; while (k > 0 && k > b.length - 4 && (b[k - 1] & 0xC0) === 0x80) k--; if (k > 0 && b[k - 1] >= 0xC0) k--;
    return b.subarray(0, k);
  }

  // Local history: entries keep names, sizes, hashes and options. Payloads stay in memory for undo
  // and are written to storage only when the person opts in. Unlimited undo and redo.
  function history(key, opts) {
    const MAX_PAYLOAD = (opts && opts.maxPayload) || 2 * 1024 * 1024;
    const mem = new Map();
    let state = { v: 1, keepPayloads: false, pos: 0, entries: [] };
    try { const s = JSON.parse(localStorage.getItem(key) || 'null'); if (s && s.v === 1 && Array.isArray(s.entries)) state = s; } catch { /* a damaged record starts empty */ }
    state.pos = Math.min(Math.max(0, state.pos | 0), state.entries.length);
    const listeners = new Set();
    function save() {
      let budget = MAX_PAYLOAD;
      const entries = state.entries.map((e) => {
        const copy = Object.assign({}, e); delete copy.payload;
        const p = mem.get(e.id) || e.payload;
        if (state.keepPayloads && p) { const size = JSON.stringify(p).length; if (size <= budget) { copy.payload = p; budget -= size; } else copy.payloadDropped = true; }
        return copy;
      });
      try { localStorage.setItem(key, JSON.stringify(Object.assign({}, state, { entries }))); }
      catch { /* storage full or blocked: history lasts for this window only */ }
      listeners.forEach((f) => f());
    }
    return {
      get entries() { return state.entries; },
      get pos() { return state.pos; },
      get keepPayloads() { return state.keepPayloads; },
      setKeepPayloads(v) { state.keepPayloads = !!v; save(); },
      payload(e) { return mem.get(e.id) || e.payload || null; },
      push(entry, payload) {
        const e = Object.assign({ id: id('h'), at: new Date().toISOString() }, entry);
        for (const dropped of state.entries.splice(state.pos)) mem.delete(dropped.id);
        state.entries.push(e); state.pos = state.entries.length;
        if (payload) mem.set(e.id, payload);
        save(); return e;
      },
      canUndo: () => state.pos > 0,
      canRedo: () => state.pos < state.entries.length,
      undo() { if (state.pos <= 0) return null; state.pos--; save(); return state.entries[state.pos]; },
      redo() { if (state.pos >= state.entries.length) return null; const e = state.entries[state.pos]; state.pos++; save(); return e; },
      clear() { state.entries = []; state.pos = 0; mem.clear(); save(); },
      on(f) { listeners.add(f); return () => listeners.delete(f); }
    };
  }

  // A drop target that is also a real button (keyboard and screen readers pick files with it).
  function dropZone(label, hint, onFiles, opts) {
    const input = document.createElement('input'); input.type = 'file'; input.multiple = !(opts && opts.single); input.hidden = true;
    if (opts && opts.accept) input.accept = opts.accept;
    const zone = frag(`<button type="button" class="dt-drop"><strong>${esc(label)}</strong><span class="small">${esc(hint)}</span></button>`);
    zone.addEventListener('click', () => { if (opts && opts.onPick) opts.onPick(); else input.click(); });
    input.addEventListener('change', () => { if (input.files.length) onFiles([...input.files], null); input.value = ''; });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); const f = [...(e.dataTransfer && e.dataTransfer.files || [])]; if (f.length) onFiles(f, e); });
    const wrap = document.createElement('div'); wrap.append(zone, input);
    wrap.zone = zone; wrap.input = input;
    return wrap;
  }

  function bar(el, frac, running) {
    el.className = 'bar' + (running && frac == null ? ' run' : '');
    el.innerHTML = '<i></i>';
    if (frac != null) el.firstChild.style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
  }

  window.MVLDataUI = { esc, fmt, id, frag, seg, control, eachChunk, streamEncode, streamDecode, decodedName, download, copyText, readClipboard, blobToDataUrl, preview, history, dropZone, bar, PREVIEW_MEDIA };
})();
