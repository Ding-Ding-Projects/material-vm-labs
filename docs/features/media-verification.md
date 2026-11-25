# Official media download and verification

`mvl media` downloads the official Windows 11 Enterprise evaluation image and checks it before any machine uses it.

Status: **Shipped**.

## What it does

Microsoft publishes no SHA-256 for evaluation images, so `mvl media` checks them another way: every
redirect must stay on HTTPS at `microsoft.com`, the byte count must match what Microsoft served,
`setup.exe` inside the mounted image must carry a valid Microsoft Authenticode signature, and the
install image must exist. The image's SHA-256 is then recorded and checked again before every new
machine.

## How to use it

```bat
mvl media
mvl media --force
```

## When something goes wrong

A failed check stops the download from being used and says which check failed. Run `mvl media --force` to fetch it again.

If Windows says it cannot open an ISO that is on disk under `AppData`, the manager or the CLI is probably running inside a packaged app's sandbox. Such a sandbox redirects AppData files into a private folder that the Windows disk service cannot see. Choose a state folder outside `AppData` in Settings or in first-run setup, and move the ISO into its `media` folder.

## Security

The record of the verified image lives in `media\media-en-us.json` in the state folder. Linux machines use the distributions' cloud images with their published checksums.

## How it was checked

One image was verified on 2026-11-17; its name, size and SHA-256 are in the media reference.

## Suggested articles

- [Media and verification](../reference/media-and-verification.md)
- [Create a lab machine with one command](lab-machines.md)
- [Fresh-host build receipts](fresh-build-receipts.md)
