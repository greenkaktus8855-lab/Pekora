$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$rccDir = Join-Path $repoRoot "RCCService\RCCService2020"
$rccExe = Join-Path $rccDir "RCCService.exe"
$settingsPath = Join-Path $rccDir "Settings.json"
$configPath = Join-Path $repoRoot "game-renderer\config.json"
$rendererDir = Join-Path $repoRoot "game-renderer"
$baseControllerPath = Join-Path $rendererDir "src\Controllers\BaseController.ts"
$requestPath = Join-Path $rendererDir "src\Utilities\Libraries\Request.ts"
$ports = @(1621, 2621, 3621, 4621)
$legacyPort = 64989

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdministrator)) {
    throw "Run PowerShell as Administrator. The script adds Windows Firewall rules so RCCService stays local-only."
}
if (-not (Test-Path -LiteralPath $rccExe)) { throw "RCCService 2020 executable not found: $rccExe" }
if (-not (Test-Path -LiteralPath $configPath)) { throw "game-renderer\config.json was not found: $configPath" }
if (-not (Test-Path -LiteralPath $settingsPath)) {
    [System.IO.File]::WriteAllText($settingsPath, '{"applicationSettings":{}}', [System.Text.UTF8Encoding]::new($false))
}

# Match the upstream OpenPekora RCCService 2020 port layout:
# Player=1621, Image=2621, Game/Place=3621, Catalog=4621.
try { $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json }
catch { throw "game-renderer\config.json is not valid JSON. No changes were made. $($_.Exception.Message)" }

if (-not $config.Ports) { throw "config.json is missing Ports. Restore the normal OpenPekora renderer config first." }
if (-not $config.Ports.RCC) { $config.Ports | Add-Member -MemberType NoteProperty -Name RCC -Value ([pscustomobject]@{}) }
function Set-ConfigValue($Object, [string]$Name, $Value) {
    if ($Object.PSObject.Properties[$Name]) { $Object.$Name = $Value }
    else { $Object | Add-Member -MemberType NoteProperty -Name $Name -Value $Value }
}
Set-ConfigValue $config "RCCUrl" "http://127.0.0.1"
Set-ConfigValue $config.Ports.RCC "All" @($ports)
Set-ConfigValue $config.Ports.RCC "Player" @(1621)
Set-ConfigValue $config.Ports.RCC "Image" @(2621)
Set-ConfigValue $config.Ports.RCC "Place" @(3621)
Set-ConfigValue $config.Ports.RCC "Catalog" @(4621)
if (-not $config.Paths) { $config | Add-Member -MemberType NoteProperty -Name Paths -Value ([pscustomobject]@{}) }
Set-ConfigValue $config.Paths "RCCService" "..\RCCService\RCCService2020"
[System.IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 30), [System.Text.UTF8Encoding]::new($false))
Write-Host "Renderer config now points to the four local RCCService 2020 ports."

# The renderer should show a useful error if RCC returns no SOAP response.
if (-not (Test-Path -LiteralPath $baseControllerPath)) { throw "Renderer source not found: $baseControllerPath" }
$baseSource = [System.IO.File]::ReadAllText($baseControllerPath)
$oldCall = "    const response: any = await RCCRequest(port, xml, request.jobExpiration);"
$newCall = @(
    '    const response: any = await RCCRequest(port, xml, request.jobExpiration);',
    '    if (typeof response !== "string" || !response.trim()) {',
    '        return Resp(res, 503, "RCCService did not return a SOAP response. Check RCCService 2020 on the configured render ports.", false);',
    '    }'
) -join [Environment]::NewLine
if ($baseSource.Contains($oldCall) -and -not $baseSource.Contains("RCCService did not return a SOAP response.")) {
    $backup = "$baseControllerPath.sakura-backup"
    if (-not (Test-Path -LiteralPath $backup)) { Copy-Item -LiteralPath $baseControllerPath -Destination $backup }
    $baseSource = $baseSource.Replace($oldCall, $newCall)
    [System.IO.File]::WriteAllText($baseControllerPath, $baseSource, [System.Text.UTF8Encoding]::new($false))
} elseif (-not $baseSource.Contains("RCCService did not return a SOAP response.")) {
    throw "BaseController.ts did not match the expected OpenPekora source. No patch was applied."
}

