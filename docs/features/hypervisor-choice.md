# Hypervisor choice: VMware first, VirtualBox fallback

Every run picks VMware Workstation when it is usable and falls back to VirtualBox, and tells you which one and why.

Status: **Shipped**.

## What it does

VMware Workstation is chosen when it is installed, `vmrun list` answers and its Windows tools
media exists. Otherwise VirtualBox is used. Both run with UEFI and Secure Boot. VirtualBox has a
real virtual TPM 2.0; on VMware a virtual TPM cannot be added through automation, so `mvl` adds a
setup requirement waiver inside the throwaway guest and records `tpmMode` in every receipt.

## How to use it

```bat
mvl hv
mvl hv install --approve
```

`mvl hv` prints the choice and the reason. With neither installed, `mvl hv install --approve`
installs VirtualBox through Chocolatey, and you answer the Windows UAC prompt yourself. Use
`--hv vmware|virtualbox` on `mvl new` to force one, or `--require-tpm` to force VirtualBox.

## When something goes wrong

On a PC where Hyper-V is active, VirtualBox runs in a slower mode and can stall during Windows
Setup; `mvl hv` warns about it. Use VMware on such a PC, or turn Hyper-V off yourself.

## Security

Nothing is installed without `--approve`, and `mvl` never changes your sign-in, UAC or power state.

## How it was checked

The VMware and VirtualBox findings in the hypervisors reference were observed on 2026-11-17. It has no recorded check yet on a real Windows host running a built release; that is listed under "Not yet verified" in the roadmap.

## Suggested articles

- [Hypervisors](../reference/hypervisors.md)
- [Create a lab machine with one command](lab-machines.md)
- [Security model](../reference/security.md)
