# Sakura / OpenPekora RCC 2020 launcher
# Run from an elevated or normal PowerShell window. This script does not modify
# AppSettings.xml, the Windows registry, or any secret values.

$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$rccDirectory = Join-Path $projectRoot "RCCService\RCCService2020"
$rccExecutable = Join-Path $rccDirectory "RCCService.exe"
$settingsFile = Join-Path $rccDirectory "Settings.json"
$port = 64989

if (-not (Test-Path -LiteralPath $rccExecutable)) {
    throw "RCCService.exe was not found: $rccExecutable"
}

# The upstream OpenPekora RCC 2020 launcher uses -settingsfile Settings.json.
# Keep an existing Settings.json intact; create the upstream default only if absent.
if (-not (Test-Path -LiteralPath $settingsFile)) {
    [System.IO.File]::WriteAllText(
        $settingsFile,
        '{"applicationSettings":{}}',
        [System.Text.UTF8Encoding]::new($false)
    )
    Write-Host "Created default Settings.json."
}

try {
    $settings = Get-Content -LiteralPath $settingsFile -Raw | ConvertFrom-Json
} catch {
    throw "Settings.json is not valid JSON. It was left unchanged. Details: $($_.Exception.Message)"
}

$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1

if ($listener) {
    $owner = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    if (-not $owner -or $owner.ProcessName -notmatch '^RCCService') {
        throw "TCP port $port is already used by another process (PID $($listener.OwningProcess)). Nothing was stopped."
    }

    Write-Host "Stopping the existing RCCService process on port $port..."
    Stop-Process -Id $listener.OwningProcess -Force
    Start-Sleep -Seconds 2
}

Write-Host "Starting RCCService 2020 on port $port..."
$process = Start-Process -FilePath $rccExecutable -WorkingDirectory $rccDirectory -ArgumentList @(
    "-Console",
    "-verbose",
    "-settingsfile", "Settings.json",
    "-port", "$port"
) -PassThru

$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Seconds 1
    $process.Refresh()

    if ($process.HasExited) {
        throw "RCCService exited with code $($process.ExitCode). Its console window should contain the reason."
    }

    $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1

    if ($listener -and $listener.OwningProcess -eq $process.Id) {
        $ready = $true
        break
    }
}

if (-not $ready) {
    throw "RCCService stayed running but did not open TCP port $port within 30 seconds."
}

Write-Host "RCCService 2020 is listening on 127.0.0.1:$port" -ForegroundColor Green
Write-Host "Keep this PowerShell window open while using the avatar renderer."
