# Version and build time on the first screen

Each app and the site show the running version and when it was made, with seconds and a time zone, on the first screen.

Status: **In progress**.

## What it does

In the apps, the line comes from the build's own metadata (`generated/docs.json`, written at build
time): the version, the commit and the time, shown in your local time zone with its UTC offset and
name. On the site home page it is the version, commit and commit time the site was built from,
written into the page by the site build and shown in your local time. It never uses the launch time,
a file date or the clock. Missing metadata shows "unavailable".

## Status and what is left

The site line is built. The app line is built and shows on the manager's first screen once its script is added to each app. The app currently shows the build time; showing the commit time instead needs the build metadata to record it.

## Suggested articles

- [Automatic updates](automatic-updates.md)
- [Offline documentation inside the apps](offline-documentation.md)
- [Link previews](link-previews.md)
