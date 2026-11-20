# Sample Material VM Labs extension (Windows PowerShell 5.1 or PowerShell 7).
# One JSON request line in on standard input, one JSON answer line out on standard output.
$ErrorActionPreference = 'Stop'
$request = [Console]::In.ReadLine() | ConvertFrom-Json
$r = $request.input.receipt
$checks = @()
$passed = $r.verdict -eq 'passed'
$checks += @{ status = $(if ($passed) { 'pass' } else { 'fail' }); title = 'Verdict'; detail = "The receipt says $($r.verdict)." }
$extra = 0
if ($r.dependencies) { $extra = [int]$r.dependencies.tools + [int]$r.dependencies.programs + [int]$r.dependencies.choco }
$checks += @{ status = $(if ($extra -eq 0) { 'pass' } else { 'fail' }); title = 'No undeclared dependencies'; detail = "$extra tools, programs or packages appeared during the build." }
$slow = $r.hostMinutes -ne $null -and [double]$r.hostMinutes -gt 30
$checks += @{ status = $(if ($slow) { 'warn' } else { 'pass' }); title = 'Under 30 minutes'; detail = "Host time: $($r.hostMinutes) minutes." }
$fails = @($checks | Where-Object { $_.status -eq 'fail' }).Count
$answer = @{ type = 'answer'; summary = $(if ($fails) { "$fails gate check(s) failed" } else { 'The gate passes' }); checks = $checks }
[Console]::Out.WriteLine(($answer | ConvertTo-Json -Compress -Depth 5))
