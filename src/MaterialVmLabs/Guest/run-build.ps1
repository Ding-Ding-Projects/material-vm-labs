# Runs inside a lab machine: unpacks a fresh clone, records what was installed before,
# runs the requested root entrypoints in silent mode, records what changed, gathers logs
# and built files, and writes done.json last so the host knows the run finished.
# Windows PowerShell 5.1, no external modules.
param(
    [Parameter(Mandatory)][string]$Archive,
    [Parameter(Mandatory)][string]$RunId,
    [string]$Entrypoints = 'build',
    [int]$CollectLimitMB = 1536
)
$ErrorActionPreference = 'Continue'
$base = 'C:\MaterialVmLabs'
$out = Join-Path $base "out\$RunId"
$src = "C:\s\$RunId"
New-Item -ItemType Directory -Path $out, $src -Force | Out-Null

function Get-Installed {
    $keys = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
            'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
            'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
    Get-ItemProperty -Path $keys -ErrorAction SilentlyContinue | Where-Object { $_.PSObject.Properties['DisplayName'] -and $_.DisplayName } |
        ForEach-Object { '{0} {1}' -f $_.DisplayName, $(if ($_.PSObject.Properties['DisplayVersion']) { $_.DisplayVersion } else { '' }) } | Sort-Object -Unique
}
function Get-PathEntries {
    ([Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')) -split ';' |
        Where-Object { $_ } | Sort-Object -Unique
}
function Get-Tools {
    $names = 'git', 'node', 'npm', 'python', 'py', 'choco', 'dotnet', 'cmake', 'msbuild', 'cl', 'java', 'docker', 'winget', 'pwsh'
    $h = [ordered]@{}
    foreach ($n in $names) {
        $c = Get-Command "$n.exe" -ErrorAction SilentlyContinue | Where-Object { $_.Source -notmatch 'WindowsApps' } | Select-Object -First 1
        $h[$n] = $(if ($c) { $c.Source } else { $null })
    }
    return $h
}
function Get-ChocoPackages {
    $lib = Join-Path $env:ProgramData 'chocolatey\lib'
    if (Test-Path -LiteralPath $lib) { Get-ChildItem -LiteralPath $lib -Directory | ForEach-Object Name | Sort-Object }
}

function Get-Folders {
    # Portable dependencies land in folders, not in the registry or PATH, so new folders count too.
    $roots = @($env:LOCALAPPDATA, $env:APPDATA, $env:ProgramData, $env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:USERPROFILE, 'C:\tools')
    foreach ($r in $roots) {
        if ($r -and (Test-Path -LiteralPath $r)) {
            Get-ChildItem -LiteralPath $r -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object FullName
        }
    }
}
function Get-FolderMB([string]$p) {
    $sum = (Get-ChildItem -LiteralPath $p -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
    return [math]::Round(([double]$sum) / 1MB, 1)
}
$foldersBefore = @(Get-Folders)

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$elevated = (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$before = @{ installed = @(Get-Installed); path = @(Get-PathEntries); tools = Get-Tools; choco = @(Get-ChocoPackages) }

Expand-Archive -LiteralPath $Archive -DestinationPath $src -Force
$repo = Get-ChildItem -LiteralPath $src -Directory | Select-Object -First 1
$start = Get-Date
$results = @()
foreach ($ep in ($Entrypoints -split ',')) {
    $bat = Join-Path $repo.FullName "$ep.bat"
    $log = Join-Path $out "$ep.log"
    if (-not (Test-Path -LiteralPath $bat)) {
        $results += [ordered]@{ entrypoint = "$ep.bat"; exitCode = $null; minutes = 0; result = 'missing'; log = "$ep.log" }
        continue
    }
    $t0 = Get-Date
    $env:SILENT = '1'
    $p = Start-Process -FilePath "$env:SystemRoot\System32\cmd.exe" -ArgumentList "/d /c `"`"$bat`" /s > `"$log`" 2>&1`"" `
        -WorkingDirectory $repo.FullName -Wait -PassThru -WindowStyle Hidden
    $results += [ordered]@{
        entrypoint = "$ep.bat /s"; exitCode = $p.ExitCode; minutes = [math]::Round(((Get-Date) - $t0).TotalMinutes, 1)
        result = $(if ($p.ExitCode -eq 0) { 'passed' } else { 'failed' }); log = "$ep.log"
    }
    if ($p.ExitCode -ne 0) { break }
}

$after = @{ installed = @(Get-Installed); path = @(Get-PathEntries); tools = Get-Tools; choco = @(Get-ChocoPackages) }
$newTools = [ordered]@{}
foreach ($k in $after.tools.Keys) { if (-not $before.tools[$k] -and $after.tools[$k]) { $newTools[$k] = $after.tools[$k] } }

# Collect produced files: installers, packages and archives newer than the run start, outside dependency caches.
$skip = '\\(node_modules|\.git|\.cache|obj)\\'
$produced = Get-ChildItem -LiteralPath $repo.FullName -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -ge $start -and $_.FullName -notmatch $skip -and $_.Extension -match '^\.(exe|msi|msix|appx|nupkg|zip|7z)$' -or ($_.Name -eq 'RELEASES' -and $_.LastWriteTime -ge $start) }
$artifacts = @()
$budget = [int64]$CollectLimitMB * 1MB
$artifactDir = Join-Path $out 'artifacts'
New-Item -ItemType Directory -Path $artifactDir -Force | Out-Null
foreach ($f in ($produced | Sort-Object Length)) {
    $rel = $f.FullName.Substring($repo.FullName.Length + 1)
    $entry = [ordered]@{ path = $rel; bytes = $f.Length; sha256 = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLowerInvariant(); copied = $false }
    if ($f.Length -le $budget) {
        $dest = Join-Path $artifactDir ($rel -replace '[\\/:]', '__')
        Copy-Item -LiteralPath $f.FullName -Destination $dest
        $budget -= $f.Length
        $entry.copied = $true
    }
    $artifacts += $entry
}

$result = [ordered]@{
    runId            = $RunId
    repoFolder       = $repo.Name
    elevated         = $elevated
    entrypoints      = $results
    totalMinutes     = [math]::Round(((Get-Date) - $start).TotalMinutes, 1)
    preinstalledTools = $before.tools
    newlyAvailableTools = $newTools
    installedPrograms = @($after.installed | Where-Object { $before.installed -notcontains $_ })
    newPathEntries   = @($after.path | Where-Object { $before.path -notcontains $_ })
    chocolateyPackagesAdded = @($after.choco | Where-Object { $before.choco -notcontains $_ })
    newFolders       = @(Get-Folders | Where-Object { $foldersBefore -notcontains $_ -and $_ -notlike 'C:\s\*' } | ForEach-Object { [ordered]@{ path = $_; megabytes = (Get-FolderMB $_) } })
    artifacts          = $artifacts
    os               = (Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, BuildNumber)
    finishedUtc      = (Get-Date).ToUniversalTime().ToString('o')
}
$result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $out 'result.json') -Encoding UTF8
Compress-Archive -Path (Join-Path $out '*') -DestinationPath (Join-Path $base "out\$RunId.zip") -Force
'{"done":true}' | Set-Content -LiteralPath (Join-Path $base "out\$RunId.done") -Encoding ASCII
