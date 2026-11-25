'use strict';
// Decides what the installed manager does when Squirrel.Windows starts it with a --squirrel-* argument.
//   --squirrel-install / --squirrel-updated -> create shortcuts through Update.exe, then quit
//   --squirrel-uninstall                    -> remove shortcuts through Update.exe, then quit
//   --squirrel-obsolete                     -> quit (an older version is being replaced)
//   --squirrel-firstrun                     -> start normally: Setup.exe launches the app this way
//                                              right after installing, so quitting here means the
//                                              person sees nothing open after running the installer.
// Anything without a --squirrel- argument is an ordinary launch.

function squirrelAction(argv) {
  const ev = (argv || []).find((a) => typeof a === 'string' && a.startsWith('--squirrel-'));
  if (!ev) return { kind: 'start' };
  if (ev === '--squirrel-firstrun') return { kind: 'start', firstRun: true };
  if (ev === '--squirrel-install' || ev === '--squirrel-updated') return { kind: 'shortcut', args: ['--createShortcut'] };
  if (ev === '--squirrel-uninstall') return { kind: 'shortcut', args: ['--removeShortcut'] };
  return { kind: 'quit' };
}

module.exports = { squirrelAction };
