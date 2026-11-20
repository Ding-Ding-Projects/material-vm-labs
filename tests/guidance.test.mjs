// Guidance lane: extensions (manifest validation and refusals, consent on new and changed permissions,
// input allowlist and sensitive-value exclusion, JSON-lines framing and limits, real extension process
// runs with timeouts and answer limits), the external editor guards, settings provenance, the shared
// Markdown renderer's escaping, and the hand-written guidance inventory with its red-then-green check.
// Run: node tests/guidance.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ext = require('../companion/src/shared/extensions-ipc.js');
const editor = require('../companion/src/shared/editor-ipc.js');
const guid = require('../companion/src/shared/guidance-ipc.js');
const md = require('../companion/renderer/shared/tools/guidance-render.js');
const reg = require('../companion/renderer/shared/tools/guidance-registry.js');
const BUILTIN = path.join(path.dirname(require.resolve('../companion/src/shared/extensions-ipc.js')), 'extensions-builtin');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mvl-guidance-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const fresh = () => { const d = path.join(tmp, 'w' + (n++)); fs.mkdirSync(d); return d; };

const good = () => ({
  manifestVersion: 1, id: 'sample-check', name: 'Sample', version: '1.0.0', apiVersion: 1, description: 'A sample.', runtime: 'node', main: 'main.js',
  hooks: ['receipt'], actions: [{ id: 'go', title: 'Go', hook: 'receipt' }], permissions: ['receive:receipt', 'answer:report']
});
function writeExt(root, manifest, code) {
  const d = path.join(root, manifest.id); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'extension.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(d, manifest.main || 'main.js'), code);
  return d;
}
const READ_STDIN = "let raw='';process.stdin.on('data',c=>raw+=c);process.stdin.on('end',()=>{const req=JSON.parse(raw.split('\\n')[0]);";
const store = (root, extra = {}) => ext.createStore(Object.assign({ root, stateFile: path.join(root, '..', path.basename(root) + '-state.json'), builtinDir: path.join(tmp, 'no-builtins'), execPath: process.execPath }, extra));

// ---------- Manifest ----------
test('the built-in manifests are valid', () => {
  for (const id of fs.readdirSync(BUILTIN)) {
    const v = ext.parseManifestText(fs.readFileSync(path.join(BUILTIN, id, 'extension.json'), 'utf8'));
    assert.equal(v.ok, true, id + ': ' + (v.errors || []).join(' '));
    assert.equal(v.manifest.id, id);
  }
});
test('manifest refusals name what is wrong', () => {
  const cases = [
    [(m) => { m.extra = 1; }, /Unknown field "extra"/],
    [(m) => { m.id = 'Bad Id'; }, /id must be/],
    [(m) => { m.apiVersion = 9; }, /needs a newer Material VM Labs/],
    [(m) => { m.main = '../evil.js'; }, /main must be a relative path/],
    [(m) => { m.main = 'C:/x.js'; }, /main must be a relative path/],
    [(m) => { m.permissions = ['answer:report']; }, /receipt hook needs the receive:receipt/],
    [(m) => { m.permissions.push('read:everything'); }, /Unknown permission/],
    [(m) => { m.permissions = ['receive:receipt']; }, /answer:report or answer:checks/],
    [(m) => { m.actions.push({ id: 'go', title: 'Again', hook: 'receipt' }); }, /share the id/],
    [(m) => { m.actions[0].hook = 'machine'; }, /hook must be one of the hooks/],
    [(m) => { m.timeoutSeconds = 99; }, /timeoutSeconds/],
    [(m) => { m.runtime = 'bash'; }, /runtime must be one of/],
    [(m) => { m.version = 'one'; }, /version must look like/],
    [(m) => { delete m.permissions; }, /permissions must be a list/],
    [(m) => { m.permissions.push('receive:machine-address'); }, /only makes sense together/]
  ];
  for (const [mut, re] of cases) { const m = good(); mut(m); const v = ext.validateManifest(m); assert.equal(v.ok, false); assert.match(v.errors.join(' '), re); }
  assert.match(ext.parseManifestText('{nope').errors[0], /not valid JSON/);
  assert.match(ext.parseManifestText(' '.repeat(40000)).errors[0], /larger than/);
  assert.equal(ext.validateManifest(good()).ok, true);
});

