# Pekora

Pekora is a Roblox Revival-inspired website project. It is not affiliated with Roblox Corporation.

**Games are currently unavailable.** This repository contains a website only; it does not include a game launcher, game client, game server, or game downloads.

## Current foundation

- Classic 2021-inspired responsive website layout
- Username/password registration and login
- Password hashing with PBKDF2 and per-user salts
- HttpOnly session cookies
- D1 schema for users, profiles, catalog items, inventory, purchases and friends
- Catalog listing and server-side item purchases
- User profiles and inventory
- Protected owner bootstrap and owner statistics endpoint
- User search
- Games page marked Coming Soon

Pekora currency is a virtual site currency with no real-world monetary value.

## Cloudflare setup

1. Create a Cloudflare D1 database named `pekora-db`.
2. Copy the database ID into `wrangler.toml`, replacing `REPLACE_WITH_D1_DATABASE_ID`.
3. Install Wrangler: `npm install -D wrangler`.
4. Apply the schema: `npx wrangler d1 migrations apply pekora-db --remote`.
5. Set the one-time owner bootstrap secret: `npx wrangler secret put OWNER_BOOTSTRAP_SECRET`.
6. Deploy: `npx wrangler deploy`.

The owner bootstrap secret must be long and private. Never commit it to GitHub or share it in chat.

## First owner

After deployment, the first owner account is created by sending a POST request to `/api/bootstrap-owner` with JSON:

```json
{
  "secret": "YOUR_OWNER_BOOTSTRAP_SECRET",
  "password": "A_LONG_UNIQUE_PASSWORD"
}
```

The account name is always `PekoraAdmin`, role `OWNER`, starting balance 1000. This endpoint permanently closes after an OWNER account exists. Store the password safely.

## Development status

This is the initial working foundation, not a finished revival platform. Avatar customization, friends management, limited-item trading, full owner management tools, item image uploads and moderation workflows still need implementation and testing.
