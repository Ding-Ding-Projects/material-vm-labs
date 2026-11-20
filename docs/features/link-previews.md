# Link previews

When a link to the site is shared, chat apps show a large picture of the real app.

Status: **In progress**.

## What it does

`scripts/make-social-preview.mjs` renders `social-preview.png` (1280 by 640) at the repository root
from the app icon and a real capture of the manager. The site build copies it under a name that
includes its hash, checks the copy is byte-identical, and writes Open Graph and Twitter tags into
every page: title, description, URL, type, site name, an absolute image URL with width, height and
alt text, `summary_large_image`, and `theme-color`.

## Status and what is left

The site tags are built. The repository's own preview picture is a GitHub setting that cannot be scripted: upload `social-preview.png` from the repository root under Settings, General, Social preview. Reading the tags back from the deployed site is still to do.

## Suggested articles

- [Version and build time on the first screen](version-on-first-screen.md)
- [Phone-size PDF edition](pdf-edition.md)
- [All features and their status](README.md)
