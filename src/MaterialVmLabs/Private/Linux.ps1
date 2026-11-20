Set-StrictMode -Version 2.0

# Linux lab machines: disposable Ubuntu and Debian machines from the
# official cloud images, provisioned unattended by cloud-init with Docker (Docker's official
# install script) and the Codex CLI (npm @openai/codex), then baselined like the Windows ones.
# VMware first; VirtualBox too: there the readiness signal is the guest powering itself off at the
# end of cloud-init, and SSH reaches it through a NAT port forward on 127.0.0.1.

$script:MvlLinuxImages = @{
    ubuntu = @{ Label = 'Ubuntu 24.04 LTS'; File = 'noble-server-cloudimg-amd64.vmdk'; GuestOS = 'ubuntu-64'
        Url = 'https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.vmdk'
        Sums = 'https://cloud-images.ubuntu.com/noble/current/SHA256SUMS'; Algorithm = 'SHA256' }
    debian = @{ Label = 'Debian 13'; File = 'debian-13-genericcloud-amd64.raw'; GuestOS = 'debian12-64'
        Url = 'https://cloud.debian.org/images/cloud/trixie/latest/debian-13-genericcloud-amd64.raw'
        Sums = 'https://cloud.debian.org/images/cloud/trixie/latest/SHA512SUMS'; Algorithm = 'SHA512' }
}

function Get-MvlLinuxImage {
    <# Downloads the official cloud image once and verifies it against the publisher's checksum file. #>
    param([Parameter(Mandatory)][ValidateSet('ubuntu', 'debian')][string]$Os, [switch]$Force)
    $img = $script:MvlLinuxImages[$Os]
    $dir = Join-Path (Join-Path (Get-MvlHome) 'media') 'linux'
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    $path = Join-Path $dir $img.File
    $receipt = Join-Path $dir "$Os.json"
    Write-MvlPhase "Fetching the published $($img.Algorithm) for $($img.File) from $(([Uri]$img.Sums).Host)."
    $sums = (Invoke-WebRequest -UseBasicParsing -Uri $img.Sums).Content
    if ($sums -is [byte[]]) { $sums = [Text.Encoding]::UTF8.GetString($sums) }
    $line = ($sums -split "`n") | Where-Object { $_ -match ('[ *]' + [regex]::Escape($img.File) + '\s*$') } | Select-Object -First 1
    if (-not $line) { throw "$($img.File) is not listed in $($img.Sums)." }
    $expected = ($line -split '\s+')[0].ToLowerInvariant()
    if ((Test-Path -LiteralPath $receipt) -and (Test-Path -LiteralPath $path) -and -not $Force) {
        $rec = Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json
        if ($rec.hash -eq $expected -and (Get-Item -LiteralPath $path).Length -eq $rec.length) { Write-MvlPhase "$($img.Label) image already verified." ok; return $rec }
    }
    Write-MvlPhase "Downloading $($img.File) ($($img.Label))."
    $curl = Join-Path $env:SystemRoot 'System32\curl.exe'
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
    Invoke-MvlNative -FilePath $curl -ArgumentList @('-fL', '--proto', '=https', '--retry', '5', '-o', $path, $img.Url) -Display 'curl' | Out-Null
    Write-MvlPhase "Verifying $($img.Algorithm)."
    $actual = (Get-FileHash -LiteralPath $path -Algorithm $img.Algorithm).Hash.ToLowerInvariant()
    if ($actual -ne $expected) { Remove-Item -LiteralPath $path -Force; throw "$($img.File) $($img.Algorithm) mismatch: got $actual, published $expected." }
    $rec = [pscustomobject]@{ os = $Os; label = $img.Label; file = $img.File; path = $path; url = $img.Url; sums = $img.Sums
        algorithm = $img.Algorithm; hash = $actual; length = (Get-Item -LiteralPath $path).Length; verifiedAtUtc = (Get-Date).ToUniversalTime().ToString('o') }
    $rec | ConvertTo-Json | Set-Content -LiteralPath $receipt -Encoding UTF8
    Write-MvlPhase "$($img.Label) image verified: $($img.Algorithm) $actual" ok
    return $rec
}

