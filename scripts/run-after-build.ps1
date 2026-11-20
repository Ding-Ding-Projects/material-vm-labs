# run-after-build.ps1: the launch step of ".\build.bat --run". It starts the default target from
# dependencies.json only when the build output is complete and bound to the unchanged source:
#   - the source tree has no staged, unstaged or untracked change (fails closed otherwise);
#   - HEAD is the commit embedded in companion/generated/source-manifest.json at build time,
#     or, without Git, every file in that manifest still has its recorded SHA-256;
#   - the portable exe and the unpacked resources\app.asar exist and are not empty.
# It never builds, installs or elevates anything.
param([string]$Target = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
function Fail([string]$m) { Write-Host "problem: $m Not launching."; exit 6 }

$manifest = Get-Content -LiteralPath (Join-Path $root 'dependencies.json') -Raw | ConvertFrom-Json
$version = (Get-Content -LiteralPath (Join-Path $root $manifest.build.versionFile) -Raw).Trim()
$t = if ($Target) { $manifest.build.targets | Where-Object { $_.name -eq $Target } } else { $manifest.build.targets | Where-Object { $_.default } }
if (-not $t) { Fail "dependencies.json has no build target named '$Target'." }
$exe = Join-Path $root ($t.start -replace '\{version\}', $version)
$asar = Join-Path $root $t.asar
$receiptPath = Join-Path $root $manifest.build.receipt
if (-not (Test-Path -LiteralPath $receiptPath)) { Fail "the build receipt $($manifest.build.receipt) is missing, so the output cannot be tied to this source." }
$receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json

$git = Get-Command git.exe -ErrorAction SilentlyContinue
$isRepo = $false
if ($git) { & git -C $root rev-parse --is-inside-work-tree *> $null; $isRepo = ($LASTEXITCODE -eq 0) }
if ($isRepo) {
    $dirty = @(& git -C $root status --porcelain --untracked-files=all)
    if ($dirty.Count) { Fail "the source has $($dirty.Count) uncommitted or untracked change(s), for example '$($dirty[0])'; a launch must match a committed source." }
    $head = (& git -C $root rev-parse HEAD).Trim()
    if ($head -ne $receipt.commit) { Fail "the build was made from $($receipt.commit) but the checkout is now $head." }
} else {
    foreach ($f in $receipt.files) {
        $p = Join-Path $root $f.path
        if (-not (Test-Path -LiteralPath $p)) { Fail "$($f.path) from the build receipt is missing." }
        if ((Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() -ne $f.sha256) { Fail "$($f.path) changed after the build." }
    }
}
foreach ($p in @($exe, $asar)) {
    if (-not (Test-Path -LiteralPath $p)) { Fail "$p was not produced." }
    if ((Get-Item -LiteralPath $p).Length -eq 0) { Fail "$p is empty." }
}
Write-Host "Launching $exe (version $version, commit $($receipt.commit)). It is not code-signed, so Windows may show an unknown-publisher warning."
Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe)
exit 0
