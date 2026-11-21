// prepare.mjs: build-time asset generation for both companions.
//  1. generated/docs.json: every Markdown file under docs/ plus README.md, HANDOFF.md, ROADMAP.md and CHANGELOG.md, rendered to HTML.
//  2. generated/source.bundle.json and source-manifest.json: the complete tracked source of the exact commit with per-file SHA-256.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';

const here = dirname(fileURLToPath(import.meta.url));
const companion = join(here, '..');
const repo = join(companion, '..');
const out = join(companion, 'generated');
mkdirSync(out, { recursive: true });
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const version = readFileSync(join(repo, 'VERSION'), 'utf8').trim();

// A card summary: the first plain paragraph, or for a list-only index article the list's link
// texts; Markdown links become their text; cut at a sentence end or a word, never mid-word.
function summarize(md) {
  const plain = (s) => s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
  const blocks = md.replace(/^#.*$/gm, '').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  let s = blocks.find((b) => !/^[#>|`\-*]|^\d+\./.test(b)) || '';
  if (!s) {
    const items = md.split('\n').map((l) => l.match(/^\s*[-*]\s+(.*)$/)).filter(Boolean).map((m) => plain(m[1]).replace(/[:.].*$/, ''));
    s = items.length ? items.join(' · ') : '';
  }
  s = plain(s);
  if (s.length <= 220) return s;
  const cut = s.slice(0, 220);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (end > 80) return cut.slice(0, end + 1);
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:]$/, '') + ' …';
}

// ---------- source bundle ----------
function gitOut(args) { return execFileSync('git', ['-C', repo, ...args], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }); }
let commit = 'unknown';
let commitUtc = null; // when the source was committed, so the apps say "updated" rather than "built"
let files = [];
try {
  commit = gitOut(['rev-parse', 'HEAD']).toString().trim();
  try { const s = Number(gitOut(['log', '-1', '--format=%ct', 'HEAD']).toString().trim()); if (s > 0) commitUtc = new Date(s * 1000).toISOString(); } catch { /* no commit time: the apps fall back to the build time */ }
  const names = gitOut(['ls-files', '-z']).toString('utf8').split('\0').filter(Boolean);
  for (const n of names) {
    if (n.startsWith('companion/generated/')) continue;
    let data;
    try { data = gitOut(['cat-file', 'blob', `HEAD:${n}`]); } catch { continue; } // tracked but not in HEAD yet
    files.push({ path: n, data });
  }
} catch {
  const mpath = join(repo, 'source-manifest.json');
  if (!existsSync(mpath)) throw new Error('no Git history and no source-manifest.json: cannot embed the source');
  const m = JSON.parse(readFileSync(mpath, 'utf8'));
  commit = m.commit || 'unknown';
  commitUtc = typeof m.commitUtc === 'string' && !Number.isNaN(Date.parse(m.commitUtc)) ? m.commitUtc : null;
  files = [];
  for (const f of m.files) {
    const data = readFileSync(join(repo, f.path));
    if (sha(data) !== f.sha256) throw new Error(`source-manifest hash mismatch for ${f.path}`);
    files.push({ path: f.path, data });
  }
}
files = files.filter((f) => f.path !== 'source-manifest.json');
const manifest = {
  product: 'material-vm-labs', version, commit, commitUtc, generatedUtc: new Date().toISOString(),
  files: files.map((f) => ({ path: f.path, sha256: sha(f.data), size: f.data.length }))
};
const bundle = { manifest, files: Object.fromEntries(files.map((f) => [f.path, f.data.toString('base64')])) };
writeFileSync(join(out, 'source-manifest.json'), JSON.stringify(manifest, null, 2));
writeFileSync(join(out, 'source.bundle.json'), JSON.stringify(bundle));
console.log(`prepare: embedded ${files.length} tracked files of commit ${commit}`);

// ---------- docs ----------
const slug = (s) => String(s).toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');
const pretty = (s) => s.replace(/[-_]+/g, ' ').replace(/\b\p{L}/gu, (c) => c.toUpperCase());
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

function collect(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) collect(p, acc);
    // A <name>.yue.md Cantonese twin is shown only on the documentation site, not as an article here.
    else if (/\.(md|markdown)$/i.test(e.name) && !/\.yue\.md$/i.test(e.name)) acc.push(p);
  }
  return acc;
}
const rel = (p) => relative(repo, p).split('\\').join('/');
const paths = [...collect(join(repo, 'docs'))];
for (const n of ['README.md', 'HANDOFF.md', 'ROADMAP.md', 'CHANGELOG.md']) if (existsSync(join(repo, n))) paths.push(join(repo, n));
const ids = new Set(paths.map(rel));

function render(id, md) {
  const dir = posix.dirname(id);
  const base = dir === '.' ? '' : dir;
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        return `<h${depth} id="${slug(text)}">${text}</h${depth}>\n`;
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const t = title ? ` title="${esc(title)}"` : '';
        if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return `<a href="${esc(href)}" class="external" rel="noreferrer"${t}>${text}</a>`;
        const [pathPart, anchor] = href.split('#');
        const a = anchor ? `?a=${encodeURIComponent(anchor)}` : '';
        if (!pathPart) return `<a href="#/doc/${encodeURIComponent(id)}${a}"${t}>${text}</a>`;
        const target = posix.normalize(posix.join(base, decodeURI(pathPart)));
        if (ids.has(target)) return `<a href="#/doc/${encodeURIComponent(target)}${a}"${t}>${text}</a>`;
        const readme = posix.join(target, 'README.md');
        if (ids.has(readme)) return `<a href="#/doc/${encodeURIComponent(readme)}"${t}>${text}</a>`;
        return `<a class="dead-link" title="Not bundled: ${esc(target)}">${text}</a>`;
      },
      image({ href, title, text }) {
        const target = posix.normalize(posix.join(base, decodeURI(href)));
        const full = join(repo, target);
        const type = mime[extname(target).toLowerCase()];
        if (!/^[a-z][a-z0-9+.-]*:/i.test(href) && type && existsSync(full) && statSync(full).size < 3 * 1024 * 1024) {
          return `<img src="data:${type};base64,${readFileSync(full).toString('base64')}" alt="${esc(text || '')}"${title ? ` title="${esc(title)}"` : ''}>`;
        }
        return `<span class="missing-image">[image not bundled: ${esc(text || href)}]</span>`;
      }
    }
  });
  return marked.parse(md);
}

const docs = [];
for (const p of paths) {
  const id = rel(p);
  const md = readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
  const html = render(id, md);
  const h1 = /^#\s+(.+)$/m.exec(md);
  const parts = id.split('/');
  let category = 'Project';
  let categoryKey = '_root';
  if (parts[0] === 'docs') {
    if (parts.length === 2) { category = 'General'; categoryKey = '_general'; }
    else { categoryKey = parts[1]; category = pretty(parts[1]); }
  }
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const isIndex = /(^|\/)readme\.md$/i.test(id) && parts[0] === 'docs';
  docs.push({ id, title: h1 ? h1[1].replace(/[*_`]/g, '') : pretty(posix.basename(id).replace(/\.\w+$/, '')), category, categoryKey, isIndex, summary: summarize(md), html, text });
}
docs.sort((a, b) => a.categoryKey.localeCompare(b.categoryKey) || (Number(b.isIndex) - Number(a.isIndex)) || a.title.localeCompare(b.title));
writeFileSync(join(out, 'docs.json'), JSON.stringify({ version, commit, commitUtc, generatedUtc: manifest.generatedUtc, docs }));
console.log(`prepare: rendered ${docs.length} Markdown documents`);
