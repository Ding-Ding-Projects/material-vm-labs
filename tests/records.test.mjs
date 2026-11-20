// Records lane tests: the update state machine, version comparison, feed and package
// verification, "Update coming soon" stages, the dependency manifest and the time estimate.
//   node --test tests/records.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const U = require(join(root, 'companion/src/shared/updates-ipc.js'));
const { estimate, formatEstimate } = await import(join(root, 'scripts/human-time-estimate.mjs'));
const { verifyManifest } = await import(join(root, 'scripts/dependency-manifest.mjs'));

const sha1 = (b) => createHash('sha1').update(b).digest('hex');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const pkg = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('package body')]);

test('versions compare numerically and builds sort after their base version', () => {
  assert.equal(U.compareVersions('0.1.0', '0.1.0'), 0);
  assert.equal(U.compareVersions('0.1.10', '0.1.9'), 1);
  assert.equal(U.compareVersions('v1.0.0', '0.9.9'), 1);
  assert.equal(U.compareVersions('0.1.0-build42', '0.1.0-build9'), 1);
  assert.equal(U.compareVersions('0.1.0-build.7', '0.1.0-build.12'), -1);
  assert.equal(U.compareVersions('0.1.0', '0.1.0-build1'), -1);
  assert.throws(() => U.compareVersions('latest', '0.1.0'));
});

test('RELEASES parsing is strict', () => {
  const line = `${'A'.repeat(40)} MaterialVmLabs-0.1.0-full.nupkg 1234`;
  const e = U.parseReleases('﻿' + line + '\r\n');
  assert.equal(e.length, 1);
  assert.deepEqual([e[0].version, e[0].kind, e[0].size, e[0].sha1], ['0.1.0', 'full', 1234, 'a'.repeat(40)]);
  assert.throws(() => U.parseReleases(''), /empty/);
  assert.throws(() => U.parseReleases('nonsense here'), /malformed/);
  assert.throws(() => U.parseReleases(`${'A'.repeat(40)} ../evil.nupkg 1`), /malformed/);
  assert.throws(() => U.parseReleases(`${'A'.repeat(40)} NoVersion.nupkg 1`), /without a version/);
  const two = U.parseReleases(`${line}\n${'B'.repeat(40)} MaterialVmLabs-0.1.1-full.nupkg 99\n${'C'.repeat(40)} MaterialVmLabs-0.1.1-delta.nupkg 9`);
  assert.equal(U.newestFull(two).version, '0.1.1');
});

test('release notes give hashes, commit and build number', () => {
  const body = 'Material VM Labs 0.1.0, build 42, commit `' + 'f'.repeat(40) + '`.\n\n| File | SHA-256 |\n| --- | --- |\n| RELEASES | ' + 'a'.repeat(64) + ' |\n| MaterialVmLabs-0.1.0-full.nupkg | ' + 'B'.repeat(64) + ' |';
  assert.equal(U.notesCommit(body), 'f'.repeat(40));
  assert.equal(U.parseNotesHashes(body)['MaterialVmLabs-0.1.0-full.nupkg'], 'b'.repeat(64));
  assert.equal(U.buildNumber('v0.1.0-build.42'), 42);
  assert.equal(U.buildNumber('v0.1.0'), null);
});

function release(over = {}) {
  const file = 'MaterialVmLabs-0.1.1-full.nupkg';
  return {
    tag_name: 'v0.1.1-build.43', html_url: 'https://github.com/o/r/releases/tag/v0.1.1-build.43', draft: false, prerelease: false,
    body: 'build 43, commit `' + '1'.repeat(40) + '`.\n| ' + file + ' | ' + sha256(pkg) + ' |',
    assets: [{ name: file, size: pkg.length, browser_download_url: 'https://github.com/o/r/releases/download/x/' + file }, { name: 'RELEASES', size: 80 }],
    ...over
  };
}
const releasesText = `${sha1(pkg).toUpperCase()} MaterialVmLabs-0.1.1-full.nupkg ${pkg.length}`;

test('a valid feed becomes an offer with both hashes', () => {
  const o = U.readOffer(release(), releasesText);
  assert.equal(o.version, '0.1.1');
  assert.equal(o.build, 43);
  assert.equal(o.sha256, sha256(pkg));
  assert.equal(o.commit, '1'.repeat(40));
});

test('invalid feed metadata is refused with a reason', () => {
  assert.throws(() => U.readOffer(release({ draft: true }), releasesText), /draft/);
  assert.throws(() => U.readOffer(release({ body: 'no table' }), releasesText), /no SHA-256/);
  assert.throws(() => U.readOffer(release({ assets: [] }), releasesText), /not attached/);
  assert.throws(() => U.readOffer(release(), releasesText.replace(String(pkg.length), '999')), /bytes on the release/);
  assert.throws(() => U.readOffer(null, releasesText), /did not return a release/);
});

