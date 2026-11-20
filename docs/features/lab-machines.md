# Create a lab machine with one command

`mvl up` gives you a clean, signed-in Windows 11, Ubuntu 24.04 or Debian 13 machine in one command, and running it again puts the machine back to that clean state.

Status: **Shipped**.

## What it does

`mvl up <name>` creates the lab machine the first time and, on every later run, resets it to its
clean baseline snapshot (`mvl-baseline`) and starts it. Creation installs the system unattended
from official evaluation media, installs the hypervisor's guest tools, turns on Remote Desktop,
writes readiness facts to `C:\MaterialVmLabs\ready.json` inside the guest and takes the baseline
snapshot. Typical time is 25 to 50 minutes. Windows Server 2025 is in preview: `mvl server-media`
inspects its media, but creating a Server machine is not offered yet.

## How to use it

```bat
mvl up proof-1 --project my-repo
```

`mvl new` takes the same options when you only want to create: `--hv auto|vmware|virtualbox`,
`--mem`, `--cpus`, `--disk`, `--net nat|bridged|hostonly`, `--user`, `--password-stdin`,
`--random-password` and `--require-tpm`. In the manager, use **+ Create a new one**.

## Settings

Each machine keeps its own folder under `%LOCALAPPDATA%\MaterialVmLabs\vms\<name>` (change the
root with `MVL_HOME` or `--home`). The guest account defaults to `mvlbuilder` with password `1234`
unless you choose your own.

## When something goes wrong

The machine's status becomes `failed`, the error is stored in `vm.json` and a `failure.png`
screenshot is saved. A guest screenshot is also saved every five minutes while it installs, and
`mvl shot <name>` takes one on demand. `mvl rm <name> --yes` removes everything.

## Security

The tracked answer-file template has placeholders only. The guest password is stored as a DPAPI
blob readable by your Windows user, and the seed image that held the encoded password is deleted
once the baseline is taken. Nothing on your own PC is changed beyond the machine's folder.

## How it was checked

The PowerShell test suite checks the answer file, the placeholder template and name validation on every build. It has no recorded check yet on a real Windows host running a built release; that is listed under "Not yet verified" in the roadmap.

## Suggested articles

- [Create a lab machine](../getting-started/create-a-lab-machine.md)
- [Manage lab machines](../getting-started/manage.md)
- [Hypervisor choice: VMware first, VirtualBox fallback](hypervisor-choice.md)
