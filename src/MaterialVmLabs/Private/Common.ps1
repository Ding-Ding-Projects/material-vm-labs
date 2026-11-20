Set-StrictMode -Version 2.0

# Shared helpers: state root, phase logging, native process calls, per-VM state and
# DPAPI-protected guest credentials. Nothing here ever writes a credential in plain text.

$script:MvlModuleRoot = Split-Path -Parent $PSScriptRoot
$script:MvlRepoRoot = Split-Path -Parent (Split-Path -Parent $script:MvlModuleRoot)

function Get-MvlHome {
    if ($env:MVL_HOME) { $root = $env:MVL_HOME }
    else { $root = Join-Path $env:LOCALAPPDATA 'MaterialVmLabs' }
    foreach ($sub in @('', 'media', 'vms', 'runs')) {
        $p = Join-Path $root $sub
        if (-not (Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Path $p -Force | Out-Null }
    }
    return (Resolve-Path -LiteralPath $root).Path
}

function Write-MvlPhase {
    param([Parameter(Mandatory)][string]$Message, [ValidateSet('info', 'ok', 'warn', 'fail')][string]$Level = 'info')
    $stamp = (Get-Date).ToString('HH:mm:ss')
    $tag = @{ info = '[..]'; ok = '[ok]'; warn = '[!!]'; fail = '[xx]' }[$Level]
    $line = "$stamp $tag $Message"
    if ($Level -eq 'fail') { [Console]::Error.WriteLine($line) } else { Write-Host $line }
}

function Invoke-MvlNative {
    # Runs an executable with an argument array, returns exit code and captured output.
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [switch]$AllowFailure,
        [string]$Display
    )
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $FilePath
    $psi.Arguments = ($ArgumentList | ForEach-Object { ConvertTo-MvlArgument $_ }) -join ' '
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $proc = [System.Diagnostics.Process]::Start($psi)
    $outTask = $proc.StandardOutput.ReadToEndAsync()
    $errTask = $proc.StandardError.ReadToEndAsync()
    $proc.WaitForExit()
    $result = [pscustomobject]@{
        ExitCode = $proc.ExitCode
        StdOut   = $outTask.Result
        StdErr   = $errTask.Result
    }
    if (-not $AllowFailure -and $result.ExitCode -ne 0) {
        $name = if ($Display) { $Display } else { [IO.Path]::GetFileName($FilePath) }
        $detail = ($result.StdErr + "`n" + $result.StdOut).Trim()
        throw "$name failed with exit code $($result.ExitCode): $detail"
    }
    return $result
}

function ConvertTo-MvlArgument {
    param([AllowEmptyString()][string]$Value)
    if ($null -eq $Value -or $Value -eq '') { return '""' }
    if ($Value -notmatch '[\s"]') { return $Value }
    $escaped = $Value -replace '(\\*)"', '$1$1\"'
    $escaped = $escaped -replace '(\\+)$', '$1$1'
    return '"' + $escaped + '"'
}

function Test-MvlName {
    param([Parameter(Mandatory)][string]$Name)
    if ($Name -notmatch '^[a-z0-9][a-z0-9-]{1,30}$') {
        throw "Invalid lab machine name '$Name'. Use 2-31 lowercase letters, digits or hyphens."
    }
}

function Get-MvlVmDir {
    param([Parameter(Mandatory)][string]$Name)
    Test-MvlName $Name
    return (Join-Path (Join-Path (Get-MvlHome) 'vms') $Name)
}

function Save-MvlState {
    param([Parameter(Mandatory)]$State)
    $dir = Get-MvlVmDir $State.name
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $State.updated = (Get-Date).ToUniversalTime().ToString('o')
    $State | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $dir 'vm.json') -Encoding UTF8
}

function Get-MvlState {
    param([Parameter(Mandatory)][string]$Name)
    $file = Join-Path (Get-MvlVmDir $Name) 'vm.json'
    if (-not (Test-Path -LiteralPath $file)) { throw "No lab machine named '$Name'." }
    return (Get-Content -LiteralPath $file -Raw | ConvertFrom-Json)
}

function Get-MvlAllStates {
    $vms = Join-Path (Get-MvlHome) 'vms'
    Get-ChildItem -LiteralPath $vms -Directory | ForEach-Object {
        $f = Join-Path $_.FullName 'vm.json'
        if (Test-Path -LiteralPath $f) { Get-Content -LiteralPath $f -Raw | ConvertFrom-Json }
    }
}

function New-MvlPassword {
    # 24 characters from an unambiguous alphabet plus required classes, from a CSPRNG.
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
    $bytes = New-Object byte[] 24
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $chars = foreach ($b in $bytes) { $alphabet[$b % $alphabet.Length] }
    return ('Dc9!' + (-join $chars))
}

function Protect-MvlSecret {
    param([Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][string]$Plain)
    $secure = ConvertTo-SecureString -String $Plain -AsPlainText -Force
    $blob = ConvertFrom-SecureString -SecureString $secure   # DPAPI, current user only
    Set-Content -LiteralPath (Join-Path (Get-MvlVmDir $Name) 'guest-credential.dpapi') -Value $blob -Encoding ASCII
}

function Unprotect-MvlSecret {
    param([Parameter(Mandatory)][string]$Name)
    $blob = Get-Content -LiteralPath (Join-Path (Get-MvlVmDir $Name) 'guest-credential.dpapi') -Raw
    $secure = ConvertTo-SecureString -String $blob.Trim()
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Get-MvlFileSha256 {
    param([Parameter(Mandatory)][string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Wait-MvlCondition {
    param(
        [Parameter(Mandatory)][scriptblock]$Condition,
        [int]$TimeoutMinutes = 120,
        [int]$IntervalSeconds = 20,
        [string]$Waiting = 'condition',
        [scriptblock]$OnTick
    )
    $deadline = (Get-Date).AddMinutes($TimeoutMinutes)
    $tick = 0
    while ((Get-Date) -lt $deadline) {
        if (& $Condition) { return $true }
        $tick++
        if ($OnTick) { & $OnTick $tick }
        Start-Sleep -Seconds $IntervalSeconds
    }
    throw "Timed out after $TimeoutMinutes minutes waiting for $Waiting."
}
