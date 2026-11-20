# Register a self-hosted runner

```bat
gh api -X POST repos/owner/name/actions/runners/registration-token --jq .token | mvl runner add proof-1 --repo owner/name --labels extra-label
```

- **Private only.** `mvl` reads the repository's visibility through `gh` and refuses anything that is
  not `PRIVATE`. A self-hosted runner on a public repository would run strangers' pull requests.
- **The token arrives on standard input**, is handed to the guest through the hypervisor's
  in-memory guest variable (`guestinfo.mvl.runnertoken` on VMware, the transient
  `/MVL/RunnerToken` property on VirtualBox) and cleared as soon as the guest has used it. It is
  never written to a tracked file, `vm.json` or a log.
- Inside the guest, the latest `actions/runner` release is downloaded, its SHA-256 checked against
  the value in the release notes, and registered as a service running as `mvlbuilder`.
- Labels: `self-hosted`, `Windows`, `X64` (added by the runner), plus `material-vm-labs`,
  `mvl-<project>` and any `--labels`.
- `mvl runner rm proof-1 --repo owner/name` removes it from the repository. `mvl rm` removes every
  registration before deleting the machine.
- A machine hosting a self-hosted runner is not reset by `mvl build` or `mvl up`, so the self-hosted runner is never
  orphaned.

Use it in a workflow with `runs-on: [self-hosted, windows, material-vm-labs]`.
