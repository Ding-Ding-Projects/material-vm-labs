# Runs inside a lab machine: sets the guest account password from the hypervisor's
# in-memory guest variable (never an argument or a file) and keeps automatic sign-in working.
param([Parameter(Mandatory)][string]$UserName, [Parameter(Mandatory)][string]$Hypervisor)
$ErrorActionPreference = 'Stop'
if ($Hypervisor -eq 'vmware') {
    $pw = "$(& 'C:\Program Files\VMware\VMware Tools\rpctool.exe' 'info-get guestinfo.mvl.newpassword')".Trim()
} else {
    # Guest Additions 7.x put VBoxControl.exe in System32; older ones used their Program Files folder.
    $vbc = @((Join-Path $env:SystemRoot 'System32\VBoxControl.exe'), (Join-Path $env:ProgramFiles 'Oracle\VirtualBox Guest Additions\VBoxControl.exe')) |
        Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $vbc) { throw 'VBoxControl.exe was not found; are the VirtualBox Guest Additions installed?' }
    $out = & $vbc --nologo guestproperty get /MVL/NewPassword
    $pw = if ("$out" -match 'Value:\s*(\S+)') { $Matches[1] } else { '' }
}
if (-not $pw) { throw 'No new password arrived through the guest channel.' }
Set-LocalUser -Name $UserName -Password (ConvertTo-SecureString -String $pw -AsPlainText -Force)
# Automatic sign-in keeps working after the change.
$wl = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
Set-ItemProperty -Path $wl -Name DefaultUserName -Value $UserName
Set-ItemProperty -Path $wl -Name DefaultPassword -Value $pw
Set-ItemProperty -Path $wl -Name AutoAdminLogon -Value '1'
$pw = $null
'password set'
