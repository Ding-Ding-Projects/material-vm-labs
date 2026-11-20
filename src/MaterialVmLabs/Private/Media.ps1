Set-StrictMode -Version 2.0

# Official Windows 11 evaluation media from the Microsoft Evaluation Center.
# Microsoft does not publish SHA-256 values for evaluation ISOs, so verification is:
#   1. the redirect chain ends on an HTTPS host under microsoft.com,
#   2. the byte count equals the Content-Length Microsoft served,
#   3. setup.exe and sources\setup.exe inside the image carry a valid Microsoft
#      Authenticode signature, and the image holds sources\install.wim or install.esd,
#   4. the SHA-256 of the verified ISO is recorded, and every later use re-checks it.

$script:MvlMediaCatalog = @{
    'en-us' = 'https://go.microsoft.com/fwlink/?LinkId=2382600&clcid=0x409&culture=en-us&country=us'
    'en-gb' = 'https://go.microsoft.com/fwlink/?LinkId=2382700&clcid=0x409&culture=en-us&country=us'
}

function Resolve-MvlMediaUrl {
    param([Parameter(Mandatory)][string]$Url)
    $current = $Url
    for ($i = 0; $i -lt 6; $i++) {
        $req = [System.Net.HttpWebRequest]::Create($current)
        $req.Method = 'HEAD'
        $req.AllowAutoRedirect = $false
        $resp = $null
        try { $resp = $req.GetResponse() } catch [System.Net.WebException] { $resp = $_.Exception.Response }
        if (-not $resp) { throw "No response from $current" }
        try {
            $code = [int]$resp.StatusCode
            if ($code -ge 300 -and $code -lt 400) { $current = $resp.Headers['Location']; continue }
            return [pscustomobject]@{ Url = $current; Length = [int64]$resp.ContentLength; Status = $code }
        } finally { $resp.Close() }
    }
    throw "Too many redirects resolving $Url"
}

function Test-MvlMicrosoftHost {
    param([Parameter(Mandatory)][string]$Url)
    $u = [Uri]$Url
    return ($u.Scheme -eq 'https' -and ($u.Host -eq 'microsoft.com' -or $u.Host.EndsWith('.microsoft.com')))
}

function Test-MvlMediaContents {
    param([Parameter(Mandatory)][string]$IsoPath, [switch]$Server)
    $existing = Get-DiskImage -ImagePath $IsoPath -ErrorAction Stop
    $ownsMount = -not $existing.Attached
    $mounted = if ($ownsMount) { Mount-DiskImage -ImagePath $IsoPath -PassThru -Access ReadOnly -StorageType ISO -ErrorAction Stop } else { $existing }
    try {
        $letter = ($mounted | Get-Volume).DriveLetter
        if (-not $letter) { Start-Sleep -Seconds 2; $letter = (Get-DiskImage -ImagePath $IsoPath | Get-Volume).DriveLetter }
        if (-not $letter) { throw 'The mounted installation ISO has no readable drive letter.' }
        $root = "${letter}:\"
        $checks = @()
        foreach ($rel in @('setup.exe', 'sources\setup.exe')) {
            $f = Join-Path $root $rel
            if (-not (Test-Path -LiteralPath $f)) { throw "Media is missing $rel" }
            $sig = Get-AuthenticodeSignature -LiteralPath $f
            $subject = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { '' }
            $ok = ($sig.Status -eq 'Valid' -and $subject -match 'O=Microsoft Corporation')
            $checks += [pscustomobject]@{ file = $rel; status = "$($sig.Status)"; signer = $subject; ok = $ok }
            if (-not $ok) { throw "Authenticode check failed for ${rel}: $($sig.Status) $subject" }
        }
        $image = @('sources\install.wim', 'sources\install.esd') | Where-Object { Test-Path -LiteralPath (Join-Path $root $_) } | Select-Object -First 1
        if (-not $image) { throw 'Media holds no sources\install.wim or install.esd.' }
        $editions = @()
        if ($Server) {
            $imagePath = Join-Path $root $image
            $editions = @(foreach ($entry in (Get-WindowsImage -ImagePath $imagePath -ErrorAction Stop)) {
                $detail = Get-WindowsImage -ImagePath $imagePath -Index $entry.ImageIndex -ErrorAction Stop
                ConvertTo-MvlServerMediaEdition $detail
            })
            if (-not $editions.Count) { throw 'No supported Server 2025 x64 edition was found on the ISO.' }
        } else { try {
            $editions = @(Get-WindowsImage -ImagePath (Join-Path $root $image) -ErrorAction Stop | ForEach-Object { [pscustomobject]@{ index = $_.ImageIndex; name = $_.ImageName } })
        } catch {
            # Listing editions needs elevation; index 1 is used when it cannot be read.
            $editions = @([pscustomobject]@{ index = 1; name = 'unread (listing editions needs elevation)' })
        } }
        return [pscustomobject]@{ signatures = $checks; image = $image; editions = $editions }
    } finally {
        if ($ownsMount) { Dismount-DiskImage -ImagePath $IsoPath | Out-Null }
    }
}

