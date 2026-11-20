Set-StrictMode -Version 2.0

# Lifecycle of lab machines: create (unattended install to a clean baseline snapshot),
# list, start, stop, reset to baseline and destroy (VM files plus runner registrations).

$script:MvlBaseline = 'mvl-baseline'

function Invoke-MvlBackend {
    param([Parameter(Mandatory)]$State, [Parameter(Mandatory)][string]$Verb, [hashtable]$Params = @{})
    $prefix = if ($State.hypervisor -eq 'vmware') { 'Vmware' } else { 'Vbox' }
    $map = @{
        Power = "Get-Mvl${prefix}Power"; Start = "Start-Mvl${prefix}Vm"; Stop = "Stop-Mvl${prefix}Vm"
        Snapshot = "New-Mvl${prefix}Snapshot"; Restore = "Restore-Mvl${prefix}Snapshot"; Remove = "Remove-Mvl${prefix}Vm"
        Detach = "Set-Mvl${prefix}MediaDetached"; ReadVar = "Read-Mvl${prefix}GuestVar"; WriteVar = "Write-Mvl${prefix}GuestVar"
        BootKey = "Send-Mvl${prefix}BootKey"; Screenshot = "Save-Mvl${prefix}Screenshot"; ToGuest = "Copy-Mvl${prefix}ToGuest"
        FromGuest = "Copy-Mvl${prefix}FromGuest"; GuestFile = "Test-Mvl${prefix}GuestFile"; Run = "Start-Mvl${prefix}GuestProgram"
        ToolsReady = "Test-Mvl${prefix}GuestReady"; MkDir = "New-Mvl${prefix}GuestDir"
        SetNet = "Set-Mvl${prefix}Network"; GetNet = "Get-Mvl${prefix}Network"; Ip = "Get-Mvl${prefix}Ip"
    }
    $fn = $map[$Verb]
    if (-not $fn) { throw "Unknown backend verb $Verb" }
    $Params['State'] = $State
    return (& $fn @Params)
}

function Get-MvlScreenKind {
    # Classifies a guest screenshot without OCR: 'prompt' = text only in the top-left band on an
    # otherwise black screen (the UEFI "press any key" line); 'busy' = colour in the centre
    # (hypervisor logo, Windows logo, Setup); 'black' = nothing drawn yet.
    param([Parameter(Mandatory)][string]$Path)
    Add-Type -AssemblyName System.Drawing
    $bmp = [System.Drawing.Bitmap]::FromFile($Path)
    try {
        $w = $bmp.Width; $h = $bmp.Height
        $lit = { param($x, $y) $c = $bmp.GetPixel($x, $y); ($c.R + $c.G + $c.B) -gt 120 }
        $top = 0; $centre = 0
        for ($x = 0; $x -lt [int]($w * 0.6); $x += 4) { for ($y = 0; $y -lt [int]($h * 0.08); $y += 2) { if (& $lit $x $y) { $top++ } } }
        for ($x = [int]($w * 0.25); $x -lt [int]($w * 0.75); $x += 8) { for ($y = [int]($h * 0.3); $y -lt [int]($h * 0.75); $y += 8) { if (& $lit $x $y) { $centre++ } } }
        if ($centre -gt 20) { return 'busy' }
        if ($top -gt 10) { return 'prompt' }
        return 'black'
    } finally { $bmp.Dispose() }
}

function Send-MvlBootKeyWhilePrompt {
    # Presses a key only while the guest shows the CD prompt, then stops as soon as Windows
    # takes over, so no key ever reaches Setup's Cancel button. Up to three minutes.
    param([Parameter(Mandatory)]$State, [Parameter(Mandatory)][string]$Dir)
    $shot = Join-Path $Dir 'boot-watch.png'
    $pressed = $false
    $deadline = (Get-Date).AddMinutes(3)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 700
        if (-not (Invoke-MvlBackend $State Screenshot @{ Path = $shot })) { continue }
        $kind = Get-MvlScreenKind $shot
        if ($kind -eq 'prompt') { Invoke-MvlBackend $State BootKey | Out-Null; $pressed = $true }
        elseif ($kind -eq 'busy' -and $pressed) { break }
    }
    Remove-Item -LiteralPath $shot -Force -ErrorAction SilentlyContinue
    if (-not $pressed) { Write-MvlPhase 'Never saw the boot-from-CD prompt; installation may not start.' warn }
}

