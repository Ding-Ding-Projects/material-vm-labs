# Ubuntu and Debian lab machines

Besides Windows 11, a lab machine can be a disposable **Ubuntu 24.04 LTS** or **Debian 13**
machine with **Docker** and the **Codex CLI** already inside.

```bat
mvl new ubu-1 --os ubuntu
mvl new deb-1 --os debian
```

In the manager: **+ Create a new one**, then choose the system.

## How it is built

| Step | Ubuntu 24.04 LTS | Debian 13 |
| --- | --- | --- |
| Official image | `noble-server-cloudimg-amd64.vmdk` from cloud-images.ubuntu.com | `debian-13-genericcloud-amd64.raw` from cloud.debian.org |
| Verified against | the published `SHA256SUMS` | the published `SHA512SUMS` |
| Disk | copied into a growable VMware disk, grown to 40 GB | converted to VMDK with `VBoxManage convertfromraw`, then the same |

cloud-init then runs from a `CIDATA` seed image: it creates the user (password `1234` by default,
plus an SSH key made for this machine), installs open-vm-tools, Git, Node.js and npm, installs
Docker with Docker's official script (`get.docker.com`) and adds the user to the `docker` group,
installs the Codex CLI with `npm install -g @openai/codex`, signals ready and powers off.
The clean baseline is taken then, exactly like a Windows lab machine, so `mvl reset` returns to
a machine with Docker and the CLI installed and nobody signed in.

## Using one

- `mvl ssh <name>` opens an SSH session with the machine's own key (kept in its VM folder).
- `mvl ip`, `start`, `stop`, `reset`, `rm` and `shot` work as for Windows.
- `mvl build`, `install`, `rdp`, `passwd` and `runner` are Windows only and refuse a Linux machine.
- Created for you, the machine also gets the shared folder, mounted at `/mnt/shared` (and
  `~/shared`) through VMware's shared folders.
- Sign in to Codex yourself inside the machine with `codex login` (or `codex login
  --device-auth` over SSH). Claude never signs in on any lab machine.

## Limits

- VMware Workstation first. `--hv virtualbox` creates the machine on VirtualBox instead: the image
  becomes a VDI, readiness is the guest powering itself off at the end of cloud-init, SSH goes
  through a NAT forward on `127.0.0.1` (`mvl ssh` picks the port), the serial console is kept in
  the machine's `serial.log`, and there is no shared folder (it needs Guest Additions; use `scp`).
- On a PC where Hyper-V is on, VirtualBox runs in its slow NEM mode. On this maintainer's PC an
  Ubuntu machine did not finish cloud-init within 40 minutes (2026-11-19), and a second run with a
  240-minute limit (2026-11-20) also timed out: Docker was installed inside, but the guest kept
  stalling (kernel soft lockups of up to 508 s) and never reached the final power-off. VMware is the
  route on such a PC; the VirtualBox path needs a PC with Hyper-V off to be proved end to end.
- The images are the "current" builds of each release, so two machines set up on different days
  may differ; the image hash is recorded in the machine's `vm.json`.
