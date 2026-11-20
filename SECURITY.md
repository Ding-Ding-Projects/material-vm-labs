# Security policy

## Reporting a problem

Please do not open a public issue for a security problem. Use **Report a vulnerability** on the
repository's **Security** tab to send a private report. If that button is not available, open an
issue that asks for a private contact and leave the details out.

Include what you found, how to reproduce it, and which version or commit you tested. You will get
an answer about whether the report is accepted and what happens next.

## Supported versions

Only the latest release and the `main` branch receive fixes.

## What the project does to stay safe

- Releases and the installer are **not code-signed**. Integrity comes from HTTPS and the SHA-256
  hash of every file, listed in each release's notes. Windows may show an unknown-publisher
  warning.
- The installed manager checks updates against the release feed and the published hashes and
  installs only when you choose to restart.
- The apps' screens have no network, file system or process access of their own; those run in the
  main process with validated arguments.
- No secret is stored in the repository. The guest password template has placeholders only, and a
  test fails if a real value appears.
- Lab machines keep User Account Control and Microsoft Defender on.

The full model is in [docs/reference/security.md](docs/reference/security.md).
