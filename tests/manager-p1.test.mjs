// Pure helpers of the manager-p1 lane: exports, bulk selection and runs, settings history, the
// changelog parser and the typed date parser. Plain node: node --test tests/manager-p1.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', 'companion', 'renderer', 'shared', 'tools');
const ctx = vm.createContext({ console, setTimeout, clearTimeout, TextEncoder, Intl, Date, JSON });
for (const f of ['manager-p1-dates.js', 'manager-p1-export.js', 'manager-p1-bulk.js', 'manager-p1-history.js', 'manager-p1-changelog.js']) {
  vm.runInContext(readFileSync(join(dir, f), 'utf8'), ctx, { filename: f });
}
const { MVLDates, MVLExport, MVLBulk, MVLHistory, MVLChangelog } = ctx;
const plain = (x) => JSON.parse(JSON.stringify(x));

const rows = [
  { name: 'proof-1', power: 'running', ip: '192.0.2.10', meta: { cpus: 8, memoryMB: 12288 }, tags: ['a', 'b'], note: 'has, comma "and" quote' },
  { name: 'ci-host', power: 'off', ip: null, meta: { cpus: 4 }, tags: [], note: 'line\nbreak' }
];
const spec = { title: 'Machines', name: 'machines', schema: 'mvl.machines/1', rows, scope: 'every machine', at: '2026-11-20T10:00:00.000Z' };

test('JSON and JSON Lines round-trip every field and state the schema, encoding and line endings', () => {
  const j = JSON.parse(MVLExport.toJSON(spec));
  assert.deepEqual(j.items, rows);
  assert.equal(j.meta.schema, 'mvl.machines/1');
  assert.equal(j.meta.encoding, 'UTF-8');
  assert.equal(j.meta.lineEndings, 'LF');
  const lines = MVLExport.toJSONL(spec).trim().split('\n');
  assert.equal(JSON.parse(lines[0])._meta.count, 2);
  assert.deepEqual(lines.slice(1).map((l) => JSON.parse(l)), rows);
});

