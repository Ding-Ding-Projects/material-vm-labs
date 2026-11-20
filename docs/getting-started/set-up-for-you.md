# Create a lab machine for you

A lab machine is set up either **for you** or **for Claude**. The difference decides what is
inside it.

| | For you | For Claude |
| --- | --- | --- |
| Git, Chocolatey, Node.js, GitHub CLI | preinstalled | not installed (a bare fresh host) |
| Codex desktop and CLI | preinstalled | not installed |
| Setup app at first sign-in | yes, with the official sign-ins | never |
| Shared folder with this PC | yes, opened here when ready | no |

A machine created for Claude stays bare on purpose: it exists to prove that `build.bat` and
installers fetch every dependency on a fresh Windows host. It never gets Setup or a sign-in.

## Create one

In the manager: **+ Create a new one**, choose **You** under *Who uses it*. The switches for tools and
the shared folder start on; turn either off if you do not want it.

From a console:

```bat
mvl new proof-4 --for you
```

`--for` defaults to `you` in a console and to `agent` with `--json` (which is how Claude calls
it). `--no-tools`, `--no-share`, `--tools` and `--share` override the defaults. `--no-open` skips
opening the shared folder on this PC when the machine is ready.

## What happens inside the guest

During the unattended install, before the clean baseline is taken, the guest runs
`C:\MaterialVmLabs\guest-tools.ps1`:

1. Chocolatey through its official install script over HTTPS.
2. Git (`choco install git`), Node.js LTS and the GitHub CLI (`gh`).
3. The Codex CLI: `npm install -g @openai/codex`.
4. The Codex desktop app: `winget install --id 9PLM9XGG6VKS -s msstore`, the route
   OpenAI documents for the Microsoft Store package.

Each step records its result in `C:\ProgramData\MaterialVmLabs\setup-state.json`; the full log is
`C:\ProgramData\MaterialVmLabs\guest-tools.log`. Because this all happens before the baseline, a
reset keeps the tools and only forgets sign-ins.

## Setup and sign-in

At your first sign-in the **Material VM Labs Setup** app opens (Start menu, *lab machine
Setup*, opens it again later). It shows each tool's state and has two sign-ins:

- **Codex**: opens the desktop app, or a console running `codex login`, which opens the
  official sign-in page in the browser.
- **GitHub**: a console running `gh auth login --web`, which shows a one-time code and opens
  GitHub's device page.

You type your own password on the official pages. Setup never sees, stores, copies or sends a
password or token; it only reads the exit code of `codex login status` and `gh auth status`.

**Closed by accident?** The installs run in their own task (`\MaterialVmLabs\Guest Tools`), not in
Setup. Close Setup mid-install and the install keeps going; open Setup again and it shows a
*Resumed* banner and picks up at the same step. **Retry** reruns the task for anything that failed.

## The shared folder

| Side | Path |
| --- | --- |
| This PC | `<MVL_HOME>\shared\<name>` |
| VMware guest | `\\vmware-host\Shared Folders\<name>` |
| VirtualBox guest | `\\VBOXSVR\<name>` |

The guest gets a *Shared with host* shortcut on the desktop. `mvl share <name>` (or the
**Shared folder** button in the manager) opens it on this PC. Scrapping the machine keeps the
folder and its files.
