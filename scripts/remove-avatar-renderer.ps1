$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$wranglerConfig = Join-Path $repoRoot "wrangler.toml"
$openPekoraRoot = "C:\Pekora-RCC-Host\OpenPekora"

if (-not (Test-Path -LiteralPath $wranglerConfig)) {
    throw "Could not find wrangler.toml in the Sakura repository."
}

$npxCommand = Get-Command "npx.cmd" -ErrorAction Stop
$npxCmd = $npxCommand.Source

Push-Location $repoRoot
try {
    Write-Host "[1/4] Deploying Sakura without Avatar or Renderer..."
    & $npxCmd wrangler deploy --config $wranglerConfig
    if ($LASTEXITCODE -ne 0) {
        throw "Sakura deployment failed. Local renderer processes were left running."
    }

    Write-Host "[2/4] Removing saved avatar data from Sakura D1..."
    & $npxCmd wrangler d1 migrations apply pekora-db --remote --config $wranglerConfig
    if ($LASTEXITCODE -ne 0) {
        throw "The D1 cleanup migration failed. The renderer has not been stopped."
    }

    Write-Host "[3/4] Deleting the obsolete Worker renderer secret..."
    & $npxCmd wrangler secret delete AVATAR_RENDERER_SECRET --name sakura --config $wranglerConfig
    if ($LASTEXITCODE -eq 0) {
        Write-Host "AVATAR_RENDERER_SECRET deleted."
    } else {
        Write-Warning "The Worker secret was not deleted (it may already be absent). Sakura no longer uses it."
    }

    Write-Host "[4/4] Stopping Sakura RCCService and OpenPekora Renderer..."
    $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
    foreach ($process in $processes) {
        $isRendererNode = $process.Name -ieq "node.exe" -and [string]$process.CommandLine -match 'dist[\\/]Main\.js'
        $isSakuraRcc = $process.Name -ieq "RCCService.exe" -and [string]$process.CommandLine -match '(?i)-port\s+1621'
        if ($isRendererNode -or $isSakuraRcc) {
            try {
                Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction Stop
                Write-Host "Stopped $($process.Name) (PID $($process.ProcessId))."
            } catch {
                Write-Warning "Could not stop PID $($process.ProcessId): $($_.Exception.Message)"
            }
        }
    }

    $secretState = Join-Path $env:LOCALAPPDATA "Sakura\renderer-secret.sha256"
    if (Test-Path -LiteralPath $secretState) {
        Remove-Item -LiteralPath $secretState -Force
    }

    if (Test-Path -LiteralPath $openPekoraRoot) {
        Write-Host ""
        $answer = Read-Host "Delete the local OpenPekora checkout at $openPekoraRoot too? [y/N]"
        if ($answer -match '^(y|yes)$') {
            Remove-Item -LiteralPath $openPekoraRoot -Recurse -Force
            Write-Host "Local OpenPekora checkout deleted."
        } else {
            Write-Host "Local OpenPekora files were kept as a backup."
        }
    }

    Write-Host ""
    Write-Host "Avatar editor, renderer API, saved avatar data and local renderer processes have been removed."
    Write-Host "The cloudflared Windows service was left untouched because it may serve other tunnels."
} finally {
    Pop-Location
}
