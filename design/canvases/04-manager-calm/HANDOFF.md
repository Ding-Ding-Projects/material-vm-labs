# Handoff: calm manager canvas

The manager's Machines screen was reported as messy. This canvas is the calmer layout the manager
is built from. It changes layout and density only; every action, filter and count from the
Expressive canvas (`../02-material-vm-labs-expressive`) is still there.

## Boards

| Board | Size | Shows |
| --- | --- | --- |
| `MachinesCalm.dc.html` | 1440 x 960 | Top bar, filter toolbar, five machine cards, Create machine button |
| `MachinesCalmPhone.dc.html` | 390 x 844 | The same page at phone width with the bottom navigation bar |
| `MachineCardStates.dc.html` | 1180 x 1400 | One card in each state: running, idle, runner on duty, creating, failed |

Every board has Tweaks for seed (accent colour), dark and motion, and a sticky note beside it in
`canvas.json`.

## What changed and why

1. The page title drops from a 72 px poster heading to a 32 px headline, so the machines are the
   first thing you see instead of the word "Machines".
2. The four large number tiles become three small summary counts beside the title.
3. The Filters and Statistics disclosure rows are gone: the filter chips are always visible, and
   the one statistic not shown elsewhere (the last fresh build) sits at the end of the chip row.
4. Cards use one corner radius (24 px), one header line, one address row and one quiet facts line.
5. Card actions were five different button styles. Now every secondary action (Open, Start or
   Stop, Reset, Shared folder, Fresh build) is the same text button, and exactly one filled action
   sits at the end: Remote Desktop (or SSH) when running, Start when off.
6. The page keeps space at the bottom so the floating Create machine button never covers a card.

## Not done here

- The boards need the canvas `support.js` at publish time; it is not in the repository.
- The boards were not filmed with Stageshow. The built app was checked instead (see the README
  screenshots, captured from the real build).
