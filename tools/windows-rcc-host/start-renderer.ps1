$ErrorActionPreference = "Stop"
$RendererDir = "C:\Pekora-RCC-Host\OpenPekora\game-renderer"

if (-not (Test-Path (Join-Path $RendererDir "package.json"))) {
    throw "Renderer files not found. Run setup.ps1 first."
}
if (-not (Test-Path (Join-Path $RendererDir "config.json"))) {
    throw "Renderer config.json is missing. Run setup.ps1 first."
}

Set-Location $RendererDir
Write-Host "Installing upstream renderer dependencies..." -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install failed." }

Write-Host "Building upstream TypeScript renderer..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw "Renderer build failed." }

Write-Host "Starting renderer on port 3001..." -ForegroundColor Green
npm start
