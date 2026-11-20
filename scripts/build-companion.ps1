# build-companion.ps1: builds the lab machine companions (Electron).
#   -Mode portable  -> MaterialVmLabs-<ver>.exe (the manager), MaterialVmLabs-Docs-<ver>.exe and MaterialVmLabs-Build-<ver>.exe (single portable exes) in dist\
#   -Mode installer -> unsigned Squirrel.Windows installer of the manager (it contains the docs reader and the build bay) in dist\installer\
# Node.js is installed with Chocolatey when missing. Nothing is ever signed or published.
param([ValidateSet('portable', 'installer')][string]$Mode = 'portable')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$companion = Join-Path $root 'companion'
$dist = Join-Path $root 'dist'
function Phase([string]$m) { Write-Host ("{0} [..] {1}" -f (Get-Date).ToString('HH:mm:ss'), $m) }
function Done([string]$m) { Write-Host ("{0} [ok] {1}" -f (Get-Date).ToString('HH:mm:ss'), $m) }
function Refresh-Path {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = (@($machine, $user) | Where-Object { $_ }) -join ';'
}

if ($Mode -eq 'portable' -and $env:MVL_BUILD_FROM_GUI -eq '1') {
    Done 'Companion build skipped: this build was started from the build GUI, which must not rebuild the exe that is running it. Run build.bat from a console to rebuild the companions.'
    exit 0
}
if (-not (Test-Path -LiteralPath (Join-Path $companion 'package.json'))) { Write-Host 'problem: companion\package.json is missing.'; exit 3 }

function Install-ChocoDependency([string]$Command, [string]$Package) {
    # Detect first; install only what is missing, through Chocolatey.
    if (Get-Command $Command -ErrorAction SilentlyContinue) { return }
    if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
        Phase 'Chocolatey is missing; installing it from https://community.chocolatey.org/install.ps1 (needs a administrator shell).'
        Set-ExecutionPolicy Bypass -Scope Process -Force
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072
        Invoke-Expression ((New-Object Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
        Refresh-Path
        if (-not (Get-Command choco -ErrorAction SilentlyContinue)) { throw 'Chocolatey did not install (a cancelled or missing UAC prompt leaves it incomplete).' }
    }
    Phase "Installing $Package with Chocolatey."
    & choco install $Package -y --no-progress
    if ($LASTEXITCODE -ne 0) { throw "choco install $Package failed (exit $LASTEXITCODE)." }
    Refresh-Path
    if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) { throw "$Command is still not on PATH after installing $Package." }
}

try {
    Phase 'Checking dependencies: Node.js and Git.'
    Install-ChocoDependency 'node' 'nodejs-lts'
    # Git embeds the exact commit's source into the build GUI; a fresh host has none (seen on the self-hosted runner 2026-11-17).
    Install-ChocoDependency 'git' 'git'
    Done ("Node.js {0}, npm {1}, {2}." -f (& node -v), (& npm -v), (& git --version))

    Push-Location $companion
    try {
        Phase 'Installing companion dependencies with npm ci.'
        & npm ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw "npm ci failed (exit $LASTEXITCODE)." }
        $script = if ($Mode -eq 'installer') { 'dist:installer' } else { 'dist:portable' }
        Phase "Running npm run $script (unsigned)."
        & npm run $script
        if ($LASTEXITCODE -ne 0) { throw "npm run $script failed (exit $LASTEXITCODE)." }
    } finally { Pop-Location }

    New-Item -ItemType Directory -Path $dist -Force | Out-Null
    $outputs = @()
    if ($Mode -eq 'portable') {
        # Exact versioned names: a wildcard picked a stale older exe left in out\ (seen 2026-11-17).
        $ver = (Get-Content -LiteralPath (Join-Path (Split-Path -Parent $companion) 'VERSION') -Raw).Trim()
        foreach ($pair in @(@('manager', "MaterialVmLabs-$ver.exe"), @('docs', "MaterialVmLabs-Docs-$ver.exe"), @('build', "MaterialVmLabs-Build-$ver.exe"))) {
            $p = Join-Path $companion "out\$($pair[0])\$($pair[1])"
            if (-not (Test-Path -LiteralPath $p)) { throw "Expected output $($pair[1]) was not produced." }
            $f = Get-Item -LiteralPath $p
            Copy-Item -LiteralPath $f.FullName -Destination (Join-Path $dist $f.Name) -Force
            $outputs += (Join-Path $dist $f.Name)
        }
    } else {
        $inst = Join-Path $dist 'installer'
        if (Test-Path -LiteralPath $inst) { Remove-Item -LiteralPath $inst -Recurse -Force }
        New-Item -ItemType Directory -Path $inst -Force | Out-Null
        $src = Join-Path $companion 'out\installer\squirrel-windows'
        $setup = Get-ChildItem -LiteralPath $src -Filter '*Setup*.exe' -File -ErrorAction SilentlyContinue | Select-Object -First 1
        $rel = Get-ChildItem -LiteralPath $src -Filter 'RELEASES' -File -ErrorAction SilentlyContinue | Select-Object -First 1
        # Only the packages this build's RELEASES lists; older ones linger in out\ for deltas.
        $listed = @()
        if ($rel) { $listed = @(Get-Content -LiteralPath $rel.FullName | ForEach-Object { ($_ -split '\s+')[1] } | Where-Object { $_ }) }
        $nupkgs = @(Get-ChildItem -LiteralPath $src -Filter '*.nupkg' -File -ErrorAction SilentlyContinue | Where-Object { $listed -contains $_.Name })
        if (-not $setup -or -not $rel -or -not $nupkgs.Count) { throw 'The Squirrel.Windows output is incomplete (needs Setup exe, RELEASES and a nupkg).' }
        Copy-Item -LiteralPath $setup.FullName -Destination (Join-Path $inst 'MaterialVmLabsSetup.exe') -Force
        Copy-Item -LiteralPath $rel.FullName -Destination (Join-Path $inst 'RELEASES') -Force
        foreach ($n in $nupkgs) { Copy-Item -LiteralPath $n.FullName -Destination (Join-Path $inst $n.Name) -Force }
        $outputs = @(Get-ChildItem -LiteralPath $inst -File | ForEach-Object { $_.FullName })
        Write-Host 'The installer is UNSIGNED Squirrel.Windows output (Windows will show an unknown-publisher warning).'
    }
    foreach ($o in $outputs) {
        $i = Get-Item -LiteralPath $o
        $h = (Get-FileHash -LiteralPath $o -Algorithm SHA256).Hash.ToLowerInvariant()
        Done ("{0} ({1:N1} MB) sha256 {2}" -f $o, ($i.Length / 1MB), $h)
    }
    Done "Companion $Mode build finished."
    exit 0
} catch {
    Write-Host "problem: $($_.Exception.Message)"
    exit 1
}
