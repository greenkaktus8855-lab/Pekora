$ErrorActionPreference = "Stop"

# Create diagnostics before any validation so early failures are recorded.
$logDir = [string]$env:SAKURA_RENDERER_LOG_DIR
if ([string]::IsNullOrWhiteSpace($logDir)) {
    $logDir = Join-Path $env:LOCALAPPDATA "SakuraRenderer\logs"
}
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$startupLog = Join-Path $logDir "rcc-script-transcript.log"
$probeLog = Join-Path $logDir "rcc-soap-probe.log"
[System.IO.File]::WriteAllText($probeLog, "SOAP check has not run yet.", [System.Text.UTF8Encoding]::new($false))

try { Start-Transcript -Path $startupLog -Force | Out-Null } catch {}

try {
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
        if ((Test-Path -LiteralPath (Join-Path $candidateRenderer "config.json")) -and
            (Test-Path -LiteralPath (Join-Path $candidateRcc "RCCService.exe"))) {
            $openPekoraRoot = (Resolve-Path -LiteralPath $candidate).Path
            break
        }
    }

    if (-not $openPekoraRoot) {
        throw "Could not find the OpenPekora folder containing game-renderer\config.json and RCCService\RCCService2020\RCCService.exe."
    }

    $rendererDir = Join-Path $openPekoraRoot "game-renderer"
    $rccDir = Join-Path $openPekoraRoot "RCCService\RCCService2020"
    $rccExe = Join-Path $rccDir "RCCService.exe"
    $settingsPath = Join-Path $rccDir "Settings.json"
    $configPath = Join-Path $rendererDir "config.json"
    $baseControllerPath = Join-Path $rendererDir "src\Controllers\BaseController.ts"
    $requestPath = Join-Path $rendererDir "src\Utilities\Libraries\Request.ts"

    foreach ($requiredFile in @(
        (Join-Path $rendererDir "package.json"),
        $configPath,
        $baseControllerPath,
        $requestPath,
        $rccExe
    )) {
        if (-not (Test-Path -LiteralPath $requiredFile)) {
            throw "Required OpenPekora file not found: $requiredFile"
        }
    }

    if (-not (Test-Path -LiteralPath $settingsPath)) {
        [System.IO.File]::WriteAllText($settingsPath, '{"applicationSettings":{}}', [System.Text.UTF8Encoding]::new($false))
    }

    # Keep the website origin separate from RCC's SOAP namespace.
    try {
        $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    } catch {
        throw "game-renderer\config.json is invalid JSON: $($_.Exception.Message)"
    }

    if (-not $config.Ports) {
        throw "game-renderer\config.json has no Ports object. Restore a valid OpenPekora config.json."
    }
    if (-not $config.Ports.RCC) {
        $config.Ports | Add-Member -MemberType NoteProperty -Name RCC -Value ([pscustomobject]@{})
    }
    if (-not $config.Paths) {
        $config | Add-Member -MemberType NoteProperty -Name Paths -Value ([pscustomobject]@{})
    }

    function Set-ConfigValue($Object, [string]$Name, $Value) {
        if ($Object.PSObject.Properties[$Name]) {
            $Object.$Name = $Value
        } else {
            $Object | Add-Member -MemberType NoteProperty -Name $Name -Value $Value
        }
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
    $rccPorts = @(64989)
    Set-ConfigValue $config "BaseUrl" $platformBaseUrl
    Set-ConfigValue $config "RCCUrl" "http://127.0.0.1"
    Set-ConfigValue $config.Ports.RCC "All" $rccPorts
    Set-ConfigValue $config.Ports.RCC "Player" $rccPorts
    Set-ConfigValue $config.Ports.RCC "Image" $rccPorts
    Set-ConfigValue $config.Ports.RCC "Place" $rccPorts
    Set-ConfigValue $config.Ports.RCC "Catalog" $rccPorts
    Set-ConfigValue $config.Paths "RCCService" "..\RCCService\RCCService2020"

    $configBackup = "$configPath.sakura-backup"
    if (-not (Test-Path -LiteralPath $configBackup)) {
        Copy-Item -LiteralPath $configPath -Destination $configBackup
    }
    [System.IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 30), [System.Text.UTF8Encoding]::new($false))
    Write-Host "OpenPekora BaseUrl: $platformBaseUrl"
    Write-Host "RCC SOAP endpoint: http://127.0.0.1:64989"

    # Patch the renderer controller so failed RCC requests produce a useful HTTP 503.
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    $baseSource = [System.IO.File]::ReadAllText($baseControllerPath)
    $baseSource = $baseSource.Replace([string][char]13 + [string][char]10, [string][char]10)

    $directCall = "    const response: any = await RCCRequest(port, xml, request.jobExpiration);"
    $newCall = @'
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

    if (-not $baseSource.Contains("RCCService SOAP request failed:")) {
        if (-not $baseSource.Contains($directCall)) {
            throw "BaseController.ts did not match the expected OpenPekora RCC call. No controller patch was made."
        }
        $baseBackup = "$baseControllerPath.sakura-backup"
        if (-not (Test-Path -LiteralPath $baseBackup)) {
            Copy-Item -LiteralPath $baseControllerPath -Destination $baseBackup
        }
        $baseSource = $baseSource.Replace($directCall, $newCall.TrimEnd())
        [System.IO.File]::WriteAllText($baseControllerPath, $baseSource, $utf8NoBom)
    }

    # Use the standard RCC SOAP namespace. RCC clients send text/xml; this
    # implementation intentionally does not add an unverified SOAPAction header.
    $requestSource = [System.IO.File]::ReadAllText($requestPath)
    $requestSource = $requestSource.Replace([string][char]13 + [string][char]10, [string][char]10)
    # A previous local run may have removed this import; RCCRequest still uses Config.RCCUrl.
    $configImport = 'import Config from "./Config.js";'
    if (-not $requestSource.Contains($configImport)) {
        $soapImport = 'import {SOAP} from "./SOAP.js";'
        if (-not $requestSource.Contains($soapImport)) {
            throw "Request.ts is missing its SOAP import; cannot safely restore the Config import."
        }
        $requestSource = $requestSource.Replace($soapImport, $soapImport + [Environment]::NewLine + $configImport)
        Write-Host "Restored the missing Config import in Request.ts."
    }
    $standardSoapCall = 'const xml = SOAP("http://roblox.com/", jobExpiration, JSON.stringify(data));'
    $legacySoapCall = 'const xml = SOAP(Config.BaseUrl, jobExpiration, JSON.stringify(data));'
    if ($requestSource.Contains($legacySoapCall)) {
        $requestSource = $requestSource.Replace($legacySoapCall, $standardSoapCall)
    } elseif (-not $requestSource.Contains($standardSoapCall)) {
        throw "Request.ts SOAP namespace call was not recognized. No Request.ts patch was made."
    }

    $requestFunctionPattern = '(?s)export const RCCRequest = async <T>\(.*?\n\};(?=\s*\nexport enum HttpMethod)'
    $newRequestFunction = @'
