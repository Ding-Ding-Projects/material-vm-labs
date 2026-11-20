# Runs once inside a new lab machine guest at first logon (from the answer file).
# Installs the hypervisor's guest tools, keeps the guest awake, records readiness facts,
# signals the host, then shuts the guest down so the host can take the clean baseline.
# Windows PowerShell 5.1, no external modules.
$ErrorActionPreference = 'Continue'
$work = 'C:\MaterialVmLabs'
New-Item -ItemType Directory -Path $work -Force | Out-Null
Start-Transcript -Path (Join-Path $work 'firstlogon.log') -Append | Out-Null

function Find-Drive([string]$relative) {
    foreach ($d in Get-PSDrive -PSProvider FileSystem) {
        $p = Join-Path $d.Root $relative
        if (Test-Path -LiteralPath $p) { return $d.Root }
    }
    return $null
}

$seedRoot = Find-Drive 'mvl\seed.json'
$seed = Get-Content -LiteralPath (Join-Path $seedRoot 'mvl\seed.json') -Raw | ConvertFrom-Json
Write-Output "Seed: $($seed.name) on $($seed.hypervisor)"

$toolsResult = 'not attempted'
if ($seed.hypervisor -eq 'vmware') {
    # Workstation 26 ships one 64-bit setup.exe; older tools media also carried setup64.exe.
    $toolsRoot = Find-Drive 'VMwareToolsUpgrader.exe'
    if (-not $toolsRoot) { $toolsRoot = Find-Drive 'setup64.exe' }
    if ($toolsRoot) {
        $exe = Join-Path $toolsRoot 'setup64.exe'
        if (-not (Test-Path -LiteralPath $exe)) { $exe = Join-Path $toolsRoot 'setup.exe' }
        $p = Start-Process -FilePath $exe -ArgumentList '/S /v "/qn REBOOT=R"' -Wait -PassThru
        $toolsResult = "VMware Tools setup exit $($p.ExitCode)"
    } else { $toolsResult = 'VMware Tools media not found' }
} else {
    $toolsRoot = Find-Drive 'VBoxWindowsAdditions.exe'
    if ($toolsRoot) {
        $certUtil = Join-Path $toolsRoot 'cert\VBoxCertUtil.exe'
        if (Test-Path -LiteralPath $certUtil) {
            $certs = Get-ChildItem -Path (Join-Path $toolsRoot 'cert') -Filter 'vbox*.cer' | ForEach-Object FullName
            & $certUtil add-trusted-publisher @certs --root @certs | Out-Null
        }
        $p = Start-Process -FilePath (Join-Path $toolsRoot 'VBoxWindowsAdditions.exe') -ArgumentList '/S' -Wait -PassThru
        $toolsResult = "VirtualBox Guest Additions exit $($p.ExitCode)"
    } else { $toolsResult = 'Guest Additions media not found' }
}
Write-Output $toolsResult

# Remote Desktop pre-opened inside the guest. Network Level
# Authentication stays on; this changes the throwaway guest only.
Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server' -Name fDenyTSConnections -Value 0
netsh.exe advfirewall firewall set rule group="remote desktop" new enable=Yes | Out-Null

# Keep the guest awake while builds run; this changes the guest only.
powercfg.exe /change standby-timeout-ac 0
powercfg.exe /change monitor-timeout-ac 0
powercfg.exe /hibernate off
# Do not let Windows Update restart the guest under a running build.
$au = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU'
New-Item -Path $au -Force | Out-Null
New-ItemProperty -Path $au -Name NoAutoRebootWithLoggedOnUsers -Value 1 -PropertyType DWord -Force | Out-Null

# Owner tools and the Setup app: only on machines set up "for you"
# or with --tools. A lab machine Claude creates for fresh-host testing stays bare.
$toolsRun = 'not requested'
if ($seed.tools) {
    $seed | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $work 'seed.json') -Encoding UTF8
    Copy-Item -LiteralPath (Join-Path $seedRoot 'mvl\guest-tools.ps1') -Destination (Join-Path $work 'guest-tools.ps1') -Force
    $taskCmd = "-NoProfile -ExecutionPolicy Bypass -File `"$work\guest-tools.ps1`""
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $taskCmd
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest
    Register-ScheduledTask -TaskPath '\MaterialVmLabs\' -TaskName 'Guest Tools' -Action $action -Principal $principal -Force | Out-Null
    $t0 = Get-Date
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $work 'guest-tools.ps1')
    $toolsRun = "guest-tools.ps1 ran in $([math]::Round(((Get-Date) - $t0).TotalMinutes, 1)) min"
}
if ($seed.owner -eq 'you') {
    $exe = Join-Path $work 'MaterialVmLabsSetup.exe'
    Copy-Item -LiteralPath (Join-Path $seedRoot 'mvl\MaterialVmLabsSetup.exe') -Destination $exe -Force
    New-ItemProperty -Path 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'MaterialVmLabsSetup' -Value "`"$exe`" --first-run" -PropertyType String -Force | Out-Null
    $startMenu = Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'Material VM Labs Setup.lnk'
    $ws = New-Object -ComObject WScript.Shell
    $sc = $ws.CreateShortcut($startMenu); $sc.TargetPath = $exe; $sc.Save()
}
Write-Output "Owner tools: $toolsRun"

$tpm = $null; $secureBoot = $null
try { $t = Get-Tpm; $tpm = [bool]$t.TpmPresent } catch { $tpm = $false }
try { $secureBoot = [bool](Confirm-SecureBootUEFI) } catch { $secureBoot = $false }
$os = Get-CimInstance Win32_OperatingSystem
$ready = [ordered]@{
    name           = $seed.name
    hypervisor     = $seed.hypervisor
    readyAtUtc     = (Get-Date).ToUniversalTime().ToString('o')
    osCaption      = $os.Caption
    osVersion      = $os.Version
    osBuild        = $os.BuildNumber
    tpmPresent     = $tpm
    secureBoot     = $secureBoot
    guestTools     = $toolsResult
    owner          = $seed.owner
    ownerTools     = $toolsRun
    preinstalled   = @{
        git    = [bool](Get-Command git.exe -ErrorAction SilentlyContinue)
        node   = [bool](Get-Command node.exe -ErrorAction SilentlyContinue)
        python = [bool](Get-Command python.exe -ErrorAction SilentlyContinue | Where-Object { $_.Source -notmatch 'WindowsApps' })
        choco  = [bool](Get-Command choco.exe -ErrorAction SilentlyContinue)
        dotnetSdk = [bool](Get-Command dotnet.exe -ErrorAction SilentlyContinue)
    }
}
$ready | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $work 'ready.json') -Encoding UTF8

# Signal the host through the hypervisor's guest channel.
$rpc = 'C:\Program Files\VMware\VMware Tools\rpctool.exe'
$vbc = 'C:\Program Files\Oracle\VirtualBox Guest Additions\VBoxControl.exe'
for ($i = 0; $i -lt 30; $i++) {
    if ($seed.hypervisor -eq 'vmware' -and (Test-Path -LiteralPath $rpc)) { & $rpc 'info-set guestinfo.mvl.ready 1' | Out-Null; break }
    if ($seed.hypervisor -ne 'vmware' -and (Test-Path -LiteralPath $vbc)) { & $vbc guestproperty set /MVL/Ready 1 | Out-Null; break }
    Start-Sleep -Seconds 10
}
Write-Output 'Provisioning complete; shutting down for the clean baseline.'
Stop-Transcript | Out-Null
shutdown.exe /s /t 45 /c "Lab machine provisioning complete" /d p:4:1