function New-MvlMachine {
    param(
        [Parameter(Mandatory)][string]$Name,
        [string]$Project = 'general',
        [ValidateSet('auto', 'vmware', 'virtualbox')][string]$Hypervisor = 'auto',
        [int]$MemoryMB = 8192,
        [int]$Cpus = 4,
        [int]$DiskGB = 96,
        [ValidateSet('nat', 'bridged', 'hostonly')][string]$Network = 'nat',
        [string]$Locale = 'en-US',
        [string]$TimeZone = 'Eastern Standard Time',
        [int]$TimeoutMinutes = 150,
        [string]$UserName = 'mvlbuilder',
        [string]$Password,
        [switch]$RandomPassword,
        [switch]$RequireTpm,
        # Who it is for: "you" gets the owner tools, the Setup app with the
        # official sign-ins, and a shared folder opened on this PC; "agent" stays bare for fresh-host tests.
        [ValidateSet('you', 'agent')][string]$For = 'agent',
        [switch]$Tools, [switch]$NoTools, [switch]$Share, [switch]$NoShare, [switch]$NoOpenShare,
        [ValidateSet('windows', 'ubuntu', 'debian')][string]$Os = 'windows'
    )
    if ($Os -ne 'windows') {
        $la = @{ Name = $Name; Os = $Os; Project = $Project; Network = $Network; Password = $Password; RandomPassword = $RandomPassword
            For = $For; Share = $Share; NoShare = $NoShare; NoOpenShare = $NoOpenShare; Hypervisor = $Hypervisor }
        if ($PSBoundParameters.ContainsKey('MemoryMB')) { $la.MemoryMB = $MemoryMB }
        if ($PSBoundParameters.ContainsKey('Cpus')) { $la.Cpus = $Cpus }
        if ($PSBoundParameters.ContainsKey('DiskGB')) { $la.DiskGB = $DiskGB }
        if ($PSBoundParameters.ContainsKey('UserName')) { $la.UserName = $UserName }
        return (New-MvlLinuxMaterialVmLabs @la)
    }
    $opts = Resolve-MvlOwnerOptions -For $For -Tools:$Tools -NoTools:$NoTools -Share:$Share -NoShare:$NoShare
    $wantTools = $opts.tools
    $wantShare = $opts.share
    if ($UserName -notmatch '^[A-Za-z][A-Za-z0-9_-]{0,19}$') { throw "Invalid guest account name '$UserName'." }
    # The default guest password is 1234; --password-stdin or
    # --random-password replace it. It only opens this throwaway guest.
    $usingDefault = (-not $Password -and -not $RandomPassword)
    Test-MvlName $Name
    $dir = Get-MvlVmDir $Name
    if (Test-Path -LiteralPath (Join-Path $dir 'vm.json')) { throw "A lab machine named '$Name' already exists." }
    $started = Get-Date
    $prefer = $Hypervisor
    if ($RequireTpm -and $prefer -eq 'auto') { $prefer = 'virtualbox' }
    $hv = Get-MvlHypervisor -Prefer $prefer
    $media = Get-MvlMedia
    $waive = ($hv.Kind -eq 'vmware')
    if ($waive -and $RequireTpm) { throw 'VMware Workstation cannot present a virtual TPM to automation; use --hypervisor virtualbox.' }

    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    $password = if ($Password) { $Password } elseif ($RandomPassword) { New-MvlPassword } else { '1234' }
    if ($usingDefault -and $Network -eq 'bridged') { Write-MvlPhase "Bridged onto your LAN with the default password 1234: anyone on the LAN can sign in to this guest over Remote Desktop." warn }
    $state = [pscustomobject]@{
        schema        = 1
        name          = $Name
        project       = $Project
        hypervisor    = $hv.Kind
        hypervisorVersion = $hv.Version
        hypervisorReason  = $hv.Reason
        computerName  = ('MVL-' + $Name.ToUpperInvariant()).Substring(0, [Math]::Min(15, 4 + $Name.Length))
        userName      = $UserName
        defaultPassword = $usingDefault
        memoryMB      = $MemoryMB
        cpus          = $Cpus
        diskGB        = $DiskGB
        network       = $Network
        locale        = $Locale
        timeZone      = $TimeZone
        imageIndex    = 1
        mediaSha256   = $media.sha256
        mediaFile     = [IO.Path]::GetFileName($media.path)
        tpmMode       = $(if ($waive) { 'setup requirement waived in guest (VMware vTPM needs UI-set encryption)' } else { 'virtual TPM 2.0' })
        secureBoot    = $true
        vmPath        = ''
        status        = 'creating'
        baseline      = $null
        runners       = @()
        created       = (Get-Date).ToUniversalTime().ToString('o')
        updated       = ''
        provisioning  = $null
        owner         = $For
        tools         = [bool]$wantTools
        sharedFolder  = $null
    }
    if ($wantShare) { $state.sharedFolder = New-MvlSharedFolder -State $state }
    Save-MvlState $state
    Protect-MvlSecret -Name $Name -Plain $password

    try {
        Write-MvlPhase "Writing answer file and seed image for '$Name'."
        $seedIso = New-MvlSeed -State $state -Password $password -WaiveTpmRequirement:$waive
        $password = $null
        Write-MvlPhase "Creating $($hv.Kind) virtual machine ($MemoryMB MB, $Cpus vCPU, $DiskGB GB, $Network)."
        if ($hv.Kind -eq 'vmware') { $state.vmPath = New-MvlVmwareVm -State $state -InstallIso $media.path -SeedIso $seedIso }
        else { $state.vmPath = New-MvlVboxVm -State $state -InstallIso $media.path -SeedIso $seedIso }
        $state.status = 'installing'
        Save-MvlState $state

        Invoke-MvlBackend $state Start
        Write-MvlPhase 'Powered on; answering the boot-from-CD prompt.'
        # VMware: six presses in the first six seconds cover the UEFI "press any key" prompt; a
        # longer burst reaches Setup's focused Cancel button (seen 2026-11-17).
        # VirtualBox: its UEFI reaches the prompt later, so six seconds missed it and the machine
        # fell through to "No bootable option" (seen 2026-11-17); press from second 2 to 20.
        if ($state.hypervisor -eq 'vmware') {
            for ($i = 0; $i -lt 6; $i++) { Start-Sleep -Milliseconds 1000; Invoke-MvlBackend $state BootKey | Out-Null }
        } else {
            Send-MvlBootKeyWhilePrompt -State $state -Dir $dir
        }

        $shots = Join-Path $dir 'provisioning'
        New-Item -ItemType Directory -Path $shots -Force | Out-Null
        Write-MvlPhase "Windows is installing unattended; waiting up to $TimeoutMinutes minutes for the readiness signal."
        Wait-MvlCondition -TimeoutMinutes $TimeoutMinutes -IntervalSeconds 30 -Waiting 'guest readiness signal' -Condition {
            (Invoke-MvlBackend $state ReadVar @{ Var = $(if ($state.hypervisor -eq 'vmware') { 'mvl.ready' } else { 'Ready' }) }) -eq '1'
        } -OnTick {
            param($tick)
            if ($tick % 10 -eq 0) {
                $p = Join-Path $shots ('install-{0:D3}.png' -f ($tick / 10))
                if (Invoke-MvlBackend $state Screenshot @{ Path = $p }) { Write-MvlPhase "Still installing ($([int]($tick / 2)) min); guest view saved to $p" }
            }
        } | Out-Null
        Write-MvlPhase 'Guest reported ready; waiting for it to shut down for the baseline.' ok
        Wait-MvlCondition -TimeoutMinutes 15 -IntervalSeconds 10 -Waiting 'guest shutdown' -Condition { (Invoke-MvlBackend $state Power) -eq 'off' } | Out-Null

        Invoke-MvlBackend $state Detach
        Remove-Item -LiteralPath $seedIso -Force
        Write-MvlPhase 'Seed image removed; installation media detached.' ok
        Invoke-MvlBackend $state Snapshot @{ Snapshot = $script:MvlBaseline }
        $state.baseline = [pscustomobject]@{ name = $script:MvlBaseline; takenUtc = (Get-Date).ToUniversalTime().ToString('o') }
        $state.status = 'ready'
        $state.provisioning = [pscustomobject]@{ minutes = [math]::Round(((Get-Date) - $started).TotalMinutes, 1) }
        if ($state.network -eq 'bridged') {
            # Prove the bridged network now so a problem shows up at creation, not at first use.
            Save-MvlState $state
            Start-MvlMachine $Name
            $state = Get-MvlState $Name
            Stop-MvlMachine $Name
        }
        Save-MvlState $state
        Write-MvlPhase "Lab machine '$Name' is ready with clean baseline '$($script:MvlBaseline)' after $($state.provisioning.minutes) minutes." ok
        if ($state.sharedFolder) {
            Write-MvlPhase "Shared folder: $($state.sharedFolder.hostPath) on this PC, $($state.sharedFolder.guestPath) in the guest." ok
            if ($For -eq 'you' -and -not $NoOpenShare) { Open-MvlShare -Name $Name | Out-Null }
        }
        return $state
    } catch {
        $state.status = 'failed'
        $state | Add-Member -NotePropertyName error -NotePropertyValue $_.Exception.Message -Force
        Save-MvlState $state
        $p = Join-Path $dir 'failure.png'
        try { Invoke-MvlBackend $state Screenshot @{ Path = $p } | Out-Null } catch { }
        throw
    }
}

