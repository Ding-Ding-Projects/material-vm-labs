# mvl: the fast command line for lab machines. One line per phase, --json for agents.
# Exit codes: 0 done, 1 problem, 2 bad usage.
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Argv)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'MaterialVmLabs\MaterialVmLabs.psm1') -Force -DisableNameChecking

$help = @'
mvl - throwaway Windows 11 lab machines for fresh-host build testing

  mvl hv                          show which hypervisor would be used (VMware first, VirtualBox fallback)
  mvl hv install --approve        install VirtualBox through Chocolatey (native UAC prompt is yours)
  mvl media                       fetch or re-check the official Microsoft evaluation media
  mvl server-media --iso <path>   inspect a Server 2025 ISO and list supported image indexes
  mvl up <name> [--project p]     fastest route: reset+start a ready one, or create it first
  mvl new <name> [options]        create unattended to a clean baseline
        --project p --hv auto|vmware|virtualbox --mem 8192 --cpus 4 --disk 96 --net nat|bridged|hostonly --require-tpm
        --user mvlbuilder  --password-stdin (else the default guest password 1234)  --random-password
        --os windows|ubuntu|debian (Ubuntu 24.04 / Debian 13 with Docker and the Codex CLI; VMware)
        --for you|agent (default: agent with --json, else you)  --tools/--no-tools  --share/--no-share  --no-open (do not open the shared folder here)
        "you": Git, Chocolatey, GitHub CLI, Codex desktop + CLI, the Setup app with the
        official sign-ins at first logon, and a shared folder opened here. "agent": bare, for fresh-host tests.
  mvl ip <name>                   the lab machine's IP address
  mvl ssh <name> [--no-launch]    SSH into a Linux lab machine with its own key
  mvl share <name> [--no-open]    open the folder shared with the guest (kept when the machine is scrapped)
  mvl install <name> --file Setup.exe [--args "--silent"]  run an installer from the clean baseline, receipt + screenshot
  mvl passwd <name>             new guest password on standard input; retakes the clean baseline with it
  mvl rdp <name> [--no-launch]    Remote Desktop with the guest credential saved for that address
  mvl net <name> nat|bridged|hostonly   change network mode (while off); bridged falls back to NAT if no address
  mvl ls                          list every lab machine
  mvl start|stop|reset <name>     power and baseline control (stop --hard to pull the plug)
  mvl rm <name> --yes             destroy: VM files, snapshots, credential, self-hosted runner registrations
  mvl build <name> --repo owner/name [--ref sha] [--entry build,build-installer] [--evidence dir] [--no-reset]
                                  fresh clone, run entrypoints with /s inside, receipt bound to the commit
  mvl runner add <name> --repo owner/name [--labels a,b]   token on standard input; private repositories only
  mvl runner rm <name> --repo owner/name
  mvl shot <name> [file.png]      screenshot of the guest screen
  mvl tui                         interactive manager
  mvl install-cli                 put a mvl shim on PATH (per-user WindowsApps; no PATH edit)

  Global: --json (machine output)  --home <dir> (state root, default %LOCALAPPDATA%\MaterialVmLabs or MVL_HOME)
'@

function Get-Opt([string]$name, $default = $null) {
    $i = [Array]::IndexOf($script:rest, "--$name")
    if ($i -ge 0 -and $i + 1 -lt $script:rest.Count) { return $script:rest[$i + 1] }
    return $default
}
function Has-Flag([string]$name) { return ($script:rest -contains "--$name") }
function Out-Result($obj) {
    if ($script:json) { $obj | ConvertTo-Json -Depth 8 -Compress | Write-Output }
    elseif ($null -ne $obj) { $obj | Format-Table -AutoSize | Out-String -Width 200 | Write-Output }
}

$Argv = @($Argv | Where-Object { $_ -ne $null })
if ($Argv.Count -eq 0 -or $Argv[0] -in @('-h', '--help', 'help')) { Write-Output $help; exit 0 }
$script:json = $Argv -contains '--json'
$script:rest = @($Argv)
$homeOpt = Get-Opt 'home'
if ($homeOpt) { $env:MVL_HOME = $homeOpt }
$cmd = $Argv[0]
$name = if ($Argv.Count -gt 1 -and -not $Argv[1].StartsWith('--')) { $Argv[1] } else { $null }

