// Builds the public documentation site into site/dist/.
//
//   node scripts/build-site.mjs
//
// Every docs/**/*.md file becomes a complete article or category page with stable heading
// anchors; hand-written pages come from site/pages/. Internal links and anchors are checked and
// the build fails on any broken one. Nothing on the built site fetches anything from the network.
import { Marked, Parser } from 'marked';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs');
const SITE = path.join(ROOT, 'site');
const DIST = path.join(SITE, 'dist');
const SHARED = path.join(ROOT, 'companion', 'renderer', 'shared');

export const SITE_NAME = 'Material VM Labs';
export const PDF_FILE = 'material-vm-labs-docs.pdf';
const CATEGORY_ORDER = ['getting-started', 'building', 'runners', 'reference', 'features'];
const ARTICLE_ORDER = {
  'getting-started': ['create-a-lab-machine', 'manage', 'set-up-for-you', 'linux'],
  building: ['fresh-build', 'receipts', 'installer-tests'],
  runners: ['register'],
  reference: ['cli', 'media-and-verification', 'hypervisors', 'security'],
};

// Hand-written pages. `top` pages open as tabs on a first visit, in this order.
const HAND_PAGES = [
  { out: 'index.html', file: 'home.html', title: 'Home', description: 'Throwaway Windows 11, Ubuntu and Debian lab machines for fresh-host build and installer testing.' },
  { out: 'guides.html', file: 'guides.html', title: 'Guided tasks', description: 'Interactive walkthroughs: fresh builds, installer tests, self-hosted runners and Linux lab machines.' },
  { out: 'settings.html', file: 'settings.html', title: 'Settings', description: 'Theme, motion, text size, tabs and personal vocabulary for this site.' },
];

// ---------- helpers ----------
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39);/g, (m, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e]);
export const stripTags = (html) => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
export function slugify(text) {
  return stripTags(text).toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s/g, '-');
}
const posix = path.posix;
function relHref(fromOut, toOut) {
  return posix.relative(posix.dirname(fromOut), toOut) || posix.basename(toOut);
}

// ---------- collect markdown ----------
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(path.join(dir, d.name)) : d.name.endsWith('.md') ? [path.join(dir, d.name)] : []);
}
function outFor(src) {
  if (src === 'README.md') return 'overview.html';
  if (src.endsWith('/README.md')) return src.replace(/README\.md$/, 'index.html');
  return src.replace(/\.md$/, '.html');
}
function orderKey(src) {
  const [cat, file] = src.includes('/') ? src.split('/') : ['', src];
  const c = cat ? CATEGORY_ORDER.indexOf(cat) : -1;
  const a = file === 'README.md' ? -1 : (ARTICLE_ORDER[cat] || []).indexOf(file.replace(/\.md$/, ''));
  return [c < 0 && cat ? 99 : c, a < 0 && file !== 'README.md' ? 99 : a, src];
}

