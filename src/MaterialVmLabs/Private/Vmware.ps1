Set-StrictMode -Version 2.0

# VMware Workstation backend: vmx authoring, power, snapshots, guest operations and keys.
# Guest operations pass the generated throwaway guest credential to vmrun as arguments;
# that credential only opens the disposable guest and never leaves the VM folder otherwise.

function Invoke-MvlVmrun {
    param([Parameter(Mandatory)]$Hv, [string[]]$Arguments, [switch]$AllowFailure)
    return Invoke-MvlNative -FilePath $Hv.Vmrun -ArgumentList (@('-T', 'ws') + $Arguments) -AllowFailure:$AllowFailure -Display 'vmrun'
}

function Invoke-MvlVmrunGuest {
    param([Parameter(Mandatory)]$State, [string[]]$Arguments, [switch]$AllowFailure)
    $hv = Get-MvlHypervisorForState $State
    $pw = Unprotect-MvlSecret $State.name
    return Invoke-MvlNative -FilePath $hv.Vmrun -ArgumentList (@('-T', 'ws', '-gu', $State.userName, '-gp', $pw) + $Arguments) -AllowFailure:$AllowFailure -Display 'vmrun guest operation'
}

function New-MvlVmwareVm {
    param([Parameter(Mandatory)]$State, [Parameter(Mandatory)][string]$InstallIso, [Parameter(Mandatory)][string]$SeedIso)
    $hv = Find-MvlVmware
    $dir = Get-MvlVmDir $State.name
    $vmx = Join-Path $dir "$($State.name).vmx"
    $disk = Join-Path $dir 'disk.vmdk'
    Invoke-MvlNative -FilePath $hv.DiskManager -ArgumentList @('-c', '-s', "$($State.diskGB)GB", '-a', 'nvme', '-t', '0', $disk) -Display 'vmware-vdiskmanager' | Out-Null
    $netType = switch ($State.network) { 'hostonly' { 'hostonly' } 'bridged' { 'bridged' } default { 'nat' } }
    $lines = @(
        '.encoding = "UTF-8"', 'config.version = "8"', 'virtualHW.version = "21"',
        "displayName = `"mvl-$($State.name)`"", 'guestOS = "windows11-64"',
        'firmware = "efi"', 'uefi.secureBoot.enabled = "TRUE"',
        "memsize = `"$($State.memoryMB)`"", "numvcpus = `"$($State.cpus)`"",
        'svga.present = "TRUE"', 'vmci0.present = "TRUE"', 'hpet0.present = "TRUE"',
        'pciBridge0.present = "TRUE"'
    )
    foreach ($n in 4..7) { $lines += @("pciBridge$n.present = `"TRUE`"", "pciBridge$n.virtualDev = `"pcieRootPort`"", "pciBridge$n.functions = `"8`"") }
    $lines += @(
        'nvme0.present = "TRUE"', 'nvme0:0.present = "TRUE"', 'nvme0:0.fileName = "disk.vmdk"',
        'sata0.present = "TRUE"',
        'sata0:0.present = "TRUE"', 'sata0:0.deviceType = "cdrom-image"', "sata0:0.fileName = `"$InstallIso`"",
        'sata0:1.present = "TRUE"', 'sata0:1.deviceType = "cdrom-image"', "sata0:1.fileName = `"$SeedIso`"",
        'sata0:2.present = "TRUE"', 'sata0:2.deviceType = "cdrom-image"', "sata0:2.fileName = `"$($hv.ToolsIso)`"",
        'ethernet0.present = "TRUE"', "ethernet0.connectionType = `"$netType`"", 'ethernet0.virtualDev = "e1000e"', 'ethernet0.addressType = "generated"',
        'floppy0.present = "FALSE"', 'usb.present = "FALSE"', 'sound.present = "FALSE"',
        'tools.syncTime = "TRUE"', 'isolation.tools.dnd.disable = "TRUE"', 'isolation.tools.copy.disable = "TRUE"', 'isolation.tools.paste.disable = "TRUE"',
        'isolation.tools.hgfs.disable = "TRUE"', 'msg.autoAnswer = "TRUE"', 'mks.enable3d = "FALSE"'
    )
    if ($State.PSObject.Properties['macAddress']) {
        $mac = $State.macAddress -replace '(..)(?!$)', '$1:'
        $lines = @($lines | Where-Object { $_ -notlike 'ethernet0.addressType*' })
        $lines += @('ethernet0.addressType = "static"', "ethernet0.address = `"$mac`"")
    }
    if ($State.PSObject.Properties['sharedFolder'] -and $State.sharedFolder) {
        # One folder shared with this PC; the guest sees \\vmware-host\Shared Folders\<name>.
        $lines = @($lines | Where-Object { $_ -notlike 'isolation.tools.hgfs.disable*' })
        $lines += @('isolation.tools.hgfs.disable = "FALSE"', 'sharedFolder.maxNum = "1"',
            'sharedFolder0.present = "TRUE"', 'sharedFolder0.enabled = "TRUE"', 'sharedFolder0.readAccess = "TRUE"', 'sharedFolder0.writeAccess = "TRUE"',
            "sharedFolder0.hostPath = `"$($State.sharedFolder.hostPath)`"", "sharedFolder0.guestName = `"$($State.name)`"", 'sharedFolder0.expiration = "never"',
            'hgfs.mapRootShare = "TRUE"', 'hgfs.linkRootShare = "TRUE"')
    }
    [IO.File]::WriteAllLines($vmx, $lines, (New-Object Text.UTF8Encoding($false)))
    return $vmx
}

