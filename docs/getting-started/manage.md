# Manage lab machines

| Command | Effect |
| --- | --- |
| `mvl ls` | Every lab machine with project, hypervisor, status, power and self-hosted runner count |
| `mvl up <name>` | Fastest route: creates it if missing, otherwise resets to baseline and starts |
| `mvl start <name>` | Powers on and waits for guest tools |
| `mvl stop <name> [--hard]` | Clean shutdown (power-off after five minutes), or pull the plug |
| `mvl reset <name>` | Back to `mvl-baseline`; refused by `build` when a self-hosted runner is registered |
| `mvl rm <name> --yes` | Removes self-hosted runner registrations, the machine, disk, snapshots, credential and folder |
| `mvl shot <name> [file]` | Screenshot of the guest screen |
| `mvl ip <name>` | Its IP address (also shown in `mvl ls`) |
| `mvl rdp <name>` | Remote Desktop, already signed in: the guest credential is saved for that address in your Credential Manager, and `mvl rm` removes it |
| `mvl net <name> bridged` | Its own address on your LAN instead of NAT; no address in 3 minutes falls back to NAT by itself |
| `mvl tui` | Keyboard manager: `n u s t r b d i w g h x l ? q` |

## In the manager

The Machines page shows the same list as `mvl ls`, one card per machine.

- **Top bar:** the page title with live counts (running, idle, hosting a runner), then search
  with its `.*` regex builder, **Commands** (`Ctrl+Shift+F`) and **Export**.
- **Filter chips:** All, Running and Runners, each with its count. They are always visible. The
  result of the last fresh build sits at the end of the same row.
- **Each card:** the machine's name with its status and project under it, its address (with a
  copy button when it has one) and network mode, then the last build, hypervisor and size, who
  it is for and its shared folder.
- **Actions:** Open, Stop, Reset, Shared folder and Fresh build are plain text buttons in one row.
  The single filled button at the end is the main action: **Remote Desktop** (or **SSH** for a
  Linux machine) while it runs, **Start** while it is off. The ⋮ button and a right-click open
  the menu with every action and its shortcut.

## Network modes

| Mode | What it means |
| --- | --- |
| `nat` (default) | Private address behind your PC; reaches the internet; only this PC reaches it |
| `bridged` | Its own address on your LAN, like another PC; falls back to NAT when no address arrives |
| `hostonly` | Only this PC and other lab machines; no internet, so builds cannot fetch dependencies |

## Guest sign-in

The guest account defaults to `mvlbuilder` with password `1234` (your default). Choose your
own with `--user` and `--password-stdin`, or `--random-password`. With the default password and
`bridged`, anyone on your LAN can sign in to that guest over Remote Desktop, and `mvl` says so.

Several lab machines can exist at once, for example one per project. Each has its own folder
under `%LOCALAPPDATA%\MaterialVmLabs\vms\<name>`.

Add `--json` to any command for one compact JSON line, which is what agents should use.
### Closing the manager during a job

Closing the manager during an active operation keeps the operation running in the
background. Double-click the notification-area icon, use its Open command, or
launch the manager again to return to the same window and its progress. When the
operation finishes, quitting closes the manager normally.

To quit while work is running, use Quit in the notification area, or launch
`"Lab machine.exe" --quit`. Either one asks first: Keep running, or Cancel jobs
and quit. A cancelled job is recorded as incomplete.

Close-to-background does not survive an operating-system shutdown or a forced
process termination. Check the VM's recorded state after an interruption before
retrying.
