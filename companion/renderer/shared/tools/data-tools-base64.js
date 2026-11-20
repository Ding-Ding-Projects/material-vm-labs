'use strict';
// Base64 toolkit (feature base64-tools). Text, files, data: URLs, same-folder conversion and a local
// history with undo and redo. Everything runs on this device; nothing is uploaded.
(function () {
  const C = window.MVLDataCore, U = window.MVLDataUI;
  if (!C || !U || !window.MVLTools) return;
  const { esc, fmt, frag } = U;
  const OPT_KEY = 'mvl.datatools.b64.options.v1';
  const HIST_KEY = 'mvl.datatools.b64.history.v1';
  const PANES = [['text', 'Text'], ['files', 'Files'], ['dataurl', 'Data URL'], ['folder', 'Same folder'], ['history', 'History']];
  const TEXT_LIMIT = 16 * 1024 * 1024;

  function loadOpts() {
    const d = { alphabet: 'standard', pad: true, wrap: 'none', lineLength: 76, eol: '\r\n', mode: 'strict', encoding: 'utf-8', pane: 'text' };
    try { return Object.assign(d, JSON.parse(localStorage.getItem(OPT_KEY) || '{}')); } catch { return d; }
  }

  function mount(root, ctx) {
    const o = loadOpts();
    const hist = U.history(HIST_KEY);
    const cleanups = [];
    const saveOpts = () => { try { localStorage.setItem(OPT_KEY, JSON.stringify(o)); } catch { /* per-window only */ } };
    const encOpts = () => ({ alphabet: o.alphabet, pad: o.pad, lineLength: o.wrap === 'mime' ? C.MIME_LINE : o.wrap === 'custom' ? Math.max(1, o.lineLength | 0) : 0, eol: o.wrap === 'mime' ? '\r\n' : o.eol });
    const decOpts = () => ({ alphabet: o.alphabet, pad: o.pad, strict: o.mode === 'strict' });
    const optSummary = () => `${o.alphabet === 'url' ? 'URL-safe' : 'Standard'}, padding ${o.pad ? 'on' : 'off'}, ${o.wrap === 'mime' ? 'MIME 76 CRLF' : o.wrap === 'custom' ? 'lines of ' + (o.lineLength | 0) : 'no wrap'}, ${o.mode}, ${C.ENCODING_LABELS[o.encoding]}`;

    root.classList.add('dt-root');
    root.innerHTML = `<p class="small dt-lead">Encode and decode Base64 on this device. Nothing is uploaded.</p>
<section class="card dt-opts" aria-labelledby="b64OptsH"><h3 id="b64OptsH" class="dt-h3">Options</h3><div class="dt-optgrid"></div></section>
<div class="dt-panes-nav"></div><div class="dt-pane"></div>`;
    const grid = root.querySelector('.dt-optgrid');
    const field = (label, control, hint) => { const f = frag(`<div class="dt-field"><span class="dt-label">${esc(label)}</span></div>`); f.append(control); if (hint) f.append(frag(`<span class="small">${esc(hint)}</span>`)); return f; };
    grid.append(field('Alphabet', U.seg('Alphabet', [['standard', 'Standard'], ['url', 'URL-safe']], o.alphabet, (v) => { o.alphabet = v; saveOpts(); }), 'Standard uses + and /, URL-safe uses - and _ (RFC 4648).'));
    const custom = frag(`<span class="row dt-custom"><label class="dt-inline">Line length <input type="number" min="1" max="100000" value="${o.lineLength | 0}" class="dt-num" aria-label="Custom line length"></label><label class="dt-inline">Line ending <select class="dt-select" aria-label="Line ending"><option value="\r\n">CRLF</option><option value="\n">LF</option></select></label></span>`);
    custom.querySelector('select').value = o.eol;
    custom.querySelector('input').addEventListener('change', (e) => { o.lineLength = Math.max(1, Math.min(100000, e.target.value | 0)); e.target.value = o.lineLength; saveOpts(); });
    custom.querySelector('select').addEventListener('change', (e) => { o.eol = e.target.value; saveOpts(); });
    custom.hidden = o.wrap !== 'custom';
    const wrapF = field('Line wrapping', U.seg('Line wrapping', [['none', 'None'], ['mime', 'MIME (76, CRLF)'], ['custom', 'Custom']], o.wrap, (v) => { o.wrap = v; custom.hidden = v !== 'custom'; saveOpts(); }));
    wrapF.append(custom); grid.append(wrapF);
    grid.append(field('Decoder', U.seg('Decoder', [['strict', 'Strict'], ['lenient', 'Lenient']], o.mode, (v) => { o.mode = v; saveOpts(); }), 'Strict rejects any character outside the alphabet (line breaks aside) and shows its offset. Lenient ignores whitespace and accepts missing padding.'));
    const padRow = frag(`<label class="switch-row dt-switch"><span>Padding with =</span><input type="checkbox" role="switch" ${o.pad ? 'checked' : ''}></label>`);
    padRow.querySelector('input').addEventListener('change', (e) => { o.pad = e.target.checked; saveOpts(); });
    grid.append(padRow);
    const encSel = frag(`<select class="dt-select" aria-label="Text encoding">${C.ENCODINGS.map((e) => `<option value="${e}">${esc(C.ENCODING_LABELS[e])}</option>`).join('')}</select>`);
    encSel.value = o.encoding; encSel.addEventListener('change', () => { o.encoding = encSel.value; saveOpts(); if (panes.text) panes.text.counts(); });
    grid.append(field('Text encoding', encSel, 'Used for text in and text out.'));

    const pane = root.querySelector('.dt-pane');
    const panes = {};
    const nav = U.seg('Toolkit section', PANES, o.pane, (v) => show(v), true);
    root.querySelector('.dt-panes-nav').append(nav);
    function show(v) {
      o.pane = v; saveOpts(); nav.set(v);
      for (const k of Object.keys(panes)) panes[k].el.hidden = k !== v;
      if (!panes[v]) { panes[v] = BUILD[v](); pane.append(panes[v].el); }
      if (panes[v].shown) panes[v].shown();
    }

    // ------------------------------------------------------------ Text
    function textPane() {
      const el = frag(`<section class="dt-section" aria-label="Text">
<div class="dt-two">
  <div class="dt-col"><label class="dt-label" for="b64In">Text</label><textarea id="b64In" class="dt-area" spellcheck="false" placeholder="Type or paste text"></textarea><span class="small" data-c="in" aria-live="polite"></span>
    <div class="row"><button type="button" class="btn primary" data-a="encode">Encode to Base64</button><button type="button" class="btn light sm" data-a="open-text">Open text file</button></div></div>
  <div class="dt-col"><label class="dt-label" for="b64Out">Base64</label><textarea id="b64Out" class="dt-area dt-mono" spellcheck="false" placeholder="Paste Base64 here"></textarea><span class="small" data-c="out" aria-live="polite"></span>
    <div class="row"><button type="button" class="btn primary" data-a="decode">Decode to text</button><button type="button" class="btn light sm" data-a="paste">Paste from clipboard</button><button type="button" class="btn light sm" data-a="open-b64">Open Base64 file</button></div></div>
</div>
<div data-err role="alert"></div>
<div class="card dt-export" aria-label="Export"><h3 class="dt-h3">Export</h3>
  <div class="row"><button type="button" class="btn sm" data-a="copy">Copy Base64</button><button type="button" class="btn sm" data-a="save">Save as .b64</button><button type="button" class="btn sm" data-a="dataurl">Copy as data: URL</button><button type="button" class="btn sm" data-a="json">Save JSON record</button><button type="button" class="btn sm" data-a="savebytes" hidden>Save decoded bytes</button></div>
  <label class="switch-row dt-switch"><span>Include the payload in the JSON record</span><input type="checkbox" role="switch" data-a="withpayload"></label>
</div>
<div data-prev></div>
<input type="file" hidden data-file="text"><input type="file" hidden data-file="b64" accept=".txt,.b64,text/plain">
</section>`);
      const tin = el.querySelector('#b64In'), tout = el.querySelector('#b64Out'), errBox = el.querySelector('[data-err]'), prev = el.querySelector('[data-prev]');
      let last = null; // last conversion record
      let lastBytes = null;
      function counts() {
        let inBytes = '';
        try { inBytes = fmt(C.encodeText(tin.value, o.encoding).length) + ' in ' + C.ENCODING_LABELS[o.encoding]; }
        catch (e) { inBytes = e.message; }
        el.querySelector('[data-c=in]').textContent = `${tin.value.length} characters · ${inBytes}`;
        const sig = tout.value.replace(/[\s=]/g, '').length;
        el.querySelector('[data-c=out]').textContent = `${tout.value.length} characters · about ${fmt(Math.floor(sig * 3 / 4))} when decoded`;
      }
      tin.addEventListener('input', counts); tout.addEventListener('input', counts);
      function showErr(r, area) {
        errBox.innerHTML = '';
        if (!r) return;
        const box = frag(`<div class="errbox dt-err"><strong>${esc(TITLES[r.code] || 'Could not convert')}</strong><span>${esc(r.message)}</span></div>`);
        if (r.offset >= 0 && area) {
          const b = frag('<button type="button" class="btn sm light">Show the character</button>');
          b.addEventListener('click', () => { area.focus(); area.setSelectionRange(r.offset, Math.min(area.value.length, r.offset + 1)); });
          box.append(b);
        }
        errBox.append(box);
      }
      function record(kind, before, after, meta) {
        hist.push(Object.assign({ kind, options: optSummary(), opts: Object.assign({}, o) }, meta), { before, after });
      }
      function encode() {
        showErr(null); prev.innerHTML = '';
        if (!tin.value) return showErr({ code: 'empty', message: 'Type or paste some text to encode.' });
        let bytes;
        try { bytes = C.encodeText(tin.value, o.encoding); } catch (e) { return showErr({ code: e.code, message: e.message, offset: e.offset }, tin); }
        const before = { input: tin.value, b64: tout.value };
        tout.value = C.encodeBase64(bytes, encOpts());
        lastBytes = bytes;
        last = { direction: 'encode', inputBytes: bytes.length, outputChars: tout.value.length, sha256: C.sha256Hex(bytes) };
        el.querySelector('[data-a=savebytes]').hidden = true;
        counts();
        record('Encode text', before, { input: tin.value, b64: tout.value }, { name: 'Text', size: bytes.length, sha256: last.sha256 });
        ctx.toast(`Encoded ${fmt(bytes.length)} into ${tout.value.length} characters.`, 'ok');
      }
      async function decode() {
        showErr(null); prev.innerHTML = '';
        if (!tout.value.trim()) return showErr({ code: 'empty', message: 'Paste some Base64 to decode.' });
        let src = tout.value, mime = '';
        if (/^\s*data:/i.test(src)) { try { const p = C.parseDataUrl(src); return finishDecode(p.bytes, p.mime); } catch (e) { return showErr({ code: e.code, message: e.message, offset: e.offset }, tout); } }
        const r = C.tryDecodeBase64(src, decOpts());
        if (!r.ok) return showErr(r, tout);
        return finishDecode(r.bytes, mime);
      }
      async function finishDecode(bytes, mime) {
        const before = { input: tin.value, b64: tout.value };
        lastBytes = bytes;
        const det = C.detectType(bytes, '');
        last = { direction: 'decode', inputChars: tout.value.length, outputBytes: bytes.length, sha256: C.sha256Hex(bytes), detected: det.label };
        el.querySelector('[data-a=savebytes]').hidden = false;
        let text = null;
        try { text = C.decodeText(bytes, o.encoding); } catch (e) { showErr({ code: 'invalid-text', message: e.message + ' The bytes are kept: preview or save them below.' }); }
        if (text != null) tin.value = text;
        counts();
        record('Decode text', before, { input: tin.value, b64: tout.value }, { name: 'Text', size: bytes.length, sha256: last.sha256 });
        await U.preview(prev, new Blob([bytes]), det, o.encoding);
        ctx.toast(`Decoded ${fmt(bytes.length)}${text == null ? ' (not text in ' + C.ENCODING_LABELS[o.encoding] + ')' : ''}.`, text == null ? 'info' : 'ok');
      }
      const fText = el.querySelector('[data-file=text]'), fB64 = el.querySelector('[data-file=b64]');
      fText.addEventListener('change', async () => { const f = fText.files[0]; fText.value = ''; if (!f) return; if (f.size > TEXT_LIMIT) return showErr({ code: 'too-large', message: `${f.name} is ${fmt(f.size)}. The text box takes up to ${fmt(TEXT_LIMIT)}; use Files for larger files.` }); try { tin.value = C.decodeText(new Uint8Array(await f.arrayBuffer()), o.encoding); counts(); } catch (e) { showErr({ code: 'invalid-text', message: e.message }); } });
      fB64.addEventListener('change', async () => { const f = fB64.files[0]; fB64.value = ''; if (!f) return; if (f.size > TEXT_LIMIT) return showErr({ code: 'too-large', message: `${f.name} is ${fmt(f.size)}. Use Files for Base64 larger than ${fmt(TEXT_LIMIT)}.` }); tout.value = C.decodeText(new Uint8Array(await f.arrayBuffer()), 'latin1'); counts(); });
      el.addEventListener('click', async (e) => {
        const a = e.target.closest('[data-a]'); if (!a || a.tagName === 'INPUT') return;
        const k = a.dataset.a;
        if (k === 'encode') encode();
        else if (k === 'decode') decode();
        else if (k === 'open-text') fText.click();
        else if (k === 'open-b64') fB64.click();
        else if (k === 'paste') { const t = await U.readClipboard(ctx); if (t != null) { tout.value = t; counts(); tout.focus(); } }
        else if (k === 'copy') { if (!tout.value) return ctx.toast('There is no Base64 to copy yet.', 'error'); U.copyText(tout.value, ctx); }
        else if (k === 'save') { if (!tout.value) return ctx.toast('There is no Base64 to save yet.', 'error'); U.download(new Blob([tout.value], { type: 'text/plain' }), 'text.b64'); }
        else if (k === 'dataurl') {
          let bytes; try { bytes = C.encodeText(tin.value, o.encoding); } catch (err) { return showErr({ code: err.code, message: err.message, offset: err.offset }, tin); }
          if (!bytes.length) return ctx.toast('There is no text to put in a data: URL.', 'error');
          U.copyText(C.buildDataUrl(bytes, 'text/plain', { charset: o.encoding === 'latin1' ? 'ISO-8859-1' : o.encoding.toUpperCase() }), ctx);
        }
        else if (k === 'json') {
          if (!last) return ctx.toast('Convert something first; the record describes the last conversion.', 'error');
          const withPayload = el.querySelector('[data-a=withpayload]').checked;
          const rec = Object.assign({ tool: 'Material VM Labs Base64 toolkit', at: new Date().toISOString(), variant: o.alphabet === 'url' ? 'base64url' : 'base64', options: { padding: o.pad, wrap: o.wrap, lineLength: encOpts().lineLength, lineEnding: encOpts().eol === '\r\n' ? 'CRLF' : 'LF', decoder: o.mode, textEncoding: o.encoding } }, last);
          if (withPayload) { rec.base64 = tout.value; rec.text = tin.value; }
          U.download(new Blob([JSON.stringify(rec, null, 2)], { type: 'application/json' }), 'base64-record.json');
        }
        else if (k === 'savebytes') { if (lastBytes) { const det = C.detectType(lastBytes, ''); U.download(lastBytes, 'decoded.' + det.ext); } }
      });
      counts();
      return { el, counts, set(s) { tin.value = s.input; tout.value = s.b64; counts(); errBox.innerHTML = ''; prev.innerHTML = ''; } };
    }

    // ------------------------------------------------------------ Files
    function filesPane() {
      let direction = 'encode';
      const items = [];
      const el = frag(`<section class="dt-section" aria-label="Files">
<div class="row dt-dir"></div>
<div data-drop></div>
<div class="row dt-bulk"><button type="button" class="btn sm" data-a="pauseall">Pause all</button><button type="button" class="btn sm" data-a="resumeall">Resume all</button><button type="button" class="btn sm" data-a="cancelall">Cancel all</button><button type="button" class="btn sm" data-a="zip">Save all as .zip</button><button type="button" class="btn sm light" data-a="clear">Clear finished</button></div>
<p class="small" data-sum aria-live="polite"></p>
<ul class="dt-list" aria-label="File queue"></ul>
<p class="small">Results stay in this window until you save them. Each result is checked by a SHA-256 round trip before it shows as done.</p>
</section>`);
      const dirSeg = U.seg('Direction', [['encode', 'Encode files'], ['decode', 'Decode Base64 files']], direction, (v) => { direction = v; zone.zone.querySelector('strong').textContent = v === 'encode' ? 'Drop files to encode, or choose files' : 'Drop Base64 files (.b64, .txt, data: URL) to decode, or choose files'; });
      el.querySelector('.dt-dir').append(dirSeg);
      const zone = U.dropZone('Drop files to encode, or choose files', 'Any type and any size; large files stream in chunks.', (files) => add(files));
      el.querySelector('[data-drop]').append(zone);
      const list = el.querySelector('.dt-list');
      let running = 0;
      function add(files) { for (const f of files) { const it = { id: U.id('f'), file: f, dir: direction, status: 'queued', ctl: U.control(), frac: 0, phase: '' }; items.push(it); list.append(row(it)); } pump(); summary(); }
      function row(it) {
        const li = frag(`<li class="dt-item" data-id="${it.id}"><div class="dt-item-head"><strong class="dt-name"></strong><span class="small" data-st></span></div><div class="bar"><i></i></div><div class="row dt-item-acts"></div><div data-pv></div></li>`);
        li.querySelector('.dt-name').textContent = `${it.dir === 'encode' ? 'Encode' : 'Decode'}: ${it.file.name} (${fmt(it.file.size)})`;
        it.li = li; paint(it); return li;
      }
      function paint(it) {
        const li = it.li; if (!li) return;
        const st = li.querySelector('[data-st]');
        const phase = it.phase === 'verify' ? 'verifying the SHA-256 round trip' : it.dir === 'encode' ? 'encoding' : 'decoding';
        st.textContent = it.status === 'running' ? `${it.ctl.paused ? 'Paused' : 'Running'}: ${phase} ${Math.round(it.frac * 100)}%` : it.status === 'done' ? `Done and verified · ${fmt(it.result.bytesOut)} · SHA-256 ${it.result.sha256.slice(0, 12)}` : it.status === 'failed' ? `Failed: ${it.error}` : it.status === 'cancelled' ? 'Cancelled; nothing kept' : 'Queued';
        U.bar(li.querySelector('.bar'), it.status === 'done' ? 1 : it.frac, it.status === 'running');
        const acts = li.querySelector('.dt-item-acts'); acts.innerHTML = '';
        const btn = (label, fn, cls) => { const b = frag(`<button type="button" class="btn sm ${cls || ''}">${esc(label)}</button>`); b.addEventListener('click', fn); acts.append(b); };
        if (it.status === 'running' || it.status === 'queued') {
          if (it.ctl.paused) btn('Resume', () => { it.ctl.resume(); paint(it); }); else btn('Pause', () => { it.ctl.pause(); paint(it); });
          btn('Cancel', () => { it.ctl.cancel(); if (it.status === 'queued') { it.status = 'cancelled'; paint(it); summary(); } }, 'light');
        }
        if (it.status === 'done') {
          btn(`Save ${it.result.name}`, () => U.download(it.result.blob, it.result.name), 'primary');
          btn('Preview', () => U.preview(li.querySelector('[data-pv]'), it.result.blob, it.dir === 'decode' ? it.result.detected : null, it.dir === 'encode' ? 'latin1' : undefined));
          if (it.dir === 'decode' && it.result.blob.size <= U.PREVIEW_MEDIA) btn('Copy as data: URL', async () => U.copyText(await U.blobToDataUrl(it.result.blob, it.result.detected.mime), ctx));
          if (it.dir === 'encode' && it.result.blob.size <= U.PREVIEW_MEDIA) btn('Copy Base64', async () => U.copyText(await it.result.blob.text(), ctx));
        }
        if (it.status !== 'running') btn('Remove', () => { it.ctl.cancel(); items.splice(items.indexOf(it), 1); li.remove(); summary(); }, 'light');
      }
      function summary() {
        const c = { queued: 0, running: 0, done: 0, failed: 0, cancelled: 0 }; items.forEach((i) => c[i.status]++);
        el.querySelector('[data-sum]').textContent = items.length ? `${items.length} files: ${c.done} done, ${c.running} running, ${c.queued} queued, ${c.failed} failed, ${c.cancelled} cancelled.` : 'No files yet. Drop files above or choose them.';
      }
      async function pump() {
        while (running < 2) {
          const it = items.find((i) => i.status === 'queued' && !i.ctl.cancelled); if (!it) return;
          running++; it.status = 'running'; paint(it); summary();
          (async () => {
            try {
              const prog = (phase, d, t) => { it.phase = phase; it.frac = t ? d / t : 1; paint(it); };
              if (it.dir === 'encode') {
                const r = await U.streamEncode(it.file, encOpts(), it.ctl, prog);
                it.result = Object.assign(r, { name: C.base64NameFor(it.file.name) });
              } else {
                const r = await U.streamDecode(it.file, decOpts(), it.ctl, prog);
                const nm = U.decodedName(it.file.name, r.mime, r.detected);
                it.result = Object.assign(r, { name: nm.name, nameSource: nm.source });
                r.blob = new Blob([r.blob], { type: r.detected.mime });
              }
              it.status = 'done';
              hist.push({ kind: it.dir === 'encode' ? 'Encode file' : 'Decode file', name: it.file.name, size: it.file.size, outName: it.result.name, outSize: it.result.bytesOut, sha256: it.result.sha256, options: optSummary(), ref: it.id });
            } catch (e) {
              if (e.code === 'cancelled') it.status = 'cancelled'; else { it.status = 'failed'; it.error = e.message; }
            }
            running--; paint(it); summary(); pump();
          })();
        }
      }
      el.addEventListener('click', async (e) => {
        const a = e.target.closest('.dt-bulk [data-a]'); if (!a) return;
        const k = a.dataset.a;
        if (k === 'pauseall') items.forEach((i) => { if (i.status === 'running' || i.status === 'queued') { i.ctl.pause(); paint(i); } });
        if (k === 'resumeall') items.forEach((i) => { i.ctl.resume(); paint(i); });
        if (k === 'cancelall') items.forEach((i) => { if (i.status === 'running' || i.status === 'queued') { i.ctl.cancel(); if (i.status === 'queued') i.status = 'cancelled'; paint(i); } });
        if (k === 'clear') for (const i of items.filter((x) => x.status !== 'running' && x.status !== 'queued')) { items.splice(items.indexOf(i), 1); i.li.remove(); }
        if (k === 'zip') {
          const done = items.filter((i) => i.status === 'done');
          if (!done.length) return ctx.toast('No finished results to put in a .zip yet.', 'error');
          a.disabled = true; a.textContent = 'Building the .zip';
          try {
            const entries = [];
            for (const i of done) entries.push({ name: i.result.name, bytes: new Uint8Array(await i.result.blob.arrayBuffer()) });
            const method = C.hasStreams() ? 'deflate' : 'store';
            const zip = await C.buildZip(entries, { method });
            const check = await C.readZip(zip);
            if (check.some((x) => x.status !== 'ok')) throw new Error('The .zip did not read back cleanly.');
            U.download(zip, 'base64-results.zip', 'application/zip');
            ctx.toast(`Built a .zip of ${entries.length} results (${method === 'deflate' ? 'deflate' : 'stored, no compression'}) and checked it reads back.`, 'ok');
          } catch (err) { ctx.toast('The .zip could not be built: ' + err.message, 'error'); }
          a.disabled = false; a.textContent = 'Save all as .zip';
        }
        summary();
      });
      summary();
      return { el, items, hide(ref, hidden) { const it = items.find((i) => i.id === ref); if (it && it.li) it.li.hidden = hidden; return !!it; } };
    }

    // ------------------------------------------------------------ Data URL
    function dataUrlPane() {
      const el = frag(`<section class="dt-section" aria-label="Data URL">
<div class="card"><h3 class="dt-h3">Build a data: URL</h3>
  <div class="row"><button type="button" class="btn sm" data-a="from-text">From the Text box</button><button type="button" class="btn sm" data-a="from-file">From a file</button></div>
  <label class="dt-field"><span class="dt-label">MIME type</span><input class="dt-input" data-mime list="dtMimes" spellcheck="false" placeholder="Detected automatically"></label>
  <datalist id="dtMimes">${['text/plain', 'application/json', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'application/octet-stream'].map((m) => `<option value="${m}">`).join('')}</datalist>
  <p class="small" data-binfo aria-live="polite"></p>
  <label class="dt-label" for="dtBuilt">data: URL</label><textarea id="dtBuilt" class="dt-area dt-mono" readonly></textarea>
  <div class="row"><button type="button" class="btn sm" data-a="copy-built">Copy</button><button type="button" class="btn sm" data-a="save-built">Save as .txt</button></div>
</div>
<div class="card"><h3 class="dt-h3">Parse a data: URL</h3>
  <label class="dt-label" for="dtParse">Paste a data: URL</label><textarea id="dtParse" class="dt-area dt-mono" spellcheck="false" placeholder="data:image/png;base64,..."></textarea>
  <div class="row"><button type="button" class="btn primary" data-a="parse">Parse</button><button type="button" class="btn sm light" data-a="paste">Paste from clipboard</button></div>
  <div data-perr role="alert"></div><dl class="kv" data-kv></dl>
  <div class="row"><button type="button" class="btn sm" data-a="save-parsed" hidden>Save the bytes</button></div><div data-pv></div>
</div><input type="file" hidden data-file></section>`);
      const mimeIn = el.querySelector('[data-mime]'), built = el.querySelector('#dtBuilt'), info = el.querySelector('[data-binfo]');
      let parsed = null;
      function build(bytes, mime, params, label) {
        try { built.value = C.buildDataUrl(bytes, mime, params); info.textContent = `${label}: ${fmt(bytes.length)} as ${mime}, ${built.value.length} characters.`; hist.push({ kind: 'Build data: URL', name: label, size: bytes.length, sha256: C.sha256Hex(bytes), options: mime }); }
        catch (e) { info.textContent = e.message; }
      }
      const fileIn = el.querySelector('[data-file]');
      fileIn.addEventListener('change', async () => {
        const f = fileIn.files[0]; fileIn.value = ''; if (!f) return;
        if (f.size > U.PREVIEW_MEDIA) { info.textContent = `${f.name} is ${fmt(f.size)}; a data: URL here is limited to ${fmt(U.PREVIEW_MEDIA)}. Use Files to encode larger files.`; return; }
        const bytes = new Uint8Array(await f.arrayBuffer()); const det = C.detectType(bytes, f.name);
        const mime = mimeIn.value.trim() || det.mime; mimeIn.placeholder = 'Detected: ' + det.mime;
        build(bytes, mime, {}, f.name);
      });
      el.addEventListener('click', async (e) => {
        const a = e.target.closest('[data-a]'); if (!a) return;
        const k = a.dataset.a;
        if (k === 'from-text') {
          const t = panes.text ? panes.text.el.querySelector('#b64In').value : '';
          if (!t) { info.textContent = 'The Text box is empty. Type text in the Text section first.'; return; }
          let bytes; try { bytes = C.encodeText(t, o.encoding); } catch (err) { info.textContent = err.message; return; }
          build(bytes, mimeIn.value.trim() || 'text/plain', { charset: o.encoding === 'latin1' ? 'ISO-8859-1' : o.encoding.toUpperCase() }, 'Text');
        }
        if (k === 'from-file') fileIn.click();
        if (k === 'copy-built') { if (built.value) U.copyText(built.value, ctx); else ctx.toast('Build a data: URL first.', 'error'); }
        if (k === 'save-built') { if (built.value) U.download(new Blob([built.value], { type: 'text/plain' }), 'data-url.txt'); else ctx.toast('Build a data: URL first.', 'error'); }
        if (k === 'paste') { const t = await U.readClipboard(ctx); if (t != null) el.querySelector('#dtParse').value = t; }
        if (k === 'parse') {
          const box = el.querySelector('[data-perr]'), kv = el.querySelector('[data-kv]'), pv = el.querySelector('[data-pv]');
          box.innerHTML = ''; kv.innerHTML = ''; pv.innerHTML = ''; parsed = null; el.querySelector('[data-a=save-parsed]').hidden = true;
          const src = el.querySelector('#dtParse').value;
          if (!src.trim()) { box.append(frag('<p class="errbox">Paste a data: URL to parse.</p>')); return; }
          try { parsed = C.parseDataUrl(src); }
          catch (err) { box.append(frag(`<p class="errbox">${esc(err.message)}</p>`)); if (err.offset >= 0) { const ta = el.querySelector('#dtParse'); ta.focus(); ta.setSelectionRange(err.offset, err.offset + 1); } return; }
          const det = C.detectType(parsed.bytes, '');
          const params = Object.entries(parsed.params).map(([k2, v]) => `${k2}=${v}`).join('; ') || 'none';
          kv.innerHTML = `<dt>MIME type</dt><dd>${esc(parsed.mime)}</dd><dt>Parameters</dt><dd>${esc(params)}</dd><dt>Encoding</dt><dd>${parsed.base64 ? 'Base64' : 'Percent-encoded'}</dd><dt>Bytes</dt><dd>${esc(fmt(parsed.bytes.length))}</dd><dt>Detected</dt><dd>${esc(det.label)}</dd><dt>SHA-256</dt><dd class="dt-mono">${C.sha256Hex(parsed.bytes)}</dd>`;
          el.querySelector('[data-a=save-parsed]').hidden = false;
          hist.push({ kind: 'Parse data: URL', name: parsed.mime, size: parsed.bytes.length, sha256: C.sha256Hex(parsed.bytes), options: parsed.base64 ? 'base64' : 'percent' });
          U.preview(pv, new Blob([parsed.bytes]), det, /charset=utf-?16le/i.test(params) ? 'utf-16le' : undefined);
        }
        if (k === 'save-parsed' && parsed) { const ext = C.extForMime(parsed.mime) !== 'bin' ? C.extForMime(parsed.mime) : C.detectType(parsed.bytes, '').ext; U.download(parsed.bytes, 'data.' + ext, parsed.mime); }
      });
      return { el };
    }

    // ------------------------------------------------------------ Same folder (main-process bridge)
    function folderPane() {
      const bridge = window.mvlBase64;
      const el = frag(`<section class="dt-section" aria-label="Same folder">
<p class="small">Encode writes <code>name.ext.base64.txt</code> next to the source. Decode writes the original back next to the Base64 file with its name and extension restored. Neither ever overwrites: a clash gets a numbered name such as <code>report (1).pdf</code>. Every written file is verified by a SHA-256 round trip, using the options above.</p>
<div class="dt-two" data-targets></div>
<ul class="dt-list" aria-label="Same-folder results"></ul></section>`);
      const list = el.querySelector('.dt-list');
      if (!bridge) {
        el.querySelector('[data-targets]').replaceWith(frag('<p class="note">Unavailable in this window: writing beside the source needs the desktop file bridge, which is not connected here. Use Files instead; it saves the same names through a download.</p>'));
        return { el };
      }
      const progress = new Map();
      if (bridge.onProgress) bridge.onProgress((d) => { const f = progress.get(d.jobId); if (f) f(d); });
      function run(direction, p) {
        const jobId = U.id('j').replace(/[^A-Za-z0-9_-]/g, '');
        const li = frag(`<li class="dt-item"><div class="dt-item-head"><strong class="dt-name"></strong><span class="small" data-st>Starting</span></div><div class="bar"><i></i></div><div class="row dt-item-acts"></div></li>`);
        li.querySelector('.dt-name').textContent = (direction === 'encode' ? 'Encode: ' : 'Decode: ') + p;
        list.prepend(li);
        const st = li.querySelector('[data-st]'), acts = li.querySelector('.dt-item-acts');
        let paused = false;
        const pauseB = frag('<button type="button" class="btn sm">Pause</button>'), cancelB = frag('<button type="button" class="btn sm light">Cancel</button>');
        pauseB.addEventListener('click', () => { paused = !paused; bridge.control(jobId, paused ? 'pause' : 'resume'); pauseB.textContent = paused ? 'Resume' : 'Pause'; st.textContent = paused ? 'Paused' : 'Running'; });
        cancelB.addEventListener('click', () => bridge.control(jobId, 'cancel'));
        acts.append(pauseB, cancelB);
        progress.set(jobId, (d) => { U.bar(li.querySelector('.bar'), d.total ? d.done / d.total : 1); if (!paused) st.textContent = `${d.phase === 'verify' ? 'Verifying' : d.phase === 'encode' ? 'Encoding' : 'Decoding'} ${d.total ? Math.round(d.done / d.total * 100) : 100}%`; });
        const fn = direction === 'encode' ? bridge.encodeBeside : bridge.decodeBeside;
        return fn(jobId, p, Object.assign(encOpts(), decOpts())).then((r) => {
          progress.delete(jobId); acts.innerHTML = '';
          if (r && r.ok) {
            U.bar(li.querySelector('.bar'), 1);
            st.textContent = `Wrote ${r.name} · ${fmt(r.bytesOut)} · verified SHA-256 ${r.sha256.slice(0, 12)}${r.nameSource ? ' · name from ' + r.nameSource : ''}`;
            const show = frag('<button type="button" class="btn sm">Show in folder</button>'); show.addEventListener('click', () => bridge.showInFolder(r.path)); acts.append(show);
            const path = frag('<p class="small dt-mono"></p>'); path.textContent = r.path; li.append(path);
            hist.push({ kind: direction === 'encode' ? 'Encode beside source' : 'Decode beside source', name: p.split(/[\\/]/).pop(), size: r.bytesIn, outName: r.name, outSize: r.bytesOut, sha256: r.sha256, options: optSummary() });
            ctx.toast(`Wrote ${r.name} next to the source.`, 'ok');
          } else {
            U.bar(li.querySelector('.bar'), 0);
            st.textContent = r && r.cancelled ? 'Cancelled. Nothing was written.' : `Failed: ${(r && r.message) || 'unknown error'}. Nothing was written.`;
          }
        });
      }
      const handle = (direction) => async (files, ev) => {
        const paths = ev ? files.map((f) => bridge.pathFor(f)).filter(Boolean) : files;
        if (!paths.length) { ctx.toast('Those items have no file path (for example, text dragged from a page). Drop files from a folder.', 'error'); return; }
        for (const p of paths) await run(direction, p);
      };
      const targets = el.querySelector('[data-targets]');
      const enc = U.dropZone('Encode beside the source', 'Drop or choose files: writes name.ext.base64.txt next to each.', handle('encode'), { onPick: async () => { const p = await bridge.pick('encode'); if (p && p.length) handle('encode')(p, null); } });
      const dec = U.dropZone('Decode beside the source', 'Drop or choose .base64.txt, .b64 or .txt files: restores the original next to each.', handle('decode'), { onPick: async () => { const p = await bridge.pick('decode'); if (p && p.length) handle('decode')(p, null); } });
      targets.append(enc, dec);
      return { el };
    }

    // ------------------------------------------------------------ History
    function historyPane() {
      const el = frag(`<section class="dt-section" aria-label="History">
<div class="row"><button type="button" class="btn sm" data-a="undo">Undo</button><button type="button" class="btn sm" data-a="redo">Redo</button><span class="grow"></span><button type="button" class="btn sm danger" data-a="clear">Clear history</button></div>
<label class="switch-row dt-switch"><span>Keep text payloads in history (so undo works after a restart)</span><input type="checkbox" role="switch" data-a="keep"></label>
<div data-search></div><p class="small" data-hs aria-live="polite"></p><ol class="dt-list dt-hist" aria-label="Conversions, newest first"></ol></section>`);
      const search = window.MVL && window.MVL.makeSearch ? window.MVL.makeSearch({ placeholder: 'Search history', label: 'Search history', onChange: render }) : null;
      if (search) el.querySelector('[data-search]').append(search.el);
      const keep = el.querySelector('[data-a=keep]'); keep.checked = hist.keepPayloads;
      keep.addEventListener('change', () => hist.setKeepPayloads(keep.checked));
      function render() {
        const ol = el.querySelector('.dt-hist'); ol.innerHTML = '';
        el.querySelector('[data-a=undo]').disabled = !hist.canUndo(); el.querySelector('[data-a=redo]').disabled = !hist.canRedo();
        const all = hist.entries.map((e, i) => ({ e, i })).reverse();
        const shown = all.filter(({ e }) => !search || !search.active() || search.test([e.kind, e.name, e.outName, e.sha256, e.options].join(' ')));
        el.querySelector('[data-hs]').textContent = hist.entries.length ? `${shown.length} of ${hist.entries.length} entries${hist.pos < hist.entries.length ? `; ${hist.entries.length - hist.pos} undone (redo brings them back)` : ''}.` : 'No conversions yet. Every conversion you make appears here.';
        for (const { e, i } of shown) {
          const li = frag(`<li class="dt-hrow${i >= hist.pos ? ' undone' : ''}"><strong></strong><span class="small"></span></li>`);
          li.querySelector('strong').textContent = `${e.kind}${i >= hist.pos ? ' (undone)' : ''}`;
          li.querySelector('span').textContent = [new Date(e.at).toLocaleString(), e.name && `${e.name}${e.size != null ? ' ' + fmt(e.size) : ''}`, e.outName && `to ${e.outName}${e.outSize != null ? ' ' + fmt(e.outSize) : ''}`, e.sha256 && 'SHA-256 ' + e.sha256.slice(0, 16), e.options].filter(Boolean).join(' · ');
          ol.append(li);
        }
      }
      el.addEventListener('click', async (ev) => {
        const a = ev.target.closest('button[data-a]'); if (!a) return;
        if (a.dataset.a === 'undo') undo(); if (a.dataset.a === 'redo') redo();
        if (a.dataset.a === 'clear') {
          if (!hist.entries.length) return ctx.toast('History is already empty.', 'info');
          const ok = await ctx.confirm({ action: 'Clear the Base64 history', affected: `${hist.entries.length} history entries and their undo steps are removed from this device. Files you saved are not touched.`, anchor: a });
          if (ok) { hist.clear(); ctx.toast('History cleared.', 'ok'); }
        }
      });
      cleanups.push(hist.on(render));
      render();
      return { el, shown: render };
    }

    function applyEntry(e, dir) {
      const p = hist.payload(e);
      if (e.kind === 'Encode text' || e.kind === 'Decode text') {
        if (!panes.text) { panes.text = textPane(); pane.append(panes.text.el); panes.text.el.hidden = o.pane !== 'text'; }
        if (p) panes.text.set(dir === 'undo' ? p.before : p.after);
        else ctx.toast('This entry kept only names, sizes and hashes, so the text cannot be restored. Turn on Keep text payloads to change that.', 'info');
      } else if (e.ref && panes.files) {
        if (!panes.files.hide(e.ref, dir === 'undo')) ctx.toast('That file result is no longer in this window; the history entry moved anyway.', 'info');
      } else if (/beside source/.test(e.kind)) ctx.toast('Undo never deletes a written file. It stays next to its source.', 'info');
    }
    function undo() { const e = hist.undo(); if (!e) return ctx.toast('Nothing to undo.', 'info'); applyEntry(e, 'undo'); ctx.toast(`Undid: ${e.kind}.`, 'ok'); }
    function redo() { const e = hist.redo(); if (!e) return ctx.toast('Nothing to redo.', 'info'); applyEntry(e, 'redo'); ctx.toast(`Redid: ${e.kind}.`, 'ok'); }
    const key = (e) => {
      if (!root.isConnected || !(e.ctrlKey || e.metaKey) || e.altKey) return;
      const t = e.target; if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return; // native text undo wins inside fields
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (e.key === 'y' || (e.key === 'Z' && e.shiftKey)) { e.preventDefault(); redo(); }
    };
    root.addEventListener('keydown', key);

    const BUILD = { text: textPane, files: filesPane, dataurl: dataUrlPane, folder: folderPane, history: historyPane };
    show(PANES.some(([k]) => k === o.pane) ? o.pane : 'text');
    mount.cleanup = () => { cleanups.forEach((f) => f()); if (panes.files) panes.files.items.forEach((i) => i.ctl.cancel()); };
  }

  const TITLES = { empty: 'Nothing to convert', 'invalid-char': 'Invalid character', 'padding-missing': 'Wrong padding', 'padding-unexpected': 'Wrong padding', 'padding-misplaced': 'Wrong padding', truncated: 'Incomplete Base64', 'trailing-bits': 'Not canonical Base64', unencodable: 'Unsupported character for this encoding', 'unsupported-encoding': 'Unsupported encoding', 'invalid-text': 'Not text in this encoding', 'too-large': 'Too large for the text box', 'not-data-url': 'Not a data: URL' };

  window.MVLTools.register({ id: 'base64-tools', title: 'Base64 toolkit', group: 'Data tools', summary: 'Encode and decode text, files and data: URLs on this device', mount, unmount: () => { if (mount.cleanup) mount.cleanup(); } });
})();
