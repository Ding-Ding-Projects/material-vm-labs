'use strict';
// Type generator and JSON editor (Developer tools). Both run on this device with no network.
// The type generator parses one or many JSON samples, infers one merged shape and writes types for
// nine targets; it runs in a worker when the page can start one and otherwise on the interface
// thread, and says which. The JSON editor keeps one document model behind Tree, Code, Split and
// Table views, with labelled undo and redo, regex find, a JSONPath query bar, shape validation and
// a hand-off to the type generator.
(function () {
  if (!window.MVLTools || !window.MVLTypegen) return;
  const T = window.MVLTypegen;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const BASE = (document.currentScript && document.currentScript.src || '').replace(/[^/]*$/, '');
  const store = {
    get(k) { try { return localStorage.getItem('mvl.devtools.' + k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem('mvl.devtools.' + k, v); } catch { /* storage may be unavailable; the value lasts for this page */ } }
  };
  let handoff = null; // samples sent from the JSON editor to the type generator

  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type: type || 'text/plain' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  async function copyText(text) {
    if (window.mvl && typeof window.mvl.copy === 'function') { await window.mvl.copy(text); return; }
    await navigator.clipboard.writeText(text);
  }
  const readFile = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error || new Error('The file could not be read')); r.readAsText(f); });
  function sayer(el, ctx) {
    const live = el.querySelector('[data-dt-say]');
    return (msg, kind) => { if (live) live.textContent = msg; if (ctx && ctx.toast) ctx.toast(msg, kind || 'info'); };
  }

  // ---------------------------------------------------------------------------------------------
  // Syntax colouring for the generated output (escaped first, then wrapped in spans).
  // ---------------------------------------------------------------------------------------------
  const KW = {
    typescript: 'export interface type readonly string number boolean null unknown',
    csharp: 'using namespace public class sealed record enum get set init long double bool string List Dictionary',
    python: 'from import class def return for in if else is not None True False',
    go: 'package import type struct const string bool int64 float64 map any',
    rust: 'use pub struct enum String Vec Option bool i64 f64',
    java: 'package import public class record enum private final String long double boolean Long Double Boolean List Map Object return this',
    kotlin: 'package import data class enum val var String Long Double Boolean List Map null',
    swift: 'import struct enum case let var init func throws throw try self switch if return String Int Double Bool',
    jsonschema: 'true false null'
  };
  function highlight(code, lang) {
    const kw = new Set((KW[lang] || '').split(' '));
    const comment = lang === 'python' ? /#[^\n]*/y : /\/\/[^\n]*/y;
    let out = '', i = 0;
    const tok = (cls, s) => `<span class="tk-${cls}">${esc(s)}</span>`;
    while (i < code.length) {
      comment.lastIndex = i;
      let m = comment.exec(code);
      if (m) { out += tok('c', m[0]); i += m[0].length; continue; }
      const c = code[i];
      if (c === '"' || c === '`') {
        let j = i + 1; while (j < code.length && code[j] !== c && code[j] !== '\n') { if (code[j] === '\\') j++; j++; }
        out += tok('s', code.slice(i, j + 1)); i = j + 1; continue;
      }
      const w = /[A-Za-z_][A-Za-z0-9_]*|\d+(\.\d+)?/y; w.lastIndex = i; m = w.exec(code);
      if (m) { const s = m[0]; out += /^\d/.test(s) ? tok('n', s) : kw.has(s) ? tok('k', s) : /^[A-Z]/.test(s) ? tok('t', s) : esc(s); i += s.length; continue; }
      out += esc(c); i++;
    }
    return out.split('\n').map((l) => `<span class="ln">${l || ' '}</span>`).join('\n');
  }

  // ---------------------------------------------------------------------------------------------
  // Engine runner: a worker when the page can start one, otherwise the interface thread.
  // ---------------------------------------------------------------------------------------------
  function makeRunner() {
    let worker = null, seq = 0; const waits = new Map();
    let mode = 'interface';
    try {
      worker = new Worker(BASE + 'dev-tools-typegen-worker.js');
      worker.onmessage = (e) => { const w = waits.get(e.data.id); if (w) { waits.delete(e.data.id); if (e.data.error) w.reject(new Error(e.data.error)); else w.resolve(e.data.res); } };
      worker.onerror = (e) => { e.preventDefault && e.preventDefault(); worker = null; mode = 'interface'; for (const w of waits.values()) w.fallback(); waits.clear(); };
      mode = 'worker';
    } catch { worker = null; }
    return {
      mode: () => mode,
      run(req) {
        const local = () => new Promise((res, rej) => setTimeout(() => { try { res(T.run(req)); } catch (e) { rej(e); } }, 0));
        if (!worker) return local();
        return new Promise((resolve, reject) => { const id = ++seq; waits.set(id, { resolve, reject, fallback: () => local().then(resolve, reject) }); worker.postMessage({ id, req }); });
      },
      stop() { if (worker) worker.terminate(); worker = null; }
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Type generator.
  // ---------------------------------------------------------------------------------------------
  const SAMPLE = '{\n  "name": "proof-1",\n  "status": "running",\n  "cpus": 4,\n  "createdAt": "2026-11-20T10:00:00Z",\n  "tags": ["windows", "fresh"],\n  "owner": { "login": "you", "admin": true }\n}';
  const OPTIONS = [
    { id: 'naming', label: 'Property naming', kind: 'select', def: 'idiomatic', values: [['idiomatic', 'Idiomatic for the language'], ['keep', 'Keep JSON names'], ['camel', 'camelCase'], ['pascal', 'PascalCase'], ['snake', 'snake_case']], help: 'How property names are written. Renamed properties keep their JSON name through attributes, tags or coding keys. TypeScript always keeps JSON names; Go fields are always capitalised so they serialize. Default: idiomatic.' },
    { id: 'optionalAs', label: 'Missing properties', kind: 'select', def: 'optional', values: [['optional', 'Optional'], ['nullable', 'Required but nullable']], help: 'A property missing from some samples becomes optional, or stays required and accepts null. Default: optional.' },
    { id: 'readonly', label: 'Read-only types', kind: 'switch', def: false, help: 'readonly in TypeScript, init and sealed records in C#, frozen dataclasses, Java records, val in Kotlin and let in Swift. Go and Rust have no equivalent. Default: off.' },
    { id: 'enums', label: 'Infer enums', kind: 'switch', def: true, help: 'Text with up to 8 distinct, repeating values becomes an enum. Default: on.' },
    { id: 'formats', label: 'Detect dates, UUIDs and URLs', kind: 'switch', def: true, help: 'Text that always looks like a date, time, UUID, URL or email address is marked with that format. Default: on.' },
    { id: 'typedHints', label: 'Use typed dates, UUIDs and URLs', kind: 'switch', def: true, help: 'Where the standard serializer handles them, detected formats become DateTimeOffset, Guid, time.Time, OffsetDateTime, UUID, URL or Date; elsewhere they stay text with a comment. Default: on.' },
    { id: 'maps', label: 'Detect maps', kind: 'switch', def: true, help: 'Objects keyed by numbers or ids become a map instead of a class. Default: on.' },
    { id: 'allOptional', label: 'Make every property optional', kind: 'switch', def: false, help: 'Treat every property as possibly missing. Default: off.' }
  ];

  function mountGenerator(el, ctx) {
    const saved = (() => { try { return JSON.parse(store.get('typegen') || 'null'); } catch { return null; } })() || {};
    const st = {
      samples: handoff ? handoff.samples.slice() : (Array.isArray(saved.samples) && saved.samples.length ? saved.samples : [SAMPLE]),
      lang: saved.lang || 'typescript', topName: handoff ? handoff.name : (saved.topName || 'Root'), lenient: !!saved.lenient,
      opts: Object.assign(Object.fromEntries(OPTIONS.map((o) => [o.id, o.def])), saved.opts || {}),
      code: '', result: null
    };
    handoff = null;
    const runner = makeRunner();
    el.innerHTML = `<div class="dts">
<p class="small">Paste or drop JSON samples. One merged shape is inferred from all of them, then written as types. Everything runs on this device. <span data-dt-mode></span></p>
<p class="dts-say small" data-dt-say role="status" aria-live="polite"></p>
<div class="dts-grid">
  <section class="card dts-src" aria-label="Samples">
    <div class="row dts-bar"><h3>Samples</h3><span class="grow"></span><button type="button" class="btn sm" data-dt-add>Add sample</button><label class="btn sm light dts-file">Open files<input type="file" accept=".json,application/json,.txt" multiple data-dt-open></label></div>
    <div class="field"><label for="dtsKind">Source kind</label><select id="dtsKind" data-dt-kind><option value="json">JSON samples</option><option value="schema" disabled>JSON Schema (not built yet)</option><option value="ts" disabled>TypeScript (not built yet)</option><option value="graphql" disabled>GraphQL (not built yet)</option></select><span class="small">This version reads JSON samples only. JSON Schema, TypeScript and GraphQL input are not built yet.</span></div>
    <label class="switch-row"><span>Lenient import (comments and trailing commas)</span><input type="checkbox" role="switch" data-dt-lenient></label>
    <div class="dts-samples" data-dt-samples></div>
    <p class="small dts-drop">You can also drop .json files anywhere on this panel. Each file becomes a sample.</p>
  </section>
  <section class="card dts-opts" aria-label="Options">
    <h3>Options</h3>
    <div class="field"><label for="dtsLang">Language</label><select id="dtsLang" data-dt-lang>${T.LANGUAGES.map((l) => `<option value="${l.id}">${esc(l.label)}</option>`).join('')}</select></div>
    <div class="field"><label for="dtsTop">Top-level type name</label><input id="dtsTop" data-dt-top spellcheck="false" autocomplete="off"><span class="small">The name of the outermost type. Default: Root.</span></div>
    ${OPTIONS.map((o) => o.kind === 'select'
      ? `<div class="field"><label for="dtsO-${o.id}">${esc(o.label)}</label><select id="dtsO-${o.id}" data-dt-opt="${o.id}">${o.values.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select><span class="small">${esc(o.help)}</span></div>`
      : `<div class="dts-sw"><label class="switch-row"><span>${esc(o.label)}</span><input type="checkbox" role="switch" data-dt-opt="${o.id}"></label><span class="small">${esc(o.help)}</span></div>`).join('')}
    <button type="button" class="btn sm light" data-dt-reset>Reset options to defaults</button>
  </section>
  <section class="card dts-out" aria-label="Generated types">
    <div class="row dts-bar"><h3 data-dt-out-title>Output</h3><span class="grow"></span><button type="button" class="btn sm" data-dt-copy>Copy</button><button type="button" class="btn sm primary" data-dt-save>Download</button></div>
    <div data-dt-errors></div>
    <pre class="dts-code" data-i18n-skip data-vocab-skip tabindex="0" aria-label="Generated code" data-dt-code></pre>
    <details class="dts-insp" open><summary>Inferred types</summary><div data-dt-insp data-i18n-skip data-vocab-skip></div></details>
  </section>
</div></div>`;
    const say = sayer(el, ctx);
    const $ = (s) => el.querySelector(s);
    $('[data-dt-mode]').textContent = runner.mode() === 'worker' ? 'Generation runs in a background worker.' : 'Generation runs on the interface thread because a worker could not start here.';
    $('[data-dt-lang]').value = st.lang; $('[data-dt-top]').value = st.topName; $('[data-dt-lenient]').checked = st.lenient;
    for (const o of OPTIONS) { const c = el.querySelector(`[data-dt-opt="${o.id}"]`); if (o.kind === 'select') c.value = st.opts[o.id]; else c.checked = !!st.opts[o.id]; }

    function renderSamples() {
      const box = $('[data-dt-samples]');
      box.innerHTML = st.samples.map((s, i) => `<div class="dts-sample" data-dt-i="${i}"><div class="row"><label for="dtsS${i}"><strong>Sample ${i + 1}</strong></label><span class="grow"></span>${st.samples.length > 1 ? `<button type="button" class="btn sm go" data-dt-del="${i}" aria-label="Remove sample ${i + 1}">Remove</button>` : ''}</div><textarea id="dtsS${i}" class="dts-ta" spellcheck="false" data-dt-s="${i}" aria-describedby="dtsSE${i}">${esc(s)}</textarea><p class="small" id="dtsSE${i}" data-dt-serr="${i}"></p></div>`).join('');
    }
    let timer = 0, ticket = 0;
    function persist() { store.set('typegen', JSON.stringify({ samples: st.samples.slice(0, 20).map((s) => s.slice(0, 200000)), lang: st.lang, topName: st.topName, lenient: st.lenient, opts: st.opts })); }
    function schedule() { clearTimeout(timer); timer = setTimeout(regenerate, 200); persist(); }
    async function regenerate() {
      const my = ++ticket;
      let res;
      try {
        res = await runner.run({ samples: st.samples, lenient: st.lenient, lang: st.lang, infer: { topName: st.topName || 'Root', enums: st.opts.enums, formats: st.opts.formats, maps: st.opts.maps, allOptional: st.opts.allOptional }, gen: { naming: st.opts.naming, optionalAs: st.opts.optionalAs, readonly: st.opts.readonly, typedHints: st.opts.typedHints } });
      } catch (e) { res = { ok: false, errors: [], fatal: String(e && e.message || e) }; }
      if (my !== ticket || !el.isConnected) return;
      st.result = res;
      for (const p of el.querySelectorAll('[data-dt-serr]')) { p.textContent = ''; p.className = 'small'; }
      for (const er of res.errors || []) {
        const p = el.querySelector(`[data-dt-serr="${er.sample}"]`);
        if (p) { p.className = 'small dts-bad'; p.innerHTML = `${esc(er.message)} <button type="button" class="btn sm go" data-dt-goto="${er.sample}" data-dt-off="${er.offset}">Go to error</button>`; }
      }
      const lang = T.LANGUAGES.find((l) => l.id === st.lang);
      $('[data-dt-out-title]').textContent = 'Output: ' + lang.label;
      const errBox = $('[data-dt-errors]');
      if (!res.ok) {
        st.code = '';
        $('[data-dt-code]').innerHTML = '';
        errBox.innerHTML = `<p class="${res.empty ? 'empty-note' : 'errbox'}">${res.fatal ? 'The generator stopped: ' + esc(res.fatal) : res.empty ? 'Paste a JSON sample to generate types.' : 'No sample is valid JSON yet. Fix the errors shown under each sample.'}</p>`;
        $('[data-dt-insp]').innerHTML = '';
        return;
      }
      errBox.innerHTML = res.errors.length ? `<p class="warn">${res.errors.length} sample${res.errors.length === 1 ? ' was' : 's were'} skipped because ${res.errors.length === 1 ? 'it is' : 'they are'} not valid JSON. The types come from the other ${res.sampleCount}.</p>` : '';
      st.code = res.code;
      $('[data-dt-code]').innerHTML = highlight(res.code, st.lang);
      $('[data-dt-insp]').innerHTML = `<p class="small">Top level: ${esc(res.top)}. From ${res.sampleCount} sample${res.sampleCount === 1 ? '' : 's'}.</p>` +
        res.inspector.map((c) => `<div class="dts-type"><strong class="mono">${esc(c.name)}</strong><dl class="kv">${c.props.map((p) => `<dt class="mono">${esc(p.key)}</dt><dd>${esc(p.type)}${p.optional ? ' <span class="pill">optional</span>' : ''}</dd>`).join('') || '<dt>no properties</dt><dd></dd>'}</dl></div>`).join('') +
        (res.enums.length ? `<div class="dts-type"><strong>Enums</strong><dl class="kv">${res.enums.map((e) => `<dt class="mono">${esc(e.name)}</dt><dd class="mono">${e.values.map(esc).join(', ')}</dd>`).join('')}</dl></div>` : '');
    }

    el.addEventListener('input', (e) => {
      const s = e.target.closest('[data-dt-s]');
      if (s) { st.samples[Number(s.dataset.dtS)] = s.value; schedule(); return; }
      if (e.target.matches('[data-dt-top]')) { st.topName = e.target.value.trim(); schedule(); }
    });
    el.addEventListener('change', (e) => {
      const t = e.target;
      if (t.matches('[data-dt-lang]')) { st.lang = t.value; schedule(); }
      else if (t.matches('[data-dt-lenient]')) { st.lenient = t.checked; schedule(); }
      else if (t.matches('[data-dt-opt]')) { st.opts[t.dataset.dtOpt] = t.type === 'checkbox' ? t.checked : t.value; schedule(); }
      else if (t.matches('[data-dt-open]')) { addFiles(t.files); t.value = ''; }
    });
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.matches('[data-dt-add]')) { st.samples.push(''); renderSamples(); el.querySelector(`[data-dt-s="${st.samples.length - 1}"]`).focus(); schedule(); }
      else if (b.dataset.dtDel != null) { const i = Number(b.dataset.dtDel); const removed = st.samples.splice(i, 1)[0]; renderSamples(); schedule(); say(`Sample ${i + 1} removed. Its text was: ${removed.slice(0, 60)}${removed.length > 60 ? '...' : ''}`); }
      else if (b.dataset.dtGoto != null) { const ta = el.querySelector(`[data-dt-s="${b.dataset.dtGoto}"]`); const off = Number(b.dataset.dtOff); ta.focus(); ta.setSelectionRange(off, Math.min(ta.value.length, off + 1)); }
      else if (b.matches('[data-dt-copy]')) { if (!st.code) { say('Nothing to copy yet.'); return; } try { await copyText(st.code); say('Copied the generated code.', 'success'); } catch (err) { say('Copy failed: ' + err.message, 'error'); } }
      else if (b.matches('[data-dt-save]')) { if (!st.code) { say('Nothing to download yet.'); return; } const l = T.LANGUAGES.find((x) => x.id === st.lang); const base = st.lang === 'jsonschema' ? (st.topName || 'Root') : (T.naming.pascal(st.topName) || 'Root'); download(base + '.' + l.ext, st.code); say(`Saved ${base}.${l.ext} to your downloads.`, 'success'); }
      else if (b.matches('[data-dt-reset]')) { for (const o of OPTIONS) { st.opts[o.id] = o.def; const c = el.querySelector(`[data-dt-opt="${o.id}"]`); if (o.kind === 'select') c.value = o.def; else c.checked = o.def; } schedule(); say('Options reset to their defaults.'); }
    });
    async function addFiles(files) {
      const list = [...(files || [])]; if (!list.length) return;
      let added = 0;
      for (const f of list) {
        if (f.size > 20 * 1024 * 1024) { say(`${f.name} is larger than 20 MB and was not opened.`, 'error'); continue; }
        try { const text = await readFile(f); if (st.samples.length === 1 && !st.samples[0].trim()) st.samples[0] = text; else st.samples.push(text); added++; } catch (err) { say(`${f.name} could not be read: ${err.message}`, 'error'); }
      }
      renderSamples(); schedule(); if (added) say(`Added ${added} sample${added === 1 ? '' : 's'} from files.`, 'success');
    }
    const src = $('.dts-src');
    src.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); src.classList.add('drop'); } });
    src.addEventListener('dragleave', () => src.classList.remove('drop'));
    src.addEventListener('drop', (e) => { if (!e.dataTransfer || !e.dataTransfer.files.length) return; e.preventDefault(); e.stopPropagation(); src.classList.remove('drop'); addFiles(e.dataTransfer.files); });
    renderSamples(); regenerate();
    return () => { clearTimeout(timer); runner.stop(); };
  }

  // ---------------------------------------------------------------------------------------------
  // JSON editor.
  // ---------------------------------------------------------------------------------------------
  const KINDS = ['object', 'array', 'string', 'number', 'boolean', 'null'];
  const pkey = (p) => JSON.stringify(p);
  const samePath = (a, b) => a && b && a.length === b.length && a.every((x, i) => x === b[i]);
  const isPrefix = (a, b) => a.length <= b.length && a.every((x, i) => x === b[i]);
  function convert(node, to) {
    if (node.t === to) return node;
    const prim = node.t === 'string' ? node.v : node.t === 'number' ? node.raw || String(node.v) : node.t === 'boolean' ? String(node.v) : node.t === 'null' ? '' : '';
    switch (to) {
      case 'object': return node.t === 'array' ? { t: 'object', entries: node.items.map((v, i) => ({ k: String(i), v })) } : { t: 'object', entries: [] };
      case 'array': return node.t === 'object' ? { t: 'array', items: node.entries.map((e) => e.v) } : { t: 'array', items: node.t === 'null' ? [] : [node] };
      case 'string': return { t: 'string', v: node.t === 'object' || node.t === 'array' ? T.stringify(node, 0) : prim };
      case 'number': { const n = Number(prim); return Number.isFinite(n) && prim !== '' ? { t: 'number', v: n, raw: String(n) } : { t: 'number', v: 0, raw: '0' }; }
      case 'boolean': return { t: 'boolean', v: node.t === 'boolean' ? node.v : node.t === 'string' ? node.v === 'true' : node.t === 'number' ? node.v !== 0 : false };
      default: return { t: 'null' };
    }
  }
  const blank = (t) => convert({ t: 'null' }, t);
  function uniqueKey(obj, base) { let k = base, n = 2; while (obj.entries.some((e) => e.k === k)) k = base + ' ' + n++; return k; }
  function preview(n) {
    switch (n.t) {
      case 'object': return `{ ${n.entries.length} ${n.entries.length === 1 ? 'key' : 'keys'} }`;
      case 'array': return `[ ${n.items.length} ${n.items.length === 1 ? 'item' : 'items'} ]`;
      case 'string': return JSON.stringify(n.v.length > 120 ? n.v.slice(0, 120) + '...' : n.v);
      case 'number': return n.raw || String(n.v);
      case 'boolean': return String(n.v);
      default: return 'null';
    }
  }

  function mountEditor(el, ctx) {
    const START = '{\n  "name": "proof-1",\n  "power": "running",\n  "runners": 0,\n  "tags": ["windows", "fresh"],\n  "network": { "mode": "nat", "ip": "192.0.2.10" }\n}';
    const savedText = store.get('jsondoc');
    const first = T.parse(savedText || START, { lenient: true });
    const st = {
      doc: first.ok ? first.node : T.parse(START).node,
      sel: [], collapsed: new Set(), view: store.get('jsonview') || 'tree', lenient: store.get('jsonlenient') === 'true',
      hist: [], at: -1, hits: [], hitAt: -1, schema: null, schemaName: '', problems: [], textErr: null, dragFrom: null
    };
    el.innerHTML = `<div class="dje">
<p class="dts-say small" data-dt-say role="status" aria-live="polite"></p>
<div class="row dje-bar">
  <div class="seg sm" role="group" aria-label="View">${[['tree', 'Tree'], ['code', 'Code'], ['split', 'Split'], ['table', 'Table']].map(([v, l]) => `<button type="button" data-dt-view="${v}" aria-pressed="false">${l}</button>`).join('')}</div>
  <span class="grow"></span>
  <button type="button" class="btn sm" data-dt-undo>Undo</button><button type="button" class="btn sm" data-dt-redo>Redo</button>
  <details class="dje-hist"><summary class="btn sm light">History</summary><ol data-dt-hist data-i18n-skip data-vocab-skip></ol></details>
</div>
<div class="row dje-bar">
  <label class="btn sm light dts-file">Open file<input type="file" accept=".json,application/json,.txt" data-dt-open></label>
  <button type="button" class="btn sm light" data-dt-save>Save as file</button>
  <button type="button" class="btn sm light" data-dt-copyall>Copy JSON</button>
  <button type="button" class="btn sm light" data-dt-sort>Sort keys</button>
  <button type="button" class="btn sm light" data-dt-nonull>Remove nulls</button>
  <button type="button" class="btn sm light" data-dt-new>New document</button>
  <button type="button" class="btn sm primary" data-dt-gen-doc>Generate types</button>
</div>
<label class="switch-row"><span>Lenient import (comments and trailing commas)</span><input type="checkbox" role="switch" data-dt-lenient></label>
<div data-dt-search></div>
<div class="row dje-q"><div class="field grow"><label for="djeQ">JSONPath query</label><input id="djeQ" class="mono" data-dt-q placeholder="$..name" spellcheck="false" autocomplete="off"></div><button type="button" class="btn sm" data-dt-qrun>Find</button><button type="button" class="btn sm light" data-dt-qnext>Next hit</button></div>
<p class="small" data-dt-qstat role="status"></p>
<p class="small" data-dt-stats></p>
<div class="dje-main">
  <div class="dje-left">
    <div class="dje-tree" data-i18n-skip data-vocab-skip role="tree" aria-label="Document tree" aria-multiselectable="false" data-dt-tree></div>
    <div class="dje-table" data-dt-table data-i18n-skip data-vocab-skip hidden></div>
  </div>
  <div class="dje-code" data-dt-codepane><label for="djeText" class="small">Raw JSON</label><textarea id="djeText" class="dts-ta dje-ta" spellcheck="false" data-dt-text aria-describedby="djeTextErr"></textarea><div class="row"><button type="button" class="btn sm light" data-dt-fmt>Format</button><button type="button" class="btn sm light" data-dt-min>Minify</button></div><div id="djeTextErr" data-dt-texterr></div></div>
</div>
<section class="card dje-node" aria-label="Selected node" data-dt-node></section>
<section class="card dje-valid" aria-label="Validation">
  <h3>Validation</h3>
  <p class="small">Lock the current shape, or load a JSON Schema, and every edit is checked against it.</p>
  <div class="row"><button type="button" class="btn sm" data-dt-lock>Lock current shape</button><label class="btn sm light dts-file">Load schema<input type="file" accept=".json,application/json" data-dt-schema></label><button type="button" class="btn sm light" data-dt-unlock>Clear schema</button></div>
  <div data-dt-problems></div>
</section>
</div>`;
    const $ = (s) => el.querySelector(s);
    const say = sayer(el, ctx);
    const search = window.MVL && window.MVL.makeSearch ? window.MVL.makeSearch({ placeholder: 'Find keys and values', label: 'Find keys and values in the document', onChange: () => renderTree() }) : null;
    if (search) $('[data-dt-search]').append(search.el);
    $('[data-dt-lenient]').checked = st.lenient;

    // History: every change stores a labelled snapshot.
    function commit(label, doc, sel) {
      st.hist = st.hist.slice(0, st.at + 1);
      st.hist.push({ label, doc: T.clone(doc), sel: sel || st.sel });
      if (st.hist.length > 200) st.hist.shift();
      st.at = st.hist.length - 1;
      st.doc = T.clone(doc); if (sel) st.sel = sel;
      changed();
    }
    function jump(i) {
      if (i < 0 || i >= st.hist.length) return;
      st.at = i; st.doc = T.clone(st.hist[i].doc); st.sel = st.hist[i].sel || [];
      if (!T.getAt(st.doc, st.sel)) st.sel = [];
      changed();
    }
    function changed(fromText) {
      store.set('jsondoc', T.stringify(st.doc, 2).slice(0, 2000000));
      if (st.schema) st.problems = T.validate(st.doc, st.schema);
      if (!fromText) { $('[data-dt-text]').value = T.stringify(st.doc, 2); st.textErr = null; }
      if (st.hits.length) runQuery(true);
      render();
    }
    commit('Opened', st.doc, []);

    function setView(v) {
      st.view = v; store.set('jsonview', v);
      for (const b of el.querySelectorAll('[data-dt-view]')) b.setAttribute('aria-pressed', String(b.dataset.dtView === v));
      $('[data-dt-tree]').hidden = !(v === 'tree' || v === 'split');
      $('[data-dt-table]').hidden = v !== 'table';
      $('[data-dt-codepane]').hidden = !(v === 'code' || v === 'split');
      $('.dje-left').hidden = v === 'code';
      $('.dje-main').className = 'dje-main view-' + v;
      render();
    }

    // Visible rows of the tree, honouring collapsed nodes and the find filter.
    function rows() {
      const out = [];
      const filtering = search && search.active() && !search.invalid();
      const matches = new Set(); const keep = new Set();
      if (filtering) {
        const walk = (n, path) => {
          const last = path[path.length - 1];
          const hit = (path.length && typeof last === 'string' && search.test(last)) || (n.t !== 'object' && n.t !== 'array' && search.test(n.t === 'string' ? n.v : preview(n)));
          if (hit) { matches.add(pkey(path)); for (let i = 0; i <= path.length; i++) keep.add(pkey(path.slice(0, i))); }
          if (n.t === 'object') n.entries.forEach((e) => walk(e.v, path.concat([e.k])));
          if (n.t === 'array') n.items.forEach((it, i) => walk(it, path.concat([i])));
        };
        walk(st.doc, []);
      }
      const rec = (n, path, level) => {
        if (out.length > 3000) return;
        const k = pkey(path);
        if (filtering && !keep.has(k)) return;
        out.push({ n, path, level, match: matches.has(k) });
        const open = filtering || !st.collapsed.has(k);
        if (!open) return;
        if (n.t === 'object') n.entries.forEach((e) => rec(e.v, path.concat([e.k]), level + 1));
        if (n.t === 'array') n.items.forEach((it, i) => rec(it, path.concat([i]), level + 1));
      };
      rec(st.doc, [], 1);
      return { list: out, filtering, matchCount: matches.size };
    }
    function mark(text) {
      if (!search || !search.active()) return esc(text);
      const m = search.test(text);
      if (!m || !m[0]) return esc(text);
      return esc(text.slice(0, m.index)) + '<mark>' + esc(m[0]) + '</mark>' + esc(text.slice(m.index + m[0].length));
    }
    function renderTree() {
      const tree = $('[data-dt-tree]');
      const { list, filtering, matchCount } = rows();
      const hitSet = new Set(st.hits.map(pkey));
      const probSet = new Set(st.problems.map((p) => pkey(p.path)));
      tree.innerHTML = list.map((r) => {
        const last = r.path[r.path.length - 1];
        const label = !r.path.length ? '$' : typeof last === 'number' ? `[${last}]` : last;
        const container = r.n.t === 'object' || r.n.t === 'array';
        const open = filtering || !st.collapsed.has(pkey(r.path));
        const sel = samePath(r.path, st.sel);
        return `<div class="dje-row${sel ? ' sel' : ''}${hitSet.has(pkey(r.path)) ? ' hit' : ''}${probSet.has(pkey(r.path)) ? ' bad' : ''}" role="treeitem" aria-level="${r.level}" aria-selected="${sel}"${container ? ` aria-expanded="${open}"` : ''} tabindex="${sel ? 0 : -1}" data-dt-path='${esc(pkey(r.path))}' draggable="${r.path.length ? 'true' : 'false'}" style="--lvl:${r.level - 1}">${container ? `<button type="button" class="dje-tog" tabindex="-1" aria-hidden="true" data-dt-tog>${open ? '&#9662;' : '&#9656;'}</button>` : '<span class="dje-tog"></span>'}<span class="dje-key ${typeof last === 'number' ? 'idx' : ''}">${mark(String(label))}</span><span class="dje-colon">:</span><span class="dje-val t-${r.n.t}">${container ? esc(preview(r.n)) : mark(preview(r.n))}</span><span class="dje-type">${r.n.t}</span></div>`;
      }).join('') + (list.length > 3000 ? '<p class="small">The first 3000 rows are shown. Collapse nodes or use find to see the rest.</p>' : '') + (filtering && !matchCount ? '<p class="empty-note">Nothing matches the find text.</p>' : '');
      if (search) search.setStatus(filtering ? `${matchCount} match${matchCount === 1 ? '' : 'es'}` : '');
    }
    function renderTable() {
      const box = $('[data-dt-table]');
      let path = st.sel.slice(), n = T.getAt(st.doc, path);
      while (n && n.t !== 'array' && path.length) { path = path.slice(0, -1); n = T.getAt(st.doc, path); }
      if (!n || n.t !== 'array' || !n.items.length) { box.innerHTML = '<p class="empty-note">Select an array (or anything inside one) to see it as a table. Arrays of objects get one column per key.</p>'; return; }
      const cols = []; for (const it of n.items) if (it.t === 'object') for (const e of it.entries) if (!cols.includes(e.k)) cols.push(e.k);
      const objs = cols.length > 0;
      box.innerHTML = `<p class="small">Table of <span class="mono">${esc(T.pathToJsonPath(path))}</span>, ${n.items.length} rows. Select a cell to edit it below.</p><div class="dje-tablewrap"><table class="mvlc-tbl"><thead><tr><th scope="col">#</th>${objs ? cols.map((c) => `<th scope="col">${esc(c)}</th>`).join('') : '<th scope="col">value</th>'}</tr></thead><tbody>${n.items.slice(0, 500).map((it, i) => `<tr><th scope="row">${i}</th>${objs ? cols.map((c) => { const e = it.t === 'object' && it.entries.find((x) => x.k === c); return `<td>${e ? `<button type="button" class="dje-cell" data-dt-cell='${esc(pkey(path.concat([i, c])))}'>${esc(preview(e.v))}</button>` : ''}</td>`; }).join('') : `<td><button type="button" class="dje-cell" data-dt-cell='${esc(pkey(path.concat([i])))}'>${esc(preview(it))}</button></td>`}</tr>`).join('')}</tbody></table></div>`;
    }
    function renderNode() {
      const box = $('[data-dt-node]');
      const n = T.getAt(st.doc, st.sel) || st.doc;
      const parentPath = st.sel.slice(0, -1), parent = st.sel.length ? T.getAt(st.doc, parentPath) : null;
      const last = st.sel[st.sel.length - 1];
      const container = n.t === 'object' || n.t === 'array';
      const valueField = n.t === 'string' ? `<div class="field"><label for="djeVal">Value</label><textarea id="djeVal" class="dts-ta dje-val-ta" data-dt-val spellcheck="false">${esc(n.v)}</textarea></div>`
        : n.t === 'number' ? `<div class="field"><label for="djeVal">Value</label><input id="djeVal" class="mono" data-dt-val inputmode="decimal" value="${esc(n.raw || String(n.v))}"></div>`
          : n.t === 'boolean' ? `<div class="field"><label for="djeVal">Value</label><select id="djeVal" data-dt-val><option value="true"${n.v ? ' selected' : ''}>true</option><option value="false"${n.v ? '' : ' selected'}>false</option></select></div>` : '';
      box.innerHTML = `<h3>Selected: <span class="mono" data-i18n-skip data-vocab-skip>${esc(T.pathToJsonPath(st.sel))}</span></h3>
<div class="row"><button type="button" class="btn sm light" data-dt-cpath>Copy JSONPath</button><button type="button" class="btn sm light" data-dt-cptr>Copy JSON Pointer</button></div>
<div class="dje-fields">
${parent && parent.t === 'object' ? `<div class="field"><label for="djeKey">Key (F2)</label><input id="djeKey" class="mono" data-dt-key value="${esc(last)}" spellcheck="false" autocomplete="off"></div>` : ''}
<div class="field"><label for="djeType">Type</label><select id="djeType" data-dt-type>${KINDS.map((k) => `<option value="${k}"${k === n.t ? ' selected' : ''}>${k}</option>`).join('')}</select></div>
${valueField}
</div>
<p class="small dts-bad" data-dt-valerr role="alert"></p>
<div class="row dje-actions">
${container ? `<button type="button" class="btn sm" data-dt-addchild>Add child (Insert)</button>` : ''}
${st.sel.length ? `<button type="button" class="btn sm" data-dt-addsib>Add sibling</button><button type="button" class="btn sm" data-dt-dup>Duplicate (Ctrl+D)</button><button type="button" class="btn sm" data-dt-up>Move up (Alt+Up)</button><button type="button" class="btn sm" data-dt-down>Move down (Alt+Down)</button><button type="button" class="btn sm danger" data-dt-delete>Delete</button>` : ''}
<button type="button" class="btn sm primary" data-dt-gen-node>Generate types from this node</button>
</div>`;
    }
    function renderMeta() {
      const s = T.stats(st.doc);
      const pl = (n, one, many) => `${n} ${n === 1 ? one : many}`;
      $('[data-dt-stats]').textContent = `${pl(s.nodes, 'node', 'nodes')}: ${pl(s.object, 'object', 'objects')}, ${pl(s.array, 'array', 'arrays')}, ${s.string} text, ${pl(s.number, 'number', 'numbers')}, ${pl(s.boolean, 'boolean', 'booleans')}, ${pl(s.null, 'null', 'nulls')}. ${pl(s.keys, 'key', 'keys')}, depth ${s.depth}. ${pl(T.stringify(st.doc, 0).length, 'character', 'characters')} minified.`;
      $('[data-dt-undo]').disabled = st.at <= 0; $('[data-dt-redo]').disabled = st.at >= st.hist.length - 1;
      $('[data-dt-undo]').textContent = st.at > 0 ? `Undo ${st.hist[st.at].label}` : 'Undo';
      $('[data-dt-redo]').textContent = st.at < st.hist.length - 1 ? `Redo ${st.hist[st.at + 1].label}` : 'Redo';
      $('[data-dt-hist]').innerHTML = st.hist.map((h, i) => `<li><button type="button" class="dje-hbtn" data-dt-jump="${i}" aria-current="${i === st.at ? 'step' : 'false'}">${esc(h.label)}</button></li>`).join('');
      const pb = $('[data-dt-problems]');
      if (!st.schema) pb.innerHTML = '<p class="small">No schema is loaded.</p>';
      else if (!st.problems.length) pb.innerHTML = `<p class="small dje-ok">The document matches ${esc(st.schemaName)}.</p>`;
      else pb.innerHTML = `<p class="small dts-bad">${st.problems.length} problem${st.problems.length === 1 ? '' : 's'} against ${esc(st.schemaName)}:</p><ul class="dje-probs" data-i18n-skip data-vocab-skip>${st.problems.slice(0, 100).map((p) => `<li><button type="button" class="btn sm go" data-dt-goto='${esc(pkey(p.path))}'>${esc(T.pathToJsonPath(p.path))}</button> ${esc(p.message)}</li>`).join('')}</ul>`;
      const te = $('[data-dt-texterr]');
      te.innerHTML = st.textErr ? `<p class="errbox">${esc(st.textErr.message)}. The tree shows the last valid document. <button type="button" class="btn sm go" data-dt-texgo>Go to error</button></p>` : '';
    }
    function render() {
      if (!T.getAt(st.doc, st.sel)) st.sel = [];
      if (st.view === 'tree' || st.view === 'split') renderTree();
      if (st.view === 'table') renderTable();
      renderNode(); renderMeta();
    }
    function focusSel() { const r = el.querySelector('.dje-row.sel'); if (r) r.focus(); }
    function select(path, focus) { st.sel = path; for (let i = 0; i < path.length; i++) st.collapsed.delete(pkey(path.slice(0, i))); render(); if (focus) focusSel(); }

    // Editing operations. Each works on a copy and commits a labelled snapshot.
    const work = () => T.clone(st.doc);
    const nameOf = (path) => (path.length ? String(path[path.length - 1]) : 'document');
    function removeAt(doc, path) {
      const parent = T.getAt(doc, path.slice(0, -1)), k = path[path.length - 1];
      if (parent.t === 'object') { const i = parent.entries.findIndex((e) => e.k === k); return { index: i, entry: parent.entries.splice(i, 1)[0] }; }
      return { index: k, entry: { k: null, v: parent.items.splice(k, 1)[0] } };
    }
    function insertInto(doc, parentPath, index, key, v) {
      const parent = T.getAt(doc, parentPath);
      if (parent.t === 'object') { const k = uniqueKey(parent, key == null || key === '' ? 'item' : String(key)); parent.entries.splice(index, 0, { k, v }); return parentPath.concat([k]); }
      parent.items.splice(index, 0, v); return parentPath.concat([index]);
    }
    function findPath(n, ref, path) {
      path = path || [];
      if (n === ref) return path;
      if (n.t === 'object') for (const e of n.entries) { const r = findPath(e.v, ref, path.concat([e.k])); if (r) return r; }
      if (n.t === 'array') for (let i = 0; i < n.items.length; i++) { const r = findPath(n.items[i], ref, path.concat([i])); if (r) return r; }
      return null;
    }
    const indexIn = (parent, k) => (parent.t === 'object' ? parent.entries.findIndex((e) => e.k === k) : k);
    const ops = {
      addChild() {
        const n = T.getAt(st.doc, st.sel);
        if (!n || (n.t !== 'object' && n.t !== 'array')) return ops.addSibling();
        const d = work(); const p = insertInto(d, st.sel, n.t === 'object' ? n.entries.length : n.items.length, 'new key', { t: 'string', v: '' });
        st.collapsed.delete(pkey(st.sel)); commit(`Add child to ${nameOf(st.sel)}`, d, p);
      },
      addSibling() {
        if (!st.sel.length) return ops.addChild();
        const d = work(); const pp = st.sel.slice(0, -1); const parent = T.getAt(d, pp);
        const p = insertInto(d, pp, indexIn(parent, st.sel[st.sel.length - 1]) + 1, 'new key', { t: 'string', v: '' });
        commit(`Add sibling after ${nameOf(st.sel)}`, d, p);
      },
      duplicate() {
        if (!st.sel.length) return;
        const d = work(); const pp = st.sel.slice(0, -1); const parent = T.getAt(d, pp); const k = st.sel[st.sel.length - 1];
        const p = insertInto(d, pp, indexIn(parent, k) + 1, parent.t === 'object' ? k + ' copy' : null, T.clone(T.getAt(d, st.sel)));
        commit(`Duplicate ${nameOf(st.sel)}`, d, p);
      },
      move(delta) {
        if (!st.sel.length) return;
        const d = work(); const pp = st.sel.slice(0, -1); const parent = T.getAt(d, pp); const k = st.sel[st.sel.length - 1];
        const list = parent.t === 'object' ? parent.entries : parent.items; const i = indexIn(parent, k), j = i + delta;
        if (j < 0 || j >= list.length) { say(delta < 0 ? 'Already first.' : 'Already last.'); return; }
        const [x] = list.splice(i, 1); list.splice(j, 0, x);
        commit(`Move ${nameOf(st.sel)} ${delta < 0 ? 'up' : 'down'}`, d, parent.t === 'object' ? st.sel : pp.concat([j]));
      },
      remove() {
        if (!st.sel.length) { say('The document root cannot be deleted. Use New document instead.'); return; }
        const d = work(); const pp = st.sel.slice(0, -1); const parent = T.getAt(d, pp); const i = indexIn(parent, st.sel[st.sel.length - 1]);
        const label = nameOf(st.sel);
        removeAt(d, st.sel);
        const list = parent.t === 'object' ? parent.entries : parent.items;
        const next = list.length ? pp.concat([parent.t === 'object' ? list[Math.min(i, list.length - 1)].k : Math.min(i, list.length - 1)]) : pp;
        commit(`Delete ${label}`, d, next); say(`Deleted ${label}. Undo brings it back.`); focusSel();
      },
      rename(k) {
        const last = st.sel[st.sel.length - 1]; if (k === last) return;
        const d = work(); const parent = T.getAt(d, st.sel.slice(0, -1));
        if (parent.entries.some((e) => e.k === k)) { $('[data-dt-valerr]').textContent = `This object already has a key named "${k}".`; return; }
        parent.entries.find((e) => e.k === last).k = k;
        commit(`Rename ${last} to ${k}`, d, st.sel.slice(0, -1).concat([k]));
      },
      setType(t) {
        const d = work(); const n = T.getAt(st.doc, st.sel); const nv = convert(n, t);
        if (!st.sel.length) { commit(`Change document to ${t}`, nv, []); return; }
        const parent = T.getAt(d, st.sel.slice(0, -1)); const k = st.sel[st.sel.length - 1];
        if (parent.t === 'object') parent.entries.find((e) => e.k === k).v = nv; else parent.items[k] = nv;
        commit(`Change ${nameOf(st.sel)} to ${t}`, d, st.sel);
      },
      setValue(raw) {
        const n = T.getAt(st.doc, st.sel); let nv;
        if (n.t === 'string') nv = { t: 'string', v: raw };
        else if (n.t === 'number') { if (!/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(raw.trim())) { $('[data-dt-valerr]').textContent = 'Not a JSON number. Use digits, an optional minus, decimal point and exponent.'; return; } nv = { t: 'number', v: Number(raw), raw: raw.trim() }; }
        else if (n.t === 'boolean') nv = { t: 'boolean', v: raw === 'true' };
        else return;
        if (JSON.stringify(nv) === JSON.stringify(n)) return;
        if (!st.sel.length) { commit('Edit value', nv, []); return; }
        const d = work(); const parent = T.getAt(d, st.sel.slice(0, -1)); const k = st.sel[st.sel.length - 1];
        if (parent.t === 'object') parent.entries.find((e) => e.k === k).v = nv; else parent.items[k] = nv;
        commit(`Edit ${nameOf(st.sel)}`, d, st.sel);
      },
      dropMove(from, to) {
        if (!from.length || isPrefix(from, to)) { say('A node cannot move inside itself.'); return; }
        const d = work(); const target = T.getAt(d, to);
        const into = target.t === 'object' || target.t === 'array';
        const destRef = into ? target : T.getAt(d, to.slice(0, -1));
        const fromKey = from[from.length - 1];
        const { entry } = removeAt(d, from);
        // Paths can shift when an earlier array item moves, so find the destination by identity.
        const destPath = findPath(d, destRef);
        const list = destRef.t === 'object' ? destRef.entries : destRef.items;
        const index = into ? list.length : (destRef.t === 'object' ? destRef.entries.findIndex((e) => e.v === target) : destRef.items.indexOf(target));
        const p = insertInto(d, destPath, Math.max(0, index), entry.k != null ? entry.k : 'item', entry.v);
        commit(`Move ${String(fromKey)}`, d, p);
      }
    };

    function runQuery(quiet) {
      const q = $('[data-dt-q]').value.trim(); const stat = $('[data-dt-qstat]');
      if (!q) { st.hits = []; stat.textContent = ''; if (!quiet) render(); return; }
      try { st.hits = T.queryJsonPath(st.doc, q); }
      catch (e) { st.hits = []; stat.textContent = 'Query problem: ' + e.message; if (!quiet) render(); return; }
      stat.textContent = st.hits.length ? `${st.hits.length} hit${st.hits.length === 1 ? '' : 's'}.` : 'No hits.';
      if (!quiet) { st.hitAt = st.hits.length ? 0 : -1; if (st.hits.length) select(st.hits[0], false); else render(); }
    }

    // Raw text view: parsed as you type; the tree keeps the last valid document until it parses.
    let textTimer = 0;
    $('[data-dt-text]').addEventListener('input', () => {
      clearTimeout(textTimer);
      textTimer = setTimeout(() => {
        const r = T.parse($('[data-dt-text]').value, { lenient: st.lenient });
        if (!r.ok) { st.textErr = r.error; renderMeta(); return; }
        st.textErr = null;
        if (T.stringify(r.node, 0) === T.stringify(st.doc, 0)) { renderMeta(); return; }
        // Typing in the text view merges into one history step until the view loses focus.
        const top = st.hist[st.at];
        if (top && top.label === 'Edit text' && top.open) { top.doc = T.clone(r.node); st.doc = T.clone(r.node); changed(true); }
        else { commit('Edit text', r.node, st.sel); st.hist[st.at].open = true; }
      }, 300);
    });
    $('[data-dt-text]').addEventListener('blur', () => { const top = st.hist[st.at]; if (top) top.open = false; });

    function loadText(text, label, name) {
      const r = T.parse(text, { lenient: st.lenient });
      if (!r.ok) { say(`${name || 'The text'} is not valid JSON: ${r.error.message}${st.lenient ? '' : '. Lenient import accepts comments and trailing commas.'}`, 'error'); return false; }
      st.collapsed.clear(); commit(label, r.node, []);
      if (r.notes.length) say(r.notes.map((n) => `${n.message} (line ${n.line}, column ${n.col})`).join('. '));
      return true;
    }
    async function openFile(f) {
      if (!f) return;
      if (f.size > 50 * 1024 * 1024) { say(`${f.name} is larger than 50 MB and was not opened.`, 'error'); return; }
      try { const text = await readFile(f); if (loadText(text, `Open ${f.name}`, f.name)) say(`Opened ${f.name}.`, 'success'); } catch (e) { say(`${f.name} could not be read: ${e.message}`, 'error'); }
    }
    function handToGenerator(node, name) {
      handoff = { samples: [T.stringify(node, 2)], name: T.naming.pascal(name) || 'Root' };
      window.MVLTools.open('type-generator');
    }

    el.addEventListener('click', async (e) => {
      const row = e.target.closest('.dje-row');
      if (row) { const path = JSON.parse(row.dataset.dtPath); if (e.target.closest('[data-dt-tog]')) { const k = pkey(path); if (st.collapsed.has(k)) st.collapsed.delete(k); else st.collapsed.add(k); st.sel = path; render(); focusSel(); return; } select(path, true); return; }
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.dtView) setView(b.dataset.dtView);
      else if (b.matches('[data-dt-undo]')) { jump(st.at - 1); say('Undone.'); }
      else if (b.matches('[data-dt-redo]')) { jump(st.at + 1); say('Redone.'); }
      else if (b.dataset.dtJump != null) { jump(Number(b.dataset.dtJump)); say(`Back to: ${st.hist[st.at].label}.`); }
      else if (b.matches('[data-dt-save]')) { download('document.json', T.stringify(st.doc, 2) + '\n', 'application/json'); say('Saved document.json to your downloads.', 'success'); }
      else if (b.matches('[data-dt-copyall]')) { try { await copyText(T.stringify(st.doc, 2)); say('Copied the document.', 'success'); } catch (err) { say('Copy failed: ' + err.message, 'error'); } }
      else if (b.matches('[data-dt-sort]')) { commit('Sort keys', T.sortKeys(st.doc), st.sel); say('Keys sorted. Undo restores the old order.'); }
      else if (b.matches('[data-dt-nonull]')) { const before = T.stats(st.doc).null; commit('Remove nulls', T.removeNulls(st.doc), []); say(`Removed ${before} null${before === 1 ? '' : 's'}.`); }
      else if (b.matches('[data-dt-new]')) { st.collapsed.clear(); commit('New document', { t: 'object', entries: [] }, []); say('New empty document. Undo brings the previous one back.'); }
      else if (b.matches('[data-dt-gen-doc]')) handToGenerator(st.doc, 'Root');
      else if (b.matches('[data-dt-gen-node]')) handToGenerator(T.getAt(st.doc, st.sel), st.sel.length ? T.naming.singular(String(st.sel[st.sel.length - 1])) : 'Root');
      else if (b.matches('[data-dt-qrun]')) runQuery(false);
      else if (b.matches('[data-dt-qnext]')) { if (!st.hits.length) runQuery(false); else { st.hitAt = (st.hitAt + 1) % st.hits.length; select(st.hits[st.hitAt], true); $('[data-dt-qstat]').textContent = `Hit ${st.hitAt + 1} of ${st.hits.length}.`; } }
      else if (b.matches('[data-dt-fmt]')) { $('[data-dt-text]').value = T.stringify(st.doc, 2); st.textErr = null; renderMeta(); }
      else if (b.matches('[data-dt-min]')) { $('[data-dt-text]').value = T.stringify(st.doc, 0); st.textErr = null; renderMeta(); }
      else if (b.matches('[data-dt-texgo]') && st.textErr) { const ta = $('[data-dt-text]'); ta.focus(); ta.setSelectionRange(st.textErr.offset, Math.min(ta.value.length, st.textErr.offset + 1)); }
      else if (b.matches('[data-dt-lock]')) { const ir = T.infer([st.doc], { topName: 'Locked shape', enums: false }); st.schema = JSON.parse(T.generate('jsonschema', ir, {})); st.schemaName = 'the locked shape'; st.problems = T.validate(st.doc, st.schema); render(); say('Shape locked. Edits are now checked against it.'); }
      else if (b.matches('[data-dt-unlock]')) { st.schema = null; st.problems = []; render(); say('Schema cleared.'); }
      else if (b.dataset.dtGoto) select(JSON.parse(b.dataset.dtGoto), true);
      else if (b.dataset.dtCell) { select(JSON.parse(b.dataset.dtCell), false); const v = $('[data-dt-val]'); if (v) v.focus(); }
      else if (b.matches('[data-dt-cpath]')) { try { await copyText(T.pathToJsonPath(st.sel)); say('Copied the JSONPath.', 'success'); } catch (err) { say('Copy failed: ' + err.message, 'error'); } }
      else if (b.matches('[data-dt-cptr]')) { try { await copyText(T.pathToPointer(st.sel)); say('Copied the JSON Pointer.', 'success'); } catch (err) { say('Copy failed: ' + err.message, 'error'); } }
      else if (b.matches('[data-dt-addchild]')) ops.addChild();
      else if (b.matches('[data-dt-addsib]')) ops.addSibling();
      else if (b.matches('[data-dt-dup]')) ops.duplicate();
      else if (b.matches('[data-dt-up]')) ops.move(-1);
      else if (b.matches('[data-dt-down]')) ops.move(1);
      else if (b.matches('[data-dt-delete]')) ops.remove();
    });
    el.addEventListener('change', async (e) => {
      const t = e.target;
      if (t.matches('[data-dt-type]')) ops.setType(t.value);
      else if (t.matches('[data-dt-val]')) ops.setValue(t.value);
      else if (t.matches('[data-dt-key]')) ops.rename(t.value);
      else if (t.matches('[data-dt-lenient]')) { st.lenient = t.checked; store.set('jsonlenient', String(t.checked)); }
      else if (t.matches('[data-dt-open]')) { await openFile(t.files[0]); t.value = ''; }
      else if (t.matches('[data-dt-schema]')) {
        const f = t.files[0]; t.value = ''; if (!f) return;
        try { const r = T.parse(await readFile(f), { lenient: true }); if (!r.ok) throw new Error(r.error.message); st.schema = T.toValue(r.node); st.schemaName = f.name; st.problems = T.validate(st.doc, st.schema); render(); say(`Loaded ${f.name}. Supported keywords: type, properties, required, items, additionalProperties, enum, anyOf, format and $ref into $defs.`); }
        catch (err) { say(`${f.name} is not a usable schema: ${err.message}`, 'error'); }
      }
    });
    el.addEventListener('keydown', (e) => {
      const inField = e.target.matches('input, textarea, select');
      if ((e.ctrlKey || e.metaKey) && !inField && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) { e.preventDefault(); jump(st.at - 1); return; }
      if ((e.ctrlKey || e.metaKey) && !inField && (e.key === 'y' || e.key === 'Y' || ((e.key === 'z' || e.key === 'Z') && e.shiftKey))) { e.preventDefault(); jump(st.at + 1); return; }
      if (e.target.matches('[data-dt-key]') && e.key === 'Enter') { e.preventDefault(); ops.rename(e.target.value); focusSel(); return; }
      if (e.target.matches('input[data-dt-val]') && e.key === 'Enter') { e.preventDefault(); ops.setValue(e.target.value); focusSel(); return; }
      if (e.target.matches('[data-dt-q]') && e.key === 'Enter') { e.preventDefault(); runQuery(false); return; }
      if (e.key === 'Escape' && e.target.closest('[data-dt-node]')) { e.stopPropagation(); focusSel(); return; }
      const row = e.target.closest('.dje-row'); if (!row) return;
      const list = rows().list; const i = list.findIndex((r) => samePath(r.path, st.sel)); const cur = list[i];
      const go = (j) => { if (list[j]) select(list[j].path, true); };
      const container = cur && (cur.n.t === 'object' || cur.n.t === 'array');
      let handled = true;
      if (e.altKey && e.key === 'ArrowUp') ops.move(-1);
      else if (e.altKey && e.key === 'ArrowDown') ops.move(1);
      else if (e.key === 'ArrowDown') go(i + 1);
      else if (e.key === 'ArrowUp') go(i - 1);
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(list.length - 1);
      else if (e.key === 'ArrowRight') { if (container && st.collapsed.has(pkey(st.sel))) { st.collapsed.delete(pkey(st.sel)); render(); focusSel(); } else if (container) go(i + 1); }
      else if (e.key === 'ArrowLeft') { if (container && !st.collapsed.has(pkey(st.sel)) && st.sel.length) { st.collapsed.add(pkey(st.sel)); render(); focusSel(); } else if (st.sel.length) select(st.sel.slice(0, -1), true); }
      else if (e.key === 'Enter' || e.key === 'F2') { const f = $('[data-dt-key]') || $('[data-dt-val]') || $('[data-dt-type]'); if (f) { f.focus(); if (f.select) f.select(); } }
      else if (e.key === 'Delete') ops.remove();
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) ops.duplicate();
      else if (e.key === 'Insert') ops.addChild();
      else handled = false;
      if (handled) { e.preventDefault(); if (e.altKey || e.key === 'Insert' || e.key === 'Delete' || e.ctrlKey) focusSel(); }
    });
    // Drag and drop: rows move between containers; a file dropped on the editor opens as a document.
    const tree = $('[data-dt-tree]');
    tree.addEventListener('dragstart', (e) => { const row = e.target.closest('.dje-row'); if (!row) return; st.dragFrom = JSON.parse(row.dataset.dtPath); e.dataTransfer.setData('text/plain', row.dataset.dtPath); e.dataTransfer.effectAllowed = 'move'; });
    tree.addEventListener('dragover', (e) => { if (st.dragFrom && e.target.closest('.dje-row')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } });
    tree.addEventListener('drop', (e) => { const row = e.target.closest('.dje-row'); if (st.dragFrom && row) { e.preventDefault(); e.stopPropagation(); const from = st.dragFrom; st.dragFrom = null; ops.dropMove(from, JSON.parse(row.dataset.dtPath)); } });
    tree.addEventListener('dragend', () => { st.dragFrom = null; });
    const main = $('.dje');
    main.addEventListener('dragover', (e) => { if (!st.dragFrom && e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
    main.addEventListener('drop', (e) => { if (st.dragFrom || !e.dataTransfer || !e.dataTransfer.files.length) return; e.preventDefault(); e.stopPropagation(); openFile(e.dataTransfer.files[0]); });

    setView(['tree', 'code', 'split', 'table'].includes(st.view) ? st.view : 'tree');
    return () => { clearTimeout(textTimer); };
  }

  const teardowns = {};
  function reg(id, title, summary, mount) {
    window.MVLTools.register({
      id, title, group: 'Developer tools', summary,
      mount(el, ctx) { if (teardowns[id]) teardowns[id](); teardowns[id] = mount(el, ctx); },
      unmount() { if (teardowns[id]) { teardowns[id](); teardowns[id] = null; } }
    });
  }
  reg('type-generator', 'Type generator', 'Turn JSON samples into TypeScript, C#, Python, Go, Rust, Java, Kotlin, Swift or JSON Schema', mountGenerator);
  reg('json-editor', 'JSON editor', 'Edit JSON as a tree, text or table with undo, find, JSONPath and validation', mountEditor);
})();
