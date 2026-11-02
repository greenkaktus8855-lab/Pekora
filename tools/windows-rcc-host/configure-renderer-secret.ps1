$ErrorActionPreference = "Stop"

$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$secret = [Convert]::ToHexString($bytes).ToLowerInvariant()

[Environment]::SetEnvironmentVariable("PEKORA_RENDERER_SECRET", $secret, "User")
$env:PEKORA_RENDERER_SECRET = $secret
Set-Clipboard -Value $secret

Write-Host ""
Write-Host "Renderer secret generated, saved to your Windows user environment, and copied to clipboard." -ForegroundColor Green
Write-Host "In Cloudflare, add a Worker SECRET named AVATAR_RENDERER_SECRET and paste the copied value." -ForegroundColor Cyan
Write-Host "Do not send this secret in chat or commit it to GitHub." -ForegroundColor Yellow
Write-Host "After saving the Worker secret, close old terminals, open a new PowerShell, and run start-renderer.ps1."
