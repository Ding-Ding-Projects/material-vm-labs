# Rehearsal: Material VM Labs Expressive

## Gold examples followed

- Site hero illustration (DocsSite, DocsSitePhone): `hero-demo` for the composition (corner bleed: the window is inset top and left and runs off the right and bottom; one satellite, the receipt, straddling the window's rail edge). The loop borrows the caused reset from `subscriptions`: a visible Reset to baseline status rolls the card back, so data never rewinds without a cause.
- Feature showcase visuals: `static-card` (pinned bottom bleed: a card inset left and top, running off the right and bottom, real words only on the subject, bars for the rest).
- Status words that change (Creating, Running, Resetting) roll in a fixed slot, as `Roll` does in the kit, instead of swapping text.
- The gold examples were read from the pinned copy but not filmed: running the kit needs an npm install, which this lane was told not to do.

## What changed from the golds

- Plain HTML and CSS inside the Claude Design board format instead of the React kit. No kit parts were copied; equivalent parts (window chrome, rolling status, satellite) were built to the same rules.
- The page ground is the site's own background with tonal blobs from the seed colour (the owner allowed this on the site only). There is no plate or tile behind the window.
- Real strings in the hero window are limited to: Machines, proof-2, the status word, 192.0.2.41, and on the receipt Passed and the commit. Everything else is filler bars.
- Poster frame (motion off, thumbnails, reduced motion): the payoff beat, Running with the IP and the Passed receipt on screen.
- Loop, about 14 seconds: cards in, proof-2 creating with progress, Running and the IP appear, a build runs, Passed arrives on the receipt and holds for 4 seconds, then Reset to baseline rolls the status and the receipt leaves, and the loop starts again.
- Phone: a compact redesign at 358 px wide inside the 390 viewport, not a squeeze. The window crops closer, two cards instead of six, and the receipt rests over the window's edge.

## Captured

- Every board in light (motion off), dark (motion off) and motion on, with the local stand-in runtime and Playwright, at the board's own size (1440 x 960, 1100 x 720, 1180 x 700 or 390 x 844). Frames are in frames/, downscaled to 60 percent for the wide boards.
- Both site boards also at five scroll positions in light and dark.
- Interaction frames during the work (not all kept): card menu, container transform, two-key destroy with a 2.3 second hold, bulk selection, create sheet steps, regex sheet on the phone, palette, notification centre, runner registration, receipt transform, motion editor profiles, guided settings tour, vocabulary level-up, takeovers.

## Gate

- The Stageshow film script and its gate were not run: they need the kit installed with npm, which this lane was not allowed to do. Each item of references/verify.md was answered by eye from the frames instead.

## Rules that do not apply to the real app screens, and why

- Corner bleed, crop 10 to 40 percent off stage, one gutter: app boards are the actual app window filling its frame, not an illustration placed on a page.
- Three to seven real strings and placeholder bars: app boards must show real, working data and controls. Bars appear in app screens only as loading skeletons.
- Cursor choreography and scripted loops: app boards are interactive; the person drives them. Only the site hero is a scripted loop.
- Satellites and annotations: app screens use anchored menus, sheets, dialogs and toasts placed where the product puts them.
- Use the kit part, never a lookalike: the board format cannot import the React kit, so Material 3 components are built in plain HTML and CSS.
- No real headings in faux UI: the site hero window is a faux illustration, so it uses no headings and is hidden from assistive technology. App boards are real UI and use real headings.

## Rules that were applied to the app boards

- Restraint and hierarchy: one dominant headline per page, one accent surface per region, quiet surfaces elsewhere.
- No stock AI tells: the sparkle icon on the Commands button and in the palette was replaced with keyboard and search icons; the invented logo blob in the navigation rail was removed.
- One icon family, one stroke weight, at 16 to 24 px, drawn from a single path set.
- Every motion has a cause: entrances run once on load, page transitions run on a tab change, pulses run when a live value changes, takeovers start from an install result.
- Empty panes filled with real product content rather than spread rows.

## Assumptions

- The Claude Design runtime diffs the DOM like a typical renderer. Large one-time animations (sheet morph, container transform, takeovers, receipt transform) are also gated behind short-lived state classes, so they play once per open even if a runtime re-creates elements.
- Relative colour syntax (oklch from a seed) is available; a static violet scheme is the fallback.

## Not checked

- The real Claude Design runtime: only the local stand-in was used.
- Roboto Flex rendering: the font request was blocked in local renders, so frames show the fallback system font.
- Screen readers, and keyboard shortcuts on the root, which need the board focused first.
- Contrast was designed through token lightness steps and checked by eye, not measured pair by pair.
- The film gate and frame-by-frame beat captures at 40 to 80 ms.
