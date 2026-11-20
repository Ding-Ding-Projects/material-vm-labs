// Regex workbench core tests. Plain Node, no dependencies: node tests/regex.test.mjs
// Runs against this runtime's real JavaScript regex engine and the real isolated worker file.
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const toolsDir = path.join(here, '..', 'companion', 'renderer', 'shared', 'tools');
const require = createRequire(import.meta.url);
const R = require(path.join(toolsDir, 'regex-core.js'));

let pass = 0, fail = 0;
async function check(name, fn) {
  try { const ok = await fn(); if (ok === true) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (ok === false ? '' : ': ' + JSON.stringify(ok))); } }
  catch (e) { fail++; console.log('FAIL ' + name + ': ' + e.message); }
}
const texts = (tree) => { const out = []; (function v(n, d) { out.push('  '.repeat(d) + n.raw + ' | ' + n.text); n.children.forEach((c) => v(c, d + 1)); })(tree, 0); return out; };

// ---------- explanation tree ----------
await check('explains a literal run as one item', () => { const t = R.explain('cat', '').tree; return t.type === 'lit' && t.text === 'Match the text "cat"' && t.children.length === 0; });
await check('explains anchors, classes and quantifiers in order', () => {
  const t = R.explain('^[a-z]+\\d{2,4}$', '').tree;
  const kids = t.children.map((c) => c.text);
  return t.type === 'seq' && kids[0] === 'Assert the start of the text (zero width)' && /^Repeat the item below one or more times, as many as possible/.test(kids[1]) && /between 2 and 4 times/.test(kids[2]) && kids[3] === 'Assert the end of the text (zero width)' && t.children[1].children[0].children[0].text.startsWith('A character from "a" to "z"');
});
await check('explains alternation with numbered alternatives', () => { const t = R.explain('cat|dog|', '').tree; return t.type === 'alt' && t.children.length === 3 && t.children[0].text === 'Alternative 1: Match the text "cat"' && t.children[2].text.startsWith('Alternative 3: Match the empty string'); });
await check('explains named, numbered and non-capturing groups with backreferences', () => {
  const L = texts(R.explain('(?<w>\\w+)\\s(?:x)(y)\\k<w>\\2', '').tree).join('\n');
  return /Capture group 1 named "w"/.test(L) && /Group without capturing/.test(L) && /Capture group 2\b/.test(L) && /group named "w" captured/.test(L) && /same text that group 2 captured/.test(L);
});
await check('explains lookaround kinds', () => { const L = texts(R.explain('(?=a)(?!b)(?<=c)(?<!d)', '').tree).join('\n'); return ['Lookahead:', 'Negative lookahead:', 'Lookbehind:', 'Negative lookbehind:'].every((k) => L.includes(k)); });
await check('flags change the explanation of dot, anchors and case', () => {
  const a = R.explain('.', '').tree.text, b = R.explain('.', 's').tree.text, c = R.explain('^', 'm').tree.text, d = R.explain('k', 'i').tree.text;
  return /except line breaks/.test(a) && /including line breaks/.test(b) && /start of a line/.test(c) && /either case/.test(d);
});
await check('explains Unicode escapes and properties with the u flag', () => { const L = texts(R.explain('\\u{1F600}\\p{Script=Han}\\P{L}', 'u').tree).join('\n'); return L.includes('U+1F600') && L.includes('with the Unicode property Script=Han') && L.includes('without the Unicode property L'); });
await check('explains v flag set operations', () => { const L = texts(R.explain('[\\p{L}--[a-z]]', 'v').tree).join('\n'); return L.includes('Subtraction'); });
await check('explanation spans map back to the source', () => { const src = 'ab(c|d)+'; const t = R.explain(src, '').tree; const q = t.children[1]; return src.slice(q.start, q.end) === '(c|d)+' && R.nodeAt(t, 3).length >= 2; });
await check('invalid pattern reports position and the engine message', () => {
  let at = null; try { R.parse('(abc', ''); } catch (e) { at = e.at; }
  const d = R.diagnose('(abc', '');
  return at === 0 && d[0].level === 'error' && /rejects/.test(d[0].text);
});
await check('octal fallback without a group is flagged', () => R.diagnose('\\5x', '').some((d) => /octal/.test(d.text)));
await check('nested repetition is flagged as a backtracking risk', () => R.riskOf('(a+)+$', '').length === 1 && R.riskOf('(x\\w+)*', '').length === 1 && R.riskOf('\\d+-\\d+', '').length === 0);
await check('explanation text export is an indented outline', () => { const s = R.explainText(R.explain('a|b', '').tree); return s.startsWith('- `a|b`') && s.includes('\n  - `a`'); });

