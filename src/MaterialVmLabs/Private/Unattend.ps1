Set-StrictMode -Version 2.0

# Answer-file generation and the per-VM seed image.

function ConvertTo-MvlXmlText {
    param([AllowEmptyString()][string]$Value)
    return [System.Security.SecurityElement]::Escape($Value)
}

function ConvertTo-MvlUnattendPassword {
    # Windows Setup's "PlainText=false" form: base64 of UTF-16LE(password + suffix).
    # This is encoding, not encryption; the file is treated as sensitive and deleted after use.
    param([Parameter(Mandatory)][string]$Password, [Parameter(Mandatory)][string]$Suffix)
    return [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Password + $Suffix))
}

function New-MvlServerAutounattend {
    param(
        [Parameter(Mandatory)][ValidatePattern('\A[a-zA-Z][a-zA-Z0-9-]{0,14}\z')][string]$ComputerName,
        [Parameter(Mandatory)][ValidateRange(1, 65535)][int]$ImageIndex,
        [switch]$StageServerScripts
    )
    if ($ComputerName.EndsWith('-')) { throw 'The computer name cannot end with a hyphen.' }
    [xml]$answer = Get-Content -LiteralPath (Join-Path $script:MvlModuleRoot 'Templates\autounattend.template.xml') -Raw -Encoding UTF8
    $ns = [Xml.XmlNamespaceManager]::new($answer.NameTable)
    $ns.AddNamespace('u', 'urn:schemas-microsoft-com:unattend')

    $shell = '//u:component[@name="Microsoft-Windows-Shell-Setup"]'
    $clientOnly = @(
        "$shell/u:UserAccounts", "$shell/u:AutoLogon", "$shell/u:FirstLogonCommands", "$shell/u:OOBE",
        '//u:component[@name="Microsoft-Windows-Deployment"]/u:RunSynchronous'
    )
    foreach ($query in $clientOnly) {
        $node = $answer.SelectSingleNode($query, $ns)
        if ($node) { [void]$node.ParentNode.RemoveChild($node) }
    }
    if ($StageServerScripts) {
        $deployment = $answer.SelectSingleNode('//u:component[@name="Microsoft-Windows-Deployment"]', $ns)
        $node = $answer.CreateElement('RunSynchronous', $ns.LookupNamespace('u'))
        $node.InnerXml = @'
<RunSynchronousCommand xmlns="urn:schemas-microsoft-com:unattend" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State" wcm:action="add">
  <Order>1</Order>
  <Path>cmd.exe /c for %i in (D E F G H I J K L M N O P Q R S T U V W X Y Z) do @if exist %i:\mvl-server\ServerStage.ps1 powershell.exe -NoProfile -NonInteractive -File %i:\mvl-server\ServerStage.ps1</Path>
</RunSynchronousCommand>
'@
        [void]$deployment.AppendChild($node)
    }
    $answer.SelectSingleNode("$shell/u:ComputerName", $ns).InnerText = $ComputerName
    $answer.SelectSingleNode('//u:InstallFrom/u:MetaData/u:Value', $ns).InnerText = [string]$ImageIndex
    $xml = $answer.OuterXml.Replace('{{USER_NAME}}', 'Server lab').Replace('{{REQUIREMENT_WAIVER}}', '').
        Replace('{{UI_LANGUAGE}}', 'en-US').Replace('{{LOCALE}}', 'en-US').Replace('{{INPUT_LOCALE}}', '0409:00000409').
        Replace('{{TIME_ZONE}}', 'UTC')
    if ($xml -match '\{\{[A-Z_]+\}\}') { throw 'The Server answer file contains an unresolved template value.' }
    return $xml
}

