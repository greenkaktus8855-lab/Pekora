# Sakura Player

Sakura Player is a Windows desktop shell for the Sakura website. It displays the actual Sakura/OpenPekora-derived website interface inside a native window instead of a separate hand-built launcher screen.

## Current connection

The default address is:

    https://sakura.green-kaktus8855.workers.dev/

The old custom-domain address is kept in the source as an allowed host for later use, but is not used as the startup address.

## Current features

- Opens the real Sakura website interface in a desktop window.
- Uses the website's own sign-in, pages, catalog and game cards.
- Keeps the website session in the WebView2 profile under the current Windows user.
- Includes back, forward, refresh and home controls.
- Opens external HTTPS links in the default browser.

## Important: gameplay is not connected yet

This app is a desktop wrapper for the website, not a 3D game runtime. The current Sakura backend stores game cards only; it does not yet provide place files, a join-ticket endpoint, a game-arbiter service, or a compatible game client. The OpenPekora source also does not include a ready-to-run Windows Player. Therefore, a website game card cannot become playable just by changing the launcher UI.

Do not distribute proprietary Roblox binaries as part of Sakura Player. A playable Sakura platform needs a compatible client runtime that can legally be used and distributed, server-side game hosting, a join/handshake service, asset delivery and a creator workflow.

## WebView2 requirement

Microsoft Edge WebView2 Runtime must be installed on Windows. If it is missing, Sakura Player shows a prompt with Microsoft's official installation page:

    https://developer.microsoft.com/microsoft-edge/webview2/

## Build locally

With the .NET 8 SDK installed on Windows:

    dotnet publish client/SakuraPlayer/SakuraPlayer.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o publish/SakuraPlayer

The executable will be in:

    publish/SakuraPlayer/SakuraPlayer.exe

## Automated build

GitHub Actions builds the self-contained Windows x64 application and uploads an artifact named SakuraPlayer-win-x64.