// Loads and renders every markdown document. mode 'site' links between pages; mode 'pdf' links
// within one long document, so every id is prefixed with its article's id.
export function loadDocs({ mode = 'site' } = {}) {
  const sources = walk(DOCS).map((f) => path.relative(DOCS, f).split(path.sep).join('/'));
  sources.sort((a, b) => {
    const x = orderKey(a), y = orderKey(b);
    return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2]);
  });
  const docs = sources.map((src) => ({ src, out: outFor(src), pid: outFor(src).replace(/\.html$/, '').replace(/[/]/g, '-') }));
  const bySrc = new Map(docs.map((d) => [d.src, d]));
  const links = [];
  let current = null;
  let used = new Map();

  const resolve = (href) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return href;
    const [p, hash] = href.split('#');
    if (!p) {
      links.push({ from: current, to: current, hash });
      return mode === 'pdf' ? `#${current.pid}--${hash}` : `#${hash}`;
    }
    const target = bySrc.get(posix.normalize(posix.join(posix.dirname(current.src), p)));
    if (!target) { links.push({ from: current, missing: href }); return href; }
    links.push({ from: current, to: target, hash });
    if (mode === 'pdf') return `#${target.pid}${hash ? '--' + hash : ''}`;
    return relHref(current.out, target.out) + (hash ? '#' + hash : '');
  };

  const md = new Marked();
  md.use({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        let id = slugify(inner);
        const n = used.get(id) || 0;
        used.set(id, n + 1);
        if (n) id += '-' + n;
        current.ids.add(id);
        const full = mode === 'pdf' ? `${current.pid}--${id}` : id;
        if (depth === 1) return `<h1 id="${full}">${inner}</h1>\n`;
        const anchor = mode === 'pdf' ? '' : `<a class="anchor" href="#${full}" aria-label="Link to this section: ${esc(stripTags(inner))}">#</a>`;
        return `<h${depth} id="${full}">${inner}${anchor}</h${depth}>\n`;
      },
    },
  });

  for (const d of docs) {
    current = d; used = new Map(); d.ids = new Set();
    const text = fs.readFileSync(path.join(DOCS, d.src), 'utf8');
    const tokens = md.lexer(text);
    const h1 = tokens.find((t) => t.type === 'heading' && t.depth === 1);
    d.title = h1 ? h1.text.replace(/`/g, '') : d.src;
    const para = tokens.find((t) => t.type === 'paragraph');
    d.summary = para ? stripTags(md.parseInline(para.text)) : '';
    d.isCategory = d.src.endsWith('README.md');
    d.category = d.src.includes('/') ? d.src.split('/')[0] : '';
    d.cards = d.isCategory && d.category ? categoryCards(md, tokens) : null;
    md.walkTokens(tokens, (t) => { if (t.type === 'link') t.href = resolve(t.href); });
    d.html = md.parser(tokens)
      .replace(/<table>/g, '<div class="table-wrap" role="region" tabindex="0" aria-label="Table, scrolls sideways"><table>')
      .replace(/<\/table>/g, '</table></div>');
    if (!d.cards && d.isCategory && d.category) throw new Error(`${d.src}: expected a list of articles`);
  }
  // A category's README lists its articles; that list is shown as cards instead.
  for (const d of docs.filter((x) => x.cards)) {
    d.html = d.html.replace(/<ul>[\s\S]*?<\/ul>/, '<!--cards-->');
    d.summary = `${d.cards.length} article${d.cards.length === 1 ? '' : 's'}: ${d.cards.map((c) => c.text).join(', ')}.`;
  }

  const errors = [];
  for (const l of links) {
    if (l.missing) { errors.push(`${l.from.src}: link to ${l.missing} does not resolve to a document`); continue; }
    if (l.hash && !l.to.ids.has(l.hash)) errors.push(`${l.from.src}: anchor #${l.hash} not found in ${l.to.src}`);
  }
  if (errors.length) throw new Error('Broken documentation links:\n  ' + errors.join('\n  '));
  return docs;
}

function categoryCards(md, tokens) {
  const list = tokens.find((t) => t.type === 'list');
  if (!list) return null;
  return list.items.map((item) => {
    const para = item.tokens.find((t) => t.type === 'text' || t.type === 'paragraph');
    const inline = para && para.tokens ? para.tokens : [];
    const link = inline.find((t) => t.type === 'link');
    if (!link) return null;
    const rest = inline.slice(inline.indexOf(link) + 1);
    const desc = Parser.parseInline(rest, md.defaults).replace(/^\s*:\s*/, '').replace(/^(<code>)?([a-z])/, (m, c, l) => (c || '') + (c ? l : l.toUpperCase()));
    return { text: link.text, rawHref: link.href, desc };
  }).filter(Boolean);
}

// ---------- page shell ----------
function rail(docs, currentOut, root) {
  const cur = (o) => (o === currentOut ? ' aria-current="page"' : '');
  const a = (o, label, cls = '') => `<a href="${root}${o}"${cur(o)}${cls ? ` class="${cls}"` : ''}>${esc(label)}</a>`;
  let h = `<ul class="rail-list"><li>${a('index.html', 'Home')}</li><li>${a('guides.html', 'Guided tasks')}</li><li>${a('overview.html', 'All documentation')}</li>`;
  for (const cat of CATEGORY_ORDER) {
    const index = docs.find((d) => d.src === `${cat}/README.md`);
    if (!index) continue;
    const kids = docs.filter((d) => d.category === cat && !d.isCategory);
    const open = currentOut.startsWith(cat + '/');
    h += `<li class="rail-cat${open ? ' open' : ''}">${a(index.out, index.title, 'rail-cat-link')}<ul>${kids.map((k) => `<li>${a(k.out, k.title)}</li>`).join('')}</ul></li>`;
  }
  h += `<li>${a('settings.html', 'Settings')}</li></ul>`;
  return h;
}

