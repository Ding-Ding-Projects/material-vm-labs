$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
. (Join-Path $PSScriptRoot 'ServerCredential.ps1')
. (Join-Path $PSScriptRoot 'ServerChannel.ps1')

if (-not [Security.Principal.WindowsIdentity]::GetCurrent().IsSystem) {
    throw 'The Server credential exchange requires the guest setup account.'
}
$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'server.json') -Raw | ConvertFrom-Json
$channel = @{ Hypervisor = $config.hypervisor }
$job = [guid]$config.jobId
$key = [Security.Cryptography.RSACng]::new(2048)
$credential = $null
try {
    $public = Export-MvlServerCredentialKey $key
    $advertisement = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("$job|${public}"))
    $deadline = [DateTime]::UtcNow.AddMinutes(20)
    do {
        if (Invoke-MvlServerChannel @channel -Operation set -Field PublicKey -Value $advertisement) {
            $packet = Invoke-MvlServerChannel @channel -Operation get -Field Credential
            if ($packet) {
                try { $credential = Unprotect-MvlServerCredential -JobId $job -Key $key -Packet $packet }
                catch [Security.Cryptography.CryptographicException] { }
                if ($credential) { break }
            }
        }
        Start-Sleep -Seconds 3
    } while ([DateTime]::UtcNow -lt $deadline)
    if (-not $credential) { throw 'Timed out waiting for the protected DSRM credential.' }
    & (Join-Path $PSScriptRoot 'ServerProvision.ps1') -RecoveryPassword $credential
} finally {
    $key.Dispose()
    if ($credential) { $credential.Dispose() }
}
