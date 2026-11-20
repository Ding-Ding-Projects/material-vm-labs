# Contributing

Thank you for helping. Material VM Labs makes throwaway lab machines for proving that builds and
installers work on a fresh host, plus three desktop apps and a documentation site around them.

## Before you start

- Read [AGENTS.md](AGENTS.md): where things live, how to build and test, and the rules every change
  follows.
- Check [ROADMAP.md](ROADMAP.md) and [docs/features/README.md](docs/features/README.md) for the
  current status of the feature you want to change.
- For a larger change, open an issue first so the approach can be agreed before you write code.

## Set up

```bat
download-dependencies.bat
build.bat /s
```

On Linux or macOS, `./download-dependencies.sh` fetches the pinned Node.js and the site tools, then
`node --test tests/*.test.mjs` and `node scripts/build-site.mjs` run the JavaScript tests and the
site build. The apps and the installer build only on Windows.

## Making a change

1. Keep the change focused on one thing.
2. Update the article in `docs/`, the status in `docs/features/README.md` and `ROADMAP.md` in the
   same change as the behaviour.
3. Add or update tests for any logic you change. `build.bat /s` runs the PowerShell suite; `node
   --test tests/*.test.mjs` runs the JavaScript tests.
4. Describe in the pull request what you changed, how you checked it, and anything you could not
   check (for example a step that needs a real Windows host).

## What we will not merge

- Anything that fakes a result, hides a failure or claims a capability that does not work.
- Code signing, telemetry, purchases, upgrade prompts or nagging.
- Secrets, credentials, fetched dependencies or build output in the repository.

By contributing you agree to follow the [code of conduct](CODE_OF_CONDUCT.md).
