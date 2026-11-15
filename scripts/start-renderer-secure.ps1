$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$candidateRoots = @(
    $env:SAKURA_OPENPEKORA_ROOT,
    $repoRoot,
    (Join-Path $repoRoot "OpenPekora"),
    "C:\Pekora-RCC-Host\OpenPekora"
) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique

$openPekoraRoot = $null
foreach ($candidate in $candidateRoots) {
    $candidateRenderer = Join-Path $candidate "game-renderer"
    if (Test-Path -LiteralPath (Join-Path $candidateRenderer "package.json")) {
        $openPekoraRoot = $candidate
        break
    }
}
if (-not $openPekoraRoot) {
    throw "Could not find the OpenPekora checkout. Expected game-renderer\package.json under C:\Pekora-RCC-Host\OpenPekora or beside this Sakura repository."
}

$rendererDir = Join-Path $openPekoraRoot "game-renderer"
$configPath = Join-Path $rendererDir "config.json"
$mainPath = Join-Path $rendererDir "src\Main.ts"
$playerControllerPath = Join-Path $rendererDir "src\Controllers\PlayerController.ts"
if (-not (Test-Path -LiteralPath $mainPath)) { throw "OpenPekora Renderer source was not found: $mainPath" }
if (-not (Test-Path -LiteralPath $playerControllerPath)) { throw "OpenPekora PlayerController source was not found: $playerControllerPath" }
if (-not (Test-Path -LiteralPath $configPath)) { throw "game-renderer\config.json was not found: $configPath" }

try { $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json }
catch { throw "game-renderer\config.json is invalid JSON: $($_.Exception.Message)" }

# Use the private bridge URL as the source of truth so the Worker,
# RCC bridge and local Renderer all receive exactly the same secret.
$secret = ""
$bridgeBaseUrl = [string]$config.BaseUrl
if ($bridgeBaseUrl -match '/_sakura-rcc/([^/]+)/') {
    $secret = [Uri]::UnescapeDataString($Matches[1])
}
if ([string]::IsNullOrWhiteSpace($secret)) {
    $secret = [string]$env:PEKORA_RENDERER_SECRET
}
if ([string]::IsNullOrWhiteSpace($secret)) {
    $secureSecret = Read-Host "Enter the SAME value as Cloudflare Worker secret AVATAR_RENDERER_SECRET" -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
    try {
        $secret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}
if ([string]::IsNullOrWhiteSpace($secret) -or $secret.Length -lt 24) {
    throw "The renderer secret must contain at least 24 characters. Nothing was started."
}

# The same secret must protect both the private Sakura bridge and the
# Cloudflare Worker -> Renderer request. Sync it automatically from the
# existing private BaseUrl so nobody has to copy a secret by hand.
$wranglerConfig = Join-Path $repoRoot "wrangler.toml"
if (-not (Test-Path -LiteralPath $wranglerConfig)) {
    throw "Sakura wrangler.toml was not found at $wranglerConfig. Cannot synchronize renderer authentication."
}

$syncStateDir = Join-Path $env:LOCALAPPDATA "Sakura"
$syncStateFile = Join-Path $syncStateDir "renderer-secret.sha256"
$sha256 = [System.Security.Cryptography.SHA256]::Create()
try {
    $secretHash = [Convert]::ToBase64String($sha256.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($secret)))
} finally {
    $sha256.Dispose()
}

$previousSecretHash = ""
if (Test-Path -LiteralPath $syncStateFile) {
    $previousSecretHash = (Get-Content -LiteralPath $syncStateFile -Raw).Trim()
}

if ($previousSecretHash -ne $secretHash) {
    Write-Host "Synchronizing the Sakura Worker renderer secret from the existing local config..."
    $npxCmd = (Get-Command "npx.cmd" -ErrorAction Stop).Source
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $env:ComSpec
    $wranglerCommand = '"' + $npxCmd + '" wrangler secret put AVATAR_RENDERER_SECRET --name sakura --config "' + $wranglerConfig + '"'
    $psi.Arguments = '/d /s /c "' + $wranglerCommand + '"'
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.WorkingDirectory = $repoRoot
    $psi.RedirectStandardInput = $true

    $wranglerProcess = New-Object System.Diagnostics.Process
    $wranglerProcess.StartInfo = $psi
    try {
        if (-not $wranglerProcess.Start()) {
            throw "Could not start Wrangler to synchronize AVATAR_RENDERER_SECRET."
        }
        $wranglerProcess.StandardInput.WriteLine($secret)
        $wranglerProcess.StandardInput.Close()
        $wranglerProcess.WaitForExit()
        if ($wranglerProcess.ExitCode -ne 0) {
            throw "Wrangler could not update the Sakura Worker secret (exit code $($wranglerProcess.ExitCode)). Check that Wrangler is logged in to the correct Cloudflare account."
        }
    } finally {
        $wranglerProcess.Dispose()
    }

    if (-not (Test-Path -LiteralPath $syncStateDir)) {
        New-Item -ItemType Directory -Path $syncStateDir -Force | Out-Null
    }
    [System.IO.File]::WriteAllText($syncStateFile, $secretHash, [System.Text.UTF8Encoding]::new($false))
    Write-Host "Sakura Worker secret synchronized successfully."
} else {
    Write-Host "Sakura Worker secret is already synchronized with the local renderer config."
}

