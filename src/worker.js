const encoder = new TextEncoder();
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
async function body(request) {
  try { return await request.json(); } catch { return null; }
}
const publicUser = u => ({ id:u.id, username:u.username, role:u.role, balance:u.balance, createdAt:u.created_at });
const ITEM_CATEGORIES = ["Hats","Hair","Faces","Shirts","Pants","Accessories"];
function validItem(data) {
  if (!data || typeof data.name !== "string" || !data.name.trim() || data.name.trim().length > 80) return "Item name must be 1–80 characters.";
  if (!ITEM_CATEGORIES.includes(data.category)) return "Choose a valid item category.";
  if (!Number.isInteger(Number(data.price)) || Number(data.price) < 0 || Number(data.price) > 1000000) return "Price must be between 0 and 1,000,000 P$.";
  if (typeof (data.description ?? "") !== "string" || (data.description ?? "").length > 500) return "Description must be 500 characters or less.";
  const image = String(data.image_url ?? "").trim();
  if (image.length > 500) return "Image URL is too long.";
  if (image) {
    try { const u = new URL(image); if (!["http:","https:"].includes(u.protocol)) return "Image URL must use HTTP or HTTPS."; }
    catch { return "Enter a valid image URL."; }
  }
  return null;
}
function parseAvatar(raw) {
  try {
    const value = JSON.parse(raw || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === "GET" && path === "/api/health") {
    if (!env.DB) return json({ ok:false, site:"Pekora", database:false, error:"D1 binding DB is missing." },503);
    try {
      await env.DB.prepare("SELECT 1 AS ok").first();
      return json({ ok:true, site:"Pekora", database:true });
    } catch (error) {
      console.error("[Pekora health] D1 check failed:", error);
      return json({ ok:false, site:"Pekora", database:false, error:"D1 database check failed. See Worker logs." },503);
    }
  }

  if (request.method === "POST" && path === "/api/register") {
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
    try {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO users (id,username,password_hash,password_salt,balance) VALUES (?,?,?,?,100)").bind(userId, username, hash, salt),
        env.DB.prepare("INSERT INTO profiles (user_id) VALUES (?)").bind(userId)
      ]);
    } catch { return fail("Could not create the account. Try another username.", 409); }
    const token = randomToken();
    await env.DB.prepare("INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,datetime('now','+30 days'))").bind(await digest(token), userId).run();
    const user = await env.DB.prepare("SELECT id,username,role,balance,created_at,is_banned FROM users WHERE id=?").bind(userId).first();
    return json({ user:publicUser(user) }, 201, { "set-cookie":cookie("pekora_session",token,60*60*24*30) });
  }

  if (request.method === "POST" && path === "/api/login") {
    const data = await body(request);
    if (!data || typeof data.username !== "string" || typeof data.password !== "string") return fail("Enter your username and password.");
    const user = await env.DB.prepare("SELECT * FROM users WHERE username=? COLLATE NOCASE").bind(data.username.trim()).first();
    if (!user || user.is_banned || await passwordHash(data.password, user.password_salt) !== user.password_hash) return fail("Incorrect username or password.", 401);
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
    const data = await body(request);
    if (!env.OWNER_BOOTSTRAP_SECRET || typeof data?.secret !== "string" || data.secret.length < 1 ||
        await digest(data.secret) !== await digest(env.OWNER_BOOTSTRAP_SECRET)) return fail("Invalid owner setup key.",403);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role='OWNER'").first();
    if (count.n > 0) return fail("An owner account has already been created.",409);
    if (typeof data.password !== "string" || data.password.length < 12 || data.password.length > 128) return fail("Owner password must be at least 12 characters.");
    const username = "PekoraAdmin";
    const salt = randomToken(), hash = await passwordHash(data.password,salt), userId=id();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users (id,username,password_hash,password_salt,role,balance) VALUES (?,?,?,?, 'OWNER',1000)").bind(userId,username,hash,salt),
      env.DB.prepare("INSERT INTO profiles (user_id) VALUES (?)").bind(userId)
    ]);
    const token = randomToken();
    await env.DB.prepare("INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,datetime('now','+30 days'))").bind(await digest(token),userId).run();
    const user = await env.DB.prepare("SELECT id,username,role,balance,created_at FROM users WHERE id=?").bind(userId).first();
    return json({ user:publicUser(user) },201,{"set-cookie":cookie("pekora_session",token,60*60*24*30)});
  }

  if (request.method === "GET" && path === "/api/catalog") {
    const rows = await env.DB.prepare("SELECT id,name,description,category,price,image_url,is_limited,created_at FROM items WHERE is_for_sale=1 ORDER BY category,name").all();
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
        env.DB.prepare("UPDATE users SET balance=balance-? WHERE id=? AND balance>=? AND NOT EXISTS (SELECT 1 FROM inventory WHERE user_id=? AND item_id=?)").bind(item.price,user.id,item.price,user.id,item.id),
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
    const rows = await env.DB.prepare("SELECT i.id,i.name,i.description,i.category,i.price,i.image_url FROM inventory v JOIN items i ON i.id=v.item_id WHERE v.user_id=? ORDER BY v.purchased_at DESC").bind(user.id).all();
    return json({ items:rows.results || [] });
  }

  if (request.method === "GET" && path.startsWith("/api/profile/") && path.endsWith("/inventory")) {
    const username = decodeURIComponent(path.slice("/api/profile/".length, -"/inventory".length));
    const profile = await env.DB.prepare("SELECT id FROM users WHERE username=? COLLATE NOCASE AND is_banned=0").bind(username).first();
    if (!profile) return fail("User not found.",404);
    const rows = await env.DB.prepare("SELECT i.id,i.name,i.description,i.category,i.price,i.image_url FROM inventory v JOIN items i ON i.id=v.item_id WHERE v.user_id=? ORDER BY v.purchased_at DESC").bind(profile.id).all();
    return json({ items:rows.results || [] });
  }

  if (request.method === "GET" && path.startsWith("/api/profile/")) {
    const username = decodeURIComponent(path.slice("/api/profile/".length));
    const profile = await env.DB.prepare(`SELECT u.id,u.username,u.role,u.balance,u.created_at,p.description,p.avatar_json
      FROM users u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.username=? COLLATE NOCASE AND u.is_banned=0`).bind(username).first();
    if (!profile) return fail("User not found.",404);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM inventory WHERE user_id=?").bind(profile.id).first();
    return json({ profile:{...publicUser(profile),description:profile.description,itemCount:count.n,avatar:parseAvatar(profile.avatar_json)} });
  }

  if (path === "/api/avatar" && request.method === "GET") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const row = await env.DB.prepare("SELECT avatar_json FROM profiles WHERE user_id=?").bind(user.id).first();
    return json({ avatar:parseAvatar(row?.avatar_json) });
  }

  if (path === "/api/avatar" && request.method === "PUT") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const data = await body(request);
    const equipped = data?.equipped;
    if (!equipped || typeof equipped !== "object" || Array.isArray(equipped)) return fail("Invalid avatar selection.");
    const clean = {};
    for (const [category,itemId] of Object.entries(equipped)) {
      if (!ITEM_CATEGORIES.includes(category)) return fail("Invalid avatar category.");
      if (itemId === null || itemId === "") { clean[category] = null; continue; }
      if (typeof itemId !== "string" || itemId.length > 80) return fail("Invalid avatar item.");
      const owned = await env.DB.prepare("SELECT i.id,i.category FROM inventory v JOIN items i ON i.id=v.item_id WHERE v.user_id=? AND i.id=?").bind(user.id,itemId).first();
      if (!owned || owned.category !== category) return fail("You can only wear items you own in the matching category.",403);
      clean[category] = itemId;
    }
    const current = await env.DB.prepare("SELECT avatar_json FROM profiles WHERE user_id=?").bind(user.id).first();
    const next = { ...parseAvatar(current?.avatar_json), ...clean };
    await env.DB.prepare("UPDATE profiles SET avatar_json=? WHERE user_id=?").bind(JSON.stringify(next),user.id).run();
    return json({ ok:true,avatar:next });
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
      env.DB.prepare("SELECT u.username,u.role FROM friends f JOIN users u ON u.id=f.friend_id WHERE f.user_id=? AND f.status='ACCEPTED' UNION SELECT u.username,u.role FROM friends f JOIN users u ON u.id=f.user_id WHERE f.friend_id=? AND f.status='ACCEPTED' ORDER BY username").bind(user.id,user.id).all(),
      env.DB.prepare("SELECT u.username,u.role FROM friends f JOIN users u ON u.id=f.user_id WHERE f.friend_id=? AND f.status='PENDING' ORDER BY u.username").bind(user.id).all(),
      env.DB.prepare("SELECT u.username,u.role FROM friends f JOIN users u ON u.id=f.friend_id WHERE f.user_id=? AND f.status='PENDING' ORDER BY u.username").bind(user.id).all()
    ]);
    return json({ friends:accepted.results||[],incoming:incoming.results||[],outgoing:outgoing.results||[] });
  }

  if (request.method === "GET" && path === "/api/friends/status") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const username = (url.searchParams.get("username")||"").trim();
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
    const target = await env.DB.prepare("SELECT id FROM users WHERE username=? COLLATE NOCASE AND is_banned=0").bind(username).first();
    if (!target) return fail("User not found.",404);
    if (target.id === user.id) return fail("You cannot add yourself.");
    const existing = await env.DB.prepare("SELECT user_id,friend_id,status FROM friends WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)").bind(user.id,target.id,target.id,user.id).all();
    const rows=existing.results||[];
    if (rows.some(x=>x.status==="ACCEPTED")) return fail("You are already friends.",409);
    if (rows.some(x=>x.user_id===user.id && x.status==="PENDING")) return fail("Friend request already sent.",409);
    const reverse=rows.find(x=>x.user_id===target.id && x.friend_id===user.id && x.status==="PENDING");
    if (reverse) {
      await env.DB.batch([
        env.DB.prepare("UPDATE friends SET status='ACCEPTED' WHERE user_id=? AND friend_id=?").bind(target.id,user.id),
        env.DB.prepare("INSERT OR REPLACE INTO friends (user_id,friend_id,status) VALUES (?,?,'ACCEPTED')").bind(user.id,target.id)
      ]);
      return json({ok:true,status:"friends"});
    }
    await env.DB.prepare("INSERT INTO friends (user_id,friend_id,status) VALUES (?,?,'PENDING')").bind(user.id,target.id).run();
    return json({ok:true,status:"outgoing"},201);
  }

  if (request.method === "POST" && path === "/api/friends/accept") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const data = await body(request), username = String(data?.username||"").trim();
    const target = await env.DB.prepare("SELECT id FROM users WHERE username=? COLLATE NOCASE AND is_banned=0").bind(username).first();
    if (!target) return fail("User not found.",404);
    const pending = await env.DB.prepare("SELECT user_id FROM friends WHERE user_id=? AND friend_id=? AND status='PENDING'").bind(target.id,user.id).first();
    if (!pending) return fail("No pending request from this user.",404);
    await env.DB.batch([
      env.DB.prepare("UPDATE friends SET status='ACCEPTED' WHERE user_id=? AND friend_id=?").bind(target.id,user.id),
      env.DB.prepare("INSERT OR REPLACE INTO friends (user_id,friend_id,status) VALUES (?,?,'ACCEPTED')").bind(user.id,target.id)
    ]);
    return json({ok:true,status:"friends"});
  }

  if (request.method === "DELETE" && path === "/api/friends") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const username = String(url.searchParams.get("username")||"").trim();
    const target = await env.DB.prepare("SELECT id FROM users WHERE username=? COLLATE NOCASE").bind(username).first();
    if (!target) return fail("User not found.",404);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM friends WHERE user_id=? AND friend_id=?").bind(user.id,target.id),
      env.DB.prepare("DELETE FROM friends WHERE user_id=? AND friend_id=?").bind(target.id,user.id)
    ]);
    return json({ok:true});
  }

  if (path.startsWith("/api/owner/items")) {
    const user = await requireUser(request,env);
    if (!user || user.role !== "OWNER") return fail("Owner access required.",403);
    if (path === "/api/owner/items" && request.method === "GET") {
      const rows = await env.DB.prepare("SELECT id,name,description,category,price,image_url,is_limited,is_for_sale,created_at FROM items ORDER BY created_at DESC,name").all();
      return json({items:rows.results||[]});
    }
    if (path === "/api/owner/items" && request.method === "DELETE") {
      const result = await env.DB.prepare("UPDATE items SET is_for_sale=0 WHERE is_for_sale=1").run();
      return json({ok:true,hidden:result?.meta?.changes||0});
    }
    if (path === "/api/owner/items" && request.method === "POST") {
      const data = await body(request), error = validItem(data);
      if (error) return fail(error);
      const itemId=id();
      await env.DB.prepare("INSERT INTO items (id,name,description,category,price,image_url,is_for_sale) VALUES (?,?,?,?,?,?,?)").bind(itemId,data.name.trim(),data.description||"",data.category,Number(data.price),String(data.image_url||"").trim(),data.is_for_sale===false?0:1).run();
      return json({ok:true,id:itemId},201);
    }
    const match=path.match(/^\/api\/owner\/items\/([A-Za-z0-9_-]{1,80})$/i);
    if (match && request.method === "PATCH") {
      const current=await env.DB.prepare("SELECT * FROM items WHERE id=?").bind(match[1]).first();
      if (!current) return fail("Item not found.",404);
      const data=await body(request), merged={name:data?.name??current.name,description:data?.description??current.description,category:data?.category??current.category,price:data?.price??current.price,image_url:data?.image_url??current.image_url,is_for_sale:data?.is_for_sale===undefined?current.is_for_sale:(data.is_for_sale?1:0)};
      const error=validItem(merged); if(error)return fail(error);
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
    if (!user || user.role !== "OWNER") return fail("Owner access required.",403);
    const [users,items,purchases] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) n FROM users").first(),
      env.DB.prepare("SELECT COUNT(*) n FROM items").first(),
      env.DB.prepare("SELECT COUNT(*) n FROM purchases").first()
    ]);
    return json({users:users.n,items:items.n,purchases:purchases.n});
  }

  if (request.method === "GET" && path === "/api/search-users") {
    const q = (url.searchParams.get("q") || "").trim().slice(0,20);
    if (q.length < 2) return json({users:[]});
    const rows = await env.DB.prepare("SELECT username,role FROM users WHERE username LIKE ? AND is_banned=0 ORDER BY username LIMIT 20").bind("%"+q+"%").all();
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
        console.error("[Pekora API] Unhandled error:", request.method, url.pathname, error);
        return fail("Server error. Check the Worker logs. Reference: " + crypto.randomUUID().slice(0,8),500);
      }
    }
    return env.ASSETS.fetch(request);
  }
};
