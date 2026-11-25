Set-StrictMode -Version 2.0

function Invoke-MvlServerChannel {
    param(
        [Parameter(Mandatory)][ValidateSet('vmware', 'virtualbox')][string]$Hypervisor,
        [Parameter(Mandatory)][ValidateSet('get', 'set')][string]$Operation,
        [Parameter(Mandatory)][ValidateSet('PublicKey', 'Credential', 'Status')][string]$Field,
        [ValidatePattern('\A[A-Za-z0-9+/=]*\z')][string]$Value = ''
    )
    if ($Hypervisor -eq 'vmware') {
        $exe = Join-Path $env:ProgramFiles 'VMware\VMware Tools\rpctool.exe'
        if (-not (Test-Path -LiteralPath $exe)) { return }
        $arguments = @("info-$Operation guestinfo.mvl.server.$Field $Value".TrimEnd())
    } else {
        # Guest Additions 7.x put VBoxControl.exe in System32; older ones used their Program Files folder.
        $exe = @((Join-Path $env:SystemRoot 'System32\VBoxControl.exe'), (Join-Path $env:ProgramFiles 'Oracle\VirtualBox Guest Additions\VBoxControl.exe')) |
            Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
        if (-not $exe) { return }
        $arguments = if ($Operation -eq 'set') { @('guestproperty', 'set', "/MVL/Server$Field", $Value) }
        else { @('guestproperty', 'get', "/MVL/Server$Field") }
    }
    $output = @(& $exe @arguments 2>$null)
    if ($LASTEXITCODE -ne 0) { return }
    if ($Operation -eq 'set') { return $true }
    $valueText = ($output -join '').Trim() -replace '^Value:\s*', ''
    if ($valueText -cmatch '\A[A-Za-z0-9+/=]+\z') { return $valueText }
}
