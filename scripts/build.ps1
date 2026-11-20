# build.ps1: lab machine build. Phases: dependency check, parse every script, run the test
# suite, package the portable dist zip with its SHA-256, then build the companions when the
# companion folder exists (Node.js through Chocolatey when missing).
param([switch]$Silent, [switch]$SkipCompanion)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$t0 = Get-Date
function Phase([string]$m) { Write-Host ("{0} [..] {1}" -f (Get-Date).ToString('HH:mm:ss'), $m) }
function Done([string]$m) { Write-Host ("{0} [ok] {1}" -f (Get-Date).ToString('HH:mm:ss'), $m) }

Phase "PowerShell $($PSVersionTable.PSVersion) found (built into Windows; no other dependency is needed for the core)."
$version = (Get-Content -LiteralPath (Join-Path $root 'VERSION') -Raw).Trim()
$commit = 'unknown'
try { $commit = (& git -C $root rev-parse HEAD 2>$null).Trim() } catch { }
if (-not $commit -or $commit -eq 'unknown') {
    $manifest = Join-Path $root 'source-manifest.json'
    if (Test-Path -LiteralPath $manifest) { $commit = (Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json).commit }
}

Phase 'Parsing every PowerShell script.'
$bad = 0
Get-ChildItem -LiteralPath $root -Recurse -Filter '*.ps1' | Where-Object { $_.FullName -notmatch '\\(node_modules|dist|out)\\' } | ForEach-Object {
    $tokens = $null; $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$tokens, [ref]$errors)
    if ($errors.Count) { $bad++; Write-Host "  problem in $($_.Name): $($errors[0].Message)" }
}
if ($bad) { throw "$bad script(s) do not parse." }
Done 'Every script parses.'

Phase 'Checking every JavaScript file parses.'
$node = Get-Command node.exe -ErrorAction SilentlyContinue
if ($node) {
    $badJs = 0
    # Node writes failures to stderr; Windows PowerShell 5.1 would turn that into a terminating error
    # under 'Stop', so each check runs through cmd and is judged by its exit code alone.
    Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object { $_.Extension -in '.js', '.mjs' -and $_.FullName -notmatch '\\(node_modules|dist|out|generated|\.git)\\' } | ForEach-Object {
        $out = & cmd.exe /d /c "`"$($node.Source)`" --check `"$($_.FullName)`" 2>&1"
        if ($LASTEXITCODE -ne 0) {
            $badJs++
            $why = @($out | Where-Object { $_ -match 'Error' }) | Select-Object -First 1
            Write-Host "  problem in $($_.FullName.Substring($root.Length + 1)): $why"
        }
    }
    if ($badJs) { throw "$badJs JavaScript file(s) do not parse." }
    Done 'Every JavaScript file parses.'
} else { Phase 'Node.js is not installed yet; the companion build below installs it and parses the files as it bundles them.' }

if ($env:MVL_RELEASE_BUILD -eq '1') {
    Phase 'Release build: the test suite is not run here; the build workflow runs it on the same commit.'
} else {
    Phase 'Running the offline test suite.'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'tests\run-tests.ps1')
    if ($LASTEXITCODE -ne 0) { throw "Test suite failed (exit $LASTEXITCODE)." }
    Done 'Test suite passed.'
}

$guestProj = Join-Path $root 'guest-setup\MaterialVmLabsSetup.csproj'
if (Test-Path -LiteralPath $guestProj) {
    Phase 'Building the guest Setup app (C#, one self-contained exe).'
    if (-not (Get-Command dotnet.exe -ErrorAction SilentlyContinue)) {
        $choco = Get-Command choco.exe -ErrorAction SilentlyContinue
        if (-not $choco) { throw 'The .NET SDK (dependency) is missing and Chocolatey is not available to install it.' }
        Phase 'Installing the .NET 8 SDK dependency through Chocolatey.'
        & $choco.Source install dotnet-8.0-sdk -y --no-progress | Out-Null
        $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
        if (-not (Get-Command dotnet.exe -ErrorAction SilentlyContinue)) { throw 'The .NET SDK install did not put dotnet on PATH.' }
    }
    Push-Location (Join-Path $root 'guest-setup')
    try {
        & dotnet publish MaterialVmLabsSetup.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true `
            -p:IncludeNativeLibrariesForSelfExtract=true -o out --nologo -v q
        if ($LASTEXITCODE -ne 0) { throw "Guest Setup build failed (exit $LASTEXITCODE)." }
    } finally { Pop-Location }
    Done 'Guest Setup built: guest-setup\out\MaterialVmLabsSetup.exe'
}

Phase 'Packaging the portable dist zip.'
$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Path $dist -Force | Out-Null
$stage = Join-Path $dist 'stage\material-vm-labs'
if (Test-Path -LiteralPath (Split-Path $stage)) { Remove-Item -LiteralPath (Split-Path $stage) -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null
foreach ($item in @('src', 'mvl.bat', 'VERSION', 'README.md', 'docs')) {
    $p = Join-Path $root $item
    if (Test-Path -LiteralPath $p) { Copy-Item -LiteralPath $p -Destination $stage -Recurse }
}
# The guest Setup source and its built exe ride along so a dist zip sets up owner machines without the .NET SDK.
if (Test-Path -LiteralPath $guestProj) {
    Copy-Item -LiteralPath (Join-Path $root 'guest-setup') -Destination $stage -Recurse
    foreach ($junk in @('bin', 'obj')) { $j = Join-Path $stage "guest-setup\$junk"; if (Test-Path -LiteralPath $j) { Remove-Item -LiteralPath $j -Recurse -Force } }
}
@{ product = 'material-vm-labs'; version = $version; commit = $commit; builtUtc = (Get-Date).ToUniversalTime().ToString('o') } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stage 'build-info.json') -Encoding UTF8
$zip = Join-Path $dist "material-vm-labs-$version.zip"
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
Compress-Archive -Path $stage -DestinationPath $zip
Remove-Item -LiteralPath (Split-Path $stage) -Recurse -Force
$sha = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
Done "Built $zip ($([math]::Round((Get-Item $zip).Length / 1KB)) KB) sha256 $sha"

$companion = Join-Path $root 'companion\package.json'
if ((Test-Path -LiteralPath $companion) -and -not $SkipCompanion) {
    Phase 'Building the companions (documentation site and build GUI).'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\build-companion.ps1') -Mode portable
    if ($LASTEXITCODE -ne 0) { throw "Companion build failed (exit $LASTEXITCODE)." }
    Done 'Companions built.'
} else {
    Phase 'Companion folder not present or skipped; core build only.'
}
Done ("Build finished in {0:N1} minutes." -f ((Get-Date) - $t0).TotalMinutes)
