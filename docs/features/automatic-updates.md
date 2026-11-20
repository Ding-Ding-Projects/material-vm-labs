# Automatic updates

The installed manager checks for a new release in the background, downloads and checks it, and installs it only when you choose **Restart to install update**.

Status: **In progress**.

## What it does

About 20 seconds after start and then every 4 hours, the manager reads the latest GitHub release.
It accepts the release only when its `RELEASES` file is well formed, names a package that is
attached at the stated size, and the release notes give that package's SHA-256. A newer release
downloads in the background with a size limit and is checked against its SHA-1 (from `RELEASES`),
its SHA-256 (from the notes) and its size before it is staged. A banner then names the version,
links the release notes, says the update is unsigned, and offers **Restart to install update** and
**Later**. A staged update is checked again before it is applied.

## How to use it

Open **Tools** and choose **Updates**, or press `Ctrl+Shift+F` and run **Check for updates**. The switch **Check for and download updates automatically** is on by default; turn it off to check and download only when you ask.

## What you can see

| State | Meaning |
| --- | --- |
| You have the latest version | The release matches the commit you run, or yours is newer |
| Available, Downloading, Ready | A newer build was found, is downloading, or is checked and staged |
| Offline | GitHub could not be reached; nothing changed |
| Update refused | The feed or a hash did not check out; nothing was installed |
| The download was damaged | Wrong size or not a package; nothing was installed |
| Download cancelled | You cancelled; nothing was installed |
| Not applied; this version stays | The installer could not apply it, so the current version keeps running |
| Cannot update itself | A portable or development copy; download the new version instead |

## Unsaved work

Restart asks first when a job is running or a screen reports unsaved work, using the two-key confirmation. Nothing restarts without your choice.

## Security

The update is not code-signed and the app never claims it is. Integrity comes from HTTPS and the published hashes. All network and disk work runs in the app's main process; the screen only shows the state.

## Status and what is left

The update logic, its checks and the banner are built and covered by tests
(`tests/records.test.mjs`). Still to do: wiring it into the manager's start-up, and a release that
stamps a unique package version per build, because Squirrel.Windows will not apply a package whose
version equals the installed one; until then the app shows that exact reason instead of
pretending. It has no recorded check yet on a real Windows host running a built release; that is listed under "Not yet verified" in the roadmap.

## Suggested articles

- [Update coming soon](update-coming-soon.md)
- [Squirrel installer, unsigned](squirrel-installer.md)
- [Version and build time on the first screen](version-on-first-screen.md)
