Set-StrictMode -Version 2.0

function Assert-MvlServerForestNames {
    param(
        [Parameter(Mandatory)][string]$ComputerName,
        [Parameter(Mandatory)][string]$DomainName,
        [Parameter(Mandatory)][string]$NetbiosName
    )
    $label = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
    if ($DomainName.Length -gt 253 -or $DomainName -notmatch "\A$label(?:\.$label)+\z" -or
        ($DomainName.Split('.')[-1] -notmatch '[a-z]')) {
        throw 'Enter a multi-label forest DNS name, such as ad.example.test.'
    }
    foreach ($name in @($ComputerName, $NetbiosName)) {
        if ($name -notmatch '\A[a-z0-9](?:[a-z0-9-]{0,13}[a-z0-9])?\z' -or $name -notmatch '[a-z]') {
            throw 'Computer and NetBIOS names must contain 1 to 15 ASCII letters, digits or interior hyphens and at least one letter.'
        }
    }
    if ($ComputerName -eq $NetbiosName) {
        throw 'The computer and NetBIOS domain names must differ.'
    }
}

function Install-MvlServerForest {
    param(
        [Parameter(Mandatory)][string]$ComputerName,
        [Parameter(Mandatory)][string]$DomainName,
        [Parameter(Mandatory)][string]$NetbiosName,
        [Parameter(Mandatory)][securestring]$RecoveryPassword
    )
    Assert-MvlServerForestNames -ComputerName $ComputerName -DomainName $DomainName -NetbiosName $NetbiosName
    $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
    $computer = Get-CimInstance Win32_ComputerSystem -ErrorAction Stop
    if ($os.ProductType -ne 3 -or $os.BuildNumber -ne '26100' -or $computer.PartOfDomain -or
        $computer.Name -ne $ComputerName) {
        throw 'Promotion requires the expected standalone Server 2025 guest.'
    }
    if ($RecoveryPassword.Length -lt 15) {
        throw 'Use a Directory Services Restore Mode password of at least 15 characters.'
    }

    $role = Install-WindowsFeature -Name AD-Domain-Services -IncludeManagementTools -ErrorAction Stop
    if (-not $role.Success -or $role.RestartNeeded -ne 'No') {
        throw 'AD DS role setup did not finish without a pending restart. Inspect the guest before resuming.'
    }
    $forest = @{
        DomainName = $DomainName
        DomainNetbiosName = $NetbiosName
        SafeModeAdministratorPassword = $RecoveryPassword
        InstallDns = $true
        CreateDnsDelegation = $false
    }
    Test-ADDSForestInstallation @forest -ErrorAction Stop
    Install-ADDSForest @forest -NoRebootOnCompletion -Force -ErrorAction Stop
}

function Confirm-MvlServerForest {
    param(
        [Parameter(Mandatory)][string]$ComputerName,
        [Parameter(Mandatory)][string]$DomainName,
        [Parameter(Mandatory)][string]$NetbiosName
    )
    Assert-MvlServerForestNames @PSBoundParameters
    $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
    if ($os.ProductType -ne 2 -or $os.BuildNumber -ne '26100') {
        throw 'The guest has not booted as a Server 2025 domain controller.'
    }

    $domain = Get-ADDomain -Server localhost -ErrorAction Stop
    $forest = Get-ADForest -Server localhost -ErrorAction Stop
    if ($domain.DNSRoot -ne $DomainName -or $domain.NetBIOSName -ne $NetbiosName -or $forest.RootDomain -ne $DomainName -or
        $domain.PDCEmulator -ne "$ComputerName.$DomainName") {
        throw 'The local forest or domain controller identity differs from the request.'
    }

    $dnsName = "_ldap._tcp.dc._msdcs.$DomainName"
    $records = @(Resolve-DnsName -Name $dnsName -Type SRV -Server 127.0.0.1 -DnsOnly -ErrorAction Stop |
        Where-Object { $_.Type -eq 'SRV' -and $_.NameTarget.TrimEnd('.') -eq "$ComputerName.$DomainName" -and $_.Port -eq 389 })
    if (-not $records.Count) { throw 'Local DNS has no matching domain controller SRV record.' }
    $shares = @((Get-SmbShare -Name SYSVOL, NETLOGON -ErrorAction Stop).Name)
    if ('SYSVOL' -notin $shares -or 'NETLOGON' -notin $shares) {
        throw 'SYSVOL or NETLOGON is not shared yet.'
    }
    [pscustomobject]@{
        domain = $domain.DNSRoot
        netbios = $domain.NetBIOSName
        domainController = $domain.PDCEmulator
        srvRecord = $dnsName
        shares = $shares
        verifiedAtUtc = [DateTime]::UtcNow.ToString('o')
    }
}
