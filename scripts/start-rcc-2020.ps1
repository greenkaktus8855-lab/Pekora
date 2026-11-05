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
    $candidateRcc = Join-Path $candidate "RCCService\RCCService2020"
    if ((Test-Path -LiteralPath (Join-Path $candidateRenderer "config.json")) -and (Test-Path -LiteralPath (Join-Path $candidateRcc "RCCService.exe"))) {
        $openPekoraRoot = $candidate
        break
    }
}
if (-not $openPekoraRoot) {
    throw "Could not find the OpenPekora checkout. Expected game-renderer\config.json and RCCService\RCCService2020\RCCService.exe under C:\Pekora-RCC-Host\OpenPekora or beside this Sakura repository."
}
$rccDir = Join-Path $openPekoraRoot "RCCService\RCCService2020"
$rccExe = Join-Path $rccDir "RCCService.exe"
$settingsPath = Join-Path $rccDir "Settings.json"
$configPath = Join-Path $openPekoraRoot "game-renderer\config.json"
$rendererDir = Join-Path $openPekoraRoot "game-renderer"
$baseControllerPath = Join-Path $rendererDir "src\Controllers\BaseController.ts"
$requestPath = Join-Path $rendererDir "src\Utilities\Libraries\Request.ts"
$soapPath = Join-Path $rendererDir "src\Utilities\Libraries\SOAP.ts"
if (-not (Test-Path -LiteralPath $soapPath)) { throw "Renderer SOAP helper not found: $soapPath" }
$ports = @(64989)
if (-not (Test-Path -LiteralPath $rccExe)) { throw "RCCService 2020 executable not found: $rccExe" }
if (-not (Test-Path -LiteralPath $configPath)) { throw "game-renderer\config.json was not found: $configPath" }
if (-not (Test-Path -LiteralPath $settingsPath)) {
    [System.IO.File]::WriteAllText($settingsPath, '{"applicationSettings":{}}', [System.Text.UTF8Encoding]::new($false))
}

# OpenPekora RCCService 2020 exposes its SOAP endpoint on TCP 64989.
try { $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json }
catch { throw "game-renderer\config.json is not valid JSON. No changes were made. $($_.Exception.Message)" }

if (-not $config.Ports) { throw "config.json is missing Ports. Restore the normal OpenPekora renderer config first." }
if (-not $config.Ports.RCC) { $config.Ports | Add-Member -MemberType NoteProperty -Name RCC -Value ([pscustomobject]@{}) }
function Set-ConfigValue($Object, [string]$Name, $Value) {
    if ($Object.PSObject.Properties[$Name]) { $Object.$Name = $Value }
    else { $Object | Add-Member -MemberType NoteProperty -Name $Name -Value $Value }
}
$platformBaseUrl = [string]$env:SAKURA_PLATFORM_URL
if ([string]::IsNullOrWhiteSpace($platformBaseUrl)) {
    $platformBaseUrl = "https://sakura.green-kaktus8855.workers.dev/"
}
try { $platformUri = [Uri]$platformBaseUrl }
catch { throw "SAKURA_PLATFORM_URL is not a valid URL: $platformBaseUrl" }
if (-not $platformUri.IsAbsoluteUri -or $platformUri.Scheme -ne "https" -or
    $platformUri.AbsolutePath -ne "/" -or $platformUri.Query -or $platformUri.Fragment) {
    throw "SAKURA_PLATFORM_URL must be an HTTPS site origin, for example https://sakura.green-kaktus8855.workers.dev/"
}
$platformBaseUrl = $platformUri.GetLeftPart([System.UriPartial]::Authority) + "/"
Set-ConfigValue $config "BaseUrl" $platformBaseUrl
Write-Host "Renderer avatar API base URL: $platformBaseUrl"
Set-ConfigValue $config "RCCUrl" "http://127.0.0.1"
$singleRccPort = @($ports)
Set-ConfigValue $config.Ports.RCC "All" $singleRccPort
Set-ConfigValue $config.Ports.RCC "Player" $singleRccPort
Set-ConfigValue $config.Ports.RCC "Image" $singleRccPort
Set-ConfigValue $config.Ports.RCC "Place" $singleRccPort
Set-ConfigValue $config.Ports.RCC "Catalog" $singleRccPort
if (-not $config.Paths) { $config | Add-Member -MemberType NoteProperty -Name Paths -Value ([pscustomobject]@{}) }
Set-ConfigValue $config.Paths "RCCService" "..\RCCService\RCCService2020"
[System.IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 30), [System.Text.UTF8Encoding]::new($false))
Write-Host "Renderer config now points to the local RCCService 2020 SOAP endpoint on port 64989."