test('package verification catches corrupt and tampered packages', () => {
  const expect = { size: pkg.length, sha1: sha1(pkg), sha256: sha256(pkg) };
  assert.deepEqual(U.verifyPackage(pkg, expect), { ok: true });
  assert.equal(U.verifyPackage(pkg.subarray(0, 5), expect).kind, 'corrupt');
  const notZip = Buffer.from(pkg); notZip[0] = 0x00;
  assert.equal(U.verifyPackage(notZip, expect).kind, 'corrupt');
  const tampered = Buffer.from(pkg); tampered[tampered.length - 1] ^= 1;
  assert.equal(U.verifyPackage(tampered, expect).kind, 'invalid');
  assert.match(U.verifyPackage(pkg, { ...expect, sha256: '0'.repeat(64) }).reason, /SHA-256/);
});

test('state machine: no update, available, downloading, ready, restart', () => {
  let s = { status: 'idle' };
  s = U.reduce(s, { type: 'CHECK', manual: true }); assert.equal(s.status, 'checking');
  assert.equal(U.reduce(s, { type: 'NO_UPDATE', at: 't' }).status, 'none');
  s = U.reduce(s, { type: 'FOUND', offer: { size: 10 }, at: 't' }); assert.equal(s.status, 'available');
  s = U.reduce(s, { type: 'DOWNLOAD' }); assert.equal(s.status, 'downloading'); assert.equal(s.total, 10);
  s = U.reduce(s, { type: 'PROGRESS', received: 5, total: 10 }); assert.equal(s.received, 5);
  s = U.reduce(s, { type: 'VERIFIED', staged: { dir: 'd', file: 'f' } }); assert.equal(s.status, 'ready');
  s = U.reduce(s, { type: 'LATER' }); assert.equal(s.status, 'ready'); assert.equal(s.dismissed, true);
  s = U.reduce(s, { type: 'RESTART' }); assert.equal(s.status, 'restarting');
});

test('state machine: offline, invalid, corrupt, cancelled, rollback, unsaved work', () => {
  const checking = U.reduce({ status: 'idle' }, { type: 'CHECK' });
  assert.equal(U.reduce(checking, { type: 'OFFLINE', reason: 'no net' }).status, 'offline');
  assert.equal(U.reduce(checking, { type: 'INVALID', reason: 'bad' }).status, 'invalid');
  assert.equal(U.reduce(checking, { type: 'INVALID', reason: 'bad' }).offer, null);
  const dl = U.reduce(U.reduce(checking, { type: 'FOUND', offer: { size: 1 } }), { type: 'DOWNLOAD' });
  assert.equal(U.reduce(dl, { type: 'CORRUPT', reason: 'short' }).status, 'corrupt');
  const cancelled = U.reduce(dl, { type: 'CANCEL' });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(U.reduce(cancelled, { type: 'DOWNLOAD' }).status, 'downloading'); // retry after cancel
  const ready = U.reduce(dl, { type: 'VERIFIED', staged: {} });
  const held = U.reduce(ready, { type: 'UNSAVED', reason: '1 job is still running.' });
  assert.equal(held.status, 'ready'); assert.match(held.reason, /job/);
  const rolled = U.reduce(U.reduce(ready, { type: 'RESTART' }), { type: 'APPLY_FAILED', reason: 'exit 1' });
  assert.equal(rolled.status, 'rolledback'); assert.equal(rolled.staged, null);
});

test('state machine refuses events that do not fit the state', () => {
  const idle = { status: 'idle' };
  assert.equal(U.reduce(idle, { type: 'RESTART' }).status, 'idle');
  assert.equal(U.reduce(idle, { type: 'RESTART' }).ignored, 'RESTART');
  assert.equal(U.reduce(idle, { type: 'VERIFIED', staged: {} }).status, 'idle'); // never ready without a download
  assert.throws(() => U.reduce(idle, { type: 'NOPE' }));
  for (const s of U.STATES) assert.ok(typeof s === 'string');
});

const T0 = Date.parse('2026-11-20T10:00:00Z');
const done = (n, mins) => ({ id: n, run_number: n, status: 'completed', conclusion: 'success', head_sha: 'old' + n, created_at: new Date(T0 - n * 1e7).toISOString(), run_started_at: new Date(T0 - n * 1e7).toISOString(), updated_at: new Date(T0 - n * 1e7 + mins * 60000).toISOString() });

test('coming soon: absent when no build is in flight for a different commit', () => {
  assert.equal(U.comingSoon({ runs: [], jobs: [], installedCommit: 'x', now: T0 }), null);
  assert.equal(U.comingSoon({ runs: [{ ...done(1, 10), head_sha: 'x' }], jobs: [], installedCommit: 'x', now: T0 }), null);
});

