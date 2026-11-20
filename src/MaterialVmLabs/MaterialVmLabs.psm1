# lab machine module: dot-sources every Private file and exports the public verbs.
foreach ($f in (Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'Private') -Filter '*.ps1' | Sort-Object Name)) { . $f.FullName }

Export-ModuleMember -Function @(
    'Get-MvlHome', 'Get-MvlHypervisor', 'Install-MvlHypervisor', 'Get-MvlMedia', 'Get-MvlServerMedia', 'New-MvlAutounattend', 'New-MvlSeedIso',
    'New-MvlMachine', 'Get-MvlMachine', 'Start-MvlMachine', 'Stop-MvlMachine', 'Reset-MvlMachine', 'Remove-MvlMachine',
    'Invoke-MvlBuild', 'Register-MvlRunner', 'Unregister-MvlRunner', 'Get-MvlState', 'Invoke-MvlBackend', 'Write-MvlPhase',
    'Get-MvlIp', 'Set-MvlNetwork', 'Open-MvlRdp', 'Open-MvlShare', 'Open-MvlSsh', 'Assert-MvlWindowsGuest', 'Get-MvlLinuxImage', 'Set-MvlGuestPassword', 'Invoke-MvlInstallerTest'
)
