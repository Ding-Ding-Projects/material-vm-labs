# Remote Desktop, SSH, shared folders and network modes

Reach a lab machine the way you need: Remote Desktop already signed in, SSH for Linux, a shared folder, and NAT, bridged or host-only networking.

Status: **Shipped**.

## What it does

`mvl rdp` turns on Remote Desktop in the guest, saves the guest credential for that address in your
Credential Manager and opens it signed in. `mvl ip` prints the address, which also appears in
`mvl ls`. `mvl net <name> bridged` gives the machine its own address on your network and falls back
to NAT by itself when no address arrives within 3 minutes.

## How to use it

```bat
mvl ip proof-1
mvl rdp proof-1
mvl net proof-1 bridged
```

## Settings

| Mode | What it means |
| --- | --- |
| `nat` (default) | Private address behind your PC; reaches the internet |
| `bridged` | Its own address on your network |
| `hostonly` | Only this PC and other lab machines; no internet |

## Security

With the default password `1234` and bridged networking, anyone on your network can sign in to that guest, and `mvl` warns you. `mvl rm` removes the saved credential.

## How it was checked

It has no recorded check yet on a real Windows host running a built release; that is listed under "Not yet verified" in the roadmap.

## Suggested articles

- [Manage lab machines](../getting-started/manage.md)
- [Security model](../reference/security.md)
- [Command line and keyboard TUI](cli-and-tui.md)
