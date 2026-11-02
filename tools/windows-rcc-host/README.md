# Windows RCC host for Pekora

This helper runs the upstream OpenPekora game-renderer and RCC locally on a Windows PC. It does not replace the renderer with a custom avatar viewer.

## Current integration

The Pekora Worker now includes:

- `GET /v1.1/avatar-fetch` and `GET /Asset/BodyColors.ashx` in the JSON/XML formats expected by the upstream RCC avatar script
- stable numeric render IDs mapped to Pekora accounts
- a private Worker-to-renderer request protected by Cloudflare Access service-token headers
- storage and delivery of the renderer's OBJ, MTL and texture files
- avatar editor refreshes after equipping or removing an item
- optional Roblox asset ID and asset type ID fields on Owner Panel catalog entries, used when the avatar is assembled

The avatar renderer only receives Roblox catalog assets that have both numeric fields configured. Existing GLB preview files are for catalog previews and are not automatically converted into RCC wearable assets.

## Requirements

- Windows 10/11 x64
- Git for Windows
- Node.js **22 LTS** (the upstream uWebSockets.js native module does not support Node.js 26)
- Windows Security enabled
- Enough free disk space for the upstream repository and npm dependencies

## Install

1. Clone this Pekora repository to your PC.
2. Open PowerShell in `tools/windows-rcc-host`.
3. Run:

   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   .\setup.ps1
   ```

4. Read the upstream repository notices and scan the RCC executable with Windows Security before running it.

The script clones OpenPekora into `C:\Pekora-RCC-Host\OpenPekora`, creates `game-renderer/config.json`, and copies the start scripts. The generated config points at the Pekora Worker.

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

The renderer start script patches the upstream listener to bind only to `127.0.0.1` before building. Its local health check is:

`http://127.0.0.1:3001/`

Expected response: `PEKAPEKA OK!`

A successful health response only proves that the HTTP process is listening. It does not prove that RCC can fetch every asset or render an avatar.

## Connect Cloudflare

Follow [RENDERER-CONNECTION.md](./RENDERER-CONNECTION.md). Only the HTTP renderer on port 3001 is routed through an authenticated Cloudflare Tunnel. **Never tunnel or port-forward RCC SOAP port 64989.**

## Security

- Keep RCC on localhost; never port-forward port 64989.
- Do not expose renderer port 3001 without Cloudflare Access. The upstream renderer does not implement its own authentication.
- The start script binds the renderer to loopback so it is not directly available to other devices on the LAN.
- Keep Cloudflare Tunnel tokens, Access service-token secrets, passwords and API keys out of Git and chat.
- The PC must remain on and connected to the internet while it hosts renders.

## Upstream notes

The upstream `game-renderer` package declares **AGPL-3.0-only**. Keep its license and notices with the upstream checkout. The RCC binaries are third-party executable files; review their provenance and scan them before execution. This helper does not redistribute or modify those binaries.
