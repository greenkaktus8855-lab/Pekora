$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$rendererDir = Join-Path $repoRoot "game-renderer"
$configPath = Join-Path $rendererDir "config.json"
$mainPath = Join-Path $rendererDir "src\Main.ts"

if (-not (Test-Path -LiteralPath $mainPath)) {
    throw "OpenPekora Renderer source was not found: $mainPath"
}
if (-not (Test-Path -LiteralPath $configPath)) {
    throw "game-renderer\config.json was not found: $configPath"
}

$secureSecret = Read-Host "Enter the SAME value as Cloudflare Worker secret AVATAR_RENDERER_SECRET" -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
try {
    $secret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
}
if ([string]::IsNullOrWhiteSpace($secret) -or $secret.Length -lt 24) {
    throw "The renderer secret must contain at least 24 characters. Nothing was started."
}

try { $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json }
catch { throw "game-renderer\config.json is invalid JSON: $($_.Exception.Message)" }
$port = [int]$config.Ports.Process
if ($port -lt 1 -or $port -gt 65535) { throw "Ports.Process in config.json is invalid." }

$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
    $owner = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    throw "Port $port is already in use by $($owner.ProcessName) (PID $($listener.OwningProcess)). Stop the old Renderer process first, then run this script again."
}

$source = [System.IO.File]::ReadAllText($mainPath)
if (-not $source.Contains("x-pekora-renderer-secret")) {
    $expressImport = 'import express from "ultimate-express";'
    if (-not $source.Contains($expressImport)) { throw "Main.ts does not match the expected OpenPekora source. No patch was applied." }
    if (-not $source.Contains('import { timingSafeEqual } from "node:crypto";')) {
        $source = $source.Replace($expressImport, $expressImport + [Environment]::NewLine + 'import { timingSafeEqual } from "node:crypto";')
    }
    $jsonParser = "App.use(express.json());"
    if (-not $source.Contains($jsonParser)) { throw "Main.ts JSON parser line was not found. No patch was applied." }
    $auth = @'
App.use(express.json());

const rendererSecret = String(process.env.PEKORA_RENDERER_SECRET || "").trim();
App.use((req: any, res: any, next: any) => {
    if (req.path === "/") return next();
    if (!rendererSecret) return res.status(503).send("Renderer secret is not configured.");
    const expected = Buffer.from(rendererSecret, "utf8");
    const supplied = Buffer.from(String(req.headers["x-pekora-renderer-secret"] || ""), "utf8");
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
        return res.status(401).send("Unauthorized");
    }
    next();
});
'@
    $source = $source.Replace($jsonParser, $auth.TrimEnd())
    $backup = "$mainPath.sakura-backup"
    if (-not (Test-Path -LiteralPath $backup)) { Copy-Item -LiteralPath $mainPath -Destination $backup }
    [System.IO.File]::WriteAllText($mainPath, $source, [System.Text.UTF8Encoding]::new($false))
    Write-Host "Added shared-secret authentication to the Renderer."
} else {
    Write-Host "Renderer shared-secret authentication is already present."
}

$env:PEKORA_RENDERER_SECRET = $secret
$secret = $null
$secureSecret = $null

Push-Location $rendererDir
try {
    Write-Host "Building OpenPekora Renderer..."
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "Renderer build failed with exit code $LASTEXITCODE." }

    Write-Host ""
    Write-Host "Starting secured Renderer on port $port."
    Write-Host "Keep this PowerShell window open. RCCService should stay local-only."
    & npm start
    if ($LASTEXITCODE -ne 0) { throw "Renderer exited with code $LASTEXITCODE." }
} finally {
    Pop-Location
    Remove-Item Env:PEKORA_RENDERER_SECRET -ErrorAction SilentlyContinue
}
