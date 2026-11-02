$ErrorActionPreference = "Stop"
$RendererDir = "C:\Pekora-RCC-Host\OpenPekora\game-renderer"

$RendererSecret = [Environment]::GetEnvironmentVariable("PEKORA_RENDERER_SECRET", "User")
if ([string]::IsNullOrWhiteSpace($RendererSecret) -or $RendererSecret.Length -lt 32) {
    throw "PEKORA_RENDERER_SECRET is missing. Run configure-renderer-secret.ps1 first, then add the same value as the AVATAR_RENDERER_SECRET Worker secret."
}
$env:PEKORA_RENDERER_SECRET = $RendererSecret

if (-not (Test-Path (Join-Path $RendererDir "package.json"))) {
    throw "Renderer files not found. Run setup.ps1 first."
}
if (-not (Test-Path (Join-Path $RendererDir "config.json"))) {
    throw "Renderer config.json is missing. Run setup.ps1 first."
}

$MainFile = Join-Path $RendererDir "src\Main.ts"
if (-not (Test-Path $MainFile)) { throw "Upstream renderer entry point src/Main.ts was not found." }
$MainSource = [System.IO.File]::ReadAllText($MainFile)

$AuthMarker = "// PEKORA_RENDERER_SHARED_SECRET_AUTH"
if (-not $MainSource.Contains($AuthMarker)) {
    $JsonMiddleware = "App.use(express.json());"
    $AuthMiddleware = @'
App.use(express.json());

// PEKORA_RENDERER_SHARED_SECRET_AUTH
const expectedRendererSecret = process.env.PEKORA_RENDERER_SECRET || "";
function constantTimeSecretEqual(left: string, right: string): boolean {
    if (!left || !right || left.length !== right.length) return false;
    let mismatch = 0;
    for (let i = 0; i < left.length; i++) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
    return mismatch === 0;
}
App.use((req, res, next) => {
    if (req.method === "GET" && req.path === "/") return next();
    if (!expectedRendererSecret) return res.status(503).json({ success: false, message: "Renderer secret is not configured." });
    const suppliedSecret = String(req.headers["x-pekora-renderer-secret"] || "");
    if (!constantTimeSecretEqual(suppliedSecret, expectedRendererSecret)) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    return next();
});
'@
    if (-not $MainSource.Contains($JsonMiddleware)) {
        throw "Could not find express.json() insertion point in renderer Main.ts."
    }
    $MainSource = $MainSource.Replace($JsonMiddleware, $AuthMiddleware.TrimEnd())
    [System.IO.File]::WriteAllText($MainFile, $MainSource, [System.Text.UTF8Encoding]::new($false))
    Write-Host "Added shared-secret authentication to renderer routes." -ForegroundColor Green
} else {
    Write-Host "Shared-secret authentication is already present." -ForegroundColor Green
}
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
