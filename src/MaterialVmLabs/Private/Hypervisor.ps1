Set-StrictMode -Version 2.0

# Hypervisor detection. VMware Workstation is preferred; VirtualBox is the automatic fallback
# when VMware is missing or not usable. Installing either hypervisor is never done silently:
# Install-MvlHypervisor only runs when the caller passes -Approve, and the installer's own
# native elevation prompt is answered by the person at the keyboard.

function Find-MvlVmware {
    $candidates = @()
    try {
        $reg = Get-ItemProperty -Path 'HKLM:\SOFTWARE\WOW6432Node\VMware, Inc.\VMware Workstation' -ErrorAction Stop
        if ($reg.InstallPath) { $candidates += $reg.InstallPath }
    } catch { }
    $candidates += @("$env:ProgramFiles\VMware\VMware Workstation", "${env:ProgramFiles(x86)}\VMware\VMware Workstation")
    foreach ($dir in $candidates) {
        if (-not $dir) { continue }
        $vmrun = Join-Path $dir 'vmrun.exe'
        if (Test-Path -LiteralPath $vmrun) {
            return [pscustomobject]@{
                Kind        = 'vmware'
                Dir         = $dir
                Vmrun       = $vmrun
                Vmcli       = Join-Path $dir 'vmcli.exe'
                DiskManager = Join-Path $dir 'vmware-vdiskmanager.exe'
                ToolsIso    = Join-Path $dir 'windows.iso'
            }
        }
    }
    return $null
}

function Find-MvlVirtualBox {
    $candidates = @()
    if ($env:VBOX_MSI_INSTALL_PATH) { $candidates += $env:VBOX_MSI_INSTALL_PATH }
    if ($env:VBOX_INSTALL_PATH) { $candidates += $env:VBOX_INSTALL_PATH }
    $candidates += @("$env:ProgramFiles\Oracle\VirtualBox", "$env:ProgramFiles\VirtualBox")
    foreach ($dir in $candidates) {
        if (-not $dir) { continue }
        $vbm = Join-Path $dir 'VBoxManage.exe'
        if (Test-Path -LiteralPath $vbm) {
            return [pscustomobject]@{
                Kind      = 'virtualbox'
                Dir       = $dir
                VBoxManage = $vbm
                ToolsIso  = Join-Path $dir 'VBoxGuestAdditions.iso'
            }
        }
    }
    return $null
}

function Test-MvlHypervisorUsable {
    param([Parameter(Mandatory)]$Hv)
    try {
        if ($Hv.Kind -eq 'vmware') {
            $r = Invoke-MvlNative -FilePath $Hv.Vmrun -ArgumentList @('-T', 'ws', 'list') -AllowFailure
            $ver = (Get-Item -LiteralPath (Join-Path $Hv.Dir 'vmware.exe')).VersionInfo.ProductVersion
            return [pscustomobject]@{ Usable = ($r.ExitCode -eq 0 -and (Test-Path -LiteralPath $Hv.ToolsIso)); Version = $ver; Detail = $r.StdErr.Trim() }
        }
        $r = Invoke-MvlNative -FilePath $Hv.VBoxManage -ArgumentList @('--version') -AllowFailure
        # A VBoxManage client talking to a different-version VBoxSVC COM server crashes with an
        # access violation on createvm (seen 2026-11-17 with 7.2.22 client and 7.2.97 server).
        $client = (Get-Item -LiteralPath $Hv.VBoxManage).VersionInfo.ProductVersion
        $svcPath = Join-Path $Hv.Dir 'VBoxSVC.exe'
        $server = if (Test-Path -LiteralPath $svcPath) { (Get-Item -LiteralPath $svcPath).VersionInfo.ProductVersion } else { '' }
        $short = { param($v) (($v -split '\.')[0..2]) -join '.' }
        if ($server -and ((& $short $client) -ne (& $short $server))) {
            return [pscustomobject]@{ Usable = $false; Version = $r.StdOut.Trim(); Detail = "mixed installation: VBoxManage $client but VBoxSVC $server; reinstall VirtualBox to repair" }
        }
        return [pscustomobject]@{ Usable = ($r.ExitCode -eq 0 -and (Test-Path -LiteralPath $Hv.ToolsIso)); Version = $r.StdOut.Trim(); Detail = $r.StdErr.Trim() }
    } catch {
        return [pscustomobject]@{ Usable = $false; Version = ''; Detail = $_.Exception.Message }
    }
}

