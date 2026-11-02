const encoder = new TextEncoder();
const DUMMY_PASSWORD_SALT = "pekora-login-timing-protection-v1";
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
});
const fail = (message, status = 400) => json({ error: message }, status);
const id = () => crypto.randomUUID();
const hex = (bytes) => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
const randomToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
};
async function digest(value) {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}
function constantTimeEqual(left, right) {
  const a = encoder.encode(String(left ?? ""));
  const b = encoder.encode(String(right ?? ""));
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) difference |= (a[i] || 0) ^ (b[i] || 0);
  return difference === 0;
}
async function passwordHash(password, salt) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: encoder.encode(salt), iterations: 100000, hash: "SHA-256" }, material, 256);
  return hex(bits);
}
function cookie(name, value, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
function getCookie(request, name) {
  const raw = request.headers.get("Cookie") || "";
  const part = raw.split(";").map(v => v.trim()).find(v => v.startsWith(name + "="));
  return part ? part.slice(name.length + 1) : "";
}
async function currentUser(request, env) {
  const token = getCookie(request, "pekora_session");
  if (!token) return null;
  const tokenHash = await digest(token);
  const row = await env.DB.prepare(`SELECT u.id,u.username,u.role,u.balance,u.created_at,u.is_banned
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at > datetime('now')`).bind(tokenHash).first();
  if (!row || row.is_banned) return null;
  return row;
}
async function requireUser(request, env) {
  const user = await currentUser(request, env);
  return user || null;
}
class RequestBodyTooLarge extends Error {}
async function body(request) {
  const maxBytes = 16 * 1024;
  const length = Number(request.headers.get("content-length") || 0);
  if (length > maxBytes) throw new RequestBodyTooLarge();
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        try { await reader.cancel(); } catch {}
        throw new RequestBodyTooLarge();
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error instanceof RequestBodyTooLarge) throw error;
    return null;
  }
}
const publicUser = u => ({ id:u.id, username:u.username, role:u.role, balance:u.balance, createdAt:u.created_at });
const ITEM_CATEGORIES = ["Hats","Hair","Faces","Shirts","Pants","Accessories"];
function validItem(data, allowLegacyHttp = false) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "Invalid item details.";
  if (typeof data.name !== "string" || !data.name.trim() || data.name.trim().length > 80) return "Item name must be 1–80 characters.";
  if (!ITEM_CATEGORIES.includes(data.category)) return "Choose a valid item category.";
  const rawPrice = data.price;
  if ((typeof rawPrice !== "number" && typeof rawPrice !== "string") ||
      (typeof rawPrice === "string" && !/^\d+$/.test(rawPrice.trim())) ||
      !Number.isSafeInteger(Number(rawPrice)) || Number(rawPrice) < 0 || Number(rawPrice) > 1000000) {
    return "Price must be between 0 and 1,000,000 P$.";
  }
  if (typeof (data.description ?? "") !== "string" || (data.description ?? "").length > 500) return "Description must be 500 characters or less.";

  const image = String(data.image_url ?? "").trim();
  if (image.length > 500) return "Image URL is too long.";
  if (image) {
    try {
      const u = new URL(image);
      if (u.protocol !== "https:" && !(allowLegacyHttp && u.protocol === "http:")) return "Image URL must use HTTPS.";
    }
    catch { return "Enter a valid image URL."; }
  }
  const assetId = data.asset_id === undefined || data.asset_id === null || data.asset_id === "" ? 0 : Number(data.asset_id);
  const defaultAssetTypes = {Hats:8,Hair:41,Faces:18,Shirts:11,Pants:12};
  const suppliedAssetTypeId = Number(data.asset_type_id || 0);
  const assetTypeId = suppliedAssetTypeId > 0
    ? suppliedAssetTypeId
    : (assetId ? (defaultAssetTypes[data.category] || 0) : 0);
  if (!Number.isSafeInteger(assetId) || assetId < 0 || assetId > 2147483647) return "Roblox asset ID must be a positive whole number.";
  if (!Number.isSafeInteger(assetTypeId) || assetTypeId < 0 || assetTypeId > 2147483647) return "Roblox asset type ID must be a positive whole number.";
  if ((assetId > 0) !== (assetTypeId > 0)) return "Enter both a Roblox asset ID and its asset type ID.";
  const model = String(data.model_url ?? "").trim();
  if (model.length > 1000) return "3D model URL is too long.";
  if (model) {
    try {
      const u = new URL(model);
      if (u.protocol !== "https:") return "3D model URL must use HTTPS.";
    } catch { return "Enter a valid 3D model URL."; }
  }
  if (data.category === "Accessories" && data.is_for_sale !== false && data.is_for_sale !== 0 && !model) {
    return "Accessories need a real HTTPS 3D model URL before they can be listed for sale.";
  }
  return null;
}

let siteSettingsPromise;
async function ensureSiteSettings(env) {
  if (!siteSettingsPromise) {
    siteSettingsPromise = (async () => {
      await env.DB.batch([
        env.DB.prepare("CREATE TABLE IF NOT EXISTS site_settings (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL)"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS auth_rate_limits (rate_key TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0, window_started_at INTEGER NOT NULL, blocked_until INTEGER NOT NULL DEFAULT 0)"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS model_files (id TEXT PRIMARY KEY, model_data BLOB NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))"),
        env.DB.prepare("DROP TABLE IF EXISTS avatar_render_files"),
        env.DB.prepare("DROP TABLE IF EXISTS avatar_render_users"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', thumbnail_url TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')))"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS trades (id TEXT PRIMARY KEY, sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, offered_items TEXT NOT NULL DEFAULT '[]', requested_items TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACCEPTED','DECLINED','CANCELLED')), created_at TEXT NOT NULL DEFAULT (datetime('now')), responded_at TEXT)"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS trade_locks (owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE, trade_id TEXT NOT NULL REFERENCES trades(id) ON DELETE CASCADE, PRIMARY KEY(owner_id,item_id))"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_trades_sender ON trades(sender_id,status,created_at DESC)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_trades_recipient ON trades(recipient_id,status,created_at DESC)"),
        env.DB.prepare("UPDATE profiles SET avatar_json='{}' WHERE avatar_json<>'{}'"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS moderation_warnings (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, moderator_id TEXT NOT NULL REFERENCES users(id), reason TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), acknowledged INTEGER NOT NULL DEFAULT 0)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_moderation_warnings_user ON moderation_warnings(user_id,created_at DESC)"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS owner_audit_log (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id), target_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, action TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')))"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_owner_audit_target ON owner_audit_log(target_user_id,created_at DESC)"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS equipped_items (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE, category TEXT NOT NULL, equipped_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(user_id,item_id))"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_equipped_items_user ON equipped_items(user_id,category)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_friends_friend_status ON friends(friend_id,status)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_items_category_name ON items(category,name)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_items_public_catalog ON items(is_for_sale,category,name)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_inventory_user_purchased ON inventory(user_id,purchased_at DESC)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_auth_rate_window ON auth_rate_limits(window_started_at)"),
        env.DB.prepare("DELETE FROM auth_rate_limits WHERE window_started_at < CAST(strftime('%s','now') AS INTEGER)-86400"),
        env.DB.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')")
      ]);
      const itemColumns = await env.DB.prepare("PRAGMA table_info(items)").all();
      if (!(itemColumns.results || []).some(column => column.name === "model_url")) {
        await env.DB.prepare("ALTER TABLE items ADD COLUMN model_url TEXT NOT NULL DEFAULT ''").run();
      }
      if (!(itemColumns.results || []).some(column => column.name === "asset_id")) {
        await env.DB.prepare("ALTER TABLE items ADD COLUMN asset_id INTEGER NOT NULL DEFAULT 0").run();
      }
      if (!(itemColumns.results || []).some(column => column.name === "asset_type_id")) {
        await env.DB.prepare("ALTER TABLE items ADD COLUMN asset_type_id INTEGER NOT NULL DEFAULT 0").run();
      }
      if (!(itemColumns.results || []).some(column => column.name === "stock_limit")) {
        await env.DB.prepare("ALTER TABLE items ADD COLUMN stock_limit INTEGER NOT NULL DEFAULT 0").run();
      }
      // One-time public catalog cleanout requested for the November 2026 reset.
      // Inventory, purchases, users and balances are deliberately untouched.
      const cleanout = await env.DB.prepare("SELECT setting_value FROM site_settings WHERE setting_key='catalog_cleanout_2026_11_02'").first();
      if (!cleanout) {
        await env.DB.batch([
          env.DB.prepare("UPDATE items SET is_for_sale=0 WHERE is_for_sale=1"),
          env.DB.prepare("INSERT OR IGNORE INTO site_settings (setting_key,setting_value) VALUES ('catalog_cleanout_2026_11_02','done')")
        ]);
      }
      // One-time owner transfer: promote the existing Admin account first.
      // Only remove PekoraAdmin after Admin is confirmed to exist as OWNER.
      const ownerTransfer = await env.DB.prepare("SELECT setting_value FROM site_settings WHERE setting_key='owner_transfer_admin_2026_11_02'").first();
      if (!ownerTransfer) {
        const adminAccount = await env.DB.prepare("SELECT id FROM users WHERE username='Admin' COLLATE NOCASE").first();
        if (adminAccount) {
          await env.DB.batch([
            env.DB.prepare("UPDATE users SET role='OWNER' WHERE id=?").bind(adminAccount.id),
            env.DB.prepare("DELETE FROM users WHERE username='PekoraAdmin' COLLATE NOCASE AND EXISTS (SELECT 1 FROM users WHERE id=? AND role='OWNER')").bind(adminAccount.id),
            env.DB.prepare("INSERT OR IGNORE INTO site_settings (setting_key,setting_value) SELECT 'owner_transfer_admin_2026_11_02','done' WHERE EXISTS (SELECT 1 FROM users WHERE id=? AND role='OWNER')").bind(adminAccount.id)
          ]);
        }
      }
    })().catch(error => {
      // Do not cache a rejected setup promise forever after a transient D1 failure.
      siteSettingsPromise = undefined;
      throw error;
    });
  }
  return siteSettingsPromise;
}

