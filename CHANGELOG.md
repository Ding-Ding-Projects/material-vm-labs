# Changelog

## 0.1.0 (unreleased)

First public release of Material VM Labs.

- `mvl` command line and keyboard TUI for throwaway Windows 11, Ubuntu 24.04 and Debian 13 lab
  machines on VMware Workstation (first) or VirtualBox (fallback); Windows Server 2025 media can be
  inspected, and creating Server machines is still in preview.
- Unattended installs from official Microsoft evaluation media with hash verification, guest tools and
  a clean baseline snapshot.
- Fresh-host build receipts (`mvl build`), installer tests (`mvl install`), screenshots, Remote Desktop,
  SSH, shared folders and network modes with an automatic NAT fallback.
- Self-hosted GitHub Actions runner hosting for private repositories.
- Material 3 companions: the manager, the documentation reader and the build GUI.
- Optional personal-vocabulary JSON: load your own wording file to rename terms in the apps and site.
