#!/usr/bin/env node
// count-lines.mjs: the release workflow's line counter. Counts the tracked files of the current
// commit, separated into source, tests, and styles or markup, with total and non-blank lines.
// Generated and vendored files are listed apart. Surviving lines are attributed with git blame:
// a line whose commit message carries a "Co-Authored-By: Claude" trailer counts as written by an
// agent, every other line as written by a person. Prints a Markdown table, or JSON with --json.
//   node scripts/count-lines.mjs [--json]
import { execFileSync } from 'node:child_process';
import { extname } from 'node:path';

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 });
const EXCLUDED = [/^companion\/package-lock\.json$/, /^package-lock\.json$/, /\.(woff2|png|ico|jpg|pdf)$/i, /^design\/canvases\/.*\/frames\//];
const GENERATED = [/^companion\/renderer\/shared\/schemes\.js$/, /^companion\/renderer\/shared\/m3-tokens\.css$/];
const TESTS = [/^tests\//, /\.test\.(js|mjs|ps1)$/];
const STYLE = new Set(['.css', '.html', '.xaml', '.xml']);
const SOURCE = new Set(['.ps1', '.psm1', '.js', '.mjs', '.cs', '.bat', '.cmd']);
const DOCS = new Set(['.md']);

function kind(file) {
  if (EXCLUDED.some((r) => r.test(file))) return 'excluded';
  if (GENERATED.some((r) => r.test(file))) return 'generated';
  if (TESTS.some((r) => r.test(file))) return 'tests';
  const ext = extname(file).toLowerCase();
  if (SOURCE.has(ext)) return 'source';
  if (STYLE.has(ext) || file.endsWith('.dc.html')) return 'styles and markup';
  if (DOCS.has(ext)) return 'documentation';
  return 'other';
}

// Commits whose message names Claude as a co-author.
const agentCommits = new Set();
for (const block of git(['log', '--format=%H%x00%B%x01']).split('\x01')) {
  const [sha, body] = block.trim().split('\x00');
  if (sha && /Co-Authored-By:\s*Claude/i.test(body || '')) agentCommits.add(sha.trim());
}

const rows = {};
const add = (k, f) => { rows[k] = rows[k] || { files: 0, total: 0, nonBlank: 0, agent: 0, people: 0 }; const r = rows[k]; r.files++; for (const key of Object.keys(f)) r[key] += f[key]; };
const generatedFiles = [];
for (const file of git(['ls-files']).split('\n').filter(Boolean)) {
  const k = kind(file);
  if (k === 'excluded') continue;
  let text; try { text = git(['show', 'HEAD:' + file]); } catch { continue; }
  const lines = text.split(/\r?\n/); if (lines[lines.length - 1] === '') lines.pop();
  const nonBlank = lines.filter((l) => l.trim()).length;
  let agent = 0, people = 0;
  if (lines.length) {
    for (const l of git(['blame', '--line-porcelain', '--', file]).split('\n')) {
      const m = l.match(/^([0-9a-f]{40}) \d+ \d+/); if (m) { if (agentCommits.has(m[1])) agent++; else people++; }
    }
  }
  if (k === 'generated') generatedFiles.push(file);
  add(k, { total: lines.length, nonBlank, agent, people });
}

const order = ['source', 'tests', 'styles and markup', 'documentation', 'other', 'generated'];
const project = order.filter((k) => k !== 'generated' && rows[k]).reduce((a, k) => ({ total: a.total + rows[k].total, nonBlank: a.nonBlank + rows[k].nonBlank, agent: a.agent + rows[k].agent, people: a.people + rows[k].people, files: a.files + rows[k].files }), { total: 0, nonBlank: 0, agent: 0, people: 0, files: 0 });
const grand = rows.generated ? { total: project.total + rows.generated.total, nonBlank: project.nonBlank + rows.generated.nonBlank, files: project.files + rows.generated.files } : project;
const commit = git(['rev-parse', '--short', 'HEAD']).trim();

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ commit, rows, project, grand, generatedFiles, excluded: EXCLUDED.map(String) }, null, 2));
} else {
  const fmt = (n) => n.toLocaleString('en-US');
  const out = [`Line count at \`${commit}\`, counted by \`node scripts/count-lines.mjs\`.`, '', '| Kind | Files | Lines | Non-blank | Agent lines | People lines |', '| --- | ---: | ---: | ---: | ---: | ---: |'];
  for (const k of order) if (rows[k]) { const r = rows[k]; out.push(`| ${k}${k === 'generated' ? ' (not in the project total)' : ''} | ${fmt(r.files)} | ${fmt(r.total)} | ${fmt(r.nonBlank)} | ${fmt(r.agent)} | ${fmt(r.people)} |`); }
  out.push(`| **Project total** | ${fmt(project.files)} | ${fmt(project.total)} | ${fmt(project.nonBlank)} | ${fmt(project.agent)} | ${fmt(project.people)} |`);
  out.push(`| **Grand total with generated** | ${fmt(grand.files)} | ${fmt(grand.total)} | ${fmt(grand.nonBlank)} | | |`);
  out.push('', 'Excluded: lock files, fonts, images, PDFs and design frames. Attribution rule: a surviving line belongs to an agent when `git blame` points at a commit whose message has a `Co-Authored-By: Claude` trailer, otherwise to a person.');
  console.log(out.join('\n'));
}
