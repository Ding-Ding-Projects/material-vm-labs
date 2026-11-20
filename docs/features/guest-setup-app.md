# Guest Setup app

Inside a Windows lab machine, the Setup app walks the owner through tools, sign-in, the shared folder and a final check.

Status: **Shipped**.

## What it does

Six steps with Back, Skip and resume after a restart. Installs run in a scheduled task, never in
the app itself, and no password or token is ever read by it.

## How to use it

The app ships in the portable zip (`guest-setup\out\MaterialVmLabsSetup.exe`) so an owner machine can be set up without the .NET SDK.

## How it was checked

`build.bat` builds it as one self-contained executable. A Material 3 restyle is still in progress. It has no recorded check yet on a real Windows host running a built release; that is listed under "Not yet verified" in the roadmap.

## Suggested articles

- [Create a lab machine for you](../getting-started/set-up-for-you.md)
- [Create a lab machine with one command](lab-machines.md)
- [Build entry points](build-entry-points.md)