function ConvertTo-MvlServerMediaEdition {
    param([Parameter(Mandatory)]$Image)
    if ($Image.Architecture -notin @('9', 'x64', 'amd64') -or ([version]$Image.Version).Build -ne 26100 -or
        $Image.EditionId -notmatch '\AServer(?:Standard|Datacenter)(?:Eval)?\z' -or
        $Image.InstallationType -notin @('Server', 'Server Core')) { return }
    [pscustomobject]@{
        index = [int]$Image.ImageIndex
        name = [string]$Image.ImageName
        edition = [string]$Image.EditionId
        installation = if ($Image.InstallationType -eq 'Server Core') { 'Server Core' } else { 'Desktop Experience' }
    }
}

function Get-MvlServerMedia {
    param([Parameter(Mandatory)][string]$IsoPath)
    $file = Get-Item -LiteralPath $IsoPath -ErrorAction Stop
    if ($file.PSIsContainer -or $file.Extension -ine '.iso') { throw 'Choose a Server 2025 installation ISO.' }
    # Keep the image stable while its signatures, edition inventory and digest are read.
    $lock = [IO.File]::Open($file.FullName, 'Open', 'Read', 'Read')
    try {
        $contents = Test-MvlMediaContents -IsoPath $file.FullName -Server
        [pscustomobject]@{
            path = $file.FullName
            sha256 = (Get-FileHash -InputStream $lock -Algorithm SHA256).Hash.ToLowerInvariant()
            editions = $contents.editions
        }
    } finally { $lock.Dispose() }
}

function Get-MvlMedia {
    <#
      Ensures a verified ISO is present under <home>\media. Reuses a verified file when its
      recorded SHA-256 still matches; otherwise downloads from Microsoft and verifies.
    #>
    param([string]$Language = 'en-us', [switch]$Force)
    if (-not $script:MvlMediaCatalog.ContainsKey($Language)) { throw "Unsupported media language '$Language'." }
    $mediaDir = Join-Path (Get-MvlHome) 'media'
    $receiptPath = Join-Path $mediaDir "media-$Language.json"
    if ((Test-Path -LiteralPath $receiptPath) -and -not $Force) {
        $rec = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
        if (Test-Path -LiteralPath $rec.path) {
            Write-MvlPhase "Re-checking recorded SHA-256 of $([IO.Path]::GetFileName($rec.path))"
            if ((Get-MvlFileSha256 $rec.path) -eq $rec.sha256) { Write-MvlPhase 'Media SHA-256 matches the verified record.' ok; return $rec }
            Write-MvlPhase 'Recorded media hash no longer matches; verifying again.' warn
        }
    }

    $resolved = Resolve-MvlMediaUrl $script:MvlMediaCatalog[$Language]
    if (-not (Test-MvlMicrosoftHost $resolved.Url)) { throw "Media link resolved outside Microsoft: $($resolved.Url)" }
    $fileName = [IO.Path]::GetFileName(([Uri]$resolved.Url).AbsolutePath)
    $isoPath = Join-Path $mediaDir $fileName
    $existing = if (Test-Path -LiteralPath $isoPath) { (Get-Item -LiteralPath $isoPath).Length } else { 0 }
    if ($existing -ne $resolved.Length) {
        Write-MvlPhase "Downloading $fileName ($([math]::Round($resolved.Length / 1GB, 2)) GB) from $(([Uri]$resolved.Url).Host)"
        $curl = Join-Path $env:SystemRoot 'System32\curl.exe'
        Invoke-MvlNative -FilePath $curl -ArgumentList @('-fL', '--retry', '5', '-C', '-', '-o', $isoPath, $resolved.Url) -Display 'curl' | Out-Null
    } else {
        Write-MvlPhase "Reusing downloaded $fileName (length matches Microsoft's Content-Length)." ok
    }
    $len = (Get-Item -LiteralPath $isoPath).Length
    if ($len -ne $resolved.Length) { throw "Downloaded length $len differs from Microsoft's $($resolved.Length)." }

    Write-MvlPhase 'Verifying Microsoft Authenticode signatures inside the image.'
    $contents = Test-MvlMediaContents $isoPath
    Write-MvlPhase 'Computing SHA-256 of the verified image.'
    $sha = Get-MvlFileSha256 $isoPath
    $rec = [pscustomobject]@{
        language        = $Language
        source          = $script:MvlMediaCatalog[$Language]
        resolvedUrl     = $resolved.Url
        host            = ([Uri]$resolved.Url).Host
        length          = $len
        sha256          = $sha
        path            = $isoPath
        build           = ($fileName -split '\.')[0..1] -join '.'
        signatures      = $contents.signatures
        image           = $contents.image
        editions        = $contents.editions
        microsoftPublishesHash = $false
        verifiedAtUtc   = (Get-Date).ToUniversalTime().ToString('o')
    }
    $rec | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $receiptPath -Encoding UTF8
    Write-MvlPhase "Media verified: $fileName sha256 $sha" ok
    return $rec
}