# Patch the OpenPekora SOAP client to match the RCCService 2020 SOAP contract.
# Keep platform URL (BaseUrl) separate from the standard RCC SOAP namespace.
$lf = [string][char]10
$crlf = [string][char]13 + [string][char]10
$baseSource = [System.IO.File]::ReadAllText($baseControllerPath).Replace($crlf,$lf)
$requestSource = [System.IO.File]::ReadAllText($requestPath).Replace($crlf,$lf)
$soapSource = [System.IO.File]::ReadAllText($soapPath).Replace($crlf,$lf)

$newBaseBlock = @'
    let response: any;
    try {
        response = await RCCRequest(port, xml, request.jobExpiration);
    } catch (error: any) {
        const message = error instanceof Error ? error.message : String(error);
        Console.Error(type + " render failed before SOAP response: " + message);
        return Resp(res, 503, "RCCService SOAP request failed: " + message, false);
    }
    if (typeof response !== "string" || !response.trim()) {
        return Resp(res, 503, "RCCService returned an empty or non-text SOAP response. Check the RCC request log.", false);
    }
'@

$legacyBaseBlock = @'
    const response: any = await RCCRequest(port, xml, request.jobExpiration);
    if (typeof response !== "string" || !response.trim()) {
        return Resp(res, 503, "RCCService did not return a SOAP response. Check RCCService 2020 on the configured render ports.", false);
    }
'@

$directBaseCall = "    const response: any = await RCCRequest(port, xml, request.jobExpiration);"
if ($baseSource.Contains("RCCService SOAP request failed:")) {
    Write-Host "Renderer controller already contains detailed SOAP error handling."
} elseif ($baseSource.Contains($legacyBaseBlock)) {
    $baseSource = $baseSource.Replace($legacyBaseBlock, $newBaseBlock)
} elseif ($baseSource.Contains($directBaseCall)) {
    $baseSource = $baseSource.Replace($directBaseCall, $newBaseBlock.TrimEnd())
} else {
    throw "BaseController.ts did not match the known OpenPekora RCC call. No controller patch was applied."
}

# RCCService gSOAP expects the standard Roblox namespace and SOAPAction.
$oldHeaders = @'
        const headers = {
            "Content-Type": "text/xml",
        };
'@
$newHeaders = @'
        const headers = {
            "Content-Type": "text/xml; charset=utf-8",
            "SOAPAction": "http://roblox.com/BatchJob",
        };
'@
if ($requestSource.Contains($oldHeaders)) {
    $requestSource = $requestSource.Replace($oldHeaders, $newHeaders)
} elseif (-not $requestSource.Contains('"SOAPAction": "http://roblox.com/BatchJob"')) {
    throw "Request.ts HTTP headers did not match the expected OpenPekora source."
}

$oldSoapCall = 'const xml = SOAP(Config.BaseUrl, jobExpiration, JSON.stringify(data));'
$newSoapCall = 'const xml = SOAP("http://roblox.com/", jobExpiration, JSON.stringify(data));'
if ($requestSource.Contains($oldSoapCall)) {
    $requestSource = $requestSource.Replace($oldSoapCall, $newSoapCall)
} elseif (-not $requestSource.Contains('SOAP("http://roblox.com/", jobExpiration')) {
    throw "Request.ts SOAP namespace call did not match the expected source."
}
$requestSource = $requestSource.Replace('import Config from "./Config.js";' + $lf, "")

$oldTimeout = "timeout: jobExpiration * 1000,"
$newTimeout = "timeout: (jobExpiration + 15) * 1000,"
if ($requestSource.Contains($oldTimeout)) {
    $requestSource = $requestSource.Replace($oldTimeout, $newTimeout)
}

# Preserve the actual HTTP/network error rather than returning null or AxiosResponse.
$rccStart = $requestSource.IndexOf("export const RCCRequest")
$catchStart = $requestSource.IndexOf("    } catch (e: any) {", $rccStart)
$catchMarker = $lf + "    }" + $lf + "};"
$catchEnd = if ($catchStart -ge 0) { $requestSource.IndexOf($catchMarker, $catchStart) } else { -1 }
if ($rccStart -lt 0 -or $catchStart -lt 0 -or $catchEnd -lt 0) {
    throw "Could not locate the RCCRequest error handler in Request.ts."
}
$newCatch = @'
    } catch (e: any) {
        if (axios.isAxiosError(e)) {
            const status = e.response?.status;
            const responseBody = e.response?.data;
            const detail = responseBody === undefined
                ? ""
                : (typeof responseBody === "string" ? responseBody : JSON.stringify(responseBody)).slice(0, 500);
            const message = status
                ? "RCCService returned HTTP " + status + ": " + (detail || e.message)
                : "RCCService request failed" + (e.code ? " (" + e.code + ")" : "") + ": " + e.message;
            Console.Error(message);
            throw new Error(message);
        }
        const message = e instanceof Error ? e.message : String(e);
        Console.Error("RCCService request failed: " + message);
        throw new Error("RCCService request failed: " + message);
    }