function shell({ out, title, description, body, docs, tops, kind, version, repo }) {
  const root = '../'.repeat(out.split('/').length - 1);
  const pageTitle = out === 'index.html' ? `${SITE_NAME} documentation` : `${title} | ${SITE_NAME}`;
  const tabs = tops.map((t) => `<li class="tab${t.out === out ? ' active' : ''}" data-key="${t.out}"><a href="${root}${t.out}"${t.out === out ? ' aria-current="page"' : ''}>${esc(t.title)}</a></li>`).join('');
  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(pageTitle)}</title>
<meta name="description" content="${esc(description)}">
<meta name="color-scheme" content="light dark">
${repo ? `<meta name="mvl-repo" content="${esc(repo)}">\n` : ''}<link rel="icon" href="${root}assets/favicon.svg" type="image/svg+xml">
<script>${PREPAINT}</script>
<link rel="stylesheet" href="${root}shared/m3-tokens.css">
<link rel="stylesheet" href="${root}assets/site.css">
</head>
<body data-page="${out}" data-root="${root}" data-kind="${kind}">
<a class="skip" href="#main">Skip to content</a>
<header class="topbar">
  <div class="topbar-row">
    <button type="button" class="icon-btn menu-btn" aria-expanded="false" aria-controls="rail" aria-label="Documentation menu"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg></button>
    <a class="brand" href="${root}index.html"><span class="brand-mark" aria-hidden="true"></span><span class="brand-name">${SITE_NAME}</span></a>
    <div class="search" role="search">
      <div class="search-field">
        <svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>
        <input id="q" type="search" autocomplete="off" spellcheck="false" placeholder="Search the documentation" aria-label="Search the documentation" role="combobox" aria-expanded="false" aria-controls="search-results" aria-autocomplete="list">
        <button type="button" class="chip regex-toggle" aria-pressed="false" aria-controls="regex-builder" title="Regular expression search">.*<span class="sr"> Regex mode</span></button>
      </div>
      <div id="regex-builder" class="regex-builder" hidden>
        <div class="regex-head"><span class="label">Regex builder</span><span class="regex-status" role="status" aria-live="polite"></span></div>
        <div class="regex-flags" role="group" aria-label="Flags">
          <button type="button" class="chip" data-flag="i" aria-pressed="true">i <span>ignore case</span></button>
          <button type="button" class="chip" data-flag="m" aria-pressed="false">m <span>multiline</span></button>
          <button type="button" class="chip" data-flag="s" aria-pressed="false">s <span>dot matches all</span></button>
          <button type="button" class="chip" data-flag="u" aria-pressed="true">u <span>unicode</span></button>
        </div>
        <div class="regex-tokens" role="group" aria-label="Insert a token">
          <button type="button" class="chip" data-token="\\b" title="Word boundary">\\b</button>
          <button type="button" class="chip" data-token="\\d+" title="One or more digits">\\d+</button>
          <button type="button" class="chip" data-token="\\w+" title="One or more word characters">\\w+</button>
          <button type="button" class="chip" data-token="\\s" title="Whitespace">\\s</button>
          <button type="button" class="chip" data-token="." title="Any character">.</button>
          <button type="button" class="chip" data-token=".*" title="Anything">.*</button>
          <button type="button" class="chip" data-token="(a|b)" title="Either alternative">(a|b)</button>
          <button type="button" class="chip" data-token="[abc]" title="Any of these characters">[abc]</button>
          <button type="button" class="chip" data-token="^" title="Start of text">^</button>
          <button type="button" class="chip" data-token="$" title="End of text">$</button>
          <button type="button" class="chip" data-token="?" title="Optional">?</button>
          <button type="button" class="chip" data-token="--\\w+" title="Any option such as --json">--\\w+</button>
        </div>
      </div>
      <div id="search-results" class="search-results" role="listbox" aria-label="Search results" hidden></div>
    </div>
    <button type="button" class="icon-btn palette-btn" aria-label="Command palette (Ctrl+Shift+F)" title="Command palette (Ctrl+Shift+F)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h9M5 17h5"/><path d="m17 14 3 3-3 3"/></svg></button>
    <button type="button" class="icon-btn theme-btn" aria-label="Theme" title="Theme"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" class="fill"/></svg></button>
  </div>
  <nav class="tabstrip" aria-label="Open pages">
    <ul class="tabs">${tabs}</ul>
    <button type="button" class="text-btn open-all">Open every tab</button>
  </nav>