// ---------- matching: Unicode, multiline, zero width ----------
await check('zero-width matches advance one position each', () => { const r = R.runJob({ op: 'match', pattern: 'x*', flags: 'g', subject: 'abc' }); return r.matches.length === 4 && r.matches.every((m, k) => m.index === k && m.end === k); });
await check('zero-width matches step over a whole surrogate pair with u', () => { const r = R.runJob({ op: 'match', pattern: '', flags: 'gu', subject: 'a\u{1F600}b' }); return JSON.stringify(r.matches.map((m) => m.index)) === '[0,1,3,4]'; });
await check('without u an emoji is two code units', () => { const a = R.runJob({ op: 'match', pattern: '^.$', flags: '', subject: '\u{1F600}' }); const b = R.runJob({ op: 'match', pattern: '^.$', flags: 'u', subject: '\u{1F600}' }); return a.matches.length === 0 && b.matches.length === 1 && R.diagnose('\u{1F600}+', '').some((d) => /two separate code units/.test(d.text)); });
await check('Unicode properties match letters in any script', () => { const r = R.runJob({ op: 'match', pattern: '\\p{L}+', flags: 'gu', subject: 'Café 漢字 42' }); return r.matches.map((m) => m.text).join('|') === 'Café|漢字'; });
await check('multiline anchors match per line only with m', () => { const s = 'one\ntwo\r\nthree'; const a = R.runJob({ op: 'match', pattern: '^\\w+$', flags: 'g', subject: s }); const b = R.runJob({ op: 'match', pattern: '^\\w+$', flags: 'gm', subject: s }); return a.matches.length === 0 && b.matches.map((m) => m.text).join(',') === 'one,two,three'; });
await check('capture groups report positions and unmatched groups as null', () => { const r = R.runJob({ op: 'match', pattern: '(a)|(b)', flags: 'g', subject: 'ab' }); return r.matches[0].groups[0].start === 0 && r.matches[0].groups[1] === null && r.matches[1].groups[0] === null && r.matches[1].groups[1].text === 'b'; });
await check('no match is an empty list', () => R.runJob({ op: 'match', pattern: 'zzz', flags: 'g', subject: 'abc' }).matches.length === 0);
await check('oversized subjects are refused, not truncated silently', () => { try { R.runJob({ op: 'match', pattern: 'a', flags: 'g', subject: 'a'.repeat(R.LIMITS.subject + 1) }); return false; } catch (e) { return /longer than/.test(e.message); } });

// ---------- replace preview ----------
await check('replace preview equals the engine and explains the template', () => {
  const r = R.runJob({ op: 'replace', pattern: '(?<user>\\w+)@(\\w+)', flags: 'g', subject: 'a@b, c@d', replacement: '$2:$<user> [$&] $$' });
  return r.result === 'b:a [a@b] $, d:c [c@d] $' && r.verified && r.count === 2 && r.pieces[1].to === 'd:c [c@d] $' && r.template.map((t) => t.type).join(',') === 'group,text,named,text,match,text,dollar';
});
await check('replace preview handles before and after context', () => { const r = R.runJob({ op: 'replace', pattern: 'b', flags: '', subject: 'abc', replacement: "[$`|$']" }); return r.result === 'a[a|c]c' && r.verified; });
await check('replace preview handles zero-width matches', () => { const r = R.runJob({ op: 'replace', pattern: '\\b', flags: 'g', subject: 'hi yo', replacement: '|' }); return r.result === '|hi| |yo|' && r.verified && r.count === 4; });
await check('replace preview of $10 with one group follows the engine', () => { const r = R.runJob({ op: 'replace', pattern: '(a)', flags: '', subject: 'a', replacement: '$10' }); return r.result === 'a0' && r.verified; });
await check('replace preview never changes the subject passed in', () => { const subject = 'keep me'; R.runJob({ op: 'replace', pattern: 'keep', flags: 'g', subject, replacement: 'lose' }); return subject === 'keep me'; });