// ---------- Consent ----------
test('permission diff: new, same, changed version, added and removed', () => {
  const m = ext.validateManifest(good()).manifest;
  assert.equal(ext.permissionDiff(null, m).status, 'new');
  assert.equal(ext.permissionDiff({ version: '1.0.0', permissions: ['answer:report', 'receive:receipt'] }, m).status, 'same');
  const v = ext.permissionDiff({ version: '0.9.0', permissions: ['answer:report', 'receive:receipt'] }, m);
  assert.equal(v.status, 'changed'); assert.equal(v.versionChanged, true); assert.deepEqual(v.added, []);
  const d = ext.permissionDiff({ version: '1.0.0', permissions: ['receive:receipt', 'answer:checks'] }, m);
  assert.deepEqual(d.added, ['answer:report']); assert.deepEqual(d.removed, ['answer:checks']); assert.deepEqual(d.kept, ['receive:receipt']);
});

// ---------- Input allowlist and sensitive values ----------
test('inputs carry only allowlisted, non-secret fields', () => {
  const r = ext.buildInput('receipt', ['receive:receipt'], { receipt: { repository: 'o/r', commit: 'a'.repeat(40), verdict: 'passed', path: 'C:\\runs\\x\\receipt.json', password: 'hunter2', token: 'ghp_' + 'A1b2'.repeat(10), machine: { name: 'proof-1', secret: 's' } } });
  assert.equal(r.ok, true);
  const s = JSON.stringify(r.input);
  assert.ok(!s.includes('receipt.json') && !s.includes('hunter2') && !s.includes('ghp_') && !s.includes('"secret"'));
  assert.equal(r.input.receipt.commit, 'a'.repeat(40), 'a commit id is kept');
  const p = ext.buildInput('machine-plan', ['receive:machine-plan'], { plan: { name: 'x1', pw: 'hunter2', secret: 'hunter2', usesDefaultSignIn: true, net: 'bridged' } });
  assert.ok(!JSON.stringify(p.input).includes('hunter2'));
  assert.equal(p.input.plan.usesDefaultSignIn, true);
  const noIp = ext.buildInput('machine', ['receive:machine'], { machine: { Name: 'proof-1', IP: '192.0.2.10' } });
  assert.equal(noIp.input.machine.ip, undefined);
  const ip = ext.buildInput('machine', ['receive:machine', 'receive:machine-address'], { machine: { Name: 'proof-1', IP: '192.0.2.10' } });
  assert.equal(ip.input.machine.ip, '192.0.2.10');
  assert.equal(ext.buildInput('receipt', ['receive:machine'], { receipt: {} }).ok, false);
  const scrubbed = ext.scrubSensitive({ note: 'key github_pat_' + 'x'.repeat(30) + ' and https://discord.com/api/webhooks/123456/abcdefghijklmnopqrstuvwxyz', apiKey: 'k', nested: { Authorization: 'Bearer x' } });
  assert.equal(scrubbed.apiKey, undefined); assert.equal(scrubbed.nested.Authorization, undefined);
  assert.ok(!scrubbed.note.includes('github_pat_') && !scrubbed.note.includes('webhooks/123456'));
});

