Set-StrictMode -Version 2.0

# Installer tests: run a Setup.exe (or .msi) inside a lab machine from its clean baseline,
# record what it changed, and take a screenshot of the guest a minute later.

function Invoke-MvlInstallerTest {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$File,
        [string]$Arguments = '',
        [int]$WaitSeconds = 60,
        [string]$EvidenceDir
    )
    if (-not (Test-Path -LiteralPath $File)) { throw "No installer at $File" }
    $state = Get-MvlState $Name
    if (@($state.runners).Count -gt 0) { throw "'$Name' hosts a self-hosted runner; an installer test resets to the baseline. Use another lab machine." }
    $leaf = [IO.Path]::GetFileName($File)
    $sha = Get-MvlFileSha256 $File
    $runId = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss') + '-install-' + ($leaf -replace '[^A-Za-z0-9]+', '-').ToLowerInvariant()
    $runDir = Join-Path (Join-Path (Get-MvlHome) 'runs') $runId
    New-Item -ItemType Directory -Path $runDir -Force | Out-Null

    Reset-MvlMachine $Name
    Start-MvlMachine $Name
    $state = Get-MvlState $Name
    $guestDir = 'C:\MaterialVmLabs\install'
    Invoke-MvlBackend $state MkDir @{ GuestPath = $guestDir }
    # Folder snapshot before, through the same guest script the build receipts use for folders.
    $probe = Join-Path $runDir 'folders.ps1'
    @'
$roots = @($env:LOCALAPPDATA, $env:APPDATA, $env:ProgramData, $env:ProgramFiles, ${env:ProgramFiles(x86)})
$list = foreach ($r in $roots) { if ($r -and (Test-Path -LiteralPath $r)) { Get-ChildItem -LiteralPath $r -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object FullName } }
$list | Set-Content -LiteralPath $args[0] -Encoding UTF8
'@ | Set-Content -LiteralPath $probe -Encoding UTF8
    $ps = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
    Invoke-MvlBackend $state ToGuest @{ HostPath = $probe; GuestPath = "$guestDir\folders.ps1" }
    Invoke-MvlBackend $state Run @{ Program = $ps; ProgramArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "$guestDir\folders.ps1", "$guestDir\before.txt") } | Out-Null

    Write-MvlPhase "Copying $leaf into '$Name' and running it."
    Invoke-MvlBackend $state ToGuest @{ HostPath = $File; GuestPath = "$guestDir\$leaf" }
    $t0 = Get-Date
    $isMsi = $leaf -match '\.msi$'
    $prog = if ($isMsi) { 'C:\Windows\System32\msiexec.exe' } else { "$guestDir\$leaf" }
    $progArgs = if ($isMsi) { @('/i', "$guestDir\$leaf") + @($Arguments -split ' ' | Where-Object { $_ }) } else { @($Arguments -split ' ' | Where-Object { $_ }) }
    $r = Invoke-MvlBackend $state Run @{ Program = $prog; ProgramArgs = $progArgs; Interactive = $true }
    $exit = $r.ExitCode
    Write-MvlPhase "Installer exited $exit after $([math]::Round(((Get-Date) - $t0).TotalSeconds)) s; waiting $WaitSeconds s for first launch."
    Start-Sleep -Seconds $WaitSeconds

    Invoke-MvlBackend $state Run @{ Program = $ps; ProgramArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "$guestDir\folders.ps1", "$guestDir\after.txt") } | Out-Null
    Invoke-MvlBackend $state FromGuest @{ GuestPath = "$guestDir\before.txt"; HostPath = (Join-Path $runDir 'before.txt') }
    Invoke-MvlBackend $state FromGuest @{ GuestPath = "$guestDir\after.txt"; HostPath = (Join-Path $runDir 'after.txt') }
    # [string] casts: Get-Content lines carry PSPath and provider objects that bloat JSON.
    $before = @(Get-Content -LiteralPath (Join-Path $runDir 'before.txt') | ForEach-Object { [string]$_ })
    $newFolders = @(Get-Content -LiteralPath (Join-Path $runDir 'after.txt') | ForEach-Object { [string]$_ } | Where-Object { $before -notcontains $_ })
    $shot = Join-Path $runDir 'guest-after-install.png'
    $shotOk = Invoke-MvlBackend $state Screenshot @{ Path = $shot }

    $receipt = [ordered]@{
        schema        = 'material-vm-labs/installer-receipt/1'
        runId         = $runId
        verdict       = $(if ($exit -eq 0) { 'installer exited 0' } else { "installer exited $exit" })
        installer     = [ordered]@{ file = $leaf; sha256 = $sha; arguments = $Arguments }
        exitCode      = $exit
        machine       = [ordered]@{ name = $state.name; hypervisor = $state.hypervisor; baseline = $state.baseline.name; resetBeforeRun = $true }
        newFolders    = $newFolders
        screenshot       = $(if ($shotOk) { 'guest-after-install.png' } else { $null })
        finishedUtc   = (Get-Date).ToUniversalTime().ToString('o')
    }
    $receiptPath = Join-Path $runDir 'receipt.json'
    $receipt | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $receiptPath -Encoding UTF8
    if ($EvidenceDir) {
        New-Item -ItemType Directory -Path $EvidenceDir -Force | Out-Null
        Copy-Item -LiteralPath $receiptPath -Destination (Join-Path $EvidenceDir "$runId.json")
        if ($shotOk) { Copy-Item -LiteralPath $shot -Destination (Join-Path $EvidenceDir "$runId.png") }
    }
    Write-MvlPhase "Installer test done: $($receipt.verdict), $($newFolders.Count) new folders; receipt $receiptPath" $(if ($exit -eq 0) { 'ok' } else { 'fail' })
    return [pscustomobject]$receipt
}
