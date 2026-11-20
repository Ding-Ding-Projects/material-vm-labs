# One-command fresh build and run

`.\build.bat --run` on a fresh Windows PC fetches everything, builds, checks the result and then starts the manager.

Status: **In progress**.

## What it does

`build.bat` calls the dependency fetcher, runs the build, and with `--run` (also `/run` or
`RUN_AFTER_BUILD=1`) hands over to `scripts/run-after-build.ps1`. That script starts the default
target from `dependencies.json` only when the source has no uncommitted or untracked change, the
checkout is the commit embedded in the build, and the portable executable and its `app.asar` exist
and are not empty. It never builds, installs or elevates anything.

## How to use it

```powershell
.\build.bat --run
```

Silent automation needs both flags, `/s /run`, so a silent build never starts an app unexpectedly.

## Status and what is left

The launch checks and the shared manifest are built. The `--run` flag still has to be read by `build.bat` itself. It has no recorded check yet on a real Windows host running a built release; that is listed under "Not yet verified" in the roadmap.

## Suggested articles

- [Dependency fetcher](dependency-fetcher.md)
- [Build entry points](build-entry-points.md)
- [Run a fresh-environment build](../building/fresh-build.md)
