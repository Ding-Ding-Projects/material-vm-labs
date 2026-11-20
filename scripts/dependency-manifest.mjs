#!/usr/bin/env node
// dependency-manifest.mjs: checks dependencies.json, the pinned dependency manifest that
// download-dependencies.bat and download-dependencies.sh read.
//   node scripts/dependency-manifest.mjs            check the manifest's shape and pins
//   node scripts/dependency-manifest.mjs --platform  print this machine's platform key
// Every fetchable dependency needs an exact version, an https source and a SHA-256. An entry
// without a digest must say so with status "unpinned", a reason and a command to detect.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EXACT = /^\d+\.\d+\.\d+$/;
const HEX64 = /^[0-9a-f]{64}$/;
const SAFE = /^[A-Za-z0-9._/-]+$/;

export function verifyManifest(m) {
  const errors = [];
  if (!m || m.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  const deps = Array.isArray(m && m.dependencies) ? m.dependencies : [];
  if (!deps.length) errors.push('dependencies is empty');
  const seen = new Set();
  deps.forEach((d, i) => {
    const at = `dependencies[${i}] (${d && d.name})`;
    if (!d || typeof d.name !== 'string' || !/^[a-z0-9-]+$/.test(d.name)) { errors.push(`${at}: name must be lower-case letters, digits or hyphens`); return; }
    if (typeof d.platform !== 'string' || !/^(win|linux|darwin)-(x64|arm64)$/.test(d.platform)) errors.push(`${at}: platform must look like win-x64`);
    const key = `${d.name}@${d.platform}`;
    if (seen.has(key)) errors.push(`${at}: duplicate entry for ${key}`);
    seen.add(key);
    if (d.status === 'unpinned') {
      if (!d.reason) errors.push(`${at}: an unpinned entry must give a reason`);
      if (!d.detect || !SAFE.test(d.detect)) errors.push(`${at}: an unpinned entry must name a command to detect`);
      if (d.source || d.sha256) errors.push(`${at}: an unpinned entry must not carry a download source or digest`);
      return;
    }
    if (!EXACT.test(String(d.version))) errors.push(`${at}: version must be exact (x.y.z), not ${d.version}`);
    if (typeof d.source !== 'string' || !d.source.startsWith('https://')) errors.push(`${at}: source must be an https URL`);
    if (!HEX64.test(String(d.sha256))) errors.push(`${at}: sha256 must be 64 lower-case hex characters`);
    if (!['zip', 'tar.xz', 'tar.gz'].includes(d.archive)) errors.push(`${at}: archive must be zip, tar.xz or tar.gz`);
    if (!d.root || !SAFE.test(d.root) || d.root.includes('..')) errors.push(`${at}: root must be a plain folder name`);
    if (!Array.isArray(d.provides) || !d.provides.length || d.provides.some((p) => !SAFE.test(p) || p.includes('..'))) errors.push(`${at}: provides must list the files the archive must contain`);
    if (d.source && d.version && !d.source.includes(d.version)) errors.push(`${at}: the source URL does not name version ${d.version}`);
  });
  for (const p of (m && m.packages) || []) {
    if (!p.lockfile || !SAFE.test(p.lockfile)) errors.push(`package ${p.name}: lockfile must be a repository path`);
  }
  const b = m && m.build;
  if (!b || !Array.isArray(b.targets) || b.targets.filter((t) => t.default).length !== 1) errors.push('build.targets must have exactly one default target');
  return { ok: errors.length === 0, errors };
}

export function platformKey(p = process.platform, a = process.arch) {
  const os = p === 'win32' ? 'win' : p;
  return `${os}-${a}`;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  if (process.argv.includes('--platform')) { console.log(platformKey()); process.exit(0); }
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const m = JSON.parse(readFileSync(join(root, 'dependencies.json'), 'utf8'));
  const r = verifyManifest(m);
  if (!r.ok) { for (const e of r.errors) console.error(`problem: ${e}`); process.exit(1); }
  const pinned = m.dependencies.filter((d) => d.status !== 'unpinned').length;
  console.log(`dependencies.json is valid: ${pinned} pinned with SHA-256, ${m.dependencies.length - pinned} detected only.`);
}
