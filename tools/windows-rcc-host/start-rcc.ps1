$ErrorActionPreference = "Stop"
$RccDir = "C:\Pekora-RCC-Host\OpenPekora\RCCService"
$RccExe = Join-Path $RccDir "RCCService.exe"

if (-not (Test-Path $RccExe)) {
    throw "RCCService.exe not found. Run setup.ps1 first."
}

Write-Host "Starting upstream RCC on localhost port 64989." -ForegroundColor Cyan
Write-Warning "Do not expose port 64989 to the internet or create a router port-forward."
Set-Location $RccDir
& $RccExe -Console -placeid:2 -port:64989
