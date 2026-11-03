# Sakura Renderer one-click launcher

This package starts the existing OpenPekora RCCService 2020 workers and the secured HTTP renderer without requiring terminal commands.

## Start

1. Extract the complete folder.
2. Double-click Start-Sakura-Renderer.vbs.
3. Approve the Windows permission prompt.
4. If asked, select the OpenPekora folder containing game-renderer and RCCService.
5. Enter the same private key already configured in the Cloudflare Worker as AVATAR_RENDERER_SECRET.
6. Wait for the success message, then open Sakura → Avatar → Refresh Preview.

The launcher keeps RCCService bound to localhost and adds inbound firewall blocks for its ports. It writes diagnostics to %LOCALAPPDATA%\SakuraRenderer\logs.

The computer must remain on while the renderer is needed. Cloudflare Tunnel must route renderer.mopcblox.online to the Renderer HTTP port shown in game-renderer\config.json.

This launcher does not create a new renderer host in the cloud. It starts the local OpenPekora/RCC components already installed on the Windows computer.
