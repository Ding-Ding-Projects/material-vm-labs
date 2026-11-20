// Prints every documentation article into site/dist/material-vm-labs-docs.pdf at a phone page
// size (390 x 844 CSS pixels), with a tappable table of contents and working internal links.
//
//   node scripts/build-docs-pdf.mjs
//
// Uses Playwright's Chromium: the `playwright` package when it is installed, otherwise
// `playwright-core` with a browser from `npx playwright-core install chromium`.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadDocs, esc, SITE_NAME, PDF_FILE } from './build-site.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'site', 'dist');
const SHARED = path.join(ROOT, 'companion', 'renderer', 'shared');
const require = createRequire(import.meta.url);

function chromium() {
  for (const name of ['playwright', 'playwright-core']) {
    try { return require(name).chromium; } catch { /* try the next one */ }
  }
  throw new Error('Install playwright-core (npm install) and a browser (npx playwright-core install chromium).');
}

function printHtml(docs, version, repo) {
  const fontUrl = (f) => 'file://' + path.join(SHARED, 'fonts', f).split(path.sep).join('/');
  const groups = [];
  for (const d of docs) {
    const key = d.category || '_';
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push((g = { key, docs: [] }));
    g.docs.push(d);
  }
  const toc = groups.map((g) => g.docs.map((d) => {
    const top = d.isCategory;
    const subs = top ? '' : [...d.html.matchAll(/<h2 id="([^"]+)">([\s\S]*?)<\/h2>/g)]
      .map((m) => `<li class="t3"><a href="#${m[1]}">${m[2]}</a></li>`).join('');
    return `<li class="${top ? 't1' : 't2'}"><a href="#${d.pid}">${esc(d.src === 'README.md' ? 'Overview' : d.title)}</a></li>${subs}`;
  }).join('')).join('');
  const articles = docs.map((d) => {
    const cards = d.cards ? `<ul>${d.cards.map((c) => {
      const t = docs.find((x) => x.src === path.posix.normalize(path.posix.join(path.posix.dirname(d.src), c.rawHref)));
      return `<li><a href="#${t.pid}">${esc(t.title)}</a>: ${c.desc}</li>`;
    }).join('')}</ul>` : '';
    return `<section class="art" id="${d.pid}">${d.html.replace('<!--cards-->', cards)}</section>`;
  }).join('\n');
  const releases = repo ? `<p>Releases: <a href="https://github.com/${esc(repo)}/releases">github.com/${esc(repo)}/releases</a></p>` : '<p>Releases are published on the project repository\'s Releases page.</p>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${SITE_NAME} documentation</title>
<style>
@font-face { font-family: "Roboto Flex"; src: url("${fontUrl('RobotoFlex-latin.woff2')}") format("woff2"); font-weight: 100 1000; }
@font-face { font-family: "Roboto Mono"; src: url("${fontUrl('RobotoMono-400-latin.woff2')}") format("woff2"); font-weight: 400; }
@page { size: 390px 844px; margin: 28px 22px 34px; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font: 400 13.5px/1.55 "Roboto Flex", system-ui, sans-serif; color: #1c1b1e; }
a { color: #6750a4; }
h1 { font-size: 26px; line-height: 1.15; font-weight: 500; margin: 0 0 12px; color: #22005d; }
h2 { font-size: 18px; font-weight: 500; margin: 20px 0 8px; break-after: avoid; }
h3 { font-size: 15px; font-weight: 600; margin: 16px 0 6px; break-after: avoid; }
p, ul, ol { margin: 0 0 10px; }
ul, ol { padding-left: 20px; }
li { margin-bottom: 4px; }
code { font-family: "Roboto Mono", monospace; font-size: 11.5px; background: #ece7eb; border-radius: 4px; padding: 0 3px; overflow-wrap: anywhere; }
pre { background: #e6e1e6; border-radius: 10px; padding: 10px 12px; white-space: pre-wrap; overflow-wrap: anywhere; break-inside: avoid; }
pre code { background: none; padding: 0; font-size: 11px; }
table { border-collapse: collapse; width: 100%; font-size: 11.5px; margin: 8px 0 14px; }
th, td { border: 1px solid #cac4cf; padding: 5px 6px; text-align: left; vertical-align: top; }
th { background: #f2ecf1; }
td code { overflow-wrap: anywhere; }
.cover { height: 760px; display: flex; flex-direction: column; justify-content: center; break-after: page; }
.cover .mark { width: 64px; height: 64px; border-radius: 38% 62% 55% 45% / 45% 40% 60% 55%; background: #6750a4; margin-bottom: 28px; position: relative; }
.cover .mark::after { content: ""; position: absolute; inset: 18px; border-radius: 6px; background: #e9ddff; }
.cover h1 { font-size: 34px; }
.cover .sub { font-size: 16px; color: #49454e; }
.toc { break-after: page; }
.toc ul { list-style: none; padding: 0; }
.toc a { text-decoration: none; display: block; padding: 3px 0; }
.toc .t1 { margin-top: 10px; font-weight: 600; font-size: 14.5px; }
.toc .t2 { padding-left: 12px; }
.toc .t3 { padding-left: 26px; font-size: 12px; }
.toc .t3 a { color: #49454e; }
.art { break-before: page; }
.back { font-size: 11px; margin-top: 18px; }
</style></head><body>
<section class="cover"><div class="mark"></div><h1>${SITE_NAME}</h1><p class="sub">Documentation, phone edition</p><p>Throwaway Windows 11, Ubuntu and Debian lab machines for fresh-host build and installer testing, Remote Desktop, SSH, build receipts and self-hosted runners.</p><p>Version ${esc(version)}. Tap any entry in the contents to jump to it.</p>${releases}</section>
<nav class="toc" id="contents"><h1>Contents</h1><ul>${toc}</ul></nav>
${articles.replace(/<\/section>/g, '<p class="back"><a href="#contents">Back to contents</a></p></section>')}
</body></html>`;
}

export async function buildPdf() {
  const docs = loadDocs({ mode: 'pdf' });
  const version = fs.existsSync(path.join(ROOT, 'VERSION')) ? fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim() : '';
  const repo = /^[\w.-]+\/[\w.-]+$/.test(process.env.GITHUB_REPOSITORY || '') ? process.env.GITHUB_REPOSITORY : '';
  fs.mkdirSync(DIST, { recursive: true });
  const tmp = path.join(DIST, '.print.html');
  fs.writeFileSync(tmp, printHtml(docs, version, repo));
  const browser = await chromium().launch();
  try {
    const page = await browser.newPage();
    await page.goto('file://' + tmp.split(path.sep).join('/'), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const out = path.join(DIST, PDF_FILE);
    await page.pdf({ path: out, width: '390px', height: '844px', printBackground: true, preferCSSPageSize: true, outline: true, tagged: true });
    return { out, articles: docs.length, bytes: fs.statSync(out).size };
  } finally {
    await browser.close();
    fs.rmSync(tmp, { force: true });
  }
}

const r = await buildPdf();
console.log(`Wrote ${path.relative(ROOT, r.out)}: ${r.articles} articles, ${r.bytes} bytes`);
