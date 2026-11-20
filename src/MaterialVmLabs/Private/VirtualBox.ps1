Set-StrictMode -Version 2.0

# VirtualBox backend: the automatic fallback. Presents a real virtual TPM 2.0 and UEFI
# Secure Boot with Microsoft keys, so no setup requirement waiver is ever needed here.

function Invoke-MvlVbox {
    param([string[]]$Arguments, [switch]$AllowFailure)
    $hv = Find-MvlVirtualBox
    return Invoke-MvlNative -FilePath $hv.VBoxManage -ArgumentList $Arguments -AllowFailure:$AllowFailure -Display 'VBoxManage'
}
function Get-MvlVboxName { param($State) return "mvl-$($State.name)" }

function New-MvlVboxVm {
    param([Parameter(Mandatory)]$State, [Parameter(Mandatory)][string]$InstallIso, [Parameter(Mandatory)][string]$SeedIso)
    $hv = Find-MvlVirtualBox
    $dir = Get-MvlVmDir $State.name
    $vm = Get-MvlVboxName $State
    Invoke-MvlVbox @('createvm', '--name', $vm, '--ostype', 'Windows11_64', '--basefolder', $dir, '--register') | Out-Null
    $nic = Get-MvlVboxNicArgs $State.network
    if ($State.PSObject.Properties['macAddress']) { $nic += @('--macaddress1', $State.macAddress) }
    Invoke-MvlVbox (@('modifyvm', $vm, '--firmware', 'efi', '--tpm-type', '2.0', '--memory', "$($State.memoryMB)", '--cpus', "$($State.cpus)",
            '--graphicscontroller', 'vboxsvga', '--vram', '128', '--audio-enabled', 'off', '--clipboard-mode', 'disabled', '--drag-and-drop', 'disabled',
            '--usb-ohci', 'off', '--usb-ehci', 'off', '--usb-xhci', 'off') + $nic) | Out-Null
    # DVD first, then disk, no network boot: the default order tries the network first and
    # reaches the CD prompt only after a long wait (seen 2026-11-17).
    Invoke-MvlVbox @('modifyvm', $vm, '--boot1', 'dvd', '--boot2', 'disk', '--boot3', 'none', '--boot4', 'none') | Out-Null
    Invoke-MvlVbox @('modifynvram', $vm, 'inituefivarstore') | Out-Null
    Invoke-MvlVbox @('modifynvram', $vm, 'enrollmssignatures') | Out-Null
    Invoke-MvlVbox @('modifynvram', $vm, 'enrollorclpk') | Out-Null
    Invoke-MvlVbox @('modifynvram', $vm, 'secureboot', '--enable') | Out-Null
    $disk = Join-Path $dir 'disk.vdi'
    Invoke-MvlVbox @('createmedium', 'disk', '--filename', $disk, '--size', "$([int]$State.diskGB * 1024)", '--format', 'VDI') | Out-Null
    Invoke-MvlVbox @('storagectl', $vm, '--name', 'SATA', '--add', 'sata', '--controller', 'IntelAhci', '--portcount', '4') | Out-Null
    Invoke-MvlVbox @('storageattach', $vm, '--storagectl', 'SATA', '--port', '0', '--device', '0', '--type', 'hdd', '--medium', $disk) | Out-Null
    $port = 1
    foreach ($iso in @($InstallIso, $SeedIso, $hv.ToolsIso)) {
        Invoke-MvlVbox @('storageattach', $vm, '--storagectl', 'SATA', '--port', "$port", '--device', '0', '--type', 'dvddrive', '--medium', $iso) | Out-Null
        $port++
    }
    if ($State.PSObject.Properties['sharedFolder'] -and $State.sharedFolder) {
        # One folder shared with this PC; the guest sees \\VBOXSVR\<name>.
        Invoke-MvlVbox @('sharedfolder', 'add', $vm, '--name', $State.name, '--hostpath', $State.sharedFolder.hostPath, '--automount') | Out-Null
    }
    $vbox = Get-ChildItem -LiteralPath $dir -Recurse -Filter '*.vbox' | Select-Object -First 1
    return $vbox.FullName
}

function Set-MvlVboxMediaDetached {
    param([Parameter(Mandatory)]$State)
    $vm = Get-MvlVboxName $State
    foreach ($port in 1..3) { Invoke-MvlVbox @('storageattach', $vm, '--storagectl', 'SATA', '--port', "$port", '--device', '0', '--medium', 'none') -AllowFailure | Out-Null }
}