# GitHub updates do not deploy Cloudflare Workers by themselves. Publish the
# current Sakura source before starting RCC/Renderer so avatar fixes are live.
$npxCmd = (Get-Command "npx.cmd" -ErrorAction Stop).Source
Write-Host "Deploying the updated Sakura Worker to Cloudflare..."
& $npxCmd wrangler deploy --config $wranglerConfig
if ($LASTEXITCODE -ne 0) {
    throw "Sakura Worker deployment failed (exit code $LASTEXITCODE). The Renderer was not restarted."
}
Write-Host "Sakura Worker deployment completed."

$port = [int]$config.Ports.Process
if ($port -lt 1 -or $port -gt 65535) { throw "Ports.Process in config.json is invalid." }

$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
    $owner = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    $ownerInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
    if (-not $owner -or $owner.ProcessName -ne "node" -or $ownerInfo.CommandLine -notmatch 'dist[\\/]Main\.js') {
        $ownerName = if ($owner) { $owner.ProcessName } else { "unknown" }
        throw "Port $port is occupied by $ownerName (PID $($listener.OwningProcess)), not the expected Sakura Renderer. It was not stopped."
    }

    # The running Node process still has the previous secret in its environment.
    # Restart this exact Renderer process so the newly synchronized secret takes effect.
    Write-Host "Restarting the existing Sakura Renderer to load the synchronized secret..."
    Stop-Process -Id $listener.OwningProcess -Force
    $released = $false
    for ($attempt = 0; $attempt -lt 15; $attempt++) {
        Start-Sleep -Seconds 1
        $remaining = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $remaining) { $released = $true; break }
    }
    if (-not $released) {
        throw "The previous Sakura Renderer did not release port $port. Close its old console window and run this repair again."
    }
}

$mainSource = [System.IO.File]::ReadAllText($mainPath)
$mainChanged = $false
if (-not $mainSource.Contains("x-pekora-renderer-secret")) {
    $expressImport = 'import express from "ultimate-express";'
    if (-not $mainSource.Contains($expressImport)) { throw "Main.ts does not match the expected OpenPekora source. No patch was applied." }
    if (-not $mainSource.Contains('import { timingSafeEqual } from "node:crypto";')) {
        $mainSource = $mainSource.Replace($expressImport, $expressImport + [Environment]::NewLine + 'import { timingSafeEqual } from "node:crypto";')
    }
    $jsonParser = "App.use(express.json());"
    if (-not $mainSource.Contains($jsonParser)) { throw "Main.ts JSON parser line was not found. No patch was applied." }
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
    $mainSource = $mainSource.Replace($jsonParser, $auth.TrimEnd())
    $mainChanged = $true
}

# Keep the Renderer HTTP listener local. Cloudflare Tunnel can still reach it.
if (-not $mainSource.Contains('App.listen(ProcessPort, "127.0.0.1"')) {
    $listenPattern = 'App\.listen\(ProcessPort,\s*\(\)\s*=>'
    if (-not [regex]::IsMatch($mainSource, $listenPattern)) { throw "Main.ts listen statement did not match the expected source. No bind change was applied." }
    $mainSource = [regex]::Replace($mainSource, $listenPattern, 'App.listen(ProcessPort, "127.0.0.1", () =>', 1)
    $mainChanged = $true
}

# RCC may cache CharacterAppearance responses by URL. Give every render a
# unique URL so rig, body colors, scales and worn items are always re-fetched.
$playerSource = [System.IO.File]::ReadAllText($playerControllerPath)
$playerChanged = $false

# The v1.1 response expects accessory VERSION IDs. Sakura stores catalog ASSET
# IDs, so the renderer must call v1/avatar-fetch, whose contract accepts
# assetAndAssetTypeIds and BrickColor/scales data directly.
if ($playerSource.Contains("v1.1/avatar-fetch?")) {
    $playerSource = $playerSource.Replace("v1.1/avatar-fetch?", "v1/avatar-fetch?")
    $playerChanged = $true
    Write-Host "Switched CharacterAppearance to the v1 avatar-fetch contract."
}

