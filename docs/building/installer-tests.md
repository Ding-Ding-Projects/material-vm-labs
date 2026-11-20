# Test an installer on a fresh host

```bat
mvl install proof-1 --file dist\installer\Setup.exe --evidence evidence\installs
```

1. The lab machine is reset to `mvl-baseline` and started; a self-hosted runner host is refused, because
   the reset would remove it.
2. The folders under LocalAppData, AppData, ProgramData and Program Files are listed.
3. The installer is copied in and run **in the signed-in guest session** (VMware `-interactive`),
   so a Squirrel installer installs and then launches the app the way a person would see it. An
   `.msi` runs through `msiexec /i`. `--args` adds arguments such as `--silent`.
4. After `--wait` seconds (default 60) the folders are listed again and a guest screenshot is taken.
5. `receipt.json` (schema `material-vm-labs/installer-receipt/1`) records the installer's SHA-256,
   arguments, exit code, machine, baseline and the new folders; `--evidence` copies the receipt
   and the screenshot.

Exit code `0` from `mvl install` means the installer exited 0. The screenshot is the evidence that it
launched; a receipt never claims more than what was observed.
