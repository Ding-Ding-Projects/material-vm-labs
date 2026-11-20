'use strict';
// Universal file converter (feature file-converter). A categorised, searchable adapter catalogue.
// Only adapters that work offline with what this window already has are enabled: images through the
// built-in canvas decoders, text and structured data, Base64 / hex / binary text, ZIP and gzip.
// Every other known format is listed as unavailable with the exact missing adapter. Each output is
// validated (signature, parse or round trip) before it is offered. Sources are never changed.
(function () {
  const C = window.MVLDataCore, U = window.MVLDataUI;
  if (!C || !U || !window.MVLTools) return;
  const { esc, fmt, frag } = U;
  const REC_KEY = 'mvl.datatools.conv.record.v1';
  const MAX_WHOLE = 128 * 1024 * 1024; // whole-file adapters hold one file in memory at a time
  const MAX_IMAGE = 64 * 1024 * 1024, MAX_PIXELS = 100 * 1000 * 1000;
  const MAX_ZIP_TOTAL = 512 * 1024 * 1024, MAX_ZIP_ENTRIES = 5000;
  const CONCURRENCY = 2;

  const CATS = [['documents', 'Documents and PDF'], ['images', 'Images'], ['audio', 'Audio'], ['video', 'Video'], ['archives', 'Archives'], ['structured', 'Structured data and spreadsheets'], ['text', 'Code and text'], ['binary', 'Binary encodings']];
  const IMG = ['png', 'jpeg', 'webp', 'bmp', 'gif', 'ico', 'avif'];
  const TEXTY = ['text', 'csv', 'tsv', 'json', 'xml', 'yaml', 'svg', 'html', 'dataurl', 'b64text', 'hextext'];
  const META = 'Metadata (EXIF, colour profile, comments) is not carried over.';

  const fail = (m) => { throw new Error(m); };
  const stem = (n) => { const s = String(n); const d = s.lastIndexOf('.'); return d > 0 ? s.slice(0, d) : s; };
  async function bytesOf(job, limit) {
    if (job.file.size > (limit || MAX_WHOLE)) fail(`${fmt(job.file.size)} is over this adapter's ${fmt(limit || MAX_WHOLE)} limit.`);
    if (!job.bytes) { const parts = []; await U.eachChunk(job.file, job.ctl, (b) => { parts.push(b); }, job.progress); job.bytes = C.concatBytes(parts); }
    return job.bytes;
  }
  async function textOf(job) { const b = await bytesOf(job); return C.decodeText(b, job.det.encoding || 'utf-8'); }
  const out = (name, data, mime) => ({ name, blob: data instanceof Blob ? data : new Blob([data], { type: mime }), mime });

  // ---------------------------------------------------------------- images (canvas)
  async function raster(job, target) {
    if (job.file.size > MAX_IMAGE) fail(`${fmt(job.file.size)} is over the ${fmt(MAX_IMAGE)} image limit.`);
    let bmp;
    try { bmp = await createImageBitmap(job.file); } catch { fail(`This ${job.det.label} could not be decoded by the built-in image decoder.`); }
    const w = bmp.width, h = bmp.height;
    if (w * h > MAX_PIXELS) { bmp.close(); fail(`${w} x ${h} pixels is over the ${MAX_PIXELS / 1e6} megapixel limit.`); }
    const cv = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const g = cv.getContext('2d', { willReadFrequently: target === 'bmp' });
    if (target === 'jpeg' || target === 'bmp') { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); }
    g.drawImage(bmp, 0, 0); bmp.close();
    await job.ctl.gate();
    let blob;
    if (target === 'bmp') blob = new Blob([C.encodeBmp(w, h, g.getImageData(0, 0, w, h).data)], { type: 'image/bmp' });
    else {
      const type = 'image/' + target;
      blob = cv.convertToBlob ? await cv.convertToBlob({ type, quality: 0.92 }) : await new Promise((r) => cv.toBlob(r, type, 0.92));
    }
    // Validate: the signature is the target's and it decodes back at the same size.
    const det = C.detectType(new Uint8Array(await blob.slice(0, 64).arrayBuffer()), '');
    if (det.id !== target) fail(`This runtime cannot write ${target.toUpperCase()} (it produced ${det.label}).`);
    const back = await createImageBitmap(blob).catch(() => null);
    if (!back || back.width !== w || back.height !== h) fail('The converted image did not decode back at the same size.');
    back.close();
    return [out(stem(job.file.name) + '.' + det.ext, blob, det.mime)];
  }
  const imgLossy = {
    png: [META, 'Animated GIFs keep only their first frame.'],
    jpeg: ['JPEG is lossy (quality 92): fine detail changes.', 'Transparency is flattened onto white.', META, 'Animated GIFs keep only their first frame.'],
    webp: ['Lossy WebP (quality 92): fine detail changes.', META, 'Animated GIFs keep only their first frame.'],
    bmp: ['Transparency is flattened onto white (24-bit BMP).', META, 'Animated GIFs keep only their first frame.']
  };

  // ---------------------------------------------------------------- text helpers
  function eolAdapter(to, label) {
    return { id: 'eol-' + to, cat: 'text', name: `Line endings to ${label}`, from: TEXTY, to: label, lossy: [`Every line ending becomes ${label}; the character encoding stays the same.`],
      async run(job) {
        const t = await textOf(job); const r = C.convertLineEndings(t, to);
        const c = C.countLineEndings(r); const other = to === 'lf' ? c.crlf + c.cr : to === 'crlf' ? c.lf + c.cr : c.lf + c.crlf;
        if (other) fail('Validation found mixed line endings after the change.');
        const enc = job.det.encoding || 'utf-8'; const b = await bytesOf(job);
        const bom = (enc === 'utf-8' && b[0] === 0xEF && b[1] === 0xBB) || enc !== 'utf-8';
        const o = C.encodeText(r.replace(/^﻿/, ''), enc, { bom });
        return [out(job.file.name, o, 'text/plain')];
      } };
  }
  function encAdapter(enc) {
    const label = C.ENCODING_LABELS[enc];
    return { id: 'enc-' + enc, cat: 'text', name: `Re-encode text as ${label}`, from: TEXTY, to: label,
      lossy: ['The character encoding changes; tools expecting the old encoding may misread it.', enc === 'latin1' ? 'Latin-1 has no byte for most characters outside Western European text; such files fail instead of being altered.' : enc === 'utf-8' ? 'Written without a byte-order mark.' : 'Written with a byte-order mark.'],
      async run(job) {
        const t = (await textOf(job)).replace(/^﻿/, '');
        const o = C.encodeText(t, enc, { bom: enc !== 'utf-8' && enc !== 'latin1' });
        if (C.decodeText(o, enc).replace(/^﻿/, '') !== t) fail('The re-encoded text did not decode back to the same characters.');
        return [out(job.file.name, o, 'text/plain')];
      } };
  }

  // ---------------------------------------------------------------- structured helpers
  const parseJson = (t) => { try { return JSON.parse(t.replace(/^﻿/, '')); } catch (e) { fail('The JSON could not be parsed: ' + e.message); } };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const JSON_NUM = 'Numbers with more than 15 to 17 significant digits lose precision.';
  function structured(id, name, from, to, ext, mime, lossy, fn) {
    return { id, cat: 'structured', name, from, to, lossy, async run(job) { const t = await textOf(job); const r = fn(t); return [out(stem(job.file.name) + '.' + ext, new TextEncoder().encode(r), mime)]; } };
  }
  const delimOf = (from) => (from === 'tsv' ? '\t' : ',');
  function tableToJson(from) {
    return (t) => { const objs = C.rowsToObjects(C.parseDelimited(t, delimOf(from))); const s = JSON.stringify(objs, null, 2) + '\n'; if (!same(JSON.parse(s), objs)) fail('Validation failed.'); return s; };
  }
  function jsonToTable(to) {
    return (t) => {
      const { rows } = C.objectsToRows(parseJson(t)); const d = delimOf(to);
      if (d === '\t' && rows.some((r) => r.some((c) => /[\t\r\n]/.test(c)))) fail('A value contains a tab or line break, which plain TSV cannot hold. Convert to CSV instead.');
      const s = C.stringifyDelimited(rows, d, d === '\t' ? '\n' : '\r\n');
      if (!same(C.parseDelimited(s, d), rows)) fail('The table did not read back identically.');
      return s;
    };
  }
  function tableToTable(from, to) {
    return (t) => {
      const rows = C.parseDelimited(t, delimOf(from)); const d = delimOf(to);
      if (d === '\t' && rows.some((r) => r.some((c) => /[\t\r\n]/.test(c)))) fail('A value contains a tab or line break, which plain TSV cannot hold.');
      const s = C.stringifyDelimited(rows, d, d === '\t' ? '\n' : '\r\n');
      if (!same(C.parseDelimited(s, d), rows)) fail('The table did not read back identically.');
      return s;
    };
  }

  // ---------------------------------------------------------------- binary encodings
  function textEncoding(id, name, ext, encodeFn, decodeFn) {
    return { id, cat: 'binary', name, from: 'any', to: name.split(' to ').pop(), lossy: [],
      async run(job) {
        const b = await bytesOf(job, 32 * 1024 * 1024);
        const s = encodeFn(b);
        if (!C.bytesEqual(decodeFn(s), b)) fail('The round trip did not reproduce the original bytes.');
        return [out(job.file.name + '.' + ext, new TextEncoder().encode(s), 'text/plain')];
      } };
  }
  function textDecoding(id, name, decodeFn) {
    return { id, cat: 'binary', name, from: ['text', 'hextext', 'b64text'], to: 'Original bytes', lossy: [],
      async run(job) {
        const t = await textOf(job); let b;
        try { b = decodeFn(t); } catch (e) { fail(e.message); }
        const det = C.detectType(b, '');
        return [out(stem(job.file.name.replace(/\.(hex|bin)\.txt$/i, '.txt')) + '.' + (det.id === 'binary' ? 'bin' : det.ext), b, det.mime)];
      } };
  }

  const ADAPTERS = [
    // Images
    ...['png', 'jpeg', 'webp', 'bmp'].map((t) => ({ id: 'img-' + t, cat: 'images', name: `Image to ${t === 'jpeg' ? 'JPEG' : t === 'webp' ? 'WebP' : t.toUpperCase()}`, from: IMG.filter((x) => x !== t), to: t.toUpperCase(), lossy: imgLossy[t], run: (job) => raster(job, t) })),
    // Code and text
    eolAdapter('lf', 'LF'), eolAdapter('crlf', 'CRLF'), eolAdapter('cr', 'CR'),
    ...C.ENCODINGS.map(encAdapter),
    // Structured data
    structured('json-pretty', 'JSON, pretty (2 spaces)', ['json'], 'JSON', 'json', 'application/json', ['Whitespace and layout change.', JSON_NUM], (t) => { const v = parseJson(t); const s = JSON.stringify(v, null, 2) + '\n'; if (!same(JSON.parse(s), v)) fail('Validation failed.'); return s; }),
    structured('json-min', 'JSON, minified', ['json'], 'JSON', 'json', 'application/json', ['Whitespace and layout are removed.', JSON_NUM], (t) => { const v = parseJson(t); const s = JSON.stringify(v); if (!same(JSON.parse(s), v)) fail('Validation failed.'); return s; }),
    structured('json-csv', 'JSON to CSV', ['json'], 'CSV', 'csv', 'text/csv', ['Nested objects and arrays become JSON text inside a cell.', 'Numbers, true/false and null become text; null becomes an empty cell.', 'Columns follow the order keys first appear.'], jsonToTable('csv')),
    structured('json-tsv', 'JSON to TSV', ['json'], 'TSV', 'tsv', 'text/tab-separated-values', ['Nested objects and arrays become JSON text inside a cell.', 'Numbers, true/false and null become text; null becomes an empty cell.', 'Values with tabs or line breaks are refused (TSV cannot hold them).'], jsonToTable('tsv')),
    structured('csv-json', 'CSV to JSON', ['csv', 'text'], 'JSON', 'json', 'application/json', ['Every value stays text; numbers are not guessed.', 'The first row becomes the keys; repeated headers get _2, _3 suffixes.', 'Line endings and quoting style are not kept.'], tableToJson('csv')),
    structured('tsv-json', 'TSV to JSON', ['tsv', 'text'], 'JSON', 'json', 'application/json', ['Every value stays text; numbers are not guessed.', 'The first row becomes the keys; repeated headers get _2, _3 suffixes.'], tableToJson('tsv')),
    structured('csv-tsv', 'CSV to TSV', ['csv', 'text'], 'TSV', 'tsv', 'text/tab-separated-values', ['Values with tabs or line breaks are refused (TSV cannot hold them).', 'Line endings become LF.'], tableToTable('csv', 'tsv')),
    structured('tsv-csv', 'TSV to CSV', ['tsv', 'text'], 'CSV', 'csv', 'text/csv', ['Quoting is added where values need it; line endings become CRLF.'], tableToTable('tsv', 'csv')),
    structured('json-yaml', 'JSON to YAML', ['json'], 'YAML', 'yaml', 'application/yaml', ['Written as a documented YAML subset (block style, quoted strings where needed).', JSON_NUM], (t) => { const v = parseJson(t); const y = C.toYaml(v); if (!same(C.parseYaml(y), v)) fail('The YAML did not read back to the same data.'); return y; }),
    structured('yaml-json', 'YAML to JSON', ['yaml', 'text'], 'JSON', 'json', 'application/json', ['Comments are dropped.', 'Only the YAML subset is read: anchors, tags, block text and multiple documents are refused, not guessed.'], (t) => { const v = C.parseYaml(t); const s = JSON.stringify(v, null, 2) + '\n'; if (!same(JSON.parse(s), v)) fail('Validation failed.'); return s; }),
    structured('json-xml', 'JSON to XML', ['json'], 'XML', 'xml', 'application/xml', ['Numbers, true/false and null become text (null becomes nil="true").', 'Arrays become repeated item elements.', 'Keys that are not valid XML names become entry elements with a key attribute.'], (t) => { const r = C.jsonToXml(parseJson(t), 'root'); C.parseXml(r.text); return r.text; }),
    structured('xml-json', 'XML to JSON', ['xml', 'svg', 'html'], 'JSON', 'json', 'application/json', ['Attributes become "@name" keys and repeated elements become arrays.', 'Comments, processing instructions and whitespace between elements are dropped.', 'All values become text. Document type declarations are refused.'], (t) => { const v = C.xmlToJson(t); return JSON.stringify(v, null, 2) + '\n'; }),
    // Binary encodings
    { id: 'b64-std', cat: 'binary', name: 'Any file to Base64', from: 'any', to: 'Base64', lossy: [], async run(job) { const r = await U.streamEncode(job.file, {}, job.ctl, (p, d, t) => job.progress(d, t)); return [out(C.base64NameFor(job.file.name), r.blob, 'text/plain')]; } },
    { id: 'b64-url', cat: 'binary', name: 'Any file to Base64url', from: 'any', to: 'Base64url', lossy: [], async run(job) { const r = await U.streamEncode(job.file, { alphabet: 'url', pad: false }, job.ctl, (p, d, t) => job.progress(d, t)); return [out(job.file.name + '.base64url.txt', r.blob, 'text/plain')]; } },
    { id: 'b64-dec', cat: 'binary', name: 'Base64 to the original file', from: ['b64text', 'text', 'dataurl'], to: 'Original bytes', lossy: [], async run(job) { const r = await U.streamDecode(job.file, { strict: false }, job.ctl, (p, d, t) => job.progress(d, t)); const n = U.decodedName(job.file.name, r.mime, r.detected); return [out(n.name, r.blob, r.detected.mime)]; } },
    textEncoding('hex', 'Any file to hex text', 'hex.txt', (b) => C.toHex(b, { sep: ' ', lineBytes: 16 }), C.fromHex),
    textEncoding('bin', 'Any file to binary text', 'bin.txt', C.toBinaryText, C.fromBinaryText),
    textDecoding('hex-dec', 'Hex text to bytes', C.fromHex),
    textDecoding('bin-dec', 'Binary text to bytes', C.fromBinaryText),
    // Archives
    { id: 'zip-store', cat: 'archives', name: 'Files to ZIP (stored, no compression)', from: 'any', to: 'ZIP', batch: true, lossy: ['File dates become the time of conversion; folders and permissions are not kept.'] },
    { id: 'zip-deflate', cat: 'archives', name: 'Files to ZIP (deflate)', from: 'any', to: 'ZIP', batch: true, needs: 'streams', lossy: ['File dates become the time of conversion; folders and permissions are not kept.'] },
    { id: 'zip-extract', cat: 'archives', name: 'Extract a ZIP', from: ['zip'], to: 'Files', needs: 'streams', lossy: ['Folder structure is flattened into file names with slashes replaced.', 'Encrypted, ZIP64 and unusual-method entries are reported, not extracted.'],
      async run(job) {
        const entries = await C.readZip(await bytesOf(job, MAX_ZIP_TOTAL));
        if (entries.length > MAX_ZIP_ENTRIES) fail(`The archive has ${entries.length} entries; the limit is ${MAX_ZIP_ENTRIES}.`);
        const ok = entries.filter((e) => e.status === 'ok'), bad = entries.filter((e) => e.status === 'failed');
        job.note = `${ok.length} extracted${bad.length ? `; ${bad.length} not extracted: ` + bad.slice(0, 5).map((e) => `${e.name} (${e.reason})`).join(', ') : ''}`;
        if (!ok.length) fail('No entry could be extracted. ' + job.note);
        return ok.map((e) => out(C.safeFileName(e.name.replace(/\//g, '_')), e.bytes, C.detectType(e.bytes, e.name).mime));
      } },
    { id: 'gz-make', cat: 'archives', name: 'Gzip a file', from: 'any', to: 'GZIP', needs: 'streams', lossy: ['The original file name and date are not stored inside the gzip header.'],
      async run(job) { const b = await bytesOf(job); const z = await C.compress(b, 'gzip'); if (!C.bytesEqual(await C.decompress(z, 'gzip'), b)) fail('The gzip round trip did not match.'); return [out(job.file.name + '.gz', z, 'application/gzip')]; } },
    { id: 'gz-open', cat: 'archives', name: 'Gunzip a file', from: ['gzip'], to: 'Original bytes', needs: 'streams', lossy: [],
      async run(job) { const b = await C.decompress(await bytesOf(job), 'gzip', MAX_WHOLE); const name = /\.gz$/i.test(job.file.name) ? job.file.name.slice(0, -3) : stem(job.file.name) + '.' + C.detectType(b, '').ext; return [out(name, b, C.detectType(b, name).mime)]; } }
  ];

  // Known formats without a bundled, proven adapter. Listed so the gap is visible, never enabled.
  const PDF_ENGINE = 'Missing adapter: a bundled PDF engine (for example pdf-lib or qpdf). None ships with this app.';
  const OFFICE = 'Missing adapter: a bundled office document engine (for example LibreOffice). None ships with this app.';
  const AV = 'Missing adapter: a bundled audio and video codec (for example FFmpeg). None ships with this app.';
  const UNAVAILABLE = [
    ...['Inspect a PDF', 'Split a PDF', 'Merge PDFs', 'Extract PDF pages', 'Reorder PDF pages', 'Rotate PDF pages', 'Edit PDF metadata', 'PDF to images'].map((n) => ['documents', n, PDF_ENGINE]),
    ['documents', 'Word (DOCX) to PDF', OFFICE], ['documents', 'OpenDocument (ODT) to PDF', OFFICE], ['documents', 'Rich Text (RTF) to PDF', OFFICE], ['documents', 'PowerPoint (PPTX) to PDF', OFFICE], ['documents', 'Legacy Office (DOC, XLS, PPT) to modern formats', OFFICE],
    ['documents', 'Markdown to HTML', 'Missing adapter: the bundled Markdown renderer runs only inside the docs reader process; no converter adapter connects to it yet.'],
    ['images', 'HEIC to PNG or JPEG', 'Missing adapter: a bundled HEIC decoder (libheif). None ships with this app.'],
    ['images', 'TIFF to PNG or JPEG', 'Missing adapter: a bundled TIFF decoder (libtiff). The built-in image decoders do not read TIFF.'],
    ['images', 'Image to AVIF', 'Missing adapter: a bundled AVIF encoder (libavif). AVIF can be read here but not written.'],
    ['images', 'Image to animated GIF', 'Missing adapter: a bundled GIF encoder. None ships with this app.'],
    ['images', 'SVG to PNG', 'Missing adapter: a sandboxed SVG rasteriser. SVG is shown only as text so its scripts never run.'],
    ['images', 'Image to ICO', 'Missing adapter: an ICO writer. Not built in this version.'],
    ...['MP3 to WAV', 'WAV to MP3', 'FLAC to MP3', 'Ogg to MP3', 'M4A to MP3', 'Trim or join audio'].map((n) => ['audio', n, AV]),
    ...['MP4 to WebM', 'WebM to MP4', 'MOV to MP4', 'MKV to MP4', 'AVI to MP4', 'Video to GIF', 'Extract audio from video'].map((n) => ['video', n, AV]),
    ['archives', 'Extract RAR', 'Missing adapter: a bundled RAR decoder (unrar). None ships with this app.'],
    ['archives', 'Extract or create 7z', 'Missing adapter: a bundled 7-Zip engine. None ships with this app.'],
    ['archives', 'Extract or create TAR', 'Missing adapter: a TAR reader and writer. Not built in this version.'],
    ['archives', 'Extract bzip2 or xz', 'Missing adapter: bundled bzip2 and xz decoders. None ship with this app.'],
    ['archives', 'Encrypted ZIP', 'Missing adapter: ZIP password support. Encrypted entries are reported, never guessed.'],
    ['structured', 'Excel (XLSX) to CSV', 'Missing adapter: a bundled spreadsheet engine (for example SheetJS). None ships with this app.'],
    ['structured', 'CSV to Excel (XLSX)', 'Missing adapter: a bundled spreadsheet engine (for example SheetJS). None ships with this app.'],
    ['structured', 'OpenDocument spreadsheet (ODS) to CSV', 'Missing adapter: a bundled spreadsheet engine. None ships with this app.'],
    ['structured', 'Full YAML 1.2 (anchors, tags, block text)', 'Missing adapter: a bundled full YAML parser. Only the documented subset is supported.'],
    ['text', 'Format source code', 'Missing adapter: a bundled code formatter (for example Prettier). None ships with this app.'],
    ['text', 'Legacy code pages (Windows-1252, Shift JIS, GB 2312) to UTF-8', 'Missing adapter: bundled code page tables. Only UTF-8, UTF-16 and Latin-1 are supported.'],
    ['binary', 'Base32 and Ascii85', 'Missing adapter: Base32 and Ascii85 codecs. Not built in this version.']
  ].map(([cat, name, missing], k) => ({ id: 'na-' + k, cat, name, missing, enabled: false }));

  function enabledOf(a) { if (a.missing) return false; if (a.needs === 'streams' && !C.hasStreams()) { a.missing = 'Missing adapter: this runtime has no CompressionStream, so deflate and gzip are unavailable.'; return false; } return true; }
  for (const a of ADAPTERS) a.enabled = enabledOf(a);
  const ALL = ADAPTERS.concat(UNAVAILABLE);
  const matches = (a, det) => a.enabled && (a.from === 'any' ? det.id !== 'empty' : a.from.includes(det.id));

  function mount(root, ctx) {
    const items = []; const searches = {}; let cat = 'images', running = 0, paused = false, ack = false;
    root.classList.add('dt-root');
    root.innerHTML = `<p class="small dt-lead">Convert files on this device. Sources are never changed; results are checked before they are offered and saved through your download location.</p>
<div data-recover></div>
<section class="card" aria-labelledby="cvAddH"><h3 id="cvAddH" class="dt-h3">Files</h3><div data-drop></div>
  <div class="row dt-bulk"><button type="button" class="btn primary" data-a="start">Convert</button><button type="button" class="btn sm" data-a="pause">Pause</button><button type="button" class="btn sm" data-a="resume">Resume</button><button type="button" class="btn sm" data-a="cancel">Cancel</button><button type="button" class="btn sm" data-a="zip">Save all results as .zip</button><button type="button" class="btn sm light" data-a="clear">Clear finished</button></div>
  <div data-disclose></div>
  <p class="small" data-sum aria-live="polite"></p>
  <ul class="dt-list" aria-label="Conversion queue"></ul>
</section>
<section class="card" aria-labelledby="cvCatH"><h3 id="cvCatH" class="dt-h3">Adapter catalogue</h3>
  <p class="small">${ADAPTERS.filter((a) => a.enabled).length} conversions work offline here; ${ALL.filter((a) => !a.enabled).length} known conversions are unavailable and name what is missing.</p>
  <div data-cats></div><div data-csearch></div><p class="small" data-ccount aria-live="polite"></p><ul class="dt-cat" aria-label="Adapters"></ul>
</section>`;
    const list = root.querySelector('.dt-list');

    try {
      const rec = JSON.parse(localStorage.getItem(REC_KEY) || 'null');
      const unfinished = rec && Array.isArray(rec.items) ? rec.items.filter((i) => i.status === 'queued' || i.status === 'running') : [];
      if (unfinished.length) {
        const n = frag(`<div class="warn dt-recover"><span>The last session ended with ${unfinished.length} unfinished conversions (${esc(unfinished.slice(0, 3).map((i) => i.name).join(', '))}${unfinished.length > 3 ? ', ...' : ''}). Nothing partial was kept. Add those files again to convert them.</span><button type="button" class="btn sm">Dismiss</button></div>`);
        n.querySelector('button').addEventListener('click', () => { n.remove(); persist(true); });
        root.querySelector('[data-recover]').append(n);
      }
    } catch { /* a damaged record is ignored */ }
    function persist(clearOld) {
      const rec = { v: 1, at: new Date().toISOString(), items: (clearOld ? [] : items).slice(-500).map((i) => ({ name: i.file.name, size: i.file.size, adapter: i.adapterId || '', status: i.status })) };
      try { localStorage.setItem(REC_KEY, JSON.stringify(rec)); } catch { /* per-window only */ }
    }

    root.querySelector('[data-drop]').append(U.dropZone('Drop files here, or choose files', 'Type is detected from the first 4 KB of bytes, not the extension.', add));
    async function add(files) {
      for (const f of files) {
        const head = new Uint8Array(await f.slice(0, C.SNIFF_BYTES).arrayBuffer());
        const det = C.detectType(head, f.name);
        const it = { id: U.id('c'), file: f, det, adapterId: '', status: 'pending', ctl: U.control(), frac: 0, outputs: [], note: '' };
        items.push(it); list.append(row(it));
      }
      summary(); disclose();
    }
    function compatible(it) { return ADAPTERS.filter((a) => matches(a, it.det)); }
    function row(it) {
      const li = frag(`<li class="dt-item"><div class="dt-item-head"><strong class="dt-name"></strong><span class="small" data-st></span></div>
<div class="row"><label class="dt-inline">Convert with <select class="dt-select" data-pick></select></label><span class="small" data-target></span></div><div class="bar"><i></i></div><div class="row dt-item-acts"></div><div data-pv></div></li>`);
      li.querySelector('.dt-name').textContent = `${it.file.name} (${fmt(it.file.size)}) · ${it.det.label}`;
      const sel = li.querySelector('[data-pick]');
      const comp = compatible(it);
      sel.innerHTML = `<option value="">${comp.length ? 'Choose a conversion' : 'No offline conversion for this type'}</option>` + comp.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
      sel.disabled = !comp.length;
      sel.addEventListener('change', () => { it.adapterId = sel.value; paint(it); disclose(); });
      it.li = li; paint(it); return li;
    }
    function paint(it) {
      const li = it.li; const a = ADAPTERS.find((x) => x.id === it.adapterId);
      li.querySelector('[data-pick]').value = it.adapterId; li.querySelector('[data-pick]').disabled = it.status !== 'pending' || !compatible(it).length;
      li.querySelector('[data-target]').textContent = a ? (a.batch ? 'Joins one archive with the other files set to this' : `Result: ${a.to}`) : '';
      const st = li.querySelector('[data-st]');
      st.textContent = { pending: 'Not started', queued: paused ? 'Queued (paused)' : 'Queued', running: `${it.ctl.paused ? 'Paused' : 'Converting'} ${Math.round(it.frac * 100)}%`, converted: `Converted: ${it.outputs.length} result${it.outputs.length === 1 ? '' : 's'}${it.note ? ' · ' + it.note : ''}`, skipped: 'Skipped: ' + it.note, cancelled: 'Cancelled; nothing kept', failed: 'Failed: ' + it.note }[it.status];
      li.dataset.status = it.status;
      U.bar(li.querySelector('.bar'), it.status === 'converted' ? 1 : it.frac, it.status === 'running');
      const acts = li.querySelector('.dt-item-acts'); acts.innerHTML = '';
      const btn = (label, fn, cls) => { const b = frag(`<button type="button" class="btn sm ${cls || ''}"></button>`); b.textContent = label; b.addEventListener('click', fn); acts.append(b); };
      btn('Preview source', () => U.preview(li.querySelector('[data-pv]'), it.file, it.det), 'light');
      if (it.status === 'running') btn(it.ctl.paused ? 'Resume' : 'Pause', () => { if (it.ctl.paused) it.ctl.resume(); else it.ctl.pause(); paint(it); });
      if (it.status === 'running' || it.status === 'queued') btn('Cancel', () => { it.ctl.cancel(); if (it.status === 'queued') { it.status = 'cancelled'; paint(it); summary(); } }, 'light');
      if (it.status === 'converted') for (const o of it.outputs.slice(0, 20)) btn(`Save ${o.name}`, () => U.download(o.blob, o.name, o.mime), 'primary');
      if (it.status === 'converted' && it.outputs.length > 20) btn(`${it.outputs.length - 20} more: use Save all results as .zip`, () => {}, 'light');
      if (it.status === 'converted' && it.outputs[0]) btn('Preview result', () => U.preview(li.querySelector('[data-pv]'), it.outputs[0].blob, null));
      if (it.status !== 'running') btn('Remove', () => { it.ctl.cancel(); items.splice(items.indexOf(it), 1); li.remove(); summary(); disclose(); }, 'light');
    }
    function summary() {
      const c = { pending: 0, queued: 0, running: 0, converted: 0, skipped: 0, cancelled: 0, failed: 0 }; items.forEach((i) => c[i.status]++);
      root.querySelector('[data-sum]').textContent = items.length ? `${items.length} files: ${c.converted} converted, ${c.skipped} skipped, ${c.cancelled} cancelled, ${c.failed} failed, ${c.running} running, ${c.queued} queued, ${c.pending} not started.` : 'No files yet. Add files to see the conversions that work for them.';
      persist();
    }
    // Lossy and metadata changes are disclosed before the explicit Convert action.
    function disclose() {
      const box = root.querySelector('[data-disclose]'); box.innerHTML = '';
      const chosen = [...new Set(items.filter((i) => i.status === 'pending' && i.adapterId).map((i) => i.adapterId))].map((id) => ADAPTERS.find((a) => a.id === id));
      const lossy = chosen.filter((a) => a.lossy && a.lossy.length);
      ack = !lossy.length;
      root.querySelector('[data-a=start]').disabled = !chosen.length || !ack;
      if (!lossy.length) return;
      const d = frag(`<div class="warn dt-disclose"><strong>What these conversions change</strong><ul></ul><label class="switch-row dt-switch"><span>I have read what changes and want to convert</span><input type="checkbox" role="switch"></label></div>`);
      const ul = d.querySelector('ul');
      for (const a of lossy) { const li = document.createElement('li'); li.textContent = `${a.name}: ${a.lossy.join(' ')}`; ul.append(li); }
      d.querySelector('input').addEventListener('change', (e) => { ack = e.target.checked; root.querySelector('[data-a=start]').disabled = !ack; });
      box.append(d);
    }

    async function runItem(it) {
      const a = ADAPTERS.find((x) => x.id === it.adapterId);
      it.status = 'running'; paint(it); summary();
      const job = { file: it.file, det: it.det, ctl: it.ctl, bytes: null, note: '', progress: (d, t) => { it.frac = t ? d / t : 1; paint(it); } };
      try {
        await it.ctl.gate();
        const outs = await a.run(job);
        if (!outs || !outs.length) fail('The adapter produced no output.');
        it.outputs = outs; it.note = job.note; it.status = 'converted';
      } catch (e) {
        if (e.code === 'cancelled') it.status = 'cancelled'; else { it.status = 'failed'; it.note = e.message; }
      }
      job.bytes = null; // release the source bytes as soon as the item finishes
      paint(it); summary();
    }
    async function runZip(adapter, group) {
      group.forEach((i) => { i.status = 'running'; paint(i); }); summary();
      try {
        let total = 0; const entries = [];
        for (const i of group) {
          await i.ctl.gate();
          total += i.file.size; if (total > MAX_ZIP_TOTAL) fail(`The files add up to more than the ${fmt(MAX_ZIP_TOTAL)} archive limit.`);
          entries.push({ name: i.file.name, bytes: new Uint8Array(await i.file.arrayBuffer()) }); i.frac = 0.5; paint(i);
        }
        const zip = await C.buildZip(entries, { method: adapter.id === 'zip-deflate' ? 'deflate' : 'store' });
        const back = await C.readZip(zip);
        if (back.length !== entries.length || back.some((e, k) => e.status !== 'ok' || !C.bytesEqual(e.bytes, entries[k].bytes))) fail('The archive did not read back identically.');
        const o = out(group.length === 1 ? stem(group[0].file.name) + '.zip' : 'archive.zip', zip, 'application/zip');
        group.forEach((i, k) => { i.status = 'converted'; i.outputs = k === 0 ? [o] : []; i.note = k === 0 ? `${group.length} files in one archive` : `included in ${o.name}`; paint(i); });
      } catch (e) { group.forEach((i) => { if (e.code === 'cancelled') i.status = 'cancelled'; else { i.status = 'failed'; i.note = e.message; } paint(i); }); }
      summary();
    }
    async function pump() {
      while (running < CONCURRENCY && !paused) {
        const it = items.find((i) => i.status === 'queued'); if (!it) break;
        const a = ADAPTERS.find((x) => x.id === it.adapterId);
        running++;
        const p = a.batch ? runZip(a, items.filter((i) => i.status === 'queued' && i.adapterId === a.id)) : runItem(it);
        p.finally(() => { running--; pump(); });
      }
      if (!running && !items.some((i) => i.status === 'queued') && items.some((i) => ['converted', 'failed', 'cancelled', 'skipped'].includes(i.status))) {
        const c = { converted: 0, skipped: 0, cancelled: 0, failed: 0 }; items.forEach((i) => { if (i.status in c) c[i.status]++; });
        if (pump.announce) { pump.announce = false; ctx.notify({ kind: c.failed ? 'error' : 'ok', title: 'Conversion finished', body: `${c.converted} converted, ${c.skipped} skipped, ${c.cancelled} cancelled, ${c.failed} failed.` }); }
      }
    }
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('.dt-bulk [data-a]'); if (!b) return;
      const k = b.dataset.a;
      if (k === 'start') {
        if (!ack) return;
        for (const i of items.filter((x) => x.status === 'pending')) {
          if (!i.adapterId) { i.status = 'skipped'; i.note = compatible(i).length ? 'no conversion was chosen' : `no offline conversion for ${i.det.label}`; }
          else i.status = 'queued';
          paint(i);
        }
        paused = false; pump.announce = true; summary(); disclose(); pump();
      }
      if (k === 'pause') { paused = true; items.forEach((i) => { if (i.status === 'running') i.ctl.pause(); paint(i); }); }
      if (k === 'resume') { paused = false; items.forEach((i) => { i.ctl.resume(); paint(i); }); pump(); }
      if (k === 'cancel') items.forEach((i) => { if (i.status === 'running' || i.status === 'queued') { i.ctl.cancel(); if (i.status === 'queued') i.status = 'cancelled'; paint(i); } });
      if (k === 'clear') for (const i of items.filter((x) => !['running', 'queued', 'pending'].includes(x.status))) { items.splice(items.indexOf(i), 1); i.li.remove(); }
      if (k === 'zip') {
        const outs = items.flatMap((i) => i.outputs);
        if (!outs.length) return ctx.toast('No results to save yet.', 'error');
        b.disabled = true;
        try {
          const entries = []; for (const o of outs) entries.push({ name: o.name, bytes: new Uint8Array(await o.blob.arrayBuffer()) });
          const zip = await C.buildZip(entries, { method: C.hasStreams() ? 'deflate' : 'store' });
          const back = await C.readZip(zip); if (back.some((x) => x.status !== 'ok')) fail('The .zip did not read back cleanly.');
          U.download(zip, 'converted-files.zip', 'application/zip');
        } catch (err) { ctx.toast('The .zip could not be built: ' + err.message, 'error'); }
        b.disabled = false;
      }
      summary();
    });

    // Catalogue: one category at a time, each with its own search and regex builder.
    const counts = (c) => { const xs = ALL.filter((a) => a.cat === c); return `${xs.filter((a) => a.enabled).length}/${xs.length}`; };
    const catSeg = U.seg('Adapter category', CATS.map(([k, n]) => [k, `${n} ${counts(k)}`]), cat, (v) => { cat = v; renderCat(); }, true);
    root.querySelector('[data-cats]').append(catSeg);
    function searchFor(c) {
      if (!searches[c]) searches[c] = window.MVL && window.MVL.makeSearch ? window.MVL.makeSearch({ placeholder: 'Search ' + CATS.find(([k]) => k === c)[1].toLowerCase(), label: 'Search ' + CATS.find(([k]) => k === c)[1], onChange: renderCat }) : null;
      return searches[c];
    }
    function renderCat() {
      const holder = root.querySelector('[data-csearch]'); holder.innerHTML = '';
      const s = searchFor(cat); if (s) holder.append(s.el);
      const ul = root.querySelector('.dt-cat'); ul.innerHTML = '';
      const xs = ALL.filter((a) => a.cat === cat);
      const shown = xs.filter((a) => !s || !s.active() || s.test([a.name, a.to || '', a.missing || '', (a.lossy || []).join(' ')].join(' ')));
      root.querySelector('[data-ccount]').textContent = `${shown.length} of ${xs.length} adapters in ${CATS.find(([k]) => k === cat)[1]}${s && s.invalid() ? ' (the pattern is invalid)' : ''}.`;
      for (const a of shown) {
        const li = frag(`<li class="dt-adapter${a.enabled ? '' : ' off'}" ${a.enabled ? '' : 'aria-disabled="true"'}><div><strong></strong><span class="dt-chip"></span></div><p class="small" data-d></p></li>`);
        li.querySelector('strong').textContent = a.name;
        li.querySelector('.dt-chip').textContent = a.enabled ? 'Ready offline' : 'Unavailable';
        li.querySelector('[data-d]').textContent = a.enabled ? `From ${a.from === 'any' ? 'any file' : a.from.join(', ')} to ${a.to}.${a.lossy && a.lossy.length ? ' Changes: ' + a.lossy.join(' ') : ' Lossless.'}` : a.missing;
        if (a.enabled) {
          const n = items.filter((i) => i.status === 'pending' && matches(a, i.det)).length;
          const b = frag(`<button type="button" class="btn sm"></button>`); b.textContent = `Use for matching files (${n})`; b.disabled = !n;
          b.addEventListener('click', () => { items.forEach((i) => { if (i.status === 'pending' && matches(a, i.det)) { i.adapterId = a.id; paint(i); } }); disclose(); ctx.toast(`${a.name} chosen for ${n} file${n === 1 ? '' : 's'}.`, 'ok'); renderCat(); });
          li.append(b);
        }
        ul.append(li);
      }
    }
    renderCat(); summary();
    mount.cleanup = () => items.forEach((i) => i.ctl.cancel());
  }

  window.MVLTools.register({ id: 'file-converter', title: 'File converter', group: 'Data tools', summary: 'Convert images, text, data and archives on this device', mount, unmount: () => { if (mount.cleanup) mount.cleanup(); } });
  window.MVLDataConverter = { adapters: () => ALL.map((a) => ({ id: a.id, cat: a.cat, name: a.name, enabled: a.enabled, missing: a.missing || '' })) };
})();
