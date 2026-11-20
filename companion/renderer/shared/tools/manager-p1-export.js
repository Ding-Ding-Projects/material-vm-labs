'use strict';
// Export everything, in every format that can carry it. Pure serializers plus one export sheet.
//  - Records (lists of objects): JSON, JSON Lines, YAML, TOML, XML, CSV, TSV, Markdown, HTML and plain
//    text, and a ZIP holding every one of them. Each format says before the export runs what it
//    cannot carry. Every file states its encoding (UTF-8), line endings (LF) and schema.
//  - Documents (an article): HTML, Markdown, plain text and JSON.
//  - MVLExport.open({ title, name, schema, kind: 'records'|'document', rows | doc, scope }) opens the
//    sheet; MVLExport.download(name, data, mime) saves through a Blob; MVLExport.copy(text) copies.
//  - 7z is not offered: it needs the 7-Zip program run by the main process, which is not wired up.
(function (root) {
  const ENC = 'UTF-8', EOL = 'LF';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  // ---------- shape helpers ----------
  // Nested objects become dotted keys; arrays stay whole (written as JSON text by the flat formats).
  function flatten(obj, prefix, out) {
    out = out || {};
    for (const k of Object.keys(obj || {})) {
      const v = obj[k], key = prefix ? prefix + '.' + k : k;
      if (isObj(v) && Object.keys(v).length) flatten(v, key, out); else out[key] = v;
    }
    return out;
  }
  function columns(rows) {
    const seen = new Set(), cols = [];
    for (const r of rows) for (const k of Object.keys(flatten(r))) if (!seen.has(k)) { seen.add(k); cols.push(k); }
    return cols;
  }
  const cell = (v) => (v == null ? '' : Array.isArray(v) || isObj(v) ? JSON.stringify(v) : String(v));

  function meta(spec) {
    return { schema: spec.schema || 'mvl.export/1', kind: spec.title || '', exportedUtc: spec.at || new Date().toISOString(), encoding: ENC, lineEndings: EOL, count: (spec.rows || []).length, scope: spec.scope || 'everything' };
  }
  const headerLines = (spec) => { const m = meta(spec); return [`${m.kind}: ${m.count} item${m.count === 1 ? '' : 's'}, ${m.scope}`, `Schema ${m.schema}; encoding ${m.encoding}; line endings ${m.lineEndings}; exported ${m.exportedUtc}`]; };

  // ---------- record serializers ----------
  function toJSON(spec) { return JSON.stringify({ meta: meta(spec), items: spec.rows }, null, 2) + '\n'; }
  function toJSONL(spec) { return [JSON.stringify({ _meta: meta(spec) })].concat(spec.rows.map((r) => JSON.stringify(r))).join('\n') + '\n'; }

  function yamlScalar(v) {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : JSON.stringify(String(v));
    if (typeof v === 'boolean') return String(v);
    return JSON.stringify(String(v)); // a double-quoted YAML scalar is JSON-compatible
  }
  function yamlNode(v, ind) {
    const sp = ' '.repeat(ind);
    if (Array.isArray(v)) {
      if (!v.length) return ' []';
      return '\n' + v.map((x) => {
        if (isObj(x) && Object.keys(x).length) { const inner = yamlNode(x, ind + 2).replace(/^\n/, ''); return sp + '- ' + inner.slice(ind + 2); }
        return sp + '-' + (Array.isArray(x) ? yamlNode(x, ind + 2) : ' ' + (isObj(x) ? '{}' : yamlScalar(x)));
      }).join('\n');
    }
    if (isObj(v)) {
      const ks = Object.keys(v);
      if (!ks.length) return ' {}';
      return '\n' + ks.map((k) => sp + JSON.stringify(k) + ':' + (Array.isArray(v[k]) || isObj(v[k]) ? yamlNode(v[k], ind + 2) : ' ' + yamlScalar(v[k]))).join('\n');
    }
    return ' ' + yamlScalar(v);
  }
  function toYAML(spec) {
    const m = meta(spec);
    return `# ${headerLines(spec).join('\n# ')}\n"meta":${yamlNode(m, 2)}\n"items":${yamlNode(spec.rows, 2)}\n`;
  }

  function tomlValue(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : JSON.stringify(String(v));
    if (typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) return '[' + v.filter((x) => x != null).map((x) => (isObj(x) ? JSON.stringify(JSON.stringify(x)) : tomlValue(x))).join(', ') + ']';
    return JSON.stringify(String(v));
  }
  function toTOML(spec) {
    const m = meta(spec);
    const lines = ['# ' + headerLines(spec).join('\n# '), '[meta]'];
    for (const k of Object.keys(m)) lines.push(`${JSON.stringify(k)} = ${tomlValue(m[k])}`);
    for (const r of spec.rows) {
      lines.push('', '[[items]]');
      const f = flatten(r);
      for (const k of Object.keys(f)) if (f[k] != null && !(isObj(f[k]))) lines.push(`${JSON.stringify(k)} = ${tomlValue(f[k])}`);
    }
    return lines.join('\n') + '\n';
  }

  const xmlText = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  function xmlNode(name, v, ind) {
    const sp = '  '.repeat(ind), attr = ` name="${xmlText(name)}"`;
    if (v === null || v === undefined) return `${sp}<null${attr}/>`;
    if (Array.isArray(v)) return `${sp}<list${attr}>\n${v.map((x, i) => xmlNode(String(i), x, ind + 1)).join('\n')}${v.length ? '\n' : ''}${sp}</list>`;
    if (isObj(v)) return `${sp}<map${attr}>\n${Object.keys(v).map((k) => xmlNode(k, v[k], ind + 1)).join('\n')}${Object.keys(v).length ? '\n' : ''}${sp}</map>`;
    const t = typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : 'string';
    return `${sp}<${t}${attr}>${xmlText(v)}</${t}>`;
  }
  function toXML(spec) {
    const m = meta(spec);
    return `<?xml version="1.0" encoding="UTF-8"?>\n<export schema="${xmlText(m.schema)}" kind="${xmlText(m.kind)}" exportedUtc="${xmlText(m.exportedUtc)}" encoding="${ENC}" lineEndings="${EOL}" count="${m.count}" scope="${xmlText(m.scope)}">\n${spec.rows.map((r, i) => xmlNode(String(i), r, 1)).join('\n')}\n</export>\n`;
  }

  function delimited(spec, sep) {
    const cols = spec.columns || columns(spec.rows);
    const q = (s) => (sep === ',' ? (/[",\n\r]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s) : s.replace(/\t/g, ' ').replace(/\r?\n/g, ' '));
    const out = ['# ' + headerLines(spec).join(' | '), cols.map(q).join(sep)];
    for (const r of spec.rows) { const f = flatten(r); out.push(cols.map((c) => q(cell(f[c]))).join(sep)); }
    return out.join('\n') + '\n';
  }
  const toCSV = (spec) => delimited(spec, ',');
  const toTSV = (spec) => delimited(spec, '\t');

  function toMarkdown(spec) {
    const cols = spec.columns || columns(spec.rows);
    const q = (s) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
    const lines = [`# ${spec.title || 'Export'}`, '', ...headerLines(spec).map((l) => '> ' + l), ''];
    if (!spec.rows.length) lines.push('No items.');
    else {
      lines.push('| ' + cols.map(q).join(' | ') + ' |', '| ' + cols.map(() => '---').join(' | ') + ' |');
      for (const r of spec.rows) { const f = flatten(r); lines.push('| ' + cols.map((c) => q(cell(f[c]))).join(' | ') + ' |'); }
    }
    return lines.join('\n') + '\n';
  }
  function toHTML(spec) {
    const cols = spec.columns || columns(spec.rows);
    const body = spec.rows.length ? `<table>\n<thead><tr>${cols.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead>\n<tbody>\n${spec.rows.map((r) => { const f = flatten(r); return `<tr>${cols.map((c) => `<td>${esc(cell(f[c]))}</td>`).join('')}</tr>`; }).join('\n')}\n</tbody>\n</table>` : '<p>No items.</p>';
    return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="mvl-schema" content="${esc(meta(spec).schema)}">\n<title>${esc(spec.title || 'Export')}</title>\n</head>\n<body>\n<h1>${esc(spec.title || 'Export')}</h1>\n${headerLines(spec).map((l) => `<p>${esc(l)}</p>`).join('\n')}\n${body}\n</body>\n</html>\n`;
  }
  function toText(spec) {
    const out = [spec.title || 'Export', ...headerLines(spec), ''];
    spec.rows.forEach((r, i) => {
      const f = flatten(r);
      out.push(`${i + 1}.`);
      for (const k of Object.keys(f)) out.push(`   ${k}: ${cell(f[k])}`);
      out.push('');
    });
    if (!spec.rows.length) out.push('No items.');
    return out.join('\n').replace(/\n+$/, '') + '\n';
  }

  // ---------- documents ----------
  function htmlToText(html) {
    return String(html || '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|h[1-6]|li|pre|tr|blockquote|div)>/gi, '\n').replace(/<li[^>]*>/gi, '- ').replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }
  // A small HTML to Markdown pass for the rendered articles: headings, paragraphs, lists, code, links,
  // emphasis and tables. Images become their alt text, because the bundled pictures are not exported.
  function htmlToMarkdown(html) {
    let s = String(html || '');
    const dec = (t) => t.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    s = s.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, c) => '\n```\n' + dec(c.replace(/<[^>]+>/g, '')).replace(/\n$/, '') + '\n```\n');
    s = s.replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, (_, a) => (a ? `[image: ${a}]` : '[image]'));
    s = s.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, t) => {
      const rows = [...t.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) => [...r[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => dec(c[1].replace(/<[^>]+>/g, '')).trim().replace(/\|/g, '\\|')));
      if (!rows.length) return '';
      const w = Math.max(...rows.map((r) => r.length));
      const line = (r) => '| ' + Array.from({ length: w }, (_, i) => r[i] || '').join(' | ') + ' |';
      return '\n' + [line(rows[0]), '| ' + Array(w).fill('---').join(' | ') + ' |', ...rows.slice(1).map(line)].join('\n') + '\n';
    });
    s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, t) => '\n' + '#'.repeat(+n) + ' ' + t.trim() + '\n');
    s = s.replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, h, t) => (/^#\//.test(h) ? t : `[${t}](${h})`));
    s = s.replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, '**$2**').replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, '*$2*').replace(/<code>([\s\S]*?)<\/code>/gi, '`$1`');
    s = s.replace(/<li[^>]*>/gi, '- ').replace(/<\/li>/gi, '\n').replace(/<\/?(ul|ol)[^>]*>/gi, '\n');
    s = s.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, t) => t.trim().split('\n').map((l) => '> ' + l).join('\n') + '\n');
    s = s.replace(/<br\s*\/?>/gi, '  \n').replace(/<\/p>/gi, '\n\n').replace(/<p[^>]*>/gi, '').replace(/<hr\s*\/?>/gi, '\n---\n');
    s = dec(s.replace(/<[^>]+>/g, ''));
    return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }
  function docMeta(spec) { return { schema: spec.schema || 'mvl.article/1', title: spec.doc.title, id: spec.doc.id, source: spec.doc.source || '', exportedUtc: spec.at || new Date().toISOString(), encoding: ENC, lineEndings: EOL }; }
  const DOC = {
    html: (spec) => { const m = docMeta(spec); return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="mvl-schema" content="${esc(m.schema)}">\n<meta name="mvl-source" content="${esc(m.id)} ${esc(m.source)}">\n<title>${esc(m.title)}</title>\n</head>\n<body>\n<!-- ${esc(m.title)}; ${esc(m.id)}; exported ${m.exportedUtc}; UTF-8; LF -->\n${spec.doc.html}\n</body>\n</html>\n`; },
    md: (spec) => { const m = docMeta(spec); return `<!-- ${m.title}; ${m.id}; source ${m.source}; exported ${m.exportedUtc}; UTF-8; LF; converted from the rendered page -->\n\n` + htmlToMarkdown(spec.doc.html); },
    txt: (spec) => { const m = docMeta(spec); return `${m.title}\n${m.id}; source ${m.source}; exported ${m.exportedUtc}; UTF-8; LF\n\n` + htmlToText(spec.doc.html); },
    json: (spec) => JSON.stringify({ meta: docMeta(spec), html: spec.doc.html, text: htmlToText(spec.doc.html) }, null, 2) + '\n'
  };

  const RECORD_FORMATS = [
    { id: 'json', label: 'JSON', ext: 'json', mime: 'application/json', fn: toJSON, loss: 'Nothing is lost. Re-importable.' },
    { id: 'jsonl', label: 'JSON Lines', ext: 'jsonl', mime: 'application/x-ndjson', fn: toJSONL, loss: 'Nothing is lost. The first line holds the export details; one item per line after it.' },
    { id: 'yaml', label: 'YAML', ext: 'yaml', mime: 'application/yaml', fn: toYAML, loss: 'Nothing is lost. Re-importable.' },
    { id: 'toml', label: 'TOML', ext: 'toml', mime: 'application/toml', fn: toTOML, loss: 'Empty values are left out, because TOML has no null; nested values become dotted keys.' },
    { id: 'xml', label: 'XML', ext: 'xml', mime: 'application/xml', fn: toXML, loss: 'Nothing is lost: every value keeps its name and type.' },
    { id: 'csv', label: 'CSV', ext: 'csv', mime: 'text/csv', fn: toCSV, loss: 'Nested values become dotted columns, lists become JSON text in one cell, and numbers and true or false become text. The first line is a # comment with the export details.' },
    { id: 'tsv', label: 'TSV', ext: 'tsv', mime: 'text/tab-separated-values', fn: toTSV, loss: 'As CSV, and tabs or line breaks inside a value become spaces.' },
    { id: 'md', label: 'Markdown', ext: 'md', mime: 'text/markdown', fn: toMarkdown, loss: 'A readable table; values are flattened as in CSV. Not meant for re-import.' },
    { id: 'html', label: 'HTML', ext: 'html', mime: 'text/html', fn: toHTML, loss: 'A readable table; values are flattened as in CSV. Not meant for re-import.' },
    { id: 'txt', label: 'Plain text', ext: 'txt', mime: 'text/plain', fn: toText, loss: 'Readable text only; types are not kept and it is not re-importable.' }
  ];
  const DOC_FORMATS = [
    { id: 'html', label: 'HTML', ext: 'html', mime: 'text/html', fn: DOC.html, loss: 'Nothing is lost from the rendered article. Pictures stay embedded.' },
    { id: 'md', label: 'Markdown', ext: 'md', mime: 'text/markdown', fn: DOC.md, loss: 'Converted from the rendered page: pictures become their description, and table cell formatting is dropped.' },
    { id: 'txt', label: 'Plain text', ext: 'txt', mime: 'text/plain', fn: DOC.txt, loss: 'Text only: headings, links, tables and pictures lose their formatting.' },
    { id: 'json', label: 'JSON', ext: 'json', mime: 'application/json', fn: DOC.json, loss: 'Nothing is lost: holds the rendered HTML and the plain text.' }
  ];
  const formatsFor = (kind) => (kind === 'document' ? DOC_FORMATS : RECORD_FORMATS);
  function render(spec, id) { const f = formatsFor(spec.kind).find((x) => x.id === id); if (!f) throw new Error('Unknown export format: ' + id); return f.fn(spec); }
  const safeName = (s) => String(s || 'export').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'export';

  // ---------- ZIP (stored, no compression) ----------
  let crcTable = null;
  function crc32(bytes) {
    if (!crcTable) { crcTable = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; } }
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function zip(files, when) {
    const enc = new TextEncoder();
    const d = when || new Date();
    const dosTime = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
    const dosDate = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
    const parts = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(String(f.name).replace(/\\/g, '/').split('/').filter((p) => p && p !== '.' && p !== '..').join('/')); // relative paths only
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
      h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((a, b) => a + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    const all = parts.concat(central, [new Uint8Array(end.buffer)]);
    const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
    let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
    return out;
  }
  function zipAll(spec) {
    const base = safeName(spec.name);
    const files = formatsFor(spec.kind).map((f) => ({ name: `${base}/${base}.${f.ext}`, data: f.fn(spec) }));
    files.push({ name: `${base}/README.txt`, data: `${spec.title || base}\nEvery file holds the same ${spec.kind === 'document' ? 'article' : (spec.rows || []).length + ' items'} (${spec.scope || 'everything'}) in a different format.\nEncoding UTF-8, line endings LF. Stored without compression or encryption.\n\n` + formatsFor(spec.kind).map((f) => `${base}.${f.ext}: ${f.label}. ${f.loss}`).join('\n') + '\n' });
    return zip(files);
  }

  // ---------- browser side ----------
  function download(filename, data, mime) {
    const doc = root.document;
    const blob = new Blob([data], { type: (mime || 'application/octet-stream') + (typeof data === 'string' ? ';charset=utf-8' : '') });
    const url = URL.createObjectURL(blob);
    const a = doc.createElement('a'); a.href = url; a.download = filename; a.hidden = true;
    doc.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  function copy(text) {
    const nav = root.navigator;
    if (nav && nav.clipboard && nav.clipboard.writeText) return nav.clipboard.writeText(String(text)).then(() => true, () => fallbackCopy(text));
    return Promise.resolve(fallbackCopy(text));
  }
  function fallbackCopy(text) {
    const doc = root.document, t = doc.createElement('textarea');
    t.value = String(text); t.style.position = 'fixed'; t.style.opacity = '0'; doc.body.append(t); t.select();
    let ok = false; try { ok = doc.execCommand('copy'); } catch { ok = false; }
    t.remove(); return ok;
  }
  const toast = (m, k) => root.MVL && root.MVL.toast && root.MVL.toast(m, k);
  // Sheets opened from inside a modal dialog (Tools, the notification centre) must live in that dialog,
  // or the browser's top layer paints the dialog over them.
  function host() { const open = [...root.document.querySelectorAll('dialog[open]')].filter((d) => d.matches(':modal')); return open.length ? open[open.length - 1] : root.document.body; }
  // The two-key super confirmation, moved into the open modal dialog when there is one.
  function askSuper(o) {
    if (!root.MVLSuperConfirm) return Promise.resolve(false);
    const p = root.MVLSuperConfirm.ask(o);
    const h = host();
    if (h !== root.document.body) { const sc = [...root.document.body.children].reverse().find((x) => x.classList.contains('superconfirm')); if (sc) { h.append(sc); const k = sc.querySelector('.sc-key'); if (k) k.focus(); } }
    return p;
  }

  // The export sheet: pick a format, read what it keeps and loses, preview, then save or copy.
  function open(spec) {
    const doc = root.document;
    spec = Object.assign({ kind: 'records', rows: [] }, spec);
    const fmts = formatsFor(spec.kind);
    let cur = spec.format && fmts.some((f) => f.id === spec.format) ? spec.format : fmts[0].id;
    const prev = doc.activeElement;
    const scrim = doc.createElement('div'); scrim.className = 'scrim p1-scrim';
    const count = spec.kind === 'document' ? '1 article' : `${spec.rows.length} item${spec.rows.length === 1 ? '' : 's'}`;
    scrim.innerHTML = `<div class="sheet p1-export" role="dialog" aria-modal="true" aria-labelledby="p1ExT">
<span class="eyebrow">Export</span><h2 id="p1ExT"></h2>
<p class="small p1-ex-scope"></p>
<div class="p1-formats" role="radiogroup" aria-label="Format">${fmts.map((f) => `<button type="button" role="radio" class="chipbtn p1-fmt" data-fmt="${f.id}" aria-checked="${f.id === cur}" tabindex="${f.id === cur ? 0 : -1}">${esc(f.label)}</button>`).join('')}</div>
<div class="p1-ex-facts"><p class="p1-ex-loss" role="status"></p><p class="small">Encoding UTF-8, line endings LF. Files are written by this app on this device; nothing is uploaded.</p></div>
<pre class="log p1-ex-preview" tabindex="0" aria-label="Preview of the first lines"></pre>
<p class="small">Archives: ZIP holds every format above, stored without compression or encryption. 7z is not available in this build: it needs the 7-Zip program run by the app itself, which is not wired up yet.</p>
<div class="row p1-ex-acts"><button type="button" class="btn" data-x="close">Close</button><span class="grow"></span><button type="button" class="btn" data-x="copy">Copy</button><button type="button" class="btn" data-x="zip">ZIP, every format</button><button type="button" class="btn primary" data-x="save">Save file</button></div></div>`;
    scrim.querySelector('#p1ExT').textContent = spec.title || 'Export';
    scrim.querySelector('.p1-ex-scope').textContent = `${count} · ${spec.scope || 'everything'}${spec.schema ? ' · schema ' + spec.schema : ''}`;
    const sheet = scrim.firstElementChild, loss = scrim.querySelector('.p1-ex-loss'), pre = scrim.querySelector('.p1-ex-preview');
    const fmt = () => fmts.find((f) => f.id === cur);
    let text = '';
    function draw() {
      for (const b of scrim.querySelectorAll('[data-fmt]')) { const on = b.dataset.fmt === cur; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; }
      try { text = fmt().fn(spec); loss.textContent = fmt().label + ': ' + fmt().loss; loss.className = 'p1-ex-loss'; }
      catch (e) { text = ''; loss.textContent = 'This format could not be written: ' + (e && e.message ? e.message : e); loss.className = 'p1-ex-loss errbox'; }
      pre.textContent = text.length > 2400 ? text.slice(0, 2400) + '\n[preview ends here; the file has everything]' : text;
    }
    const close = () => { scrim.remove(); if (prev && prev.isConnected && prev.focus) prev.focus(); };
    scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) close(); });
    scrim.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
      const r = e.target.closest('[data-fmt]');
      if (r && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault(); const i = fmts.findIndex((f) => f.id === cur); const d = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
        cur = fmts[(i + d + fmts.length) % fmts.length].id; draw(); scrim.querySelector(`[data-fmt="${cur}"]`).focus();
      }
      if (e.key === 'Tab') { const f = [...sheet.querySelectorAll('button:not([tabindex="-1"]), pre')].filter((x) => !x.disabled); const i = f.indexOf(doc.activeElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); } }
    });
    scrim.addEventListener('click', (e) => {
      const r = e.target.closest('[data-fmt]'); if (r) { cur = r.dataset.fmt; draw(); return; }
      const b = e.target.closest('[data-x]'); if (!b) return;
      const base = safeName(spec.name);
      if (b.dataset.x === 'close') close();
      if (b.dataset.x === 'save' && text) { download(`${base}.${fmt().ext}`, text, fmt().mime); toast(`Saving ${base}.${fmt().ext}`, 'success'); }
      if (b.dataset.x === 'copy' && text) copy(text).then((ok) => toast(ok ? `Copied the ${fmt().label} export` : 'The clipboard is not available here', ok ? 'success' : 'error'));
      if (b.dataset.x === 'zip') { try { download(`${base}.zip`, zipAll(spec), 'application/zip'); toast(`Saving ${base}.zip with every format`, 'success'); } catch (err) { toast('The ZIP could not be written: ' + err.message, 'error'); } }
    });
    host().append(scrim);
    draw();
    const first = scrim.querySelector(`[data-fmt="${cur}"]`); if (first) first.focus();
    return { close, el: sheet };
  }

  root.MVLExport = { open, host, askSuper, download, copy, render, formatsFor, flatten, columns, toJSON, toJSONL, toYAML, toTOML, toXML, toCSV, toTSV, toMarkdown, toHTML, toText, htmlToText, htmlToMarkdown, zip, zipAll, crc32, safeName };
})(typeof window !== 'undefined' ? window : globalThis);
