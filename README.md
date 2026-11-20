# Material VM Labs

Throwaway Windows 11 machines, installed unattended from official Microsoft evaluation media, for
proving that a repository's `build.bat`, `build-installer.bat` and installers really work on a fresh
host with no dependencies. A lab machine can also host a self-hosted runner for a **private** repository.

- **VMware Workstation first, VirtualBox fallback**, chosen and reported every run.
- **One command to a ready machine**: unattended install, guest tools, clean baseline snapshot.
- **Fresh-environment receipts**: a fresh clone at an exact commit, entrypoints run with `/s`,
  logs, artifacts and every dependency the build had to download, all bound to that commit.
- **Fast CLI for agents** (`mvl`, terse lines, `--json`) and a keyboard **TUI** for you.
- **Remote Desktop pre-opened**, the IP on every listing, NAT or bridged with an automatic NAT
  fallback, and your own guest sign-in (default password `1234`).
- **No secrets in the answer-file template**: placeholders only; each machine's guest password is
  DPAPI-protected in its own folder, and the seed image is deleted after use.

## Fresh Windows: build and run

```bat
build.bat
```

Silent (GitHub Actions, scheduled tasks, agents): `build.bat /s`. Installer: `build-installer.bat /s`.

## Quick start

```bat
mvl.bat install-cli                      :: puts `mvl` on PATH (per-user, no PATH edit)
mvl hv                                   :: which hypervisor will be used and why
mvl media                                :: fetch or re-check the official evaluation ISO
mvl up proof-1 --project my-repo      :: create (first time) or reset+start
mvl ip proof-1                           :: its IP address
mvl rdp proof-1                          :: Remote Desktop, already signed in
mvl net proof-1 bridged                  :: own LAN address (falls back to NAT if none arrives)
mvl build proof-1 --repo owner/name --entry build,build-installer --evidence evidence\receipts
mvl rm proof-1 --yes                     :: destroy it all
mvl tui                                  :: interactive manager
```

State lives in `%LOCALAPPDATA%\MaterialVmLabs` (override with `MVL_HOME` or `--home`).

## Documentation

Start at [docs/README.md](docs/README.md): creating a lab machine, fresh-build receipts, self-hosted
runners, the CLI, media verification, hypervisor behaviour and the security model.

Status: [ROADMAP.md](ROADMAP.md) · Changes: [CHANGELOG.md](CHANGELOG.md)
