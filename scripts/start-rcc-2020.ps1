$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$rccDir = Join-Path $repoRoot "RCCService\RCCService2020"
$rccExe = Join-Path $rccDir "RCCService.exe"
$configPath = Join-Path $repoRoot "game-renderer\config.json"
$port = 64989

if (-not (Test-Path -LiteralPath $rccExe)) {
    throw "RCCService 2020 executable not found: $rccExe"
}

if (Test-Path -LiteralPath $configPath) {
    try {
        $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
        if (-not $config.Paths) {
            $config | Add-Member -MemberType NoteProperty -Name Paths -Value ([pscustomobject]@{})
        }
        $config.Paths.RCCService = "..\RCCService\RCCService2020"
        $json = $config | ConvertTo-Json -Depth 30
        [System.IO.File]::WriteAllText($configPath, $json, [System.Text.UTF8Encoding]::new($false))
        Write-Host "Renderer config now points to RCCService 2020."
    }
    catch {
        throw "Could not update game-renderer\config.json: $($_.Exception.Message)"
    }
}
else {
    Write-Warning "game-renderer\config.json was not found. RCCService will still be started."
}

$existing = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existing) {
    $existingProcess = Get-Process -Id $existing.OwningProcess -ErrorAction SilentlyContinue
    if (-not $existingProcess -or $existingProcess.ProcessName -notmatch "^RCCService") {
        throw "Port $port is occupied by another process. It was not stopped."
    }
    Write-Host "Stopping old RCCService process on port $port..."
    Stop-Process -Id $existing.OwningProcess -Force
    Start-Sleep -Seconds 2
}

Write-Host "Starting OpenPekora-compatible RCCService 2020 on port $port..."
$process = Start-Process -FilePath $rccExe -ArgumentList @("-Console", "-placeid:2", "-port:$port") -WorkingDirectory $rccDir -PassThru
$ready = $false
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 1
    $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) { $ready = $true; break }
    if ($process.HasExited) { throw "RCCService 2020 exited before opening port $port. Check its console output." }
}
if (-not $ready) { throw "RCCService 2020 did not open port $port. Check its console output." }

Write-Host ""
Write-Host "RCCService 2020 is listening on port $port." -ForegroundColor Green
Write-Host "Keep this process running. Next, start the OpenPekora renderer."