</header>
<div class="layout">
  <nav id="rail" class="rail" aria-label="Documentation">${rail(docs, out, root)}</nav>
  <main id="main" tabindex="-1">
${body}
  </main>
</div>
<footer class="footer">
  <p>${SITE_NAME} ${esc(version)}. Static documentation: nothing on this site is fetched from the network, and settings stay in this browser.</p>
  <p><a href="${root}${PDF_FILE}">PDF edition</a> <span aria-hidden="true">·</span> <a href="${root}settings.html">Settings</a><span class="repo-links" hidden> <span aria-hidden="true">·</span> <a data-repo-link="" href="#">Source</a> <span aria-hidden="true">·</span> <a data-repo-link="releases" href="#">Releases</a></span></p>
</footer>
<dialog class="palette" aria-label="Command palette">
  <div class="palette-field"><input type="text" class="palette-input" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list" aria-label="Search pages, headings and settings" placeholder="Search pages, headings and settings" autocomplete="off" spellcheck="false"></div>
  <ul id="palette-list" class="palette-list" role="listbox" aria-label="Results"></ul>
  <p class="palette-hint"><kbd>Up</kbd> <kbd>Down</kbd> to move, <kbd>Enter</kbd> to open or apply, <kbd>Esc</kbd> to close</p>
