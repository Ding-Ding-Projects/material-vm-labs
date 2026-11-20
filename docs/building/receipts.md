# Read a receipt

`receipt.json` (schema `material-vm-labs/fresh-build-receipt/1`):

| Field | Meaning |
| --- | --- |
| `verdict` | `passed` only when every entrypoint exited 0 |
| `repository`, `commit` | The exact commit that was cloned fresh |
| `remoteHeadAtRun` | The remote's default head at run time, so a stale `--ref` is visible |
| `entrypoints[]` | Each entrypoint, exit code, minutes and log file |
| `guestElevated` | Whether the guest build ran with administrator rights |
| `machine` | Name, hypervisor and version, baseline, reset flag, RAM, vCPUs, network, TPM mode, guest OS, `tpmPresent`, `secureBoot`, what was preinstalled at baseline |
| `media` | ISO file, SHA-256, Microsoft host, signature verdict |
| `dependenciesAcquired` | Tools newly on PATH, programs installed, Chocolatey packages added, new PATH entries |
| `artifacts[]` | Every produced installer, package or archive with bytes and SHA-256 |

## What a receipt proves, and what it does not

It proves that this exact commit built in a Windows 11 machine that started from a clean
unattended install with no developer dependencies. It is fresh-environment proof, reported separately
from proof on your own host; neither stands in for the other. Hypervisor guest tools are
present in the guest (they are how files move in and out) and are listed in `ready.json`.
