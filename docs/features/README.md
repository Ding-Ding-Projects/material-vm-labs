# Features and status

Every feature Material VM Labs has or plans, grouped by area, with an honest status.

| Status | Meaning |
| --- | --- |
| **Shipped** | The code is in this repository and does what the paragraph says. |
| **In progress** | Some of it is in the code; the rest is still being built or checked. |
| **Planned** | Not in the code yet. |

Shipped is not the same as proven on every machine. Anything still waiting for a check on real
hardware is listed under "Not yet verified" in the [roadmap](https://github.com/Ding-Ding-Projects/material-vm-labs/blob/main/ROADMAP.md).

Related guides:

- [Getting started](../getting-started/README.md): make your first lab machine.
- [Fresh builds](../building/README.md): prove a repository builds on a fresh host.
- [Self-hosted runners](../runners/README.md): give a private repository its own runner.
- [Reference](../reference/README.md): commands, media checks, hypervisors and security.


## Lab machines

### Create a lab machine with one command

`mvl up` creates a Windows 11, Ubuntu 24.04 or Debian 13 machine, installs it
unattended from official evaluation media, installs the guest tools and takes a clean baseline
snapshot. Running it again resets the machine to that baseline and starts it. Windows Server 2025
is in preview: `mvl server-media` inspects its media, but creating a Server machine is not offered yet.

Status: **Shipped**. [Full article](lab-machines.md).

### Hypervisor choice: VMware Workstation first, VirtualBox fallback

Every run picks VMware Workstation when it is usable and falls back to VirtualBox, and `mvl hv`
says which one will be used and why.

Status: **Shipped**. [Full article](hypervisor-choice.md).

### Official media download and verification

`mvl media` downloads the official evaluation image and checks its hash before any machine uses it.

Status: **Shipped**. [Full article](media-verification.md).

### Fresh-host build receipts

`mvl build` clones a repository at an exact commit inside a clean machine, runs its `build.bat` and
`build-installer.bat` with `/s`, and writes a receipt with the logs, the outputs and every
dependency the build had to download, all bound to that commit.

Status: **Shipped**. [Full article](fresh-build-receipts.md).

### Installer tests

`mvl install` returns the machine to its clean baseline, runs your installer in the signed-in guest
session and records an installer receipt with a guest screenshot.

Status: **Shipped**. [Full article](installer-tests.md).

### Self-hosted runners for private repositories

A lab machine can host a self-hosted GitHub Actions runner for a private repository. The
registration token is passed on standard input and never stored, and a runner is refused when the
repository's visibility cannot be read.

Status: **Shipped**. [Full article](self-hosted-runners.md).

### Remote Desktop, SSH, shared folders and network modes

Remote Desktop opens already signed in, SSH works for Linux machines, a host folder can be shared,
and each machine runs on NAT, bridged or host-only networking with an automatic NAT fallback when a
bridged address never arrives.

Status: **Shipped**. [Full article](remote-access-and-networking.md).

### Command line and keyboard TUI

`mvl` prints short lines (or `--json`) for scripts and agents, and `mvl tui` is a keyboard manager
for people.

Status: **Shipped**. [Full article](cli-and-tui.md).

### Guest Setup app

Inside a Windows lab machine, the Setup app walks the owner through tools, sign-in, the shared
folder and a final check in six steps, with Back, Skip and resume after a restart. Installs run in
a scheduled task, never in the app, and no password or token is ever read.

Status: **Shipped**. [Full article](guest-setup-app.md).

## Apps and windows

### Manager, documentation reader and build GUI

Three desktop apps: the manager for machines, runners, receipts and media; a reader for the bundled
documentation; and a build GUI that runs the repository's build entry points with live progress.

Status: **In progress**. All three apps start; the remaining work is in the sections below.

### First-run setup wizard in every app

On first launch each app runs a short wizard that performs the real setup steps (checking the
hypervisor, fetching media, putting the CLI on PATH), shows each result, supports Back, Next, skip
and resume, and finishes in the main workspace. The Guest Setup app already works this way.

Status: **In progress**.

### Custom window chrome

Frameless windows with a Material 3 title bar and working minimize, maximize and close buttons.
Guest Setup draws its own controls today; the Electron apps still use the system window-control
overlay.

Status: **In progress**.

### Separate destinations instead of one long page

Each app splits its work into destinations (Machines, Runners, Receipts, Media, Build, Docs,
Settings) and every navigation control does what its label says.

Status: **In progress**.

### Truthful empty states and real actions

Every button runs the real command, nothing pretends to succeed, and an empty list says how to
create the first item. Illustrations that are not live are labelled as demonstrations.

Status: **In progress**.

### Offline documentation inside the apps

Every Markdown article in `docs/` is bundled at build time and readable offline in the documentation
reader and in the manager's Docs destination, with search. A check that fails the build when an
article is missing from the bundle is still to come.

Status: **Shipped**. [Full article](offline-documentation.md).

### Update checks and the update banner

The installed manager checks the release feed at startup and every 4 hours, verifies the feed and
the package hashes, and shows a non-blocking banner with the version, a release-notes link, a clear
note that the files are unsigned, and Restart to install update or Later. A build that is still
being made shows as "Update coming soon" with its real stages ([article](update-coming-soon.md)).
Built and tested; it still needs wiring into the manager's start-up and a unique package version
per release.

Status: **In progress**. [Full article](automatic-updates.md).

### Version and build time on the first screen

Each app and the site show the running version and when that build was made, with seconds and a
time zone, read from the build itself. The site line is built; the app line is built and waits for
its script to be added to each app.

Status: **In progress**. [Full article](version-on-first-screen.md).

### Rename the app

Change the name an app shows you, with a one-click reset. Data folders, installer ids and the update
feed never change.

Status: **Planned**.

## Language and wording

### Personal vocabulary file

Load or drop your own JSON wording file (`{"schemaVersion": 1, "entries": {...}}`) to rename words
in the apps and on the site. It is validated in full, kept only on your device, never sent anywhere,
and Clear restores the original wording. A successful drop shows a short celebration. Size and depth
limits, duplicate-key checks, the Guest Setup app and the TUI are still to come.

Status: **In progress**.

### English, Cantonese and bilingual modes

A persisted language choice with English, playful Hong Kong Cantonese and a bilingual mode that
stays readable at narrow widths.

Status: **Planned**.

### Playfulness level and dialog emoji

Two sliders, one per language, from 1 (fully serious) to 5 (most playful), changing tone but never
facts, plus a switch that adds one decorative emoji to dialogs.

Status: **Planned**.

### School mode

One shared switch that keeps every app in plain English and hides the playful extras until it is
turned off again with a local PIN, password or passkey. It is a comfort setting, not a security
boundary.

Status: **Planned**.

### Spoken narration

An optional narrator for app events with a voice picker per language, rate and pitch, that stays
quiet while a screen reader is running.

Status: **Planned**.

### Action sounds

Short sounds for meaningful actions and outcomes, with a Settings switch that turns them off and
respect for mute and volume. The sound engine exists; wiring it into every app and Settings is in
progress.

Status: **In progress**.

### Scheduled settings

Rules that switch language, theme, motion and other appearance values by day and time, or from a
validated HTTPS source or a Home Assistant switch, falling back safely when a source is offline.

Status: **Planned**.

### Focus and low-stimulation modes

Separate switches for Focus, Low stimulation, Time awareness, One thing at a time and Momentum, each
off by default and described in plain, non-medical words.

Status: **Planned**.

### Dim sum surprise

Now and then at startup an app shows one dim sum dish with its English and Cantonese names and a
picture from the public dim sum catalogue. It never blocks work and never appears during first run,
an error, an update or a running task.

Status: **Planned**.

## Look and feel

### Material 3 design

All apps and the site use Material 3 colour tokens, typography and shapes, with light, dark and
system themes and six seed colours. A per-screen record of which Material 3 component each control
uses is still to come.

Status: **In progress**.

### Motion with a full reduced-motion path

Material motion everywhere, with a Reduce motion switch and respect for the system setting. Every app
has an animation editor with per-kind timing, easing and profiles. Full-screen success and failure
animations for installs are built and being wired in.

Status: **In progress**.

### Appearance editor

Theme, seed colour, motion and animation timing are adjustable today. A per-element "Edit
appearance" editor with typography, density, fonts, presets and undo is planned.

Status: **In progress**.

### Full colour picker

A continuous colour picker with HEX, RGB, HSL, OKLCH and other spaces, contrast checks and an
animated rainbow choice, replacing today's fixed seed swatches.

Status: **Planned**.

### Logo choice

A few built-in logos plus your own image, decoded and checked locally, with crop and fit.

Status: **Planned**.

### Panels that fit and can be resized

Menus, popovers and panels stay inside the window, scroll when needed, and can be resized and moved
with mouse or keyboard, remembering their size.

Status: **In progress**.

### Collapsible search, filter and statistics rows

Search, filter and statistics rows fold away, remember their state, and say when a hidden filter is
still active.

Status: **Planned**.

### Accessibility tools menu

A menu in every app and on the site with text size, contrast, reduced motion, visible focus, larger
targets, keyboard help and read-aloud. The site already has text size and motion settings.

Status: **In progress**.

### Phone and tablet layout for the site

The site works from about 320 px wide with no sideways page scroll, touch-sized targets and tab
strips that collapse.

Status: **In progress**.

### Live charts

Any chart that updates while you watch it uses a smooth live line with keyboard scrubbing, a screen
reader summary and honest stale and paused states. No live chart exists yet.

Status: **Planned**.

## Navigation, search and commands

### Tabs

The site opens every page as a tab on first visit, keeps closed tabs closed, and has "Open every
tab". The manager has a vertical tab rail with a closable tab per machine. Docking to any edge, a New
tab catalog, tab search and bulk close are still to come.

Status: **In progress**.

### Search with a regex builder

Every search box has a regex switch with flags, common tokens and a live validity message. A complete
regex workbench (testing, explanation, replacement, flavour comparison) is planned.

Status: **In progress**.

### Command palette (Ctrl+Shift+F)

`Ctrl+Shift+F` opens a palette that finds pages, settings and commands and jumps to them. It ships on
the site; the app version is being built.

Status: **In progress**.

### Context menus with shortcuts

A right-click menu on every element, with a filter field, keyboard and touch equivalents, and each
item's real shortcut shown on the right.

Status: **Planned**.

### Live controls in lists and results

Lists, results and detail panels show the real control (a switch, a picker) rather than plain text,
so a value can be changed where it is shown. Machine cards already carry their real actions.

Status: **In progress**.

### Guided forms and info buttons

Forms start from valid defaults, validate as you type, and each control has an info button with a
short explanation and optional guided steps. The create-machine form already has presets, validation
and network help.

Status: **In progress**.

### Explained settings and quick entry

Every setting explains what it does and whether its value came from a file or the built-in default,
and any message that asks you to set something offers the input right there.

Status: **Planned**.

## Safety and confirmation

### Safe confirmation for destructive actions

Removing a machine asks you to type its name today. A two-key confirmation with a slider, an
Emergency exit and full keyboard support is planned for every destructive action.

Status: **In progress**.

### Long operations with real progress

Long operations stream their real output into an activity card with elapsed time and Cancel, and a
running action cannot be started twice. Recovery help beside a failure and on-the-spot sign-in are
planned.

Status: **In progress**.

### Element locks, unlock ladder and support tickets

Just-for-fun locks on any element with a PIN, password or authenticator code, a playful unlock ladder
and a local support desk that points at the data folder. Clearly not a security feature.

Status: **Planned**.

### Built-in authenticator

A local TOTP authenticator destination with QR import and pairing, stored in the system credential
vault.

Status: **Planned**.

### No paywalls or nagging

Material VM Labs is free. There are no purchases, donation prompts, review requests or upgrade nags.

Status: **Shipped**. [Full article](no-paywalls.md).

## Records, history and messages

### Notifications and notification centre

Messages appear as small toasts that do not block work. A notification centre that keeps dismissed
messages searchable, with errors staying until dismissed, is built and being wired into the apps.

Status: **In progress**.

### Local history with undo

An append-only local history beside the app data, so any settings or record change can be browsed,
compared, restored and exported.

Status: **Planned**.

### Export everything

The CLI prints every listing as JSON with `--json` and receipts are JSON files. In-app export of
every list, log and record in every suitable format, plus ZIP and 7z archives, is planned.

Status: **In progress**.

### Bulk actions

Select many machines, receipts or notifications with click, Shift and keyboard and act on all of
them with a preview of exactly what will happen.

Status: **Planned**.

### Changelog viewer

Every released version with its date, changes and commit, searchable and filterable by date inside
the apps.

Status: **Planned**.

### Rendered release notes

Release notes and other provider text shown as formatted Markdown in a safe, isolated view, with an
honest "no notes were provided" state.

Status: **Planned**.

### Open in your editor

Open receipts, evidence folders and exports in the editor you choose, or in Visual Studio Code in
one click.

Status: **Planned**.

## Built-in tools

Each tool below is planned as a full feature in its own destination.

### Virtual disk manager

Create, attach, resize, compact, convert and merge VHD, VHDX and VHD Set files on Windows, with a
quick pack that turns dropped files into a verified VHDX.

Status: **Planned**.

### File converter

A local converter for documents, PDFs, images, audio, video, archives and data, using only bundled
tools.

Status: **Planned**.

### Base64 tools

Encode and decode text and files in every Base64 variant, with streaming, hash checks and safe
previews.

Status: **Planned**.

### quicktype studio

Generate typed models from JSON, JSON Schema, TypeScript and GraphQL, plus a full JSON editor.

Status: **Planned**.

### Ollama manager

A guided local Ollama installer and model manager over Ollama's local API.

Status: **Planned**.

### Minecraft server manager and world generator

Create and manage Java and Bedrock servers locally, in Docker or over SSH, and pre-generate worlds.

Status: **Planned**.

### Drawing on screenshots

Draw on screenshots, previews or a blank board with seven pens, an eraser, undo and SVG or PNG
export.

Status: **Planned**.

### Extensions

A versioned extension format with declared permissions, consent, time and size limits, a searchable
manager, built-in extensions and an author guide.

Status: **Planned**.

### Status page

A status destination that shows build and release health for the project with the evidence behind
each state.

Status: **Planned**.

## Documentation site

### Documentation site

The [documentation site](https://ding-ding-projects.github.io/material-vm-labs/) has a home page,
guided tasks with interactive walkthroughs, every article, a settings page and no network assets.
Each in-app feature still needs its site equivalent.

Status: **In progress**.

### Phone-size PDF edition

A PDF of the whole documentation with phone-size pages and a linked table of contents, built with
the site and attached to releases.

Status: **Shipped**. [Full article](pdf-edition.md).

### One article per feature

Each shipped or in-progress feature has its own article covering behaviour, settings, errors,
security and verification, ending with suggested next articles. They are linked as "Full article"
beside each status on this page. Planned features get an article when they are built.

Status: **In progress**.

### Installer download button

The Home page has a Download for Windows button that opens the latest release on GitHub, and says
plainly that the files are not code-signed. A button that names the installer file and its version
directly comes once a release has been verified on a real Windows host.

Status: **In progress**.

### Link previews

A large picture of the real app and complete link-preview tags on every site page. Uploading
`social-preview.png` as the repository's own preview is a manual GitHub setting still to do.

Status: **In progress**. [Full article](link-previews.md).

### Bundled fonts

Roboto Flex and Roboto Mono ship with the apps and the site with their licences. A fetch script with
a checksum manifest is planned.

Status: **In progress**.

## Build, install and updates

### Build entry points

`build.bat` and `build-installer.bat` take a Windows checkout to the apps and the installer, run
silently with `/s`, `--silent` or `SILENT=1`, and pass the real exit code through.

Status: **Shipped**. [Full article](build-entry-points.md).

### One-command fresh build and run

`.\build.bat --run` on a completely fresh Windows install fetches every dependency from pinned
sources, builds, checks the output against the committed source, and then launches the app. The
launch checks are built; `build.bat` still has to read the `--run` flag.

Status: **In progress**. [Full article](fresh-build-and-run.md).

### Dependency fetcher

`download-dependencies.bat` and `download-dependencies.sh` fetch the pinned dependencies with
checked SHA-256 digests into a per-user folder, and both build scripts call it. Git and the .NET SDK
are detected only until their digests are recorded.

Status: **In progress**. [Full article](dependency-fetcher.md).

### Squirrel installer, unsigned

The apps install with Squirrel.Windows (`Setup.exe`, `RELEASES` and the full package). Nothing is
code-signed, and the release notes say so.

Status: **Shipped**. [Full article](squirrel-installer.md).

### Everything bundled

The apps carry what they need and work offline. The hypervisors are external products and are named
as such.

Status: **In progress**.

### App icons

A real icon for every app and the installer, generated from one source file.

Status: **In progress**.

## Releases

### Release workflow

GitHub Actions builds on every push and publishes tagged releases with the apps, the installer, the
zip, checksums and the PDF documentation.

Status: **In progress**.

### Release timing, line counts and code names

Release notes record exact start, finish and duration, the project's line counts, a labelled
estimate of how long a person would take from the same count, and a dim sum code name beside the
version.

Status: **In progress**. [Full article](human-time-estimate.md).

### Screenshots and a screen recording

The README and site show real screenshots of every screen from a built app at a known commit, and
a short recording of a real end-to-end run.

Status: **In progress**. Three screenshots exist, rendered with sample data.

## Repository records

### Roadmap checklist

[ROADMAP.md](https://github.com/Ding-Ding-Projects/material-vm-labs/blob/main/ROADMAP.md) is a checklist that mirrors the statuses on this page.

Status: **Shipped**. [Full article](repository-records.md).

### Design files in the repository

The Material 3 design canvases live in `design/canvases/`.

Status: **Shipped**. [Full article](repository-records.md).

### No HTTP API

Material VM Labs has no HTTP API, so there is no Postman collection.

Status: **Shipped**. [Full article](repository-records.md).

### README layout and community files

A short README with collapsible reference sections, plus CONTRIBUTING, SECURITY and
CODE_OF_CONDUCT files. A LICENSE file waits for the owner's choice of licence.

Status: **In progress**. [Full article](readme-and-community-files.md).

### Contributor guide and handoff notes

An `AGENTS.md` guide and a factual `HANDOFF.md` with what changed, how it was checked and what is
left, plus `CLOSEOUT_PROMPT.md` for the next person to pick up the open work.

Status: **Shipped**. [Full article](handoff-and-contributor-guide.md).