</dialog>
<div class="toast" role="status" aria-live="polite"></div>
<script src="${root}shared/vocab.js"></script>
<script src="${root}assets/search-index.js"></script>
<script src="${root}assets/app.js"></script>
<script src="${root}assets/demos.js"></script>
</body>
</html>
`;
}

// Applied before first paint so the saved theme, motion and text size never flash.
const PREPAINT = `(function(){try{var s=JSON.parse(localStorage.getItem('mvl-site-settings')||'{}');var d=document.documentElement;var t=s.theme||'system';if(t==='system')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';d.setAttribute('data-theme',t);if(s.motion==='reduced')d.setAttribute('data-reduce-motion','true');else if(s.motion==='full')d.setAttribute('data-reduce-motion','false');if(s.textSize)d.style.fontSize=s.textSize+'%';}catch(e){}})();`;

function articleBody(d, docs, root) {
  const cat = docs.find((x) => x.src === `${d.category}/README.md`);
  const crumbs = [`<a href="${root}overview.html">Documentation</a>`];
  if (cat && cat !== d) crumbs.push(`<a href="${relHref(d.out, cat.out)}">${esc(cat.title)}</a>`);
  const toc = [...d.html.matchAll(/<h([23]) id="([^"]+)">([\s\S]*?)(<a class="anchor"|<\/h\1>)/g)]
    .map((m) => `<li class="toc-h${m[1]}"><a href="#${m[2]}">${esc(stripTags(m[3]))}</a></li>`);
  const words = stripTags(d.html).split(' ').length;
  const siblings = docs.filter((x) => x.category === d.category && !x.isCategory);
  const i = siblings.indexOf(d);
  const pn = [siblings[i - 1], siblings[i + 1]];
  const nav = pn.some(Boolean) ? `<nav class="prevnext" aria-label="More in ${esc(cat ? cat.title : 'this section')}">${pn[0] ? `<a class="pn prev" href="${relHref(d.out, pn[0].out)}"><span>Previous</span>${esc(pn[0].title)}</a>` : '<span></span>'}${pn[1] ? `<a class="pn next" href="${relHref(d.out, pn[1].out)}"><span>Next</span>${esc(pn[1].title)}</a>` : ''}</nav>` : '';
  return `<div class="article-layout">
<article class="article">
<p class="crumbs">${crumbs.join(' <span aria-hidden="true">/</span> ')}</p>
<p class="meta">${Math.max(1, Math.round(words / 200))} min read</p>
${d.html}
${nav}
</article>
${toc.length > 1 ? `<aside class="toc" aria-label="On this page"><p class="label">On this page</p><ul>${toc.join('')}</ul></aside>` : ''}
</div>`;
}

function categoryBody(d, docs, root) {
  const cards = d.cards.map((c, i) => {
    const target = docs.find((x) => x.src === posix.normalize(posix.join(posix.dirname(d.src), c.rawHref)));
    const heads = [...target.html.matchAll(/<h2 id="([^"]+)">([\s\S]*?)<a class="anchor"/g)].slice(0, 4)
      .map((m) => `<li><a href="${relHref(d.out, target.out)}#${m[1]}">${esc(stripTags(m[2]))}</a></li>`).join('');
    return `<li class="doc-card" style="--i:${i}"><a class="doc-card-main" href="${relHref(d.out, target.out)}"><span class="doc-card-num">${String(i + 1).padStart(2, '0')}</span><h2>${esc(target.title)}</h2><p>${c.desc}</p></a>${heads ? `<ul class="doc-card-heads" aria-label="Sections in ${esc(target.title)}">${heads}</ul>` : ''}</li>`;
  }).join('');
  const html = d.html.replace('<!--cards-->', `<ul class="doc-cards">${cards}</ul>`);
  return `<article class="article category"><p class="crumbs"><a href="${root}overview.html">Documentation</a></p>${html}</article>`;
}

function overviewBody(d, docs) {
  const groups = CATEGORY_ORDER.map((cat) => docs.find((x) => x.src === `${cat}/README.md`)).filter(Boolean).map((c, i) => {
    const kids = docs.filter((x) => x.category === c.category && !x.isCategory);
    return `<li class="doc-card" style="--i:${i}"><a class="doc-card-main" href="${relHref(d.out, c.out)}"><span class="doc-card-num">${String(i + 1).padStart(2, '0')}</span><h2>${esc(c.title)}</h2><p>${kids.length} article${kids.length === 1 ? '' : 's'}</p></a><ul class="doc-card-heads">${kids.map((k) => `<li><a href="${relHref(d.out, k.out)}">${esc(k.title)}</a></li>`).join('')}</ul></li>`;
  }).join('');
  return `<article class="article category">${d.html}<h2 id="every-section">Every section<a class="anchor" href="#every-section" aria-label="Link to this section: Every section">#</a></h2><ul class="doc-cards">${groups}</ul><p class="pdf-note">Prefer to read offline? The <a href="${PDF_FILE}">PDF edition</a> holds every article, sized for a phone screen, with a tappable table of contents.</p></article>`;
}

// Splits rendered HTML into searchable sections at each h2/h3.
function sections(html, url, pageTitle) {
  const re = /<h([23]) id="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g;
  const out = [];
  let last = { id: '', heading: pageTitle, start: 0 };
  let m;
  const push = (end) => {
    const text = stripTags(html.slice(last.start, end)).replace(/#$/, '').trim();
    if (text || last.id) out.push({ url, id: last.id, heading: last.heading, text });
  };
  while ((m = re.exec(html))) {
    push(m.index);
    last = { id: m[2], heading: stripTags(m[3]).replace(/\s*#$/, ''), start: m.index + m[0].length };
  }
  push(html.length);
  return out;
}

// ---------- main ----------
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const d of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, d.name), b = path.join(to, d.name);
    if (d.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}

export function build() {
  const docs = loadDocs({ mode: 'site' });
  const version = fs.existsSync(path.join(ROOT, 'VERSION')) ? fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim() : '';
  const repo = /^[\w.-]+\/[\w.-]+$/.test(process.env.GITHUB_REPOSITORY || '') ? process.env.GITHUB_REPOSITORY : '';
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  const overview = docs.find((d) => d.src === 'README.md');
  const tops = [
    { out: 'index.html', title: 'Home' },
    { out: 'guides.html', title: 'Guided tasks' },
    overview && { out: overview.out, title: 'All documentation' },
    ...CATEGORY_ORDER.map((c) => docs.find((d) => d.src === `${c}/README.md`)).filter(Boolean).map((d) => ({ out: d.out, title: d.title })),
    { out: 'settings.html', title: 'Settings' },
  ].filter(Boolean);

  const index = { pages: [], sections: [], tops: tops.map((t) => t.out) };
  const write = (out, html) => { const f = path.join(DIST, out); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, html); };
  const hrefs = new Map();

  for (const p of HAND_PAGES) {
    const body = fs.readFileSync(path.join(SITE, 'pages', p.file), 'utf8').replaceAll('{{pdf}}', PDF_FILE).replaceAll('{{version}}', esc(version));
    write(p.out, shell({ out: p.out, title: p.title, description: p.description, body, docs, tops, kind: 'page', version, repo }));
    index.pages.push({ url: p.out, title: p.title, kind: 'page', summary: p.description });
    index.sections.push(...sections(body, p.out, p.title));
    hrefs.set(p.out, body);
  }
  for (const d of docs) {
    const root = '../'.repeat(d.out.split('/').length - 1);
    const body = d === overview ? overviewBody(d, docs) : d.cards ? categoryBody(d, docs, root) : articleBody(d, docs, root);
    const title = d === overview ? 'All documentation' : d.title;
    write(d.out, shell({ out: d.out, title, description: d.summary || title, body, docs, tops, kind: d.cards || d === overview ? 'category' : 'article', version, repo }));
    const cat = docs.find((x) => x.src === `${d.category}/README.md`);
    index.pages.push({ url: d.out, title, kind: d.cards ? 'category' : d === overview ? 'category' : 'article', crumb: cat && cat !== d ? cat.title : 'Documentation', summary: d.summary });
    index.sections.push(...sections(d.html, d.out, title));
    hrefs.set(d.out, body);
  }

  // Check every link in hand-written pages too (relative to the page).
  const errors = [];
  const allIds = new Map([...hrefs].map(([out, html]) => [out, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))]));
  for (const [out, html] of hrefs) {
    for (const m of html.matchAll(/href="([^"]+)"/g)) {
      const href = m[1];
      if (/^([a-z]+:|#$)/i.test(href) || href === PDF_FILE || href.endsWith('/' + PDF_FILE)) continue;
      const [p, hash] = href.split('#');
      let target = p ? posix.normalize(posix.join(posix.dirname(out), p)) : out;
      if (target.endsWith('/') || target === '.') target = (target === '.' ? '' : target) + 'index.html';
      if (!allIds.has(target)) { errors.push(`${out}: ${href} is not a page`); continue; }
      if (hash && !allIds.get(target).has(hash)) errors.push(`${out}: ${href} has no matching anchor`);
    }
  }
  if (errors.length) throw new Error('Broken site links:\n  ' + errors.join('\n  '));

  // Assets: Material 3 tokens, bundled fonts and the vocabulary script come from the companion.
  fs.mkdirSync(path.join(DIST, 'shared'), { recursive: true });
  fs.copyFileSync(path.join(SHARED, 'm3-tokens.css'), path.join(DIST, 'shared', 'm3-tokens.css'));
  fs.copyFileSync(path.join(SHARED, 'vocab.js'), path.join(DIST, 'shared', 'vocab.js'));
  copyDir(path.join(SHARED, 'fonts'), path.join(DIST, 'shared', 'fonts'));
  copyDir(path.join(SITE, 'assets'), path.join(DIST, 'assets'));
  // Images and other non-Markdown files under docs/ keep their relative paths, so an article's
  // relative image links work unchanged (pages mirror the docs/ folder layout).
  (function copyDocFiles(dir) {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) copyDocFiles(p);
      else if (!d.name.endsWith('.md')) { const to = path.join(DIST, path.relative(DOCS, p)); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(p, to); }
    }
  })(DOCS);
  fs.writeFileSync(path.join(DIST, 'assets', 'search-index.js'), `window.MVL_INDEX=${JSON.stringify(index)};\n`);
  fs.writeFileSync(path.join(DIST, '.nojekyll'), '');
  return { pages: index.pages.length, sections: index.sections.length };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = build();
  console.log(`Built ${r.pages} pages and ${r.sections} searchable sections into ${path.relative(ROOT, DIST)}/`);
}
