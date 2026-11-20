[CmdletBinding(DefaultParameterSetName = 'Verify')]
param(
    [Parameter(Mandatory, ParameterSetName = 'Promote')][securestring]$RecoveryPassword,
    [Parameter(Mandatory, ParameterSetName = 'Verify')][switch]$Verify
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
. (Join-Path $PSScriptRoot 'ServerForest.ps1')
. (Join-Path $PSScriptRoot 'ServerNetwork.ps1')
. (Join-Path $PSScriptRoot 'ServerChannel.ps1')

$task = 'MaterialVmLabs-VerifyServerForest'
$receiptPath = Join-Path $PSScriptRoot 'server-status.json'
$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'server.json') -Raw | ConvertFrom-Json
$forest = @{
    ComputerName = [string]$config.computerName
    DomainName = [string]$config.domainName
    NetbiosName = [string]$config.netbiosName
}
Assert-MvlServerForestNames @forest

function Write-ServerStatus([string]$Phase, $Evidence = $null) {
    $status = @{
        schema = 1
        jobId = [string]$config.jobId
        phase = $Phase
        computerName = $forest.ComputerName
        updatedUtc = [DateTime]::UtcNow.ToString('o')
        evidence = $Evidence
    } | ConvertTo-Json -Depth 5 -Compress
    $temporary = "$receiptPath.tmp"
    [IO.File]::WriteAllText($temporary, $status, [Text.UTF8Encoding]::new($false))
    if ([IO.File]::Exists($receiptPath)) { [IO.File]::Replace($temporary, $receiptPath, [NullString]::Value) }
    else { [IO.File]::Move($temporary, $receiptPath) }
    $message = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($status))
    Invoke-MvlServerChannel -Hypervisor $config.hypervisor -Operation set -Field Status -Value $message | Out-Null
}

if ($Verify) {
    $status = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
    if ($status.jobId -ne $config.jobId -or $status.phase -ne 'awaiting-reboot') { return }
    $deadline = [DateTime]::UtcNow.AddMinutes(10)
    $verified = $null
    while ([DateTime]::UtcNow -lt $deadline -and -not $verified) {
        try { $verified = Confirm-MvlServerForest @forest }
        catch { Start-Sleep -Seconds 10 }
    }
    if ($verified) { Write-ServerStatus 'verified' $verified }
    else { Write-ServerStatus 'verification-failed' }
    Unregister-ScheduledTask -TaskName $task -Confirm:$false
    if (-not $verified) { throw 'Forest verification did not pass within ten minutes after startup.' }
    return
}

if (Test-Path -LiteralPath $receiptPath) { throw 'Inspect the existing provisioning receipt before retrying promotion.' }
$os = Get-CimInstance Win32_OperatingSystem
$computer = Get-CimInstance Win32_ComputerSystem
if ($os.BuildNumber -ne '26100' -or $os.ProductType -ne 3 -or $computer.PartOfDomain -or $computer.Name -ne $forest.ComputerName) {
    throw 'Provisioning requires the expected standalone Server 2025 guest.'
}
try {
    Write-ServerStatus 'configuring-network'
    Set-MvlServerNetwork -Address $config.address -PrefixLength $config.prefixLength -MacAddress $config.macAddress
    Write-ServerStatus 'promoting'
    $arguments = '-NoProfile -NonInteractive -File "{0}" -Verify' -f $PSCommandPath
    $action = New-ScheduledTaskAction -Execute (Join-Path $PSHOME 'powershell.exe') -Argument $arguments
    $trigger = New-ScheduledTaskTrigger -AtStartup
    Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -User 'SYSTEM' -RunLevel Highest | Out-Null
    Install-MvlServerForest @forest -RecoveryPassword $RecoveryPassword | Out-Null
    Write-ServerStatus 'awaiting-reboot'
} catch {
    Write-ServerStatus 'promotion-failed'
    throw
}
# The host orchestrator reboots the owned guest after reading awaiting-reboot.
