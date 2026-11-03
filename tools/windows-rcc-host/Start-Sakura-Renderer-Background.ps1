$ErrorActionPreference = "Stop"

$logDir = Join-Path $env:LOCALAPPDATA "SakuraRenderer\logs"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$transcriptPath = Join-Path $logDir "renderer-autostart.log"
try { Start-Transcript -Path $transcriptPath -Append | Out-Null } catch {}

try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "The scheduled renderer task must run with highest privileges. Reopen Start-Sakura-Renderer.vbs once to repair the task."
    }

    $settingsDir = Join-Path $env:LOCALAPPDATA "SakuraRenderer"
    $rootPathFile = Join-Path $settingsDir "openpekora-root.txt"
    $secretStorePath = Join-Path $settingsDir "renderer-secret.dpapi"
    if (-not (Test-Path -LiteralPath $rootPathFile)) { throw "Saved OpenPekora folder is missing. Start the renderer once using Start-Sakura-Renderer.vbs." }
    if (-not (Test-Path -LiteralPath $secretStorePath)) { throw "Saved renderer key is missing. Start the renderer once using Start-Sakura-Renderer.vbs." }

    $openPekoraRoot = [string](Get-Content -LiteralPath $rootPathFile -Raw).Trim()
    if (-not (Test-Path -LiteralPath (Join-Path $openPekoraRoot "game-renderer\config.json")) -or
        -not (Test-Path -LiteralPath (Join-Path $openPekoraRoot "RCCService\RCCService2020\RCCService.exe"))) {
        throw "Saved OpenPekora folder is no longer valid: $openPekoraRoot"
    }

    $secureSecret = Get-Content -LiteralPath $secretStorePath -Raw | ConvertTo-SecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
    try {
        $secret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
    if ([string]::IsNullOrWhiteSpace($secret) -or $secret.Length -lt 24) { throw "The saved renderer key is invalid. Reopen the launcher to save it again." }

    $env:SAKURA_OPENPEKORA_ROOT = $openPekoraRoot
    $env:SAKURA_RENDERER_LOG_DIR = $logDir
    $env:PEKORA_RENDERER_SECRET = $secret
    $secret = $null
    $secureSecret = $null

    try {
        $tunnelService = Get-Service -Name "cloudflared" -ErrorAction SilentlyContinue
        if ($tunnelService) {
            Set-Service -Name "cloudflared" -StartupType Automatic -ErrorAction SilentlyContinue
            if ($tunnelService.Status -ne "Running") { Start-Service -Name "cloudflared" }
        }
    } catch {}

    $repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
    $rccSetup = Join-Path $repoRoot "scripts\start-rcc-2020.ps1"
    $rendererSetup = Join-Path $repoRoot "scripts\start-renderer-secure.ps1"
    if (-not (Test-Path -LiteralPath $rccSetup) -or -not (Test-Path -LiteralPath $rendererSetup)) {
        throw "Sakura renderer setup scripts are missing from $repoRoot"
    }

    Write-Host "Starting OpenPekora RCCService..."
    & $rccSetup
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "RCCService setup failed with exit code $LASTEXITCODE." }

    Write-Host "Starting secured OpenPekora HTTP renderer..."
    & $rendererSetup
    $rendererExitCode = $LASTEXITCODE
    throw "OpenPekora renderer stopped unexpectedly. Exit code: $rendererExitCode."
} catch {
    $message = $_ | Out-String
    Add-Content -LiteralPath $transcriptPath -Value ([Environment]::NewLine + "AUTOSTART ERROR:" + [Environment]::NewLine + $message)
    throw
} finally {
    Remove-Item Env:PEKORA_RENDERER_SECRET -ErrorAction SilentlyContinue
    Remove-Item Env:SAKURA_OPENPEKORA_ROOT -ErrorAction SilentlyContinue
    Remove-Item Env:SAKURA_RENDERER_LOG_DIR -ErrorAction SilentlyContinue
    try { Stop-Transcript | Out-Null } catch {}
}