export const RCCRequest = async <T>(port: number, data: BaseJson, jobExpiration: number): Promise<T> => {
    try {
        const headers = {
            "Content-Type": "text/xml; charset=utf-8",
        };
        const xml = SOAP("http://roblox.com/", jobExpiration, JSON.stringify(data));
        const response = await axios.request({
            method: HttpMethod.POST,
            url: Config.RCCUrl + ":" + port,
            timeout: (jobExpiration + 20) * 1000,
            data: xml,
            maxRedirects: 0,
            headers,
        });
        if (typeof response.data !== "string" || !response.data.trim()) {
            throw new Error("RCCService returned an empty HTTP response.");
        }
        return response.data as T;
    } catch (e: any) {
        if (axios.isAxiosError(e)) {
            const status = e.response?.status;
            const responseBody = e.response?.data;
            const detail = responseBody === undefined
                ? ""
                : (typeof responseBody === "string" ? responseBody : JSON.stringify(responseBody)).slice(0, 500);
            const message = status
                ? "RCCService HTTP " + status + ": " + (detail || e.message)
                : "RCCService connection failed" + (e.code ? " (" + e.code + ")" : "") + ": " + e.message;
            Console.Error(message);
            throw new Error(message);
        }
        const message = e instanceof Error ? e.message : String(e);
        Console.Error("RCCService request failed: " + message);
        throw new Error("RCCService request failed: " + message);
    }
};
'@

    $newRequestSource = [regex]::Replace($requestSource, $requestFunctionPattern, $newRequestFunction.TrimEnd(), 1)
    if ($newRequestSource -eq $requestSource) {
        if (-not $requestSource.Contains("RCCService connection failed")) {
            throw "Could not safely locate the RCCRequest function in Request.ts."
        }
    } else {
        $requestBackup = "$requestPath.sakura-backup"
        if (-not (Test-Path -LiteralPath $requestBackup)) {
            Copy-Item -LiteralPath $requestPath -Destination $requestBackup
        }
        [System.IO.File]::WriteAllText($requestPath, $newRequestSource, $utf8NoBom)
    }

    # RCCService has no built-in authentication. Keep the SOAP listener
    # local-only; do not expose TCP 64989 through the router or tunnel.
    $firewallRule = "Sakura RCC local-only TCP 64989"
    if (-not (Get-NetFirewallRule -DisplayName $firewallRule -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName $firewallRule -Direction Inbound -Protocol TCP -LocalPort 64989 -Action Block -Profile Any | Out-Null
    }

    # Compile before starting RCC so broken TypeScript cannot leave a half-started service.
    $npmCmd = (Get-Command "npm.cmd" -ErrorAction Stop).Source
    Push-Location $rendererDir
    try {
        Write-Host "Building patched OpenPekora Renderer..."
        & $npmCmd run build
        if ($LASTEXITCODE -ne 0) {
            throw "OpenPekora Renderer TypeScript build failed with exit code $LASTEXITCODE."
        }
    } finally {
        Pop-Location
    }

    # Stop only a known RCCService process that is occupying our local port.
    $existingListener = Get-NetTCPConnection -LocalPort 64989 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($existingListener) {
        $existingProcess = Get-Process -Id $existingListener.OwningProcess -ErrorAction SilentlyContinue
        if (-not $existingProcess -or $existingProcess.ProcessName -notmatch "^RCCService") {
            throw "TCP 64989 is occupied by another process. It was not stopped. Process: $($existingProcess.ProcessName) (PID $($existingListener.OwningProcess))."
        }
        Stop-Process -Id $existingListener.OwningProcess -Force
        Start-Sleep -Seconds 2
    }

    $rccOut = Join-Path $logDir "rcc-64989-out.log"
    $rccErr = Join-Path $logDir "rcc-64989-error.log"
    Write-Host "Starting RCCService 2020 on 127.0.0.1:64989..."
    $rccProcess = Start-Process -FilePath $rccExe -ArgumentList @(
        "-Console", "-verbose", "-settingsfile", "Settings.json", "-port", "64989"
    ) -WorkingDirectory $rccDir -WindowStyle Hidden -RedirectStandardOutput $rccOut -RedirectStandardError $rccErr -PassThru

    $listenerReady = $false
    for ($attempt = 0; $attempt -lt 45; $attempt++) {
        Start-Sleep -Seconds 1
        $rccProcess.Refresh()
        if ($rccProcess.HasExited) {
            throw "RCCService exited during startup with code $($rccProcess.ExitCode). See $rccOut and $rccErr."
        }
        $listener = Get-NetTCPConnection -LocalPort 64989 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($listener -and $listener.OwningProcess -eq $rccProcess.Id) {
            $listenerReady = $true
            break
        }
    }
    if (-not $listenerReady) {
        throw "RCCService did not open TCP 64989 within 45 seconds. See $rccOut and $rccErr."
    }

    # Test the actual SOAP endpoint. The known RCC client uses text/xml and
    # the standard http://roblox.com/ SOAP namespace, without a SOAPAction header.
    $probeXml = @'
<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:rob="http://roblox.com/">
  <soapenv:Header/>
  <soapenv:Body>
    <rob:GetStatus/>
  </soapenv:Body>
</soapenv:Envelope>
'@

    try {
        $statusResponse = Invoke-WebRequest -Uri "http://127.0.0.1:64989" -Method Post -ContentType "text/xml" -Body $probeXml -UseBasicParsing -TimeoutSec 20
        $statusBody = [string]$statusResponse.Content
        if ([int]$statusResponse.StatusCode -ne 200 -or $statusBody -notmatch "GetStatusResponse") {
            throw "RCC returned HTTP $($statusResponse.StatusCode), but the body was not a valid GetStatus SOAP response: $($statusBody.Substring(0,[Math]::Min(700,$statusBody.Length)))"
        }
        $preview = $statusBody.Substring(0,[Math]::Min(1500,$statusBody.Length))
        [System.IO.File]::WriteAllText($probeLog, "SOAP GetStatus succeeded on 127.0.0.1:64989." + [Environment]::NewLine + $preview, $utf8NoBom)
        Write-Host "SOAP GetStatus succeeded on 127.0.0.1:64989." -ForegroundColor Green
    } catch {
        $probeError = $_.Exception.Message
        try {
            if ($_.Exception.Response) {
                $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
                $responseText = $reader.ReadToEnd()
                $reader.Dispose()
                if ($responseText) {
                    $probeError += " | Response: " + $responseText.Substring(0,[Math]::Min(700,$responseText.Length))
                }
            }
        } catch {}
        [System.IO.File]::WriteAllText($probeLog, "SOAP GetStatus failed: " + $probeError, $utf8NoBom)
        throw "RCCService is listening but did not pass the SOAP test. $probeError. See $probeLog"
    }

    Write-Host "RCCService startup and SOAP test completed successfully." -ForegroundColor Green
} catch {
    Write-Host "RCC startup failed: $($_.Exception.Message)" -ForegroundColor Red
    throw
} finally {
    try { Stop-Transcript | Out-Null } catch {}
}
