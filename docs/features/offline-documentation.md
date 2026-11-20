# Offline documentation inside the apps

Every article in this documentation is bundled into the apps at build time and readable offline, with search.

Status: **Shipped**.

## What it does

At build time every Markdown file under `docs/`, plus the README, roadmap and handoff notes, is
rendered to HTML and bundled. The documentation reader and the manager's Docs destination show it
with search; links between articles open inside the app and images are embedded.

## When something goes wrong

A link to a file that is not bundled shows as a dead link with the missing path. A build check that fails when an article is missing from the bundle is still to come.

## How it was checked

The bundle is produced by `companion/tools/prepare.mjs` on every companion build.

## Suggested articles

- [Phone-size PDF edition](pdf-edition.md)
- [Version and build time on the first screen](version-on-first-screen.md)
- [All features and their status](README.md)