function New-MvlAutounattend {
    param(
        [Parameter(Mandatory)][string]$ComputerName,
        [Parameter(Mandatory)][string]$UserName,
        [Parameter(Mandatory)][string]$Password,
        [string]$Locale = 'en-US',
        [string]$InputLocale = '0409:00000409',
        [string]$TimeZone = 'Eastern Standard Time',
        [int]$ImageIndex = 1,
        [switch]$WaiveTpmRequirement
    )
    if ($ComputerName.Length -gt 15) { throw 'Computer name must be 15 characters or fewer.' }
    if ($UserName -notmatch '^[A-Za-z][A-Za-z0-9_-]{0,19}$') { throw 'Invalid local account name.' }
    $template = Get-Content -LiteralPath (Join-Path $script:MvlModuleRoot 'Templates\autounattend.template.xml') -Raw -Encoding UTF8

    $waiver = ''
    if ($WaiveTpmRequirement) {
        # Only used when the hypervisor cannot present a virtual TPM to automation
        # (VMware Workstation needs VM encryption set in its UI for a vTPM). It affects
        # Windows Setup inside the throwaway guest only and is recorded in every receipt.
        $lines = @()
        $order = 1
        foreach ($key in @('BypassTPMCheck', 'BypassSecureBootCheck')) {
            $lines += "        <RunSynchronousCommand wcm:action=`"add`"><Order>$order</Order><Path>reg.exe add HKLM\SYSTEM\Setup\LabConfig /v $key /t REG_DWORD /d 1 /f</Path></RunSynchronousCommand>"
            $order++
        }
        $waiver = "      <RunSynchronous>`r`n" + ($lines -join "`r`n") + "`r`n      </RunSynchronous>"
    }

    $values = @{
        '{{UI_LANGUAGE}}'       = $Locale
        '{{LOCALE}}'            = $Locale
        '{{INPUT_LOCALE}}'      = $InputLocale
        '{{TIME_ZONE}}'         = $TimeZone
        '{{COMPUTER_NAME}}'     = $ComputerName
        '{{USER_NAME}}'         = $UserName
        '{{IMAGE_INDEX}}'       = "$ImageIndex"
        '{{PASSWORD_ENCODED}}'  = ConvertTo-MvlUnattendPassword $Password 'Password'
        '{{AUTOLOGON_ENCODED}}' = ConvertTo-MvlUnattendPassword $Password 'Password'
    }
    $xml = $template.Replace('{{REQUIREMENT_WAIVER}}', $waiver)
    foreach ($k in $values.Keys) { $xml = $xml.Replace($k, (ConvertTo-MvlXmlText $values[$k])) }
    if ($xml -match '\{\{[A-Z_]+\}\}') { throw "Unfilled answer-file token: $($Matches[0])" }
    [void][xml]$xml   # must parse
    return $xml
}

if (-not ('MvlIsoWriter' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices.ComTypes;
public static class MvlIsoWriter {
    public static void Save(object stream, string path) {
        IStream s = (IStream)stream;
        STATSTG stat; s.Stat(out stat, 1);
        using (FileStream fs = File.Create(path)) {
            byte[] buf = new byte[1 << 20];
            IntPtr readPtr = System.Runtime.InteropServices.Marshal.AllocHGlobal(4);
            try {
                long left = stat.cbSize;
                while (left > 0) {
                    s.Read(buf, buf.Length, readPtr);
                    int read = System.Runtime.InteropServices.Marshal.ReadInt32(readPtr);
                    if (read <= 0) break;
                    fs.Write(buf, 0, read); left -= read;
                }
            } finally { System.Runtime.InteropServices.Marshal.FreeHGlobal(readPtr); }
        }
    }
}
'@
}

function New-MvlSeedIso {
    # Builds an ISO 9660 + Joliet image from a folder using the Windows IMAPI2 file system COM API.
    param([Parameter(Mandatory)][string]$SourceDir, [Parameter(Mandatory)][string]$IsoPath, [string]$Label = 'MVLSEED')
    $fs = New-Object -ComObject IMAPI2FS.MsftFileSystemImage
    $fs.FileSystemsToCreate = 3      # ISO9660 + Joliet
    $fs.VolumeName = $Label
    $fs.FreeMediaBlocks = 0          # no capacity limit
    $fs.Root.AddTree($SourceDir, $false)
    $result = $fs.CreateResultImage()
    if (Test-Path -LiteralPath $IsoPath) { Remove-Item -LiteralPath $IsoPath -Force }
    $stream = $result.ImageStream
    [MvlIsoWriter]::Save($stream, $IsoPath)
    # The image stream keeps every source file open until its COM objects are released; a large
    # file (the 63 MB guest Setup exe) stays locked otherwise and the seed folder cannot be removed.
    foreach ($o in @($stream, $result, $fs)) { try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($o) } catch { } }
    $stream = $null; $result = $null; $fs = $null
    [GC]::Collect(); [GC]::WaitForPendingFinalizers()
    return (Get-Item -LiteralPath $IsoPath)
}

function New-MvlSeed {
    <# Writes the per-VM seed folder (answer file + guest scripts) and its ISO into the VM folder. #>
    param(
        [Parameter(Mandatory)]$State,
        [Parameter(Mandatory)][string]$Password,
        [switch]$WaiveTpmRequirement
    )
    $vmDir = Get-MvlVmDir $State.name
    $seedDir = Join-Path $vmDir 'seed'
    if (Test-Path -LiteralPath $seedDir) { Remove-Item -LiteralPath $seedDir -Recurse -Force }
    New-Item -ItemType Directory -Path (Join-Path $seedDir 'mvl') -Force | Out-Null
    $xml = New-MvlAutounattend -ComputerName $State.computerName -UserName $State.userName -Password $Password `
        -Locale $State.locale -TimeZone $State.timeZone -ImageIndex $State.imageIndex -WaiveTpmRequirement:$WaiveTpmRequirement
    [IO.File]::WriteAllText((Join-Path $seedDir 'autounattend.xml'), $xml, (New-Object Text.UTF8Encoding($false)))
    Copy-Item -LiteralPath (Join-Path $script:MvlModuleRoot 'Guest\firstlogon.ps1') -Destination (Join-Path $seedDir 'mvl\firstlogon.ps1')
    $owner = if ($State.PSObject.Properties['owner']) { $State.owner } else { 'agent' }
    $tools = [bool]($State.PSObject.Properties['tools'] -and $State.tools)
    $share = if ($State.PSObject.Properties['sharedFolder'] -and $State.sharedFolder) { $State.sharedFolder } else { $null }
    if ($tools) { Copy-Item -LiteralPath (Join-Path $script:MvlModuleRoot 'Guest\guest-tools.ps1') -Destination (Join-Path $seedDir 'mvl\guest-tools.ps1') }
    if ($owner -eq 'you') { Copy-Item -LiteralPath (Get-MvlGuestSetupExe) -Destination (Join-Path $seedDir 'mvl\MaterialVmLabsSetup.exe') }
    [ordered]@{ name = $State.name; hypervisor = $State.hypervisor; project = $State.project; owner = $owner; tools = $tools; share = $share } |
        ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $seedDir 'mvl\seed.json') -Encoding ASCII
    $iso = New-MvlSeedIso -SourceDir $seedDir -IsoPath (Join-Path $vmDir 'seed.iso')
    for ($i = 1; $i -le 10; $i++) {
        try { Remove-Item -LiteralPath $seedDir -Recurse -Force -ErrorAction Stop; break }
        catch { if ($i -eq 10) { throw }; [GC]::Collect(); [GC]::WaitForPendingFinalizers(); Start-Sleep -Seconds 2 }
    }
    return $iso.FullName
}
