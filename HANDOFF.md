# Handoff

Factual notes for whoever picks this repository up next. Written against commit `0deb6fe` on
`main` (2026-11-20), with a clean working tree. Anything below that is not marked as checked has not
been checked.

## State at this handoff

- Every tool lane has landed on `main`: data tools, developer tools, regex, safety tools, records and
  updates, system suites (Ollama, Minecraft servers, virtual disks), personal settings, the manager
  extras (exports, bulk actions, settings history, changelog) and guidance (guided controls,
  extensions, the external editor, drawing).
- The Tools window loads 27 tools in the manager and 24 in the documentation reader and the build
  companion.
- The documentation site builds 47 pages and 314 searchable sections and deploys from `main`.

## Evidence

- All 13 `tests/*.test.mjs` files passed in a clean worktree of `959e333`.
- Headless Chromium loaded every tool in all three companions: none failed to start, no page errors.
- `node scripts/build-site.mjs`: 47 pages, link check passing.
- GitHub Actions on `e05c3a4`: the Windows build got past the dependency fetch, then its offline suite
  failed on 3 PowerShell scripts without a UTF-8 BOM. `0deb6fe` adds the mark to those 3 scripts and
  to the module. Its build run was cancelled when a later commit landed; its release run finished
  as `v0.1.0-build00016-build.16`.
- Documentation site workflow: green on `9cad6c7`, and GitHub records a `github-pages` deployment of
  `9cad6c7`. The About homepage already points at `https://ding-ding-projects.github.io/material-vm-labs/`.
  The live pages were not opened from this environment, because its network does not reach `github.io`.
- Release `v0.1.0-build00018-build.18` on `9cad6c7`: build, release and site workflows all green. Not a
  draft or prerelease. Carries the Squirrel `MaterialVmLabsSetup.exe`, `RELEASES` and the full
  `.nupkg`, the three portable companions, the zip and the documentation PDF. `RELEASES` was
  downloaded and its SHA-256 matches the published digest.
- Leak scan over the tree: no findings.

## Fixed in this round

- `download-dependencies.bat` re-parsed the whole PATH through `call set`. That broke on the Windows
  runner, so `powershell.exe` could not be found and every build and release from `a05666e` to
  `959e333` failed. The fetcher now writes one line that the batch file adds with a single `set`. The
  batch files and child shells start Windows PowerShell by its full system path.
- The clear-button wrapper from the guidance lane collapsed the Minecraft seed field to 19 px tall.
  The wrapped field no longer grows by flex basis, and the seed row's wrapper takes the growth.
- Done from the previous handoff's list:
  - updates registered in the manager;
  - a unique package version for each release (`<base>-buildNNNNN`);
  - Squirrel events handled;
  - `build.bat --run`;
  - the vocabulary lock checked from `scripts/build.ps1`.

- `companion/tools/prepare.mjs` now records the commit time (`commitUtc`) in `docs.json` and the
  source manifest, so the apps' version line says when the source was updated. Run locally: the stamped
  time matched `git log -1 --format=%cI`.

## Remaining work

1. Record SHA-256 digests for a portable Git and the .NET 8 SDK in `dependencies.json` so they can be
   fetched instead of only detected.
2. On a real Windows host, run four things:
   - the fetcher;
   - `.\build.bat --run`;
   - the installer;
   - an update.
   
   Then exercise the paths that only exist there: real Ollama, Minecraft, virtual disks and lab
   machine creation.
3. Translate the feature articles into Cantonese for the site's language modes.
4. The agent recovery branch on the remote (the one whose tip is `f04cd19`) holds two recovery snapshots
   (`09667d5`, `f04cd19`) of work that later landed on `main` in finished form. They are not ancestors
   of `main`, so the branch was kept. Delete it only after someone confirms that nothing on it is
   still needed.

## Blocked by something outside the repository

- **Repository social preview**: GitHub's social preview cannot be set through the API. Upload
  `social-preview.png` from the repository root under Settings, General, Social preview.
- **Licence**: there is no `LICENSE` file; choosing a licence is the owner's decision.
- **Pinned Git and .NET digests**: the canonical download sites were not reachable from the
  environment used for this round.
