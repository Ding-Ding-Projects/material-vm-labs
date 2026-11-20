Set-StrictMode -Version 2.0

# Lab machine IP, network mode (NAT, bridged, host-only) with automatic NAT fallback,
# and Remote Desktop with the guest credential saved for that address.

function Get-MvlIp {
    param([Parameter(Mandatory)][string]$Name, [int]$WaitSeconds = 0)
    $s = Get-MvlState $Name
    $deadline = (Get-Date).AddSeconds($WaitSeconds)
    do {
        $ip = ''
        try { $ip = Invoke-MvlBackend $s Ip } catch { $ip = '' }
        if ($ip -and $ip -notlike '169.254.*') { return $ip }
        if ((Get-Date) -ge $deadline) { break }
        Start-Sleep -Seconds 5
    } while ($true)
    return ''
}

function Set-MvlNetwork {
    # Changes the network mode. The lab machine must be off; the mode is stored in its
    # state and re-applied on every start, so a reset to the baseline never loses it.
    param([Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][ValidateSet('nat', 'bridged', 'hostonly')][string]$Mode)
    $s = Get-MvlState $Name
    if ($s.PSObject.Properties['profile'] -and $s.profile -eq 'server-forest' -and $Mode -ne 'hostonly') {
        throw 'Server forest guests use host-only networking.'
    }
    if ((Invoke-MvlBackend $s Power) -eq 'running') { throw "'$Name' is running; stop it before changing its network." }
    Invoke-MvlBackend $s SetNet @{ Mode = $Mode }
    $s.network = $Mode
    Save-MvlState $s
    Write-MvlPhase "'$Name' network set to $Mode." ok
}

function Sync-MvlNetworkBeforeStart {
    # A snapshot restore brings back the network the baseline was taken with; put the
    # requested mode back before power-on.
    param([Parameter(Mandatory)]$State)
    $current = Invoke-MvlBackend $State GetNet
    if ($current -ne $State.network) { Invoke-MvlBackend $State SetNet @{ Mode = $State.network } }
}

function Confirm-MvlNetworkAfterStart {
    # Bridged with no usable address within three minutes falls back to NAT automatically
    # and says so; the fallback is recorded in the state.
    param([Parameter(Mandatory)]$State)
    if ($State.network -ne 'bridged') { return }
    $ip = Get-MvlIp -Name $State.name -WaitSeconds 180
    if ($ip) { Write-MvlPhase "'$($State.name)' is bridged at $ip." ok; return }
    $reason = 'no bridged address within 3 minutes'
    if ($State.hypervisor -eq 'vmware') {
        # Seen 2026-11-17: the guest only got 169.254.x.x because VMware's automatic VMnet0 bridge
        # picked a host adapter without DHCP (Hyper-V, WSL or host-only adapters sit beside Wi-Fi).
        $reason += '; VMware automatic bridging likely picked an adapter without DHCP: in Virtual Network Editor, bridge VMnet0 to the adapter that carries your LAN'
    }
    Write-MvlPhase "'$($State.name)' got no bridged address in three minutes ($reason); falling back to NAT." warn
    # A clean shutdown first: a hard power-off sends the next boot into Automatic Repair
    # (seen 2026-11-17). Hard only when the guest will not shut down in five minutes.
    Invoke-MvlBackend $State Stop @{ Hard = $false }
    try { Wait-MvlCondition -TimeoutMinutes 5 -IntervalSeconds 5 -Waiting 'clean shutdown' -Condition { (Invoke-MvlBackend $State Power) -eq 'off' } | Out-Null }
    catch {
        Invoke-MvlBackend $State Stop @{ Hard = $true }
        Wait-MvlCondition -TimeoutMinutes 2 -IntervalSeconds 3 -Waiting 'power off' -Condition { (Invoke-MvlBackend $State Power) -eq 'off' } | Out-Null
    }
    Invoke-MvlBackend $State SetNet @{ Mode = 'nat' }
    $State.network = 'nat'
    $State | Add-Member -NotePropertyName networkFallback -NotePropertyValue ([pscustomobject]@{ from = 'bridged'; to = 'nat'; reason = $reason; atUtc = (Get-Date).ToUniversalTime().ToString('o') }) -Force
    Save-MvlState $State
    Invoke-MvlBackend $State Start
}

function Enable-MvlGuestRdp {
    # Idempotent: also covers lab machines provisioned before RDP was pre-opened.
    param([Parameter(Mandatory)]$State)
    Invoke-MvlBackend $State Run @{ Program = 'C:\Windows\System32\reg.exe'; ProgramArgs = @('add', 'HKLM\System\CurrentControlSet\Control\Terminal Server', '/v', 'fDenyTSConnections', '/t', 'REG_DWORD', '/d', '0', '/f') } | Out-Null
    Invoke-MvlBackend $State Run @{ Program = 'C:\Windows\System32\netsh.exe'; ProgramArgs = @('advfirewall', 'firewall', 'set', 'rule', 'group=remote desktop', 'new', 'enable=Yes') } | Out-Null
}

