# Material VM Labs Setup

README for the guest-side Setup app. It runs INSIDE a Windows 11 lab machine at the owner's
first sign-in and walks through six steps: Tools, Codex desktop, Codex CLI, Sign in,
Shared folder, Ready. The look is plain Material Design 3 (baseline dark scheme, seed #6750A4).

## Build

```
dotnet publish guest-setup/MaterialVmLabsSetup.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o guest-setup/out
```

Result: one self-contained `guest-setup/out/MaterialVmLabsSetup.exe` (WPF, net8.0-windows, no NuGet dependencies).

## Contract with the guest scripts

- Reads `C:\ProgramData\MaterialVmLabs\setup-state.json` (schema 1, written by `guest-tools.ps1`) on start
  and keeps it fresh with a FileSystemWatcher plus a 2 s polling fallback. A missing or half-written
  file never fails: it shows "Waiting for the tools task" or keeps the last good state.
- Installs never run inside this app. Start and Retry run the scheduled task
  `\MaterialVmLabs\Guest Tools` through `schtasks.exe /Run`. Closing Setup never stops them.
- Its own progress lives in `C:\ProgramData\MaterialVmLabs\setup-ui.json`
  (`step`, `completed`, `closedWhileRunning`). Reopened after being closed while work was running, it shows
  a "Resumed" banner saying what happened.
- `--first-run` (the logon registration): exits at once when `completed` is true. Finish sets `completed`.
  Started from the Start menu without the argument it always opens. One instance at a time.
- Sign-in status uses only exit codes: `codex login status` and `gh auth status`. Sign-in buttons open the
  official flows (`codex login` and `gh auth login --web` in their own visible console, or the Codex
  desktop app via its Start-menu AppUserModelID). No token or credential file is read, and no
  password or token is ever seen, stored, copied or sent. Status re-checks every 5 s on the Sign in step and
  when the window regains focus.

## Layout and access

Window default 1100x720, minimum 760x600, fitted to the work area. Its own chrome (no system title bar):
a drag strip with Material 3 icon buttons for minimise, maximise and close. Under 900 px the side panel
folds into a compact top app bar. Material 3 components: a circular progress indicator for overall
progress, one list item per tool with its own small indicator, a stepper with a linear track per step,
filled, tonal, outlined and text buttons (40 px, fully rounded), 12 px cards and linear progress.
Colours are Material 3 tokens in `App.xaml` (mirrored in `Palette`). Segoe UI Variable (Roboto Flex is
not bundled with WPF) and Cascadia Mono.

Takeovers: when a tool finishes, a full-window success surface shows a check, the tool, version, command,
exit code and time, and closes by itself after 6 s. When a tool fails, an error-container surface shows the
failing step, exit code, attempts, what Setup recorded and the last log lines, with Retry and Open the full
log, and stays until dismissed. Exit code and attempts come from optional `exitCode` and `attempts` fields in
the state file; without them Setup says "not recorded" and counts failures seen while it was open. Each
fires once per state change, never on a reopen that only re-reads the same state.

Every control is a real button: Tab order, Enter and Space, a visible 3 px focus ring in the secondary
colour, automation names on steps. The step-change fade and slide, the takeover fade and scale (Material 3
emphasized decelerate easing), the running pulse and the progress highlight are skipped when Windows
reduced motion (`SystemParameters.ClientAreaAnimation`) is off.

A crash writes `setup-crash.log` beside the state file and shows a message instead of vanishing.
`MVL_SETUP_STATE_DIR` points Setup at a practice state folder for testing the takeovers.

## Structure

`App.xaml(.cs)` startup and `--first-run`; `MainWindow.xaml(.cs)` view; `ViewModels/` (`MainViewModel`,
bindable items); `Services/` (`StateService`, `ProcessRunner`, `SignInService`, `LogTail`); `Controls/` (`RingProgress`); `Models/SetupState.cs`.
Build output (`bin/`, `obj/`, `out/`) is ignored.