# Log RCC HTTP status and body locally instead of silently turning every 502 into null.
if (Test-Path -LiteralPath $requestPath) {
    $requestSource = [System.IO.File]::ReadAllText($requestPath)
    if (-not $requestSource.Contains("RCC HTTP response status:")) {
        $tick = [char]96
        $oldLog = '        Console.Error(' + $tick + 'Error occurred while requesting to RCC: ' + [char]36 + '{e.message}' + $tick + ');'
        $newLog = @(
            '        if (axios.isAxiosError(e) && e.response) {',
            '            Console.Error("RCC HTTP response status: " + e.response.status + "; body: " + String(e.response.data ?? "").slice(0, 500));',
            '        } else {',
            '            Console.Error("RCC connection error: " + e.message);',
            '        }'
        ) -join [Environment]::NewLine
        if ($requestSource.Contains($oldLog)) {
            $backup = "$requestPath.sakura-backup"
            if (-not (Test-Path -LiteralPath $backup)) { Copy-Item -LiteralPath $requestPath -Destination $backup }
            $requestSource = $requestSource.Replace($oldLog, $newLog)
            [System.IO.File]::WriteAllText($requestPath, $requestSource, [System.Text.UTF8Encoding]::new($false))
        }
    }
}

# RCCService 2020 has no authentication of its own. Block all inbound access to
# its ports; the local renderer can still reach 127.0.0.1.
$blockedPorts = @($legacyPort) + $ports
foreach ($port in $blockedPorts) {
    $ruleName = "Sakura RCC local-only TCP $port"
    if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort $port -Action Block -Profile Any | Out-Null
    }
}

if (-not (Test-Path -LiteralPath (Join-Path $rendererDir "package.json"))) { throw "game-renderer package.json was not found." }
Push-Location $rendererDir
try {
    Write-Host "Building the patched OpenPekora renderer..."
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "Renderer build failed with exit code $LASTEXITCODE." }
} finally { Pop-Location }

# Stop a legacy RCCService on 64989 if it is still running from the earlier setup.
$legacy = Get-NetTCPConnection -LocalPort $legacyPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($legacy) {
    $legacyProcess = Get-Process -Id $legacy.OwningProcess -ErrorAction SilentlyContinue
    if ($legacyProcess -and $legacyProcess.ProcessName -match "^RCCService") {
        Write-Host "Stopping the old RCCService instance on port $legacyPort..."
        Stop-Process -Id $legacy.OwningProcess -Force
    }
}

# Only stop an existing RCCService process on the four ports we are about to use.
foreach ($port in $ports) {
    $existing = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($existing) {
        $existingProcess = Get-Process -Id $existing.OwningProcess -ErrorAction SilentlyContinue
        if (-not $existingProcess -or $existingProcess.ProcessName -notmatch "^RCCService") {
            throw "Port $port is occupied by another process. It was not stopped."
        }
        Stop-Process -Id $existing.OwningProcess -Force
    }
}
Start-Sleep -Seconds 2

$started = @()
foreach ($port in $ports) {
    Write-Host "Starting RCCService 2020 on 127.0.0.1:$port..."
    $process = Start-Process -FilePath $rccExe -ArgumentList @(
        "-Console", "-verbose", "-settingsfile", "Settings.json", "-port", "$port"
    ) -WorkingDirectory $rccDir -PassThru
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Seconds 1
        $process.Refresh()
        if ($process.HasExited) { throw "RCCService 2020 exited on port $port with code $($process.ExitCode). Check its console output." }
        $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($listener -and $listener.OwningProcess -eq $process.Id) { $ready = $true; break }
    }
    if (-not $ready) { throw "RCCService 2020 did not open port $port within 30 seconds." }
    $started += $port
}

Write-Host ""
Write-Host "RCCService 2020 is running on the four OpenPekora render ports: $($started -join ', ')." -ForegroundColor Green
Write-Host "Inbound firewall blocks were added. Renderer connections must use 127.0.0.1."
Write-Host "The renderer config and TypeScript build are ready. Start the secured renderer process next."