test('coming soon: stages, 24-hour start, elapsed and a labelled estimate', () => {
  const run = { id: 9, run_number: 50, status: 'in_progress', head_sha: 'new', html_url: 'https://github.com/o/r/actions/runs/9', created_at: new Date(T0 - 600000).toISOString(), run_started_at: new Date(T0 - 600000).toISOString() };
  const jobs = [{ status: 'in_progress', steps: [
    { name: 'Set up job', status: 'completed', conclusion: 'success' },
    { name: 'build.bat /s', status: 'completed', conclusion: 'success' },
    { name: 'build-installer.bat /s', status: 'in_progress', started_at: new Date(T0 - 60000).toISOString() },
    { name: 'Publish the release', status: 'queued' }] }];
  const v = U.comingSoon({ runs: [run, done(2, 30), done(3, 40), done(4, 50)], jobs, installedCommit: 'old', now: T0 });
  assert.equal(v.phase, 'building');
  assert.equal(v.build, 50);
  assert.deepEqual(v.stages.map((s) => s.state), ['done', 'done', 'done', 'running', 'waiting', 'waiting']);
  assert.equal(v.stages[0].name, 'Source received');
  assert.equal(v.stages.at(-1).name, 'Update feed moved');
  assert.equal(v.elapsedMs, 600000);
  assert.equal(v.estimate.typicalMs, 40 * 60000);
  assert.equal(v.estimate.leftMs, 30 * 60000);
  assert.equal(v.stalled, false);
});

test('coming soon: failed, stalled, publishing and published', () => {
  const base = { id: 9, run_number: 50, head_sha: 'new', created_at: new Date(T0 - 3600000).toISOString(), run_started_at: new Date(T0 - 3600000).toISOString(), updated_at: new Date(T0 - 60000).toISOString() };
  const failed = U.comingSoon({ runs: [{ ...base, status: 'completed', conclusion: 'failure' }], jobs: [], installedCommit: 'old', now: T0 });
  assert.equal(failed.phase, 'failed');
  assert.equal(failed.estimate, null);
  const stalled = U.comingSoon({ runs: [{ ...base, status: 'in_progress' }, done(2, 10)], jobs: [], installedCommit: 'old', now: T0 });
  assert.equal(stalled.stalled, true);
  const publishing = U.comingSoon({ runs: [{ ...base, status: 'completed', conclusion: 'success' }], jobs: [], installedCommit: 'old', published: false, now: T0 });
  assert.equal(publishing.phase, 'publishing');
  assert.equal(publishing.stages.at(-1).state, 'running');
  const published = U.comingSoon({ runs: [{ ...base, status: 'completed', conclusion: 'success' }], jobs: [], installedCommit: 'old', published: true, now: T0 });
  assert.equal(published.phase, 'published');
  assert.equal(published.stages, undefined); // it becomes the ordinary update offer
});

test('coming soon: a newer build replaces the one being shown', () => {
  const prev = { runId: 8, build: 49, phase: 'building', createdAt: new Date(T0 - 900000).toISOString() };
  const run = { id: 9, run_number: 50, status: 'queued', head_sha: 'new', created_at: new Date(T0 - 60000).toISOString() };
  const v = U.comingSoon({ runs: [run], jobs: [], installedCommit: 'old', now: T0, previous: prev });
  assert.equal(v.replacedFrom, 49);
  assert.equal(v.stages[1].state, 'running'); // waiting its turn
});

test('human time estimate shows inputs and arithmetic', () => {
  const e = estimate({ source: 12000, tests: 3000, markup: 6000 });
  assert.equal(e.lowHours, 12000 / 40 + 3000 / 80 + 6000 / 120);
  assert.equal(e.highHours, 12000 / 20 + 3000 / 40 + 6000 / 60);
  assert.ok(e.highHours > e.lowHours);
  const md = formatEstimate(e);
  assert.match(md, /estimate/i);
  assert.match(md, /12,000/);
  assert.match(md, /=/);
  assert.throws(() => estimate({ source: -1 }));
});

test('dependency manifest verification catches a wrong digest', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'dependencies.json'), 'utf8'));
  assert.equal(verifyManifest(manifest).ok, true, verifyManifest(manifest).errors.join('; '));
  const bad = structuredClone(manifest);
  bad.dependencies[0].sha256 = 'nothex';
  assert.equal(verifyManifest(bad).ok, false);
  const noPin = structuredClone(manifest);
  noPin.dependencies[0].version = '^1';
  assert.equal(verifyManifest(noPin).ok, false);
  assert.ok(existsSync(join(root, 'download-dependencies.bat')));
  assert.ok(existsSync(join(root, 'download-dependencies.sh')));
});
