[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

if (-not [Security.Principal.WindowsIdentity]::GetCurrent().IsSystem) {
    throw 'Server tools setup requires the guest setup account.'
}

$computer = Get-CimInstance Win32_ComputerSystem
$guest = switch -Regex ($computer.Manufacturer) {
    'VMware' { @{ Names = @('setup64.exe', 'setup.exe'); Publisher = 'VMware'; Arguments = '/S /v "/qn REBOOT=R"' }; break }
    'innotek|Oracle' { @{ Names = @('VBoxWindowsAdditions.exe'); Publisher = 'Oracle'; Arguments = '/S' }; break }
    default { throw 'Unrecognized Server guest hypervisor.' }
}
$installer = $null
foreach ($volume in (Get-CimInstance Win32_LogicalDisk -Filter 'DriveType = 5')) {
    foreach ($name in $guest.Names) {
        $candidate = Join-Path "$($volume.DeviceID)\" $name
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
        $signature = Get-AuthenticodeSignature -LiteralPath $candidate
        if ($signature.Status -eq 'Valid' -and $signature.SignerCertificate.Subject -match "O=[^,]*$($guest.Publisher)") {
            $installer = $candidate
            break
        }
    }
    if ($installer) { break }
}
if (-not $installer) { throw 'The signed guest tools installer was not found on the attached media.' }
$result = Start-Process -FilePath $installer -ArgumentList $guest.Arguments -Wait -PassThru
if ($result.ExitCode -notin @(0, 3010)) { throw "Guest tools installation returned exit code $($result.ExitCode)." }
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'server-tools.exit'), [string]$result.ExitCode)
Unregister-ScheduledTask -TaskName 'MaterialVmLabs-ServerTools' -Confirm:$false
& (Join-Path $PSScriptRoot 'ServerExchange.ps1')
