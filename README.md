# Pekora

Pekora is an independent community revival website based on the OpenPekora project. It is not affiliated with or endorsed by Roblox Corporation.

This repository currently deploys a lightweight Cloudflare Worker website with a D1 database. It is a partial website implementation, not a complete Roblox revival platform.

## Implemented

- Responsive Pekora-style website shell and navigation
- Username/password registration and login
- PBKDF2 password hashes with per-user salts
- Secure, HttpOnly session cookies
- D1-backed profiles and profile descriptions
- Public user search and profile pages
- Friend requests, acceptance, cancellation and removal
- Player-to-player item trades with pending item reservations, accept, decline and cancel
- OWNER-managed game cards with title, description and thumbnail
- Locked game cards that visibly show a lock and cannot be launched
- Local catalog cards with image previews
- Server-side virtual-currency purchases
- Persistent account inventory and purchase history
- OWNER-only catalog management and password changes
- Secret-protected OWNER account recovery
- Per-IP rate limits for login, registration and OWNER recovery/bootstrap
- 16 KB API JSON request-body limit
- HTTPS-only preview image URLs for new catalog entries
- API health endpoint that checks the database schema
- Avatar editor with saved R6/R15 rig, body colors, skin tones, body scales and equipped inventory items

New accounts start with 100 P$. The initial OWNER account starts with 1,000 P$.

## Security and database setup

On the first API request, the Worker creates its small site-settings and rate-limit tables and supporting indexes in D1. It also runs the one-time public-catalog cleanout without deleting account inventories or balances.

Failed sign-in, registration and OWNER setup/recovery attempts are rate-limited by a hashed network-address identifier. Ten attempts within the 15-minute window trigger a 15-minute cooldown. Expired per-address counters reset when that address is used again; stale rows are also removed during Worker setup. JSON API request bodies are limited to 16 KB. New catalog preview images must use HTTPS.

## Not connected in this deployment

- The original OpenPekora Avatar API and wearable Roblox assets
- The original Roblox asset catalog
- The public Games page and game runtime are temporarily disabled while technical issues are resolved

Catalog entries created in this build are Pekora inventory items with image or optional GLB previews. They are not Roblox assets. Trades exchange existing inventory items only; they do not transfer Pekora currency or real money. The Avatar page continues to store rig type, body colors, body scales and equipped items, but its 3D preview is temporarily disabled. The public Games page is also temporarily hidden while technical issues are resolved. Existing game-card records and avatar settings are preserved so these features can be revisited later; no game launcher is connected.

Pekora currency is an in-site balance only. It has no real-world monetary value.

## Cloudflare deployment

The repository's `wrangler.toml` is configured for the D1 database named `pekora-db`. Its database ID is already filled in for the configured project. When deploying to a different D1 database, update that ID first.

1. Install Wrangler if it is not already installed:

   ```bash
   npm install -D wrangler
   ```

2. Apply the D1 schema:

   ```bash
   npx wrangler d1 migrations apply pekora-db --remote
   ```

3. Set the one-time owner bootstrap secret. Use a random secret of at least 20 characters and keep it private:

   ```bash
   npx wrangler secret put OWNER_BOOTSTRAP_SECRET
   ```

4. Deploy the Worker and static assets:

   ```bash
   npx wrangler deploy
   ```

5. Check the deployed API:

   ```text
   https://YOUR-WORKER-URL/api/health
   ```

   A healthy response includes `"ok":true`, `"database":true` and `"schema":true`. If the schema check fails, apply the D1 migrations and inspect the Worker logs.

## Creating the first OWNER account

After deployment, send a POST request to `/api/bootstrap-owner` with JSON containing the Worker secret and a new password of at least 12 characters. The username is always `PekoraAdmin`.

PowerShell example:

```powershell
$body = @{
  secret = "YOUR_OWNER_BOOTSTRAP_SECRET"
  password = "YOUR_NEW_LONG_PASSWORD"
} | ConvertTo-Json

Invoke-RestMethod -Method Post `
  -Uri "https://YOUR-WORKER-URL/api/bootstrap-owner" `
  -ContentType "application/json" `
  -Body $body
```

This endpoint closes permanently after the first OWNER account has been created. Do not commit the secret or password to GitHub, and never share them in chat.

For an existing OWNER account, use the Owner Panel while signed in, or the recovery link on the login page with the same Worker secret.

## Development

The project has no separate game runtime. The Worker entry point is `src/worker.js`, static frontend files are in `public/`, and the D1 schema is in `migrations/`.

Run `npx wrangler deploy` to deploy after committing changes to the configured GitHub branch if Cloudflare Workers Builds is connected.
