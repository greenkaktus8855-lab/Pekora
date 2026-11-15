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

    # Preserve the private Sakura bridge URL. Replacing it with the bare site
    # origin would make RCC avatar-fetch requests fail authentication.
    $bridgeBaseUrl = [string]$config.BaseUrl
    if ($bridgeBaseUrl -notmatch '^https://[^/]+/_sakura-rcc/[^/]+/?$') {
        $bridgeSecret = [string]$env:AVATAR_RENDERER_SECRET
        if ([string]::IsNullOrWhiteSpace($bridgeSecret)) {
            throw "config.json BaseUrl must contain the private Sakura RCC bridge URL. Keep its /_sakura-rcc/<secret>/ path or set AVATAR_RENDERER_SECRET for this process."
        }
        $bridgeBaseUrl = $platformBaseUrl + "_sakura-rcc/" + [Uri]::EscapeDataString($bridgeSecret.Trim()) + "/"
    } else {
        $bridgeBaseUrl = $bridgeBaseUrl.TrimEnd('/') + "/"
    }

    # Reuse the RCC port already selected in config.json, including 1621.
    $rccPort = 64989
    $configuredPlayerPort = @($config.Ports.RCC.Player) | Select-Object -First 1
    if ($null -ne $configuredPlayerPort) {
        $parsedPort = 0
        if ([int]::TryParse([string]$configuredPlayerPort, [ref]$parsedPort) -and $parsedPort -ge 1 -and $parsedPort -le 65535) {
            $rccPort = $parsedPort
        }
    }
    $rccPorts = @($rccPort)
    Set-ConfigValue $config "BaseUrl" $bridgeBaseUrl
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
    Write-Host "Sakura RCC bridge URL is configured (secret hidden)."
    Write-Host "RCC SOAP endpoint: http://127.0.0.1:$rccPort"

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
    # OpenPekora forks use slightly different SOAP call formatting and
    # namespaces. Replace the whole RCCRequest implementation by its stable
    # function boundaries instead of matching one fragile line of source.
    $requestStart = $requestSource.IndexOf("export const RCCRequest")
    $requestEnd = $requestSource.IndexOf("export enum HttpMethod", [Math]::Max(0,$requestStart))
    if ($requestStart -lt 0 -or $requestEnd -lt 0 -or $requestEnd -le $requestStart) {
        throw "Could not safely locate RCCRequest and HttpMethod in Request.ts. No Request.ts patch was made."
    }

    $newRequestFunction = @'