function New-MvlLinuxDisk {
    <# Turns the cloud image into this machine's own growable disk (VMDK on VMware, VDI on VirtualBox). #>
    param([Parameter(Mandatory)]$State, [Parameter(Mandatory)]$Image)
    $dir = Get-MvlVmDir $State.name
    $src = $Image.path
    if ($State.hypervisor -eq 'virtualbox') {
        $vbox = Find-MvlVirtualBox
        $disk = Join-Path $dir 'disk.vdi'
        Write-MvlPhase 'Copying the image into a growable VirtualBox disk for this machine.'
        if ($State.os -eq 'debian') {
            Invoke-MvlNative -FilePath $vbox.VBoxManage -ArgumentList @('convertfromraw', $src, $disk, '--format', 'VDI') -Display 'VBoxManage convertfromraw' | Out-Null
        } else {
            Invoke-MvlNative -FilePath $vbox.VBoxManage -ArgumentList @('clonemedium', 'disk', $src, $disk, '--format', 'VDI') -Display 'VBoxManage clonemedium' | Out-Null
            # clonemedium registers the shared cloud image; release it so the cache stays reusable.
            Invoke-MvlNative -FilePath $vbox.VBoxManage -ArgumentList @('closemedium', 'disk', $src) -AllowFailure -Display 'VBoxManage closemedium' | Out-Null
        }
        Invoke-MvlNative -FilePath $vbox.VBoxManage -ArgumentList @('modifymedium', 'disk', $disk, '--resize', "$([int]$State.diskGB * 1024)") -Display 'VBoxManage modifymedium' | Out-Null
        return $disk
    }
    $hv = Find-MvlVmware
    $disk = Join-Path $dir 'disk.vmdk'
    if ($State.os -eq 'debian') {
        $vbox = Find-MvlVirtualBox
        if (-not $vbox) { throw 'Converting the Debian raw image needs VBoxManage (VirtualBox) on this PC.' }
        $tmp = Join-Path $dir 'convert.vmdk'
        Write-MvlPhase 'Converting the Debian raw image to VMDK.'
        Invoke-MvlNative -FilePath $vbox.VBoxManage -ArgumentList @('convertfromraw', $src, $tmp, '--format', 'VMDK') -Display 'VBoxManage convertfromraw' | Out-Null
        $src = $tmp
    }
    Write-MvlPhase 'Copying the image into a growable disk for this machine.'
    Invoke-MvlNative -FilePath $hv.DiskManager -ArgumentList @('-r', $src, '-t', '0', $disk) -Display 'vmware-vdiskmanager' | Out-Null
    if ($State.os -eq 'debian') { Remove-Item -LiteralPath $src -Force }
    Invoke-MvlNative -FilePath $hv.DiskManager -ArgumentList @('-x', "$($State.diskGB)GB", $disk) -Display 'vmware-vdiskmanager' | Out-Null
    return $disk
}

function New-MvlSshKey {
    <# A per-machine SSH key pair kept in the VM folder; the private half never leaves this PC. #>
    param([Parameter(Mandatory)][string]$Name)
    $key = Join-Path (Get-MvlVmDir $Name) 'ssh_ed25519'
    $kg = Join-Path $env:SystemRoot 'System32\OpenSSH\ssh-keygen.exe'
    if (-not (Test-Path -LiteralPath $kg)) { throw 'ssh-keygen (the Windows OpenSSH client) is not installed on this PC.' }
    & cmd.exe /d /c "`"$kg`" -q -t ed25519 -N `"`" -C mvl-$Name -f `"$key`"" | Out-Null
    if (-not (Test-Path -LiteralPath "$key.pub")) { throw 'ssh-keygen did not write the key.' }
    return $key
}

