#!/usr/bin/env node
// dim-sum-code-name.mjs: picks the release code name. Reads the public dim-sum catalogue and its
// published catalog-v1* release assets, skips every dish an earlier release of this repository
// already used (read from those releases' notes), and prints the next unused dish whose photo is
// published, as JSON: { codeName, en, zhHant, id, photoUrl, alt } or { codeName: null, reason }.
// It never blocks a release: any failure prints a null code name with the reason.
//   GITHUB_TOKEN=... GITHUB_REPOSITORY=owner/name node scripts/dim-sum-code-name.mjs
//   node scripts/dim-sum-code-name.mjs --catalog file.json --assets assets.json --used used.json   (offline test)
import { readFileSync } from 'node:fs';

const CATALOG_URL = 'https://raw.githubusercontent.com/Ding-Ding-Projects/dim-sum-photos/main/catalog/index.json';
const PHOTO_REPO = 'Ding-Ding-Projects/dim-sum-photos';
const arg = (n) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : null; };
const headers = { 'User-Agent': 'material-vm-labs-release', Accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };

async function json(url) { const r = await fetch(url, { headers }); if (!r.ok) throw new Error(`${url} answered ${r.status}`); return r.json(); }
async function pages(url) { const all = []; for (let p = 1; p <= 20; p++) { const page = await json(`${url}${url.includes('?') ? '&' : '?'}per_page=100&page=${p}`); all.push(...page); if (page.length < 100) break; } return all; }

async function main() {
  const catalog = arg('catalog') ? JSON.parse(readFileSync(arg('catalog'), 'utf8')) : await json(CATALOG_URL);
  // Published photos: assets of the photo repository's catalog-v1* releases, by file name.
  let assets;
  if (arg('assets')) assets = JSON.parse(readFileSync(arg('assets'), 'utf8'));
  else {
    assets = [];
    for (const rel of await pages(`https://api.github.com/repos/${PHOTO_REPO}/releases`)) {
      if (!/^catalog-v1/.test(rel.tag_name || '')) continue;
      for (const a of rel.assets || []) assets.push({ name: a.name, url: a.browser_download_url });
    }
  }
  const byName = new Map(assets.map((a) => [a.name, a.url]));
  // Dishes already used by this repository's earlier releases.
  let used = [];
  if (arg('used')) used = JSON.parse(readFileSync(arg('used'), 'utf8'));
  else if (process.env.GITHUB_REPOSITORY) {
    for (const rel of await pages(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/releases`)) {
      const m = String(rel.body || '').match(/Code name dish id: `([^`]+)`/); if (m) used.push(m[1]);
    }
  }
  const usedSet = new Set(used);
  for (const dish of catalog.dishes || []) {
    if (usedSet.has(dish.id) || !dish.image || !dish.image.path) continue;
    const file = dish.image.path.split('/').pop();
    const url = byName.get(file);
    if (!url) continue; // photo not published yet: not available as a code name
    return { codeName: `${dish.name.en} · ${dish.name.zhHant}`, en: dish.name.en, zhHant: dish.name.zhHant, id: dish.id, photoUrl: url, alt: (dish.image.alt && dish.image.alt.en) || `Photo of ${dish.name.en}` };
  }
  return { codeName: null, reason: 'no unused dish with a published photo was found' };
}

main().then((r) => console.log(JSON.stringify(r)), (e) => console.log(JSON.stringify({ codeName: null, reason: 'the public dim-sum catalogue could not be read: ' + e.message })));
