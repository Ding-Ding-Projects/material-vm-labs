# Closeout prompt

Copy the block below into a new session to finish the open work recorded in `HANDOFF.md`.

```text
Repository: material-vm-labs (branch main). Read HANDOFF.md, AGENTS.md and docs/features/README.md first.

Finish the open items, one at a time, checking each by running it:
1. Wire companion/src/shared/updates-ipc.js into companion/src/manager/main.js
   (register(ipcMain, app, { busy, quit })) and expose window.mvlUpdates in the manager preload.
   Add the records scripts and stylesheet to every app page, after i18n-zh-hk.js for the
   Cantonese file and before i18n.js.
2. Stamp a unique package version per release so Squirrel.Windows applies updates.
3. Handle Squirrel.Windows install and first-run events in the manager's main process.
4. Add --run, /run and RUN_AFTER_BUILD=1 to build.bat and call scripts/run-after-build.ps1 after a
   successful build; silent mode launches only with /s /run.
5. Add commitUtc to companion/generated/docs.json in companion/tools/prepare.mjs.
6. Record SHA-256 digests for a portable Git and the .NET 8 SDK in dependencies.json.
7. On a real Windows host: run download-dependencies.bat cold and warm, .\build.bat --run,
   build-installer.bat, install, then publish a newer release and watch the update arrive.
8. Upload social-preview.png as the repository's social preview (manual GitHub setting) and read
   the Open Graph tags back from the deployed site.

Rules: plain English, never claim a check that was not run, keep everything unsigned and say so,
update the matching docs/features article and ROADMAP.md with each change, and run the leak scan
and node --test tests/*.test.mjs before committing. Update HANDOFF.md at the end.
```
