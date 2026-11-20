# Command line and keyboard TUI

`mvl` prints short lines or JSON for scripts and agents, and `mvl tui` is a keyboard manager for people.

Status: **Shipped**.

## What it does

Every command runs on the stock Windows PowerShell 5.1. `--json` prints one compact JSON object,
with errors as `{"ok":false,"error":"..."}`. Exit codes are `0` done, `1` problem (including a
failed build) and `2` bad usage. `mvl tui` drives the same commands from single keys.

## How to use it

```bat
mvl.bat install-cli
mvl ls --json
mvl tui
```

`install-cli` writes one `mvl.cmd` shim into `%LOCALAPPDATA%\Microsoft\WindowsApps`; it does not edit
PATH.

## How it was checked

The PowerShell test suite runs on every build. It has no recorded check yet on a real Windows host running a built release; that is listed under "Not yet verified" in the roadmap.

## Suggested articles

- [CLI](../reference/cli.md)
- [Manage lab machines](../getting-started/manage.md)
- [Create a lab machine with one command](lab-machines.md)
