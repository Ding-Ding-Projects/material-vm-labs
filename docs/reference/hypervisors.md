# Hypervisors

| | VMware Workstation (first choice) | VirtualBox (fallback) |
| --- | --- | --- |
| Chosen when | installed and `vmrun list` answers, and `windows.iso` tools media exists | VMware missing or unusable |
| Firmware | UEFI with Secure Boot | UEFI with Secure Boot (Microsoft keys enrolled) |
| TPM | **No vTPM through automation** (see below) | Real virtual TPM 2.0 |
| Disk / bus | NVMe, growable `.vmdk` | SATA, dynamic `.vdi` |
| Guest channel | VMware Tools, `vmrun` guest operations, `guestinfo` variables | Guest Additions, `guestcontrol`, guest properties |
| Screenshot / keys | `vmcli MKS captureScreenshot` / `sendKeySequence` | `controlvm screenshotpng` / `keyboardputscancode` |

## The VMware virtual TPM finding (2026-11-17)

On VMware Workstation 26.0.1 a probe machine with `managedVM.autoAddVTPM = "software"` started
through `vmrun` booted normally, but no vTPM was added. A vTPM there needs VM encryption with a
password set in the Workstation UI, which automation cannot do without storing a secret. So on VMware,
`mvl` keeps real UEFI Secure Boot and adds a **setup requirement waiver** inside the guest's own
Windows Setup (`HKLM\SYSTEM\Setup\LabConfig` `BypassTPMCheck` and `BypassSecureBootCheck`). It
touches only the throwaway guest, and every receipt records `tpmMode`. When a build genuinely needs
a TPM, use `--require-tpm` or `--hv virtualbox`.

## VirtualBox under Hyper-V (2026-11-17)

On a PC where Hyper-V is active (WSL, Windows Sandbox or the Default Switch turn it on),
VirtualBox runs in its slower NEM mode. A VirtualBox lab machine there boots the installer and
runs Windows Setup to about 77%, then stalls after the reboot: `VBox.log` logs
"Giving up catch-up attempt at a 60 s lag" again and again and the disk stops growing. `mvl hv`
warns about this. Use VMware on such a PC, or turn Hyper-V off (a host change that needs a
restart, which `mvl` never does for you).

VirtualBox also reaches the "press any key to boot from CD" prompt much later than VMware, so on
VirtualBox `mvl` boots DVD first and presses the key only while the guest screen looks like that
prompt.

## Other VMware notes

- NVMe needs the `pciBridge4..7` PCIe root ports in the `.vmx`, or power-on fails with
  "No PCIe slot available for nvme0".
- The UEFI "press any key to boot from CD" prompt is answered with six key presses in six seconds.
  A longer burst reaches Setup's focused Cancel button and opens its quit dialog.