function Set-MvlVmwareMediaDetached {
    # Edits the vmx while powered off: removes every CD image so nothing installs again
    # and the seed image (which held the encoded answer-file password) can be deleted.
    param([Parameter(Mandatory)]$State)
    $vmx = $State.vmPath
    $kept = Get-Content -LiteralPath $vmx | Where-Object { $_ -notmatch '^sata0:\d\.' }
    [IO.File]::WriteAllLines($vmx, [string[]]$kept, (New-Object Text.UTF8Encoding($false)))
}

function Get-MvlVmwarePower {
    param([Parameter(Mandatory)]$State)
    $hv = Find-MvlVmware
    $r = Invoke-MvlVmrun $hv @('list')
    $running = $r.StdOut -split "`r?`n" | Where-Object { $_ -and ($_.Trim() -ieq $State.vmPath) }
    if ($running) { return 'running' } else { return 'off' }
}

function Start-MvlVmwareVm { param([Parameter(Mandatory)]$State) Invoke-MvlVmrun (Find-MvlVmware) @('start', $State.vmPath, 'nogui') | Out-Null }
function Stop-MvlVmwareVm {
    param([Parameter(Mandatory)]$State, [switch]$Hard)
    $mode = if ($Hard) { 'hard' } else { 'soft' }
    Invoke-MvlVmrun (Find-MvlVmware) @('stop', $State.vmPath, $mode) -AllowFailure | Out-Null
}
function New-MvlVmwareSnapshot { param($State, [string]$Snapshot) Invoke-MvlVmrun (Find-MvlVmware) @('snapshot', $State.vmPath, $Snapshot) | Out-Null }
function Restore-MvlVmwareSnapshot { param($State, [string]$Snapshot) Invoke-MvlVmrun (Find-MvlVmware) @('revertToSnapshot', $State.vmPath, $Snapshot) | Out-Null }
function Remove-MvlVmwareVm {
    param([Parameter(Mandatory)]$State)
    $hv = Find-MvlVmware
    if ((Test-Path -LiteralPath $State.vmPath) -and (Get-MvlVmwarePower $State) -eq 'running') { Stop-MvlVmwareVm $State -Hard }
    if (Test-Path -LiteralPath $State.vmPath) { Invoke-MvlVmrun $hv @('deleteVM', $State.vmPath) -AllowFailure | Out-Null }
}

function Read-MvlVmwareGuestVar {
    param([Parameter(Mandatory)]$State, [Parameter(Mandatory)][string]$Var)
    $r = Invoke-MvlVmrun (Find-MvlVmware) @('readVariable', $State.vmPath, 'guestVar', $Var) -AllowFailure
    if ($r.ExitCode -ne 0) { return '' }
    return $r.StdOut.Trim()
}
function Write-MvlVmwareGuestVar {
    param([Parameter(Mandatory)]$State, [Parameter(Mandatory)][string]$Var, [AllowEmptyString()][string]$Value)
    Invoke-MvlVmrun (Find-MvlVmware) @('writeVariable', $State.vmPath, 'guestVar', $Var, $Value) | Out-Null
}

