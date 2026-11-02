# Windows RCC host for Pekora

This is a local, temporary host setup for the **upstream OpenPekora game-renderer**. It does not replace the renderer with a custom avatar viewer.

## Important status

The upstream renderer is a separate Node.js service and calls RCC over SOAP. The upstream `game-renderer/config.json` is not present in the repository, so the setup script creates it locally.

The upstream renderer's `PlayerController` requests this Pekora endpoint:

`{BaseUrl}/v1.1/avatar-fetch?placeId=0&userId={userId}`

That endpoint is not currently implemented in this Pekora Worker. Therefore this setup can prepare and start the two Windows processes and verify the renderer health route, but **actual avatar rendering will not work until the Pekora avatar-fetch endpoint and the authenticated remote connection are implemented**. Do not treat a healthy `/` response as proof that avatar rendering works.

## Requirements

- Windows 10/11 x64
- Git for Windows
- Node.js 22 LTS (npm included)
- Enough free disk space for the upstream repository and npm dependencies
- Windows Defender enabled

## Install

1. Clone this Pekora repository to your PC.
2. Open PowerShell in `tools/windows-rcc-host`.
3. Run:

   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   .\setup.ps1
   ```

4. Read the upstream repository's notices and scan the RCC executable with Windows Security before running it.

The script clones the upstream OpenPekora repository into `C:\Pekora-RCC-Host\OpenPekora`, creates a local-only renderer config, and copies the start scripts. It does not open firewall ports or configure public access.

## Start

Open two PowerShell windows.

**Window 1 — RCC**

```powershell
Set-Location C:\Pekora-RCC-Host
.\start-rcc.ps1
```

**Window 2 — Game Renderer**

```powershell
Set-Location C:\Pekora-RCC-Host
.\start-renderer.ps1
```

The renderer health check is:

`http://127.0.0.1:3001/`

Expected response: `PEKAPEKA OK!`

## Security

- Keep RCC on `127.0.0.1:64989`; never port-forward it.
- Do not expose renderer port `3001` directly to the internet. The upstream service has no authentication middleware on these routes.
- Do not paste Cloudflare Tunnel tokens, API keys, passwords, or other secrets into chat or commit them to Git.
- Public access must be added later through an authenticated gateway and a Cloudflare Tunnel. The Worker must authenticate to that gateway.
- The PC must remain on and connected to the internet while it is hosting renders.

## Upstream notes

The upstream `game-renderer` package declares **AGPL-3.0-only**. Keep its license and notices with the upstream checkout. The RCC binaries in the upstream repository are third-party executable files; review their provenance and scan them before execution. This helper does not redistribute or modify those binaries.
