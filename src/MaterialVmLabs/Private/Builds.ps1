Set-StrictMode -Version 2.0

# Fresh-environment build runs and their receipts.

function New-MvlFreshClone {
    # Makes a brand-new clone at an exact commit (or the remote default branch head) and zips it.
    param([Parameter(Mandatory)][string]$Repo, [string]$Ref, [Parameter(Mandatory)][string]$WorkDir)
    $git = (Get-Command git.exe -ErrorAction Stop).Source
    $url = if ($Repo -match '^https?://|^git@') { $Repo } else { "https://github.com/$Repo.git" }
    $repoName = ([IO.Path]::GetFileNameWithoutExtension(($url -split '/')[-1]))
    $cloneDir = Join-Path $WorkDir $repoName
    Invoke-MvlNative -FilePath $git -ArgumentList @('clone', '--quiet', '--no-hardlinks', $url, $cloneDir) -Display 'git clone' | Out-Null
    if ($Ref) { Invoke-MvlNative -FilePath $git -ArgumentList @('-C', $cloneDir, 'checkout', '--quiet', '--detach', $Ref) -Display 'git checkout' | Out-Null }
    $commit = (Invoke-MvlNative -FilePath $git -ArgumentList @('-C', $cloneDir, 'rev-parse', 'HEAD')).StdOut.Trim()
    $remoteHead = (Invoke-MvlNative -FilePath $git -ArgumentList @('ls-remote', $url, 'HEAD') -AllowFailure).StdOut.Split("`t")[0].Trim()
    $zip = Join-Path $WorkDir "$repoName.zip"
    # Compress-Archive silently skips hidden items, and .git is hidden on Windows (seen
    # 2026-11-17: the guest got a clone with no history). ZipFile keeps everything.
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
    [IO.Compression.ZipFile]::CreateFromDirectory($cloneDir, $zip, [IO.Compression.CompressionLevel]::Fastest, $true)
    Remove-Item -LiteralPath $cloneDir -Recurse -Force
    return [pscustomobject]@{ Url = $url; Name = $repoName; Commit = $commit; RemoteHead = $remoteHead; Zip = $zip }
}

