# Update coming soon

While a newer build is being made, the Updates tool shows it as **Update coming soon** with its real progress.

Status: **In progress**.

## What it does

The manager reads the public GitHub Actions record of the release workflow. When a run for a newer
commit than yours is in flight, it shows the build number, every stage (source received, waiting its
turn, each workflow step, update feed moved) with its state, the start time and elapsed time in
24-hour time, and an estimate of the time left from the median of recent successful builds, labelled
as an estimate. It lists the commits the build will contain. When the build is published, the block
turns into the ordinary update offer.

## Honest states

A stalled build says so, a failed build says it will not be offered, a newer build replacing it says so, and offline or rate-limited reads show the progress as unknown with the reason. With no build in flight the block is absent.

## Security and limits

It never downloads, installs or restarts anything. It sends no token or account data, polls every 3 minutes while a build runs and every 30 minutes otherwise, and uses conditional requests to stay inside GitHub's anonymous limits.

## Status and what is left

Built and covered by tests, waiting for the same start-up wiring as automatic updates. It has not yet been watched against a real in-flight build.

## Suggested articles

- [Automatic updates](automatic-updates.md)
- [All features and their status](README.md)
- [Build entry points](build-entry-points.md)
