# Sakura / OpenPekora renderer — one-click launcher

This launcher starts the genuine OpenPekora HTTP renderer and its local RCCService 2020 process.

## First launch

1. Open `Start-Sakura-Renderer.vbs` with a double-click.
2. Approve the Windows permission prompt.
3. If Windows asks for the OpenPekora folder, select the folder containing both `game-renderer` and `RCCService`.
4. Enter the same value configured in the Cloudflare Worker as `AVATAR_RENDERER_SECRET`.

The launcher remembers the OpenPekora folder and stores the renderer key protected with Windows DPAPI for the current Windows account. The key is not written as plain text. Later launches should not ask for the folder or key again.

The launcher now checks the actual RCC SOAP `HelloWorld` response after confirming that TCP port 64989 is listening. A TCP listener alone is not considered a successful renderer start. Diagnostic logs are saved under `%LOCALAPPDATA%\SakuraRenderer\logs`, including `rcc-soap-probe.log`.

## Important

- Keep the Windows PC awake while OpenPekora rendering is needed.
- The Cloudflare Tunnel must route `renderer.mopcblox.online` to the local HTTP renderer port from `game-renderer\config.json`.
- RCCService's SOAP port must remain local-only. Never publish TCP 64989 directly to the internet.
- This launcher does not create a cloud host. It starts the OpenPekora/RCC programs already present on the Windows PC.