// ---------- Framing ----------
test('JSON-lines framing handles split chunks, CRLF and enforces line and total limits', () => {
  const p = ext.createLineParser({ maxLineBytes: 64, maxTotalBytes: 200 });
  assert.deepEqual(p.push(Buffer.from('{"a":')).lines, []);
  assert.deepEqual(p.push(Buffer.from('1}\r\n{"b":2}\n')).lines, ['{"a":1}', '{"b":2}']);
  const q = ext.createLineParser({ maxLineBytes: 16, maxTotalBytes: 1000 });
  assert.match(q.push(Buffer.from('x'.repeat(40))).error, /longer than/);
  const t = ext.createLineParser({ maxLineBytes: 1000, maxTotalBytes: 50 });
  assert.match(t.push(Buffer.from('y\n'.repeat(40))).error, /more than/);
});
test('answers are validated against the allowed permissions', () => {
  const P = ['receive:receipt', 'answer:report'];
  assert.equal(ext.validateAnswer({ type: 'answer', report: '# hi' }, P).ok, true);
  assert.match(ext.validateAnswer({ type: 'answer', checks: [] }, P).error, /not allowed answer:checks/);
  assert.match(ext.validateAnswer({ type: 'answer', report: 'x', run: 'rm' }, P).error, /unknown field/);
  assert.match(ext.validateAnswer({ type: 'answer', report: 'x'.repeat(ext.LIMITS.maxReportChars + 1) }, P).error, /longer than/);
  assert.match(ext.validateAnswer({ type: 'answer', checks: [{ status: 'ok', title: 't' }] }, ['answer:checks']).error, /check 1/);
  assert.match(ext.validateAnswer({ type: 'answer' }, P).error, /no summary/);
  assert.match(ext.validateAnswer([], P).error, /not a JSON object/);
});

