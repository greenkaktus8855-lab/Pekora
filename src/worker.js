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
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: encoder.encode(salt), iterations: 210000, hash: "SHA-256" }, material, 256);
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

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === "GET" && path === "/api/health") return json({ ok:true, site:"Pekora" });

  if (request.method === "POST" && path === "/api/register") {
    const data = await body(request);
    if (!data || typeof data.username !== "string" || typeof data.password !== "string") return fail("Enter a username and password.");
    const username = data.username.trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return fail("Username must be 3–20 characters and use only letters, numbers or _.");
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
    const rows = await env.DB.prepare("SELECT id,name,description,category,price,image_url,is_limited FROM items WHERE is_for_sale=1 ORDER BY category,name").all();
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
    const purchaseId=id();
    try {
      await env.DB.batch([
        env.DB.prepare("UPDATE users SET balance=balance-? WHERE id=? AND balance>=?").bind(item.price,user.id,item.price),
        env.DB.prepare("INSERT INTO inventory (id,user_id,item_id) VALUES (?,?,?)").bind(id(),user.id,item.id),
        env.DB.prepare("INSERT INTO purchases (id,user_id,item_id,price) VALUES (?,?,?,?)").bind(purchaseId,user.id,item.id,item.price)
      ]);
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

  if (request.method === "GET" && path.startsWith("/api/profile/")) {
    const username = decodeURIComponent(path.slice("/api/profile/".length));
    const profile = await env.DB.prepare(`SELECT u.id,u.username,u.role,u.balance,u.created_at,p.description
      FROM users u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.username=? COLLATE NOCASE AND u.is_banned=0`).bind(username).first();
    if (!profile) return fail("User not found.",404);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM inventory WHERE user_id=?").bind(profile.id).first();
    return json({ profile:{...publicUser(profile),description:profile.description,itemCount:count.n} });
  }

  if (request.method === "PUT" && path === "/api/profile") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const data = await body(request);
    if (typeof data?.description !== "string" || data.description.length > 500) return fail("Description must be 500 characters or less.");
    await env.DB.prepare("UPDATE profiles SET description=? WHERE user_id=?").bind(data.description,user.id).run();
    return json({ok:true});
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
      catch (error) { return fail("Server error. Check the Worker logs.",500); }
    }
    return env.ASSETS.fetch(request);
  }
};
