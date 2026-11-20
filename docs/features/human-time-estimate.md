# Line counts and the human time estimate

Every release states the project's line count and an estimate of how long a person would take to write it by hand.

Status: **In progress**.

## What it does

The release workflow runs `node scripts/count-lines.mjs` for the line table and
`node scripts/human-time-estimate.mjs` on the same counter's JSON from the same run. The estimate is
a range, labelled as an estimate, with its inputs (non-blank source, test and markup lines), the
assumed rates and one line of arithmetic. It leaves out generated files, lock files, fonts, images,
PDFs and design frames, exactly as the count does.

## Status and what is left

Start, finish and duration are already recorded in the notes. The estimate section is added to the workflow and has not yet appeared in a published release, so the README quotes no figure yet.

## Suggested articles

- [README layout and community files](readme-and-community-files.md)
- [Build entry points](build-entry-points.md)
- [All features and their status](README.md)
