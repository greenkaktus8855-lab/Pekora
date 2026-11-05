# Sakura Player (preview)

Sakura Player is a separate Windows launcher prototype styled after the classic 2017-era Roblox website.

## Current preview features

- Signs in through the Sakura website's existing POST /api/login endpoint.
- Keeps the Sakura session cookie in memory only; it does not save the username/password or session token to disk.
- Loads the public game cards from GET /api/games.
- Shows game title, description, thumbnail and ID.

## Important: games are not playable yet

This is a launcher shell, not a working 3D game client. The current Sakura backend stores game cards only. It does not yet store place files or place IDs, issue join tickets, start game servers, or expose a game-arbiter service. The OpenPekora repository also does not provide a ready-to-run Windows Player executable.

The Play control therefore stays disabled and clearly says CLIENT NOT CONNECTED. It will only be enabled after a compatible, legally distributable client runtime and the required game-server/join services have been integrated and tested. No proprietary Roblox client files are included or downloaded by this project.

## Build locally

On Windows with the .NET 8 SDK installed, run:

    dotnet publish client/SakuraPlayer/SakuraPlayer.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o publish/SakuraPlayer

The executable will be in publish/SakuraPlayer/SakuraPlayer.exe.

## Automated build

A GitHub Actions workflow builds a self-contained Windows x64 preview and uploads it as an artifact named SakuraPlayer-win-x64.
