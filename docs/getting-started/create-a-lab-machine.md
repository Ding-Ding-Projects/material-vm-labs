# Create a lab machine

```bat
mvl new proof-1 --project my-repo
```

Options: `--hv auto|vmware|virtualbox`, `--mem 8192`, `--cpus 4`, `--disk 96`,
`--net nat|bridged|hostonly`, `--user`, `--password-stdin`, `--random-password`, `--require-tpm` (forces VirtualBox, which has a real virtual TPM).

## What happens

1. **Hypervisor**: VMware Workstation if installed and `vmrun` answers; otherwise VirtualBox.
   Neither installed: `mvl hv install --approve` installs VirtualBox through Chocolatey, and the
   native UAC prompt is answered by you. Nothing installs without `--approve`.
2. **Media**: the official Windows 11 Enterprise evaluation ISO is fetched from Microsoft and
   verified (see [media and verification](../reference/media-and-verification.md)).
3. **Answer file**: `autounattend.xml` is generated from the tracked template with the guest
   account (`--user`, default `mvlbuilder`) and password (`--password-stdin`, `--random-password`,
   default `1234`). The password is stored only as a DPAPI blob (`guest-credential.dpapi`) in the
   machine's folder, readable by your Windows user. Remote Desktop is turned on at first logon.
4. **Seed image**: the answer file plus `mvl\firstlogon.ps1` go into a small ISO built with the
   Windows IMAPI2 API, so either hypervisor can read it.
5. **Install**: the machine boots the installer; `mvl` answers the "press any key" prompt with six
   key presses in six seconds, then leaves the guest alone.
6. **First logon**: guest tools install, sleep is turned off inside the guest, readiness facts are
   written to `C:\MaterialVmLabs\ready.json`, the host is signalled and the guest shuts down.
7. **Baseline**: install media are detached, the seed image (which held the encoded password) is
   deleted, and snapshot `mvl-baseline` is taken. Status becomes `ready`.

Typical time: 25 to 50 minutes. A guest screenshot is saved to the machine's `provisioning\` folder
every five minutes, and `mvl shot <name>` takes one on demand.

## If it fails

Status becomes `failed`, the error is stored in `vm.json` and a `failure.png` screenshot is saved.
`mvl rm <name> --yes` cleans up completely.
