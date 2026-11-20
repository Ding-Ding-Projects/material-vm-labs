# Runs during specialize as local SYSTEM in the freshly installed guest.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$principal = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsSystem) { throw 'Server staging requires the guest setup account.' }

$os = Get-CimInstance Win32_OperatingSystem
if ($os.ProductType -ne 3 -or $os.BuildNumber -ne '26100') {
    throw 'Server staging requires a fresh Server 2025 guest.'
}

$target = Join-Path $env:ProgramData 'MaterialVmLabs\Server'
if (Test-Path -LiteralPath $target) { throw 'Server staging directory already exists.' }
New-Item -ItemType Directory -Path $target -ErrorAction Stop | Out-Null
$acl = Get-Acl -LiteralPath $target
$acl.SetAccessRuleProtection($true, $false)
foreach ($sid in @('S-1-5-18', 'S-1-5-32-544')) {
    $identity = [Security.Principal.SecurityIdentifier]::new($sid)
    $rule = [Security.AccessControl.FileSystemAccessRule]::new(
        $identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'
    )
    $acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $target -AclObject $acl

foreach ($file in @('ServerForest.ps1', 'ServerNetwork.ps1', 'ServerProvision.ps1', 'ServerTools.ps1',
                    'ServerChannel.ps1', 'ServerExchange.ps1', 'ServerCredential.ps1', 'server.json')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination $target -ErrorAction Stop
}
$path = Join-Path $target 'ServerTools.ps1'
$action = New-ScheduledTaskAction -Execute (Join-Path $PSHOME 'powershell.exe') -Argument ('-NoProfile -NonInteractive -File "{0}"' -f $path)
$trigger = New-ScheduledTaskTrigger -AtStartup
Register-ScheduledTask -TaskName 'MaterialVmLabs-ServerTools' -Action $action -Trigger $trigger -User 'SYSTEM' -RunLevel Highest | Out-Null
