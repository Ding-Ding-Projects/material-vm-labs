# Squirrel installer, unsigned

The apps install with Squirrel.Windows: `MaterialVmLabsSetup.exe`, `RELEASES` and the full package.

Status: **Shipped**.

## What it does

`build-installer.bat` produces the three Squirrel.Windows files in `dist\installer`, and every release attaches them with their SHA-256.

## Security

Nothing is code-signed. Both workflows check that every setup executable reports `NotSigned`, and
the release notes say so. Windows may show an unknown-publisher or SmartScreen warning; check the
SHA-256 on the release page.

## How it was checked

The `build` and `release` workflows build and check it on every push. It has no recorded check yet on a real Windows host running a built release; that is listed under "Not yet verified" in the roadmap.

## Suggested articles

- [Automatic updates](automatic-updates.md)
- [Build entry points](build-entry-points.md)
- [Security model](../reference/security.md)
