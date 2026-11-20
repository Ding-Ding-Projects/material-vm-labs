# Installs the owner's tools inside a lab machine set up "for you": Chocolatey, Git (Git),
# Node.js, the GitHub CLI, the Codex CLI (npm @openai/codex) and the Codex desktop
# app (Microsoft Store 9PLM9XGG6VKS through winget, the route OpenAI documents).
# Idempotent: present tools are recorded as done and skipped. Progress goes to
# C:\ProgramData\MaterialVmLabs\setup-state.json, which the Setup app reads, so closing Setup
# never stops this script. Windows PowerShell 5.1, runs in the guest only.
param([string]$Seed = 'C:\MaterialVmLabs\seed.json')
$ErrorActionPreference = 'Continue'
$dir = 'C:\ProgramData\MaterialVmLabs'
New-Item -ItemType Directory -Path $dir -Force | Out-Null
$statePath = Join-Path $dir 'setup-state.json'
$log = Join-Path $dir 'guest-tools.log'
Start-Transcript -Path $log -Append | Out-Null
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$seedObj = $null
if (Test-Path -LiteralPath $Seed) { $seedObj = Get-Content -LiteralPath $Seed -Raw | ConvertFrom-Json }
$order = @('choco', 'git', 'node', 'gh', 'cli', 'desktop')
$items = [ordered]@{}
foreach ($k in $order) { $items[$k] = [ordered]@{ status = 'pending'; detail = ''; version = '' } }
$shared = $null
if ($seedObj -and $seedObj.share) { $shared = [ordered]@{ guestPath = $seedObj.share.guestPath; hostPath = $seedObj.share.hostPath; shortcut = $true } }

function Save-State([bool]$Running) {
    $o = [ordered]@{
        schema = 1
        name = $(if ($seedObj) { $seedObj.name } else { $env:COMPUTERNAME })
        hypervisor = $(if ($seedObj) { $seedObj.hypervisor } else { '' })
        owner = $(if ($seedObj -and $seedObj.owner) { $seedObj.owner } else { 'you' })
        updatedUtc = (Get-Date).ToUniversalTime().ToString('o')
        running = $Running
        items = $items
        shared = $shared
        log = $log
    }
    $tmp = "$statePath.tmp"
    $o | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $tmp -Encoding UTF8
    Move-Item -LiteralPath $tmp -Destination $statePath -Force
}

function Update-Path {
    $m = [Environment]::GetEnvironmentVariable('Path', 'Machine'); $u = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$m;$u;$env:APPDATA\npm"
}

function Get-Version([string]$Command, [string[]]$Arguments) {
    $c = Get-Command $Command -ErrorAction SilentlyContinue
    if (-not $c) { return $null }
    # Collect every line first: piping a native command into Select-Object -First stops it early and
    # leaves $LASTEXITCODE wrong, which marked installed tools as failed (seen 2026-11-19).
    try {
        $lines = @(& $c.Source @Arguments 2>$null)
        $code = $LASTEXITCODE
        $first = $lines | Where-Object { "$_".Trim() } | Select-Object -First 1
        if ($code -eq 0 -and $first) { return ([string]$first).Trim() }
    } catch { }
    return $null
}

function Step([string]$Key, [scriptblock]$Present, [scriptblock]$Install) {
    $v = & $Present
    if ($v) { $items[$Key].status = 'done'; $items[$Key].version = $v; $items[$Key].detail = 'already installed'; Save-State $true; return }
    $items[$Key].status = 'running'; $items[$Key].detail = 'installing'; Save-State $true
    try { & $Install } catch { Write-Output "$Key install threw: $($_.Exception.Message)" }
    Update-Path
    $v = & $Present
    if ($v) { $items[$Key].status = 'done'; $items[$Key].version = $v; $items[$Key].detail = 'installed' }
    else { $items[$Key].status = 'failed'; $items[$Key].detail = "not found after install; see $log" }
    Save-State $true
}

Update-Path
Save-State $true

