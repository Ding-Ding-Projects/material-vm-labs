# Offline test harness suite for the lab machine tooling. Each guard test prints PASS, FAIL or SKIP.
# Exit 0 only when nothing failed.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $root 'src\MaterialVmLabs\MaterialVmLabs.psm1') -Force -DisableNameChecking
$mod = Get-Module MaterialVmLabs
$script:fail = 0; $script:pass = 0; $script:skip = 0
function Check([string]$name, [scriptblock]$body) {
    try {
        $r = @(& $body)
        $last = if ($r.Count) { $r[-1] } else { $null }
        if ($last -is [string] -and $last -eq 'skip') { $script:skip++; Write-Host "SKIP $name" }
        elseif ($last -is [bool] -and $last) { $script:pass++; Write-Host "PASS $name" }
        else { $script:fail++; Write-Host "FAIL $name" }
    } catch { $script:fail++; Write-Host "FAIL $name : $($_.Exception.Message)" }
}

Check 'answer file fills every placeholder and parses as XML' {
    $x = New-MvlAutounattend -ComputerName 'MVL-T' -UserName 'mvlbuilder' -Password 'Dc9!sample'
    ($x -notmatch '\{\{[A-Z_]+\}\}') -and (([xml]$x).unattend.settings.Count -eq 3)
}
Check 'the setup requirement waiver appears only when asked' {
    $with = New-MvlAutounattend -ComputerName 'MVL-T' -UserName 'mvlbuilder' -Password 'Dc9!sample' -WaiveTpmRequirement
    $without = New-MvlAutounattend -ComputerName 'MVL-T' -UserName 'mvlbuilder' -Password 'Dc9!sample'
    ($with -match 'BypassTPMCheck') -and ($without -notmatch 'LabConfig')
}
Check 'the generated password never appears in plain text in the answer file' {
    $pw = 'Dc9!UniqueMarker42'
    $x = New-MvlAutounattend -ComputerName 'MVL-T' -UserName 'mvlbuilder' -Password $pw
    $decoded = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String(([xml]$x).unattend.settings[2].component[1].UserAccounts.LocalAccounts.LocalAccount.Password.Value))
    ($x -notmatch [regex]::Escape($pw)) -and ($decoded -eq ($pw + 'Password'))
}
Check 'the tracked template carries no secrets value' {
    $t = Get-Content -LiteralPath (Join-Path $root 'src\MaterialVmLabs\Templates\autounattend.template.xml') -Raw -Encoding UTF8
    $values = [regex]::Matches($t, '<Value>([^<]*)</Value>') | ForEach-Object { $_.Groups[1].Value }
    -not ($values | Where-Object { $_ -notmatch '^\{\{[A-Z_]+\}\}$' -and $_ -notmatch '^\d+$' })
}
Check 'names are validated' {
    $ok = $true
    foreach ($bad in @('A', 'Bad Name', '../x', 'x' * 40)) { try { & $mod { param($n) Test-MvlName $n } $bad; $ok = $false } catch { } }
    & $mod { Test-MvlName 'proof-1' }
    $ok
}
Check 'generated guest passwords are long and unique' {
    $a = & $mod { New-MvlPassword }; $b = & $mod { New-MvlPassword }
    ($a.Length -ge 24) -and ($a -ne $b) -and ($a -cmatch '[A-Z]') -and ($a -cmatch '[a-z]') -and ($a -match '\d')
}
Check 'argument quoting survives spaces and quotes' {
    $q = & $mod { ConvertTo-MvlArgument 'C:\Program Files\a "b"' }
    $q -eq '"C:\Program Files\a \"b\""'
}
Check 'seed image builds and carries its files' {
    if (-not (Get-Command Mount-DiskImage -ErrorAction SilentlyContinue)) { return 'skip' }
    $t = Join-Path ([IO.Path]::GetTempPath()) ("mvl-test-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path (Join-Path $t 'src\mvl') -Force | Out-Null
    'probe' | Set-Content -LiteralPath (Join-Path $t 'src\mvl\probe.txt')
    $iso = New-MvlSeedIso -SourceDir (Join-Path $t 'src') -IsoPath (Join-Path $t 'seed.iso')
    try {
        Mount-DiskImage -ImagePath $iso.FullName | Out-Null
        Start-Sleep -Seconds 1
        $letter = (Get-DiskImage -ImagePath $iso.FullName | Get-Volume).DriveLetter
        Test-Path -LiteralPath "${letter}:\mvl\probe.txt"
    } finally { Dismount-DiskImage -ImagePath $iso.FullName | Out-Null; Remove-Item -LiteralPath $t -Recurse -Force }
}
Check 'a self-hosted runner for a public repository is refused' {
    if (-not (Get-Command gh.exe -ErrorAction SilentlyContinue)) { return 'skip' }
    try { & $mod { Assert-MvlPrivateRepo 'actions/runner' }; $false } catch { $_.Exception.Message -match 'Refused' }
}
Check 'the CLI answers bad usage with exit 2' {
    & (Join-Path $PSHOME 'powershell.exe') -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'src\mvl.ps1') nonsense-command | Out-Null
    $LASTEXITCODE -eq 2
}
Check 'Microsoft-host check accepts only HTTPS microsoft.com hosts' {
    (& $mod { Test-MvlMicrosoftHost 'https://software-static.download.prss.microsoft.com/x.iso' }) -and
    -not (& $mod { Test-MvlMicrosoftHost 'https://evilmicrosoft.com/x.iso' }) -and
    -not (& $mod { Test-MvlMicrosoftHost 'http://www.microsoft.com/x.iso' })
}
Check 'a lab machine set up for Claude stays bare unless asked' {
    $a = & $mod { Resolve-MvlOwnerOptions -For agent }
    $y = & $mod { Resolve-MvlOwnerOptions -For you }
    $yn = & $mod { Resolve-MvlOwnerOptions -For you -NoShare -NoTools }
    $at = & $mod { Resolve-MvlOwnerOptions -For agent -Tools }
    (-not $a.tools) -and (-not $a.share) -and (-not $a.setup) -and $y.tools -and $y.share -and $y.setup -and
        (-not $yn.tools) -and (-not $yn.share) -and $yn.setup -and $at.tools -and (-not $at.share) -and (-not $at.setup)
}
Check 'the shared folder lives under the state root and matches each hypervisor' {
    $old = $env:MVL_HOME
    $env:MVL_HOME = Join-Path ([IO.Path]::GetTempPath()) ("mvl-share-" + [guid]::NewGuid().ToString('N'))
    try {
        $v = & $mod { New-MvlSharedFolder -State ([pscustomobject]@{ name = 'probe-1'; hypervisor = 'vmware' }) }
        $b = & $mod { New-MvlSharedFolder -State ([pscustomobject]@{ name = 'probe-2'; hypervisor = 'virtualbox' }) }
        ($v.guestPath -eq '\\vmware-host\Shared Folders\probe-1') -and ($b.guestPath -eq '\\VBOXSVR\probe-2') -and
            (Test-Path -LiteralPath $v.hostPath) -and $v.hostPath.StartsWith($env:MVL_HOME)
    } finally { Remove-Item -LiteralPath $env:MVL_HOME -Recurse -Force -ErrorAction SilentlyContinue; $env:MVL_HOME = $old }
}
Check 'a Windows-only command refuses a Linux lab machine' {
    $lin = [pscustomobject]@{ name = 'u1'; os = 'ubuntu'; osLabel = 'Ubuntu 24.04 LTS' }
    $win = [pscustomobject]@{ name = 'w1'; os = 'windows' }
    $old = [pscustomobject]@{ name = 'w0' }
    $refused = try { Assert-MvlWindowsGuest -State $lin -What 'mvl build'; $false } catch { $_.Exception.Message -match 'mvl ssh' }
    Assert-MvlWindowsGuest -State $win; Assert-MvlWindowsGuest -State $old
    $refused
}
Check 'the guest scripts never read or write sign-in credentials' {
    $g = Get-Content -Raw -LiteralPath (Join-Path $root 'src\MaterialVmLabs\Guest\guest-tools.ps1')
    -not ($g -match 'auth\.json|hosts\.yml|GH_TOKEN|OPENAI_API_KEY|--with-token|--with-api-key|password')
}

