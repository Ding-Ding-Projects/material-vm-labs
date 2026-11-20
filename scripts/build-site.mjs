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
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs');
const SITE = path.join(ROOT, 'site');
const DIST = path.join(SITE, 'dist');
const SHARED = path.join(ROOT, 'companion', 'renderer', 'shared');

export const SITE_NAME = 'Material VM Labs';
export const PDF_FILE = 'material-vm-labs-docs.pdf';
// The public repository; GITHUB_REPOSITORY overrides it when the site is built in a fork.
const DEFAULT_REPO = 'Ding-Ding-Projects/material-vm-labs';
// Link previews: the shared-link picture is the root social-preview.png (made by
// scripts/make-social-preview.mjs), served under a content-hashed name so a changed picture gets a new URL.
const THEME_COLOR = '#6750A4';
const PREVIEW_ALT = 'Material VM Labs: the manager app showing lab machines, beside the title Throwaway lab machines for fresh-host builds.';
function pngSize(buf) {
  if (buf.length < 24 || buf.toString('ascii', 1, 4) !== 'PNG') throw new Error('social-preview.png is not a PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
// Version, commit and commit time of the source the site is built from, for the home page.
function provenance(version) {
  let commit = process.env.GITHUB_SHA || '', when = '';
  try { if (!commit) commit = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { commit = ''; }
  try { if (commit) when = execFileSync('git', ['-C', ROOT, 'show', '-s', '--format=%cI', commit], { encoding: 'utf8' }).trim(); } catch { when = ''; }
  const iso = when ? new Date(when).toISOString() : '';
  const shown = iso ? iso.replace('T', ' ').replace(/\.\d+Z$/, ' UTC') : '';
  const parts = [`Version <b>${esc(version || 'unavailable')}</b>`];
  if (/^[0-9a-f]{40}$/.test(commit)) parts.push(`commit <b>${commit.slice(0, 7)}</b>`);
  parts.push(iso ? `updated <time datetime="${iso}" data-local-time>${shown}</time>` : 'update time unavailable');
  return `<p class="cta-note site-provenance" data-provenance>${parts.join(' · ')}</p>`;
}
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
  { out: 'changelog.html', file: null, title: 'Changelog', description: 'What changed in each version of Material VM Labs.' },
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
// One icon family: 24 px grid, 2 px round strokes.
const ICONS = {
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  theme: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" class="fill"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 19h16"/>',
  docs: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  chev: '<path d="M7 10l5 5 5-5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  warn: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4M12 17h.01"/>',
  github: '<path d="M9 19c-4 1.3-4-2-6-2.5M15 21v-3.4a3 3 0 0 0-.8-2.3c2.7-.3 5.6-1.3 5.6-6a4.6 4.6 0 0 0-1.3-3.2 4.3 4.3 0 0 0-.1-3.2s-1-.3-3.4 1.3a11.6 11.6 0 0 0-6 0C6.6 2.6 5.6 2.9 5.6 2.9a4.3 4.3 0 0 0-.1 3.2A4.6 4.6 0 0 0 4.2 9.3c0 4.6 2.8 5.7 5.5 6a3 3 0 0 0-.8 2.2V21"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
};
export const icon = (name, cls = '') => `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

function rail(docs, currentOut, root, links) {
  const cur = (o) => (o === currentOut ? ' aria-current="page"' : '');
  const a = (o, label, cls = '') => `<a href="${root}${o}"${cur(o)}${cls ? ` class="${cls}"` : ''}>${esc(label)}</a>`;
  let h = `<div class="rail-site"><p class="rail-label">Material VM Labs</p><ul class="rail-list"><li>${a('index.html', 'Home')}</li><li><a href="${root}index.html#features">Features</a></li><li><a href="${root}index.html#how">How it works</a></li><li>${a('changelog.html', 'Changelog')}</li><li><a href="${esc(links.repo)}">GitHub</a></li></ul><a class="m3-btn filled large rail-dl" href="${esc(links.download)}">${icon('download')}Download for Windows</a></div>`;
  h += `<p class="rail-label">Documentation</p><ul class="rail-list"><li>${a('guides.html', 'Guided tasks')}</li><li>${a('overview.html', 'All documentation')}</li>`;
  for (const cat of CATEGORY_ORDER) {
    const index = docs.find((d) => d.src === `${cat}/README.md`);
    if (!index) continue;
    const kids = docs.filter((d) => d.category === cat && !d.isCategory);
    const open = currentOut.startsWith(cat + '/');
    h += `<li class="rail-cat${open ? ' open' : ''}">${a(index.out, index.title, 'rail-cat-link')}${kids.length ? `<ul>${kids.map((k) => `<li>${a(k.out, k.title)}</li>`).join('')}</ul>` : ''}</li>`;
  }
  h += `<li>${a('settings.html', 'Settings')}</li></ul>`;
  return h;
}

function shell({ out, title, description, body, docs, tops, kind, version, links, layout = 'docs' }) {
  const root = '../'.repeat(out.split('/').length - 1);
  const pageTitle = out === 'index.html' ? `${SITE_NAME}: throwaway lab machines for fresh-host builds` : `${title} | ${SITE_NAME}`;
  const tabs = tops.map((t) => `<li class="tab${t.out === out ? ' active' : ''}" data-key="${t.out}"><a href="${root}${t.out}"${t.out === out ? ' aria-current="page"' : ''}>${esc(t.title)}</a></li>`).join('');
  const section = out === 'index.html' ? 'home' : out === 'changelog.html' ? 'changelog' : 'docs';
  const navCur = (k) => (k === section ? ' aria-current="page"' : '');
  const landing = layout === 'landing';
  const foot = (o, label) => `<a href="${root}${o}">${esc(label)}</a>`;
  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(pageTitle)}</title>
<meta name="description" content="${esc(description)}">
<meta name="color-scheme" content="light dark">
<meta name="mvl-repo" content="${esc(links.repoName)}">
<meta name="theme-color" content="${THEME_COLOR}">
<meta property="og:type" content="${out === 'index.html' ? 'website' : 'article'}">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:title" content="${esc(pageTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(links.siteUrl + (out === 'index.html' ? '' : out))}">
<meta property="og:image" content="${esc(links.siteUrl + links.preview.path)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="${links.preview.width}">
<meta property="og:image:height" content="${links.preview.height}">
<meta property="og:image:alt" content="${esc(PREVIEW_ALT)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(pageTitle)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(links.siteUrl + links.preview.path)}">
<meta name="twitter:image:alt" content="${esc(PREVIEW_ALT)}">
<link rel="canonical" href="${esc(links.siteUrl + (out === 'index.html' ? '' : out))}">
<link rel="icon" href="${root}assets/favicon.svg" type="image/svg+xml">
<script>${PREPAINT}</script>
<link rel="stylesheet" href="${root}shared/m3-tokens.css">
<link rel="stylesheet" href="${root}assets/site.css">
${landing ? `<link rel="stylesheet" href="${root}assets/landing.css">\n` : ''}${out === 'index.html' ? `<script src="${root}assets/provenance.js" defer></script>\n` : ''}</head>
<body data-page="${out}" data-root="${root}" data-kind="${kind}" data-layout="${layout}">
<a class="skip" href="#main">Skip to content</a>
<header class="topbar">
  <div class="topbar-row">
    <button type="button" class="icon-btn menu-btn" aria-expanded="false" aria-controls="rail" aria-label="Menu">${icon('menu')}</button>
    <a class="brand" href="${root}index.html">${SITE_NAME}</a>
    <nav class="sitenav" aria-label="Site">
      <a href="${root}index.html#features">Features</a>
      <a href="${root}overview.html"${navCur('docs')}>Docs</a>
      <a href="${root}index.html#download">Download</a>
      <a href="${root}changelog.html"${navCur('changelog')}>Changelog</a>
      <a href="${esc(links.repo)}">GitHub</a>
    </nav>
    <div class="search" role="search">
      <div class="search-field">
        ${icon('search', 'search-icon')}
        <input id="q" type="search" autocomplete="off" spellcheck="false" placeholder="Search the docs" aria-label="Search the documentation" role="combobox" aria-expanded="false" aria-controls="search-results" aria-autocomplete="list">
        <button type="button" class="regex-toggle" aria-pressed="false" aria-controls="regex-builder" title="Regular expression search">.*<span class="sr"> Regex mode</span></button>
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
    <button type="button" class="icon-btn search-btn" aria-expanded="false" aria-label="Search the docs">${icon('search')}</button>
    <button type="button" class="palette-btn" aria-label="Commands and settings (Ctrl+Shift+F)" title="Commands and settings (Ctrl+Shift+F)">${icon('keyboard')}<span class="palette-label">Commands</span><kbd>Ctrl+Shift+F</kbd></button>
    <button type="button" class="icon-btn theme-btn" aria-label="Theme" title="Theme">${icon('theme')}</button>
    <a class="m3-btn filled dl-btn" href="${esc(links.download)}">${icon('download')}Download</a>
  </div>
  <nav class="tabstrip" aria-label="Open pages">
    <ul class="tabs">${tabs}</ul>
    <button type="button" class="text-btn open-all">Open every tab</button>
  </nav>
</header>
${landing
    ? `<nav id="rail" class="rail drawer-only" aria-label="Site and documentation">${rail(docs, out, root, links)}</nav>\n<main id="main" class="landing" tabindex="-1">\n${body}\n</main>`
    : `<div class="layout">\n  <nav id="rail" class="rail" aria-label="Site and documentation">${rail(docs, out, root, links)}</nav>\n  <main id="main" tabindex="-1">\n${body}\n  </main>\n</div>`}
<footer class="footer">
  <div class="foot-grid">
    <div class="foot-brand"><span class="brand">${SITE_NAME}</span><p>Throwaway Windows and Linux lab machines for fresh-host build and installer tests.</p></div>
    <div><p class="foot-over">Docs</p>${foot('getting-started/index.html', 'Getting started')}${foot('building/index.html', 'Fresh builds')}${foot('runners/index.html', 'Runners')}${foot('reference/security.html', 'Security model')}${foot('guides.html', 'Guided tasks')}</div>
    <div><p class="foot-over">Releases</p><a href="${esc(links.download)}">Latest release</a>${foot('changelog.html', 'Changelog')}<a href="${root}${PDF_FILE}">Phone-size PDF</a></div>
    <div><p class="foot-over">Source</p><a href="${esc(links.repo)}">GitHub repository</a><a href="${esc(links.repo)}/issues">Report an issue</a><a href="${esc(links.repo)}/blob/main/ROADMAP.md">Roadmap</a>${foot('settings.html', 'Site settings')}</div>
  </div>
  <p class="foot-note">Documentation for version ${esc(version)}. Static site: nothing on it is fetched from the network, and settings stay in this browser. Releases are not code-signed.</p>
</footer>
<dialog class="palette" aria-label="Command palette">
  <div class="palette-field">${icon('search', 'palette-icon')}<input type="text" class="palette-input" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list" aria-label="Search pages, headings and settings" placeholder="Search pages, headings and settings" autocomplete="off" spellcheck="false"><button type="button" class="icon-btn palette-close" aria-label="Close the command palette">${icon('close')}</button></div>
  <ul id="palette-list" class="palette-list" role="listbox" aria-label="Results"></ul>
  <p class="palette-hint"><kbd>Up</kbd> <kbd>Down</kbd> to move, <kbd>Enter</kbd> to open or apply, <kbd>Esc</kbd> to close</p>
</dialog>
<div class="toast" role="status" aria-live="polite"></div>
<script src="${root}shared/i18n-zh-hk.js"></script>
<script src="${root}shared/i18n.js"></script>
<script src="${root}shared/vocab.js"></script>
<script src="${root}assets/search-index.js"></script>
<script src="${root}assets/app.js"></script>
<script src="${root}assets/demos.js"></script>
${landing ? `<script src="${root}assets/landing.js"></script>\n` : ''}</body>
</html>
`;
}

// Applied before first paint so the saved theme, motion and text size never flash.
const PREPAINT = `(function(){try{var s=JSON.parse(localStorage.getItem('mvl-site-settings')||'{}');var d=document.documentElement;var t=s.theme||'system';if(t==='system')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';d.setAttribute('data-theme',t);if(s.motion==='reduced')d.setAttribute('data-reduce-motion','true');else if(s.motion==='full')d.setAttribute('data-reduce-motion','false');if(s.textSize)d.style.fontSize=s.textSize+'%';var r=d.getAttribute('data-reduce-motion');if(!(r==='true'||(r!=='false'&&matchMedia('(prefers-reduced-motion: reduce)').matches)))d.classList.add('motion-ok');}catch(e){}})();`;

// ---------- task-led article layout ----------
// Facts for the task articles, each taken from the article's own text. `cmd: '@first'` uses the
// article's first code block (and removes it from the body, since the Steps panel shows it).
const ARTICLE_META = {
  'getting-started/create-a-lab-machine.md': {
    time: '25 to 50 minutes', needs: ['Windows PC', 'VMware Workstation or VirtualBox'],
    before: ['A Windows PC with VMware Workstation or VirtualBox. With neither, <code>mvl hv install --approve</code> installs VirtualBox, and you answer its administrator prompt.', '<code>mvl</code> on PATH, from <code>mvl.bat install-cli</code>', 'Internet access, so the official Windows 11 Enterprise evaluation ISO can be fetched from Microsoft and verified'],
    cli: [
      { t: 'See which hypervisor will be used', d: 'VMware Workstation if installed and <code>vmrun</code> answers; otherwise VirtualBox.', cmd: 'mvl hv' },
      { t: 'Create the lab machine', d: 'An unattended install from verified media, then a clean baseline snapshot.', cmd: '@first', expect: 'Status becomes <code>ready</code> once snapshot <code>mvl-baseline</code> is taken.' },
    ],
  },
  'getting-started/set-up-for-you.md': {
    needs: ['Windows PC', 'VMware Workstation or VirtualBox'],
    before: ['<code>mvl</code> on PATH, from <code>mvl.bat install-cli</code>', 'Your own Codex and GitHub accounts, if you want the sign-ins: you type your password on the official pages'],
    cli: [{ t: 'Create a lab machine for you', d: '<code>--for</code> defaults to <code>you</code> in a console.', cmd: 'mvl new proof-4 --for you', expect: 'At your first sign-in the Material VM Labs Setup app opens and shows each tool\'s state.' }],
    manager: [{ t: 'Create a lab machine for you', d: 'In the manager: <strong>+ Create a new one</strong>, choose <strong>You</strong> under <em>Who uses it</em>. The switches for tools and the shared folder start on; turn either off if you do not want it.', expect: 'At your first sign-in the Material VM Labs Setup app opens and shows each tool\'s state.' }],
  },
  'getting-started/linux.md': {
    needs: ['VMware Workstation first', 'VirtualBox with --hv virtualbox'],
    before: ['<code>mvl</code> on PATH, from <code>mvl.bat install-cli</code>', 'Internet access for the official cloud image and its published checksums'],
    cli: [
      { t: 'Create an Ubuntu or Debian machine', cmd: '@first', expect: 'cloud-init installs Docker and the Codex CLI, then the clean baseline is taken.' },
      { t: 'Connect over SSH', d: 'Uses the machine\'s own key, kept in its VM folder.', cmd: 'mvl ssh ubu-1' },
    ],
    manager: [{ t: 'Create an Ubuntu or Debian machine', d: 'In the manager: <strong>+ Create a new one</strong>, then choose the system.', expect: 'cloud-init installs Docker and the Codex CLI, then the clean baseline is taken.' }],
  },
  'building/fresh-build.md': {
    needs: ['Windows 11 lab machine'],
    before: ['A Windows 11 lab machine, for example <code>proof-1</code>', 'The repository clones over HTTPS with your own <code>git</code> credentials, which stay on this PC', 'Each entrypoint runs silently as <code>&lt;entry&gt;.bat /s</code>'],
    cli: [
      { t: 'Run the fresh build', d: 'Reset to <code>mvl-baseline</code>, a fresh clone at <code>--ref</code>, then every entrypoint.', cmd: '@first', expect: 'Exit code 0 only when every entrypoint passed, and <code>receipt.json</code> is written.' },
      { t: 'Read the receipt', d: 'Logs, <code>result.json</code>, artifacts and the receipt are under <code>%LOCALAPPDATA%\\MaterialVmLabs\\runs\\&lt;run-id&gt;\\</code>. <a href="receipts.html">Read a receipt</a> explains every field.' },
    ],
  },
  'building/installer-tests.md': {
    needs: ['Windows lab machine', 'Setup.exe or .msi'],
    before: ['A Windows lab machine with no self-hosted runner registered, because the reset would remove it', 'The installer: <code>Setup.exe</code> or an <code>.msi</code>'],
    cli: [{ t: 'Run the installer test', d: 'Reset to the baseline, run in the signed-in guest session, then list the new folders.', cmd: '@first', expect: 'Exit code <code>0</code> means the installer exited 0; the guest screenshot is the evidence that it launched.' }],
  },
  'runners/register.md': {
    needs: ['Private repository', 'GitHub CLI on this PC'],
    before: ['A private repository: anything that is not <code>PRIVATE</code> is refused', 'The GitHub CLI (<code>gh</code>) on this PC, able to create a registration token', 'A Windows lab machine, for example <code>proof-1</code>'],
    cli: [
      { t: 'Register the runner', d: 'The token arrives on standard input and is cleared after the guest has used it.', cmd: '@first', expect: 'A service running as <code>mvlbuilder</code> with the labels <code>self-hosted</code>, <code>Windows</code>, <code>X64</code>, <code>material-vm-labs</code> and <code>mvl-&lt;project&gt;</code>.' },
      { t: 'Use it in a workflow', cmd: 'runs-on: [self-hosted, windows, material-vm-labs]' },
    ],
  },
};
const TROUBLE = /^(If it fails|Limits)\b/i;

function stepsPanel(meta, firstCmd, pageKey) {
  const card = (s, i, route) => {
    const cmd = s.cmd === '@first' ? firstCmd : s.cmd;
    return `<li class="task-step" data-step="${route}-${i}"><span class="task-num" aria-hidden="true">${i + 1}</span><div class="task-body"><h3>${esc(s.t)}</h3>${s.d ? `<p>${s.d}</p>` : ''}${cmd ? `<pre><code class="language-bat">${esc(cmd)}</code></pre>` : ''}${s.expect ? `<p class="expect">${icon('check')}<span><strong>Expected:</strong> ${s.expect}</span></p>` : ''}<button type="button" class="m3-btn tonal done-btn" aria-pressed="false" data-done="${route}-${i}">Mark as done</button></div></li>`;
  };
  const list = (steps, route) => `<ol class="task-steps">${steps.map((s, i) => card(s, i, route)).join('')}</ol>`;
  const sw = meta.manager
    ? `<div class="route-switch" role="tablist" aria-label="How you work"><button type="button" role="tab" id="route-cli" aria-controls="panel-cli" aria-selected="true">Command line</button><button type="button" role="tab" id="route-app" aria-controls="panel-app" aria-selected="false" tabindex="-1">Manager app</button></div>`
    : '';
  const panels = meta.manager
    ? `<div role="tabpanel" id="panel-cli" aria-labelledby="route-cli">${list(meta.cli, 'cli')}</div><div role="tabpanel" id="panel-app" aria-labelledby="route-app" hidden>${list(meta.manager, 'app')}</div>`
    : list(meta.cli, 'cli');
  return `<section class="task-panel" aria-labelledby="steps" data-page-key="${esc(pageKey)}"><div class="task-head"><h2 id="steps">Steps</h2>${sw}</div>${panels}</section>`;
}

function beforePanel(meta) {
  return `<section class="before-card" aria-labelledby="before-you-start"><h2 id="before-you-start">Before you start</h2><ul class="checklist">${meta.before.map((b, i) => `<li><label><input type="checkbox" data-check="${i}"><span>${b}</span></label></li>`).join('')}</ul></section>`;
}

// Turns a troubleshooting section's list into an accordion; other content becomes one panel.
function troubleSection(h2, content) {
  const items = content.trim().match(/^<ul>\n?([\s\S]*)<\/ul>\s*$/);
  let inner;
  if (items && !/<ul>/.test(items[1])) {
    inner = [...items[1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => {
      const text = m[1].trim();
      const cut = text.search(/\.(\s|$)/);
      const sum = cut > 0 && cut < 240 ? text.slice(0, cut + 1) : text;
      const rest = cut > 0 && cut < 240 ? text.slice(cut + 1).trim() : '';
      if (!rest) return `<p class="fold-static">${sum}</p>`;
      return `<details class="fold"><summary>${sum}${icon('chev', 'fold-chev')}</summary><div class="fold-body">${rest ? `<p>${rest}</p>` : ''}</div></details>`;
    }).join('');
  } else {
    inner = `<div class="trouble-body">${content}</div>`;
  }
  return `<section class="trouble">${h2.replace('<h2 ', '<h2 data-trouble ')}${inner}</section>`;
}

function articleBody(d, docs, root) {
  const cat = docs.find((x) => x.src === `${d.category}/README.md`);
  const meta = ARTICLE_META[d.src];
  const crumbs = [`<li><a href="${root}overview.html">Docs</a></li>`];
  if (cat && cat !== d) crumbs.push(`<li><a href="${relHref(d.out, cat.out)}">${esc(cat.title)}</a></li>`);
  crumbs.push(`<li><span aria-current="page">${esc(d.title)}</span></li>`);
  let html = d.html;
  const h1m = html.match(/^<h1 id="([^"]+)">([\s\S]*?)<\/h1>\n?/);
  const h1id = h1m ? h1m[1] : slugify(d.title);
  if (h1m) html = html.slice(h1m[0].length);
  let lede = '';
  const pm = html.match(/^<p>([\s\S]*?)<\/p>\n?/);
  if (pm) { lede = pm[1]; html = html.slice(pm[0].length); }
  let firstCmd = '';
  if (meta && meta.cli.concat(meta.manager || []).some((s) => s.cmd === '@first')) {
    const firstH2 = html.search(/<h2 /);
    const cm = html.match(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>\n?/);
    if (cm && (firstH2 < 0 || cm.index < firstH2)) { firstCmd = decode(cm[1]).replace(/\n$/, ''); html = html.slice(0, cm.index) + html.slice(cm.index + cm[0].length); }
    if (meta.manager) {
      const fh = html.search(/<h2 /);
      const mm = html.match(/<p>In the manager:[\s\S]*?<\/p>\n?/);
      if (mm && (fh < 0 || mm.index < fh)) html = html.slice(0, mm.index) + html.slice(mm.index + mm[0].length);
    }
  }
  // Numbered lists describe what the tool does: show them as a flow.
  html = html.replace(/<ol>/g, '<ol class="flow-list">');
  // Troubleshooting sections become an accordion.
  const parts = html.split(/(?=<h2 )/);
  html = parts.map((p) => {
    const hm = p.match(/^(<h2 id="[^"]+">([\s\S]*?)(?:<a class="anchor"[\s\S]*?<\/a>)?<\/h2>\n?)/);
    if (hm && TROUBLE.test(stripTags(hm[2]))) return troubleSection(hm[1], p.slice(hm[1].length));
    return p;
  }).join('');
  const words = stripTags(d.html).split(' ').length;
  const chips = [`<li class="chip-time">${icon('clock')}${meta && meta.time ? esc(meta.time) : `${Math.max(1, Math.round(words / 200))} min read`}</li>`]
    .concat(meta ? meta.needs.map((n) => `<li>${esc(n)}</li>`) : []);
  const before = meta ? beforePanel(meta) : '';
  const steps = meta ? stepsPanel(meta, firstCmd, d.out) : '';
  const tocItems = [];
  if (meta) tocItems.push(['2', 'before-you-start', 'Before you start'], ['2', 'steps', 'Steps']);
  for (const m of html.matchAll(/<h([23])(?: data-trouble)? id="([^"]+)">([\s\S]*?)(<a class="anchor"|<\/h\1>)/g)) tocItems.push([m[1], m[2], stripTags(m[3])]);
  const toc = tocItems.map(([lv, id, t]) => `<li class="toc-h${lv}"><a href="#${id}">${esc(t)}</a></li>`);
  const siblings = docs.filter((x) => x.category === d.category && !x.isCategory);
  const i = siblings.indexOf(d);
  const pn = [siblings[i - 1], siblings[i + 1]];
  const nav = pn.some(Boolean) ? `<nav class="prevnext" aria-label="More in ${esc(cat ? cat.title : 'this section')}">${pn[0] ? `<a class="pn prev" href="${relHref(d.out, pn[0].out)}"><span>Previous</span>${esc(pn[0].title)}</a>` : '<span></span>'}${pn[1] ? `<a class="pn next" href="${relHref(d.out, pn[1].out)}"><span>Next</span>${esc(pn[1].title)}</a>` : ''}</nav>` : '';
  const useful = `<div class="useful" data-useful="${esc(d.out)}"><p class="useful-q" id="useful-q">Was this page useful?</p><div class="row" role="group" aria-labelledby="useful-q"><button type="button" class="m3-btn tonal" data-useful-answer="yes" aria-pressed="false">Yes</button><button type="button" class="m3-btn tonal" data-useful-answer="no" aria-pressed="false">Not yet</button></div><p class="useful-note small">Your answer stays in this browser. Nothing is sent.</p></div>`;
  return `<div class="article-layout${meta ? ' is-task' : ''}">
<article class="article">
<nav class="crumbs" aria-label="Breadcrumbs"><ol>${crumbs.join('')}</ol></nav>
<h1 id="${h1id}">${esc(d.title)}</h1>
${lede ? `<p class="lede">${lede}</p>` : ''}
<ul class="meta-chips" aria-label="About this article">${chips.join('')}</ul>
${before}
${steps}
${meta && html.trim() ? '<div class="article-rest">' : ''}${html}${meta && html.trim() ? '</div>' : ''}
${nav}
</article>
<aside class="toc" aria-label="On this page">${toc.length > 1 ? `<p class="label">On this page</p><ul>${toc.join('')}</ul>` : ''}${useful}</aside>
</div>`;
}

// The changelog page is rendered from CHANGELOG.md at the repository root.
function changelogBody() {
  const file = path.join(ROOT, 'CHANGELOG.md');
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '# Changelog\n\nNo changes are recorded yet.\n';
  const md = new Marked();
  md.use({ gfm: true, renderer: { heading({ tokens, depth }) { const inner = this.parser.parseInline(tokens); if (depth === 1) return ''; const id = slugify(inner); return `<h${depth} id="${id}">${inner}</h${depth}>\n`; } } });
  const html = md.parse(text);
  return `<header class="page-head"><p class="eyebrow">Releases</p><h1 id="changelog">Changelog</h1><p class="lede">What changed in each version. Releases are published on GitHub and are not code-signed; each release lists the SHA-256 of every file.</p></header><article class="article changelog">${html}</article>`;
}

// Category cards for the landing page's documentation section.
function landingDocCards(docs) {
  return '<ul class="land-docs">' + CATEGORY_ORDER.map((c) => docs.find((d) => d.src === `${c}/README.md`)).filter(Boolean).map((c, i) => {
    const kids = docs.filter((x) => x.category === c.category && !x.isCategory);
    const sub = kids.length ? kids.slice(0, 4).map((k) => esc(k.title)).join(', ') : esc(c.summary);
    return `<li class="reveal" style="--i:${i}"><a href="${c.out}"><span class="land-docs-num">${String(i + 1).padStart(2, '0')}</span><span class="land-docs-title">${esc(c.title)}</span><span class="land-docs-sub">${sub}</span>${icon('arrow')}</a></li>`;
  }).join('') + '</ul>';
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
  const repoName = /^[\w.-]+\/[\w.-]+$/.test(process.env.GITHUB_REPOSITORY || '') ? process.env.GITHUB_REPOSITORY : DEFAULT_REPO;
  const [owner, repoShort] = repoName.split('/');
  const siteUrl = /^https:\/\/[^\s"]+\/$/.test(process.env.SITE_URL || '') ? process.env.SITE_URL : `https://${owner.toLowerCase()}.github.io/${repoShort}/`;
  const previewBytes = fs.readFileSync(path.join(ROOT, 'social-preview.png'));
  const previewHash = createHash('sha256').update(previewBytes).digest('hex');
  const preview = { path: `assets/social-preview-${previewHash.slice(0, 12)}.png`, hash: previewHash, ...pngSize(previewBytes) };
  const links = { repoName, repo: `https://github.com/${repoName}`, download: `https://github.com/${repoName}/releases/latest`, siteUrl, preview };
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  const overview = docs.find((d) => d.src === 'README.md');
  const tops = [
    { out: 'index.html', title: 'Home' },
    { out: 'guides.html', title: 'Guided tasks' },
    overview && { out: overview.out, title: 'All documentation' },
    ...CATEGORY_ORDER.map((c) => docs.find((d) => d.src === `${c}/README.md`)).filter(Boolean).map((d) => ({ out: d.out, title: d.title })),
    { out: 'changelog.html', title: 'Changelog' },
    { out: 'settings.html', title: 'Settings' },
  ].filter(Boolean);

  const index = { pages: [], sections: [], tops: tops.map((t) => t.out) };
  const write = (out, html) => { const f = path.join(DIST, out); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, html); };
  const hrefs = new Map();

  for (const p of HAND_PAGES) {
    const body = p.out === 'changelog.html' ? changelogBody() : fs.readFileSync(path.join(SITE, 'pages', p.file), 'utf8')
      .replaceAll('{{pdf}}', PDF_FILE).replaceAll('{{version}}', esc(version))
      .replaceAll('{{download}}', esc(links.download)).replaceAll('{{repo}}', esc(links.repo))
      .replace('{{doc-cards}}', () => landingDocCards(docs)).replace('{{provenance}}', () => provenance(version));
    write(p.out, shell({ out: p.out, title: p.title, description: p.description, body, docs, tops, kind: 'page', version, links, layout: p.out === 'index.html' ? 'landing' : 'docs' }));
    index.pages.push({ url: p.out, title: p.title, kind: 'page', summary: p.description });
    index.sections.push(...sections(body, p.out, p.title));
    hrefs.set(p.out, body);
  }
  for (const d of docs) {
    const root = '../'.repeat(d.out.split('/').length - 1);
    const body = d === overview ? overviewBody(d, docs) : d.cards ? categoryBody(d, docs, root) : articleBody(d, docs, root);
    const title = d === overview ? 'All documentation' : d.title;
    write(d.out, shell({ out: d.out, title, description: d.summary || title, body, docs, tops, kind: d.cards || d === overview ? 'category' : 'article', version, links }));
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
  for (const f of ['vocab.js', 'i18n.js', 'i18n-zh-hk.js']) fs.copyFileSync(path.join(SHARED, f), path.join(DIST, 'shared', f));
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
  // The served link-preview picture is a copy of the root master; prove the copy is byte-identical.
  fs.copyFileSync(path.join(ROOT, 'social-preview.png'), path.join(DIST, preview.path));
  if (!fs.readFileSync(path.join(DIST, preview.path)).equals(previewBytes)) throw new Error('The served social preview differs from social-preview.png.');
  fs.writeFileSync(path.join(DIST, 'assets', 'search-index.js'), `window.MVL_INDEX=${JSON.stringify(index)};\n`);
  fs.writeFileSync(path.join(DIST, '.nojekyll'), '');
  return { pages: index.pages.length, sections: index.sections.length };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = build();
  console.log(`Built ${r.pages} pages and ${r.sections} searchable sections into ${path.relative(ROOT, DIST)}/`);
}
