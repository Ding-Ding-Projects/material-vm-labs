import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { squirrelAction } = require('../companion/src/shared/squirrel-events.js');

test('an ordinary launch starts the app', () => {
  assert.deepEqual(squirrelAction([]), { kind: 'start' });
  assert.deepEqual(squirrelAction(['--repo', 'C:\\x']), { kind: 'start' });
});

test('first run after Setup.exe opens the app instead of quitting', () => {
  const a = squirrelAction(['--squirrel-firstrun']);
  assert.equal(a.kind, 'start');
  assert.equal(a.firstRun, true);
});

test('install and update create shortcuts, uninstall removes them', () => {
  assert.deepEqual(squirrelAction(['--squirrel-install', '0.1.0']), { kind: 'shortcut', args: ['--createShortcut'] });
  assert.deepEqual(squirrelAction(['--squirrel-updated', '0.1.0']), { kind: 'shortcut', args: ['--createShortcut'] });
  assert.deepEqual(squirrelAction(['--squirrel-uninstall', '0.1.0']), { kind: 'shortcut', args: ['--removeShortcut'] });
});

test('other squirrel events quit', () => {
  assert.deepEqual(squirrelAction(['--squirrel-obsolete', '0.0.9']), { kind: 'quit' });
});
