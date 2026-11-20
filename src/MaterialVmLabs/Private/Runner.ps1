Set-StrictMode -Version 2.0

# Self-hosted GitHub Actions runners inside a lab machine, for PRIVATE repositories only.
# The registration token is read from standard input, handed to the guest through the
# hypervisor's in-memory guest variable channel, and cleared as soon as the guest has used it.
# It is never written to a tracked file, a log, or the VM state.

function Assert-MvlPrivateRepo {
    param([Parameter(Mandatory)][string]$Repo)
    if ($Repo -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { throw "Repository must be owner/name, got '$Repo'." }
    $gh = (Get-Command gh.exe -ErrorAction Stop).Source
    $r = Invoke-MvlNative -FilePath $gh -ArgumentList @('repo', 'view', $Repo, '--json', 'visibility', '-q', '.visibility') -AllowFailure
    if ($r.ExitCode -ne 0) { throw "Cannot read visibility of ${Repo}: $($r.StdErr.Trim())" }
    $vis = $r.StdOut.Trim().ToUpperInvariant()
    if ($vis -ne 'PRIVATE') { throw "Refused: $Repo is $vis. A lab machine runner serves private repositories only." }
}

function Register-MvlRunner {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Repo,
        [string[]]$Labels = @(),
        [Parameter(Mandatory)][string]$Token
    )
    Assert-MvlPrivateRepo $Repo
    $state = Get-MvlState $Name
    if (@($state.runners) | Where-Object { $_.repo -eq $Repo }) { throw "'$Name' already hosts a runner for $Repo." }
    $runnerName = "mvl-$Name"
    $allLabels = @('material-vm-labs', "mvl-$($state.project)") + $Labels | Select-Object -Unique
    Start-MvlMachine $Name

    $tokenVar = if ($state.hypervisor -eq 'vmware') { 'mvl.runnertoken' } else { 'RunnerToken' }
    $pwVar = if ($state.hypervisor -eq 'vmware') { 'mvl.runnerlogon' } else { 'RunnerLogon' }
    try {
        Invoke-MvlBackend $state WriteVar @{ Var = $tokenVar; Value = $Token }
        Invoke-MvlBackend $state WriteVar @{ Var = $pwVar; Value = (Unprotect-MvlSecret $Name) }
        $guestScript = 'C:\MaterialVmLabs\register-runner.ps1'
        Invoke-MvlBackend $state ToGuest @{ HostPath = (Join-Path $script:MvlModuleRoot 'Guest\register-runner.ps1'); GuestPath = $guestScript }
        Write-MvlPhase "Registering runner '$runnerName' for $Repo inside '$Name'."
        $r = Invoke-MvlBackend $state Run @{ Program = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
            ProgramArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $guestScript, '-Repo', $Repo, '-RunnerName', $runnerName,
                '-Labels', ($allLabels -join ','), '-Hypervisor', $state.hypervisor, '-UserName', $state.userName) }
        if ($r.ExitCode -ne 0) { throw "Guest runner registration failed (exit $($r.ExitCode))." }
    } finally {
        Invoke-MvlBackend $state WriteVar @{ Var = $tokenVar; Value = '' }
        Invoke-MvlBackend $state WriteVar @{ Var = $pwVar; Value = '' }
    }
    $online = Get-MvlRunnerRecord -Repo $Repo -RunnerName $runnerName
    if (-not $online) { throw "Runner '$runnerName' did not appear in $Repo." }
    $state.runners = @(@($state.runners) + [pscustomobject]@{ repo = $Repo; runnerName = $runnerName; id = $online.id; labels = $allLabels; registeredUtc = (Get-Date).ToUniversalTime().ToString('o') })
    Save-MvlState $state
    Write-MvlPhase "Runner '$runnerName' registered for $Repo (id $($online.id), status $($online.status))." ok
}

function Get-MvlRunnerRecord {
    param([Parameter(Mandatory)][string]$Repo, [Parameter(Mandatory)][string]$RunnerName)
    $gh = (Get-Command gh.exe -ErrorAction Stop).Source
    $r = Invoke-MvlNative -FilePath $gh -ArgumentList @('api', "repos/$Repo/actions/runners", '--paginate', '-q', '.runners[]') -AllowFailure
    if ($r.ExitCode -ne 0) { throw "Cannot list runners for ${Repo}: $($r.StdErr.Trim())" }
    foreach ($line in ($r.StdOut -split "`r?`n" | Where-Object { $_ })) {
        $o = $line | ConvertFrom-Json
        if ($o.name -eq $RunnerName) { return $o }
    }
    return $null
}

function Unregister-MvlRunnerRecord {
    param([Parameter(Mandatory)]$State, [Parameter(Mandatory)]$Runner)
    $rec = Get-MvlRunnerRecord -Repo $Runner.repo -RunnerName $Runner.runnerName
    if ($rec) {
        $gh = (Get-Command gh.exe -ErrorAction Stop).Source
        Invoke-MvlNative -FilePath $gh -ArgumentList @('api', '-X', 'DELETE', "repos/$($Runner.repo)/actions/runners/$($rec.id)") -Display 'gh api runner delete' | Out-Null
    }
    Write-MvlPhase "Runner '$($Runner.runnerName)' removed from $($Runner.repo)." ok
}

function Unregister-MvlRunner {
    param([Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][string]$Repo)
    $state = Get-MvlState $Name
    $r = @($state.runners) | Where-Object { $_.repo -eq $Repo } | Select-Object -First 1
    if (-not $r) { throw "'$Name' hosts no runner for $Repo." }
    Unregister-MvlRunnerRecord -State $state -Runner $r
    $state.runners = @(@($state.runners) | Where-Object { $_.repo -ne $Repo })
    Save-MvlState $state
}