function Send-MvlVmwareBootKey {
    # Answers the UEFI "Press any key to boot from CD or DVD" prompt.
    param([Parameter(Mandatory)]$State)
    $hv = Find-MvlVmware
    Invoke-MvlNative -FilePath $hv.Vmcli -ArgumentList @($State.vmPath, 'MKS', 'sendKeySequence', ' ') -AllowFailure | Out-Null
}

function Save-MvlVmwareScreenshot {
    param([Parameter(Mandatory)]$State, [Parameter(Mandatory)][string]$Path)
    $hv = Find-MvlVmware
    $r = Invoke-MvlNative -FilePath $hv.Vmcli -ArgumentList @($State.vmPath, 'MKS', 'captureScreenshot', $Path) -AllowFailure
    return ($r.ExitCode -eq 0 -and (Test-Path -LiteralPath $Path))
}

function Copy-MvlVmwareToGuest { param($State, [string]$HostPath, [string]$GuestPath) Invoke-MvlVmrunGuest $State @('CopyFileFromHostToGuest', $State.vmPath, $HostPath, $GuestPath) | Out-Null }
function Copy-MvlVmwareFromGuest { param($State, [string]$GuestPath, [string]$HostPath) Invoke-MvlVmrunGuest $State @('CopyFileFromGuestToHost', $State.vmPath, $GuestPath, $HostPath) | Out-Null }
function Set-MvlVmwareNetwork {
    # Powered off only: rewrites ethernet0.connectionType in the vmx.
    param($State, [string]$Mode)
    $lines = Get-Content -LiteralPath $State.vmPath | Where-Object { $_ -notmatch '^ethernet0\.connectionType\s*=' }
    $lines += "ethernet0.connectionType = `"$Mode`""
    [IO.File]::WriteAllLines($State.vmPath, [string[]]$lines, (New-Object Text.UTF8Encoding($false)))
}
function Get-MvlVmwareNetwork {
    param($State)
    $m = Select-String -LiteralPath $State.vmPath -Pattern '^ethernet0\.connectionType\s*=\s*"([^"]+)"' | Select-Object -First 1
    if ($m) { return $m.Matches[0].Groups[1].Value } else { return 'nat' }
}
function Get-MvlVmwareIp {
    param($State)
    $r = Invoke-MvlVmrun (Find-MvlVmware) @('getGuestIPAddress', $State.vmPath) -AllowFailure
    $ip = $r.StdOut.Trim()
    if ($r.ExitCode -eq 0 -and $ip -match '^\d{1,3}(\.\d{1,3}){3}$') { return $ip }
    return ''
}
function New-MvlVmwareGuestDir {
    param($State, [string]$GuestPath)
    $r = Invoke-MvlVmrunGuest $State @('directoryExistsInGuest', $State.vmPath, $GuestPath) -AllowFailure
    if ($r.StdOut -match 'exists' -and $r.StdOut -notmatch 'does not exist') { return }
    Invoke-MvlVmrunGuest $State @('createDirectoryInGuest', $State.vmPath, $GuestPath) | Out-Null
}
function Test-MvlVmwareGuestFile {
    param($State, [string]$GuestPath)
    $r = Invoke-MvlVmrunGuest $State @('fileExistsInGuest', $State.vmPath, $GuestPath) -AllowFailure
    return ($r.ExitCode -eq 0 -and $r.StdOut -match 'exists' -and $r.StdOut -notmatch 'does not exist')
}
function Start-MvlVmwareGuestProgram {
    param($State, [string]$Program, [string[]]$ProgramArgs, [switch]$NoWait, [switch]$Interactive)
    $a = @('runProgramInGuest', $State.vmPath)
    if ($NoWait) { $a += '-noWait' }
    if ($Interactive) { $a += '-interactive' }
    $a += $Program
    $a += $ProgramArgs
    return Invoke-MvlVmrunGuest $State $a -AllowFailure
}
function Test-MvlVmwareGuestReady {
    param($State)
    # Workstation 26 reports "installed" from checkToolsState even while the tools serve guest
    # operations (seen 2026-11-17), so readiness is proven by a real guest operation instead.
    $r = Invoke-MvlVmrun (Find-MvlVmware) @('checkToolsState', $State.vmPath) -AllowFailure
    if ($r.StdOut.Trim() -eq 'running') { return $true }
    $probe = if ($State.PSObject.Properties['os'] -and $State.os -and $State.os -ne 'windows') { '/var/lib/mvl/ready.json' } else { 'C:\MaterialVmLabs\ready.json' }
    return (Test-MvlVmwareGuestFile -State $State -GuestPath $probe)
}