// ---------- split, test cases, GREP ----------
await check('split includes capture groups like the engine', () => JSON.stringify(R.runJob({ op: 'split', pattern: '(,)\\s*', flags: '', subject: 'a, b,c' }).parts) === JSON.stringify(['a', ',', 'b', ',', 'c']));
await check('test cases report pass and fail', () => { const r = R.runJob({ op: 'tests', pattern: '^\\d+$', flags: 'g', cases: [{ text: '42', expect: true }, { text: 'x', expect: true }, { text: 'y', expect: false }] }).results; return r[0].pass && !r[1].pass && r[2].pass; });
await check('GREP reports file, line and column', () => { const r = R.runJob({ op: 'grep', pattern: 'b+', flags: '', files: [{ name: 'one.txt', text: 'a\nxbb\r\nb' }, { name: 'two.txt', text: 'none' }] }); return r.results.length === 2 && r.results[0].line === 2 && r.results[0].col === 2 && r.results[0].text === 'xbb' && r.perFile[1].count === 0; });

// ---------- tracer agrees with the engine ----------
for (const [p, f, s] of [['a+b', '', 'xaaab'], ['(a|ab)(c|bcd)(d*)', '', 'abcd'], ['(a*)*b', '', 'aaaa'], ['(?<=\\$)\\d+', '', 'cost $42'], ['^\\w+$', 'm', 'ab\ncd'], ['(a)|b\\1', '', 'b'], ['x*', '', 'abc'], ['(?:(a)|b)+', '', 'ab'], ['\\u{1F600}.', 'u', '\u{1F600}\u{1F600}'], ['K', 'iu', 'K'], ['(\\w)\\1', 'i', 'aA'], ['a(?!b)', '', 'abac']]) {
  await check('trace agrees with the engine: /' + p + '/' + f, () => { const t = R.trace(p, f, s); return t.agree === true ? true : { match: t.match, engine: t.engine, truncated: t.truncated }; });
}
await check('trace stops at its step limit on catastrophic backtracking', () => { const t = R.trace('(a+)+$', '', 'a'.repeat(30) + '!', { maxSteps: 5000 }); return t.agree === null && /Stopped after 5000 steps/.test(t.truncated) && t.log.length > 0; });

// ---------- isolated worker with a time budget ----------
await check('a catastrophic pattern is stopped by the worker time budget and the next job still runs', async () => {
  const run = R.createRunner(() => new Worker(path.join(toolsDir, 'regex-worker.js')), { budgetMs: 400 });
  const t0 = Date.now();
  const bad = await run.run({ op: 'match', pattern: '(a+)+$', flags: '', subject: 'a'.repeat(40) + '!' });
  const took = Date.now() - t0;
  const good = await run.run({ op: 'match', pattern: 'a', flags: 'g', subject: 'banana' });
  run.dispose();
  return bad.ok === false && bad.timeout === true && took < 2000 && good.ok === true && good.result.matches.length === 3;
});
await check('growth measurement streams partial results before a timeout', async () => {
  const run = R.createRunner(() => new Worker(path.join(toolsDir, 'regex-worker.js')), { budgetMs: 1500 });
  const partial = [];
  const res = await run.run({ op: 'growth', pattern: '(a+)+$', flags: '', unit: 'a', suffix: '!', budgetMs: 1200 }, 1500, (x) => partial.push(x));
  run.dispose();
  return partial.length >= 10 && (res.ok || res.timeout) && /exponential|faster/.test(R.growthVerdict(partial));
});
await check('a newer job replaces a running one', async () => {
  const run = R.createRunner(() => new Worker(path.join(toolsDir, 'regex-worker.js')), { budgetMs: 3000 });
  const first = run.run({ op: 'match', pattern: '(a+)+$', flags: '', subject: 'a'.repeat(40) + '!' });
  const second = await run.run({ op: 'match', pattern: 'n', flags: 'g', subject: 'banana' });
  const f = await first; run.dispose();
  return f.cancelled === true && second.ok && second.result.matches.length === 2;
});
await check('worker errors come back as messages, not crashes', async () => {
  const run = R.createRunner(() => new Worker(path.join(toolsDir, 'regex-worker.js')), { budgetMs: 1000 });
  const r = await run.run({ op: 'match', pattern: '(', flags: '', subject: 'x' }); run.dispose();
  return r.ok === false && /Invalid regular expression/.test(r.error);
});

