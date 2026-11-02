$ErrorActionPreference = "Stop"

$HostRoot = "C:\Pekora-RCC-Host"
$UpstreamDir = Join-Path $HostRoot "OpenPekora"
$UpstreamUrl = "https://github.com/Blue7366/OpenPekora.git"
$ToolDir = $PSScriptRoot

Write-Host "Pekora Windows RCC host setup" -ForegroundColor Cyan
Write-Host "This prepares the upstream renderer locally. It does not publish or expose any ports." -ForegroundColor Yellow

foreach ($command in @("git", "node", "npm")) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        throw "$command is missing. Install Git for Windows and Node.js 22 LTS, then run this script again."
    }
}

$nodeVersion = (node --version).Trim()
if ($nodeVersion -notmatch '^v22\.') {
    throw "Detected Node.js $nodeVersion. This upstream uWebSockets.js build requires Node.js 22 LTS on Windows. Install Node.js 22 LTS and run setup again."
}

New-Item -ItemType Directory -Force -Path $HostRoot | Out-Null

if (-not (Test-Path (Join-Path $UpstreamDir ".git"))) {
    if (Test-Path $UpstreamDir) {
        throw "$UpstreamDir already exists but is not a Git checkout. Rename or remove that folder and retry."
    }
    git clone $UpstreamUrl $UpstreamDir
} else {
    Write-Host "Upstream checkout already exists; leaving it unchanged." -ForegroundColor Green
}

$RendererDir = Join-Path $UpstreamDir "game-renderer"
$PackageFile = Join-Path $RendererDir "package.json"
$RccFile = Join-Path $UpstreamDir "RCCService\RCCService.exe"
if (-not (Test-Path $PackageFile)) { throw "Missing upstream game-renderer/package.json." }
if (-not (Test-Path $RccFile)) { throw "Missing RCCService.exe in the upstream checkout." }

$config = @{
    BaseUrl = "https://pekora.green-kaktus8855.workers.dev/"
    RCCUrl = "http://127.0.0.1"
    Debug = $true
    Ports = @{
        Process = 3001
        RCC = @{
            All = @(64989)
            Player = @(64989)
            Image = @(64989)
            Place = @(64989)
            Catalog = @(64989)
        }
    }
    Paths = @{
        RCCService = "..\RCCService"
    }
}

$configPath = Join-Path $RendererDir "config.json"
if (-not (Test-Path $configPath)) {
    $configJson = $config | ConvertTo-Json -Depth 8
    [System.IO.File]::WriteAllText($configPath, $configJson, [System.Text.UTF8Encoding]::new($false))
    Write-Host "Created local renderer config: $configPath" -ForegroundColor Green
} else {
    Write-Host "Existing config.json found; not overwriting it." -ForegroundColor Yellow
}

Copy-Item (Join-Path $ToolDir "start-rcc.ps1") (Join-Path $HostRoot "start-rcc.ps1") -Force
Copy-Item (Join-Path $ToolDir "start-renderer.ps1") (Join-Path $HostRoot "start-renderer.ps1") -Force
Copy-Item (Join-Path $ToolDir "README.md") (Join-Path $HostRoot "README-Pekora-RCC.txt") -Force

Write-Host ""
Write-Host "Preparation complete." -ForegroundColor Green
Write-Host "Next: inspect and scan the upstream RCC executable before running it."
Write-Host "Then start RCC and the renderer in separate PowerShell windows."
Write-Host "NOTE: avatar rendering requires the Pekora Worker deployment and an authenticated Cloudflare Tunnel connection."
