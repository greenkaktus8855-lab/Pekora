$ErrorActionPreference = "Stop"
$RendererDir = "C:\Pekora-RCC-Host\OpenPekora\game-renderer"

if (-not (Test-Path (Join-Path $RendererDir "package.json"))) {
    throw "Renderer files not found. Run setup.ps1 first."
}
if (-not (Test-Path (Join-Path $RendererDir "config.json"))) {
    throw "Renderer config.json is missing. Run setup.ps1 first."
}

$MainFile = Join-Path $RendererDir "src\Main.ts"
if (-not (Test-Path $MainFile)) { throw "Upstream renderer entry point src/Main.ts was not found." }
$MainSource = [System.IO.File]::ReadAllText($MainFile)
$ListenOriginal = 'App.listen(ProcessPort, () => Console.Log(`Renderer started on port &a&l${ProcessPort}`));'
$ListenLocal = 'App.listen(ProcessPort, "127.0.0.1", () => Console.Log(`Renderer started on port &a&l${ProcessPort}`));'
if ($MainSource.Contains($ListenOriginal)) {
    $MainSource = $MainSource.Replace($ListenOriginal, $ListenLocal)
    [System.IO.File]::WriteAllText($MainFile, $MainSource, [System.Text.UTF8Encoding]::new($false))
    Write-Host "Restricted renderer listener to 127.0.0.1." -ForegroundColor Green
} elseif (-not $MainSource.Contains($ListenLocal)) {
    throw "Could not safely restrict the renderer listener. Review upstream src/Main.ts before continuing."
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
