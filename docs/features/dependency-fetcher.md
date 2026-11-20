# Dependency fetcher

`download-dependencies.bat` (and `download-dependencies.sh` on Linux and macOS) fetch the pinned dependencies and check each one's SHA-256.

Status: **In progress**.

## What it does

It reads `dependencies.json`, downloads each pinned dependency for your platform from its canonical
source into a per-user folder (`%LOCALAPPDATA%\MaterialVmLabs\deps`, or
`~/.cache/material-vm-labs/deps`), checks the SHA-256 before extracting, and activates it with a
locked, journaled swap that keeps the previous good copy. Then it installs the npm packages from
their lock files. A warm run checks every recorded file hash again and skips the download; a changed
file is fetched again. An interrupted or unreadable journal is recovered from the verified copies.

## How to use it

```bat
download-dependencies.bat /s
```

`/s`, `--silent` or `SILENT=1` never prompts (it does not prompt in any mode). `build.bat` and
`build-installer.bat` call it first. On Linux or macOS, `./download-dependencies.sh` and
`eval "$(./download-dependencies.sh --print-path)"` to put the tools on PATH.

## When something goes wrong

The first problem prints `problem:` with the dependency, version, source and reason, and the script exits non-zero.

## Security

No administrator rights, no secrets, no signing certificates, and nothing fetched goes into the repository.

## Status and what is left

Node.js is pinned with SHA-256 for Windows, Linux and macOS. Git and the .NET 8 SDK have no
recorded digest yet, so they are only detected, and the existing Chocolatey route still installs
them. The Linux script was run cold, warm, with a tampered file, an interrupted swap, an unreadable
journal and two runs at once. The Windows script has not yet been run on a real Windows host.

## Suggested articles

- [One-command fresh build and run](fresh-build-and-run.md)
- [Build entry points](build-entry-points.md)
- [Run a fresh-environment build](../building/fresh-build.md)
