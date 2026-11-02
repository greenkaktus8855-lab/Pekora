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

  
  return null;
}

let siteSettingsPromise;
async function ensureSiteSettings(env) {
  if (!siteSettingsPromise) {
    siteSettingsPromise = (async () => {
      await env.DB.batch([
        env.DB.prepare("CREATE TABLE IF NOT EXISTS site_settings (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL)"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS auth_rate_limits (rate_key TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0, window_started_at INTEGER NOT NULL, blocked_until INTEGER NOT NULL DEFAULT 0)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_friends_friend_status ON friends(friend_id,status)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_items_category_name ON items(category,name)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_inventory_user_purchased ON inventory(user_id,purchased_at DESC)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_auth_rate_window ON auth_rate_limits(window_started_at)"),
        env.DB.prepare("DELETE FROM auth_rate_limits WHERE window_started_at < unixepoch()-86400")
      ]);
      // One-time public catalog cleanout requested for the November 2026 reset.
      // Inventory, purchases, users and balances are deliberately untouched.
      const cleanout = await env.DB.prepare("SELECT setting_value FROM site_settings WHERE setting_key='catalog_cleanout_2026_11_02'").first();
      if (!cleanout) {
        await env.DB.batch([
          env.DB.prepare("UPDATE items SET is_for_sale=0 WHERE is_for_sale=1"),
          env.DB.prepare("INSERT OR IGNORE INTO site_settings (setting_key,setting_value) VALUES ('catalog_cleanout_2026_11_02','done')")
        ]);
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
  await env.DB.prepare("DELETE FROM auth_rate_limits WHERE rate_key=?").bind(key).run();
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
        "SELECT id,name,description,category,price,image_url,is_limited,is_for_sale,created_at FROM items LIMIT 0",
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
    const blocked = await recordRateLimitFailure(env,key);
    if (blocked) return json({error:"Too many registration attempts. Try again in 15 minutes."},429,{"retry-after":"900"});
    const data = await body(request);
    if (!data || typeof data.username !== "string" || typeof data.password !== "string") return fail("Enter a username and password.");
    const username = data.username.trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return fail("Username must be 3–20 characters and use only letters, numbers or _.");
    if (username.toLowerCase() === "pekoraadmin") return fail("That username is reserved.");
    if (data.password.length < 8 || data.password.length > 128) return fail("Password must be at least 8 characters.");
    const exists = await env.DB.prepare("SELECT id FROM users WHERE username=? COLLATE NOCASE").bind(username).first();
    if (exists) return fail("That username is already taken.", 409);
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
      if (existing) return fail("That username is already taken.", 409);
      console.error("[Pekora register] Account creation failed:", error);
      return fail("Account creation failed. Please try again.", 503);
    }
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
    if (!user || user.is_banned || candidateHash !== user.password_hash) {
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
    if (typeof env.OWNER_BOOTSTRAP_SECRET !== "string" || env.OWNER_BOOTSTRAP_SECRET.length < 20 ||
        typeof data?.secret !== "string" || data.secret.length < 20 || data.secret.length > 512 ||
        await digest(data.secret) !== await digest(env.OWNER_BOOTSTRAP_SECRET)) {
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
    const rows = await env.DB.prepare("SELECT id,name,description,category,price,image_url,is_limited,created_at,'IMAGE_ONLY' AS asset_kind FROM items WHERE is_for_sale=1 ORDER BY category,name").all();
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

  if (request.method === "GET" && path === "/api/inventory") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const rows = await env.DB.prepare("SELECT i.id,i.name,i.description,i.category,i.price,i.image_url,'IMAGE_ONLY' AS asset_kind FROM inventory v JOIN items i ON i.id=v.item_id WHERE v.user_id=? ORDER BY v.purchased_at DESC").bind(user.id).all();
    return json({ items:rows.results || [] });
  }

  const profileInventoryMatch = path.match(/^\/api\/profile\/([A-Za-z0-9_]{3,20})\/inventory$/);
  if (request.method === "GET" && profileInventoryMatch) {
    const username = profileInventoryMatch[1];
    const profile = await env.DB.prepare("SELECT id FROM users WHERE username=? COLLATE NOCASE AND is_banned=0").bind(username).first();
    if (!profile) return fail("User not found.",404);
    const rows = await env.DB.prepare("SELECT i.id,i.name,i.description,i.category,i.price,i.image_url,'IMAGE_ONLY' AS asset_kind FROM inventory v JOIN items i ON i.id=v.item_id WHERE v.user_id=? ORDER BY v.purchased_at DESC").bind(profile.id).all();
    return json({ items:rows.results || [] });
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
    return json({ enabled:false, message:"Original Pekora Avatar API and RCC renderer are not connected." });
  }

  if (path === "/api/avatar" && request.method === "PUT") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    return fail("Avatar editing is disabled until the original Pekora Avatar API and RCC renderer are connected.",501);
  }

  if (request.method === "PUT" && path === "/api/profile") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const data = await body(request);
    if (typeof data?.description !== "string" || data.description.length > 500) return fail("Description must be 500 characters or less.");
    await env.DB.prepare("UPDATE profiles SET description=? WHERE user_id=?").bind(data.description,user.id).run();
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
    if (rows.some(x=>x.user_id===user.id && x.status==="PENDING")) return fail("Friend request already sent.",409);
    const reverse=rows.find(x=>x.user_id===target.id && x.friend_id===user.id && x.status==="PENDING");
    if (reverse) {
      const results = await env.DB.batch([
        env.DB.prepare("UPDATE friends SET status='ACCEPTED' WHERE user_id=? AND friend_id=? AND status='PENDING'").bind(target.id,user.id),
        env.DB.prepare("INSERT OR REPLACE INTO friends (user_id,friend_id,status) SELECT ?,?,'ACCEPTED' WHERE changes()=1").bind(user.id,target.id)
      ]);
      if (!results?.[0]?.meta?.changes) return fail("That friend request was cancelled before it could be accepted.",409);
      return json({ok:true,status:"friends"});
    }
    try {
      await env.DB.prepare("INSERT INTO friends (user_id,friend_id,status) VALUES (?,?,'PENDING')").bind(user.id,target.id).run();
    } catch (error) {
      const relation = await env.DB.prepare("SELECT status FROM friends WHERE user_id=? AND friend_id=?").bind(user.id,target.id).first().catch(() => null);
      if (relation?.status === "ACCEPTED") return fail("You are already friends.",409);
      if (relation?.status === "PENDING") return fail("Friend request already sent.",409);
      throw error;
    }
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
    const recoverySecret = env.OWNER_BOOTSTRAP_SECRET;
    if (typeof recoverySecret !== "string" || recoverySecret.length < 20 ||
        typeof data?.secret !== "string" || data.secret.length < 20 || data.secret.length > 512 ||
        await digest(data.secret) !== await digest(recoverySecret)) {
      const blocked = await recordRateLimitFailure(env,key);
      return blocked?json({error:"Too many owner recovery attempts. Try again in 15 minutes."},429,{"retry-after":"900"}):fail("Invalid owner recovery secret.",403);
    }
    if (typeof data?.password !== "string" || data.password.length < 12 || data.password.length > 128) {
      return fail("New owner password must be 12–128 characters.");
    }
    const owner = await env.DB.prepare("SELECT id FROM users WHERE username='PekoraAdmin' COLLATE NOCASE AND role='OWNER'").first();
    if (!owner) return fail("PekoraAdmin OWNER account was not found.",404);
    const salt = randomToken();
    const hash = await passwordHash(data.password,salt);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET password_hash=?,password_salt=? WHERE id=? AND role='OWNER'").bind(hash,salt,owner.id),
      env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(owner.id)
    ]);
    await clearRateLimit(env,key);
    return json({ok:true,message:"PekoraAdmin password reset. All previous sessions were signed out."});
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

  if (path.startsWith("/api/owner/items")) {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    if (user.role !== "OWNER") return fail("Owner access required.",403);
    if (path === "/api/owner/items" && request.method === "GET") {
      const rows = await env.DB.prepare("SELECT id,name,description,category,price,image_url,is_limited,is_for_sale,created_at,'IMAGE_ONLY' AS asset_kind FROM items ORDER BY created_at DESC,name").all();
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
      const itemId=id();
      await env.DB.prepare("INSERT INTO items (id,name,description,category,price,image_url,is_for_sale) VALUES (?,?,?,?,?,?,?)").bind(itemId,data.name.trim(),data.description||"",data.category,Number(data.price),String(data.image_url||"").trim(),data.is_for_sale===false?0:1).run();
      return json({ok:true,id:itemId},201);
    }
    const match=path.match(/^\/api\/owner\/items\/([A-Za-z0-9_-]{1,80})$/i);
    if (match && request.method === "PATCH") {
      const current=await env.DB.prepare("SELECT * FROM items WHERE id=?").bind(match[1]).first();
      if (!current) return fail("Item not found.",404);
      const data=await body(request);
      if (!data || typeof data !== "object" || Array.isArray(data)) return fail("Invalid item update.");
      if (data.is_for_sale !== undefined && typeof data.is_for_sale !== "boolean") return fail("Item sale status must be true or false.");
      const merged={name:data.name??current.name,description:data.description??current.description,category:data.category??current.category,price:data.price??current.price,image_url:data.image_url??current.image_url,is_for_sale:data.is_for_sale===undefined?current.is_for_sale:(data.is_for_sale?1:0)};
      const keepLegacyImage = String(merged.image_url||"") === String(current.image_url||"");
      const error=validItem(merged,keepLegacyImage); if(error)return fail(error);
      await env.DB.prepare("UPDATE items SET name=?,description=?,category=?,price=?,image_url=?,is_for_sale=? WHERE id=?").bind(merged.name.trim(),merged.description,merged.category,Number(merged.price),String(merged.image_url||"").trim(),merged.is_for_sale,match[1]).run();
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
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    headers.set("X-Content-Type-Options","nosniff");
    headers.set("X-Frame-Options","DENY");
    headers.set("Referrer-Policy","strict-origin-when-cross-origin");
    headers.set("Permissions-Policy","camera=(), microphone=(), geolocation=()");
    headers.set("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' https: data:; connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests");
    return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
  }
};
