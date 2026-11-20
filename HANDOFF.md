# Handoff

Factual notes for whoever picks this repository up next. Written against the working tree on top
of commit `60f2395` on `main` (2026-11-20). Several pieces of work were in progress in the same tree
at the time; anything below that is not marked as checked has not been checked.

## What changed in this round: updates, provenance, dependencies and repository records

| Area | Files | State |
| --- | --- | --- |
| Automatic updates (main process) | `companion/src/shared/updates-ipc.js` | Built, unit-tested. Not yet registered in any app's main process. |
| Updates tool, update banner | `companion/renderer/shared/tools/records-updates.js`, `records-updates.css`, `records-zh-hk.js` | Built; checked in headless Chromium with a stubbed update service. Not yet added to the app pages. |
| Front-screen version line | `companion/renderer/shared/tools/records-provenance.js`, `site/assets/provenance.js`, `site/pages/home.html`, `scripts/build-site.mjs` | Site line built and read back from the built page. App line checked with a stub; not yet added to the app pages. |
| Dependency fetcher | `dependencies.json`, `download-dependencies.bat`, `download-dependencies.sh`, `scripts/download-dependencies.ps1`, `scripts/dependency-manifest.mjs`; one call line in `build.bat` and `build-installer.bat` | Linux script run cold, warm, tampered file, interrupted swap, unreadable journal and two at once. Windows scripts not run (no Windows host here). |
| Fresh build and run | `scripts/run-after-build.ps1`, `dependencies.json` (`build` section) | Launch checks written. `build.bat` does not read `--run` yet. Not run. |
| Human time estimate | `scripts/human-time-estimate.mjs`, `.github/workflows/release.yml` | Script run locally; workflow change not yet exercised by a release. |
| Link previews | `social-preview.png`, `scripts/make-social-preview.mjs`, `scripts/build-site.mjs` | Picture generated; tags read back from the locally built `index.html`; served copy proven byte-identical. Not read back from the deployed site. |
| Repository records | `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `HANDOFF.md`, `CLOSEOUT_PROMPT.md` | Written. |
| Feature articles | `docs/features/*.md` (24 articles), `docs/features/README.md`, `ROADMAP.md` | Written; the site builds with them. |
| Vocabulary lock | `scripts/check-vocabulary.mjs`, `.githooks/pre-push` | Checked locally: skip with no source, fail with no lock, pass after relock, fail when stale, refuse a source inside the repository. Not yet called from `scripts/build.ps1`; the hook needs `git config core.hooksPath .githooks` once per clone. |
| Design boards | `design/canvases/03-tools/records/` | Two boards and a `canvas.fragment.json` to merge into the canvas index. |

## Evidence

- `node --test tests/records.test.mjs`: 15 passed, 0 failed (update state machine, version
  comparison, feed and package verification, coming-soon stages, the estimate and the manifest).
- `node scripts/dependency-manifest.mjs`: valid, 5 pinned with SHA-256, 2 detected only.
- `node scripts/build-site.mjs` passes when the in-progress `docs/extensions/` draft is left out; with
  that draft present it fails on links to its `samples/` folders, which belong to that work.
- The leak scan over the whole tree reported no findings.

## Remaining work

1. Register `updates-ipc.js` in the manager's main process and expose `window.mvlUpdates` in its
   preload; add the records scripts and stylesheet to each app page.
2. Make each release stamp a unique package version (for example `0.1.0-build42`). Until then the
   updater correctly reports that Squirrel.Windows will not apply a package with the installed
   version.
3. Handle the Squirrel.Windows first-run and install events in the manager's main process.
4. Teach `build.bat` the `--run`, `/run` and `RUN_AFTER_BUILD=1` flags and call
   `scripts/run-after-build.ps1` after a successful build.
5. Record SHA-256 digests for a portable Git and the .NET 8 SDK in `dependencies.json` so they can be
   fetched instead of only detected.
6. Record the commit time in `companion/generated/docs.json` (`commitUtc`) so the apps show when the
   source was updated rather than when it was built.
7. Run the Windows fetcher, `.\build.bat --run`, the installer and an update on a real Windows host.
8. Call `node scripts/check-vocabulary.mjs` from `scripts/build.ps1` so a stale lock fails the build.
9. Translate the feature articles into Cantonese for the site's language modes.

## Blocked by something outside the repository

- **Repository social preview**: GitHub's social preview cannot be set through the API. Upload
  `social-preview.png` from the repository root under Settings, General, Social preview.
- **Licence**: there is no `LICENSE` file; choosing a licence is the owner's decision.
- **Pinned Git and .NET digests**: the canonical download sites were not reachable from the
  environment used for this round.
