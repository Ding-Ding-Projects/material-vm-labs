# Installer tests

`mvl install` runs your installer in a clean, signed-in guest and records what it did.

Status: **Shipped**.

## What it does

The machine is reset to its baseline, the folders under LocalAppData, AppData, ProgramData and
Program Files are listed, and the installer runs in the signed-in guest session so it behaves the way
a person would see it. After a wait the folders are listed again and a guest screenshot is taken.
The installer receipt records the installer's SHA-256, arguments, exit code and the new folders.

## How to use it

```bat
mvl install proof-1 --file dist\installer\Setup.exe --evidence evidence\installs
```

`--args` passes arguments such as `--silent`; `--wait` sets the seconds to wait (default 60). An
`.msi` runs through `msiexec /i`.

## When something goes wrong

Exit code 0 means only that the installer exited 0. The screenshot is the evidence that it launched; the receipt never claims more than was observed. A machine hosting a self-hosted runner is refused, because the reset would remove the runner.

## How it was checked

It has no recorded check yet on a real Windows host running a built release; that is listed under "Not yet verified" in the roadmap.

## Suggested articles

- [Test an installer on a fresh host](../building/installer-tests.md)
- [Fresh-host build receipts](fresh-build-receipts.md)
- [Squirrel installer, unsigned](squirrel-installer.md)
