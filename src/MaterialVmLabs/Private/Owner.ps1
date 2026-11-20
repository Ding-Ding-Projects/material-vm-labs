# Owner features: a lab machine set up "for you" gets the owner tools,
# the C# Setup app that opens the official sign-ins, and one folder shared with the host.
# A lab machine Claude creates for fresh-host testing gets none of this unless asked.

function Get-MvlRepoRoot {
    return (Split-Path -Parent (Split-Path -Parent $script:MvlModuleRoot))
}

function Get-MvlGuestSetupExe {
    <# The guest Setup exe; built from guest-setup\ with the .NET SDK when it is not built yet. #>
    $repo = Get-MvlRepoRoot
    $exe = Join-Path $repo 'guest-setup\out\MaterialVmLabsSetup.exe'
    if (Test-Path -LiteralPath $exe) { return $exe }
    $proj = Join-Path $repo 'guest-setup\MaterialVmLabsSetup.csproj'
    if (-not (Test-Path -LiteralPath $proj)) { throw "The guest Setup project is missing: $proj" }
    $dotnet = Get-Command dotnet.exe -ErrorAction SilentlyContinue
    if (-not $dotnet) { throw 'Building the guest Setup app needs the .NET SDK (dependency): choco install dotnet-sdk, or run build.bat.' }
    Write-MvlPhase 'Building the guest Setup app (dotnet publish).'
    Invoke-MvlNative -FilePath $dotnet.Source -ArgumentList @('publish', $proj, '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true',
        '-p:PublishSingleFile=true', '-p:IncludeNativeLibrariesForSelfExtract=true', '-o', (Join-Path $repo 'guest-setup\out')) -Display 'dotnet publish' | Out-Null
    if (-not (Test-Path -LiteralPath $exe)) { throw "dotnet publish finished but $exe is missing." }
    return $exe
}

function New-MvlSharedFolder {
    <# Creates the host side of the one shared folder and returns where each side sees it. #>
    param([Parameter(Mandatory)]$State)
    $hostPath = Join-Path (Join-Path (Get-MvlHome) 'shared') $State.name
    New-Item -ItemType Directory -Path $hostPath -Force | Out-Null
    $guestPath = if ($State.hypervisor -eq 'vmware') { "\\vmware-host\Shared Folders\$($State.name)" } else { "\\VBOXSVR\$($State.name)" }
    return [pscustomobject]@{ hostPath = $hostPath; guestPath = $guestPath }
}

function Open-MvlShare {
    <# Returns the host path of a machine's shared folder and opens it in Explorer unless told not to. #>
    param([Parameter(Mandatory)][string]$Name, [switch]$NoOpen)
    $s = Get-MvlState $Name
    if (-not ($s.PSObject.Properties['sharedFolder'] -and $s.sharedFolder)) { throw "'$Name' has no shared folder (it was set up with --no-share or for Claude)." }
    $p = $s.sharedFolder.hostPath
    if (-not (Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Path $p -Force | Out-Null }
    if (-not $NoOpen) { Start-Process -FilePath 'explorer.exe' -ArgumentList "`"$p`"" }
    return [pscustomobject]@{ name = $Name; hostPath = $p; guestPath = $s.sharedFolder.guestPath }
}

function Resolve-MvlOwnerOptions {
    <# "you" gets tools and a shared folder by default; "agent" stays bare unless asked. The no- switches win. #>
    param([ValidateSet('you', 'agent')][string]$For = 'agent', [switch]$Tools, [switch]$NoTools, [switch]$Share, [switch]$NoShare)
    return [pscustomobject]@{
        tools = [bool]((($For -eq 'you') -or $Tools) -and -not $NoTools)
        share = [bool]((($For -eq 'you') -or $Share) -and -not $NoShare)
        setup = ($For -eq 'you')
    }
}
