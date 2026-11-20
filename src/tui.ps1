# Lab machine TUI: a dense keyboard manager over the same module the CLI uses.
# Arrow keys pick a lab machine; letters run actions; every action shows its real result.
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'MaterialVmLabs\MaterialVmLabs.psm1') -Force -DisableNameChecking
$sel = 0
$msg = 'Ready. Press ? for keys.'

function Draw($rows) {
    Clear-Host
    Write-Host ' lab machine manager' -ForegroundColor Cyan -NoNewline
    Write-Host ("   state root: {0}" -f (Get-MvlHome)) -ForegroundColor DarkGray
    Write-Host (' {0,-3}{1,-18}{2,-16}{3,-11}{4,-9}{5,-9}{6,-14}' -f '', 'Name', 'Project', 'Hypervisor', 'Status', 'Power', 'self-hosted runners') -ForegroundColor DarkCyan
    if (-not $rows.Count) { Write-Host '   (no lab machines yet; press n to create one)' -ForegroundColor DarkGray }
    for ($i = 0; $i -lt $rows.Count; $i++) {
        $r = $rows[$i]
        $mark = if ($i -eq $script:sel) { '>' } else { ' ' }
        $color = switch ($r.Status) { 'ready' { 'Green' } 'failed' { 'Red' } default { 'Yellow' } }
        Write-Host (' {0,-3}{1,-18}{2,-16}{3,-11}{4,-9}{5,-9}{6,-14}' -f $mark, $r.Name, $r.Project, $r.Hypervisor, $r.Status, $r.Power, $r.Runners) -ForegroundColor $color
    }
    Write-Host ''
    Write-Host ' n new  u up  s start  t stop  r reset  b fresh build  d remote desktop  i ip  w network' -ForegroundColor DarkGray
    Write-Host ' g self-hosted runner  h screenshot  x scrap  l refresh  ? keys  q quit' -ForegroundColor DarkGray
    Write-Host " $script:msg"
}

function Ask([string]$prompt, [string]$default = '') {
    $v = Read-Host " $prompt$(if ($default) { " [$default]" })"
    if (-not $v) { return $default } else { return $v }
}

while ($true) {
    $rows = @(Get-MvlMachine)
    if ($sel -ge $rows.Count) { $sel = [Math]::Max(0, $rows.Count - 1) }
    Draw $rows
    $k = [Console]::ReadKey($true)
    $cur = if ($rows.Count) { $rows[$sel].Name } else { $null }
    try {
        switch ($k.Key) {
            'UpArrow' { if ($sel -gt 0) { $sel-- } }
            'DownArrow' { if ($sel -lt $rows.Count - 1) { $sel++ } }
            'Q' { return }
            'L' { $msg = 'Refreshed.' }
            'Oem2' { $msg = 'Up/Down pick; n new, u up, s/t start/stop, r reset, b fresh build, d Remote Desktop, i IP, w network, g self-hosted runner, h screenshot, x scrap.' }
            'N' {
                $n = Ask 'Name (lowercase, digits, hyphens)'
                $p = Ask 'Project' 'general'
                $h = Ask 'Hypervisor auto|vmware|virtualbox' 'auto'
                Write-Host ' Creating; Windows installs unattended (about 30 to 60 minutes).'
                New-MvlMachine -Name $n -Project $p -Hypervisor $h -For you | Out-Null
                $msg = "Created '$n'."
            }
            'U' { if ($cur) { Reset-MvlMachine $cur; Start-MvlMachine $cur; $msg = "'$cur' reset and running." } }
            'S' { if ($cur) { Start-MvlMachine $cur; $msg = "'$cur' running." } }
            'T' { if ($cur) { Stop-MvlMachine $cur; $msg = "'$cur' stopped." } }
            'R' { if ($cur) { Reset-MvlMachine $cur; $msg = "'$cur' back at its clean baseline." } }
            'B' {
                if ($cur) {
                    $repo = Ask 'repository (owner/name)'
                    $entry = Ask 'Entrypoints' 'build'
                    $r = Invoke-MvlBuild -Name $cur -Repo $repo -Entrypoints $entry
                    $msg = "Build $($r.verdict) for $repo@$($r.commit.Substring(0,8)) in $($r.hostMinutes) min; receipt in runs\$($r.runId)."
                }
            }
            'G' {
                if ($cur) {
                    $repo = Ask 'Private repository (owner/name)'
                    $tok = Read-Host ' Registration token (hidden)' -AsSecureString
                    $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($tok)
                    try { Register-MvlRunner -Name $cur -Repo $repo -Token ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)) }
                    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
                    $msg = "self-hosted runner registered for $repo."
                }
            }
            'H' {
                if ($cur) {
                    $p = Join-Path ([Environment]::GetFolderPath('MyPictures')) "$cur-$(Get-Date -Format yyyyMMdd-HHmmss).png"
                    if (Invoke-MvlBackend (Get-MvlState $cur) Screenshot @{ Path = $p }) { $msg = "screenshot saved: $p" } else { $msg = 'screenshot failed (is it running?).' }
                }
            }
            'D' { if ($cur) { $r = Open-MvlRdp -Name $cur; $msg = "Remote Desktop opened for '$cur' at $($r.ip) as $($r.user)." } }
            'I' { if ($cur) { $ip = Get-MvlIp -Name $cur; $msg = $(if ($ip) { "'$cur' is at $ip" } else { "'$cur' has no IP (is it running?)" }) } }
            'W' {
                if ($cur) {
                    $m = Ask 'Network nat|bridged|hostonly' 'nat'
                    Set-MvlNetwork -Name $cur -Mode $m
                    $msg = "'$cur' network is $m (bridged falls back to NAT if it gets no address)."
                }
            }
            'X' {
                if ($cur) {
                    $c = Ask "Type the name '$cur' to scrap it"
                    if ($c -eq $cur) { Remove-MvlMachine $cur; $msg = "'$cur' destroyed." } else { $msg = 'Destroy cancelled.' }
                }
            }
        }
    } catch { $msg = "problem: $($_.Exception.Message)" }
}