'@
$requestSource = $requestSource.Substring(0, $catchStart) + $newCatch.TrimEnd() + $requestSource.Substring($catchEnd + $catchMarker.Length - 3)

# The RCC Job structure requires a category; category 1 is used for thumbnail jobs.
$oldJobFields = @'
            <ns1:expirationInSeconds>\${jobExpiration}</ns1:expirationInSeconds>
            <ns1:cores>1</ns1:cores>
'@
$newJobFields = @'
            <ns1:expirationInSeconds>\${jobExpiration}</ns1:expirationInSeconds>
            <ns1:category>1</ns1:category>
            <ns1:cores>1</ns1:cores>
'@
if ($soapSource.Contains($oldJobFields)) {
    $soapSource = $soapSource.Replace($oldJobFields, $newJobFields)
} elseif (-not $soapSource.Contains("<ns1:category>1</ns1:category>")) {
    throw "SOAP.ts job structure did not match the expected OpenPekora source."
}

foreach ($file in @($baseControllerPath, $requestPath, $soapPath)) {
    $fileSource = if ($file -eq $baseControllerPath) { $baseSource } elseif ($file -eq $requestPath) { $requestSource } else { $soapSource }
    $backup = "$file.sakura-backup"
    if (-not (Test-Path -LiteralPath $backup)) { Copy-Item -LiteralPath $file -Destination $backup }
    [System.IO.File]::WriteAllText($file, $fileSource, [System.Text.UTF8Encoding]::new($false))
}
Write-Host "Applied RCC SOAPAction, standard SOAP namespace, thumbnail job category, extended timeout and detailed error handling."

# RCCService 2020 has no authentication of its own. Block all inbound access to
# its ports; the local renderer can still reach 127.0.0.1.
$blockedPorts = $ports
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

$logDir = [string]$env:SAKURA_RENDERER_LOG_DIR
if ([string]::IsNullOrWhiteSpace($logDir)) {
    $logDir = Join-Path $env:LOCALAPPDATA "SakuraRenderer\logs"
}
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

$started = @()
foreach ($port in $ports) {
    Write-Host "Starting RCCService 2020 on 127.0.0.1:$port..."
    $process = Start-Process -FilePath $rccExe -ArgumentList @(
        "-Console", "-verbose", "-settingsfile", "Settings.json", "-port", "$port"
    ) -WorkingDirectory $rccDir -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir "rcc-$port-out.log") -RedirectStandardError (Join-Path $logDir "rcc-$port-error.log") -PassThru
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

# Verify the actual SOAP endpoint; a listening TCP port alone is not sufficient.
$probeLog = Join-Path $logDir "rcc-soap-probe.log"
$probeXml = @'
<?xml version="1.0" encoding="utf-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="http://roblox.com/">
  <SOAP-ENV:Header/>
  <SOAP-ENV:Body>
    <ns1:GetStatus/>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>
'@
try {
    $statusResponse = Invoke-WebRequest -Uri "http://127.0.0.1:64989" -Method Post -ContentType "text/xml; charset=utf-8" -Headers @{ SOAPAction = "http://roblox.com/GetStatus" } -Body $probeXml -UseBasicParsing -TimeoutSec 15
    $statusBody = [string]$statusResponse.Content
    if ([int]$statusResponse.StatusCode -ne 200 -or $statusBody -notmatch "GetStatusResponse") {
        $sample = $statusBody.Substring(0,[Math]::Min(500,$statusBody.Length))
        throw "RCC returned HTTP $($statusResponse.StatusCode) without a valid GetStatus SOAP response: $sample"
    }
    $sample = $statusBody.Substring(0,[Math]::Min(1000,$statusBody.Length))
    [System.IO.File]::WriteAllText($probeLog, "SOAP GetStatus succeeded." + [Environment]::NewLine + $sample, [System.Text.UTF8Encoding]::new($false))
    Write-Host "RCC SOAP GetStatus succeeded on 127.0.0.1:64989." -ForegroundColor Green
} catch {
    $probeError = $_.Exception.Message
    try {
        if ($_.Exception.Response) {
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $responseText = $reader.ReadToEnd()
            if ($responseText) { $probeError += " | Response: " + $responseText.Substring(0,[Math]::Min(500,$responseText.Length)) }
            $reader.Dispose()
        }
    } catch {}
    [System.IO.File]::WriteAllText($probeLog, "SOAP GetStatus failed: " + $probeError, [System.Text.UTF8Encoding]::new($false))
    throw "RCCService is listening, but SOAP GetStatus failed. $probeError. See $probeLog"
}

Write-Host ""
Write-Host "RCCService 2020 is running on the OpenPekora SOAP port: $($started -join ', ')." -ForegroundColor Green
Write-Host "Inbound firewall blocks were added. Renderer connections must use 127.0.0.1."
Write-Host "The renderer config and TypeScript build are ready. Start the secured renderer process next."
