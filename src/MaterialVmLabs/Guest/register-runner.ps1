# Runs inside a lab machine to install and register a GitHub Actions runner as a service.
# The registration token and the guest logon password are read from the hypervisor's
# in-memory guest variables, never from arguments or files.
param(
    [Parameter(Mandatory)][string]$Repo,
    [Parameter(Mandatory)][string]$RunnerName,
    [Parameter(Mandatory)][string]$Labels,
    [Parameter(Mandatory)][string]$Hypervisor,
    [Parameter(Mandatory)][string]$UserName
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Start-Transcript -Path 'C:\MaterialVmLabs\register-runner.log' -Append | Out-Null

function Get-GuestVar([string]$vmwareName, [string]$vboxName) {
    if ($Hypervisor -eq 'vmware') {
        $v = & 'C:\Program Files\VMware\VMware Tools\rpctool.exe' "info-get guestinfo.$vmwareName"
        return "$v".Trim()
    }
    $out = & 'C:\Program Files\Oracle\VirtualBox Guest Additions\VBoxControl.exe' --nologo guestproperty get "/MVL/$vboxName"
    if ("$out" -match 'Value:\s*(\S+)') { return $Matches[1] }
    return ''
}

$dir = 'C:\actions-runner'
New-Item -ItemType Directory -Path $dir -Force | Out-Null
$rel = Invoke-RestMethod -Uri 'https://api.github.com/repos/actions/runner/releases/latest' -Headers @{ 'User-Agent' = 'material-vm-labs' }
$asset = $rel.assets | Where-Object { $_.name -match '^actions-runner-win-x64-[\d.]+\.zip$' } | Select-Object -First 1
if (-not $asset) { throw 'No win-x64 runner asset in the latest release.' }
if ($rel.body -notmatch '<!-- BEGIN SHA win-x64 -->([0-9a-f]{64})<!-- END SHA win-x64 -->') { throw 'Release notes carry no win-x64 SHA-256.' }
$expected = $Matches[1]
$zip = Join-Path $dir $asset.name
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip -UseBasicParsing
$actual = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw "Runner archive hash mismatch: $actual vs $expected" }
Write-Output "Runner $($rel.tag_name) verified ($actual)."
Expand-Archive -LiteralPath $zip -DestinationPath $dir -Force
Remove-Item -LiteralPath $zip -Force

$token = Get-GuestVar 'mvl.runnertoken' 'RunnerToken'
$logon = Get-GuestVar 'mvl.runnerlogon' 'RunnerLogon'
if (-not $token) { throw 'No registration token was provided through the guest channel.' }
Push-Location $dir
try {
    & .\config.cmd --unattended --url "https://github.com/$Repo" --token $token --name $RunnerName --labels $Labels `
        --work '_work' --replace --runasservice --windowslogonaccount ".\$UserName" --windowslogonpassword $logon
    if ($LASTEXITCODE -ne 0) { throw "config.cmd exited $LASTEXITCODE" }
} finally {
    Pop-Location
    $token = $null; $logon = $null
}
Stop-Transcript | Out-Null
