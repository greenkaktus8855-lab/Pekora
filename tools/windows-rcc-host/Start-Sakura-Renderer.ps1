$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Show-Notice([string]$Message, [string]$Title = "Sakura Renderer", [System.Windows.Forms.MessageBoxIcon]$Icon = [System.Windows.Forms.MessageBoxIcon]::Information) {
    [void][System.Windows.Forms.MessageBox]::Show($Message, $Title, [System.Windows.Forms.MessageBoxButtons]::OK, $Icon)
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $powershell = Join-Path $PSHOME "powershell.exe"
    $arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $PSCommandPath + '"'
    try { Start-Process -FilePath $powershell -Verb RunAs -WindowStyle Hidden -ArgumentList $arguments | Out-Null }
    catch { Show-Notice "Sakura Renderer needs Windows permission to start its local services. Please approve the Windows permission prompt." "Sakura Renderer" ([System.Windows.Forms.MessageBoxIcon]::Warning) }
    exit
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$rccSetup = Join-Path $repoRoot "scripts\start-rcc-2020.ps1"
$rendererSetup = Join-Path $repoRoot "scripts\start-renderer-secure.ps1"
if (-not (Test-Path -LiteralPath $rccSetup) -or -not (Test-Path -LiteralPath $rendererSetup)) {
    Show-Notice "The launcher package is incomplete. Extract the entire Sakura Renderer folder before opening it." "Sakura Renderer" ([System.Windows.Forms.MessageBoxIcon]::Error)
    exit
}

$settingsDir = Join-Path $env:LOCALAPPDATA "SakuraRenderer"
New-Item -ItemType Directory -Path $settingsDir -Force | Out-Null
$rootPathFile = Join-Path $settingsDir "openpekora-root.txt"
$rememberedRoot = ""
if (Test-Path -LiteralPath $rootPathFile) {
    $rememberedRoot = [string](Get-Content -LiteralPath $rootPathFile -Raw -ErrorAction SilentlyContinue).Trim()
}
$openPekoraRoot = [string]$env:SAKURA_OPENPEKORA_ROOT
$candidates = @($openPekoraRoot, $rememberedRoot, "C:\Pekora-RCC-Host\OpenPekora")
foreach ($candidate in $candidates) {
    if (-not [string]::IsNullOrWhiteSpace($candidate) -and
        (Test-Path -LiteralPath (Join-Path $candidate "game-renderer\config.json")) -and
        (Test-Path -LiteralPath (Join-Path $candidate "RCCService\RCCService2020\RCCService.exe"))) {
        $openPekoraRoot = (Resolve-Path -LiteralPath $candidate).Path
        break
    }
    $openPekoraRoot = $null
}
if (-not $openPekoraRoot) {
    $picker = New-Object System.Windows.Forms.FolderBrowserDialog
    $picker.Description = "Select the OpenPekora folder that contains game-renderer and RCCService"
    $picker.ShowNewFolderButton = $false
    if ($picker.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit }
    $openPekoraRoot = $picker.SelectedPath
}
if (-not (Test-Path -LiteralPath (Join-Path $openPekoraRoot "game-renderer\config.json")) -or
    -not (Test-Path -LiteralPath (Join-Path $openPekoraRoot "RCCService\RCCService2020\RCCService.exe"))) {
    Show-Notice "That folder does not contain the OpenPekora renderer and RCCService 2020. Choose the OpenPekora folder, not the Sakura folder." "Sakura Renderer" ([System.Windows.Forms.MessageBoxIcon]::Error)
    exit
}
$openPekoraRoot = (Resolve-Path -LiteralPath $openPekoraRoot).Path
[System.IO.File]::WriteAllText($rootPathFile, $openPekoraRoot, [System.Text.UTF8Encoding]::new($false))

$secretStorePath = Join-Path $settingsDir "renderer-secret.dpapi"
$secret = [string]$env:PEKORA_RENDERER_SECRET
if ([string]::IsNullOrWhiteSpace($secret) -and (Test-Path -LiteralPath $secretStorePath)) {
    try {
        $storedSecureSecret = Get-Content -LiteralPath $secretStorePath -Raw | ConvertTo-SecureString
        $storedSecretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($storedSecureSecret)
        try {
            $secret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($storedSecretPointer)
        } finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($storedSecretPointer)
        }
    } catch {
        $secret = ""
        Remove-Item -LiteralPath $secretStorePath -Force -ErrorAction SilentlyContinue
    }
}