test('CSV quotes commas, quotes and line breaks and flattens nested values into dotted columns', () => {
  const csv = MVLExport.toCSV(spec);
  const [comment, head, first] = csv.split('\n');
  assert.match(comment, /^# Machines: 2 items, every machine \| Schema mvl\.machines\/1; encoding UTF-8; line endings LF/);
  assert.equal(head, 'name,power,ip,meta.cpus,meta.memoryMB,tags,note');
  assert.equal(first, 'proof-1,running,192.0.2.10,8,12288,"[""a"",""b""]","has, comma ""and"" quote"');
  assert.ok(csv.includes('"line\nbreak"'));
  assert.ok(!csv.includes('\r'));
  const tsv = MVLExport.toTSV(spec);
  assert.ok(tsv.split('\n')[3].endsWith('\tline break'));
});

test('YAML, TOML, XML, Markdown, HTML and text carry the data and escape markup', () => {
  const y = MVLExport.toYAML(spec);
  assert.match(y, /^# Machines/);
  assert.ok(y.includes('  - "name": "proof-1"'));
  assert.ok(y.includes('"tags": []'));
  const t = MVLExport.toTOML(spec);
  assert.ok(t.includes('[[items]]'));
  assert.ok(t.includes('"meta.cpus" = 8'));
  assert.ok(!t.includes('"ip" = null'), 'TOML has no null, so the empty value is left out as the loss note says');
  const x = MVLExport.toXML({ ...spec, rows: [{ a: '<b>&' }] });
  assert.ok(x.includes('<string name="a">&lt;b&gt;&amp;</string>'));
  assert.ok(x.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  const md = MVLExport.toMarkdown({ ...spec, rows: [{ a: 'x|y' }] });
  assert.ok(md.includes('| x\\|y |'));
  const html = MVLExport.toHTML({ ...spec, rows: [{ a: '<script>' }] });
  assert.ok(html.includes('&lt;script&gt;') && !html.includes('<script>'));
  assert.ok(MVLExport.toText(spec).includes('meta.cpus: 8'));
  assert.ok(MVLExport.toText({ ...spec, rows: [] }).includes('No items.'));
});

test('every record and document format states what it cannot carry', () => {
  for (const kind of ['records', 'document']) for (const f of MVLExport.formatsFor(kind)) assert.ok(f.loss && f.loss.length > 10, f.id);
});

test('documents export to Markdown and text from the rendered HTML', () => {
  const html = '<h1 id="a">Title</h1><p>Use <code>mvl ls</code> and <a href="https://example.com">a link</a>.</p><ul><li>one</li><li><strong>two</strong></li></ul><pre><code>a &lt; b\n</code></pre><table><tr><th>K</th><th>V</th></tr><tr><td>x</td><td>1</td></tr></table><img src="data:x" alt="A picture">';
  const md = MVLExport.htmlToMarkdown(html);
  assert.ok(md.includes('# Title'));
  assert.ok(md.includes('Use `mvl ls` and [a link](https://example.com).'));
  assert.ok(md.includes('- one') && md.includes('- **two**'));
  assert.ok(md.includes('```\na < b\n```'));
  assert.ok(md.includes('| K | V |') && md.includes('| x | 1 |'));
  assert.ok(md.includes('[image: A picture]'));
  const txt = MVLExport.htmlToText(html);
  assert.ok(txt.includes('Title') && !txt.includes('<h1') && txt.includes('a < b'));
  const out = MVLExport.render({ kind: 'document', doc: { title: 'T', id: 'docs/a.md', html }, at: 'x' }, 'json');
  assert.equal(JSON.parse(out).meta.id, 'docs/a.md');
});

test('the ZIP is a valid stored archive with relative paths only', () => {
  const data = MVLExport.zip([{ name: '../x/./a.txt', data: 'hello' }, { name: 'b/c.json', data: '{}' }], new Date(2026, 10, 20, 10, 0, 0));
  const buf = Buffer.from(data);
  assert.equal(buf.readUInt32LE(0), 0x04034b50);
  const nameLen = buf.readUInt16LE(26);
  assert.equal(buf.slice(30, 30 + nameLen).toString(), 'x/a.txt');
  assert.equal(buf.readUInt32LE(14), MVLExport.crc32(new TextEncoder().encode('hello')));
  assert.equal(buf.slice(30 + nameLen, 30 + nameLen + 5).toString(), 'hello');
  const end = buf.length - 22;
  assert.equal(buf.readUInt32LE(end), 0x06054b50);
  assert.equal(buf.readUInt16LE(end + 10), 2);
  assert.equal(MVLExport.crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
  const all = Buffer.from(MVLExport.zipAll(spec));
  const names = []; let p = 0;
  while (all.readUInt32LE(p) === 0x04034b50) { const n = all.readUInt16LE(p + 26), size = all.readUInt32LE(p + 18); names.push(all.slice(p + 30, p + 30 + n).toString()); p += 30 + n + size; }
  assert.equal(names.length, MVLExport.formatsFor('records').length + 1);
  assert.ok(names.every((n) => n.startsWith('machines/')));
});

test('selection: click, shift ranges, invert, select shown and prune', () => {
  let changes = 0;
  const s = MVLBulk.selection(() => changes++);
  const order = ['a', 'b', 'c', 'd', 'e'];
  s.toggle('b', order, false);
  s.toggle('d', order, true);
  assert.deepEqual(plain(s.list(order)), ['b', 'c', 'd']);
  s.toggle('c', order, false);
  assert.deepEqual(plain(s.list(order)), ['b', 'd']);
  s.invert(order);
  assert.deepEqual(plain(s.list(order)), ['a', 'c', 'e']);
  s.add(['b']);
  assert.equal(s.size(), 4);
  assert.equal(s.prune(['a', 'b']), 2);
  assert.deepEqual(plain(s.list(order)), ['a', 'b']);
  s.clear();
  assert.equal(s.size(), 0);
  assert.ok(changes >= 6);
});

test('bulk runs go one at a time, report failures and stop after the current item', async () => {
  const seen = [];
  let stop = false;
  const results = await MVLBulk.run(['a', 'b', 'c', 'd'], async (x) => {
    seen.push(x);
    if (x === 'b') throw new Error('boom');
    if (x === 'c') { stop = true; return { status: 'skipped', detail: 'already running' }; }
    return { status: 'ok' };
  }, { shouldStop: () => stop });
  assert.deepEqual(seen, ['a', 'b', 'c']);
  assert.deepEqual(plain(results.map((r) => r.status)), ['ok', 'failed', 'skipped', 'cancelled']);
  assert.equal(results[1].detail, 'boom');
  const s = MVLBulk.summarize(results);
  assert.equal(s.text, '1 done, 1 failed, 1 skipped, 1 not started');
  assert.equal(s.kind, 'error');
});

test('history: diff, labels that say what changed, actions, bounded pruning', () => {
  const a = { theme: 'dark', seed: 'Violet', vocabulary: 'not loaded' };
  const b = { theme: 'light', seed: 'Violet', vocabulary: 'not loaded' };
  const d = plain(MVLHistory.diff(a, b));
  assert.deepEqual(d, [{ key: 'theme', from: 'dark', to: 'light' }]);
  assert.equal(MVLHistory.describe(d), 'Theme from Dark to Light');
  assert.equal(MVLHistory.diff(a, a).length, 0, 'an unchanged state records nothing');
  assert.equal(MVLHistory.describe(MVLHistory.diff(a, { ...b, seed: 'Teal' })), 'theme and seed colour changed');
  assert.equal(MVLHistory.actionFor([{ key: 'vocabulary', from: 'not loaded', to: 'loaded' }]), 'Vocabulary loaded');
  assert.equal(MVLHistory.actionFor(d), 'Settings changed');
  const st = { items: [], undo: [], redo: [], pruned: 0, seq: 0 };
  for (let i = 0; i < 7; i++) { const r = MVLHistory.append(st, { action: 'Settings changed', label: 'x' + i, changes: [] }, 5); st.undo.push(r.id); }
  assert.equal(st.items.length, 5);
  assert.equal(st.pruned, 2);
  assert.equal(st.items[0].label, 'x2', 'the oldest go first');
  assert.equal(st.undo.length, 5);
  assert.ok(new Set(st.items.map((r) => r.id)).size === 5);
});

test('history import accepts the settings export and refuses anything else', () => {
  const known = ['theme', 'seed', 'reduceMotion'];
  const exported = MVLExport.toJSON({ title: 'Settings', schema: 'mvl.settings/1', rows: [{ setting: 'theme', label: 'Theme', value: 'light', shown: 'Light' }, { setting: 'reduceMotion', value: true }, { setting: 'mystery', value: 1 }] });
  const r = MVLHistory.parseImport(exported, known);
  assert.equal(r.ok, true);
  assert.deepEqual(plain(r.values), { theme: 'light', reduceMotion: true });
  assert.deepEqual(plain(r.ignored), ['mystery']);
  assert.equal(MVLHistory.parseImport('{', known).ok, false);
  assert.equal(MVLHistory.parseImport('{"a":1}', known).ok, false);
  assert.equal(MVLHistory.parseImport(JSON.stringify({ meta: {}, items: [{ setting: 'theme', value: { x: 1 } }] }), known).ok, false);
});

test('typed dates: ISO, locale order, written months, partial and invalid input', () => {
  assert.equal(MVLDates.parse('2026-11-20').date, '2026-11-20');
  assert.equal(MVLDates.parse('20/11/2026', 'dmy').date, '2026-11-20');
  assert.equal(MVLDates.parse('11/20/2026', 'mdy').date, '2026-11-20');
  assert.equal(MVLDates.parse('20 Nov 2026').date, '2026-11-20');
  assert.equal(MVLDates.parse('November 20, 2026').date, '2026-11-20');
  assert.equal(MVLDates.parse('').empty, true);
  const partial = MVLDates.parse('2026-11');
  assert.equal(partial.ok, false); assert.equal(partial.partial, true);
  assert.equal(MVLDates.parse('20/11', 'dmy').partial, true);
  assert.match(MVLDates.parse('2026-02-30').error, /February 2026 has 28 days/);
  assert.equal(MVLDates.parse('soon').ok, false);
  assert.equal(MVLDates.inRange('2026-11-20T10:00:00Z', '2026-11-01', '2026-11-30'), true);
  assert.equal(MVLDates.inRange('2026-12-01', '2026-11-01', '2026-11-30'), false);
  assert.equal(MVLDates.inRange('', '2026-11-01', ''), false);
  assert.equal(MVLDates.inRange('', '', ''), true);
  assert.equal(MVLDates.shift('2026-03-01', -1), '2026-02-28');
  const p = MVLDates.presets(new Date(2026, 10, 20));
  assert.deepEqual(plain(p.find((x) => x.id === '7')), { id: '7', label: 'Last 7 days', from: '2026-11-14', to: '2026-11-20' });
});

test('changelog: headings, code names, categories, nested items and commit SHAs', () => {
  assert.deepEqual(plain(MVLChangelog.parseHeading('0.1.0 (unreleased)')), { version: '0.1.0', date: '', unreleased: true, codeName: '' });
  assert.deepEqual(plain(MVLChangelog.parseHeading('0.2.0 Har Gow (2026-11-01)')), { version: '0.2.0', date: '2026-11-01', unreleased: false, codeName: 'Har Gow' });
  assert.deepEqual(plain(MVLChangelog.parseHeading('[0.3.0] - 2026-12-01 - Siu Mai')), { version: '0.3.0', date: '2026-12-01', unreleased: false, codeName: 'Siu Mai' });
  const sha = 'a'.repeat(40);
  const html = `<h1>Changelog</h1><h2 id="x">0.2.0 Har Gow (2026-11-01)</h2><p>Summary.</p><h3>Added</h3><ul><li>Bulk actions ${sha}<ul><li>nested</li></ul></li><li>Exports</li></ul><h3>Security</h3><ul><li>Fixed a thing</li></ul><h2>0.1.0 (unreleased)</h2><p>First release.</p><ul><li>mvl CLI</li></ul>`;
  const v = MVLChangelog.parse(html);
  assert.equal(v.length, 2);
  assert.equal(v[0].codeName, 'Har Gow');
  assert.deepEqual(plain(v[0].categories.map((c) => [c.name, c.items.length])), [['Added', 2], ['Security', 1]]);
  assert.ok(v[0].categories[0].items[0].html.includes('<li>nested</li>'));
  assert.deepEqual(plain(v[0].categories[0].items[0].shas), [sha]);
  assert.deepEqual(plain(v[0].shas), [sha]);
  assert.deepEqual(plain(v[1].intro), ['First release.']);
  assert.equal(v[1].categories[0].name, 'Changes');
  const byDate = MVLChangelog.filter(v, { from: '2026-10-01', to: '2026-11-30' });
  assert.equal(byDate.versions.length, 1);
  assert.equal(byDate.undatedHidden, 1);
  const byText = MVLChangelog.filter(v, { test: (t) => /exports/i.test(t) });
  assert.equal(byText.versions.length, 1);
  assert.equal(byText.versions[0].count, 1);
  const out = MVLChangelog.viewHtml(byText.versions, true);
  assert.ok(out.includes('Exports'));
});

test('the real bundled CHANGELOG.md parses into at least one version', async () => {
  const { Marked } = await import('marked');
  const md = readFileSync(join(here, '..', 'CHANGELOG.md'), 'utf8');
  const v = MVLChangelog.parse(new Marked({ gfm: true }).parse(md));
  assert.ok(v.length >= 1);
  assert.ok(v.every((x) => x.version));
});
