'use strict';
// Locates the lab machine checkout the companions drive, or unpacks the embedded copy of the exact commit's source.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');

function readEmbedded() {
  return JSON.parse(fs.readFileSync(path.join(root, 'generated', 'source.bundle.json'), 'utf8'));
}

function isCheckout(dir) {
  return fs.existsSync(path.join(dir, 'build.bat')) && fs.existsSync(path.join(dir, 'scripts', 'build.ps1')) && fs.existsSync(path.join(dir, 'VERSION'));
}

function walkUp(start) {
  let dir = path.resolve(start);
  for (let i = 0; i < 12; i++) {
    if (isCheckout(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function argRepo() {
  const i = process.argv.indexOf('--repo');
  return i >= 0 ? process.argv[i + 1] : null;
}

// Unpack the embedded copy of the exact commit's tracked source, verifying every hash and refusing unsafe paths.
function unpackEmbedded() {
  const bundle = readEmbedded();
  const m = bundle.manifest;
  const commitKey = /^[0-9a-f]{7,64}$/i.test(m.commit) ? m.commit : crypto.createHash('sha256').update(JSON.stringify(m.files)).digest('hex').slice(0, 40);
  const base = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'MaterialVmLabs', 'source');
  const dest = path.join(base, commitKey);
  const destResolved = path.resolve(dest) + path.sep;
  fs.mkdirSync(dest, { recursive: true });
  let written = 0, reused = 0;
  for (const f of m.files) {
    const p = String(f.path);
    if (!p || path.isAbsolute(p) || /^[a-zA-Z]:/.test(p) || p.includes('\0') || p.split(/[\\/]/).some((seg) => seg === '..' || seg === '')) throw new Error(`refusing unsafe path in the embedded source: ${p}`);
    const target = path.resolve(dest, p);
    if (!target.startsWith(destResolved)) throw new Error(`refusing path outside the unpack folder: ${p}`);
    if (fs.existsSync(target)) {
      const cur = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
      if (cur === f.sha256) { reused++; continue; }
    }
    const data = Buffer.from(bundle.files[p] || '', 'base64');
    const got = crypto.createHash('sha256').update(data).digest('hex');
    if (got !== f.sha256) throw new Error(`hash mismatch for ${p}: expected ${f.sha256}, got ${got}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    written++;
  }
  fs.writeFileSync(path.join(dest, 'source-manifest.json'), JSON.stringify(m, null, 2));
  return { dir: dest, written, reused, commit: m.commit };
}

function locate(app) {
  const arg = argRepo();
  if (arg) {
    if (!isCheckout(arg)) return { error: `--repo ${arg} is not a lab machine checkout (needs build.bat, scripts\\build.ps1 and VERSION).` };
    return { dir: path.resolve(arg), note: 'checkout given with --repo' };
  }
  const exeDir = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
  const found = walkUp(exeDir) || (app.isPackaged ? null : walkUp(path.join(root, '..')));
  if (found) return { dir: found, note: 'checkout found by walking up from the exe' };
  try {
    const u = unpackEmbedded();
    return { dir: u.dir, note: `no checkout found; unpacked the embedded source of commit ${String(u.commit).slice(0, 12)} (${u.written} written, ${u.reused} reused, every hash verified)` };
  } catch (e) {
    return { error: `no checkout found and the embedded source could not be unpacked: ${e.message}` };
  }
}

module.exports = { root, readEmbedded, isCheckout, locate };