async function rateLimitKey(request, purpose) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  return digest(purpose + ":" + ip);
}
async function isRateLimited(env, key) {
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare("SELECT attempts,window_started_at,blocked_until FROM auth_rate_limits WHERE rate_key=?").bind(key).first();
  if (!row) return false;
  if (Number(row.blocked_until) > now) return true;
  if (row.window_started_at <= now - 900) {
    await env.DB.prepare("DELETE FROM auth_rate_limits WHERE rate_key=?").bind(key).run();
    return false;
  }
  return Number(row.attempts) >= 10;
}
async function recordRateLimitFailure(env, key) {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(`INSERT INTO auth_rate_limits (rate_key,attempts,window_started_at,blocked_until)
    VALUES (?,1,?,0)
    ON CONFLICT(rate_key) DO UPDATE SET
      attempts=CASE WHEN auth_rate_limits.window_started_at<=? THEN 1 ELSE auth_rate_limits.attempts+1 END,
      window_started_at=CASE WHEN auth_rate_limits.window_started_at<=? THEN excluded.window_started_at ELSE auth_rate_limits.window_started_at END,
      blocked_until=CASE WHEN auth_rate_limits.window_started_at<=? THEN 0 ELSE auth_rate_limits.blocked_until END`)
    .bind(key,now,now-900,now-900,now-900).run();
  const row = await env.DB.prepare("SELECT attempts FROM auth_rate_limits WHERE rate_key=?").bind(key).first();
  if (Number(row?.attempts || 0) >= 10) {
    await env.DB.prepare("UPDATE auth_rate_limits SET blocked_until=? WHERE rate_key=?").bind(now+900,key).run();
    return true;
  }
  return false;
}
async function clearRateLimit(env, key) {
  try {
    await env.DB.prepare("DELETE FROM auth_rate_limits WHERE rate_key=?").bind(key).run();
  } catch (error) {
    console.warn("[Pekora rate limit] Could not clear attempt counter:", error);
  }
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path.startsWith("/api/") && path !== "/api/health" && !env.DB) {
    return json({ error:"D1 binding DB is missing." },503);
  }
  if (path.startsWith("/api/") && path !== "/api/health" && env.DB) {
    try { await ensureSiteSettings(env); }
    catch (error) {
      console.error("[Pekora setup] Site settings setup failed:", error);
      return json({ error:"Catalog database setup failed. Check Worker logs." },503);
    }
  }
  if (request.method === "GET" && path === "/api/health") {
    if (!env.DB) return json({ ok:false, site:"Pekora", database:false, schema:false, error:"D1 binding DB is missing." },503);
    try {
      await ensureSiteSettings(env);
      await env.DB.prepare("SELECT 1 AS ok").first();
      const schema = await env.DB.prepare(
        "SELECT COUNT(*) AS total FROM sqlite_master WHERE type='table' AND name IN ('users','sessions','profiles','items','inventory','purchases','friends')"
      ).first();
      if ((schema?.total || 0) !== 7) {
        return json({ ok:false, site:"Pekora", database:true, schema:false, error:"D1 is reachable, but the Pekora migrations are missing or incomplete." },503);
      }
      const requiredColumns = [
        "SELECT id,username,password_hash,password_salt,role,balance,created_at,is_banned FROM users LIMIT 0",
        "SELECT token_hash,user_id,expires_at FROM sessions LIMIT 0",
        "SELECT user_id,description,avatar_json FROM profiles LIMIT 0",
        "SELECT id,name,description,category,price,image_url,model_url,is_limited,is_for_sale,created_at FROM items LIMIT 0",
        "SELECT id,user_id,item_id,purchased_at FROM inventory LIMIT 0",
        "SELECT id,user_id,item_id,price,purchased_at FROM purchases LIMIT 0",
        "SELECT user_id,friend_id,status,created_at FROM friends LIMIT 0"
      ];
      try {
        await env.DB.batch(requiredColumns.map(sql => env.DB.prepare(sql)));
      } catch (schemaError) {
        console.error("[Pekora health] D1 schema validation failed:", schemaError);
        return json({ ok:false, site:"Pekora", database:true, schema:false, error:"D1 tables exist, but required Pekora columns are missing. Check and apply the migrations." },503);
      }
      return json({ ok:true, site:"Pekora", database:true, schema:true });
    } catch (error) {
      console.error("[Pekora health] D1 check failed:", error);
      return json({ ok:false, site:"Pekora", database:false, schema:false, error:"D1 database check failed. See Worker logs." },503);
    }
  }

  if (request.method === "POST" && path === "/api/register") {
    const key = await rateLimitKey(request,"register");
    if (await isRateLimited(env,key)) return json({error:"Too many registration attempts. Try again in 15 minutes."},429,{"retry-after":"900"});
    const registrationFailure = async (message,status=400) => {
      const blocked = await recordRateLimitFailure(env,key);
      return blocked?json({error:"Too many registration attempts. Try again in 15 minutes."},429,{"retry-after":"900"}):fail(message,status);
    };
    const data = await body(request);
    if (!data || typeof data.username !== "string" || typeof data.password !== "string") return registrationFailure("Enter a username and password.");
    const username = data.username.trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return registrationFailure("Username must be 3–20 characters and use only letters, numbers or _.");
    if (username.toLowerCase() === "pekoraadmin") return registrationFailure("That username is reserved.");
    if (data.password.length < 8 || data.password.length > 128) return registrationFailure("Password must be at least 8 characters.");
    const exists = await env.DB.prepare("SELECT id FROM users WHERE username=? COLLATE NOCASE").bind(username).first();
    if (exists) return registrationFailure("That username is already taken.",409);
    const salt = randomToken();
    const hash = await passwordHash(data.password, salt);
    const userId = id();
    const token = randomToken();
    try {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO users (id,username,password_hash,password_salt,balance) VALUES (?,?,?,?,100)").bind(userId, username, hash, salt),
        env.DB.prepare("INSERT INTO profiles (user_id) VALUES (?)").bind(userId),
        env.DB.prepare("INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,datetime('now','+30 days'))").bind(await digest(token), userId)
      ]);
    } catch (error) {
      const existing = await env.DB.prepare("SELECT id FROM users WHERE username=? COLLATE NOCASE").bind(username).first().catch(() => null);
      if (existing) return registrationFailure("That username is already taken.",409);
      console.error("[Pekora register] Account creation failed:", error);
      return registrationFailure("Account creation failed. Please try again.",503);
    }
    await clearRateLimit(env,key);
    const user = await env.DB.prepare("SELECT id,username,role,balance,created_at,is_banned FROM users WHERE id=?").bind(userId).first();
    return json({ user:publicUser(user) }, 201, { "set-cookie":cookie("pekora_session",token,60*60*24*30) });
  }

  if (request.method === "POST" && path === "/api/login") {
    const data = await body(request);
    if (!data || typeof data.username !== "string" || !/^[A-Za-z0-9_]{3,20}$/.test(data.username.trim()) || typeof data.password !== "string" || data.password.length < 8 || data.password.length > 128) return fail("Enter a valid username and a password of 8–128 characters.");
    const key = await rateLimitKey(request,"login");
    if (await isRateLimited(env,key)) return json({error:"Too many sign-in attempts. Try again in 15 minutes."},429,{"retry-after":"900"});
    const user = await env.DB.prepare("SELECT * FROM users WHERE username=? COLLATE NOCASE").bind(data.username.trim()).first();
    const candidateHash = await passwordHash(data.password,user?.password_salt||DUMMY_PASSWORD_SALT);
    const passwordMatches = constantTimeEqual(candidateHash,user?.password_hash||"");
    if (!user || user.is_banned || !passwordMatches) {
      const blocked = await recordRateLimitFailure(env,key);
      return blocked?json({error:"Too many sign-in attempts. Try again in 15 minutes."},429,{"retry-after":"900"}):fail("Incorrect username or password.",401);
    }
    await clearRateLimit(env,key);
    const token = randomToken();
    await env.DB.prepare("INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,datetime('now','+30 days'))").bind(await digest(token), user.id).run();
    return json({ user:publicUser(user) }, 200, { "set-cookie":cookie("pekora_session",token,60*60*24*30) });
  }

  if (request.method === "POST" && path === "/api/logout") {
    const token = getCookie(request,"pekora_session");
    if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await digest(token)).run();
    return json({ ok:true },200,{"set-cookie":cookie("pekora_session","",0)});
  }

  if (request.method === "GET" && path === "/api/me") {
    const user = await currentUser(request,env);
    return json({ user:user ? publicUser(user) : null });
  }

  if (request.method === "POST" && path === "/api/bootstrap-owner") {
    const data = await body(request), key = await rateLimitKey(request,"owner-bootstrap");
    if (await isRateLimited(env,key)) return json({error:"Too many owner setup attempts. Try again in 15 minutes."},429,{"retry-after":"900"});
    const configuredOwnerSecret = typeof env.OWNER_BOOTSTRAP_SECRET === "string" ? env.OWNER_BOOTSTRAP_SECRET.trim() : "";
    const suppliedOwnerSecret = typeof data?.secret === "string" ? data.secret.trim() : "";
    if (configuredOwnerSecret.length < 20 ||
        suppliedOwnerSecret.length < 20 || suppliedOwnerSecret.length > 512 ||
        !constantTimeEqual(await digest(suppliedOwnerSecret),await digest(configuredOwnerSecret))) {
      const blocked = await recordRateLimitFailure(env,key);
      return blocked?json({error:"Too many owner setup attempts. Try again in 15 minutes."},429,{"retry-after":"900"}):fail("Invalid owner setup key.",403);
    }
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role='OWNER'").first();
    if (count.n > 0) return fail("An owner account has already been created.",409);
    if (typeof data.password !== "string" || data.password.length < 12 || data.password.length > 128) return fail("Owner password must be at least 12 characters.");
    const username = "PekoraAdmin";
    const salt = randomToken(), hash = await passwordHash(data.password,salt), userId=id();
    const token = randomToken();
    try {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO users (id,username,password_hash,password_salt,role,balance) VALUES (?,?,?,?, 'OWNER',1000)").bind(userId,username,hash,salt),
        env.DB.prepare("INSERT INTO profiles (user_id) VALUES (?)").bind(userId),
        env.DB.prepare("INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,datetime('now','+30 days'))").bind(await digest(token),userId)
      ]);
    } catch (error) {
      const existingOwner = await env.DB.prepare("SELECT id FROM users WHERE role='OWNER'").first().catch(() => null);
      if (existingOwner) return fail("An owner account has already been created.",409);
      const usernameTaken = await env.DB.prepare("SELECT id FROM users WHERE username=? COLLATE NOCASE").bind(username).first().catch(() => null);
      if (usernameTaken) return fail("The PekoraAdmin username is already in use.",409);
      console.error("[Pekora bootstrap] Owner creation failed:", error);
      return fail("Owner setup failed. Please check Worker logs.",503);
    }
    await clearRateLimit(env,key);
    const user = await env.DB.prepare("SELECT id,username,role,balance,created_at FROM users WHERE id=?").bind(userId).first();
    return json({ user:publicUser(user) },201,{"set-cookie":cookie("pekora_session",token,60*60*24*30)});
  }

  if (request.method === "GET" && path === "/api/catalog") {
    const rows = await env.DB.prepare("SELECT id,name,description,category,price,image_url,model_url,is_limited,created_at,CASE WHEN category='Accessories' THEN CASE WHEN model_url<>'' THEN '3D' ELSE '3D_MISSING' END ELSE 'IMAGE_ONLY' END AS asset_kind FROM items WHERE is_for_sale=1 ORDER BY category,name").all();
    return json({ items:rows.results || [] });
  }

  if (request.method === "POST" && path === "/api/purchase") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const data = await body(request);
    if (typeof data?.itemId !== "string") return fail("Invalid item.");
    const item = await env.DB.prepare("SELECT * FROM items WHERE id=? AND is_for_sale=1").bind(data.itemId).first();
    if (!item) return fail("Item not found.",404);
    if (item.price > user.balance) return fail("Not enough Pekora currency.",400);
    if (await env.DB.prepare("SELECT id FROM inventory WHERE user_id=? AND item_id=?").bind(user.id,item.id).first()) return fail("You already own this item.",409);
    const purchaseId=id(), inventoryId=id();
    try {
      const results = await env.DB.batch([
        env.DB.prepare("UPDATE users SET balance=balance-? WHERE id=? AND balance>=? AND NOT EXISTS (SELECT 1 FROM inventory WHERE user_id=? AND item_id=?) AND EXISTS (SELECT 1 FROM items WHERE id=? AND is_for_sale=1)").bind(item.price,user.id,item.price,user.id,item.id,item.id),
        env.DB.prepare("INSERT INTO inventory (id,user_id,item_id) SELECT ?,?,? WHERE changes()=1").bind(inventoryId,user.id,item.id),
        env.DB.prepare("INSERT INTO purchases (id,user_id,item_id,price) SELECT ?,?,?,? WHERE changes()=1").bind(purchaseId,user.id,item.id,item.price)
      ]);
      if (!results?.[0]?.meta?.changes) return fail("Not enough currency or item already owned.",409);
    } catch { return fail("Purchase could not be completed.",400); }
    const updated = await env.DB.prepare("SELECT balance FROM users WHERE id=?").bind(user.id).first();
    return json({ ok:true,balance:updated.balance });
  }

  if (request.method === "GET" && path === "/api/currency/history") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const rows = await env.DB.prepare("SELECT p.price,p.purchased_at,i.name,i.category FROM purchases p JOIN items i ON i.id=p.item_id WHERE p.user_id=? ORDER BY p.purchased_at DESC LIMIT 50").bind(user.id).all();
    return json({ purchases:rows.results || [] });
  }

  if (request.method === "GET" && path === "/api/inventory") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const rows = await env.DB.prepare("SELECT i.id,i.name,i.description,i.category,i.price,i.image_url,i.model_url,CASE WHEN i.category='Accessories' THEN CASE WHEN i.model_url<>'' THEN '3D' ELSE '3D_MISSING' END ELSE 'IMAGE_ONLY' END AS asset_kind FROM inventory v JOIN items i ON i.id=v.item_id WHERE v.user_id=? ORDER BY v.purchased_at DESC").bind(user.id).all();
    return json({ items:rows.results || [] });
  }

  const profileInventoryMatch = path.match(/^\/api\/profile\/([A-Za-z0-9_]{3,20})\/inventory$/);
  if (request.method === "GET" && profileInventoryMatch) {
    const username = profileInventoryMatch[1];
    const profile = await env.DB.prepare("SELECT id FROM users WHERE username=? COLLATE NOCASE AND is_banned=0").bind(username).first();
    if (!profile) return fail("User not found.",404);
    const rows = await env.DB.prepare("SELECT i.id,i.name,i.description,i.category,i.price,i.image_url,i.model_url,CASE WHEN i.category='Accessories' THEN CASE WHEN i.model_url<>'' THEN '3D' ELSE '3D_MISSING' END ELSE 'IMAGE_ONLY' END AS asset_kind FROM inventory v JOIN items i ON i.id=v.item_id WHERE v.user_id=? ORDER BY v.purchased_at DESC").bind(profile.id).all();
    return json({ items:rows.results || [] });
  }

  if (request.method === "GET" && path.startsWith("/api/profile/") && path.endsWith("/avatar")) {
    let username;
    try { username = decodeURIComponent(path.slice("/api/profile/".length, -"/avatar".length)); }
    catch { return fail("Invalid username.",400); }
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return fail("Invalid username.",400);
    const target = await env.DB.prepare("SELECT u.id,p.avatar_json FROM users u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.username=? COLLATE NOCASE AND u.is_banned=0").bind(username).first();
    if (!target) return fail("User not found.",404);
    const rows = await env.DB.prepare("SELECT i.id,i.name,i.category,i.image_url,i.model_url FROM equipped_items e JOIN items i ON i.id=e.item_id WHERE e.user_id=? ORDER BY e.equipped_at DESC").bind(target.id).all();
    let render = null;
    try {
      const parsed = target.avatar_json ? JSON.parse(target.avatar_json) : null;
      if (parsed && parsed.camera && parsed.aabb && typeof parsed.obj === "string" && typeof parsed.mtl === "string" && Array.isArray(parsed.textures)) render = parsed;
    } catch {}
    return json({equipped:rows.results||[],render});
  }

  if (request.method === "GET" && path.startsWith("/api/profile/")) {
    let username;
    try { username = decodeURIComponent(path.slice("/api/profile/".length)); }
    catch { return fail("Invalid username.",400); }
    const profile = await env.DB.prepare(`SELECT u.id,u.username,u.role,u.created_at,p.description
      FROM users u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.username=? COLLATE NOCASE AND u.is_banned=0`).bind(username).first();
    if (!profile) return fail("User not found.",404);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM inventory WHERE user_id=?").bind(profile.id).first();
    return json({ profile:{id:profile.id,username:profile.username,role:profile.role,createdAt:profile.created_at,description:profile.description||"",itemCount:count.n} });
  }

  if (path === "/api/avatar" && request.method === "GET") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const rows = await env.DB.prepare("SELECT i.id,i.name,i.category,i.image_url,i.model_url FROM equipped_items e JOIN items i ON i.id=e.item_id WHERE e.user_id=? ORDER BY e.equipped_at DESC").bind(user.id).all();
    return json({ enabled:true, equipped:rows.results||[] });
  }

  if (path === "/api/avatar" && request.method === "PUT") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const data = await body(request);
    const itemId = String(data?.itemId||"");
    const action = data?.action;
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(itemId) || !["wear","remove"].includes(action)) return fail("Choose an inventory item and a valid avatar action.");
    const item = await env.DB.prepare("SELECT i.id,i.category FROM inventory v JOIN items i ON i.id=v.item_id WHERE v.user_id=? AND i.id=?").bind(user.id,itemId).first();
    if (!item) return fail("You can only equip items in your inventory.",404);
    if (!["Hats","Hair","Faces","Shirts","Pants","Accessories"].includes(item.category)) return fail("This item category cannot be equipped on the avatar.");
    if (action === "remove") {
      await env.DB.prepare("DELETE FROM equipped_items WHERE user_id=? AND item_id=?").bind(user.id,itemId).run();
      return json({ok:true,action,equipped:false});
    }
    const statements = [];
    if (["Hair","Faces","Shirts","Pants"].includes(item.category)) {
      statements.push(env.DB.prepare("DELETE FROM equipped_items WHERE user_id=? AND category=?").bind(user.id,item.category));
    }
    statements.push(env.DB.prepare("INSERT OR IGNORE INTO equipped_items (user_id,item_id,category) VALUES (?,?,?)").bind(user.id,item.id,item.category));
    await env.DB.batch(statements);
    return json({ok:true,action,equipped:true});
  }

  if (request.method === "PUT" && path === "/api/profile") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const data = await body(request);
    if (typeof data?.description !== "string" || data.description.length > 500) return fail("Description must be 500 characters or less.");
    await env.DB.prepare(`INSERT INTO profiles (user_id,description) VALUES (?,?)
      ON CONFLICT(user_id) DO UPDATE SET description=excluded.description`).bind(user.id,data.description).run();
    return json({ok:true});
  }

  if (request.method === "GET" && path === "/api/friends") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const [accepted,incoming,outgoing] = await Promise.all([
      env.DB.prepare("SELECT u.username,u.role FROM friends f JOIN users u ON u.id=f.friend_id WHERE f.user_id=? AND f.status='ACCEPTED' AND u.is_banned=0 UNION SELECT u.username,u.role FROM friends f JOIN users u ON u.id=f.user_id WHERE f.friend_id=? AND f.status='ACCEPTED' AND u.is_banned=0 ORDER BY username").bind(user.id,user.id).all(),
      env.DB.prepare("SELECT u.username,u.role FROM friends f JOIN users u ON u.id=f.user_id WHERE f.friend_id=? AND f.status='PENDING' AND u.is_banned=0 ORDER BY u.username").bind(user.id).all(),
      env.DB.prepare("SELECT u.username,u.role FROM friends f JOIN users u ON u.id=f.friend_id WHERE f.user_id=? AND f.status='PENDING' AND u.is_banned=0 ORDER BY u.username").bind(user.id).all()
    ]);
    return json({ friends:accepted.results||[],incoming:incoming.results||[],outgoing:outgoing.results||[] });
  }

  if (request.method === "GET" && path === "/api/friends/status") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const username = (url.searchParams.get("username")||"").trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return fail("Enter a valid username.");
    const target = await env.DB.prepare("SELECT id FROM users WHERE username=? COLLATE NOCASE AND is_banned=0").bind(username).first();
    if (!target) return fail("User not found.",404);
    if (target.id === user.id) return json({status:"self"});
    const pair = await env.DB.prepare("SELECT user_id,friend_id,status FROM friends WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)").bind(user.id,target.id,target.id,user.id).all();
    const relation = pair.results||[];
    const accepted = relation.some(x=>x.status==="ACCEPTED");
    const outgoing = relation.some(x=>x.user_id===user.id && x.status==="PENDING");
    const incoming = relation.some(x=>x.friend_id===user.id && x.status==="PENDING");
    return json({status:accepted?"friends":incoming?"incoming":outgoing?"outgoing":"none"});
  }

  if (request.method === "POST" && path === "/api/friends/request") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const data = await body(request), username = String(data?.username||"").trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return fail("Enter a valid username.");
    const target = await env.DB.prepare("SELECT id FROM users WHERE username=? COLLATE NOCASE AND is_banned=0").bind(username).first();
    if (!target) return fail("User not found.",404);
    if (target.id === user.id) return fail("You cannot add yourself.");
    const existing = await env.DB.prepare("SELECT user_id,friend_id,status FROM friends WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)").bind(user.id,target.id,target.id,user.id).all();
    const rows=existing.results||[];
    if (rows.some(x=>x.status==="ACCEPTED")) return fail("You are already friends.",409);
    const reverse=rows.find(x=>x.user_id===target.id && x.friend_id===user.id && x.status==="PENDING");
    if (reverse) {
      const results = await env.DB.batch([
        env.DB.prepare("UPDATE friends SET status='ACCEPTED' WHERE user_id=? AND friend_id=? AND status='PENDING'").bind(target.id,user.id),
        env.DB.prepare("INSERT OR REPLACE INTO friends (user_id,friend_id,status) SELECT ?,?,'ACCEPTED' WHERE changes()=1").bind(user.id,target.id)
      ]);
      if (!results?.[0]?.meta?.changes) return fail("That friend request was cancelled before it could be accepted.",409);
      return json({ok:true,status:"friends"});
    }
    if (rows.some(x=>x.user_id===user.id && x.friend_id===target.id && x.status==="PENDING")) return fail("Friend request already sent.",409);
    try {
      await env.DB.prepare("INSERT INTO friends (user_id,friend_id,status) VALUES (?,?,'PENDING')").bind(user.id,target.id).run();
    } catch (error) {
      const relation = await env.DB.prepare("SELECT status FROM friends WHERE user_id=? AND friend_id=?").bind(user.id,target.id).first().catch(() => null);
      if (relation?.status === "ACCEPTED") return fail("You are already friends.",409);
      if (relation?.status === "PENDING") return fail("Friend request already sent.",409);
      throw error;
    }
    // Recheck after inserting so simultaneous reciprocal requests become an accepted friendship.
    const reciprocal = await env.DB.prepare("SELECT user_id FROM friends WHERE user_id=? AND friend_id=? AND status='PENDING'").bind(target.id,user.id).first();
    if (reciprocal) {
      const results = await env.DB.batch([
        env.DB.prepare("UPDATE friends SET status='ACCEPTED' WHERE user_id=? AND friend_id=? AND status='PENDING'").bind(target.id,user.id),
        env.DB.prepare("INSERT OR REPLACE INTO friends (user_id,friend_id,status) SELECT ?,?,'ACCEPTED' WHERE changes()=1").bind(user.id,target.id)
      ]);
      if (results?.[0]?.meta?.changes) return json({ok:true,status:"friends"});
      const relation = await env.DB.prepare("SELECT status FROM friends WHERE user_id=? AND friend_id=?").bind(user.id,target.id).first();
      if (relation?.status === "ACCEPTED") return json({ok:true,status:"friends"});
    }
    const currentRelation = await env.DB.prepare("SELECT status FROM friends WHERE user_id=? AND friend_id=?").bind(user.id,target.id).first();
    if (currentRelation?.status === "ACCEPTED") return json({ok:true,status:"friends"});
    return json({ok:true,status:"outgoing"},201);
  }

  if (request.method === "POST" && path === "/api/friends/accept") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const data = await body(request), username = String(data?.username||"").trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return fail("Enter a valid username.");
    const target = await env.DB.prepare("SELECT id FROM users WHERE username=? COLLATE NOCASE AND is_banned=0").bind(username).first();
    if (!target) return fail("User not found.",404);
    const results = await env.DB.batch([
      env.DB.prepare("UPDATE friends SET status='ACCEPTED' WHERE user_id=? AND friend_id=? AND status='PENDING'").bind(target.id,user.id),
      env.DB.prepare("INSERT OR REPLACE INTO friends (user_id,friend_id,status) SELECT ?,?,'ACCEPTED' WHERE changes()=1").bind(user.id,target.id)
    ]);
    if (!results?.[0]?.meta?.changes) return fail("No pending request from this user.",404);
    return json({ok:true,status:"friends"});
  }

  if (request.method === "DELETE" && path === "/api/friends") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const username = String(url.searchParams.get("username")||"").trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return fail("Enter a valid username.");
    const target = await env.DB.prepare("SELECT id FROM users WHERE username=? COLLATE NOCASE").bind(username).first();
    if (!target) return fail("User not found.",404);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM friends WHERE user_id=? AND friend_id=?").bind(user.id,target.id),
      env.DB.prepare("DELETE FROM friends WHERE user_id=? AND friend_id=?").bind(target.id,user.id)
    ]);
    return json({ok:true});
  }

  if (path === "/api/owner/recover" && request.method === "POST") {
    const data = await body(request), key = await rateLimitKey(request,"owner-recovery");
    if (await isRateLimited(env,key)) return json({error:"Too many owner recovery attempts. Try again in 15 minutes."},429,{"retry-after":"900"});
    const recoverySecret = typeof env.OWNER_BOOTSTRAP_SECRET === "string" ? env.OWNER_BOOTSTRAP_SECRET.trim() : "";
    const suppliedSecret = typeof data?.secret === "string" ? data.secret.trim() : "";
    if (recoverySecret.length < 20 ||
        suppliedSecret.length < 20 || suppliedSecret.length > 512 ||
        !constantTimeEqual(await digest(suppliedSecret),await digest(recoverySecret))) {
      const blocked = await recordRateLimitFailure(env,key);
      return blocked?json({error:"Too many owner recovery attempts. Try again in 15 minutes."},429,{"retry-after":"900"}):fail("Invalid owner recovery secret.",403);
    }
    if (typeof data?.password !== "string" || data.password.length < 12 || data.password.length > 128) {
      return fail("New owner password must be 12–128 characters.");
    }
    const owner = await env.DB.prepare("SELECT id FROM users WHERE username='PekoraAdmin' COLLATE NOCASE AND role='OWNER'").first();
    if (!owner) return fail("PekoraAdmin OWNER account was not found.",404);
    const activeUser = await currentUser(request,env);
    const clearCurrentCookie = activeUser?.id === owner.id;
    const salt = randomToken();
    const hash = await passwordHash(data.password,salt);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET password_hash=?,password_salt=? WHERE id=? AND role='OWNER'").bind(hash,salt,owner.id),
      env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(owner.id)
    ]);
    await clearRateLimit(env,key);
    return json(
      {ok:true,message:"PekoraAdmin password reset. All previous sessions were signed out."},
      200,
      clearCurrentCookie?{"set-cookie":cookie("pekora_session","",0)}:{}
    );
  }

  if (path === "/api/owner/password" && request.method === "POST") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    if (user.role !== "OWNER") return fail("Owner access required.",403);
    const data = await body(request);
    if (typeof data?.password !== "string" || data.password.length < 12 || data.password.length > 128) {
      return fail("New owner password must be 12–128 characters.");
    }
    const salt = randomToken();
    const hash = await passwordHash(data.password,salt);
    const currentToken = getCookie(request,"pekora_session");
    const currentTokenHash = await digest(currentToken);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET password_hash=?,password_salt=? WHERE id=? AND role='OWNER'").bind(hash,salt,user.id),
      env.DB.prepare("DELETE FROM sessions WHERE user_id=? AND token_hash<>?").bind(user.id,currentTokenHash)
    ]);
    return json({ok:true,message:"Owner password updated. Other sessions for this account were signed out."});
  }

  if (path === "/api/owner/models" && request.method === "POST") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    if (user.role !== "OWNER") return fail("Owner access required.",403);
    const length = Number(request.headers.get("content-length") || 0);
    const maxBytes = 1024 * 1024;
    if (length > maxBytes) return fail("GLB file must be 1 MB or smaller for database storage.",413);
    const contentType = (request.headers.get("content-type") || "").toLowerCase();
    if (!["model/gltf-binary","application/octet-stream"].includes(contentType)) return fail("Upload a .glb file.",415);
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > maxBytes) return fail("GLB file must be between 1 byte and 1 MB.",413);
    const view = new DataView(bytes);
    if (bytes.byteLength < 12 || view.getUint32(0,true) !== 0x46546c67 || view.getUint32(4,true) !== 2 || view.getUint32(8,true) !== bytes.byteLength) {
      return fail("This file is not a valid binary glTF 2.0 (.glb).",415);
    }
    const modelId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO model_files (id,model_data,created_at) VALUES (?,?,datetime('now'))").bind(modelId,bytes).run();
    return json({ok:true,url:new URL("/api/models/"+modelId+".glb",request.url).toString()},201);
  }

  const modelMatch = path.match(/^\/api\/models\/([A-Za-z0-9-]+\.glb)$/);
  if (modelMatch && request.method === "GET") {
    const model = await env.DB.prepare("SELECT model_data FROM model_files WHERE id=?").bind(modelMatch[1].slice(0,-4)).first();
    if (!model?.model_data) return fail("3D model not found.",404);
    return new Response(model.model_data,{headers:{
      "content-type":"model/gltf-binary",
      "cache-control":"public, max-age=31536000, immutable",
      "x-content-type-options":"nosniff",
      "access-control-allow-origin":"*"
    }});
  }

  if (path.startsWith("/api/owner/users")) {
    const actor = await requireUser(request,env);
    if (!actor) return fail("Please sign in.",401);
    if (actor.role !== "OWNER") return fail("Owner access required.",403);

    if (path === "/api/owner/users" && request.method === "GET") {
      const q = (url.searchParams.get("q") || "").trim().slice(0,32);
      if (q.length < 2) return json({users:[]});
      const rows = await env.DB.prepare(`SELECT id,username,role,balance,created_at,is_banned FROM users
        WHERE instr(lower(username),lower(?))>0 OR id=? ORDER BY username LIMIT 30`).bind(q,q).all();
      return json({users:rows.results||[]});
    }

    const userMatch = path.match(/^\/api\/owner\/users\/([A-Za-z0-9-]+)$/);
    if (!userMatch) return fail("User not found.",404);
    const targetId = userMatch[1];
    const target = await env.DB.prepare("SELECT id,username,role,balance,created_at,is_banned FROM users WHERE id=?").bind(targetId).first();
    if (!target) return fail("User not found.",404);

    if (request.method === "GET") {
      const [warnings,logs] = await Promise.all([
        env.DB.prepare("SELECT id,reason,created_at,acknowledged FROM moderation_warnings WHERE user_id=? ORDER BY created_at DESC LIMIT 20").bind(targetId).all(),
        env.DB.prepare("SELECT action,details,created_at FROM owner_audit_log WHERE target_user_id=? ORDER BY created_at DESC LIMIT 20").bind(targetId).all()
      ]);
      return json({user:target,warnings:warnings.results||[],logs:logs.results||[]});
    }

    if (request.method !== "POST") return fail("Unsupported user management action.",405);
    if (target.role === "OWNER") return fail("Owner accounts cannot be modified from user management.",403);
    const data = await body(request);
    const action = String(data?.action||"");
    const details = String(data?.reason||"").trim().slice(0,500);
    if (action === "credit") {
      const amount = Number(data?.amount);
      if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000) return fail("Enter an amount from 1 to 1,000,000 P$.");
      const result = await env.DB.prepare("UPDATE users SET balance=balance+? WHERE id=? AND balance<=1000000000-?").bind(amount,targetId,amount).run();
      if (!result?.meta?.changes) return fail("Could not add currency. The balance limit may have been reached.",409);
      await env.DB.prepare("INSERT INTO owner_audit_log (id,actor_id,target_user_id,action,details) VALUES (?,?,?,?,?)").bind(id(),actor.id,targetId,"CURRENCY_CREDIT",amount+" P$"+(details?" — "+details:"")).run();
    } else if (action === "warn") {
      if (details.length < 3) return fail("Enter a warning reason (at least 3 characters).");
      await env.DB.batch([
        env.DB.prepare("INSERT INTO moderation_warnings (id,user_id,moderator_id,reason) VALUES (?,?,?,?)").bind(id(),targetId,actor.id,details),
        env.DB.prepare("INSERT INTO owner_audit_log (id,actor_id,target_user_id,action,details) VALUES (?,?,?,?,?)").bind(id(),actor.id,targetId,"WARNING",details)
      ]);
    } else if (action === "ban" || action === "unban") {
      if (action === "ban" && details.length < 3) return fail("Enter a ban reason (at least 3 characters).");
      await env.DB.batch([
        env.DB.prepare("UPDATE users SET is_banned=? WHERE id=?").bind(action==="ban"?1:0,targetId),
        ...(action==="ban"?[env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(targetId)]:[]),
        env.DB.prepare("INSERT INTO owner_audit_log (id,actor_id,target_user_id,action,details) VALUES (?,?,?,?,?)").bind(id(),actor.id,targetId,action.toUpperCase(),details)
      ]);
    } else {
      return fail("Unknown user management action.");
    }
    const updated = await env.DB.prepare("SELECT id,username,role,balance,created_at,is_banned FROM users WHERE id=?").bind(targetId).first();
    return json({ok:true,user:updated});
  }

  if (path === "/api/account/warnings" && request.method === "GET") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const rows = await env.DB.prepare("SELECT id,reason,created_at,acknowledged FROM moderation_warnings WHERE user_id=? ORDER BY created_at DESC LIMIT 20").bind(user.id).all();
    return json({warnings:rows.results||[]});
  }

  if (request.method === "GET" && path === "/api/games") {
    const rows = await env.DB.prepare("SELECT id,title,description,thumbnail_url,created_at FROM games ORDER BY created_at DESC,title LIMIT 100").all();
    return json({games:rows.results||[]});
  }

  if (path.startsWith("/api/owner/games")) {
    const actor = await requireUser(request,env);
    if (!actor) return fail("Please sign in.",401);
    if (actor.role !== "OWNER") return fail("Owner access required.",403);
    if (path === "/api/owner/games" && request.method === "GET") {
      const rows = await env.DB.prepare("SELECT id,title,description,thumbnail_url,created_at FROM games ORDER BY created_at DESC").all();
      return json({games:rows.results||[]});
    }
    if (path === "/api/owner/games" && request.method === "POST") {
      const data = await body(request);
      const title = String(data?.title||"").trim();
      const description = String(data?.description||"").trim();
      const thumbnail = String(data?.thumbnail_url||"").trim();
      if (!title || title.length>80) return fail("Game title must be 1–80 characters.");
      if (description.length>500) return fail("Description must be 500 characters or less.");
      if (thumbnail) {
        try { const image = new URL(thumbnail); if (image.protocol!=="https:") throw new Error(); }
        catch { return fail("Game image must be a valid HTTPS URL."); }
      }
      const gameId=id();
      await env.DB.prepare("INSERT INTO games (id,title,description,thumbnail_url) VALUES (?,?,?,?)").bind(gameId,title,description,thumbnail).run();
      return json({ok:true,id:gameId},201);
    }
    const gameMatch=path.match(/^\/api\/owner\/games\/([A-Za-z0-9-]+)$/);
    if (gameMatch && request.method==="DELETE") {
      await env.DB.prepare("DELETE FROM games WHERE id=?").bind(gameMatch[1]).run();
      return json({ok:true});
    }
    return fail("Unsupported game management action.",405);
  }

  if (path === "/api/trades" && request.method === "GET") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const rows = await env.DB.prepare(`SELECT t.*,s.username AS sender_name,r.username AS recipient_name
      FROM trades t JOIN users s ON s.id=t.sender_id JOIN users r ON r.id=t.recipient_id
      WHERE t.sender_id=? OR t.recipient_id=? ORDER BY t.created_at DESC LIMIT 40`).bind(user.id,user.id).all();
    const trades = [];
    for (const row of rows.results||[]) {
      const offeredIds = JSON.parse(row.offered_items||"[]");
      const requestedIds = JSON.parse(row.requested_items||"[]");
      const loadItems = async (ownerId,ids) => {
        if (!ids.length) return [];
        const marks=ids.map(()=>"?").join(",");
        const found=await env.DB.prepare(`SELECT i.id,i.name,i.category,i.image_url,i.price FROM items i WHERE i.id IN (${marks})`).bind(...ids).all();
        return found.results||[];
      };
      trades.push({...row,offeredItems:await loadItems(row.sender_id,offeredIds),requestedItems:await loadItems(row.recipient_id,requestedIds)});
    }
    return json({trades});
  }

  if (path === "/api/trades" && request.method === "POST") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const data=await body(request);
    const username=String(data?.username||"").trim();
    const recipient=await env.DB.prepare("SELECT id,username FROM users WHERE username=? COLLATE NOCASE AND is_banned=0").bind(username).first();
    if (!recipient) return fail("Player not found.",404);
    if (recipient.id===user.id) return fail("You cannot trade with yourself.");
    const offered=Array.isArray(data?.offeredIds)?data.offeredIds:[];
    const requested=Array.isArray(data?.requestedIds)?data.requestedIds:[];
    const validIds=arr=>arr.length<=10&&arr.every(x=>typeof x==="string"&&/^[A-Za-z0-9_-]{1,80}$/.test(x))&&new Set(arr).size===arr.length;
    if (!validIds(offered)||!validIds(requested)||(!offered.length&&!requested.length)) return fail("Choose up to 10 different items for each side of the trade.");
    const checkOwned=async(ownerId,ids)=>{
      if(!ids.length)return true;
      const marks=ids.map(()=>"?").join(",");
      const rows=await env.DB.prepare(`SELECT item_id FROM inventory WHERE user_id=? AND item_id IN (${marks})`).bind(ownerId,...ids).all();
      return (rows.results||[]).length===ids.length;
    };
    if(!(await checkOwned(user.id,offered)))return fail("One or more items you offered are not in your inventory.",409);
    if(!(await checkOwned(recipient.id,requested)))return fail("One or more requested items are not in that player's inventory.",409);
    const ownsIncoming=async(ownerId,ids)=>ids.length?await checkOwned(ownerId,ids):false;
    if(await ownsIncoming(recipient.id,offered))return fail("That player already owns an item you offered.",409);
    if(await ownsIncoming(user.id,requested))return fail("You already own an item requested in this trade.",409);
    const tradeId=id();
    const statements=[env.DB.prepare("INSERT INTO trades (id,sender_id,recipient_id,offered_items,requested_items) VALUES (?,?,?,?,?)").bind(tradeId,user.id,recipient.id,JSON.stringify(offered),JSON.stringify(requested))];
    for(const itemId of offered) statements.push(env.DB.prepare("INSERT INTO trade_locks (owner_id,item_id,trade_id) VALUES (?,?,?)").bind(user.id,itemId,tradeId));
    for(const itemId of requested) statements.push(env.DB.prepare("INSERT INTO trade_locks (owner_id,item_id,trade_id) VALUES (?,?,?)").bind(recipient.id,itemId,tradeId));
    try { await env.DB.batch(statements); }
    catch { return fail("One of these items is already reserved in another pending trade.",409); }
    return json({ok:true,id:tradeId},201);
  }

  const tradeActionMatch=path.match(/^\/api\/trades\/([A-Za-z0-9-]+)$/);
  if (tradeActionMatch && request.method==="POST") {
    const user=await requireUser(request,env);
    if(!user)return fail("Please sign in.",401);
    const trade=await env.DB.prepare("SELECT * FROM trades WHERE id=? AND status='PENDING'").bind(tradeActionMatch[1]).first();
    if(!trade)return fail("Pending trade not found.",404);
    const data=await body(request),action=String(data?.action||"");
    const isSender=trade.sender_id===user.id,isRecipient=trade.recipient_id===user.id;
    if(action==="cancel"&&!isSender)return fail("Only the sender can cancel this trade.",403);
    if((action==="accept"||action==="decline")&&!isRecipient)return fail("Only the recipient can respond to this trade.",403);
    if(!["accept","decline","cancel"].includes(action))return fail("Unknown trade action.");
    if(action==="accept"){
      const offered=JSON.parse(trade.offered_items||"[]"),requested=JSON.parse(trade.requested_items||"[]");
      const owned=async(ownerId,ids)=>{
        if(!ids.length)return true;
        const marks=ids.map(()=>"?").join(",");
        const rows=await env.DB.prepare(`SELECT item_id FROM inventory WHERE user_id=? AND item_id IN (${marks})`).bind(ownerId,...ids).all();
        return (rows.results||[]).length===ids.length;
      };
      if(!(await owned(trade.sender_id,offered))||!(await owned(trade.recipient_id,requested)))return fail("Trade items changed. Cancel this trade and create a new one.",409);
      if((offered.length&&await owned(trade.recipient_id,offered))||(requested.length&&await owned(trade.sender_id,requested)))return fail("One player already owns an incoming item. Trade cannot be completed.",409);
      const changed=await env.DB.prepare("UPDATE trades SET status='ACCEPTED',responded_at=datetime('now') WHERE id=? AND status='PENDING' AND recipient_id=?").bind(trade.id,user.id).run();
      if(!changed?.meta?.changes)return fail("This trade was already answered.",409);
      const statements=[
        ...offered.map(itemId=>env.DB.prepare("DELETE FROM inventory WHERE user_id=? AND item_id=?").bind(trade.sender_id,itemId)),
        ...requested.map(itemId=>env.DB.prepare("DELETE FROM inventory WHERE user_id=? AND item_id=?").bind(trade.recipient_id,itemId)),
        ...offered.map(itemId=>env.DB.prepare("INSERT INTO inventory (id,user_id,item_id) VALUES (?,?,?)").bind(id(),trade.recipient_id,itemId)),
        ...requested.map(itemId=>env.DB.prepare("INSERT INTO inventory (id,user_id,item_id) VALUES (?,?,?)").bind(id(),trade.sender_id,itemId)),
        env.DB.prepare("DELETE FROM trade_locks WHERE trade_id=?").bind(trade.id)
      ];
      await env.DB.batch(statements);
      return json({ok:true,status:"ACCEPTED"});
    }
    const status=action==="decline"?"DECLINED":"CANCELLED";
    const changed=await env.DB.prepare("UPDATE trades SET status=?,responded_at=datetime('now') WHERE id=? AND status='PENDING' AND "+(action==="decline"?"recipient_id=?":"sender_id=?")).bind(status,trade.id,user.id).run();
    if(!changed?.meta?.changes)return fail("This trade was already answered.",409);
    await env.DB.prepare("DELETE FROM trade_locks WHERE trade_id=?").bind(trade.id).run();
    return json({ok:true,status});
  }

  if (path.startsWith("/api/owner/items")) {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    if (user.role !== "OWNER") return fail("Owner access required.",403);
    if (path === "/api/owner/items" && request.method === "GET") {
      const rows = await env.DB.prepare("SELECT i.id,i.name,i.description,i.category,i.price,i.image_url,i.model_url,i.asset_id,i.asset_type_id,i.is_limited,i.stock_limit,(SELECT COUNT(*) FROM inventory v WHERE v.item_id=i.id) AS stock_sold,i.is_for_sale,i.created_at,CASE WHEN i.category='Accessories' THEN CASE WHEN i.model_url<>'' THEN '3D' ELSE '3D_MISSING' END ELSE 'IMAGE_ONLY' END AS asset_kind FROM items i ORDER BY i.created_at DESC,i.name").all();
      return json({items:rows.results||[]});
    }
    if (path === "/api/owner/items" && request.method === "DELETE") {
      const result = await env.DB.prepare("UPDATE items SET is_for_sale=0 WHERE is_for_sale=1").run();
      return json({ok:true,hidden:result?.meta?.changes||0});
    }
    if (path === "/api/owner/items" && request.method === "POST") {
      const data = await body(request), error = validItem(data);
      if (error) return fail(error);
      if (data.is_for_sale !== undefined && typeof data.is_for_sale !== "boolean") return fail("Item sale status must be true or false.");
      if (data.is_limited !== undefined && typeof data.is_limited !== "boolean") return fail("Limited status must be true or false.");
      const stockLimit=Number(data.stock_limit||0);
      if (!Number.isSafeInteger(stockLimit)||stockLimit<0||stockLimit>1000000||(data.is_limited===true&&stockLimit<1)) return fail("Limited items need a stock limit from 1 to 1,000,000. Set 0 for unlimited stock.");
      const itemId=id();
      const defaultAssetTypes = {Hats:8,Hair:41,Faces:18,Shirts:11,Pants:12};
      const assetId = Number(data.asset_id || 0);
      const assetTypeId = Number(data.asset_type_id || (assetId ? (defaultAssetTypes[data.category] || 0) : 0));
      if (assetId > 0 && assetTypeId < 1) return fail("Accessories need a Roblox asset type ID (for example neck, back, front, shoulder or waist).");
      await env.DB.prepare("INSERT INTO items (id,name,description,category,price,image_url,model_url,asset_id,asset_type_id,is_limited,stock_limit,is_for_sale) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind(itemId,data.name.trim(),data.description||"",data.category,Number(data.price),String(data.image_url||"").trim(),String(data.model_url||"").trim(),assetId,assetTypeId,data.is_limited?1:0,stockLimit,data.is_for_sale===false?0:1).run();
      return json({ok:true,id:itemId},201);
    }
    const match=path.match(/^\/api\/owner\/items\/([A-Za-z0-9_-]{1,80})$/i);
    if (match && request.method === "PATCH") {
      const current=await env.DB.prepare("SELECT * FROM items WHERE id=?").bind(match[1]).first();
      if (!current) return fail("Item not found.",404);
      const data=await body(request);
      if (!data || typeof data !== "object" || Array.isArray(data)) return fail("Invalid item update.");
      if (data.is_for_sale !== undefined && typeof data.is_for_sale !== "boolean") return fail("Item sale status must be true or false.");
      if (data.is_limited !== undefined && typeof data.is_limited !== "boolean") return fail("Limited status must be true or false.");
      const merged={name:data.name??current.name,description:data.description??current.description,category:data.category??current.category,price:data.price??current.price,image_url:data.image_url??current.image_url,model_url:data.model_url??current.model_url??"",asset_id:data.asset_id??current.asset_id??0,asset_type_id:data.asset_type_id??current.asset_type_id??0,is_limited:data.is_limited===undefined?Boolean(current.is_limited):data.is_limited,stock_limit:data.stock_limit===undefined?Number(current.stock_limit||0):Number(data.stock_limit),is_for_sale:data.is_for_sale===undefined?current.is_for_sale:(data.is_for_sale?1:0)};
      if (!Number.isSafeInteger(merged.stock_limit)||merged.stock_limit<0||merged.stock_limit>1000000||(merged.is_limited&&merged.stock_limit<1)) return fail("Limited items need a stock limit from 1 to 1,000,000. Set 0 for unlimited stock.");
      const keepLegacyImage = String(merged.image_url||"") === String(current.image_url||"");
      const error=validItem(merged,keepLegacyImage); if(error)return fail(error);
      const defaultAssetTypes = {Hats:8,Hair:41,Faces:18,Shirts:11,Pants:12};
      const assetId = Number(merged.asset_id || 0);
      const assetTypeId = Number(merged.asset_type_id || (assetId ? (defaultAssetTypes[merged.category] || 0) : 0));
      if (assetId > 0 && assetTypeId < 1) return fail("Accessories need a Roblox asset type ID.");
      await env.DB.prepare("UPDATE items SET name=?,description=?,category=?,price=?,image_url=?,model_url=?,asset_id=?,asset_type_id=?,is_limited=?,stock_limit=?,is_for_sale=? WHERE id=?").bind(merged.name.trim(),merged.description,merged.category,Number(merged.price),String(merged.image_url||"").trim(),String(merged.model_url||"").trim(),assetId,assetTypeId,merged.is_limited?1:0,merged.stock_limit,merged.is_for_sale,match[1]).run();
      return json({ok:true});
    }
    if (match && request.method === "DELETE") {
      await env.DB.prepare("UPDATE items SET is_for_sale=0 WHERE id=?").bind(match[1]).run();
      return json({ok:true});
    }
    return fail("Unsupported catalog management action.",405);
  }

  if (request.method === "GET" && path === "/api/owner/stats") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    if (user.role !== "OWNER") return fail("Owner access required.",403);
    const [users,items,purchases] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) n FROM users").first(),
      env.DB.prepare("SELECT COUNT(*) n FROM items WHERE is_for_sale=1").first(),
      env.DB.prepare("SELECT COUNT(*) n FROM purchases").first()
    ]);
    return json({users:users.n,items:items.n,purchases:purchases.n});
  }

  if (request.method === "GET" && path === "/api/search-users") {
    const q = (url.searchParams.get("q") || "").trim().slice(0,20);
    if (q.length < 2) return json({users:[]});
    const rows = await env.DB.prepare("SELECT username,role FROM users WHERE instr(lower(username),lower(?))>0 AND is_banned=0 ORDER BY username LIMIT 20").bind(q).all();
    return json({users:rows.results || []});
  }

  return fail("API route not found.",404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try { return await route(request,env); }
      catch (error) {
        if (error instanceof RequestBodyTooLarge) return fail("Request body must be 16 KB or smaller.",413);
        console.error("[Pekora API] Unhandled error:", request.method, url.pathname, error);
        return fail("Server error. Check the Worker logs. Reference: " + crypto.randomUUID().slice(0,8),500);
      }
    }
    if (!env.ASSETS || typeof env.ASSETS.fetch !== "function") {
      return new Response("Static asset binding ASSETS is missing.",{status:503,headers:{"content-type":"text/plain; charset=utf-8","cache-control":"no-store"}});
    }
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    headers.set("X-Content-Type-Options","nosniff");
    headers.set("X-Frame-Options","DENY");
    headers.set("Referrer-Policy","strict-origin-when-cross-origin");
    headers.set("Permissions-Policy","camera=(), microphone=(), geolocation=()");
    headers.set("Content-Security-Policy","default-src 'self'; script-src 'self' https://cdn.jsdelivr.net https://ajax.googleapis.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' https: data:; connect-src 'self' https:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests");
    return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
  }
};