function Open-MvlRdp {
    <#
      Makes sure RDP is on inside the guest, saves the guest credential for TERMSRV/<ip> in the
      current user's Credential Manager, and opens Remote Desktop. -NoLaunch only prepares.
    #>
    param([Parameter(Mandatory)][string]$Name, [switch]$NoLaunch)
    $s = Get-MvlState $Name
    if ((Invoke-MvlBackend $s Power) -ne 'running') { Start-MvlMachine $Name; $s = Get-MvlState $Name }
    Enable-MvlGuestRdp $s
    $ip = Get-MvlIp -Name $Name -WaitSeconds 60
    if (-not $ip) { throw "'$Name' has no IP address yet." }
    $pw = Unprotect-MvlSecret $Name
    Invoke-MvlNative -FilePath "$env:SystemRoot\System32\cmdkey.exe" -ArgumentList @("/generic:TERMSRV/$ip", "/user:$ip\$($s.userName)", "/pass:$pw") -Display 'cmdkey' | Out-Null
    $pw = $null
    $s | Add-Member -NotePropertyName rdpTarget -NotePropertyValue "TERMSRV/$ip" -Force
    Save-MvlState $s
    if ($s.network -eq 'bridged' -and $s.PSObject.Properties['defaultPassword'] -and $s.defaultPassword) {
        Write-MvlPhase "'$Name' is bridged onto your LAN with the default password: anyone on the LAN can sign in to this guest." warn
    }
    if (-not $NoLaunch) { Start-Process -FilePath "$env:SystemRoot\System32\mstsc.exe" -ArgumentList "/v:$ip" }
    Write-MvlPhase "Remote Desktop ready for '$Name' at $ip as $($s.userName)." ok
    return [pscustomobject]@{ name = $Name; ip = $ip; user = $s.userName; launched = (-not $NoLaunch) }
}

function Set-MvlGuestPassword {
    <#
      Changes the guest account password, stores it DPAPI-protected, and retakes the clean
      baseline so a later reset keeps the new password. Refused while self-hosted runners are registered,
      because the baseline is retaken.
    #>
    param([Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][string]$Password)
    $s = Get-MvlState $Name
    if (@($s.runners).Count -gt 0) { throw "'$Name' hosts a self-hosted runner; remove it before changing the password, because the baseline is retaken." }
    if ($Password.Length -lt 4) { throw 'Use at least 4 characters.' }
    Reset-MvlMachine $Name
    Start-MvlMachine $Name
    $s = Get-MvlState $Name
    $var = if ($s.hypervisor -eq 'vmware') { 'mvl.newpassword' } else { 'NewPassword' }
    try {
        Invoke-MvlBackend $s WriteVar @{ Var = $var; Value = $Password }
        Invoke-MvlBackend $s ToGuest @{ HostPath = (Join-Path $script:MvlModuleRoot 'Guest\set-password.ps1'); GuestPath = 'C:\MaterialVmLabs\set-password.ps1' }
        $r = Invoke-MvlBackend $s Run @{ Program = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
            ProgramArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'C:\MaterialVmLabs\set-password.ps1', '-UserName', $s.userName, '-Hypervisor', $s.hypervisor) }
        if ($r.ExitCode -ne 0) { throw "The guest refused the new password (exit $($r.ExitCode))." }
    } finally {
        Invoke-MvlBackend $s WriteVar @{ Var = $var; Value = '' }
    }
    Protect-MvlSecret -Name $Name -Plain $Password
    # Prove the new credential opens the guest before touching the baseline.
    if (-not (Invoke-MvlBackend $s GuestFile @{ GuestPath = 'C:\MaterialVmLabs\ready.json' })) { throw 'The new password did not open the guest.' }
    Remove-MvlRdpCredential $s
    Stop-MvlMachine $Name
    if ($s.hypervisor -eq 'vmware') {
        Invoke-MvlVmrun (Find-MvlVmware) @('deleteSnapshot', $s.vmPath, $s.baseline.name) | Out-Null
    } else {
        Invoke-MvlVbox @('snapshot', (Get-MvlVboxName $s), 'delete', $s.baseline.name) | Out-Null
    }
    Invoke-MvlBackend $s Snapshot @{ Snapshot = $s.baseline.name }
    $s = Get-MvlState $Name
    $s | Add-Member -NotePropertyName defaultPassword -NotePropertyValue $false -Force
    $s.baseline = [pscustomobject]@{ name = $s.baseline.name; takenUtc = (Get-Date).ToUniversalTime().ToString('o') }
    Save-MvlState $s
    Write-MvlPhase "'$Name' guest password changed; baseline '$($s.baseline.name)' retaken with it." ok
}

function Remove-MvlRdpCredential {
    param([Parameter(Mandatory)]$State)
    if ($State.PSObject.Properties['rdpTarget'] -and $State.rdpTarget) {
        Invoke-MvlNative -FilePath "$env:SystemRoot\System32\cmdkey.exe" -ArgumentList @("/delete:$($State.rdpTarget)") -AllowFailure | Out-Null
    }
}
