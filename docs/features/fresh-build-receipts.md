# Fresh-host build receipts

`mvl build` proves that an exact commit of a repository builds on a clean machine, and writes a receipt that says what happened.

Status: **Shipped**.

## What it does

It makes a fresh clone at the commit you name, resets the lab machine to its baseline, copies the
source in, and runs each entry point as `<entry>.bat /s` with `SILENT=1`, stopping at the first
failure. It records the programs, PATH entries and Chocolatey packages before and after, so the
receipt lists every dependency the build had to download, and it collects and hashes every
installer, package or archive the build wrote.

## How to use it

```bat
mvl build proof-1 --repo owner/name --ref <sha> --entry build,build-installer --evidence evidence\receipts
```

The exit code is 0 only when every entry point passed.

## Settings

`--no-reset` skips the reset; `--evidence <dir>` copies the receipt and logs to a folder of your choice.

## When something goes wrong

The receipt's `verdict` is `failed` with each entry point's exit code and log. A build that needs administrator rights and ran unelevated is reported exactly as it happened.

## Security

Your Git credentials stay on the host; only a zip of the clone goes into the guest. User Account Control and Defender stay on in the guest so the result reflects a real fresh host.

## How it was checked

The receipt schema is documented and read by the manager's Receipts screen. It has no recorded check yet on a real Windows host running a built release; that is listed under "Not yet verified" in the roadmap.

## Suggested articles

- [Run a fresh-environment build](../building/fresh-build.md)
- [Read a receipt](../building/receipts.md)
- [Installer tests](installer-tests.md)
