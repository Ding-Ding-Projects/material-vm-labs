# CLI

`mvl.bat <command>` (or `mvl` after `mvl.bat install-cli`). Runs on the stock Windows PowerShell 5.1.

| Command | Purpose |
| --- | --- |
| `hv` / `hv install --approve` | Show the chosen hypervisor / install VirtualBox with consent |
| `media [--force]` | Fetch or re-check the official ISO |
| `new <name> [opts]` | Create unattended to `mvl-baseline`; `--net nat|bridged|hostonly`, `--user`, `--password-stdin`, `--random-password` (default guest password `1234`) |
| `ip <name> [--wait s]` | The lab machine's IP address |
| `rdp <name> [--no-launch]` | Turns on Remote Desktop in the guest, saves the guest credential for that address, opens `mstsc` |
| `install <name> --file Setup.exe [--args "..."] [--wait 60] [--evidence dir]` | Run an installer (or `.msi`) in the signed-in guest from its clean baseline; installer receipt with exit code and new folders, plus a guest screenshot |
| `passwd <name>` | New guest password on standard input; retakes the clean baseline with it (refused while a self-hosted runner is registered) |
| `net <name> nat|bridged|hostonly` | Change network mode while off; kept across resets; bridged falls back to NAT when no address arrives |
| `up <name> [--project p] [--no-reset]` | Create if missing, else reset and start |
| `ls`, `start`, `stop [--hard]`, `reset`, `rm --yes` | Lifecycle |
| `build <name> --repo o/n [--ref] [--entry] [--evidence] [--no-reset]` | Fresh-environment build |
| `runner add|rm <name> --repo o/n [--labels]` | Self-hosted runner for a private repository (token on stdin) |
| `shot <name> [file]` | Guest screenshot |
| `tui` | Keyboard manager |
| `install-cli` | `mvl.cmd` shim in `%LOCALAPPDATA%\Microsoft\WindowsApps` |

Global: `--json` prints one compact JSON object (errors as `{"ok":false,"error":"..."}`);
`--home <dir>` sets the state root.

Exit codes: `0` done, `1` problem (including a failed build verdict), `2` bad usage.
