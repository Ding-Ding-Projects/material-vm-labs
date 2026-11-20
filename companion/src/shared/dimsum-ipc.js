'use strict';
// Dim sum surprise, main-process side. Reads the public dim-sum catalogue and the list of photos
// its catalog-v1* releases have published, keeps a small cache in the app-data folder (with the
// source URL and revision), downloads the chosen photo into that cache, and returns it to the page
// as a data URL so the page itself never touches the network. Every failure returns null quietly:
// the surprise is a delight, never a reason for an error.
const fs = require('fs');
const path = require('path');
const https = require('https');

const CATALOG_URL = 'https://raw.githubusercontent.com/Ding-Ding-Projects/dim-sum-photos/main/catalog/index.json';
const RELEASES_URL = 'https://api.github.com/repos/Ding-Ding-Projects/dim-sum-photos/releases?per_page=100';
const DAY = 24 * 60 * 60 * 1000;

function get(url, asBuffer, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'material-vm-labs', Accept: asBuffer ? '*/*' : 'application/json' }, timeout: 15000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) { res.resume(); return resolve(get(res.headers.location, asBuffer, redirects + 1)); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`${url} answered ${res.statusCode}`)); }
      const chunks = []; let size = 0;
      res.on('data', (c) => { size += c.length; if (size > 40 * 1024 * 1024) { req.destroy(new Error('response too large')); return; } chunks.push(c); });
      res.on('end', () => { const buf = Buffer.concat(chunks); resolve({ body: asBuffer ? buf : buf.toString('utf8'), etag: res.headers.etag || '' }); });
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
  });
}

function register(ipcMain, app) {
  const dir = path.join(app.getPath('userData'), 'dim-sum-cache');
  const indexFile = path.join(dir, 'catalog-cache.json');
  const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

  async function catalog() {
    const cached = readJson(indexFile);
    if (cached && Date.now() - cached.fetchedAt < DAY && cached.dishes && cached.dishes.length) return cached;
    try {
      const [cat, rel] = await Promise.all([get(CATALOG_URL, false), get(RELEASES_URL, false)]);
      const published = new Map();
      for (const r of JSON.parse(rel.body)) if (/^catalog-v1/.test(r.tag_name || '')) for (const a of r.assets || []) published.set(a.name, a.browser_download_url);
      const dishes = [];
      for (const d of JSON.parse(cat.body).dishes || []) {
        const file = d.image && d.image.path ? d.image.path.split('/').pop() : '';
        const url = published.get(file);
        if (url) dishes.push({ id: d.id, en: d.name.en, zhHant: d.name.zhHant, file, url, altEn: (d.image.alt && d.image.alt.en) || '', altYue: (d.image.alt && d.image.alt.yue) || '' });
      }
      const record = { source: CATALOG_URL, revision: cat.etag || 'unknown', fetchedAt: Date.now(), dishes };
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(indexFile, JSON.stringify(record));
      return record;
    } catch { return cached; }
  }

  ipcMain.removeHandler('dimsum:pick');
  ipcMain.handle('dimsum:pick', async () => {
    try {
      const c = await catalog();
      if (!c || !c.dishes || !c.dishes.length) return null;
      const dish = c.dishes[Math.floor(Math.random() * c.dishes.length)];
      if (!/^[\w.-]+\.(png|jpe?g|webp)$/i.test(dish.file)) return null;
      const img = path.join(dir, dish.file);
      if (!fs.existsSync(img)) { const r = await get(dish.url, true); fs.writeFileSync(img, r.body); }
      const buf = fs.readFileSync(img);
      const isPng = buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
      if (!isPng && !isJpg) { fs.unlinkSync(img); return null; }
      return { en: dish.en, zhHant: dish.zhHant, altEn: dish.altEn || `Photo of ${dish.en}`, altYue: dish.altYue, dataUrl: `data:image/${isPng ? 'png' : 'jpeg'};base64,${buf.toString('base64')}` };
    } catch { return null; }
  });
}

module.exports = { register };
