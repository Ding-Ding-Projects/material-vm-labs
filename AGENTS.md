# Working on Material VM Labs

This guide is for anyone, person or coding agent, who changes this repository.

## What lives where

| Path | What it is |
| --- | --- |
| `src/` | The `mvl` command line, the keyboard TUI and the `MaterialVmLabs` PowerShell module (machines, media, receipts, runners, guest scripts). |
| `guest-setup/` | The C# Setup app that runs inside a Windows lab machine. |
| `companion/` | The three Electron apps: the manager, the documentation reader and the build GUI. Main-process code is in `companion/src/`, screens in `companion/renderer/`. |
| `companion/renderer/shared/tools/` | Tools shown in every app's Tools surface. |
| `docs/` | Every documentation article. The site and the in-app reader are built from these files. |
| `site/` and `scripts/build-site.mjs` | The GitHub Pages site and its builder. |
| `design/canvases/` | The design boards each screen is built from. |
| `tests/` | `run-tests.ps1` (PowerShell suite) and `*.test.mjs` files (`node --test`). |
| `dependencies.json` | Pinned dependency versions and SHA-256 digests, read by `download-dependencies.bat` and `download-dependencies.sh`. |

## Build, test and check

```bat
download-dependencies.bat /s      :: pinned Node.js and npm packages, verified
build.bat /s                      :: tests, zip, guest Setup, portable apps
build-installer.bat /s            :: unsigned Squirrel.Windows installer
.\build.bat --run                 :: fresh Windows: fetch, build, verify, then start the manager
```

On Linux or macOS: `./download-dependencies.sh`, then `node --test tests/*.test.mjs` and
`node scripts/build-site.mjs`. The Windows apps and installer build only on Windows.

## Rules that keep the project honest

- Never fake data, results or capabilities. A feature that is not fully working shows as
  unavailable with its exact reason, in the app and in `docs/features/`.
- Nothing is code-signed. Release notes, the installer and the update banner say so plainly and
  never claim a signature or verified publisher.
- Destructive actions use the two-key confirmation. Long operations stream real output and can be
  cancelled.
- The renderer has no network, no file system and no child processes. Anything that needs them is
  a main-process module in `companion/src/shared/` with strictly validated IPC arguments and
  argument arrays, never a shell string built from input.
- Every visible string is plain English with a Hong Kong Cantonese translation, works with the
  keyboard and a screen reader, fits a 390 px wide window, and works with motion turned off.
- Update the matching article in `docs/`, `docs/features/README.md` and `ROADMAP.md` in the same
  change as the behaviour.
- Dependencies are pinned with a digest in `dependencies.json`; fetched files never go into the
  repository.

<details>
<summary>Shared engineering instructions (sanitized mirror)</summary>

This is a sanitized mirror of the maintainer's shared engineering instructions, kept so that
contributors here can see the rules without access to the private source. Do not edit it expecting
the change to spread: changes are made in the canonical instructions first and mirrored here.
Machine names, accounts, hosts, addresses, paths and credentials are generalized, and the private
conversation vocabulary is left out entirely.

- **Plan before building.** Agree the goal, write a short plan and design each screen before
  code. Build one step at a time and check each step really works before calling it done.
- **Prove, do not assert.** Run the thing, read its real output, and report exactly what passed,
  what failed and what was not checked. A green workflow, a written config or a passing unit test
  is not proof that a user-facing feature works.
- **Truthful interfaces.** Every control does what its label says; empty, loading, offline and
  error states say what is true and what to do next; nothing is invented to look live.
- **Accessible and localized.** Keyboard and screen-reader operable, 48 px targets, light and dark,
  reduced motion, and the supported languages.
- **Search everywhere has a regex builder**, and `Ctrl+Shift+F` opens the command palette.
- **Releases.** Every push to the default branch can produce one uniquely tagged release with real
  installable files, their SHA-256 hashes, the line count from the committed counter, a labelled
  human time estimate from that same count, and the measured workflow timing. Releases are
  unsigned and say so.
- **Updates.** Installed apps check for updates in the background, verify the feed and package
  hashes, and install only when the person chooses to restart.
- **Dependencies.** Fetch from canonical sources at pinned versions with recorded digests, into
  per-user folders, with a silent mode and honest per-phase output.
- **Secrets.** Never put a secret in a file, a command line, a log, a screenshot or a chat. Ask for
  it through a short-lived, local, single-use input form instead.
- **Version control.** Keep commits focused, never force-push a shared branch, never commit
  fetched dependencies or build output, and read back the remote state before reporting a push as
  done.
- **Destructive actions** need an explicit two-key confirmation and are never run on someone's
  behalf without it.
- **Hosts.** Build and installer proofs name the real host they ran on, and that host's existing
  installs, settings and data are preserved.

</details>

## Agent conversation vocabulary

Agents working in this repository use the shared private conversation vocabulary defined in
the maintainer's canonical agent instructions for every reply, including chat prose, visible
reasoning, status lines, and task or session titles. Read those instructions and apply them
in full. They are deliberately not restated here, because this file is part of this
repository's public record.

That vocabulary never appears in anything published. Keep it out of commit messages, branch
names, code, code comments, test names, documentation, this file, issues, pull requests,
discussions, release notes, published sites, logs, and every other file in this repository.
Published writing uses ordinary professional English, and exact technical identifiers always
keep their literal spelling. The single documented public-safe exception is named in those
canonical instructions; do not infer any other.

Scan any text bound for a public surface against that vocabulary before publishing it. A
reviewer cannot tell a correct release note from a leaking one by reading it, so the scan is
a step, not a habit.
