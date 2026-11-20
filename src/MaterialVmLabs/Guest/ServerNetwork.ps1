Set-StrictMode -Version 2.0

function Assert-MvlServerAddress {
    param([Parameter(Mandatory)][string]$Address, [ValidateRange(16, 30)][int]$PrefixLength)
    $ip = $null
    if (-not [Net.IPAddress]::TryParse($Address, [ref]$ip) -or $ip.AddressFamily -ne 'InterNetwork' -or
        $ip.ToString() -cne $Address) { throw 'Enter a dotted-decimal private IPv4 address.' }
    $octets = $ip.GetAddressBytes()
    if ($octets[0] -ne 10 -and -not ($octets[0] -eq 172 -and $octets[1] -in (16..31)) -and
        -not ($octets[0] -eq 192 -and $octets[1] -eq 168)) { throw 'The guest IPv4 address must be private.' }
    $hostMask = (1L -shl (32 - $PrefixLength)) - 1
    $hostBits = ([int64]$octets[2] * 256 + $octets[3]) -band $hostMask
    if ($hostBits -eq 0 -or $hostBits -eq $hostMask) { throw 'Choose a usable host address in the lab subnet.' }
}

function Set-MvlServerNetwork {
    param(
        [Parameter(Mandatory)][string]$Address,
        [Parameter(Mandatory)][ValidateRange(16, 30)][int]$PrefixLength,
        [Parameter(Mandatory)][ValidatePattern('\A[0-9a-fA-F]{12}\z')][string]$MacAddress
    )
    Assert-MvlServerAddress -Address $Address -PrefixLength $PrefixLength
    $adapters = @(Get-NetAdapter -Physical -ErrorAction Stop)
    if ($adapters.Count -ne 1 -or ($adapters[0].MacAddress -replace '[:-]', '') -ne $MacAddress) {
        throw 'The guest must have only the lab adapter recorded by the provisioner.'
    }
    $index = $adapters[0].InterfaceIndex
    Set-NetIPInterface -InterfaceIndex $index -AddressFamily IPv4 -Dhcp Disabled -ErrorAction Stop
    Get-NetRoute -InterfaceIndex $index -DestinationPrefix '0.0.0.0/0', '::/0' -ErrorAction SilentlyContinue |
        Remove-NetRoute -Confirm:$false -ErrorAction Stop
    $current = @(Get-NetIPAddress -InterfaceIndex $index -AddressFamily IPv4 -ErrorAction SilentlyContinue)
    $current | Where-Object { $_.IPAddress -ne $Address -or $_.PrefixLength -ne $PrefixLength } |
        Remove-NetIPAddress -Confirm:$false -ErrorAction Stop
    if (-not ($current | Where-Object { $_.IPAddress -eq $Address -and $_.PrefixLength -eq $PrefixLength })) {
        New-NetIPAddress -InterfaceIndex $index -IPAddress $Address -PrefixLength $PrefixLength -ErrorAction Stop | Out-Null
    }
    Set-DnsClientServerAddress -InterfaceIndex $index -ServerAddresses '127.0.0.1' -ErrorAction Stop
}