function New-MvlCloudInit {
    <# The cloud-init NoCloud seed (user-data + meta-data) as a CIDATA ISO in the VM folder. #>
    param([Parameter(Mandatory)]$State, [Parameter(Mandatory)][string]$Password, [Parameter(Mandatory)][string]$PublicKey)
    $vmDir = Get-MvlVmDir $State.name
    $seedDir = Join-Path $vmDir 'cidata'
    if (Test-Path -LiteralPath $seedDir) { Remove-Item -LiteralPath $seedDir -Recurse -Force }
    New-Item -ItemType Directory -Path $seedDir -Force | Out-Null
    $vmware = ($State.hypervisor -eq 'vmware')
    $share = ''
    if ($State.sharedFolder -and $vmware) {
        $share = @"
  - mkdir -p /mnt/shared
  - echo '.host:/$($State.name) /mnt/shared fuse.vmhgfs-fuse defaults,allow_other,uid=1000,gid=1000,nofail 0 0' >> /etc/fstab
  - mount /mnt/shared || true
  - ln -s /mnt/shared /home/$($State.userName)/shared
"@
    }
    $userData = @"
#cloud-config
hostname: $($State.computerName.ToLowerInvariant())
users:
  - name: $($State.userName)
    groups: [sudo]
    shell: /bin/bash
    sudo: ALL=(ALL) NOPASSWD:ALL
    lock_passwd: false
    ssh_authorized_keys:
      - $PublicKey
chpasswd:
  expire: false
  users:
    - {name: $($State.userName), password: '$($Password -replace "'", "''")', type: text}
ssh_pwauth: true
package_update: true
packages: [$(if ($vmware) { 'open-vm-tools, ' })curl, ca-certificates, git, nodejs, npm]
runcmd:
$(if ($vmware) { "  - systemctl enable --now open-vm-tools || true`n" })  - curl -fsSL https://get.docker.com -o /tmp/get-docker.sh && sh /tmp/get-docker.sh
  - usermod -aG docker $($State.userName)
  - npm install -g @openai/codex
$share  - mkdir -p /var/lib/mvl
  - sh -c 'printf "{\"docker\":\"%s\",\"codex\":\"%s\",\"node\":\"%s\"}\n" "`$(docker --version 2>/dev/null)" "`$(codex --version 2>/dev/null)" "`$(node --version 2>/dev/null)" > /var/lib/mvl/ready.json'
  - touch /etc/cloud/cloud-init.disabled
$(if ($vmware) { '  - vmware-rpctool "info-set guestinfo.mvl.ready 1"' + "`n" + '  - sleep 20' + "`n" })  - poweroff
"@
    $metaData = "instance-id: mvl-$($State.name)`nlocal-hostname: $($State.computerName.ToLowerInvariant())`n"
    $utf8 = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText((Join-Path $seedDir 'user-data'), ($userData -replace "`r`n", "`n"), $utf8)
    [IO.File]::WriteAllText((Join-Path $seedDir 'meta-data'), $metaData, $utf8)
    $iso = New-MvlSeedIso -SourceDir $seedDir -IsoPath (Join-Path $vmDir 'seed.iso') -Label 'CIDATA'
    Remove-Item -LiteralPath $seedDir -Recurse -Force
    return $iso.FullName
}

function New-MvlVmwareLinuxVm {
    param([Parameter(Mandatory)]$State, [Parameter(Mandatory)][string]$Disk, [Parameter(Mandatory)][string]$SeedIso)
    $dir = Get-MvlVmDir $State.name
    $vmx = Join-Path $dir "$($State.name).vmx"
    $netType = switch ($State.network) { 'hostonly' { 'hostonly' } 'bridged' { 'bridged' } default { 'nat' } }
    $lines = @(
        '.encoding = "UTF-8"', 'config.version = "8"', 'virtualHW.version = "21"',
        "displayName = `"mvl-$($State.name)`"", "guestOS = `"$($script:MvlLinuxImages[$State.os].GuestOS)`"",
        'firmware = "efi"', "memsize = `"$($State.memoryMB)`"", "numvcpus = `"$($State.cpus)`"",
        'svga.present = "TRUE"', 'vmci0.present = "TRUE"', 'pciBridge0.present = "TRUE"'
    )
    foreach ($n in 4..7) { $lines += @("pciBridge$n.present = `"TRUE`"", "pciBridge$n.virtualDev = `"pcieRootPort`"", "pciBridge$n.functions = `"8`"") }
    $lines += @(
        'scsi0.present = "TRUE"', 'scsi0.virtualDev = "pvscsi"', 'scsi0:0.present = "TRUE"', "scsi0:0.fileName = `"$([IO.Path]::GetFileName($Disk))`"",
        'sata0.present = "TRUE"', 'sata0:1.present = "TRUE"', 'sata0:1.deviceType = "cdrom-image"', "sata0:1.fileName = `"$SeedIso`"",
        'ethernet0.present = "TRUE"', "ethernet0.connectionType = `"$netType`"", 'ethernet0.virtualDev = "vmxnet3"', 'ethernet0.addressType = "generated"',
        'floppy0.present = "FALSE"', 'usb.present = "FALSE"', 'sound.present = "FALSE"', 'tools.syncTime = "TRUE"',
        'isolation.tools.copy.disable = "TRUE"', 'isolation.tools.paste.disable = "TRUE"', 'msg.autoAnswer = "TRUE"',
        'serial0.present = "FALSE"'
    )
    if ($State.sharedFolder) {
        $lines += @('isolation.tools.hgfs.disable = "FALSE"', 'sharedFolder.maxNum = "1"',
            'sharedFolder0.present = "TRUE"', 'sharedFolder0.enabled = "TRUE"', 'sharedFolder0.readAccess = "TRUE"', 'sharedFolder0.writeAccess = "TRUE"',
            "sharedFolder0.hostPath = `"$($State.sharedFolder.hostPath)`"", "sharedFolder0.guestName = `"$($State.name)`"", 'sharedFolder0.expiration = "never"')
    } else { $lines += 'isolation.tools.hgfs.disable = "TRUE"' }
    [IO.File]::WriteAllLines($vmx, $lines, (New-Object Text.UTF8Encoding($false)))
    return $vmx
}