if ([string]::IsNullOrWhiteSpace($secret)) {
$form = New-Object System.Windows.Forms.Form
$form.Text = "Start Sakura Renderer"
$form.StartPosition = "CenterScreen"
$form.Size = New-Object System.Drawing.Size(520, 220)
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.TopMost = $true

$label = New-Object System.Windows.Forms.Label
$label.Location = New-Object System.Drawing.Point(18, 18)
$label.Size = New-Object System.Drawing.Size(470, 55)
$label.Text = "Enter the same private key already saved in Cloudflare as AVATAR_RENDERER_SECRET. It is used only to connect Sakura to this computer."
$form.Controls.Add($label)

$secretBox = New-Object System.Windows.Forms.TextBox
$secretBox.Location = New-Object System.Drawing.Point(20, 82)
$secretBox.Size = New-Object System.Drawing.Size(465, 25)
$secretBox.UseSystemPasswordChar = $true
$form.Controls.Add($secretBox)

$startButton = New-Object System.Windows.Forms.Button
$startButton.Text = "Start renderer"
$startButton.Location = New-Object System.Drawing.Point(286, 132)
$startButton.Size = New-Object System.Drawing.Size(120, 32)
$startButton.DialogResult = [System.Windows.Forms.DialogResult]::OK
$form.Controls.Add($startButton)

$cancelButton = New-Object System.Windows.Forms.Button
$cancelButton.Text = "Cancel"
$cancelButton.Location = New-Object System.Drawing.Point(414, 132)
$cancelButton.Size = New-Object System.Drawing.Size(72, 32)
$cancelButton.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$form.Controls.Add($cancelButton)
$form.AcceptButton = $startButton
$form.CancelButton = $cancelButton

if ($form.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit }
$secret = $secretBox.Text
$secretBox.Clear()
$form.Dispose()
}
if ([string]::IsNullOrWhiteSpace($secret) -or $secret.Length -lt 24) {
    Show-Notice "The key must be at least 24 characters and must exactly match the Cloudflare Worker secret AVATAR_RENDERER_SECRET." "Sakura Renderer" ([System.Windows.Forms.MessageBoxIcon]::Error)
    exit
}
if (-not (Test-Path -LiteralPath $secretStorePath)) {
    try {
        $secureToStore = ConvertTo-SecureString -String $secret -AsPlainText -Force
        $protectedSecret = ConvertFrom-SecureString -SecureString $secureToStore
        [System.IO.File]::WriteAllText($secretStorePath, $protectedSecret, [System.Text.UTF8Encoding]::new($false))
    } catch {
        Show-Notice "The renderer key could not be saved securely. It will be requested again next time." "Sakura Renderer" ([System.Windows.Forms.MessageBoxIcon]::Warning)
    }
}

$npm = Get-Command "npm.cmd" -ErrorAction SilentlyContinue
if (-not $npm) { $npm = Get-Command "npm" -ErrorAction SilentlyContinue }
if (-not $npm) {
    Show-Notice "Node.js and npm are not installed on this computer. Install the current Node.js LTS version first, then open this launcher again." "Sakura Renderer" ([System.Windows.Forms.MessageBoxIcon]::Error)
    exit
}

$logDir = Join-Path $env:LOCALAPPDATA "SakuraRenderer\logs"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$rccLog = Join-Path $logDir "rcc-startup.log"
$rendererOut = Join-Path $logDir "renderer-output.log"
$rendererErr = Join-Path $logDir "renderer-errors.log"
$env:SAKURA_OPENPEKORA_ROOT = $openPekoraRoot
$env:SAKURA_RENDERER_LOG_DIR = $logDir

try {
    & $rccSetup *> $rccLog
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "RCCService setup did not finish successfully. See $rccLog" }

    $config = Get-Content -LiteralPath (Join-Path $openPekoraRoot "game-renderer\config.json") -Raw | ConvertFrom-Json
    $rendererPort = [int]$config.Ports.Process
    if ($rendererPort -lt 1 -or $rendererPort -gt 65535) { throw "The Renderer port in config.json is invalid." }

    $rendererAlreadyRunning = $false
    $existing = Get-NetTCPConnection -LocalPort $rendererPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($existing) {
        $owner = Get-Process -Id $existing.OwningProcess -ErrorAction SilentlyContinue
        $ownerInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($existing.OwningProcess)" -ErrorAction SilentlyContinue
        $ownerCommand = [string]$ownerInfo.CommandLine
        if ($owner -and $owner.ProcessName -match "^node" -and $ownerCommand -match "(?i)Main\.js|game-renderer") {
            Write-Host "Stopping the existing OpenPekora Renderer so it reloads the updated RCC port configuration."
            Stop-Process -Id $existing.OwningProcess -Force
            $released = $false
            for ($wait = 0; $wait -lt 20; $wait++) {
                Start-Sleep -Seconds 1
                $stillListening = Get-NetTCPConnection -LocalPort $rendererPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
                if (-not $stillListening) { $released = $true; break }
            }
            if (-not $released) { throw "The old OpenPekora Renderer did not release port $rendererPort." }
            $rendererAlreadyRunning = $false
        } else {
            $processLabel = if ($owner) { $owner.ProcessName } else { "unknown process" }
            throw "Port $rendererPort is occupied by $processLabel (PID $($existing.OwningProcess)), but it does not look like the OpenPekora Renderer. Close that app before starting Sakura."
        }
    }

    if (-not $rendererAlreadyRunning) {
        $env:PEKORA_RENDERER_SECRET = $secret
        $powershell = Join-Path $PSHOME "powershell.exe"
        $rendererArguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $rendererSetup + '"'
        $rendererProcess = Start-Process -FilePath $powershell -ArgumentList $rendererArguments -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput $rendererOut -RedirectStandardError $rendererErr -PassThru
    }
} catch {
    Remove-Item Env:PEKORA_RENDERER_SECRET -ErrorAction SilentlyContinue
    Remove-Item Env:SAKURA_OPENPEKORA_ROOT -ErrorAction SilentlyContinue
    Remove-Item Env:SAKURA_RENDERER_LOG_DIR -ErrorAction SilentlyContinue
    Show-Notice ("Could not start the OpenPekora renderer." + [Environment]::NewLine + [Environment]::NewLine + $_.Exception.Message + [Environment]::NewLine + [Environment]::NewLine + "Logs: " + $logDir) "Sakura Renderer" ([System.Windows.Forms.MessageBoxIcon]::Error)
    exit
} finally {
    $secret = $null
    Remove-Item Env:PEKORA_RENDERER_SECRET -ErrorAction SilentlyContinue
}

