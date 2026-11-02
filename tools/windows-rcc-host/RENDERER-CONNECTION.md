# Secure Cloudflare connection for the local renderer

This guide connects the Pekora Worker to the renderer running on the Windows PC. It uses Cloudflare Tunnel plus Cloudflare Access; it does not expose RCC's SOAP port.

## 1. Confirm the local processes

Keep these running in separate windows:

- RCC: local port 64989
- Game Renderer: local port 3001

The renderer start script binds to `127.0.0.1`. Do not create a router port-forward or Windows firewall rule for either port.

## 2. Create a Cloudflare Tunnel route

In the Cloudflare dashboard:

1. Open Zero Trust / Networks / Tunnels and create a remotely managed tunnel.
2. Install and run the tunnel connector on the same Windows PC.
3. Add a published application route for a hostname on a domain in your Cloudflare account.
4. Set its service to `http://127.0.0.1:3001`.

Do not add a route for port 64989. Do not make the renderer hostname publicly accessible without Access.

## 3. Protect the renderer hostname with Access

1. Create a Cloudflare Access application for the renderer hostname.
2. Create a Service Auth policy for that application.
3. Create a Cloudflare Access service token.
4. Keep the Client ID and Client Secret private. Do not put them in this repository or send them in chat.

The Access policy must allow the service token used by the Pekora Worker. A normal browser login policy is not sufficient for the Worker-to-renderer request.

## 4. Add the Worker settings

In Cloudflare Dashboard, open the Pekora Worker settings and add:

- `AVATAR_RENDERER_URL` — the HTTPS origin hostname for the protected renderer, with no path (example shape: `https://renderer.example.com`)
- `AVATAR_RENDERER_CLIENT_ID` — secret containing the Access service-token Client ID
- `AVATAR_RENDERER_CLIENT_SECRET` — secret containing the Access service-token Client Secret

Mark the two Access credentials as secrets. Never commit them to Git.

You can also add the two credentials through Wrangler's `secret put` command from the Pekora project folder. Enter each value only in the terminal prompt; never paste it into chat.

## 5. Check the local renderer config

Open:

`C:\Pekora-RCC-Host\OpenPekora\game-renderer\config.json`

Confirm that `BaseUrl` is exactly:

`https://pekora.green-kaktus8855.workers.dev/`

Do not put the Tunnel hostname in `BaseUrl`. RCC must call the Pekora Worker for `/v1.1/avatar-fetch`; only the Worker calls the private renderer through Access.

If you edit `config.json` while the renderer is running, stop the renderer with Ctrl+C and start it again.

## 6. Deploy and test

1. Deploy the Pekora Worker after merging the avatar-renderer changes.
2. Confirm `/api/health` reports a healthy database and schema.
3. Sign in to Pekora and open Avatar.
4. The Worker should call the protected renderer, which calls RCC, then store the returned OBJ, MTL and texture files in D1.
5. The Avatar page should show the real 3D result. Equipping or removing an item requests a fresh render.

The first render uses an R15 base avatar. Wearable catalog items are included only when the item has a valid numeric Roblox asset ID and asset type ID saved in the Owner Panel. A GLB preview URL by itself is not an RCC wearable asset.

## Troubleshooting

- `PEKAPEKA OK!` proves only that the renderer HTTP process responds; it does not prove RCC rendering works.
- If the Worker says the secure renderer connection is not configured, one or more of the three Worker settings above are missing.
- If Cloudflare Access returns 403, check the Service Auth policy and the two service-token secrets.
- If RCC logs show that `silrev.biz` or `projex.zip` cannot be resolved, the RCC process still cannot retrieve one of its upstream assets or security data. Do not expose the RCC port to work around this; inspect the exact error and upstream dependencies first.