Step 'choco' { Get-Version 'choco.exe' @('--version') } {
    # The official Chocolatey install script, over HTTPS.
    Set-ExecutionPolicy Bypass -Scope Process -Force
    Invoke-Expression ((New-Object Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
}
$choco = 'C:\ProgramData\chocolatey\bin\choco.exe'
# The Chocolatey feed sometimes fails a dependency lookup on a fresh host (seen 2026-11-19 with git);
# try each package up to three times before calling it failed.
function Install-Choco([string]$Package) {
    for ($i = 1; $i -le 3; $i++) {
        & $choco install $Package -y --no-progress | Select-Object -Last 3 | ForEach-Object { Write-Output "choco: $_" }
        if ($LASTEXITCODE -eq 0) { return }
        Write-Output "choco: $Package attempt $i exited $LASTEXITCODE; retrying in 20 s"
        Start-Sleep -Seconds 20
    }
}
Step 'git' { $v = Get-Version 'git.exe' @('--version'); if ($v) { $v -replace '^git version ', '' } } { Install-Choco 'git' }
Step 'node' { $v = Get-Version 'node.exe' @('--version'); if ($v) { $v.TrimStart('v') } } { Install-Choco 'nodejs-lts' }
Step 'gh' { $v = Get-Version 'gh.exe' @('--version'); if ($v) { ($v -split ' ')[2] } } { Install-Choco 'gh' }
Step 'cli' { Get-Version 'codex.cmd' @('--version') } {
    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($npm) { & $npm.Source install -g '@openai/codex' 2>&1 | Select-Object -Last 3 | ForEach-Object { Write-Output "npm: $_" } }
}
Step 'desktop' {
    # Judge by what is registered, not by what winget prints: the Store can report success and
    # still be finishing in its own queue.
    $pkg = Get-AppxPackage -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'Codex' } | Select-Object -First 1
    if ($pkg) { "$($pkg.Name) $($pkg.Version)" }
} {
    # A fresh Windows image ships an App Installer whose winget cannot open the Store source
    # (0x8a15005e, certificate pinning). Update it from Microsoft's own release first: the frameworks
    # it needs, then App Installer itself, each checked for a valid signature.
    $ProgressPreference = 'SilentlyContinue'
    $tmp = Join-Path $env:TEMP 'mvl-winget'
    New-Item -ItemType Directory -Force $tmp | Out-Null
    try {
        $zip = Join-Path $tmp 'deps.zip'
        Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/microsoft/winget-cli/releases/latest/download/DesktopAppInstaller_Dependencies.zip' -OutFile $zip
        Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
        foreach ($d in Get-ChildItem -Path $tmp -Recurse -Include *.appx, *.msix | Where-Object { $_.FullName -match '\\x64\\' }) {
            if ((Get-AuthenticodeSignature $d.FullName).Status -ne 'Valid') { Write-Output "winget: skipped unsigned $($d.Name)"; continue }
            try { Add-AppxPackage -Path $d.FullName -ErrorAction Stop; Write-Output "winget: framework $($d.Name)" } catch { Write-Output "winget: framework $($d.Name): $($_.Exception.Message.Split([char]10)[0])" }
        }
        $bundle = Join-Path $tmp 'AppInstaller.msixbundle'
        Invoke-WebRequest -UseBasicParsing -Uri 'https://aka.ms/getwinget' -OutFile $bundle
        if ((Get-AuthenticodeSignature $bundle).Status -eq 'Valid') { Add-AppxPackage -Path $bundle -ForceApplicationShutdown -ErrorAction Stop; Write-Output 'winget: App Installer updated' }
        else { Write-Output 'winget: App Installer bundle signature not valid; not installed' }
    } catch { Write-Output "winget: update failed: $($_.Exception.Message.Split([char]10)[0])" }
    $wg = Get-Command winget.exe -ErrorAction SilentlyContinue
    if ($wg) {
        & $wg.Source install --id 9PLM9XGG6VKS -s msstore --accept-package-agreements --accept-source-agreements --silent --disable-interactivity 2>&1 |
            Where-Object { "$_".Trim() -and "$_" -notmatch '^\s*[-\\|/]\s*$' } | ForEach-Object { Write-Output "winget: $_" }
        Write-Output "winget exit $LASTEXITCODE"
        # Give the Store a few minutes to finish what winget queued.
        for ($i = 0; $i -lt 12 -and -not (Get-AppxPackage -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'Codex' }); $i++) { Start-Sleep -Seconds 15 }
    }
    else { Write-Output 'winget is not available in this guest yet.' }
}

# The shared folder shortcut on every user's desktop.
if ($shared) {
    try {
        $lnk = Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'Shared with host.lnk'
        $ws = New-Object -ComObject WScript.Shell
        $sc = $ws.CreateShortcut($lnk); $sc.TargetPath = $shared.guestPath; $sc.Save()
    } catch { $shared.shortcut = $false }
}
Save-State $false
Stop-Transcript | Out-Null
