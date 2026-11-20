Set-StrictMode -Version 2.0

function New-MvlServerMachine {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$ComputerName,
        [Parameter(Mandatory)][string]$IsoPath,
        [Parameter(Mandatory)][ValidatePattern('\A[0-9a-fA-F]{64}\z')][string]$MediaSha256,
        [Parameter(Mandatory)][ValidateRange(1, 65535)][int]$ImageIndex,
        [Parameter(Mandatory)][string]$DomainName,
        [Parameter(Mandatory)][string]$NetbiosName,
        [Parameter(Mandatory)][string]$Address,
        [Parameter(Mandatory)][ValidateRange(16, 30)][int]$PrefixLength,
        [ValidateSet('auto', 'vmware', 'virtualbox')][string]$Hypervisor = 'auto'
    )

    $dir = Get-MvlVmDir $Name
    if (Test-Path -LiteralPath $dir) { throw "A machine folder already exists for '$Name'." }
    $answer = New-MvlServerAutounattend -ComputerName $ComputerName -ImageIndex $ImageIndex -StageServerScripts
    . (Join-Path $script:MvlModuleRoot 'Guest\ServerForest.ps1')
    . (Join-Path $script:MvlModuleRoot 'Guest\ServerNetwork.ps1')
    Assert-MvlServerForestNames -ComputerName $ComputerName -DomainName $DomainName -NetbiosName $NetbiosName
    Assert-MvlServerAddress -Address $Address -PrefixLength $PrefixLength
    $hv = Get-MvlHypervisor -Prefer $Hypervisor
    $job = [guid]::NewGuid()
    $random = $job.ToByteArray()
    $mac = if ($hv.Kind -eq 'vmware') { '005056{0:X2}{1:X2}{2:X2}' -f ($random[0] -band 63), $random[1], $random[2] }
    else { '080027{0:X2}{1:X2}{2:X2}' -f $random[0], $random[1], $random[2] }
    $iso = (Get-Item -LiteralPath $IsoPath -ErrorAction Stop).FullName
    $mediaLock = [IO.File]::Open($iso, 'Open', 'Read', 'Read')
    try {
        $media = Get-MvlServerMedia -IsoPath $iso
        if ($media.sha256 -ne $MediaSha256) { throw 'The Server ISO changed after inspection. Select it again.' }
        $edition = $media.editions | Where-Object { $_.index -eq $ImageIndex } | Select-Object -First 1
        if (-not $edition) { throw 'The selected image index does not identify a supported Server 2025 edition.' }

        if ($hv.Kind -eq 'virtualbox') {
            $registered = Invoke-MvlVbox @('list', 'vms')
            $displayName = [regex]::Escape("mvl-$Name")
            if ($registered.StdOut -match "(?m)^`"$displayName`"\s+\{") { throw "A VirtualBox guest named 'mvl-$Name' is already registered." }
        }

        # Creating the directory without -Force claims the name before writing any seed or disk.
        New-Item -ItemType Directory -Path $dir -ErrorAction Stop | Out-Null
        $state = [pscustomobject]@{
            schema = 1
            profile = 'server-forest'
            jobId = $job.ToString()
            macAddress = $mac
            name = $Name
            computerName = $ComputerName
            project = 'ad-lab'
            hypervisor = $hv.Kind
            hypervisorVersion = $hv.Version
            network = 'hostonly'
            memoryMB = 8192
            cpus = 4
            diskGB = 96
            secureBoot = $true
            userName = 'Administrator'
            defaultPassword = $false
            imageIndex = $ImageIndex
            edition = $edition.edition
            installation = $edition.installation
            mediaFile = [IO.Path]::GetFileName($iso)
            mediaSha256 = $media.sha256
            vmPath = ''
            status = 'creating'
            baseline = $null
            runners = @()
            created = [DateTime]::UtcNow.ToString('o')
            updated = ''
        }
        Save-MvlState $state
        try {
            $seed = New-Item -ItemType Directory -Path (Join-Path $dir 'server-seed') -ErrorAction Stop
            [IO.File]::WriteAllText((Join-Path $seed.FullName 'autounattend.xml'), $answer, [Text.UTF8Encoding]::new($false))
            $guestDir = New-Item -ItemType Directory -Path (Join-Path $seed.FullName 'mvl-server') -ErrorAction Stop
            foreach ($file in @('ServerStage.ps1', 'ServerForest.ps1', 'ServerNetwork.ps1', 'ServerProvision.ps1', 'ServerTools.ps1',
                                'ServerChannel.ps1', 'ServerExchange.ps1', 'ServerCredential.ps1')) {
                $source = Join-Path (Join-Path $script:MvlModuleRoot 'Guest') $file
                Copy-Item -LiteralPath $source -Destination $guestDir.FullName -ErrorAction Stop
            }
            @{
                jobId = $state.jobId; hypervisor = $hv.Kind; computerName = $ComputerName; domainName = $DomainName
                netbiosName = $NetbiosName; address = $Address; prefixLength = $PrefixLength; macAddress = $mac
            } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $guestDir.FullName 'server.json') -Encoding UTF8
            $seedIso = New-MvlSeedIso -SourceDir $seed.FullName -IsoPath (Join-Path $dir 'seed.iso')
            $state.vmPath = if ($hv.Kind -eq 'vmware') {
                New-MvlVmwareVm -State $state -InstallIso $iso -SeedIso $seedIso.FullName
            } else {
                New-MvlVboxVm -State $state -InstallIso $iso -SeedIso $seedIso.FullName
            }
            $state.status = 'awaiting-provisioning'
            Save-MvlState $state
            return $state
        } catch {
            $state.status = 'failed'
            Save-MvlState $state
            throw
        }
    } finally { $mediaLock.Dispose() }
}