function Get-MvlMachine {
    param([string]$Name)
    $states = if ($Name) { @(Get-MvlState $Name) } else { @(Get-MvlAllStates) }
    foreach ($s in $states) {
        $power = 'unknown'
        try { if ($s.vmPath) { $power = Invoke-MvlBackend $s Power } } catch { $power = 'unavailable' }
        $ip = ''
        if ($power -eq 'running') { try { $ip = Invoke-MvlBackend $s Ip } catch { $ip = '' } }
        [pscustomobject]@{
            Name = $s.name; Project = $s.project; Hypervisor = $s.hypervisor; Status = $s.status; Power = $power
            Network = $s.network; IP = $ip; User = $s.userName
            Baseline = $(if ($s.baseline) { $s.baseline.name } else { '' }); Runners = @($s.runners).Count; Created = $s.created
            OS = $(if ($s.PSObject.Properties['os'] -and $s.os) { $s.os } else { 'windows' })
            Owner = $(if ($s.PSObject.Properties['owner'] -and $s.owner) { $s.owner } else { 'agent' })
            Tools = [bool]($s.PSObject.Properties['tools'] -and $s.tools)
            SharedFolder = $(if ($s.PSObject.Properties['sharedFolder'] -and $s.sharedFolder) { $s.sharedFolder } else { $null })
        }
    }
}

