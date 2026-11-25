# Squirrel installer, unsigned

The apps install with Squirrel.Windows: `MaterialVmLabsSetup.exe`, `RELEASES` and the full package.

Status: **Shipped**.

## What it does

`build-installer.bat` produces the three Squirrel.Windows files in `dist\installer`, and every release attaches them with their SHA-256.

Running `MaterialVmLabsSetup.exe` installs the manager into `%LOCALAPPDATA%\MaterialVmLabs`,
adds Start menu and desktop shortcuts, and then opens the manager. Squirrel starts the app with
`--squirrel-install` (shortcuts are created, then it quits) and then `--squirrel-firstrun`, which
opens the window normally. Uninstalling removes the shortcuts.

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
