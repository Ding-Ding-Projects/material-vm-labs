#!/usr/bin/env node
// make-social-preview.mjs: renders social-preview.png (1280 x 640) at the repository root, the
// picture shown when a link to the repository or the site is shared. It is a card built from the
// app's own icon and a real capture of the manager (docs/images/manager-machines.png, rendered with
// sample machines), drawn locally in headless Chromium with no network. The site build copies this
// exact file into site/dist and checks the copy is byte-identical.
//   node scripts/make-social-preview.mjs
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const b64 = (p) => readFileSync(join(root, p)).toString('base64');
const shot = b64('docs/images/manager-machines.png');
const icon = b64('companion/renderer/manager/manager.png');
const font = b64('companion/renderer/shared/fonts/RobotoFlex-latin.woff2');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Roboto Flex'; src: url(data:font/woff2;base64,${font}) format('woff2'); font-weight: 100 1000; }
html, body { margin: 0; width: 1280px; height: 640px; overflow: hidden; }
body { font-family: 'Roboto Flex', sans-serif; background: #f3edf7; color: #1d1b20; position: relative; }
.blob { position: absolute; border-radius: 50%; }
.b1 { width: 620px; height: 620px; left: -180px; top: -260px; background: #e8def8; }
.b2 { width: 420px; height: 420px; left: 220px; bottom: -260px; background: #ffd8e4; }
.text { position: absolute; left: 64px; top: 60px; width: 470px; }
.mark { display: flex; align-items: center; gap: 16px; }
.mark img { width: 84px; height: 84px; border-radius: 22px; }
.mark span { font-size: 22px; font-weight: 600; letter-spacing: .02em; color: #4f378b; }
h1 { font-size: 54px; line-height: 1.04; margin: 30px 0 18px; font-weight: 800; letter-spacing: -.02em; font-stretch: 112%; }
p { font-size: 23px; line-height: 1.35; margin: 0; color: #49454f; }
.chips { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 30px; }
.chips b { font-size: 18px; font-weight: 600; padding: 9px 16px; border-radius: 999px; background: #fff; color: #4f378b; border: 2px solid #d0bcff; }
.shot { position: absolute; left: 580px; top: 64px; width: 860px; border-radius: 28px; overflow: hidden; box-shadow: 0 24px 64px rgba(79, 55, 139, .28); border: 6px solid #fff; }
.shot img { display: block; width: 100%; }
</style></head><body>
<div class="blob b1"></div><div class="blob b2"></div>
<div class="text">
  <div class="mark"><img src="data:image/png;base64,${icon}" alt=""><span>Material VM Labs</span></div>
  <h1>Throwaway lab machines for fresh-host builds</h1>
  <p>Prove that build.bat and your installer work on a clean Windows, Ubuntu or Debian machine.</p>
  <div class="chips"><b>VMware first</b><b>VirtualBox fallback</b><b>Receipts per commit</b></div>
</div>
<div class="shot"><img src="data:image/png;base64,${shot}" alt=""></div>
</body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
  await page.route('**/*', (r) => (r.request().url().startsWith('data:') || r.request().url() === 'about:blank' ? r.continue() : r.abort()));
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1280, height: 640 } });
  writeFileSync(join(root, 'social-preview.png'), png);
  console.log(`social-preview.png 1280x640 sha256 ${createHash('sha256').update(png).digest('hex')}`);
} finally { await browser.close(); }