// ---------- Real processes ----------
test('built-ins install, need consent, then really run (receipt summary and name policy)', async () => {
  const root = path.join(fresh(), 'extensions');
  const s = store(root, { builtinDir: BUILTIN });
  s.syncBuiltins();
  const list = s.scan();
  assert.deepEqual(list.map((x) => x.manifest.id).sort(), ['machine-name-policy', 'receipt-summary']);
  assert.ok(list.every((x) => x.state === 'needs-consent' && x.builtIn));
  const receipt = { repository: 'octo/app', commit: '4f1c2ab9d0e7aa', verdict: 'passed', hostMinutes: 14, entrypoints: [{ name: 'build', exitCode: 0 }], dependencies: { tools: 0, programs: 0, choco: 0, folders: 1, megabytes: 3 }, machine: { name: 'proof-1', hypervisor: 'vmware' } };
  const refused = await s.run('receipt-summary', 'summarise', { receipt });
  assert.equal(refused.ok, false); assert.equal(refused.needsConsent, true);
  assert.equal(s.allow('receipt-summary', '1.0.0', ['receive:receipt']).ok, false, 'allowing a different set is refused');
  assert.equal(s.allow('receipt-summary', '1.0.0', ['receive:receipt', 'answer:report']).ok, true);
  const r = await s.run('receipt-summary', 'summarise', { receipt });
  assert.equal(r.ok, true, r.error);
  assert.match(r.answer.report, /## Fresh build passed/); assert.match(r.answer.report, /:white_check_mark: `build` exit 0/);
  assert.equal(s.find('receipt-summary').runs[0].ok, true);
  s.allow('machine-name-policy', '1.0.0', ['answer:checks', 'receive:machine-plan']);
  const c = await s.run('machine-name-policy', 'check', { plan: { name: 'a-very-long-windows-name', os: 'windows', net: 'bridged', usesDefaultSignIn: true, project: 'general' } });
  assert.equal(c.ok, true, c.error);
  const titles = c.answer.checks.map((x) => x.status + ':' + x.title);
  assert.ok(titles.includes('warn:Windows short name') && titles.includes('fail:Bridged with the default sign-in'));
  s.setMaster(true);
  assert.match((await s.run('receipt-summary', 'summarise', { receipt })).error, /master switch/);
});
test('a changed version or permission set turns it off until allowed again', async () => {
  const root = path.join(fresh(), 'extensions');
  const m = good();
  const dir = writeExt(root, m, READ_STDIN + "process.stdout.write(JSON.stringify({type:'answer',summary:'ok'})+'\\n');});");
  const s = store(root);
  s.allow('sample-check', '1.0.0', m.permissions);
  assert.equal(s.find('sample-check').state, 'on');
  fs.writeFileSync(path.join(dir, 'extension.json'), JSON.stringify(Object.assign(good(), { version: '1.1.0', permissions: ['receive:receipt', 'answer:report', 'answer:checks'] })));
  const e = s.find('sample-check');
  assert.equal(e.state, 'needs-consent'); assert.deepEqual(e.diff.added, ['answer:checks']); assert.equal(e.diff.fromVersion, '1.0.0');
  assert.equal((await s.run('sample-check', 'go', { receipt: {} })).needsConsent, true);
  assert.equal(s.setEnabled('sample-check', true).needsConsent, true);
});
test('timeouts, oversized output, refused answers, non-JSON and silent exits fail with the extension named', async () => {
  const root = path.join(fresh(), 'extensions');
  const mk = (id, code, extra = {}) => { const m = Object.assign(good(), { id }, extra); writeExt(root, m, code); return m; };
  const cases = [
    [mk('slow-one', 'setTimeout(()=>{}, 60000);', { timeoutSeconds: 1 }), /did not answer within 1 seconds and was stopped/],
    [mk('big-one', "const l=JSON.stringify({type:'log',message:'x'.repeat(1000)})+'\\n';for(let i=0;i<400;i++)process.stdout.write(l);setTimeout(()=>{},2000);"), /more than 256 KB/],
    [mk('long-line', "process.stdout.write(JSON.stringify({type:'answer',report:'x'.repeat(70000)})+'\\n');"), /line longer than 64 KB/],
    [mk('greedy-one', READ_STDIN + "process.stdout.write(JSON.stringify({type:'answer',checks:[]})+'\\n');});"), /not allowed answer:checks/],
    [mk('chatty-one', "process.stdout.write('hello there\\n');"), /not JSON/],
    [mk('quiet-one', 'process.exit(3);'), /exited with code 3 without an answer/]
  ];
  const s = store(root);
  for (const [m] of cases) s.allow(m.id, m.version, m.permissions);
  for (const [m, re] of cases) {
    const t0 = Date.now();
    const r = await s.run(m.id, 'go', { receipt: { repository: 'o/r' } });
    assert.equal(r.ok, false, m.id); assert.match(r.error, re); assert.ok(r.error.startsWith('Sample'), 'names the extension');
    assert.ok(Date.now() - t0 < 8000);
  }
});
test('an extension never receives secrets, through its input or its environment', async () => {
  const root = path.join(fresh(), 'extensions');
  const m = good();
  writeExt(root, m, READ_STDIN + "process.stdout.write(JSON.stringify({type:'answer',report:JSON.stringify({input:req.input,env:process.env})})+'\\n');});");
  const s = store(root);
  s.allow(m.id, m.version, m.permissions);
  process.env.GH_TOKEN = 'ghp_' + 'Z9y8'.repeat(10);
  process.env.MVL_SECRET_SAMPLE = 'hunter2';
  try {
    const r = await s.run(m.id, 'go', { receipt: { repository: 'o/r', password: 'hunter2', note: 'hunter2', machine: { name: 'm', credential: 'hunter2' } } });
    assert.equal(r.ok, true, r.error);
    assert.ok(!r.answer.report.includes('hunter2') && !r.answer.report.includes('ghp_'));
    const got = JSON.parse(r.answer.report);
    assert.equal(got.env.MVL_EXTENSION_ID, 'sample-check'); assert.equal(got.env.GH_TOKEN, undefined);
  } finally { delete process.env.GH_TOKEN; delete process.env.MVL_SECRET_SAMPLE; }
});
test('built-ins update only while unmodified; removed built-ins stay removed', () => {
  const bundled = path.join(fresh(), 'bundled'); const root = path.join(fresh(), 'extensions');
  fs.cpSync(path.join(BUILTIN, 'receipt-summary'), path.join(bundled, 'receipt-summary'), { recursive: true });
  const s = store(root, { builtinDir: bundled }); s.syncBuiltins();
  const bump = (v) => { const f = path.join(bundled, 'receipt-summary', 'extension.json'); fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/"version": "[^"]+"/, `"version": "${v}"`)); };
  bump('1.0.1'); s.syncBuiltins();
  assert.equal(s.find('receipt-summary').manifest.version, '1.0.1');
  fs.appendFileSync(path.join(root, 'receipt-summary', 'main.js'), '\n// my change\n');
  assert.equal(s.find('receipt-summary').modified, true);
  bump('1.0.2'); s.syncBuiltins();
  assert.equal(s.find('receipt-summary').manifest.version, '1.0.1', 'a modified copy is left alone');
  assert.equal(s.remove('receipt-summary').ok, true); s.syncBuiltins();
  assert.equal(s.find('receipt-summary'), undefined);
  s.restoreBuiltins(); assert.equal(s.find('receipt-summary').manifest.version, '1.0.2');
});
test('scan reports broken folders instead of hiding them', () => {
  const root = path.join(fresh(), 'extensions');
  fs.mkdirSync(path.join(root, 'empty-folder'), { recursive: true });
  writeExt(root, Object.assign(good(), { id: 'named-wrong' }), '').toString();
  fs.renameSync(path.join(root, 'named-wrong'), path.join(root, 'other-name'));
  const out = store(root).scan();
  assert.match(out.find((x) => x.folder === 'empty-folder').errors[0], /no extension.json/);
  assert.match(out.find((x) => x.folder === 'other-name').errors[0], /manifest id is "named-wrong"/);
});
test('the documentation samples are valid and really run', async () => {
  const docs = path.resolve(path.dirname(require.resolve('../package.json')), 'docs', 'extensions', 'samples');
  const root = path.join(fresh(), 'extensions');
  const ran = [];
  for (const id of fs.readdirSync(docs)) {
    const v = ext.parseManifestText(fs.readFileSync(path.join(docs, id, 'extension.json'), 'utf8'));
    assert.equal(v.ok, true, id + ': ' + (v.errors || []).join(' '));
    fs.cpSync(path.join(docs, id), path.join(root, id), { recursive: true });
    ran.push(v.manifest);
  }
  assert.ok(ran.length >= 1);
  const s = store(root);
  for (const m of ran) {
    s.allow(m.id, m.version, m.permissions);
    const a = m.actions[0];
    const r = await s.run(m.id, a.id, { receipt: { repository: 'o/r', commit: 'abc1234', verdict: 'failed', entrypoints: [{ name: 'build', exitCode: 1 }] }, machine: { Name: 'proof-1', Os: 'windows', Power: 'running' }, plan: { name: 'proof-2', os: 'windows', net: 'nat' } });
    if (!r.ok && /is not installed/.test(r.error) && m.runtime !== 'node') { console.log(`# ${m.id}: skipped, ${r.error}`); continue; }
    assert.equal(r.ok, true, m.id + ': ' + r.error);
    ran.splice(ran.indexOf(m), 1, Object.assign({ ok: true }, m));
  }
  assert.ok(ran.some((m) => m.ok && m.runtime === 'node'), 'at least the Node sample really ran');
});

// ---------- External editor ----------
test('editor targets stay inside the manager folders and folders open as a workspace root', () => {
  const root = fresh(); const f = path.join(root, 'a.json'); fs.writeFileSync(f, '{}');
  assert.equal(editor.checkTarget(f, [root]).ok, true);
  assert.equal(editor.checkTarget(root, [root]).isDir, true);
  assert.match(editor.checkTarget('relative/a.json', [root]).error, /full path/);
  assert.match(editor.checkTarget(path.join(root, 'missing.json'), [root]).error, /does not exist/);
  assert.match(editor.checkTarget(os.tmpdir(), [root]).error, /Only files and folders inside/);
  assert.deepEqual(editor.argsFor({ kind: 'vscode', folders: true, name: 'Visual Studio Code' }, root, true).args, ['--new-window', root]);
  assert.deepEqual(editor.argsFor({ kind: 'vscode', folders: true, name: 'Visual Studio Code' }, f, false).args, ['--reuse-window', f]);
  assert.match(editor.argsFor({ kind: 'other', folders: false, name: 'Notepad' }, root, true).error, /opens files only/);
  assert.equal(editor.validateCustom('not/absolute').ok, false);
  assert.equal(editor.validateCustom(path.join(root, 'nope.exe')).ok, false);
  const env = editor.cleanEnv({ PATH: '/bin', ELECTRON_RUN_AS_NODE: '1', VSCODE_PID: '3', NODE_OPTIONS: '--x' });
  assert.deepEqual(Object.keys(env), ['PATH']);
  assert.ok(Array.isArray(editor.candidates({ PATH: '' }, 'linux')));
});

// ---------- Settings provenance ----------
test('provenance says written or compiled-in default, truthfully', () => {
  const d = guid.FALLBACK_DEFAULTS;
  const none = guid.provenance(null, d);
  assert.equal(none.fileExists, false); assert.equal(none.keys.defaultNet.written, false); assert.equal(none.keys.defaultNet.value, 'nat');
  const some = guid.provenance('{"defaultNet":"bridged"}', d);
  assert.equal(some.keys.defaultNet.written, true); assert.equal(some.keys.defaultNet.value, 'bridged'); assert.equal(some.keys.stateRoot.written, false);
  assert.match(guid.provenance('{bad', d).error, /not valid JSON/);
});

// ---------- Renderer ----------
test('the renderer escapes markup and refuses unsafe links', () => {
  const html = (s, o) => md.toHTML(md.parse(s, o));
  const out = html('# Title :tada:\n\n<script>alert(1)</script> <img src=x onerror=alert(1)> [x](javascript:alert(1)) [d](data:text/html,hi) [ok](https://e.org/a"b) [rel](docs/a.md)\n\n```html\n<b>bold</b>\n```', { base: 'https://github.com/o/r/blob/main/' });
  assert.ok(!/<script|<img|onerror=|javascript:|data:text/i.test(out.replace(/&lt;[^&]*&gt;/g, '')));
  assert.match(out, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(out, /href="https:\/\/e\.org\/a%22b"/);
  assert.match(out, /href="https:\/\/github\.com\/o\/r\/blob\/main\/docs\/a\.md"/);
  assert.match(out, /<pre><code data-lang="html">&lt;b&gt;bold&lt;\/b&gt;<\/code><\/pre>/);
  assert.match(out, /aria-label="tada">\u{1F389}</u);
  assert.match(html('- [x] done\n- [ ] todo\n\n1. a\n2. b'), /<ul><li>\[done\] done<\/li><li>\[ \] todo<\/li><\/ul>\n<ol><li>a<\/li><li>b<\/li><\/ol>/);
  assert.match(html('**b** _i_ `c` ~~s~~'), /<strong>b<\/strong> <em>i<\/em> <code>c<\/code> <del>s<\/del>/);
  assert.equal(md.parse('').length, 0);
  assert.equal(md.parse('   \n').length, 0);
  assert.match(html(':not_an_emoji:'), /:not_an_emoji:/);
  assert.equal(md.resolveHref('vbscript:x'), null); assert.equal(md.resolveHref('file:///c:/x'), null);
});

// ---------- Guidance inventory ----------
function inventoryProblems(r) {
  const problems = [];
  const ids = new Set(), texts = new Map();
  for (const c of r.CONTROLS) {
    if (ids.has(c.id)) problems.push(c.id + ': duplicate id'); ids.add(c.id);
    if (!c.sel || !c.scope || !c.title || !c.concept) problems.push(c.id + ': missing selector, scope, title or concept');
    if (!c.explain || c.explain.length < 40) problems.push(c.id + ': no real explanation');
    if (texts.has(c.explain)) problems.push(c.id + ': repeats ' + texts.get(c.explain)); texts.set(c.explain, c.id);
    if (!c.steps || !c.steps.length) problems.push(c.id + ': no guided steps');
    if (!c.example || !c.example.input || !c.example.action || !c.example.expected) problems.push(c.id + ': no worked example');
    if (!c.play || !Array.isArray(c.play.fields) || !c.play.fields.length || typeof c.play.evaluate !== 'function') problems.push(c.id + ': no playground');
    else { const d = {}; for (const f of c.play.fields) d[f.name] = f.initial; const res = c.play.evaluate(d); if (!res || typeof res.message !== 'string' || !res.message) problems.push(c.id + ': inert playground'); }
    if (c.complex && (!c.steps || c.steps.length < 3)) problems.push(c.id + ': a complicated workflow needs full steps');
  }
  const mainKeys = new Set(r.SETTINGS.filter((s) => s.source.kind === 'main').map((s) => s.source.key));
  for (const s of r.SETTINGS) {
    if (!r.CONTROLS.some((c) => c.id === s.id)) problems.push(s.id + ': settings element without explanation');
    if (!s.source || !['main', 'local', 'none'].includes(s.source.kind)) problems.push(s.id + ': no provenance source');
  }
  for (const p of r.POINTERS) if (p.key !== '*' && !mainKeys.has(p.key)) problems.push(p.id + ': quick add writes a key no Settings row owns');
  return problems;
}
test('the hand-written guidance inventory is complete (red when an item is broken, green when restored)', () => {
  assert.deepEqual(inventoryProblems(reg), []);
  const clone = (mut) => { const r = { CONTROLS: reg.CONTROLS.map((c) => Object.assign({}, c)), SETTINGS: reg.SETTINGS.map((s) => Object.assign({}, s)), POINTERS: reg.POINTERS.map((p) => Object.assign({}, p)) }; mut(r); return inventoryProblems(r); };
  assert.match(clone((r) => { r.CONTROLS = r.CONTROLS.filter((c) => c.id !== 'settings.theme'); }).join(), /settings.theme: settings element without explanation/);
  assert.match(clone((r) => { r.CONTROLS[1].explain = r.CONTROLS[0].explain; }).join(), /repeats/);
  assert.match(clone((r) => { r.CONTROLS[0].play = { fields: [], evaluate: () => ({}) }; }).join(), /no playground/);
  assert.match(clone((r) => { r.CONTROLS[0].play = Object.assign({}, r.CONTROLS[0].play, { evaluate: () => ({}) }); }).join(), /inert playground/);
  assert.match(clone((r) => { r.POINTERS[0].key = 'stateRootCopy'; }).join(), /writes a key no Settings row owns/);
  assert.deepEqual(clone(() => {}), []);
});
test('playground checks use the manager\'s own rules', () => {
  const C = reg.CHECKS;
  assert.equal(C.checkName('proof 2').ok, false); assert.equal(C.checkName('proof-1').ok, false); assert.equal(C.checkName('fresh-9').ok, true);
  assert.equal(C.checkStateRoot('D:\\La|bs').ok, false); assert.equal(C.checkStateRoot('').ok, true);
  assert.equal(C.checkRepo('octo/app').ok, true); assert.equal(C.checkRepo('octo').ok, false);
  assert.equal(C.checkLabels('mvl, a b').ok, false); assert.match(C.checkLabels('mvl').message, /self-hosted, windows, x64, mvl/);
  assert.equal(C.checkPassword('abc').ok, false); assert.equal(C.planCommand({ name: 'u', os: 'ubuntu', net: 'bridged', size: 'l' }), 'mvl new u --os ubuntu --net bridged --mem 16384 --cpus 12');
});