try {
    # Windows-only commands refuse a Linux lab machine with a clear message.
    $winOnly = @{ install = $name; passwd = $name; rdp = $name; build = $name; runner = $(if ($Argv.Count -gt 2) { $Argv[2] } else { $null }) }
    if ($winOnly.ContainsKey($cmd) -and $winOnly[$cmd] -and (Test-Path -LiteralPath (Join-Path (Join-Path (Join-Path (Get-MvlHome) 'vms') $winOnly[$cmd]) 'vm.json'))) {
        Assert-MvlWindowsGuest -State (Get-MvlState $winOnly[$cmd]) -What "mvl $cmd"
    }
    switch ($cmd) {
        'hv' {
            if ($name -eq 'install') { $h = Install-MvlHypervisor -Approve:(Has-Flag 'approve') }
            else { $h = Get-MvlHypervisor -Prefer (Get-Opt 'hv' 'auto') }
            Out-Result ([pscustomobject]@{ kind = $h.Kind; version = $h.Version; reason = $h.Reason })
        }
        'media' { $m = Get-MvlMedia -Force:(Has-Flag 'force'); Out-Result ([pscustomobject]@{ file = (Split-Path $m.path -Leaf); sha256 = $m.sha256; host = $m.host }) }
        'server-media' {
            $iso = Get-Opt 'iso'
            if (-not $iso -or $iso.StartsWith('--')) { throw 'usage: mvl server-media --iso <path>' }
            Out-Result (Get-MvlServerMedia -IsoPath $iso)
        }
        'new' {
            if (-not $name) { throw 'usage: mvl new <name>' }
            $pw = $null
            if (Has-Flag 'password-stdin') { $pw = [Console]::In.ReadLine(); if (-not $pw) { throw 'No password on standard input.' } }
            $s = New-MvlMachine -Name $name -Project (Get-Opt 'project' 'general') -Hypervisor (Get-Opt 'hv' 'auto') -MemoryMB ([int](Get-Opt 'mem' 8192)) `
                -Cpus ([int](Get-Opt 'cpus' 4)) -DiskGB ([int](Get-Opt 'disk' 96)) -Network (Get-Opt 'net' 'nat') -RequireTpm:(Has-Flag 'require-tpm') `
                -UserName (Get-Opt 'user' 'mvlbuilder') -Password $pw -RandomPassword:(Has-Flag 'random-password') `
                -For $(if (Get-Opt 'for') { Get-Opt 'for' } elseif ($script:json) { 'agent' } else { 'you' }) `
                -Tools:(Has-Flag 'tools') -NoTools:(Has-Flag 'no-tools') -Share:(Has-Flag 'share') -NoShare:(Has-Flag 'no-share') -NoOpenShare:(Has-Flag 'no-open') -Os (Get-Opt 'os' 'windows')
            $pw = $null
            Out-Result ([pscustomobject]@{ name = $s.name; hypervisor = $s.hypervisor; status = $s.status; minutes = $s.provisioning.minutes; owner = $s.owner; tools = $s.tools; sharedFolder = $s.sharedFolder })
        }
        'up' {
            if (-not $name) { throw 'usage: mvl up <name>' }
            $exists = Test-Path -LiteralPath (Join-Path (Join-Path (Join-Path (Get-MvlHome) 'vms') $name) 'vm.json')
            if (-not $exists) { New-MvlMachine -Name $name -Project (Get-Opt 'project' 'general') -Hypervisor (Get-Opt 'hv' 'auto') | Out-Null }
            elseif (-not (Has-Flag 'no-reset') -and @((Get-MvlState $name).runners).Count -eq 0) { Reset-MvlMachine $name }
            Start-MvlMachine $name
            Out-Result (Get-MvlMachine -Name $name)
        }
        'ls' { Out-Result @(Get-MvlMachine) }
        'ip' {
            if (-not $name) { throw 'usage: mvl ip <name>' }
            $ip = Get-MvlIp -Name $name -WaitSeconds ([int](Get-Opt 'wait' 0))
            if (-not $ip) { throw "'$name' has no IP address (is it running?)." }
            if ($script:json) { Out-Result ([pscustomobject]@{ name = $name; ip = $ip }) } else { Write-Output $ip }
        }
        'install' {
            $file = Get-Opt 'file'
            if (-not $name -or -not $file) { throw 'usage: mvl install <name> --file <Setup.exe|.msi> [--args "..."] [--wait 60] [--evidence dir]' }
            $r = Invoke-MvlInstallerTest -Name $name -File $file -Arguments (Get-Opt 'args' '') -WaitSeconds ([int](Get-Opt 'wait' 60)) -EvidenceDir (Get-Opt 'evidence')
            Out-Result ([pscustomobject]@{ verdict = $r.verdict; newFolders = @($r.newFolders).Count; runId = $r.runId })
            if ($r.exitCode -ne 0) { exit 1 }
        }
        'passwd' {
            if (-not $name) { throw 'usage: mvl passwd <name> --password-stdin' }
            $pw = [Console]::In.ReadLine()
            if (-not $pw) { throw 'Pipe the new guest password on standard input.' }
            Set-MvlGuestPassword -Name $name -Password $pw
            $pw = $null
            Out-Result (Get-MvlMachine -Name $name)
        }
        'ssh' { if (-not $name) { throw 'usage: mvl ssh <name> [--no-launch]' }; Out-Result (Open-MvlSsh -Name $name -NoLaunch:(Has-Flag 'no-launch')) }
        'share' { if (-not $name) { throw 'usage: mvl share <name> [--no-open]' }; Out-Result (Open-MvlShare -Name $name -NoOpen:(Has-Flag 'no-open')) }
        'rdp' { if (-not $name) { throw 'usage: mvl rdp <name>' }; Out-Result (Open-MvlRdp -Name $name -NoLaunch:(Has-Flag 'no-launch')) }
        'net' {
            $mode = if ($Argv.Count -gt 2) { $Argv[2] } else { $null }
            if (-not $name -or -not $mode) { throw 'usage: mvl net <name> nat|bridged|hostonly' }
            Set-MvlNetwork -Name $name -Mode $mode
            Out-Result (Get-MvlMachine -Name $name)
        }
        'start' { Start-MvlMachine $name; Out-Result (Get-MvlMachine -Name $name) }
        'stop' { Stop-MvlMachine $name -Hard:(Has-Flag 'hard'); Out-Result (Get-MvlMachine -Name $name) }
        'reset' { Reset-MvlMachine $name; Out-Result (Get-MvlMachine -Name $name) }
        'rm' {
            if (-not (Has-Flag 'yes')) { throw "Destroying '$name' needs --yes." }
            Remove-MvlMachine $name
            Out-Result ([pscustomobject]@{ name = $name; destroyed = $true })
        }
        'build' {
            $repo = Get-Opt 'repo'
            if (-not $name -or -not $repo) { throw 'usage: mvl build <name> --repo owner/name' }
            $r = Invoke-MvlBuild -Name $name -Repo $repo -Ref (Get-Opt 'ref') -Entrypoints (Get-Opt 'entry' 'build') -EvidenceDir (Get-Opt 'evidence') -NoReset:(Has-Flag 'no-reset')
            Out-Result ([pscustomobject]@{ verdict = $r.verdict; commit = $r.commit; runId = $r.runId; minutes = $r.hostMinutes })
            if ($r.verdict -ne 'passed') { exit 1 }
        }
        'runner' {
            $sub = $name
            $vm = if ($Argv.Count -gt 2) { $Argv[2] } else { $null }
            $repo = Get-Opt 'repo'
            if (-not $vm -or -not $repo) { throw 'usage: mvl runner add|rm <name> --repo owner/name' }
            if ($sub -eq 'add') {
                $token = [Console]::In.ReadLine()
                if (-not $token) { throw 'Pipe the registration token on standard input.' }
                $labels = @((Get-Opt 'labels' '') -split ',' | Where-Object { $_ })
                Register-MvlRunner -Name $vm -Repo $repo -Labels $labels -Token $token.Trim()
                $token = $null
            } elseif ($sub -eq 'rm') { Unregister-MvlRunner -Name $vm -Repo $repo }
            else { throw 'usage: mvl runner add|rm <name> --repo owner/name' }
            Out-Result (Get-MvlMachine -Name $vm)
        }
        'shot' {
            $s = Get-MvlState $name
            $p = if ($Argv.Count -gt 2 -and -not $Argv[2].StartsWith('--')) { $Argv[2] } else { Join-Path (Get-Location) "$name.png" }
            if (-not (Invoke-MvlBackend $s Screenshot @{ Path = $p })) { throw 'screenshot capture did not produce a file.' }
            Out-Result ([pscustomobject]@{ screenshot = (Resolve-Path $p).Path })
        }
        'tui' { & (Join-Path $PSScriptRoot 'tui.ps1') }
        'install-cli' {
            # Per-user shim in WindowsApps, which Windows already keeps on PATH; no PATH entry changes.
            $dir = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps'
            $bat = Join-Path (Split-Path -Parent $PSScriptRoot) 'mvl.bat'
            $shim = Join-Path $dir 'mvl.cmd'
            [IO.File]::WriteAllText($shim, "@echo off`r`ncall `"$bat`" %*`r`nexit /b %ERRORLEVEL%`r`n")
            Out-Result ([pscustomobject]@{ shim = $shim; target = $bat })
        }
        default { Write-Output $help; exit 2 }
    }
    exit 0
} catch {
    $msg = $_.Exception.Message
    if ($script:json) { [Console]::Out.WriteLine((@{ ok = $false; error = $msg } | ConvertTo-Json -Compress)) }
    else { [Console]::Error.WriteLine("problem: $msg") }
    if ($msg -like 'usage:*') { exit 2 }
    exit 1
}