// ---------- flavours, code, library ----------
await check('conversion to Python rewrites named groups and keeps the original', () => { const src = '(?<y>\\d+)\\k<y>'; const c = R.convert(src, '', 'python'); return c.text === '(?P<y>\\d+)(?P=y)' && src === '(?<y>\\d+)\\k<y>' && c.verified === false; });
await check('conversion to Go lists lookaround and backreferences as blockers', () => { const c = R.convert('(?=a)(b)\\1', '', 'go'); return c.blockers.length === 2; });
await check('compare marks only JavaScript as executed', () => { const c = R.compare('(?<=a)b', ''); return c.flavors.js.executed === true && c.rows[0].id === 'lookbehind' && c.rows[0].cells.go.status === 'no'; });
await check('generated JavaScript compiles to the same pattern', () => { const g = R.codeFor('javascript', 'match', 'a"\\/b', 'i'); const m = /new RegExp\((.*), "(\w*)"\)/.exec(g.code); return JSON.parse(m[1]) === 'a"\\/b' && m[2] === 'i'; });
await check('generated C# uses a verbatim string with doubled quotes', () => R.codeFor('csharp', 'match', 'say "hi"', '').code.includes('@"say ""hi"""'));
await check('parameters are escaped unless marked raw', () => R.fillParams('\\b%word%\\b', { word: 'a.b' }) === '\\ba\\.b\\b' && R.fillParams('%x%', { x: '\\d+' }, { x: 'raw' }) === '\\d+');
await check('imports are validated and never executed', () => { const ok = R.validateImport({ kind: 'mvl-regex', version: 1, items: [{ pattern: 'a', flags: 'gZ', name: 'x' }] }); let bad = ''; try { R.validateImport({ kind: 'other' }); } catch (e) { bad = e.message; } return ok[0].flags === 'g' && /not a version 1/.test(bad); });

// ---------- parity ledger ----------
const ledger = JSON.parse(readFileSync(path.join(toolsDir, 'regex-parity.json'), 'utf8'));
const REQUIRED = ['construction', 'syntax-literals', 'syntax-unicode', 'syntax-classes', 'syntax-set-operations', 'syntax-anchors', 'syntax-groups', 'syntax-atomic', 'syntax-quantifiers', 'syntax-possessive', 'syntax-lookaround', 'syntax-backreferences', 'syntax-recursion', 'syntax-conditionals', 'syntax-modifiers', 'syntax-comments', 'replacement-construction', 'analysis-tree', 'analysis-selection-sync', 'analysis-export', 'flavor-selection', 'flavor-compare', 'flavor-convert', 'test-match', 'test-replace', 'test-split', 'test-captures', 'test-cases', 'test-hex-encoding', 'test-file-input', 'debug-trace', 'debug-backtracking', 'benchmark', 'benchmark-growth', 'code-generation', 'code-templates-editable', 'copy-paste-escaping', 'library', 'library-parameters', 'grep-search', 'grep-replace-backup', 'history', 'integration-external-tools', 'integration-command-line', 'help-contextual', 'keyboard-editing', 'preferences-layout', 'adjacent-builder', 'adversarial-isolation'];
await check('the parity ledger is dated and lists every required topic with a valid status and reason', () => {
  const ids = new Set(ledger.topics.map((t) => t.id));
  const missing = REQUIRED.filter((id) => !ids.has(id));
  const badRows = ledger.topics.filter((t) => !['implemented', 'partial', 'unavailable'].includes(t.status) || !t.reason || !t.source);
  return /^\d{4}-\d{2}-\d{2}$/.test(ledger.reviewed) && missing.length === 0 && badRows.length === 0 ? true : { missing, bad: badRows.map((t) => t.id) };
});
await check('ledger rows marked implemented name an implementation and a test or evidence', () => { const bad = ledger.topics.filter((t) => t.status === 'implemented' && (!t.implementation || !t.evidence)); return bad.length === 0 ? true : bad.map((t) => t.id); });
await check('removing a required ledger topic turns the ledger check red', () => { const ids = new Set(ledger.topics.filter((t) => t.id !== 'debug-trace').map((t) => t.id)); return REQUIRED.some((id) => !ids.has(id)); });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
