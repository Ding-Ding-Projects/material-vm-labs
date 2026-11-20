# Security model

**Never on the host:** no change to your sign-in, UAC prompt or power state, and no bypass
of anything. Installing a hypervisor needs `--approve`, and its native UAC prompt is
answered by the person at the keyboard. `install-cli` writes one shim file; no PATH edit.

**Secrets handling:**

- The tracked answer-file template has placeholders only; a guard test fails if a real value appears.
- Each machine's guest password is the default `1234` unless `--password-stdin` or
  `--random-password` (CSPRNG) is used. It is stored only as a DPAPI blob for the current Windows
  user and opens only that throwaway guest. Remote Desktop is on inside every guest with Network
  Level Authentication; with the default password and `bridged` networking anyone on the LAN can
  sign in, and `mvl` warns about it. NAT stays the default.
- `mvl rdp` saves the guest credential as `TERMSRV/<ip>` in the current user's Credential
  Manager so Remote Desktop opens signed in; `mvl rm` deletes it.
- The per-machine answer file uses Setup's encoded (not encrypted) password form, lives only on the
  seed image, and the seed image is deleted once the baseline is taken.
- A self-hosted runner registration token comes on standard input and reaches the guest only through the
  hypervisor's in-memory guest variable, cleared straight after use.
- Hypervisor guest operations receive the throwaway guest password as a process argument on the
  host. It opens only that disposable guest.

**Inside the guest:** no you credentials and no real data. Clipboard, drag-and-drop and shared
folders are off. Networking is NAT (or host-only). Self-hosted runners only for private repositories.

**Not done, on purpose:** User Account Control is never lowered in the guest, and Defender stays
on, so a fresh-build receipt reflects a real fresh host.
