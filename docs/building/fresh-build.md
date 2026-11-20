# Run a fresh-environment build

```bat
mvl build proof-1 --repo owner/name --ref <sha> --entry build,build-installer --evidence evidence\receipts
```

1. A **fresh clone** of the repository is made on the host (HTTPS, your own `git` credentials stay on
   the host), checked out at `--ref` or the default branch's head, then zipped.
2. The lab machine is **reset to `mvl-baseline`** (skip with `--no-reset`) and started.
3. The zip and `run-build.ps1` are copied in through the hypervisor's guest channel.
4. Inside the guest, `run-build.ps1` records installed programs, PATH entries, tools on PATH and
   Chocolatey packages; runs each entrypoint as `<entry>.bat /s` with `SILENT=1`, stopping at the
   first failure; records everything again; and collects installers, packages and archives
   written during the run (up to 1.5 GB copied, every one hashed).
5. Logs, `result.json` and artifacts come back to `%LOCALAPPDATA%\MaterialVmLabs\runs\<run-id>\`, and
   `receipt.json` is written. `--evidence <dir>` also copies the receipt and logs there.

The exit code is 0 only when every entrypoint passed.

## Elevation inside the guest

Guest programs run as the generated `mvlbuilder` account through the hypervisor's guest
operations. The receipt's `guestElevated` field records whether that token was elevated. Nothing
lowers User Account Control in the guest; a build that needs administrator rights and runs unelevated
is reported exactly as it happened.