function New-MvlVboxLinuxVm {
    <# A VirtualBox VM for a Linux cloud image: UEFI, SATA disk plus the CIDATA seed, NAT with an SSH port forward. #>
    param([Parameter(Mandatory)]$State, [Parameter(Mandatory)][string]$Disk, [Parameter(Mandatory)][string]$SeedIso)
    $dir = Get-MvlVmDir $State.name
    $vm = Get-MvlVboxName $State
    $ostype = if ($State.os -eq 'debian') { 'Debian_64' } else { 'Ubuntu_64' }
    Invoke-MvlVbox @('createvm', '--name', $vm, '--ostype', $ostype, '--basefolder', $dir, '--register') | Out-Null
    $nic = Get-MvlVboxNicArgs $State.network
    Invoke-MvlVbox (@('modifyvm', $vm, '--firmware', 'efi', '--memory', "$($State.memoryMB)", '--cpus', "$($State.cpus)",
            '--graphicscontroller', 'vmsvga', '--vram', '16', '--audio-enabled', 'off', '--clipboard-mode', 'disabled', '--drag-and-drop', 'disabled',
            '--usb-ohci', 'off', '--usb-ehci', 'off', '--usb-xhci', 'off', '--boot1', 'disk', '--boot2', 'dvd', '--boot3', 'none', '--boot4', 'none') + $nic) | Out-Null
    if ($State.sshPort) {
        Invoke-MvlVbox @('modifyvm', $vm, '--natpf1', "ssh,tcp,127.0.0.1,$($State.sshPort),,22") | Out-Null
    }
    # The cloud images print to the serial console after early boot; keep it in a file so the
    # progress (and any failure) is readable while the screen stays still.
    Invoke-MvlVbox @('modifyvm', $vm, '--uart1', '0x3F8', '4', '--uart-mode1', 'file', (Join-Path $dir 'serial.log')) | Out-Null
    Invoke-MvlVbox @('storagectl', $vm, '--name', 'SATA', '--add', 'sata', '--controller', 'IntelAhci', '--portcount', '4') | Out-Null
    Invoke-MvlVbox @('storageattach', $vm, '--storagectl', 'SATA', '--port', '0', '--device', '0', '--type', 'hdd', '--medium', $Disk) | Out-Null
    Invoke-MvlVbox @('storageattach', $vm, '--storagectl', 'SATA', '--port', '1', '--device', '0', '--type', 'dvddrive', '--medium', $SeedIso) | Out-Null
    $vbox = Get-ChildItem -LiteralPath $dir -Recurse -Filter '*.vbox' | Select-Object -First 1
    return $vbox.FullName
}

function Get-MvlFreeSshPort {
    <# A free loopback port for a VirtualBox NAT SSH forward, starting at 2222, skipping ports in use and ports other machines hold. #>
    $used = @()
    try { $used = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | ForEach-Object LocalPort) } catch { }
    foreach ($m in @(Get-MvlMachine)) {
        try { $st = Get-MvlState $m.Name; if ($st.PSObject.Properties['sshPort'] -and $st.sshPort) { $used += [int]$st.sshPort } } catch { }
    }
    for ($p = 2222; $p -lt 2400; $p++) { if ($used -notcontains $p) { return $p } }
    throw 'No free loopback port between 2222 and 2399 for the SSH forward.'
}

