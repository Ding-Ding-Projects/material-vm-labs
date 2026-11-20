# Phone-size PDF edition

The whole documentation as a PDF with phone-size pages and a linked table of contents.

Status: **Shipped**.

## What it does

`node scripts/build-docs-pdf.mjs` renders the built site into `material-vm-labs-docs.pdf`, and the release workflow attaches it to every release.

## How to use it

Download it from the latest release, or build it with `node scripts/build-site.mjs` then `node scripts/build-docs-pdf.mjs`.

## How it was checked

The release workflow builds it on every release.

## Suggested articles

- [Offline documentation inside the apps](offline-documentation.md)
- [Link previews](link-previews.md)
- [All features and their status](README.md)
