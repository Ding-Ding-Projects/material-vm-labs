# download-dependencies.ps1: the worker behind download-dependencies.bat.
# Reads dependencies.json, fetches every pinned dependency for this platform into a per-user
# folder, verifies its SHA-256 before extracting, and activates it with a staged, locked and
# journaled swap that keeps the last good copy. Dependencies without a recorded digest are only
# detected, never downloaded. Fetched files never go into the repository.
# Phases print "[..]" when starting, "[ok]" when done and "problem:" on the first real failure.
param(
    [switch]$Silent,
    [string]$PathFile = '',
    [switch]$SkipPackages
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
$t0 = Get-Date
function Phase([string]$m) { Write-Host ("{0} [..] {1}" -f (Get-Date).ToString('HH:mm:ss'), $m) }
function Done([string]$m) { Write-Host ("{0} [ok] {1}" -f (Get-Date).ToString('HH:mm:ss'), $m) }
function Note([string]$m) { Write-Host ("{0} [--] {1}" -f (Get-Date).ToString('HH:mm:ss'), $m) }
function Sha256([string]$p) { (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() }

$manifestPath = Join-Path $root 'dependencies.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.schemaVersion -ne 1) { Write-Host 'problem: dependencies.json has an unknown schemaVersion.'; exit 2 }
$platform = if ([Environment]::Is64BitOperatingSystem) { 'win-x64' } else { 'win-x86' }
$depsRoot = Join-Path ($env:LOCALAPPDATA) 'MaterialVmLabs\deps'
New-Item -ItemType Directory -Path $depsRoot -Force | Out-Null
$journal = Join-Path $depsRoot 'activation.journal.json'
$lockDir = Join-Path $depsRoot '.lock'
$pathEntries = New-Object System.Collections.Generic.List[string]

# ---------- exclusive lock ----------
# A lock folder is created atomically; a lock left by a process that no longer exists is taken over.
$deadline = (Get-Date).AddMinutes(10)
while ($true) {
    try { New-Item -ItemType Directory -Path $lockDir -ErrorAction Stop | Out-Null; Set-Content -LiteralPath (Join-Path $lockDir 'pid') -Value $PID; break }
    catch {
        $owner = 0; try { $owner = [int](Get-Content -LiteralPath (Join-Path $lockDir 'pid') -ErrorAction Stop) } catch { }
        if ($owner -and -not (Get-Process -Id $owner -ErrorAction SilentlyContinue)) { Note "Taking over a lock left by process $owner, which has ended."; Remove-Item -LiteralPath $lockDir -Recurse -Force; continue }
        if ((Get-Date) -gt $deadline) { Write-Host "problem: another dependency fetch (process $owner) has held $lockDir for 10 minutes."; exit 3 }
        Start-Sleep -Seconds 2
    }
}

# A tree is valid when its receipt exists and every file it lists still has the recorded SHA-256.
# A receipt alone is never trusted: a changed executable beside an unchanged receipt is refetched.
function Test-Tree([string]$dir) {
    $r = Join-Path $dir '.mvl-receipt.json'
    if (-not (Test-Path -LiteralPath $r)) { return $false }
    try { $rec = Get-Content -LiteralPath $r -Raw | ConvertFrom-Json } catch { return $false }
    foreach ($f in $rec.files.PSObject.Properties) {
        $p = Join-Path $dir $f.Name
        if (-not (Test-Path -LiteralPath $p)) { return $false }
        if ((Sha256 $p) -ne $f.Value) { return $false }
    }
    return [bool]$rec.files.PSObject.Properties.Name
}

function Write-Journal($obj) {
    $tmp = "$journal.$PID.tmp"
    $obj | ConvertTo-Json | Set-Content -LiteralPath $tmp -Encoding UTF8
    Move-Item -LiteralPath $tmp -Destination $journal -Force
}

# ---------- recover an interrupted activation ----------
function Restore-FromJournal {
    if (-not (Test-Path -LiteralPath $journal)) { return }
    Phase 'Found an activation journal from an interrupted run; recovering before anything reads the folders.'
    $j = $null
    try { $j = Get-Content -LiteralPath $journal -Raw | ConvertFrom-Json } catch { $j = $null }
    $stamp = (Get-Date).ToString('yyyyMMddHHmmss')
    if (-not $j -or -not $j.active -or -not $j.backup) {
        # Malformed or truncated journal: judge every candidate tree on its own receipt.
        $candidates = @(Get-ChildItem -LiteralPath $depsRoot -Directory | Where-Object { $_.Name -notmatch '^\.' -and $_.Name -notmatch '\.(bak|quarantine-\d+)$' })
        $bad = $false
        foreach ($c in $candidates) {
            if (Test-Tree $c.FullName) { continue }
            $bak = "$($c.FullName).bak"
            if ((Test-Path -LiteralPath $bak) -and (Test-Tree $bak)) {
                Move-Item -LiteralPath $c.FullName -Destination "$($c.FullName).quarantine-$stamp"
                Move-Item -LiteralPath $bak -Destination $c.FullName
                Note "Restored $($c.Name) from its verified backup."
            } else { $bad = $true }
        }
        foreach ($b in @(Get-ChildItem -LiteralPath $depsRoot -Directory -Filter '*.bak')) {
            $active = $b.FullName -replace '\.bak$', ''
            if (-not (Test-Path -LiteralPath $active) -and (Test-Tree $b.FullName)) { Move-Item -LiteralPath $b.FullName -Destination $active; Note "Restored $(Split-Path $active -Leaf) from its verified backup." }
        }
        if ($bad) { Write-Host "problem: the activation journal is unreadable and a dependency folder has no valid copy. The journal is kept at $journal as evidence."; exit 5 }
        Move-Item -LiteralPath $journal -Destination "$journal.quarantine-$stamp"
        Done 'Unreadable journal quarantined; every active folder verified.'
        return
    }
    if (Test-Tree $j.active) {
        if (Test-Path -LiteralPath $j.backup) { Remove-Item -LiteralPath $j.backup -Recurse -Force }
    } elseif ((Test-Path -LiteralPath $j.backup) -and (Test-Tree $j.backup)) {
        if (Test-Path -LiteralPath $j.active) { Move-Item -LiteralPath $j.active -Destination "$($j.active).quarantine-$stamp" }
        Move-Item -LiteralPath $j.backup -Destination $j.active
        Note "Restored $(Split-Path $j.active -Leaf) from its verified backup."
    } elseif (Test-Path -LiteralPath $j.active) {
        Move-Item -LiteralPath $j.active -Destination "$($j.active).quarantine-$stamp"
        Note "Neither copy of $(Split-Path $j.active -Leaf) verifies; it will be fetched again."
    }
    if ($j.staging -and (Test-Path -LiteralPath $j.staging)) { Remove-Item -LiteralPath $j.staging -Recurse -Force }
    Remove-Item -LiteralPath $journal -Force
    Done 'Interrupted activation recovered.'
}

function Expand-Into([string]$archive, [string]$kind, [string]$dest) {
    if ($kind -eq 'zip') { Expand-Archive -LiteralPath $archive -DestinationPath $dest -Force; return }
    & tar.exe -xf $archive -C $dest
    if ($LASTEXITCODE -ne 0) { throw "tar could not extract $archive (exit $LASTEXITCODE)." }
}

function Install-Pinned($d) {
    $active = Join-Path $depsRoot "$($d.name)-$($d.version)"
    $entry = if ($d.pathEntry -and $d.pathEntry -ne '.') { Join-Path $active $d.pathEntry } else { $active }
    if (Test-Tree $active) { Done "$($d.name) $($d.version) already present and verified in $active."; $pathEntries.Add($entry); return }
    $p0 = Get-Date
    $staging = Join-Path $depsRoot (".staging-{0}-{1}" -f $PID, [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $staging -Force | Out-Null
    try {
        $file = Join-Path $staging ([IO.Path]::GetFileName(([uri]$d.source).AbsolutePath))
        Phase "Downloading $($d.name) $($d.version) from $($d.source)."
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072
        try { Invoke-WebRequest -Uri $d.source -OutFile $file -UseBasicParsing -TimeoutSec 600 }
        catch { throw "could not download $($d.name) $($d.version) from $($d.source): $($_.Exception.Message)" }
        $got = Sha256 $file
        if ($got -ne $d.sha256) { throw "$($d.name) $($d.version) from $($d.source) has SHA-256 $got; dependencies.json records $($d.sha256). Nothing was extracted." }
        Done "SHA-256 verified for $([IO.Path]::GetFileName($file))."
        $out = Join-Path $staging 'x'
        New-Item -ItemType Directory -Path $out | Out-Null
        Expand-Into $file $d.archive $out
        $tree = Join-Path $out $d.root
        if (-not (Test-Path -LiteralPath $tree)) { throw "$($d.name) archive has no $($d.root) folder." }
        $files = [ordered]@{}
        foreach ($p in $d.provides) {
            $f = Join-Path $tree $p
            if (-not (Test-Path -LiteralPath $f) -or (Get-Item -LiteralPath $f).Length -eq 0) { throw "$($d.name) archive is missing $p." }
            $files[$p] = Sha256 $f
        }
        @{ name = $d.name; version = $d.version; source = $d.source; archiveSha256 = $got; files = $files; fetchedUtc = (Get-Date).ToUniversalTime().ToString('o') } |
            ConvertTo-Json | Set-Content -LiteralPath (Join-Path $tree '.mvl-receipt.json') -Encoding UTF8
        if (-not (Test-Tree $tree)) { throw "$($d.name) did not verify after extraction." }
        # Journaled swap: active -> backup, staged -> active; the backup is removed only after success.
        $backup = "$active.bak"
        if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Recurse -Force }
        Write-Journal @{ name = $d.name; active = $active; backup = $backup; staging = $staging; phase = 'swap' }
        try {
            if (Test-Path -LiteralPath $active) { Move-Item -LiteralPath $active -Destination $backup }
            Move-Item -LiteralPath $tree -Destination $active
            if (-not (Test-Tree $active)) { throw 'the activated folder does not verify' }
        } catch {
            if (Test-Path -LiteralPath $active) { Remove-Item -LiteralPath $active -Recurse -Force }
            if (Test-Path -LiteralPath $backup) { Move-Item -LiteralPath $backup -Destination $active }
            Remove-Item -LiteralPath $journal -Force -ErrorAction SilentlyContinue
            throw "activating $($d.name) failed ($($_.Exception.Message)); the previous copy was restored."
        }
        if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Recurse -Force }
        Remove-Item -LiteralPath $journal -Force
        Done ("{0} {1} installed in {2} ({3:N0} s)." -f $d.name, $d.version, $active, ((Get-Date) - $p0).TotalSeconds)
        $pathEntries.Add($entry)
    } finally {
        if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue }
    }
}

$code = 0
try {
    Restore-FromJournal
    Phase "Platform $platform; dependencies go to $depsRoot (per user, no administrator rights)."
    foreach ($d in @($manifest.dependencies | Where-Object { $_.platform -eq $platform })) {
        if ($d.status -eq 'unpinned') {
            $cmd = Get-Command $d.detect -ErrorAction SilentlyContinue
            if ($cmd) { Done "$($d.name) found at $($cmd.Source) (detected only: $($d.reason))" }
            else { Note "$($d.name) $($d.versionFamily) is not installed and is not fetched here: $($d.reason) Canonical source: $($d.canonicalSource)" }
            continue
        }
        Install-Pinned $d
    }
    foreach ($e in $pathEntries) { if (($env:Path -split ';') -notcontains $e) { $env:Path = "$e;$env:Path" } }
    if (-not $SkipPackages) {
        foreach ($p in $manifest.packages) {
            if ($p.platforms -and ($p.platforms -notcontains 'win')) { continue }
            $dir = Join-Path $root $p.dir
            $lock = Join-Path $root $p.lockfile
            if (-not (Test-Path -LiteralPath $lock)) { Note "$($p.name): no $($p.lockfile); skipped."; continue }
            $marker = Join-Path $dir 'node_modules\.mvl-lock.sha256'
            $want = Sha256 $lock
            if ((Test-Path -LiteralPath $marker) -and ((Get-Content -LiteralPath $marker -Raw).Trim() -eq $want) -and (Test-Path -LiteralPath (Join-Path $dir 'node_modules\.package-lock.json'))) {
                Done "$($p.name): packages match $($p.lockfile)."
                continue
            }
            Phase "$($p.name): $($p.command) (checked against $($p.verifiedBy))."
            Push-Location $dir
            try {
                & cmd.exe /d /c "npm ci --no-audit --no-fund"
                if ($LASTEXITCODE -ne 0) { throw "$($p.name): npm ci failed (exit $LASTEXITCODE) using $($p.lockfile)." }
            } finally { Pop-Location }
            Set-Content -LiteralPath $marker -Value $want
            Done "$($p.name): packages installed."
        }
    }
    # One line, so the calling batch file prepends it with a single set and never re-parses PATH.
    if ($PathFile) { (@($pathEntries) -join ';') | Set-Content -LiteralPath $PathFile -Encoding ASCII }
    Done ("Dependencies ready in {0:N0} s." -f ((Get-Date) - $t0).TotalSeconds)
} catch {
    Write-Host "problem: $($_.Exception.Message)"
    $code = 1
} finally {
    Remove-Item -LiteralPath $lockDir -Recurse -Force -ErrorAction SilentlyContinue
}
exit $code
