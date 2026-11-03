$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$rccDir = Join-Path $repoRoot "RCCService\RCCService2020"
$rccExe = Join-Path $rccDir "RCCService.exe"
$configPath = Join-Path $repoRoot "game-renderer\config.json"
$rendererDir = Join-Path $repoRoot "game-renderer"
$baseControllerPath = Join-Path $rendererDir "src\Controllers\BaseController.ts"
$port = 64989

if (-not (Test-Path -LiteralPath $rccExe)) { throw "RCCService 2020 executable not found: $rccExe" }

if (Test-Path -LiteralPath $configPath) {
    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    if (-not $config.Paths) { $config | Add-Member -MemberType NoteProperty -Name Paths -Value ([pscustomobject]@{}) }
    $config.Paths.RCCService = "..\RCCService\RCCService2020"
    $json = $config | ConvertTo-Json -Depth 30
    [System.IO.File]::WriteAllText($configPath, $json, [System.Text.UTF8Encoding]::new($false))
    Write-Host "Renderer config now points to RCCService 2020."
} else { Write-Warning "game-renderer\config.json was not found." }

# Prevent the renderer from trying to parse a null RCC response as SOAP XML.
if (Test-Path -LiteralPath $baseControllerPath) {
    $source = [System.IO.File]::ReadAllText($baseControllerPath)
    $oldCall = "    const response: any = await RCCRequest(port, xml, request.jobExpiration);"
    $newCall = @(
        "    const response: any = await RCCRequest(port, xml, request.jobExpiration);",
        "    if (typeof response !== \"string\" || !response.trim()) {",
        "        return Resp(res, 503, \"RCCService did not return a SOAP response. Check RCCService 2020 and port 64989.\", false);",
        "    }"
    ) -join "`r`n"
    if ($source.Contains($oldCall) -and -not $source.Contains("RCCService did not return a SOAP response.")) {
        $backup = "$baseControllerPath.backup"
        if (-not (Test-Path -LiteralPath $backup)) { Copy-Item -LiteralPath $baseControllerPath -Destination $backup }
        $source = $source.Replace($oldCall, $newCall)
        [System.IO.File]::WriteAllText($baseControllerPath, $source, [System.Text.UTF8Encoding]::new($false))
        Write-Host "Fixed null RCC response handling in BaseController.ts."
    } elseif ($source.Contains("RCCService did not return a SOAP response.")) {
        Write-Host "RCC null-response handling is already patched."
    } else {
        throw "BaseController.ts did not match the expected OpenPekora source. No patch was applied."
    }
} else { throw "Renderer source not found: $baseControllerPath" }

if (-not (Test-Path -LiteralPath (Join-Path $rendererDir "package.json"))) { throw "game-renderer package.json was not found." }
Push-Location $rendererDir
try {
    Write-Host "Building the patched renderer..."
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "Renderer build failed with exit code $LASTEXITCODE." }
} finally { Pop-Location }

$existing = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existing) {
    $existingProcess = Get-Process -Id $existing.OwningProcess -ErrorAction SilentlyContinue
    if (-not $existingProcess -or $existingProcess.ProcessName -notmatch "^RCCService") { throw "Port $port is occupied by another process. It was not stopped." }
    Write-Host "Stopping old RCCService process on port $port..."
    Stop-Process -Id $existing.OwningProcess -Force
    Start-Sleep -Seconds 2
}

Write-Host "Starting compatible RCCService 2020 on port $port..."
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
Write-Host "RCC renderer error handling is patched and the TypeScript build completed." -ForegroundColor Green
Write-Host "Now restart start-renderer.ps1 so it loads the rebuilt files."