function Get-MvlVboxPower {
    param([Parameter(Mandatory)]$State)
    $r = Invoke-MvlVbox @('showvminfo', (Get-MvlVboxName $State), '--machinereadable') -AllowFailure
    if ($r.StdOut -match 'VMState="running"') { return 'running' }
    return 'off'
}
function Start-MvlVboxVm { param($State) Invoke-MvlVbox @('startvm', (Get-MvlVboxName $State), '--type', 'headless') | Out-Null }
function Stop-MvlVboxVm {
    param($State, [switch]$Hard)
    $action = if ($Hard) { 'poweroff' } else { 'acpipowerbutton' }
    Invoke-MvlVbox @('controlvm', (Get-MvlVboxName $State), $action) -AllowFailure | Out-Null
}
function New-MvlVboxSnapshot { param($State, [string]$Snapshot) Invoke-MvlVbox @('snapshot', (Get-MvlVboxName $State), 'take', $Snapshot) | Out-Null }
function Restore-MvlVboxSnapshot { param($State, [string]$Snapshot) Invoke-MvlVbox @('snapshot', (Get-MvlVboxName $State), 'restore', $Snapshot) | Out-Null }
function Remove-MvlVboxVm {
    param($State)
    if ((Get-MvlVboxPower $State) -eq 'running') { Stop-MvlVboxVm $State -Hard; Start-Sleep -Seconds 3 }
    Invoke-MvlVbox @('unregistervm', (Get-MvlVboxName $State), '--delete') -AllowFailure | Out-Null
}
function Read-MvlVboxGuestVar {
    param($State, [string]$Var)
    $r = Invoke-MvlVbox @('guestproperty', 'get', (Get-MvlVboxName $State), "/MVL/$Var") -AllowFailure
    if ($r.StdOut -match '^Value:\s*(.*)$') { return $Matches[1].Trim() }
    return ''
}
function Write-MvlVboxGuestVar {
    param($State, [string]$Var, [AllowEmptyString()][string]$Value)
    if ($Value) { Invoke-MvlVbox @('guestproperty', 'set', (Get-MvlVboxName $State), "/MVL/$Var", $Value, '--flags', 'TRANSIENT') | Out-Null }
    else { Invoke-MvlVbox @('guestproperty', 'delete', (Get-MvlVboxName $State), "/MVL/$Var") -AllowFailure | Out-Null }
}
function Send-MvlVboxBootKey { param($State) Invoke-MvlVbox @('controlvm', (Get-MvlVboxName $State), 'keyboardputscancode', '39', 'b9') -AllowFailure | Out-Null }
function Save-MvlVboxScreenshot {
    param($State, [string]$Path)
    $r = Invoke-MvlVbox @('controlvm', (Get-MvlVboxName $State), 'screenshotpng', $Path) -AllowFailure
    return ($r.ExitCode -eq 0)
}
function Invoke-MvlVboxGuest {
    param($State, [string[]]$Arguments, [switch]$AllowFailure)
    $pw = Unprotect-MvlSecret $State.name
    $cred = @('--username', $State.userName, '--password', $pw)
    $rest = @()
    if ($Arguments.Length -gt 1) { $rest = @($Arguments[1..($Arguments.Length - 1)]) }
    $all = @('guestcontrol', (Get-MvlVboxName $State), $Arguments[0]) + $cred + $rest
    return Invoke-MvlVbox $all -AllowFailure:$AllowFailure
}
function Copy-MvlVboxToGuest { param($State, [string]$HostPath, [string]$GuestPath) Invoke-MvlVboxGuest $State @('copyto', $HostPath, $GuestPath) | Out-Null }
function Copy-MvlVboxFromGuest { param($State, [string]$GuestPath, [string]$HostPath) Invoke-MvlVboxGuest $State @('copyfrom', $GuestPath, $HostPath) | Out-Null }
function Get-MvlVboxNicArgs {
    param([string]$Mode)
    switch ($Mode) {
        'hostonly' { return @('--nic1', 'hostonly', '--host-only-adapter1', 'VirtualBox Host-Only Ethernet Adapter') }
        'bridged' {
            # Bridge onto the host adapter that carries the default route.
            $route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1
            $desc = if ($route) { (Get-NetAdapter -InterfaceIndex $route.InterfaceIndex).InterfaceDescription } else { '' }
            if (-not $desc) { throw 'No host adapter with a default route to bridge onto.' }
            return @('--nic1', 'bridged', '--bridge-adapter1', $desc)
        }
        default { return @('--nic1', 'nat') }
    }
}
function Set-MvlVboxNetwork { param($State, [string]$Mode) Invoke-MvlVbox (@('modifyvm', (Get-MvlVboxName $State)) + (Get-MvlVboxNicArgs $Mode)) | Out-Null }
function Get-MvlVboxNetwork {
    param($State)
    $r = Invoke-MvlVbox @('showvminfo', (Get-MvlVboxName $State), '--machinereadable') -AllowFailure
    if ($r.StdOut -match 'nic1="([^"]+)"') { return $Matches[1].ToLowerInvariant() -replace 'hostonly', 'hostonly' }
    return 'nat'
}
function Get-MvlVboxIp {
    param($State)
    $r = Invoke-MvlVbox @('guestproperty', 'get', (Get-MvlVboxName $State), '/VirtualBox/GuestInfo/Net/0/V4/IP') -AllowFailure
    if ($r.StdOut -match '^Value:\s*(\d{1,3}(\.\d{1,3}){3})') { return $Matches[1] }
    return ''
}
function New-MvlVboxGuestDir { param($State, [string]$GuestPath) Invoke-MvlVboxGuest $State @('mkdir', '--parents', $GuestPath) | Out-Null }
function Test-MvlVboxGuestFile {
    param($State, [string]$GuestPath)
    $r = Invoke-MvlVboxGuest $State @('stat', $GuestPath) -AllowFailure
    return ($r.ExitCode -eq 0)
}
function Start-MvlVboxGuestProgram {
    param($State, [string]$Program, [string[]]$ProgramArgs, [switch]$NoWait, [switch]$Interactive)
    # guestcontrol runs in the guest user's context; $Interactive is accepted for parity.
    $a = @('start')
    if (-not $NoWait) { $a = @('run', '--wait-stdout', '--wait-stderr') }
    return Invoke-MvlVboxGuest $State ($a + @('--exe', $Program, '--') + @($Program) + $ProgramArgs) -AllowFailure
}
function Test-MvlVboxGuestReady {
    param($State)
    $r = Invoke-MvlVbox @('guestproperty', 'get', (Get-MvlVboxName $State), '/VirtualBox/GuestAdd/Version') -AllowFailure
    return ($r.StdOut -match '^Value:')
}
