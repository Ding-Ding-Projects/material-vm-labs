#!/usr/bin/env node
// check-vocabulary.mjs: the vocabulary lock. The maintainer keeps a private conversation
// vocabulary outside this repository. This check hashes that dictionary at run time and compares
// the hash with a lock file kept beside it, also outside the repository. Neither the terms nor the
// hash are ever committed here; this file carries only the method.
//
//   VOCABULARY_SOURCE=<path to the private dictionary> node scripts/check-vocabulary.mjs
//   ... --relock    writes the lock after the maintainer has re-read the dictionary
//
// No source on this machine: skipped with the reason (a stranger can still build).
// Source present and lock missing or different: fails, because the dictionary changed unnoticed.
// What it proves: that this machine holds the current dictionary. It cannot prove that anyone
// used the vocabulary in conversation; that stays each agent's own duty.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..'));
const source = process.env.VOCABULARY_SOURCE || '';
if (!source || !existsSync(source)) {
  console.log('vocabulary lock: skipped, no private vocabulary source on this machine (set VOCABULARY_SOURCE to check it).');
  process.exit(0);
}
const real = realpathSync(source);
const inside = (p) => { const r = relative(repo, p); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };
if (inside(real)) { console.error('problem: the vocabulary source is inside this repository; it must stay outside every public repository.'); process.exit(1); }
const lock = process.env.VOCABULARY_LOCK || `${real}.lock`;
if (inside(lock)) { console.error('problem: the vocabulary lock must sit beside the private source, outside this repository.'); process.exit(1); }
const digest = createHash('sha256').update(readFileSync(real, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
if (process.argv.includes('--relock')) {
  writeFileSync(lock, digest + '\n');
  console.log('vocabulary lock: written beside the private source.');
  process.exit(0);
}
if (!existsSync(lock)) { console.error('problem: the vocabulary source has no lock beside it. Re-read the dictionary, then run with --relock.'); process.exit(1); }
if (readFileSync(lock, 'utf8').trim() !== digest) {
  console.error('problem: the vocabulary changed since it was last locked. Re-read the dictionary, then run with --relock.');
  process.exit(1);
}
console.log('vocabulary lock: current. This proves the dictionary is held and current, not that it was used.');
