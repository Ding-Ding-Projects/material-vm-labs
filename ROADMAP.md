# Roadmap

This checklist mirrors the statuses in [docs/features/README.md](docs/features/README.md).
`[x]` means Shipped (the code is in the repository and does what it says). `[ ]` means In progress or
Planned, as marked. Anything not yet checked on real hardware is also listed under "Not yet verified".

## Now: 0.1.0

### Lab machines
- [x] Command line, TUI, PowerShell module and guest scripts
- [x] One-command lab machine creation (`mvl up`) with unattended install and a clean baseline
- [x] VMware Workstation first, VirtualBox fallback, reported every run
- [x] Official media download and hash verification
- [x] Fresh-host build receipts and installer tests
- [x] Self-hosted runners for private repositories
- [x] Remote Desktop, SSH, shared folders and NAT, bridged or host-only networking
- [x] Guest Setup app: six steps with Back, Skip and resume
- [ ] Guest Setup app restyled in Material 3 (in progress)

### Apps and windows
- [ ] Material 3 companions (manager, docs reader, build GUI) redesigned from the Claude Design canvases (in progress; the manager's main process has a syntax error to fix first)
- [ ] First-run setup wizard in every app (in progress: Guest Setup only)
- [ ] Custom Material 3 title bar and window controls in the Electron apps (in progress)
- [ ] Separate destinations with working navigation everywhere (in progress)
- [ ] Truthful empty states and real actions checked on every screen (in progress)
- [x] Offline documentation inside the apps
- [ ] Update checks, update banner and "Update coming soon" (planned)
- [ ] Version and build time on the first screen (planned)
- [ ] Rename the app (planned)

### Language and wording
- [ ] Personal-vocabulary JSON upload and drop in every app and on the site (in progress: limits, Guest Setup and TUI remain)
- [ ] English, Cantonese and bilingual modes (planned)
- [ ] Playfulness level and dialog emoji (planned)
- [ ] School mode (planned)
- [ ] Spoken narration (planned)
- [ ] Action sounds with a Settings switch (in progress)
- [ ] Scheduled settings (planned)
- [ ] Focus and low-stimulation modes (planned)
- [ ] Dim sum surprise (planned)

### Look and feel
- [ ] Material 3 design with a per-screen component record (in progress)
- [ ] Motion with a full reduced-motion path and install animations (in progress)
- [ ] Appearance editor (in progress: theme, seed colour, motion and animation timing)
- [ ] Full colour picker (planned)
- [ ] Logo choice (planned)
- [ ] Panels that fit, resize and move (in progress)
- [ ] Collapsible search, filter and statistics rows (planned)
- [ ] Accessibility tools menu (in progress: site text size and motion)
- [ ] Phone and tablet layout for the site, checked on real devices (in progress)
- [ ] Live charts (planned)

### Navigation, search and commands
- [ ] Tabs: every-tab-open, docking, New tab catalog, search and bulk close (in progress)
- [ ] Search with a regex builder, then a complete regex workbench (in progress)
- [ ] Command palette on `Ctrl+Shift+F` in every app (in progress: shipped on the site)
- [ ] Context menus with shortcuts (planned)
- [ ] Live controls in lists and results (in progress)
- [ ] Guided forms and info buttons (in progress)
- [ ] Explained settings and quick entry (planned)

### Safety and confirmation
- [ ] Two-key confirmation for every destructive action (in progress: type-the-name today)
- [ ] Long operations with real progress, recovery help and re-sign-in (in progress)
- [ ] Element locks, unlock ladder and support tickets (planned)
- [ ] Built-in authenticator (planned)
- [x] No paywalls or nagging

### Records, history and messages
- [ ] Notifications and notification centre (in progress)
- [ ] Local history with undo (planned)
- [ ] Export everything (in progress: CLI `--json` and JSON receipts)
- [ ] Bulk actions (planned)
- [ ] Changelog viewer (planned)
- [ ] Rendered release notes (planned)
- [ ] Open in your editor (planned)

### Built-in tools (planned)
- [ ] Virtual disk manager
- [ ] File converter
- [ ] Base64 tools
- [ ] quicktype studio
- [ ] Ollama manager
- [ ] Minecraft server manager and world generator
- [ ] Drawing on screenshots
- [ ] Extensions
- [ ] Status page

### Documentation site
- [ ] GitHub Pages documentation site with interactive walkthroughs and a site equivalent for every feature (in progress)
- [x] Phone-size PDF edition of the documentation
- [ ] One article per feature (in progress: [features index](docs/features/README.md))
- [ ] Installer download button once a release is verified (planned)
- [ ] Link previews (planned)
- [ ] Bundled fonts with a checksum manifest (in progress)

### Build, install and updates
- [x] `build.bat` and `build-installer.bat` with silent modes
- [ ] `.\build.bat --run` on a fresh Windows install (planned)
- [ ] `download-dependencies.bat` (planned)
- [x] Unsigned Squirrel.Windows installer
- [ ] Everything bundled and proven offline (in progress)
- [ ] App icons from one source file (in progress)

### Releases
- [ ] GitHub Actions: build, installer, Pages and tagged releases (in progress)
- [ ] Release timing, line counts and code names in the notes (in progress: start and finish times)
- [ ] Screenshots of every screen and a screen recording (in progress: three sample screenshots)

### Repository records
- [x] Roadmap checklist
- [x] Design canvases in `design/canvases/`
- [x] No HTTP API recorded (no Postman collection)
- [ ] README layout and LICENSE, CONTRIBUTING, SECURITY and CODE_OF_CONDUCT (planned)
- [ ] `AGENTS.md` and `HANDOFF.md` (planned)

## Not yet verified
- Real VM creation on a Windows host (VMware and VirtualBox) for this public edition.
- Every Shipped item above on a real Windows host from a built release; none has a recorded check yet.