Check 'every guest script that calls VBoxControl also looks in System32, where Guest Additions 7.x install it' {
    # Seen 2026-11-24 with Guest Additions 7.2.22: only the System32 copy exists, so a Program Files-only
    # path never signalled readiness and VirtualBox machine creation waited for its full timeout.
    $bad = Get-ChildItem -LiteralPath (Join-Path $root 'src\MaterialVmLabs\Guest') -Filter '*.ps1' | Where-Object {
        $t = Get-Content -Raw -LiteralPath $_.FullName
        $t -match 'VBoxControl\.exe' -and $t -notmatch "System32\\VBoxControl\.exe"
    }
    if ($bad) { Write-Host ('  Program Files only: ' + (($bad | ForEach-Object Name) -join ', ')) }
    -not $bad
}

Check 'every PowerShell script carries a UTF-8 BOM so Windows PowerShell 5.1 reads it correctly' {
    $missing = Get-ChildItem -LiteralPath $root -Recurse -Filter '*.ps1' | Where-Object { $_.FullName -notmatch '\\(node_modules|dist|out)\\' } | Where-Object {
        $b = [IO.File]::ReadAllBytes($_.FullName)
        -not ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF)
    }
    if ($missing) { Write-Host ('  missing BOM: ' + (($missing | ForEach-Object Name) -join ', ')) }
    -not $missing
}

Write-Host ("{0} passed, {1} failed, {2} skipped" -f $script:pass, $script:fail, $script:skip)
if ($script:fail) { exit 1 }
exit 0