function Get-MvlHypervisor {
    <#
      Returns the chosen hypervisor with the reason it was chosen.
      -Prefer forces one kind; otherwise VMware first, then VirtualBox.
    #>
    param([ValidateSet('auto', 'vmware', 'virtualbox')][string]$Prefer = 'auto', [switch]$Quiet)
    $report = @()
    $order = switch ($Prefer) { 'vmware' { @('vmware') } 'virtualbox' { @('virtualbox') } default { @('vmware', 'virtualbox') } }
    foreach ($kind in $order) {
        $hv = if ($kind -eq 'vmware') { Find-MvlVmware } else { Find-MvlVirtualBox }
        if (-not $hv) { $report += "${kind}: not installed"; continue }
        $t = Test-MvlHypervisorUsable $hv
        if ($t.Usable) {
            if ($kind -eq 'virtualbox') {
                # Seen 2026-11-17: under an active Hyper-V, VirtualBox falls back to its NEM mode and a
                # Windows 11 install stalls after Setup (guest time lags a minute at a time).
                $hyperV = $false
                try { $hyperV = [bool](Get-CimInstance Win32_ComputerSystem).HypervisorPresent } catch { }
                if ($hyperV -and -not $Quiet) { Write-MvlPhase 'VirtualBox will run under Hyper-V on this PC; Windows installs may stall. VMware is the faster route here.' warn }
                $hv | Add-Member -NotePropertyName HyperVActive -NotePropertyValue $hyperV -Force
            }
            $hv | Add-Member -NotePropertyName Version -NotePropertyValue $t.Version -Force
            $hv | Add-Member -NotePropertyName Reason -NotePropertyValue (($report + "${kind}: installed and usable ($($t.Version))") -join '; ') -Force
            if (-not $Quiet) { Write-MvlPhase "Hypervisor chosen: $kind $($t.Version)" ok }
            return $hv
        }
        $report += "${kind}: installed but not usable ($($t.Detail))"
    }
    throw ("No usable hypervisor. " + ($report -join '; ') + ". Run 'mvl hv install --approve' to install VirtualBox with your consent.")
}

function Install-MvlHypervisor {
    # Installs VirtualBox through Chocolatey, only with explicit approval. The installer's
    # native elevation prompt is answered by the person; cancellation stays a failure.
    param([switch]$Approve)
    if (-not $Approve) { throw 'Installing a hypervisor needs explicit approval: pass --approve.' }
    $choco = Get-Command choco.exe -ErrorAction SilentlyContinue
    if (-not $choco) { throw 'Chocolatey is not installed. Install it first from https://community.chocolatey.org/install.ps1, then retry.' }
    Write-MvlPhase 'Installing VirtualBox through Chocolatey (an elevation prompt will appear).'
    $p = Start-Process -FilePath $choco.Source -ArgumentList @('install', 'virtualbox', '-y', '--no-progress') -Verb RunAs -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "VirtualBox installation did not complete (exit $($p.ExitCode))." }
    $hv = Get-MvlHypervisor -Prefer virtualbox
    Write-MvlPhase "VirtualBox installed and usable: $($hv.Version)" ok
    return $hv
}

function Get-MvlHypervisorForState {
    param([Parameter(Mandatory)]$State)
    $hv = if ($State.hypervisor -eq 'vmware') { Find-MvlVmware } else { Find-MvlVirtualBox }
    if (-not $hv) { throw "Hypervisor '$($State.hypervisor)' for '$($State.name)' is no longer installed." }
    return $hv
}