function New-MvlLinuxMaterialVmLabs {
    <# Creates a Linux lab machine to a clean baseline: cloud image, cloud-init, Docker, Codex CLI. #>
    param(
        [Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][ValidateSet('ubuntu', 'debian')][string]$Os,
        [string]$Project = 'general', [int]$MemoryMB = 4096, [int]$Cpus = 2, [int]$DiskGB = 40,
        [ValidateSet('nat', 'bridged', 'hostonly')][string]$Network = 'nat', [string]$UserName = 'mvlbuilder',
        [string]$Password, [switch]$RandomPassword, [ValidateSet('you', 'agent')][string]$For = 'agent',
        [switch]$Share, [switch]$NoShare, [switch]$NoOpenShare, [int]$TimeoutMinutes = 40,
        [ValidateSet('auto', 'vmware', 'virtualbox')][string]$Hypervisor = 'auto'
    )
    if ($UserName -notmatch '^[a-z][a-z0-9_-]{0,19}$') { throw "Invalid Linux account name '$UserName' (lower case letters, digits, - and _)." }
    Test-MvlName $Name
    $dir = Get-MvlVmDir $Name
    if (Test-Path -LiteralPath (Join-Path $dir 'vm.json')) { throw "A lab machine named '$Name' already exists." }
    $hv = Get-MvlHypervisor -Prefer $Hypervisor
    $kind = $hv.Kind
    $opts = Resolve-MvlOwnerOptions -For $For -Share:$Share -NoShare:$NoShare
    if ($kind -eq 'virtualbox' -and $opts.share) {
        # The shared folder needs VirtualBox Guest Additions, which the cloud images do not carry.
        Write-MvlPhase 'No shared folder on a VirtualBox Linux machine (it needs Guest Additions); copy files with scp over mvl ssh.' warn
        $opts.share = $false
    }
    $started = Get-Date
    $image = Get-MvlLinuxImage -Os $Os
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    $usingDefault = (-not $Password -and -not $RandomPassword)
    $pw = if ($Password) { $Password } elseif ($RandomPassword) { New-MvlPassword } else { '1234' }
    $state = [pscustomobject]@{
        schema = 1; name = $Name; project = $Project; os = $Os; osLabel = $image.label
        hypervisor = $kind; hypervisorVersion = $hv.Version; hypervisorReason = $hv.Reason
        computerName = ('mvl-' + $Name).Substring(0, [Math]::Min(63, 4 + $Name.Length)); userName = $UserName; defaultPassword = $usingDefault
        memoryMB = $MemoryMB; cpus = $Cpus; diskGB = $DiskGB; network = $Network
        imageFile = $image.file; imageHash = $image.hash; imageAlgorithm = $image.algorithm
        vmPath = ''; status = 'creating'; baseline = $null; runners = @()
        created = (Get-Date).ToUniversalTime().ToString('o'); updated = ''; provisioning = $null
        owner = $For; tools = $true; sharedFolder = $null; sshKey = ''; sshPort = 0
    }
    if ($kind -eq 'virtualbox' -and $Network -eq 'nat') { $state.sshPort = Get-MvlFreeSshPort }
    if ($opts.share) { $state.sharedFolder = New-MvlSharedFolder -State $state; $state.sharedFolder.guestPath = '/mnt/shared' }
    Save-MvlState $state
    Protect-MvlSecret -Name $Name -Plain $pw
    try {
        $key = New-MvlSshKey -Name $Name
        $state.sshKey = $key
        $seedIso = New-MvlCloudInit -State $state -Password $pw -PublicKey ((Get-Content -LiteralPath "$key.pub" -Raw).Trim())
        $pw = $null
        $disk = New-MvlLinuxDisk -State $state -Image $image
        $state.vmPath = if ($kind -eq 'virtualbox') { New-MvlVboxLinuxVm -State $state -Disk $disk -SeedIso $seedIso } else { New-MvlVmwareLinuxVm -State $state -Disk $disk -SeedIso $seedIso }
        $state.status = 'installing'
        Save-MvlState $state
        Invoke-MvlBackend $state Start
        Write-MvlPhase "$($image.label) is booting; cloud-init installs Docker and the Codex CLI (up to $TimeoutMinutes minutes)."
        if ($kind -eq 'vmware') {
            Wait-MvlCondition -TimeoutMinutes $TimeoutMinutes -IntervalSeconds 20 -Waiting 'cloud-init readiness signal' -Condition {
                (Invoke-MvlBackend $state ReadVar @{ Var = 'mvl.ready' }) -eq '1'
            } | Out-Null
            Write-MvlPhase 'Guest reported ready; waiting for it to power off for the baseline.' ok
        } else {
            # No guest tools on VirtualBox: cloud-init powers the guest off as its last step.
            Write-MvlPhase 'Waiting for cloud-init to finish and power the guest off.'
            Wait-MvlCondition -TimeoutMinutes $TimeoutMinutes -IntervalSeconds 20 -Waiting 'cloud-init power-off' -Condition { (Invoke-MvlBackend $state Power) -eq 'off' } | Out-Null
        }
        Wait-MvlCondition -TimeoutMinutes 10 -IntervalSeconds 10 -Waiting 'guest shutdown' -Condition { (Invoke-MvlBackend $state Power) -eq 'off' } | Out-Null
        Invoke-MvlBackend $state Detach
        Remove-Item -LiteralPath $seedIso -Force
        Invoke-MvlBackend $state Snapshot @{ Snapshot = $script:MvlBaseline }
        $state.baseline = [pscustomobject]@{ name = $script:MvlBaseline; takenUtc = (Get-Date).ToUniversalTime().ToString('o') }
        $state.status = 'ready'
        $state.provisioning = [pscustomobject]@{ minutes = [math]::Round(((Get-Date) - $started).TotalMinutes, 1) }
        Save-MvlState $state
        Write-MvlPhase "Lab machine '$Name' ($($image.label)) is ready with clean baseline '$($script:MvlBaseline)' after $($state.provisioning.minutes) minutes." ok
        if ($state.sharedFolder -and $For -eq 'you' -and -not $NoOpenShare) { Open-MvlShare -Name $Name | Out-Null }
        return $state
    } catch {
        $state.status = 'failed'
        $state | Add-Member -NotePropertyName error -NotePropertyValue $_.Exception.Message -Force
        Save-MvlState $state
        try { Invoke-MvlBackend $state Screenshot @{ Path = (Join-Path $dir 'failure.png') } | Out-Null } catch { }
        throw
    }
}