function Start-MvlMachine {
    param([Parameter(Mandatory)][string]$Name, [int]$WaitMinutes = 10)
    $s = Get-MvlState $Name
    if ($s.status -ne 'ready') { throw "'$Name' is not ready (status $($s.status))." }
    if ((Invoke-MvlBackend $s Power) -ne 'running') {
        Sync-MvlNetworkBeforeStart $s
        Invoke-MvlBackend $s Start
    }
    Wait-MvlCondition -TimeoutMinutes $WaitMinutes -IntervalSeconds 10 -Waiting 'guest tools' -Condition { Invoke-MvlBackend $s ToolsReady } | Out-Null
    Confirm-MvlNetworkAfterStart $s
    if ($s.hypervisor -eq 'vmware' -and $s.PSObject.Properties['sharedFolder'] -and $s.sharedFolder) {
        # Make sure Workstation serves the shared folder for this run.
        Invoke-MvlVmrun (Find-MvlVmware) @('enableSharedFolders', $s.vmPath) -AllowFailure | Out-Null
    }
    if ($s.network -eq 'nat' -and $s.PSObject.Properties['networkFallback'] -and $s.networkFallback) {
        Wait-MvlCondition -TimeoutMinutes $WaitMinutes -IntervalSeconds 10 -Waiting 'guest tools after NAT fallback' -Condition { Invoke-MvlBackend $s ToolsReady } | Out-Null
    }
    Write-MvlPhase "'$Name' is running with guest tools ready." ok
}

function Stop-MvlMachine {
    param([Parameter(Mandatory)][string]$Name, [switch]$Hard)
    $s = Get-MvlState $Name
    Invoke-MvlBackend $s Stop @{ Hard = [bool]$Hard }
    if (-not $Hard) {
        try { Wait-MvlCondition -TimeoutMinutes 5 -IntervalSeconds 10 -Waiting 'shutdown' -Condition { (Invoke-MvlBackend $s Power) -eq 'off' } | Out-Null }
        catch { Write-MvlPhase 'Soft shutdown timed out; powering off.' warn; Invoke-MvlBackend $s Stop @{ Hard = $true } }
    }
    Write-MvlPhase "'$Name' is off." ok
}

function Reset-MvlMachine {
    param([Parameter(Mandatory)][string]$Name)
    $s = Get-MvlState $Name
    if (-not $s.baseline) { throw "'$Name' has no baseline snapshot." }
    if ((Invoke-MvlBackend $s Power) -eq 'running') { Invoke-MvlBackend $s Stop @{ Hard = $true }; Start-Sleep -Seconds 3 }
    Invoke-MvlBackend $s Restore @{ Snapshot = $s.baseline.name }
    Write-MvlPhase "'$Name' reset to clean baseline '$($s.baseline.name)'." ok
}

function Remove-MvlMachine {
    param([Parameter(Mandatory)][string]$Name)
    $s = Get-MvlState $Name
    foreach ($r in @($s.runners)) {
        try { Unregister-MvlRunnerRecord -State $s -Runner $r } catch { Write-MvlPhase "Runner removal for $($r.repo) failed: $($_.Exception.Message)" warn }
    }
    Remove-MvlRdpCredential $s
    if ($s.vmPath) { Invoke-MvlBackend $s Remove }
    $dir = Get-MvlVmDir $Name
    Remove-Item -LiteralPath $dir -Recurse -Force
    if (Test-Path -LiteralPath $dir) { throw "VM folder still present: $dir" }
    Write-MvlPhase "'$Name' destroyed: virtual machine, disk, snapshots, credential and folder removed." ok
    if ($s.PSObject.Properties['sharedFolder'] -and $s.sharedFolder) {
        # Files in the shared folder are the owner's; scrapping the machine never deletes them.
        Write-MvlPhase "The shared folder $($s.sharedFolder.hostPath) is kept with its files." ok
    }
}
