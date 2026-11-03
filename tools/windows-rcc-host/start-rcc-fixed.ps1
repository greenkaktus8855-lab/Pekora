# Compatibility launcher for the corrected Sakura / OpenPekora RCC 2020 setup.
# Run PowerShell as Administrator.

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$launcher = Join-Path $projectRoot "scripts\start-rcc-2020.ps1"

if (-not (Test-Path -LiteralPath $launcher)) {
    throw "Corrected RCC launcher was not found: $launcher"
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Open PowerShell as Administrator and run this launcher again."
}

& $launcher
if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
    throw "RCC launcher failed with exit code $LASTEXITCODE."
}