function Open-MvlSsh {
    <# Opens an SSH session to a running Linux lab machine with its own key. #>
    param([Parameter(Mandatory)][string]$Name, [switch]$NoLaunch)
    $s = Get-MvlState $Name
    if (-not ($s.PSObject.Properties['os'] -and $s.os -ne 'windows')) { throw "'$Name' is a Windows machine; use mvl rdp." }
    $port = if ($s.PSObject.Properties['sshPort'] -and $s.sshPort) { [int]$s.sshPort } else { 0 }
    if ($port) {
        if ((Invoke-MvlBackend $s Power) -ne 'running') { throw "'$Name' is not running; start it first." }
        $ip = '127.0.0.1'
    } else {
        $ip = Get-MvlIp -Name $Name -WaitSeconds 120
        if (-not $ip) { throw "'$Name' has no IP address (is it running?)." }
    }
    $ssh = Join-Path $env:SystemRoot 'System32\OpenSSH\ssh.exe'
    $sshArgs = @('-i', $s.sshKey, '-o', 'StrictHostKeyChecking=accept-new', '-o', "UserKnownHostsFile=$(Join-Path (Get-MvlVmDir $Name) 'known_hosts')")
    if ($port) { $sshArgs += @('-p', "$port") }
    $sshArgs += "$($s.userName)@$ip"
    if (-not $NoLaunch) { Start-Process -FilePath $ssh -ArgumentList ($sshArgs | ForEach-Object { ConvertTo-MvlArgument $_ }) }
    return [pscustomobject]@{ name = $Name; ip = $ip; port = $(if ($port) { $port } else { 22 }); user = $s.userName; command = "ssh $(($sshArgs | ForEach-Object { ConvertTo-MvlArgument $_ }) -join ' ')" }
}

function Assert-MvlWindowsGuest {
    param([Parameter(Mandatory)]$State, [string]$What = 'this command')
    if ($State.PSObject.Properties['os'] -and $State.os -and $State.os -ne 'windows') {
        throw "$What needs a Windows guest; '$($State.name)' is $($State.osLabel). Use mvl ssh for Linux machines."
    }
}
