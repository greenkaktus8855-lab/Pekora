# Sakura Player

Sakura Player is a Windows desktop shell that opens the real Sakura website and receives game-launch requests from the website through the per-user Windows protocol handler `sakura-player://`.

## Website-to-player flow

1. The user installs and runs SakuraPlayer.exe once.
2. On startup, the app registers `sakura-player://` for the current Windows user (no administrator rights required).
3. The user opens Games on Sakura and presses Play.
4. The browser asks permission to open Sakura Player, then launches a link like `sakura-player://play?gameId=GAME_ID`.
5. Sakura Player reads the game ID and starts the configured runtime process.
6. The launcher hides while the game process is running and closes after that process exits.

## Current limitation: no 3D runtime or game servers yet

The protocol and process handoff are implemented, but the repository does not currently contain a compatible 3D game client. The games table stores only an ID, title, description and thumbnail. There is no place file, join-ticket API, game arbiter or hosted game server. Thus pressing Play can open Sakura Player, but it cannot yet render a playable game until those pieces are provided.

OpenPekora's public source does not include a ready-to-run Windows Player, and its Notes document says the game-arbiter component is not included. Do not package proprietary Roblox client binaries into Sakura Player.

## Configure a compatible game runtime

The app creates this file on first launch:

    %LOCALAPPDATA%\SakuraPlayer\player.json

Set `RuntimeExecutable` to the full path of a compatible game runtime executable. The runtime must accept these arguments:

    --game-id <id> --platform-url https://sakura.green-kaktus8855.workers.dev

The current Worker URL is used because the custom domain is disabled. Once a compatible runtime exists, the game client also needs a matching join-ticket and server protocol. Merely changing RuntimeExecutable will not make an unrelated program understand Sakura games.

## WebView2 requirement

Microsoft Edge WebView2 Runtime must be installed on Windows. If it is missing, Sakura Player shows a prompt with Microsoft's official installation page:

    https://developer.microsoft.com/microsoft-edge/webview2/

## Build locally

With .NET 8 SDK installed:

    dotnet publish client/SakuraPlayer/SakuraPlayer.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o publish/SakuraPlayer

The executable is published to:

    publish/SakuraPlayer/SakuraPlayer.exe
