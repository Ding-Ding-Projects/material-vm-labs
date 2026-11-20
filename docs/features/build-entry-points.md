# Build entry points

`build.bat` and `build-installer.bat` take a Windows checkout to the apps and the installer.

Status: **Shipped**.

## What it does

`build.bat` fetches the pinned dependencies, parses every script, runs the tests, packages the
portable zip with its SHA-256, builds the guest Setup app and the three portable apps.
`build-installer.bat` builds the unsigned Squirrel.Windows installer. Both pass the real exit code
through.

## How to use it

```bat
build.bat /s
build-installer.bat /s
```

`/s`, `--silent` or `SILENT=1` runs with no prompt.

## When something goes wrong

Each phase prints a `[..]` line when it starts and `[ok]` when it finishes; the first problem prints `problem:` with the reason and the script exits non-zero.

## How it was checked

The `build` workflow runs both on `windows-latest` for every push.

## Suggested articles

- [Dependency fetcher](dependency-fetcher.md)
- [One-command fresh build and run](fresh-build-and-run.md)
- [Squirrel installer, unsigned](squirrel-installer.md)
