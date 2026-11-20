# Handoff: Material VM Labs Expressive canvas

## Stageshow guidance used

- Source: the pinned read-only copy of the Stageshow skill, commit 299140fafd08df55a9c234e610c3f64af3f45531. It was used from the cache because a fresh install was refused by this session's permissions. Nothing was installed and none of its npm scripts were run.
- References read: SKILL.md, references/craft.md, references/framing.md, references/motion.md, references/rehearse.md, references/review.md and references/verify.md.
- Rehearsal notes are in REHEARSAL.md. Rendered frames are in frames/ (light and dark with motion off, and motion on, for every board; the two site boards also at five scroll positions).

## What is in this folder

- canvas.json and 26 boards on six pages: Manager, Runners receipts and builds, Settings and customisation, Docs reader and TUI, Guest Setup, Docs site. Every board has a sticky note beside it, and Tweaks for seed (the accent colour), dark and motion.
- Boards need the canvas support.js at publish time; the local stand-in used for testing is not included.

## Review findings and fixes

Fresh-eye review against references/review.md and references/verify.md, from the frames, ranked framing first:

1. Framing: the site hero window floated with air under it instead of running off the page. Fixed: taller window that bleeds off the right and bottom.
2. Framing: the receipt satellite overlapped the hero copy. Fixed: it now straddles the window's rail edge, covering chrome and filler only.
3. Framing: the receipt's words were cut by the bottom of the hero. Fixed: raised so every word stays whole.
4. Framing: chips and command text in the feature visuals were cut by the right-hand crop. Fixed: content keeps clear of the cut; only filler bleeds.
5. Hierarchy: the phone timeline line ran through the step text. Fixed: hidden at phone width.
6. Hierarchy: stock AI tells, a sparkle on the Commands button and in the palette, and an invented logo blob in the rail. Fixed: keyboard and search icons; blob removed.
7. Density: empty panes on Media, Onboarding and the TUI. Fixed: storage and recent checks on Media, step facts and centred content on Onboarding, a recent activity pane in the TUI.
8. Motion: charts on Machine detail restarted and showed blank between ticks. Fixed: charts draw only on entrance or when a receipt opens.
9. Motion: the create sheet, container transform and takeovers replayed whenever state changed. Fixed: gated behind short-lived state classes so they play once per open.
10. Polish: the success burst overlapped its label and confetti crossed text. Fixed: shorter rays around the badge; confetti rests at the edges.
11. Polish: the failure takeover turned pale pink in dark theme. Fixed: the same strong alarm red in both themes.
12. Polish: a chip row collapsed to zero height in phone scroll columns. Fixed: scroll columns no longer shrink their children.

Kept on purpose: Machines shows four large numbers in its header (the owner asked for large hero numbers; Stageshow's one-big-number rule is for illustrations). The default seed is violet #6750A4 because it is the product's documented default; the Stageshow warning about purple is about AI features.

## What is not designed, per board

- Machines, wide (Main.dc.html): drag to reorder cards; the full detail lives on its own board.
- Machines, phone (MachinesPhone.dc.html): swipe gestures on cards.
- Create machine (CreateMachine.dc.html): Server image index picker inside the flow (it is on Media).
- Machine detail (MachineDetail.dc.html): runner and fresh-build lists for this machine (they are on Runners and Receipts).
- First-run setup (Onboarding.dc.html): the real hypervisor install path when neither is present.
- Command palette (CommandPalette.dc.html): recent commands history.
- Notifications and menus (Notifications.dc.html): per-category notification settings.
- Runners (Runners.dc.html): editing labels after registration.
- Receipts (Receipts.dc.html): side-by-side compare of two receipts.
- Media (Media.dc.html): deleting media from here.
- Build GUI (Build.dc.html): picking a ref from a branch list.
- Settings (Settings.dc.html): import and export of all settings in one file.
- Animation and transition editor (MotionEditor.dc.html): per-kind preview scenes beyond the card stack.
- Settings, phone (SettingsPhone.dc.html): the curve editor inside the phone sheet.
- Appearance editor (Appearance.dc.html): previews for every element kind (three are shown).
- Extensions (Extensions.dc.html): installing from a folder picker.
- History and exports (History.dc.html): clear-history confirmation.
- Changelog (Changelog.dc.html): older versions (there are none yet).
- Docs reader (DocsReader.dc.html): in-article search highlighting.
- mvl tui (Tui.dc.html): the destroy prompt flow.
- Guest Setup, progress (GuestSetup.dc.html): the Sign in and Shared folder steps.
- Install success takeover (GuestSuccess.dc.html): Nothing known.
- Install failure takeover (GuestFailure.dc.html): Nothing known.
- Docs site, wide (DocsSite.dc.html): real release numbers (placeholders in brackets).
- Docs site, phone (DocsSitePhone.dc.html): Nothing known.
- Docs article (DocsArticle.dc.html): Nothing known.

## Not covered anywhere

- The real Claude Design runtime was not used; only a local stand-in.
- Windows high contrast mode and right-to-left layouts.
- Per-user motion settings syncing between devices (settings stay local by design).
