# Self-hosted runners for private repositories

A lab machine can host a GitHub Actions runner for one of your private repositories.

Status: **Shipped**.

## What it does

Inside the guest, the latest `actions/runner` release is downloaded, its SHA-256 checked against
the release notes and registered as a service. Labels are `self-hosted`, `Windows`, `X64`,
`material-vm-labs`, `mvl-<project>` and any you add. A machine hosting a runner is never reset by
`mvl build` or `mvl up`, so the runner is never orphaned.

## How to use it

```bat
gh api -X POST repos/owner/name/actions/runners/registration-token --jq .token | mvl runner add proof-1 --repo owner/name
mvl runner rm proof-1 --repo owner/name
```

Use it with `runs-on: [self-hosted, windows, material-vm-labs]`.

## Security

Only private repositories are accepted: `mvl` reads the visibility with `gh` and refuses anything
else, including a repository whose visibility cannot be read. The registration token arrives on
standard input, reaches the guest only through the hypervisor's in-memory guest variable, is cleared
after use, and is never written to a file or a log.

## How it was checked

It has no recorded check yet on a real Windows host running a built release; that is listed under "Not yet verified" in the roadmap.

## Suggested articles

- [Register a self-hosted runner](../runners/register.md)
- [Security model](../reference/security.md)
- [Create a lab machine with one command](lab-machines.md)