try {
    $tunnelService = Get-Service -Name "cloudflared" -ErrorAction SilentlyContinue
    if ($tunnelService) {
        Set-Service -Name "cloudflared" -StartupType Automatic -ErrorAction SilentlyContinue
        if ($tunnelService.Status -ne "Running") { Start-Service -Name "cloudflared" }
    }
} catch {}

$ready = [bool]$rendererAlreadyRunning
if (-not $ready) {
    for ($attempt = 0; $attempt -lt 120; $attempt++) {
        Start-Sleep -Seconds 1
        $rendererProcess.Refresh()
        $listener = Get-NetTCPConnection -LocalPort $rendererPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($listener) { $ready = $true; break }
        if ($rendererProcess.HasExited) { break }
    }
}

Remove-Item Env:SAKURA_OPENPEKORA_ROOT -ErrorAction SilentlyContinue
Remove-Item Env:SAKURA_RENDERER_LOG_DIR -ErrorAction SilentlyContinue

if (-not $ready) {
    $details = @()
    if (Test-Path -LiteralPath $rendererErr) { $details += (Get-Content -LiteralPath $rendererErr -Tail 12 -ErrorAction SilentlyContinue) }
    if (Test-Path -LiteralPath $rendererOut) { $details += (Get-Content -LiteralPath $rendererOut -Tail 12 -ErrorAction SilentlyContinue) }
    $summary = ($details -join [Environment]::NewLine)
    if ([string]::IsNullOrWhiteSpace($summary)) { $summary = "The renderer did not open its local port within 120 seconds." }
    Show-Notice ("Renderer did not start." + [Environment]::NewLine + [Environment]::NewLine + $summary + [Environment]::NewLine + [Environment]::NewLine + "Full logs: " + $logDir) "Sakura Renderer" ([System.Windows.Forms.MessageBoxIcon]::Error)
    exit
}

try {
    $publicCheck = Invoke-WebRequest -Uri "https://renderer.mopcblox.online/" -UseBasicParsing -TimeoutSec 12
    if ([int]$publicCheck.StatusCode -lt 200 -or [int]$publicCheck.StatusCode -ge 400) { throw "The public renderer route returned HTTP $($publicCheck.StatusCode)." }
    Show-Notice "Sakura Renderer is running and the public route is responding." "Sakura Renderer"
} catch {
    Show-Notice ("The local Renderer is running, but renderer.mopcblox.online is not responding yet." + [Environment]::NewLine + [Environment]::NewLine + "The Cloudflare Tunnel may still be starting or may point to the wrong local port." + [Environment]::NewLine + [Environment]::NewLine + "Details: " + $_.Exception.Message + [Environment]::NewLine + [Environment]::NewLine + "Renderer logs: " + $logDir) "Sakura Renderer" ([System.Windows.Forms.MessageBoxIcon]::Warning)
}

# Keep the genuine OpenPekora renderer ready automatically after future Windows logons.
try {
    $backgroundScript = Join-Path $PSScriptRoot "Start-Sakura-Renderer-Background.ps1"
    if (-not (Test-Path -LiteralPath $backgroundScript)) {
        throw "Background startup script is missing: $backgroundScript"
    }
    $taskName = "Sakura OpenPekora Renderer"
    $taskPowerShell = Join-Path $PSHOME "powershell.exe"
    $taskArguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $backgroundScript + '"'
    $taskAction = New-ScheduledTaskAction -Execute $taskPowerShell -Argument $taskArguments
    $taskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $identity.Name
    $taskPrincipal = New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType Interactive -RunLevel Highest
    $taskSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::FromDays(3650)) -RestartCount 10 -RestartInterval ([TimeSpan]::FromMinutes(1))
    Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $taskTrigger -Principal $taskPrincipal -Settings $taskSettings -Description "Starts Sakura's local OpenPekora RCC and secured renderer at Windows logon." -Force | Out-Null
    Show-Notice "OpenPekora is running. Automatic startup at Windows logon has also been enabled." "Sakura Renderer"
} catch {
    Show-Notice ("The renderer is running now, but automatic startup could not be configured." + [Environment]::NewLine + $_.Exception.Message) "Sakura Renderer" ([System.Windows.Forms.MessageBoxIcon]::Warning)
}
