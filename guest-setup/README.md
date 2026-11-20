# Material VM Labs Setup

README for the guest-side Setup app. It runs INSIDE a Windows 11 lab machine at the owner's
first sign-in and walks through six steps: Tools, Codex desktop, Codex CLI, Sign in,
Shared folder, Ready. Design boards: `SetupV2`, `SetupSuccess` and `SetupAlarm` in
`design/canvases/01-material-vm-labs/` (the older `Setup` board is superseded).

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
a drag strip with round minimise, maximise and close buttons. Under 900 px the step list folds into a
compact top strip. Charging-bay look from the design boards: a charge ring for overall progress, one cell
per tool, a segmented step bar and an outlined step number. Segoe UI Variable and Cascadia Mono.

Takeovers: when every tool finishes, a full-window success takeover names what was installed; when a tool
fails, an alarm takeover names the tool, its detail and the log path, and stays until dismissed. Each
fires once per state change, never on a reopen that only re-reads the same state.

Every control is a real button: Tab order, Enter and Space, visible cyan focus ring, automation names on
steps. Rise, pulse and sweep animations and the step-change fade are skipped when Windows reduced motion
(`SystemParameters.ClientAreaAnimation`) is off.

A crash writes `setup-crash.log` beside the state file and shows a message instead of vanishing.
`MVL_SETUP_STATE_DIR` points Setup at a practice state folder for testing the takeovers.

## Structure

`App.xaml(.cs)` startup and `--first-run`; `MainWindow.xaml(.cs)` view; `ViewModels/` (`MainViewModel`,
bindable items); `Services/` (`StateService`, `ProcessRunner`, `SignInService`, `LogTail`); `Controls/` (`RingProgress`, `OutlineText`); `Models/SetupState.cs`.
Build output (`bin/`, `obj/`, `out/`) is ignored.