# RCC may cache CharacterAppearance responses by URL. Give every render a
# unique URL so rig, body colors, scales and worn items are always re-fetched.
$avatarDiagnosticMarker = "[Sakura AvatarFetch diagnostic]"
if (-not $playerSource.Contains("assetFiles=")) {
    $diagnosticNeedle = 'Console.Debug(`Queueing 3D Player thumbnail request with UserId ${req.body.userId}`);'
    $diagnosticCode = @'
try {
        const avatarResponse = await fetch(charAppUrl, { headers: { accept: "application/json" } });
        const avatarData: any = await avatarResponse.json();
        const avatarAssetRows = Array.isArray(avatarData?.assetAndAssetTypeIds) ? avatarData.assetAndAssetTypeIds : [];
        const avatarAssetTypes = [...new Set(avatarAssetRows.map((asset: any) => Number(asset.assetTypeId)).filter(Number.isFinite))];
        const assetDeliveryChecks = await Promise.all(avatarAssetRows.map(async (asset: any) => {
            const assetId = Number(asset?.assetId);
            if (!Number.isSafeInteger(assetId) || assetId < 1) return "invalid-id";
            try {
                const assetResponse = await fetch(`${Config.BaseUrl}v1/asset?id=${assetId}`, { headers: { accept: "*/*" } });
                const status = assetResponse.status;
                const contentType = assetResponse.headers.get("content-type") ?? "unknown";
                const responseText = status === 200 ? "" : (await assetResponse.text().catch(() => "")).replace(/\\s+/g, " ").slice(0, 180);
                let responseDetail = responseText;
                try {
                    const parsed = JSON.parse(responseText);
                    responseDetail = `${parsed?.upstreamStatus ? "upstream=" + parsed.upstreamStatus + ";" : ""}${parsed?.upstreamMessage ?? parsed?.error ?? responseText}`;
                } catch {}
                return `${assetId}:${status}:${contentType}${responseDetail ? ":" + responseDetail : ""}`;
            } catch (assetError) {
                return `${assetId}:error:${String(assetError)}`;
            }
        }));
        Console.Debug(`[Sakura AvatarFetch diagnostic] HTTP ${avatarResponse.status}; rig=${avatarData?.resolvedAvatarType ?? avatarData?.playerAvatarType ?? "unknown"}; assets=${avatarAssetRows.length}; assetTypes=${avatarAssetTypes.join(",") || "none"}; assetFiles=${assetDeliveryChecks.join(";") || "none"}; colors=${JSON.stringify(avatarData?.bodyColors ?? null)}; scales=${JSON.stringify(avatarData?.scales ?? null)}`);
    } catch (avatarError) {
        Console.Debug(`[Sakura AvatarFetch diagnostic] Request failed: ${String(avatarError)}`);
    }
'@
    if (-not $playerSource.Contains($diagnosticNeedle)) {
        throw "Could not find the OpenPekora 3D thumbnail request for avatar diagnostics. No diagnostic patch was applied."
    }
    $playerSource = $playerSource.Replace($diagnosticNeedle, $diagnosticCode + "`r`n    " + $diagnosticNeedle)
    $playerChanged = $true
}

if (-not $playerSource.Contains("&sakuraRender=")) {
    $oldAvatarUrl = 'const charAppUrl = `${Config.BaseUrl}v1/avatar-fetch?placeId=0&userId=${req.body.userId}`;'
    $newAvatarUrl = 'const charAppUrl = `${Config.BaseUrl}v1/avatar-fetch?placeId=0&userId=${req.body.userId}&sakuraRender=${Date.now()}-${Math.random().toString(36).slice(2)}`;'
    $avatarUrlMatchCount = [regex]::Matches($playerSource, [regex]::Escape($oldAvatarUrl)).Count
    if ($avatarUrlMatchCount -lt 1) {
        throw "PlayerController.ts v1 avatar-fetch URL did not match the expected OpenPekora source. No cache-busting patch was applied."
    }
    $playerSource = $playerSource.Replace($oldAvatarUrl, $newAvatarUrl)
    $playerChanged = $true
}

if ($mainChanged) {
    $backup = "$mainPath.sakura-backup"
    if (-not (Test-Path -LiteralPath $backup)) { Copy-Item -LiteralPath $mainPath -Destination $backup }
    [System.IO.File]::WriteAllText($mainPath, $mainSource, [System.Text.UTF8Encoding]::new($false))
    Write-Host "Applied Renderer authentication and loopback-only binding."
} else {
    Write-Host "Renderer authentication and loopback-only binding are already present."
}

if ($playerChanged) {
    $backup = "$playerControllerPath.sakura-backup"
    if (-not (Test-Path -LiteralPath $backup)) { Copy-Item -LiteralPath $playerControllerPath -Destination $backup }
    [System.IO.File]::WriteAllText($playerControllerPath, $playerSource, [System.Text.UTF8Encoding]::new($false))
    Write-Host "Applied a unique CharacterAppearance URL for each avatar render."
} else {
    Write-Host "Avatar CharacterAppearance cache-busting is already present."
}

$env:PEKORA_RENDERER_SECRET = $secret
$secret = $null
$secureSecret = $null

$npmCmd = (Get-Command "npm.cmd" -ErrorAction Stop).Source
Push-Location $rendererDir
try {
    Write-Host "Building OpenPekora Renderer..."
    & $npmCmd run build
    if ($LASTEXITCODE -ne 0) { throw "Renderer build failed with exit code $LASTEXITCODE." }

    Write-Host ""
    Write-Host "Starting secured Renderer on port $port."
    Write-Host "Keep this PowerShell window open. RCCService should stay local-only."
    & $npmCmd start
    if ($LASTEXITCODE -ne 0) { throw "Renderer exited with code $LASTEXITCODE." }
} finally {
    Pop-Location
    Remove-Item Env:PEKORA_RENDERER_SECRET -ErrorAction SilentlyContinue
}