export const RCCRequest = async <T>(port: number, data: BaseJson, jobExpiration: number): Promise<T> => {
    try {
        const headers = {
            "Content-Type": "application/xml",
        };
        const xml = SOAP("http://silrev.biz/", jobExpiration, JSON.stringify(data));
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

    $requestPrefix = $requestSource.Substring(0,$requestStart)
    $requestSuffix = $requestSource.Substring($requestEnd)
    $newRequestSource = $requestPrefix + $newRequestFunction.TrimEnd() + [Environment]::NewLine + [Environment]::NewLine + $requestSuffix

    if ($newRequestSource -ne $requestSource) {
        $requestBackup = "$requestPath.sakura-backup"
        if (-not (Test-Path -LiteralPath $requestBackup)) {
            Copy-Item -LiteralPath $requestPath -Destination $requestBackup
        }
        [System.IO.File]::WriteAllText($requestPath, $newRequestSource, $utf8NoBom)
        Write-Host "Updated RCCRequest using the stable OpenPekora function boundaries."
    } else {
        Write-Host "RCCRequest already uses the Sakura-compatible SOAP implementation."
    }

    # RCCService has no built-in authentication. Keep the SOAP listener
    # local-only; do not expose TCP $rccPort through the router or tunnel.
    $firewallRule = "Sakura RCC local-only TCP $rccPort"
    if (-not (Get-NetFirewallRule -DisplayName $firewallRule -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName $firewallRule -Direction Inbound -Protocol TCP -LocalPort $rccPort -Action Block -Profile Any | Out-Null
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
    $existingListener = Get-NetTCPConnection -LocalPort $rccPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($existingListener) {
        $existingProcess = Get-Process -Id $existingListener.OwningProcess -ErrorAction SilentlyContinue
        if (-not $existingProcess -or $existingProcess.ProcessName -notmatch "^RCCService") {
            throw "TCP $rccPort is occupied by another process. It was not stopped. Process: $($existingProcess.ProcessName) (PID $($existingListener.OwningProcess))."
        }
        Stop-Process -Id $existingListener.OwningProcess -Force
        Start-Sleep -Seconds 2
    }

    $rccOut = Join-Path $logDir "rcc-$rccPort-out.log"
    $rccErr = Join-Path $logDir "rcc-$rccPort-error.log"
    Write-Host "Starting RCCService 2020 on 127.0.0.1:$rccPort..."
    $rccProcess = Start-Process -FilePath $rccExe -ArgumentList @(
        "-Console", "-verbose", "-settingsfile", "Settings.json", "-port", "$rccPort"
    ) -WorkingDirectory $rccDir -WindowStyle Hidden -RedirectStandardOutput $rccOut -RedirectStandardError $rccErr -PassThru

    $listenerReady = $false
    for ($attempt = 0; $attempt -lt 45; $attempt++) {
        Start-Sleep -Seconds 1
        $rccProcess.Refresh()
        if ($rccProcess.HasExited) {
            throw "RCCService exited during startup with code $($rccProcess.ExitCode). See $rccOut and $rccErr."
        }
        $listener = Get-NetTCPConnection -LocalPort $rccPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($listener -and $listener.OwningProcess -eq $rccProcess.Id) {
            $listenerReady = $true
            break
        }
    }
    if (-not $listenerReady) {
        throw "RCCService did not open TCP $rccPort within 45 seconds. See $rccOut and $rccErr."
    }

    # Use the RCC reference client's connection check: HelloWorld, application/xml,
    # standard namespace declarations, and no SOAPAction header.
    $versionInfo = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($rccExe)
    $probeXml = @'
<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:ns1="http://silrev.biz/" xmlns:ns2="http://roblox.com/RCCServiceSoap" xmlns:ns3="http://roblox.com/RCCServiceSoap12">
  <SOAP-ENV:Body>
    <ns1:HelloWorld></ns1:HelloWorld>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>
'@

    $probeLogText = @(
        "RCC executable: $rccExe",
        "File version: $($versionInfo.FileVersion)",
        "Product version: $($versionInfo.ProductVersion)",
        "HTTP WSDL discovery: skipped",
        "SOAP method: HelloWorld",
        "SOAP namespace: http://silrev.biz/",
        "Content-Type: application/xml",
        "SOAPAction: not sent",
        "Request XML:",
        $probeXml
    ) -join [Environment]::NewLine

    $httpClient = $null
    $httpContent = $null
    $httpResponse = $null
    try {
        $httpHandler = [System.Net.Http.HttpClientHandler]::new()
        $httpHandler.UseProxy = $false
        $httpClient = [System.Net.Http.HttpClient]::new($httpHandler)
        $httpClient.Timeout = [TimeSpan]::FromSeconds(20)
        $httpContent = [System.Net.Http.StringContent]::new($probeXml, [System.Text.Encoding]::UTF8, "application/xml")
        $httpResponse = $httpClient.PostAsync("http://127.0.0.1:$rccPort/", $httpContent).GetAwaiter().GetResult()
        $statusCode = [int]$httpResponse.StatusCode
        $statusBody = $httpResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult()

        if ($statusCode -ne 200 -or $statusBody -notmatch "HelloWorldResponse") {
            $message = "RCC returned HTTP $statusCode for HelloWorld."
            if (-not [string]::IsNullOrWhiteSpace($statusBody)) {
                $message += [Environment]::NewLine + "RCC SOAP response body:" + [Environment]::NewLine + $statusBody
            } else {
                $message += [Environment]::NewLine + "RCC returned an empty response body."
            }
            throw $message
        }

        $probeLogText += [Environment]::NewLine + "SOAP HelloWorld succeeded on 127.0.0.1:$rccPort." +
            [Environment]::NewLine + "Response:" + [Environment]::NewLine + $statusBody
        [System.IO.File]::WriteAllText($probeLog, $probeLogText, $utf8NoBom)
        Write-Host "SOAP HelloWorld succeeded on 127.0.0.1:$rccPort." -ForegroundColor Green
    } catch {
        $probeError = $_.Exception.Message
        $probeLogText += [Environment]::NewLine + "SOAP HelloWorld failed:" + [Environment]::NewLine + $probeError
        [System.IO.File]::WriteAllText($probeLog, $probeLogText, $utf8NoBom)
        throw "RCCService is listening but its SOAP HelloWorld test failed. $probeError. See $probeLog"
    } finally {
        if ($httpResponse) { $httpResponse.Dispose() }
        if ($httpContent) { $httpContent.Dispose() }
        if ($httpClient) { $httpClient.Dispose() }
    }

    Write-Host "RCCService startup and SOAP test completed successfully." -ForegroundColor Green
} catch {
    Write-Host "RCC startup failed: $($_.Exception.Message)" -ForegroundColor Red
    throw
} finally {
    try { Stop-Transcript | Out-Null } catch {}
}