function Invoke-MvlBuild {
    <#
      Resets the lab machine to its clean baseline, boots it, copies in a fresh clone,
      runs the requested entrypoints with /s, copies back logs and artifacts, and writes
      a receipt bound to the commit. Returns the receipt.
    #>
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Repo,
        [string]$Ref,
        [string]$Entrypoints = 'build',
        [int]$TimeoutMinutes = 240,
        [switch]$NoReset,
        [string]$EvidenceDir
    )
    $state = Get-MvlState $Name
    if (@($state.runners).Count -gt 0 -and -not $NoReset) { throw "'$Name' hosts a registered runner; resetting would orphan it. Remove the runner first or use --no-reset." }
    $runId = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss') + '-' + ($Repo -replace '[^A-Za-z0-9]+', '-').Trim('-').ToLowerInvariant()
    $runDir = Join-Path (Join-Path (Get-MvlHome) 'runs') $runId
    New-Item -ItemType Directory -Path $runDir -Force | Out-Null
    $media = Get-Content -LiteralPath (Join-Path (Join-Path (Get-MvlHome) 'media') 'media-en-us.json') -Raw | ConvertFrom-Json

    Write-MvlPhase "Making a fresh clone of $Repo."
    $clone = New-MvlFreshClone -Repo $Repo -Ref $Ref -WorkDir $runDir
    Write-MvlPhase "Fresh clone at $($clone.Commit)." ok
    if (-not $NoReset) { Reset-MvlMachine $Name }
    Start-MvlMachine $Name

    $guestBase = 'C:\MaterialVmLabs'
    $guestZip = "$guestBase\in\$runId.zip"
    $guestScript = "$guestBase\run-build.ps1"
    Invoke-MvlBackend $state MkDir @{ GuestPath = "$guestBase\in" }
    Invoke-MvlBackend $state MkDir @{ GuestPath = "$guestBase\out" }
    Invoke-MvlBackend $state ToGuest @{ HostPath = $clone.Zip; GuestPath = $guestZip }
    Invoke-MvlBackend $state ToGuest @{ HostPath = (Join-Path $script:MvlModuleRoot 'Guest\run-build.ps1'); GuestPath = $guestScript }
    Write-MvlPhase "Running $Entrypoints inside '$Name' (silent mode)."
    $t0 = Get-Date
    Invoke-MvlBackend $state Run @{ NoWait = $true; Program = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
        ProgramArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $guestScript, '-Archive', $guestZip, '-RunId', $runId, '-Entrypoints', $Entrypoints) } | Out-Null
    Wait-MvlCondition -TimeoutMinutes $TimeoutMinutes -IntervalSeconds 30 -Waiting 'guest build' -Condition {
        Invoke-MvlBackend $state GuestFile @{ GuestPath = "$guestBase\out\$runId.done" }
    } -OnTick { param($tick) if ($tick % 10 -eq 0) { Write-MvlPhase "Guest build still running ($([int]($tick / 2)) min)." } } | Out-Null

    $resultZip = Join-Path $runDir 'result.zip'
    Invoke-MvlBackend $state FromGuest @{ GuestPath = "$guestBase\out\$runId.zip"; HostPath = $resultZip }
    Expand-Archive -LiteralPath $resultZip -DestinationPath (Join-Path $runDir 'result') -Force
    $result = Get-Content -LiteralPath (Join-Path $runDir 'result\result.json') -Raw | ConvertFrom-Json
    $ready = $null
    try {
        $rp = Join-Path $runDir 'ready.json'
        Invoke-MvlBackend $state FromGuest @{ GuestPath = "$guestBase\ready.json"; HostPath = $rp }
        $ready = Get-Content -LiteralPath $rp -Raw | ConvertFrom-Json
    } catch { }

    $passed = (@($result.entrypoints).Count -gt 0) -and -not (@($result.entrypoints) | Where-Object { $_.result -ne 'passed' })
    $receipt = [ordered]@{
        schema          = 'material-vm-labs/fresh-build-receipt/1'
        runId           = $runId
        verdict         = $(if ($passed) { 'passed' } else { 'failed' })
        repository      = $Repo
        commit          = $clone.Commit
        remoteHeadAtRun = $clone.RemoteHead
        entrypoints     = $result.entrypoints
        guestElevated   = $result.elevated
        hostMinutes     = [math]::Round(((Get-Date) - $t0).TotalMinutes, 1)
        machine         = [ordered]@{
            name = $state.name; project = $state.project; hypervisor = $state.hypervisor; hypervisorVersion = $state.hypervisorVersion
            baseline = $(if ($state.baseline) { $state.baseline.name } else { $null }); resetBeforeRun = (-not $NoReset)
            memoryMB = $state.memoryMB; cpus = $state.cpus; network = $state.network; tpmMode = $state.tpmMode
            guestOs = $result.os; tpmPresent = $(if ($ready) { $ready.tpmPresent } else { $null }); secureBoot = $(if ($ready) { $ready.secureBoot } else { $null })
            preinstalledAtBaseline = $(if ($ready) { $ready.preinstalled } else { $null })
        }
        media           = [ordered]@{ file = $media.path | Split-Path -Leaf; sha256 = $media.sha256; host = $media.host; signatures = 'Microsoft Authenticode valid on setup.exe and sources\setup.exe' }
        dependenciesAcquired = [ordered]@{
            newlyAvailableTools = $result.newlyAvailableTools
            installedPrograms   = $result.installedPrograms
            chocolateyPackages  = $result.chocolateyPackagesAdded
            newPathEntries      = $result.newPathEntries
            newFolders          = $(if ($result.PSObject.Properties['newFolders']) { $result.newFolders } else { @() })
        }
        artifacts         = $result.artifacts
        finishedUtc     = (Get-Date).ToUniversalTime().ToString('o')
    }
    $receiptPath = Join-Path $runDir 'receipt.json'
    $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $receiptPath -Encoding UTF8
    if ($EvidenceDir) {
        New-Item -ItemType Directory -Path $EvidenceDir -Force | Out-Null
        Copy-Item -LiteralPath $receiptPath -Destination (Join-Path $EvidenceDir "$runId.json")
        foreach ($e in @($result.entrypoints)) {
            $log = Join-Path $runDir "result\$($e.log)"
            if (Test-Path -LiteralPath $log) { Copy-Item -LiteralPath $log -Destination (Join-Path $EvidenceDir "$runId-$($e.log)") }
        }
    }
    Remove-Item -LiteralPath $clone.Zip -Force
    $lvl = if ($passed) { 'ok' } else { 'fail' }
    Write-MvlPhase "Fresh-environment build $($receipt.verdict) for $Repo@$($clone.Commit.Substring(0,8)); receipt $receiptPath" $lvl
    return [pscustomobject]$receipt
}
