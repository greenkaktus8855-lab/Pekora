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
  const row = await env.DB.prepare(`SELECT u.id,u.username,u.role,u.balance,u.tix_balance,u.created_at,u.is_banned,u.public_id,u.is_verified,
      EXISTS(SELECT 1 FROM user_badges ub WHERE ub.user_id=u.id AND ub.badge_key='ASSET_MODERATOR') AS is_asset_moderator
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
const publicUser = u => ({ id:u.id, username:u.username, role:u.role, balance:Number(u.balance||0), tixBalance:Number(u.tix_balance||0), createdAt:u.created_at, publicId:u.public_id ?? null, isVerified:Boolean(u.is_verified), isAssetModerator:Boolean(u.is_asset_moderator) });
const USER_BADGE_KEYS = Object.freeze(["ADMINISTRATOR","ASSET_MODERATOR","EARLY_SUPPORTER","CONTRIBUTOR","CREATOR","COMMUNITY_HELPER"]);
const USER_BADGE_LABELS = Object.freeze({ADMINISTRATOR:"Administrator",ASSET_MODERATOR:"Asset Moderator",EARLY_SUPPORTER:"Early Supporter",CONTRIBUTOR:"Contributor",CREATOR:"Creator",COMMUNITY_HELPER:"Community Helper"});
const ITEM_CATEGORIES = ["Hats","Hair","Faces","Shirts","Pants","Accessories"];
const DEFAULT_AVATAR_BODY_COLORS = Object.freeze({headColorId:125,torsoColorId:125,leftArmColorId:125,rightArmColorId:125,leftLegColorId:125,rightLegColorId:125});
const AVATAR_COLOR_IDS = new Set([361,192,217,153,359,352,5,101,1007,1014,38,18,125,1030,133,106,105,1017,24,334,226,141,1021,28,37,310,317,119,1011,1012,1010,23,305,102,45,107,1018,1027,1019,1013,11,1024,104,1023,321,1015,1031,1006,1026,21,1004,1032,1016,330,9,1025,364,351,1008,29,1022,151,135,1020,1028,1009,1029,1003,26,199,194,1002,208,1,1001]);
const DEFAULT_AVATAR_SCALES = Object.freeze({height:1,width:1,head:1,depth:1,proportion:0,bodyType:0});
const AVATAR_COLOR_KEYS = Object.keys(DEFAULT_AVATAR_BODY_COLORS);
async function loadAvatarSettings(env,userId) {
  const row = await env.DB.prepare("SELECT body_colors,rig_type,scales_json FROM avatar_settings WHERE user_id=?").bind(userId).first();
  const bodyColors = {...DEFAULT_AVATAR_BODY_COLORS};
  const scales = {...DEFAULT_AVATAR_SCALES};
  try {
    const parsed = JSON.parse(row?.body_colors || "{}");
    for (const key of AVATAR_COLOR_KEYS) {
      const value = Number(parsed[key]);
      if (AVATAR_COLOR_IDS.has(value)) bodyColors[key] = value;
    }
  } catch {}
  try {
    const parsed = JSON.parse(row?.scales_json || "{}");
    for (const key of Object.keys(DEFAULT_AVATAR_SCALES)) {
      const value = Number(parsed[key]);
      if (Number.isFinite(value)) scales[key] = value;
    }
  } catch {}
  return {bodyColors,rigType:row?.rig_type === "R15" ? "R15" : "R6",scales};
}
async function saveAvatarSettings(env,userId,settings) {
  await env.DB.prepare("INSERT INTO avatar_settings (user_id,body_colors,rig_type,scales_json,updated_at) VALUES (?,?,?,?,datetime('now')) ON CONFLICT(user_id) DO UPDATE SET body_colors=excluded.body_colors,rig_type=excluded.rig_type,scales_json=excluded.scales_json,updated_at=datetime('now')")
    .bind(userId,JSON.stringify(settings.bodyColors),settings.rigType,JSON.stringify(settings.scales)).run();
}


const MEMBERSHIP_REWARDS = Object.freeze({
  None:0,
  BuildersClub:15,
  TurboBuildersClub:35,
  OutrageousBuildersClub:85,
  Premium:85
});
function validItem(data, allowLegacyHttp = false) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "Invalid item details.";
  if (typeof data.name !== "string" || !data.name.trim() || data.name.trim().length > 80) return "Item name must be 1–80 characters.";
  if (!ITEM_CATEGORIES.includes(data.category)) return "Choose a valid item category.";
  const currency = String(data.currency ?? "P$");
  if (!["P$","Tix"].includes(currency)) return "Choose P$ or Tix as the item currency.";
  const rawPrice = data.price;
  if ((typeof rawPrice !== "number" && typeof rawPrice !== "string") ||
      (typeof rawPrice === "string" && !/^\d+$/.test(rawPrice.trim())) ||
      !Number.isSafeInteger(Number(rawPrice)) || Number(rawPrice) < 0 || Number(rawPrice) > 1000000) {
    return "Price must be between 0 and 1,000,000 " + currency + ".";
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
        env.DB.prepare("CREATE TABLE IF NOT EXISTS user_memberships (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, membership_type TEXT NOT NULL DEFAULT 'None' CHECK(membership_type IN ('None','BuildersClub','TurboBuildersClub','OutrageousBuildersClub','Premium')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS membership_daily_rewards (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, reward_date TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>0), created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(user_id,reward_date))"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS promo_codes (code TEXT PRIMARY KEY COLLATE NOCASE, reward_amount INTEGER NOT NULL DEFAULT 0 CHECK(reward_amount>=0), reward_currency TEXT NOT NULL DEFAULT 'P$' CHECK(reward_currency IN ('P$','Tix')), max_uses INTEGER CHECK(max_uses IS NULL OR max_uses>0), expires_at TEXT, is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)), created_by TEXT REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')))"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS promo_code_items (code TEXT NOT NULL REFERENCES promo_codes(code) ON DELETE CASCADE, item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE, PRIMARY KEY(code,item_id))"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS promo_code_claims (code TEXT NOT NULL REFERENCES promo_codes(code) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, claim_id TEXT NOT NULL UNIQUE, claimed_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(code,user_id))"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_promo_claims_code ON promo_code_claims(code,claimed_at)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_membership_rewards_date ON membership_daily_rewards(reward_date)"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS discord_limited_announcements (item_id TEXT PRIMARY KEY, announced_at TEXT NOT NULL DEFAULT (datetime('now')))"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS auth_rate_limits (rate_key TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0, window_started_at INTEGER NOT NULL, blocked_until INTEGER NOT NULL DEFAULT 0)"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS model_files (id TEXT PRIMARY KEY, model_data BLOB NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS equipped_items (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE, category TEXT NOT NULL, equipped_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(user_id,item_id))"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS avatar_render_cache (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, source_hash TEXT NOT NULL, thumbnail_data BLOB NOT NULL, rendered_at TEXT NOT NULL DEFAULT (datetime('now')))"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS avatar_settings (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, body_colors TEXT NOT NULL DEFAULT '{}', rig_type TEXT NOT NULL DEFAULT 'R6' CHECK(rig_type IN ('R6','R15')), scales_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL DEFAULT (datetime('now')))"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS user_badges (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, badge_key TEXT NOT NULL CHECK(badge_key IN ('ADMINISTRATOR','ASSET_MODERATOR','EARLY_SUPPORTER','CONTRIBUTOR','CREATOR','COMMUNITY_HELPER')), granted_by TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(user_id,badge_key))"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_user_badges_key ON user_badges(badge_key,user_id)"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS model_submissions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, username TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', model_url TEXT NOT NULL, image_url TEXT NOT NULL DEFAULT '', price INTEGER NOT NULL DEFAULT 50 CHECK(price>=0 AND price<=1000000), status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')), reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL, created_item_id TEXT REFERENCES items(id) ON DELETE SET NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), reviewed_at TEXT)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_model_submissions_status ON model_submissions(status,created_at)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_model_submissions_user ON model_submissions(user_id,created_at DESC)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_equipped_items_user ON equipped_items(user_id,category)"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS creator_submissions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, username TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', category TEXT NOT NULL CHECK(category IN ('Shirts','Pants')), roblox_url TEXT NOT NULL, asset_id INTEGER NOT NULL CHECK(asset_id>0), status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')), image_url TEXT NOT NULL DEFAULT '', reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL, created_item_id TEXT REFERENCES items(id) ON DELETE SET NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), reviewed_at TEXT)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_creator_submissions_user ON creator_submissions(user_id,created_at DESC)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_creator_submissions_status ON creator_submissions(status,created_at)"),
        env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_submissions_active_asset ON creator_submissions(asset_id) WHERE status IN ('PENDING','APPROVED')"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS item_creators (item_id TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE, creator_id TEXT REFERENCES users(id) ON DELETE SET NULL, creator_name TEXT NOT NULL, original_url TEXT NOT NULL, submission_id TEXT UNIQUE REFERENCES creator_submissions(id) ON DELETE SET NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', thumbnail_url TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')))"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS sakura_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, description TEXT NOT NULL DEFAULT '', avatar_url TEXT NOT NULL DEFAULT '', is_verified INTEGER NOT NULL DEFAULT 0, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL DEFAULT (datetime('now')))"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS group_image_files (id TEXT PRIMARY KEY, group_id TEXT NOT NULL UNIQUE REFERENCES sakura_groups(id) ON DELETE CASCADE, image_data BLOB NOT NULL, content_type TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS group_members (group_id TEXT NOT NULL REFERENCES sakura_groups(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL DEFAULT 'MEMBER' CHECK(role IN ('OWNER','MEMBER')), joined_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(group_id,user_id))"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS trades (id TEXT PRIMARY KEY, sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, offered_items TEXT NOT NULL DEFAULT '[]', requested_items TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACCEPTED','DECLINED','CANCELLED')), created_at TEXT NOT NULL DEFAULT (datetime('now')), responded_at TEXT)"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS resale_listings (id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE, seller_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, price INTEGER NOT NULL CHECK(price>0 AND price<=1000000), currency TEXT NOT NULL DEFAULT 'P$' CHECK(currency='P$'), status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','SOLD','CANCELLED')), buyer_id TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), sold_at TEXT)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_resale_active_created ON resale_listings(status,created_at DESC)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_resale_item_active ON resale_listings(item_id,status)"),
        env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_resale_active_item_seller ON resale_listings(item_id,seller_id) WHERE status='ACTIVE'"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS trade_locks (owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE, trade_id TEXT NOT NULL REFERENCES trades(id) ON DELETE CASCADE, PRIMARY KEY(owner_id,item_id))"),
        env.DB.prepare("CREATE TRIGGER IF NOT EXISTS trg_resale_no_trade_lock BEFORE INSERT ON resale_listings WHEN EXISTS (SELECT 1 FROM trade_locks WHERE owner_id=NEW.seller_id AND item_id=NEW.item_id) BEGIN SELECT RAISE(ABORT,'Item is reserved in a pending trade.'); END"),
        env.DB.prepare("CREATE TRIGGER IF NOT EXISTS trg_trade_lock_no_resale BEFORE INSERT ON trade_locks WHEN EXISTS (SELECT 1 FROM resale_listings WHERE seller_id=NEW.owner_id AND item_id=NEW.item_id AND status='ACTIVE') BEGIN SELECT RAISE(ABORT,'Item is already listed for sale.'); END"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_trades_sender ON trades(sender_id,status,created_at DESC)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_trades_recipient ON trades(recipient_id,status,created_at DESC)"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS moderation_warnings (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, moderator_id TEXT NOT NULL REFERENCES users(id), reason TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), acknowledged INTEGER NOT NULL DEFAULT 0)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_moderation_warnings_user ON moderation_warnings(user_id,created_at DESC)"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS owner_audit_log (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id), target_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, action TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')))"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS banned_session_notices (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_owner_audit_target ON owner_audit_log(target_user_id,created_at DESC)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_friends_friend_status ON friends(friend_id,status)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_items_category_name ON items(category,name)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_items_public_catalog ON items(is_for_sale,category,name)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_inventory_user_purchased ON inventory(user_id,purchased_at DESC)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_auth_rate_window ON auth_rate_limits(window_started_at)"),
        env.DB.prepare("DELETE FROM auth_rate_limits WHERE window_started_at < CAST(strftime('%s','now') AS INTEGER)-86400"),
        env.DB.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')"),
        env.DB.prepare("DELETE FROM banned_session_notices WHERE expires_at <= datetime('now')")
      ]);
      await env.DB.prepare("INSERT OR IGNORE INTO user_badges (user_id,badge_key) SELECT id,'ADMINISTRATOR' FROM users WHERE username COLLATE NOCASE IN ('Admin','Sakura')").run();
      // Resale asking prices no longer overwrite the shared catalog price.
      const creatorSubmissionColumns = await env.DB.prepare("PRAGMA table_info(creator_submissions)").all();
      if (!(creatorSubmissionColumns.results || []).some(column => column.name === "price")) {
        await env.DB.prepare("ALTER TABLE creator_submissions ADD COLUMN price INTEGER NOT NULL DEFAULT 50 CHECK(price>=0 AND price<=1000000)").run();
      }
      const userColumns = await env.DB.prepare("PRAGMA table_info(users)").all();
      if (!(userColumns.results || []).some(column => column.name === "public_id")) {
        await env.DB.prepare("ALTER TABLE users ADD COLUMN public_id INTEGER").run();
      }
      if (!(userColumns.results || []).some(column => column.name === "is_verified")) {
        await env.DB.prepare("ALTER TABLE users ADD COLUMN is_verified INTEGER NOT NULL DEFAULT 0").run();
      }
      if (!(userColumns.results || []).some(column => column.name === "tix_balance")) {
        await env.DB.prepare("ALTER TABLE users ADD COLUMN tix_balance INTEGER NOT NULL DEFAULT 0").run();
      }
      if (!(userColumns.results || []).some(column => column.name === "banned_at")) {
        await env.DB.prepare("ALTER TABLE users ADD COLUMN banned_at TEXT").run();
      }
      if (!(userColumns.results || []).some(column => column.name === "ban_reason")) {
        await env.DB.prepare("ALTER TABLE users ADD COLUMN ban_reason TEXT NOT NULL DEFAULT ''").run();
      }
      const groupColumns = await env.DB.prepare("PRAGMA table_info(sakura_groups)").all();
      if (!(groupColumns.results || []).some(column => column.name === "avatar_url")) {
        await env.DB.prepare("ALTER TABLE sakura_groups ADD COLUMN avatar_url TEXT NOT NULL DEFAULT ''").run();
      }
      if (!(groupColumns.results || []).some(column => column.name === "is_verified")) {
        await env.DB.prepare("ALTER TABLE sakura_groups ADD COLUMN is_verified INTEGER NOT NULL DEFAULT 0").run();
      }
      await env.DB.prepare(`UPDATE users SET
        banned_at=COALESCE(banned_at,(SELECT created_at FROM owner_audit_log WHERE target_user_id=users.id AND action='BAN' ORDER BY created_at DESC LIMIT 1)),
        ban_reason=CASE WHEN COALESCE(ban_reason,'')='' THEN COALESCE((SELECT details FROM owner_audit_log WHERE target_user_id=users.id AND action='BAN' ORDER BY created_at DESC LIMIT 1),'Account banned by Sakura moderation') ELSE ban_reason END
        WHERE is_banned=1`).run();
      const tixInitialization = await env.DB.prepare("SELECT setting_value FROM site_settings WHERE setting_key='tix_initial_balances_2026_11_03'").first();
      if (!tixInitialization) {
        await env.DB.batch([
          env.DB.prepare("UPDATE users SET tix_balance=0"),
          env.DB.prepare("INSERT OR IGNORE INTO site_settings (setting_key,setting_value) VALUES ('tix_initial_balances_2026_11_03','done')")
        ]);
      }
      // Use SQLite's stable rowid as the public numeric User ID for existing accounts.
      await env.DB.prepare("UPDATE users SET public_id=rowid WHERE public_id IS NULL").run();
      await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_public_id ON users(public_id)").run();

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
      if (!(itemColumns.results || []).some(column => column.name === "stock_sold")) {
        await env.DB.prepare("ALTER TABLE items ADD COLUMN stock_sold INTEGER NOT NULL DEFAULT 0").run();
      }
      if (!(itemColumns.results || []).some(column => column.name === "is_offsale")) {
        await env.DB.prepare("ALTER TABLE items ADD COLUMN is_offsale INTEGER NOT NULL DEFAULT 0").run();
      }
      if (!(itemColumns.results || []).some(column => column.name === "currency")) {
        await env.DB.prepare("ALTER TABLE items ADD COLUMN currency TEXT NOT NULL DEFAULT 'P$'").run();
      }
      const purchaseColumns = await env.DB.prepare("PRAGMA table_info(purchases)").all();
      if (!(purchaseColumns.results || []).some(column => column.name === "currency")) {
        await env.DB.prepare("ALTER TABLE purchases ADD COLUMN currency TEXT NOT NULL DEFAULT 'P$'").run();
      }
      const rapColumns = await env.DB.prepare("PRAGMA table_info(items)").all();
      if (!(rapColumns.results || []).some(column => column.name === "rap_value")) {
        await env.DB.prepare("ALTER TABLE items ADD COLUMN rap_value INTEGER NOT NULL DEFAULT 0 CHECK(rap_value>=0)").run();
      }
      if (!(rapColumns.results || []).some(column => column.name === "rap_currency")) {
        await env.DB.prepare("ALTER TABLE items ADD COLUMN rap_currency TEXT NOT NULL DEFAULT 'P$'").run();
      }
      const rapBaseline = await env.DB.prepare("SELECT setting_value FROM site_settings WHERE setting_key='rap_baseline_2026_11_05'").first();
      if (!rapBaseline) {
        await env.DB.batch([
          env.DB.prepare(`UPDATE items SET rap_value=CASE
            WHEN EXISTS (SELECT 1 FROM purchases p WHERE p.item_id=items.id AND p.currency='P$')
              THEN COALESCE((SELECT CAST(ROUND(AVG(p.price)) AS INTEGER) FROM purchases p WHERE p.item_id=items.id AND p.currency='P$'),0)
            WHEN EXISTS (SELECT 1 FROM resale_listings r WHERE r.item_id=items.id) THEN 0
            WHEN EXISTS (SELECT 1 FROM purchases p WHERE p.item_id=items.id)
              THEN COALESCE((SELECT p.price FROM purchases p WHERE p.item_id=items.id ORDER BY p.purchased_at ASC LIMIT 1),0)
            ELSE price END`),
          env.DB.prepare(`UPDATE items SET rap_currency=CASE
            WHEN EXISTS (SELECT 1 FROM purchases p WHERE p.item_id=items.id AND p.currency='P$') THEN 'P$'
            WHEN EXISTS (SELECT 1 FROM purchases p WHERE p.item_id=items.id)
              THEN COALESCE((SELECT p.currency FROM purchases p WHERE p.item_id=items.id ORDER BY p.purchased_at ASC LIMIT 1),'P$')
            WHEN EXISTS (SELECT 1 FROM resale_listings r WHERE r.item_id=items.id) THEN 'UNKNOWN'
            ELSE COALESCE(currency,'P$') END`),
          env.DB.prepare(`UPDATE items SET
            price=COALESCE((SELECT p.price FROM purchases p WHERE p.item_id=items.id ORDER BY p.purchased_at ASC LIMIT 1),0),
            currency=COALESCE((SELECT p.currency FROM purchases p WHERE p.item_id=items.id ORDER BY p.purchased_at ASC LIMIT 1),'P$')
            WHERE EXISTS (SELECT 1 FROM resale_listings r WHERE r.item_id=items.id)`),
          env.DB.prepare("INSERT OR IGNORE INTO site_settings (setting_key,setting_value) VALUES ('rap_baseline_2026_11_05','done')")
        ]);
      }
      await env.DB.batch([
        env.DB.prepare(`CREATE TRIGGER IF NOT EXISTS trg_items_rap_baseline_insert
          AFTER INSERT ON items
          WHEN NEW.rap_value=0 AND NEW.price>0
          BEGIN
            UPDATE items SET rap_value=NEW.price,rap_currency=COALESCE(NEW.currency,'P$') WHERE id=NEW.id;
          END`),
        env.DB.prepare(`CREATE TRIGGER IF NOT EXISTS trg_items_rap_baseline_update
          AFTER UPDATE OF price,currency ON items
          WHEN OLD.rap_value=0 AND NEW.price>0
            AND NOT EXISTS (SELECT 1 FROM purchases p WHERE p.item_id=NEW.id)
            AND NOT EXISTS (SELECT 1 FROM resale_listings r WHERE r.item_id=NEW.id)
          BEGIN
            UPDATE items SET rap_value=NEW.price,rap_currency=COALESCE(NEW.currency,'P$') WHERE id=NEW.id;
          END`)
      ]);
      // Backfill historical purchases once so they count toward finite stock.
      const stockBackfill = await env.DB.prepare("SELECT setting_value FROM site_settings WHERE setting_key='stock_sold_backfill_2026_11'").first();
      if (!stockBackfill) {
        await env.DB.batch([
          env.DB.prepare("UPDATE items SET stock_sold=(SELECT COUNT(*) FROM purchases WHERE purchases.item_id=items.id)"),
          env.DB.prepare("INSERT OR IGNORE INTO site_settings (setting_key,setting_value) VALUES ('stock_sold_backfill_2026_11','done')")
        ]);
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

async function announceLimitedItem(item, env, siteOrigin) {
  if (!env.DISCORD_LIMITED_WEBHOOK) return { sent:false, reason:"webhook_not_configured" };
  const already = await env.DB.prepare("SELECT item_id FROM discord_limited_announcements WHERE item_id=?").bind(item.id).first();
  if (already) return { sent:false, reason:"already_announced" };
  const itemUrl = new URL("/item/" + encodeURIComponent(item.id), siteOrigin).href;
  const embed = {
    title:"NEW LIMITED ITEM",
    description:"**" + String(item.name || "Untitled").slice(0, 200) + "** is now available on Sakura",
    url:itemUrl,
    color:0x9B59B6,
    fields:[
      {name:"Price",value:Number(item.price || 0).toLocaleString("en-US") + " " + (item.currency||"P$"),inline:true},
      {name:"Stock",value:String(Number(item.stock_limit || 0)),inline:true},
      {name:"Category",value:String(item.category || "Other"),inline:true}
    ],
    image:item.image_url && /^https:\/\//i.test(String(item.image_url)) ? {url:String(item.image_url)} : undefined,
    footer:{text:"Sakura • Limited items"},
    timestamp:new Date().toISOString()
  };
  const response = await fetch(env.DISCORD_LIMITED_WEBHOOK,{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({username:"Sakura",embeds:[embed]})
  });
  if (!response.ok) {
    console.error("[Sakura Discord] Webhook failed:",response.status,(await response.text()).slice(0,500));
    return {sent:false,reason:"discord_error"};
  }
  await env.DB.prepare("INSERT OR IGNORE INTO discord_limited_announcements (item_id) VALUES (?)").bind(item.id).run();
  return {sent:true};
}

async function announcePriceIncrease(item, oldPrice, newPrice, env, siteOrigin) {
  if (!env.DISCORD_LIMITED_WEBHOOK || Number(newPrice) <= Number(oldPrice)) return {sent:false};
  const previous = Number(oldPrice || 0);
  const current = Number(newPrice || 0);
  const difference = current - previous;
  const itemUrl = new URL("/item/" + encodeURIComponent(item.id), siteOrigin).href;
  const embed = {
    title:"PRICE INCREASE",
    description:"The price of **" + String(item.name || "Untitled").slice(0, 200) + "** has increased on Sakura",
    url:itemUrl,
    color:0xE67E22,
    fields:[
      {name:"Previous price",value:previous.toLocaleString("en-US") + " " + (item.currency||"P$"),inline:true},
      {name:"New price",value:current.toLocaleString("en-US") + " " + (item.currency||"P$"),inline:true},
      {name:"Increase",value:"+" + difference.toLocaleString("en-US") + " " + (item.currency||"P$"),inline:true}
    ],
    image:item.image_url && /^https:\/\//i.test(String(item.image_url)) ? {url:String(item.image_url)} : undefined,
    footer:{text:"Sakura • Price update"},
    timestamp:new Date().toISOString()
  };
  const response = await fetch(env.DISCORD_LIMITED_WEBHOOK,{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({username:"Sakura",embeds:[embed]})
  });
  if (!response.ok) {
    console.error("[Sakura Discord] Price increase webhook failed:",response.status,(await response.text()).slice(0,500));
    return {sent:false,reason:"discord_error"};
  }
  return {sent:true};
}

async function announceMissingLimitedItems(env, siteOrigin) {
  if (!env.DISCORD_LIMITED_WEBHOOK) return {sent:0,skipped:true};
  const rows = await env.DB.prepare("SELECT i.id,i.name,i.category,i.price,i.currency,i.image_url,i.stock_limit FROM items i LEFT JOIN discord_limited_announcements a ON a.item_id=i.id WHERE i.is_limited=1 AND a.item_id IS NULL ORDER BY i.created_at ASC LIMIT 50").all();
  let sent=0;
  for (const item of rows.results || []) {
    const result=await announceLimitedItem(item,env,siteOrigin);
    if (!result.sent && result.reason !== "already_announced") break;
    if (result.sent) sent++;
  }
  return {sent,remaining:(rows.results || []).length-sent};
}

async function runDailyMembershipPayout(controller,env) {
  if (!env.DB) return;
  const scheduledAt = new Date(Number(controller.scheduledTime));
  const localParts = new Intl.DateTimeFormat("en-GB",{
    timeZone:"Europe/Kyiv",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"
  }).formatToParts(scheduledAt);
  const part = type => localParts.find(entry => entry.type === type)?.value || "";
  // Both UTC cron times are configured so this runs at Kyiv midnight in summer and winter.
  if (part("hour") !== "00" || part("minute") !== "00") return;
  const rewardDate = part("year")+"-"+part("month")+"-"+part("day");
  await ensureSiteSettings(env);
  const members = await env.DB.prepare("SELECT m.user_id,m.membership_type FROM user_memberships m JOIN users u ON u.id=m.user_id WHERE m.membership_type<>'None' AND u.is_banned=0 AND (m.membership_type NOT IN ('OutrageousBuildersClub','Premium') OR datetime(u.created_at)<datetime('now','-3 days')) ORDER BY m.user_id").all();
  let awarded = 0;
  for (const member of members.results || []) {
    const amount = Number(MEMBERSHIP_REWARDS[member.membership_type] || 0);
    if (amount <= 0) continue;
    const result = await env.DB.batch([
      env.DB.prepare("INSERT INTO membership_daily_rewards (user_id,reward_date,amount) VALUES (?,?,?) ON CONFLICT(user_id,reward_date) DO NOTHING").bind(member.user_id,rewardDate,amount),
      env.DB.prepare("UPDATE users SET balance=balance+? WHERE id=? AND changes()=1").bind(amount,member.user_id)
    ]);
    if (Number(result?.[0]?.meta?.changes || 0) === 1) awarded++;
  }
  console.log("[Sakura membership] Daily payout completed",JSON.stringify({rewardDate,awarded,members:(members.results || []).length}));
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const avatarSupportRoute = path === "/v1.1/avatar-fetch" || path.toLowerCase() === "/asset/bodycolors.ashx" || path.toLowerCase() === "/asset" || path.toLowerCase() === "/asset/";
  const apiRoute = path.startsWith("/api/");
  if ((apiRoute && path !== "/api/health" || avatarSupportRoute) && !env.DB) {
    return json({ error:"D1 binding DB is missing." },503);
  }
  if ((apiRoute && path !== "/api/health" || avatarSupportRoute) && env.DB) {
    try { await ensureSiteSettings(env); }
    catch (error) {
      console.error("[Pekora setup] Site settings setup failed:", error);
      return json({ error:"Catalog database setup failed. Check Worker logs." },503);
    }
  }

  if (request.method === "GET" && path === "/v1.1/avatar-fetch") {
    const publicId = Number(url.searchParams.get("userId") || 0);
    const placeId = Number(url.searchParams.get("placeId") || 0);
    if (!Number.isSafeInteger(publicId) || publicId < 1 || publicId > 2147483647 || !Number.isSafeInteger(placeId) || placeId < 0) {
      return fail("A valid userId and placeId are required.",400);
    }
    const target = await env.DB.prepare("SELECT id,public_id FROM users WHERE public_id=? AND is_banned=0").bind(publicId).first();
    if (!target) return fail("Avatar not found.",404);
    const [itemRows,settings] = await Promise.all([
      env.DB.prepare("SELECT i.asset_id,i.asset_type_id,i.category FROM equipped_items e JOIN items i ON i.id=e.item_id WHERE e.user_id=? AND i.asset_id IS NOT NULL AND i.asset_id>0 ORDER BY e.equipped_at DESC").bind(target.id).all(),
      loadAvatarSettings(env,target.id)
    ]);
    const fallbackTypes = {Hats:8,Hair:41,Faces:18,Shirts:11,Pants:12};
    const validAssetTypes = new Set([2,8,11,12,17,18,19,27,28,29,30,31,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,61]);
    const assets = (itemRows.results||[]).map(item=>({
      assetId:Number(item.asset_id||0),
      assetTypeId:Number(item.asset_type_id||fallbackTypes[item.category]||0)
    })).filter(item=>Number.isSafeInteger(item.assetId)&&item.assetId>0&&Number.isSafeInteger(item.assetTypeId)&&validAssetTypes.has(item.assetTypeId));
    const c=settings.bodyColors;
    const bodyColors={
      headColorId:c.headColorId,torsoColorId:c.torsoColorId,rightArmColorId:c.rightArmColorId,leftArmColorId:c.leftArmColorId,rightLegColorId:c.rightLegColorId,leftLegColorId:c.leftLegColorId,
      HeadColor:c.headColorId,LeftArmColor:c.leftArmColorId,LeftLegColor:c.leftLegColorId,RightArmColor:c.rightArmColorId,RightLegColor:c.rightLegColorId,TorsoColor:c.torsoColorId
    };
    const s=settings.scales;
    const scales={height:s.height,Height:s.height,width:s.width,Width:s.width,head:s.head,Head:s.head,depth:s.depth,Depth:s.depth,proportion:s.proportion,Proportion:s.proportion,bodyType:s.bodyType,BodyType:s.bodyType};
    return json({
      resolvedAvatarType:settings.rigType,
      accessoryVersionIds:placeId!==0?assets.filter(item=>[8,41,42,43,44,45,46,47].includes(item.assetTypeId)).map(item=>item.assetId):[],
      equippedGearVersionIds:[],
      assetAndAssetTypeIds:assets.map(item=>({assetId:item.assetId,assetTypeId:item.assetTypeId})),
      backpackGearVersionIds:[],animationAssetIds:{},playerAvatarType:settings.rigType,scales,
      bodyColorsUrl:url.origin+"/Asset/BodyColors.ashx?userId="+publicId,bodyColors,emotes:[]
    });
  }

  if (request.method === "GET" && path.toLowerCase() === "/asset/bodycolors.ashx") {
    const publicId=Number(url.searchParams.get("userId")||0);
    if(!Number.isSafeInteger(publicId)||publicId<1||publicId>2147483647)return fail("A valid userId is required.",400);
    const target=await env.DB.prepare("SELECT id FROM users WHERE public_id=? AND is_banned=0").bind(publicId).first();
    if(!target)return fail("Avatar not found.",404);
    const c=(await loadAvatarSettings(env,target.id)).bodyColors;
    const colors={HeadColor:c.headColorId,LeftArmColor:c.leftArmColorId,LeftLegColor:c.leftLegColorId,RightArmColor:c.rightArmColorId,RightLegColor:c.rightLegColorId,TorsoColor:c.torsoColorId};
    const xmlBody='<?xml version="1.0" encoding="utf-8"?><roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4"><External>null</External><External>nil</External><Item class="BodyColors"><Properties>'+
      Object.entries(colors).map(([name,value])=>'<int name="'+name+'">'+value+'</int>').join("")+
      '<string name="Name">Body Colors</string><bool name="archivable">true</bool></Properties></Item></roblox>';
    return new Response(xmlBody,{status:200,headers:{"content-type":"application/xml; charset=utf-8","cache-control":"public, max-age=60"}});
  }

  if (request.method === "GET" && /^\/asset\/?$/i.test(path)) {
    const assetId=Number(url.searchParams.get("id")||0);
    if(!Number.isSafeInteger(assetId)||assetId<1||assetId>9007199254740991)return fail("A valid asset id is required.",400);
    const upstreamUrl=new URL("https://assetdelivery.roblox.com/v1/asset/");
    upstreamUrl.searchParams.set("id",String(assetId));
    const upstream=await fetch(upstreamUrl.toString(),{redirect:"follow",headers:{"user-agent":"Sakura-OpenPekora-Renderer/1.0"}});
    if(!upstream.ok)return new Response("Asset could not be loaded.",{status:upstream.status,headers:{"cache-control":"no-store","content-type":"text/plain; charset=utf-8"}});
    const headers=new Headers();
    headers.set("content-type",upstream.headers.get("content-type")||"application/octet-stream");
    headers.set("cache-control","public, max-age=3600, s-maxage=86400");
    headers.set("x-content-type-options","nosniff");
    return new Response(upstream.body,{status:200,headers});
  }

  if (request.method === "GET" && path === "/api/health") {
    if (!env.DB) return json({ ok:false, site:"Sakura", database:false, schema:false, error:"D1 binding DB is missing." },503);
    try {
      await ensureSiteSettings(env);
      await env.DB.prepare("SELECT 1 AS ok").first();
      const schema = await env.DB.prepare(
        "SELECT COUNT(*) AS total FROM sqlite_master WHERE type='table' AND name IN ('users','sessions','profiles','items','inventory','purchases','friends')"
      ).first();
      if ((schema?.total || 0) !== 7) {
        return json({ ok:false, site:"Sakura", database:true, schema:false, error:"D1 is reachable, but the Sakura migrations are missing or incomplete." },503);
      }
      const requiredColumns = [
        "SELECT id,username,password_hash,password_salt,role,balance,tix_balance,created_at,is_banned FROM users LIMIT 0",
        "SELECT token_hash,user_id,expires_at FROM sessions LIMIT 0",
        "SELECT user_id,description,avatar_json FROM profiles LIMIT 0",
        "SELECT user_id,body_colors,rig_type,scales_json FROM avatar_settings LIMIT 0",
        "SELECT id,name,description,category,price,currency,rap_value,rap_currency,image_url,model_url,is_limited,is_for_sale,is_offsale,created_at FROM items LIMIT 0",
        "SELECT id,user_id,item_id,purchased_at FROM inventory LIMIT 0",
        "SELECT id,user_id,item_id,price,currency,purchased_at FROM purchases LIMIT 0",
        "SELECT user_id,friend_id,status,created_at FROM friends LIMIT 0"
      ];
      try {
        await env.DB.batch(requiredColumns.map(sql => env.DB.prepare(sql)));
      } catch (schemaError) {
        console.error("[Pekora health] D1 schema validation failed:", schemaError);
        return json({ ok:false, site:"Sakura", database:true, schema:false, error:"D1 tables exist, but required Sakura columns are missing. Check and apply the migrations." },503);
      }
      return json({ ok:true, site:"Sakura", database:true, schema:true });
    } catch (error) {
      console.error("[Pekora health] D1 check failed:", error);
      return json({ ok:false, site:"Sakura", database:false, schema:false, error:"D1 database check failed. See Worker logs." },503);
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
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return registrationFailure("New usernames must be 3–20 characters and use only letters, numbers or _.");
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
        env.DB.prepare("INSERT INTO users (id,username,password_hash,password_salt,balance,public_id) VALUES (?,?,?,?,100,(SELECT COALESCE(MAX(public_id),0)+1 FROM users))").bind(userId, username, hash, salt),
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
    const user = await env.DB.prepare("SELECT id,username,role,balance,created_at,is_banned,public_id,is_verified FROM users WHERE id=?").bind(userId).first();
    return json({ user:publicUser(user) }, 201, { "set-cookie":cookie("pekora_session",token,60*60*24*30) });
  }

  if (request.method === "POST" && path === "/api/login") {
    const data = await body(request);
    if (!data || typeof data.username !== "string" || !/^[A-Za-z0-9_]{1,20}$/.test(data.username.trim()) || typeof data.password !== "string" || data.password.length < 8 || data.password.length > 128) return fail("Enter a valid username and a password of 8–128 characters.");
    const key = await rateLimitKey(request,"login");
    if (await isRateLimited(env,key)) return json({error:"Too many sign-in attempts. Try again in 15 minutes."},429,{"retry-after":"900"});
    const user = await env.DB.prepare("SELECT * FROM users WHERE username=? COLLATE NOCASE").bind(data.username.trim()).first();
    const candidateHash = await passwordHash(data.password,user?.password_salt||DUMMY_PASSWORD_SALT);
    const passwordMatches = constantTimeEqual(candidateHash,user?.password_hash||"");
    if (!user || !passwordMatches) {
      const blocked = await recordRateLimitFailure(env,key);
      return blocked?json({error:"Too many sign-in attempts. Try again in 15 minutes."},429,{"retry-after":"900"}):fail("Incorrect username or password.",401);
    }
    if (Number(user.is_banned) === 1) {
      await clearRateLimit(env,key);
      const reason = String(user.ban_reason || "Account banned by Sakura moderation");
      const bannedAt = String(user.banned_at || "Date unavailable");
      return json({error:"This account is banned from Sakura. Reason: "+reason+" · Banned on: "+bannedAt,banned:true,banReason:reason,bannedAt},403);
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
    if (user) return json({user:publicUser(user),bannedAccount:null});
    const token = getCookie(request,"pekora_session");
    if (token) {
      const blocked = await env.DB.prepare(`SELECT u.username,u.public_id,u.role,u.created_at,u.banned_at,u.ban_reason
        FROM banned_session_notices s JOIN users u ON u.id=s.user_id
        WHERE s.token_hash=? AND s.expires_at>datetime('now') AND u.is_banned=1`).bind(await digest(token)).first();
      if (blocked) return json({user:null,bannedAccount:{
        username:blocked.username,public_id:blocked.public_id,role:blocked.role,
        created_at:blocked.created_at,banned_at:blocked.banned_at,
        ban_reason:blocked.ban_reason||"Account banned by Sakura moderation"
      }});
    }
    return json({user:null,bannedAccount:null});
  }

  if (request.method === "GET" && path === "/api/membership") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const [membership,lastReward,wallet] = await Promise.all([
      env.DB.prepare("SELECT membership_type,updated_at FROM user_memberships WHERE user_id=?").bind(user.id).first(),
      env.DB.prepare("SELECT reward_date,amount,created_at FROM membership_daily_rewards WHERE user_id=? ORDER BY reward_date DESC LIMIT 1").bind(user.id).first(),
      env.DB.prepare("SELECT balance,tix_balance FROM users WHERE id=?").bind(user.id).first()
    ]);
    const membershipType = membership?.membership_type || "None";
    const createdAtMs = Date.parse(user.created_at || "");
    const membershipUnlockAt = Number.isFinite(createdAtMs) ? new Date(createdAtMs + 3 * 24 * 60 * 60 * 1000).toISOString() : null;
    const canUseAdvancedMemberships = Number.isFinite(createdAtMs) && Date.now() - createdAtMs > 3 * 24 * 60 * 60 * 1000;
    return json({
      membershipType,
      dailyReward:Number(MEMBERSHIP_REWARDS[membershipType] || 0),
      updatedAt:membership?.updated_at || null,
      lastRewardDate:lastReward?.reward_date || null,
      lastRewardAmount:Number(lastReward?.amount || 0),
      balance:Number(wallet?.balance || 0),
      tixBalance:Number(wallet?.tix_balance || 0),
      accountCreatedAt:user.created_at,
      membershipUnlockAt,
      canUseAdvancedMemberships,
      payoutTimezone:"Europe/Kyiv"
    });
  }

  if (request.method === "POST" && path === "/api/membership") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const data = await body(request);
    const membershipType = String(data?.membershipType || "");
    if (!Object.prototype.hasOwnProperty.call(MEMBERSHIP_REWARDS,membershipType)) return fail("Choose a valid membership.");
    if (membershipType === "OutrageousBuildersClub" || membershipType === "Premium") {
      const createdAtMs = Date.parse(user.created_at || "");
      if (!Number.isFinite(createdAtMs) || Date.now() - createdAtMs <= 3 * 24 * 60 * 60 * 1000) {
        return fail("Premium and Outrageous Builders Club unlock only after your account is more than 3 days old.",403);
      }
    }
    await env.DB.prepare("INSERT INTO user_memberships (user_id,membership_type,updated_at) VALUES (?,?,datetime('now')) ON CONFLICT(user_id) DO UPDATE SET membership_type=excluded.membership_type,updated_at=excluded.updated_at").bind(user.id,membershipType).run();
    return json({ok:true,membershipType,dailyReward:Number(MEMBERSHIP_REWARDS[membershipType] || 0)});
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
        env.DB.prepare("INSERT INTO users (id,username,password_hash,password_salt,role,balance,public_id) VALUES (?,?,?,?, 'OWNER',1000,(SELECT COALESCE(MAX(public_id),0)+1 FROM users))").bind(userId,username,hash,salt),
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
    const user = await env.DB.prepare("SELECT id,username,role,balance,created_at,public_id,is_verified FROM users WHERE id=?").bind(userId).first();
    return json({ user:publicUser(user) },201,{"set-cookie":cookie("pekora_session",token,60*60*24*30)});
  }

  if (request.method === "GET" && path === "/api/catalog") {
    const rows = await env.DB.prepare("SELECT i.id,i.name,i.description,i.category,i.price,i.currency,i.image_url,i.model_url,i.asset_id,i.asset_type_id,i.is_limited,i.is_offsale,i.stock_limit,i.stock_sold,i.created_at,ic.creator_name,cu.public_id AS creator_public_id,CASE WHEN i.category='Accessories' THEN CASE WHEN model_url<>'' THEN '3D' ELSE '3D_MISSING' END ELSE 'IMAGE_ONLY' END AS asset_kind FROM items i LEFT JOIN item_creators ic ON ic.item_id=i.id LEFT JOIN users cu ON cu.id=ic.creator_id WHERE i.is_for_sale=1 ORDER BY i.created_at DESC,i.rowid DESC").all();
    return json({ items:rows.results || [] });
  }

  if (path === "/api/creator/model-submissions" && request.method === "GET") {
    const user=await requireUser(request,env);
    if(!user)return fail("Please sign in.",401);
    const rows=await env.DB.prepare("SELECT id,name,description,model_url,image_url,price,status,created_item_id,created_at,reviewed_at FROM model_submissions WHERE user_id=? ORDER BY created_at DESC LIMIT 40").bind(user.id).all();
    return json({submissions:rows.results||[]});
  }
  if (path === "/api/creator/model-submissions" && request.method === "POST") {
    const user=await requireUser(request,env);
    if(!user)return fail("Please sign in.",401);
    const data=await body(request);
    const name=String(data?.name||"").trim();
    const description=String(data?.description||"").trim();
    const modelUrl=String(data?.model_url||"").trim();
    const imageUrl=String(data?.image_url||"").trim();
    const price=Number(data?.price??50);
    if(!name||name.length>80)return fail("Model name must be 1-80 characters.");
    if(description.length>500)return fail("Description must be 500 characters or less.");
    if(modelUrl.length>1000)return fail("3D model URL is too long.");
    try{const parsed=new URL(modelUrl),ext=parsed.pathname.toLowerCase();if(parsed.protocol!=="https:"||!(ext.endsWith(".glb")||ext.endsWith(".gltf")))throw new Error();}
    catch{return fail("Enter a direct HTTPS .glb or .gltf model URL.");}
    if(imageUrl){try{if(new URL(imageUrl).protocol!=="https:")throw new Error();}catch{return fail("Preview image must be a valid HTTPS link.");}}
    if(imageUrl.length>500)return fail("Preview image URL is too long.");
    if(!Number.isSafeInteger(price)||price<0||price>1000000)return fail("Price must be a whole number from 0 to 1,000,000 P$.");
    const duplicate=await env.DB.prepare("SELECT id FROM model_submissions WHERE model_url=? AND status IN ('PENDING','APPROVED')").bind(modelUrl).first();
    if(duplicate)return fail("This model has already been submitted.",409);
    const submissionId=id();
    await env.DB.prepare("INSERT INTO model_submissions (id,user_id,username,name,description,model_url,image_url,price) VALUES (?,?,?,?,?,?,?,?)").bind(submissionId,user.id,user.username,name,description,modelUrl,imageUrl,price).run();
    return json({ok:true,id:submissionId,status:"PENDING"},201);
  }

  if (path === "/api/creator/submissions" && request.method === "GET") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const rows = await env.DB.prepare(`SELECT id,name,description,category,roblox_url,price,status,created_item_id,created_at,reviewed_at
      FROM creator_submissions WHERE user_id=? ORDER BY created_at DESC LIMIT 40`).bind(user.id).all();
    return json({submissions:rows.results||[]});
  }

  if (path === "/api/creator/submissions" && request.method === "POST") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const data = await body(request);
    const name = String(data?.name||"").trim();
    const description = String(data?.description||"").trim();
    const category = String(data?.category||"");
    const rawPrice = data?.price === undefined ? 50 : data.price;
    const price = Number(rawPrice);
    const suppliedUrl = String(data?.roblox_url||"").trim();
    if (!name || name.length>80) return fail("Item name must be 1–80 characters.");
    if (!["Shirts","Pants"].includes(category)) return fail("Only Shirts and Pants can be submitted.");
    if (description.length>500) return fail("Description must be 500 characters or less.");
    if ((typeof rawPrice !== "number" && typeof rawPrice !== "string") ||
        (typeof rawPrice === "string" && !/^\d+$/.test(rawPrice.trim())) ||
        !Number.isSafeInteger(price) || price<0 || price>1000000) return fail("Price must be a whole number from 0 to 1,000,000 P$.");
    if (suppliedUrl.length>500) return fail("Roblox catalog link or item ID is too long.");
    let assetId = 0;
    try {
      if (/^[0-9]+$/.test(suppliedUrl)) {
        assetId = Number(suppliedUrl);
      } else {
        const normalizedUrl = suppliedUrl.startsWith("//") ? "https:"+suppliedUrl :
          /^[a-z][a-z0-9+.-]*:\/\//i.test(suppliedUrl) ? suppliedUrl : "https://"+suppliedUrl;
        const source = new URL(normalizedUrl);
        if (source.protocol!=="https:" || !["roblox.com","www.roblox.com","m.roblox.com"].includes(source.hostname.toLowerCase())) throw new Error();
        const pathParts = source.pathname.split("/").filter(Boolean);
        if (["catalog","library"].includes(pathParts[0]) && /^[0-9]+$/.test(pathParts[1]||"")) assetId = Number(pathParts[1]);
        else if (pathParts[0]==="marketplace" && pathParts[1]==="asset" && /^[0-9]+$/.test(pathParts[2]||"")) assetId = Number(pathParts[2]);
        else throw new Error();
      }
      if (!Number.isSafeInteger(assetId) || assetId<1) throw new Error();
    } catch {
      return fail("Enter a Roblox catalog link or numeric item ID, for example https://www.roblox.com/catalog/123456789/Item. A Sakura page or image link is not a Roblox clothing item.");
    }
    const pending = await env.DB.prepare("SELECT COUNT(*) AS count FROM creator_submissions WHERE user_id=? AND status='PENDING'").bind(user.id).first();
    if (Number(pending?.count||0)>=10) return fail("You already have 10 requests waiting for review.",429);
    const submissionId = id();
    const canonicalUrl = "https://www.roblox.com/catalog/"+assetId;
    try {
      await env.DB.prepare("INSERT INTO creator_submissions (id,user_id,username,name,description,category,roblox_url,asset_id,price) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(submissionId,user.id,user.username,name,description,category,canonicalUrl,assetId,price).run();
    } catch (error) {
      const message = String(error?.message||"").toLowerCase();
      if (message.includes("unique") || message.includes("constraint")) return fail("This Roblox item already has a pending or approved submission.",409);
      console.error("[Sakura creator] Submission creation failed:",error);
      return fail("Could not submit this item. Please try again.",500);
    }
    return json({ok:true,id:submissionId,status:"PENDING"},201);
  }

  if (request.method === "GET" && path === "/api/resale/listings") {
    const rows = await env.DB.prepare(`SELECT r.id,r.item_id,r.seller_id,r.price,r.currency,r.created_at,
        i.name,i.description,i.category,i.image_url,i.model_url,i.is_limited,i.is_offsale,i.stock_limit,i.stock_sold,
        u.username AS seller_name,u.public_id AS seller_public_id,u.is_verified AS seller_verified
      FROM resale_listings r
      JOIN items i ON i.id=r.item_id
      JOIN users u ON u.id=r.seller_id
      WHERE r.status='ACTIVE' AND u.is_banned=0 AND (i.is_limited=1 OR i.is_offsale=1 OR (i.stock_limit>0 AND i.stock_sold>=i.stock_limit))
        AND EXISTS (SELECT 1 FROM inventory v WHERE v.user_id=r.seller_id AND v.item_id=r.item_id)
        AND NOT EXISTS (SELECT 1 FROM trade_locks t WHERE t.owner_id=r.seller_id AND t.item_id=r.item_id)
      ORDER BY r.created_at DESC LIMIT 200`).all();
    return json({listings:rows.results||[]});
  }

  const resaleItemMatch = path.match(/^\/api\/resale\/item\/([A-Za-z0-9_-]{1,80})$/);
  if (request.method === "GET" && resaleItemMatch) {
    const item = await env.DB.prepare("SELECT i.id,i.name,i.description,i.category,i.price,i.currency,i.image_url,i.model_url,i.asset_id,i.asset_type_id,i.is_limited,i.is_offsale,i.stock_limit,i.stock_sold,i.is_for_sale,i.created_at,ic.creator_name,cu.public_id AS creator_public_id FROM items i LEFT JOIN item_creators ic ON ic.item_id=i.id LEFT JOIN users cu ON cu.id=ic.creator_id WHERE i.id=?").bind(resaleItemMatch[1]).first();
    if (!item) return fail("Item not found.",404);
    const rows = await env.DB.prepare(`SELECT r.id,r.item_id,r.seller_id,r.price,r.currency,r.created_at,
        u.username AS seller_name,u.public_id AS seller_public_id,u.is_verified AS seller_verified
      FROM resale_listings r JOIN users u ON u.id=r.seller_id
      WHERE r.item_id=? AND r.status='ACTIVE' AND u.is_banned=0
         AND EXISTS (SELECT 1 FROM items eligible WHERE eligible.id=r.item_id AND (eligible.is_limited=1 OR eligible.is_offsale=1 OR (eligible.stock_limit>0 AND eligible.stock_sold>=eligible.stock_limit)))
        AND EXISTS (SELECT 1 FROM inventory v WHERE v.user_id=r.seller_id AND v.item_id=r.item_id)
        AND NOT EXISTS (SELECT 1 FROM trade_locks t WHERE t.owner_id=r.seller_id AND t.item_id=r.item_id)
      ORDER BY r.price ASC,r.created_at ASC`).bind(item.id).all();
    return json({item,listings:rows.results||[]});
  }

  if (request.method === "POST" && path === "/api/resale/listings") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const data = await body(request);
    const itemId = String(data?.itemId||"");
    const price = Number(data?.price);
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(itemId)) return fail("Choose a valid item.");
    if (!Number.isSafeInteger(price)||price<1||price>1000000) return fail("Price must be between 1 and 1,000,000 P$.");
    const item = await env.DB.prepare("SELECT i.id,i.name,i.price,i.currency,i.is_limited,i.is_offsale,i.stock_limit,i.stock_sold FROM inventory v JOIN items i ON i.id=v.item_id WHERE v.user_id=? AND v.item_id=?").bind(user.id,itemId).first();
    if (!item) return fail("This item is not in your inventory.",404);
    const soldOut = Number(item.stock_limit)>0 && Number(item.stock_sold)>=Number(item.stock_limit);
    if (Number(item.is_limited)!==1&&Number(item.is_offsale)!==1&&!soldOut) return fail("Only Limited, Off Sale, or sold-out items can be resold.",403);
    const locked = await env.DB.prepare("SELECT 1 AS locked FROM trade_locks WHERE owner_id=? AND item_id=?").bind(user.id,itemId).first();
    if (locked) return fail("This item is reserved in a pending trade. Cancel that trade before listing it.",409);
    const listingId=id();
    try {
      const results = await env.DB.batch([
        env.DB.prepare(`INSERT INTO resale_listings (id,item_id,seller_id,price,currency)
          SELECT ?,?,?,?,'P$'
          WHERE EXISTS (SELECT 1 FROM inventory WHERE user_id=? AND item_id=?)
            AND NOT EXISTS (SELECT 1 FROM trade_locks WHERE owner_id=? AND item_id=?)
            AND NOT EXISTS (SELECT 1 FROM resale_listings WHERE seller_id=? AND item_id=? AND status='ACTIVE')
            AND EXISTS (SELECT 1 FROM items WHERE id=? AND (is_limited=1 OR is_offsale=1 OR (stock_limit>0 AND stock_sold>=stock_limit)))`)
          .bind(listingId,itemId,user.id,price,user.id,itemId,user.id,itemId,user.id,itemId,itemId),
      ]);
      if (!results?.[0]?.meta?.changes) return fail("This item is already listed, reserved in a trade, or no longer eligible.",409);
    } catch (error) {
      console.error("[Sakura resale] Listing creation failed:",error);
      return fail("Could not create this listing. Refresh your inventory and try again.",409);
    }
    return json({ok:true,listingId,price,itemPrice:Number(item.price||0),currency:item.currency||"P$"});
  }

  const resaleListingMatch = path.match(/^\/api\/resale\/listings\/([A-Za-z0-9-]+)$/);
  if (resaleListingMatch && request.method === "DELETE") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const result = await env.DB.prepare("UPDATE resale_listings SET status='CANCELLED' WHERE id=? AND seller_id=? AND status='ACTIVE'").bind(resaleListingMatch[1],user.id).run();
    if (!result?.meta?.changes) return fail("Active listing not found.",404);
    return json({ok:true});
  }

  const resaleBuyMatch = path.match(/^\/api\/resale\/listings\/([A-Za-z0-9-]+)\/buy$/);
  if (resaleBuyMatch && request.method === "POST") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const listing = await env.DB.prepare(`SELECT r.id,r.item_id,r.seller_id,r.price,r.currency,i.name,s.username AS seller_name
      FROM resale_listings r JOIN items i ON i.id=r.item_id
      JOIN users s ON s.id=r.seller_id
      WHERE r.id=? AND r.status='ACTIVE' AND s.is_banned=0 AND (i.is_limited=1 OR i.is_offsale=1 OR (i.stock_limit>0 AND i.stock_sold>=i.stock_limit))`)
      .bind(resaleBuyMatch[1]).first();
    if (!listing) return fail("This listing is no longer available.",404);
    if (listing.seller_id===user.id) return fail("You cannot buy your own listing.",403);
    if (Number(user.balance||0)<Number(listing.price)) return fail("Not enough P$.",400);
    if (await env.DB.prepare("SELECT 1 AS owned FROM inventory WHERE user_id=? AND item_id=?").bind(user.id,listing.item_id).first()) return fail("You already own this item.",409);
    const newInventoryId=id();
    try {
      const results = await env.DB.batch([
        env.DB.prepare(`UPDATE resale_listings SET status='SOLD',buyer_id=?,sold_at=datetime('now')
          WHERE id=? AND status='ACTIVE' AND seller_id<>?
            AND EXISTS (SELECT 1 FROM inventory v JOIN items i ON i.id=v.item_id WHERE v.user_id=resale_listings.seller_id AND v.item_id=resale_listings.item_id AND (i.is_limited=1 OR i.is_offsale=1 OR (i.stock_limit>0 AND i.stock_sold>=i.stock_limit)))
            AND EXISTS (SELECT 1 FROM users b WHERE b.id=? AND b.balance>=resale_listings.price)
            AND EXISTS (SELECT 1 FROM users s WHERE s.id=resale_listings.seller_id AND s.is_banned=0)
            AND NOT EXISTS (SELECT 1 FROM inventory WHERE user_id=? AND item_id=resale_listings.item_id)
            AND NOT EXISTS (SELECT 1 FROM trade_locks WHERE owner_id=resale_listings.seller_id AND item_id=resale_listings.item_id)`)
          .bind(user.id,listing.id,user.id,user.id,user.id),
        env.DB.prepare("UPDATE users SET balance=balance-? WHERE id=? AND balance>=? AND changes()=1").bind(listing.price,user.id,listing.price),
        env.DB.prepare("UPDATE users SET balance=balance+? WHERE id=? AND changes()=1").bind(listing.price,listing.seller_id),
        env.DB.prepare("DELETE FROM inventory WHERE user_id=? AND item_id=? AND changes()=1").bind(listing.seller_id,listing.item_id),
        env.DB.prepare("INSERT INTO inventory (id,user_id,item_id) SELECT ?,?,? WHERE changes()=1").bind(newInventoryId,user.id,listing.item_id),
        env.DB.prepare("DELETE FROM equipped_items WHERE user_id=? AND item_id=? AND EXISTS (SELECT 1 FROM resale_listings WHERE id=? AND status='SOLD' AND buyer_id=?)").bind(listing.seller_id,listing.item_id,listing.id,user.id)
      ]);
      if (!results?.[0]?.meta?.changes) return fail("This listing was already sold or is no longer available.",409);
      if (!results?.[1]?.meta?.changes||!results?.[2]?.meta?.changes||!results?.[3]?.meta?.changes||!results?.[4]?.meta?.changes) {
        console.error("[Sakura resale] Incomplete resale transaction",listing.id);
        return fail("Purchase could not be completed. Refresh and check your inventory.",409);
      }
    } catch (error) {
      console.error("[Sakura resale] Purchase failed:",error);
      return fail("Purchase could not be completed. No items or balance should have changed.",409);
    }
    const updated = await env.DB.prepare("SELECT balance,tix_balance FROM users WHERE id=?").bind(user.id).first();
    return json({ok:true,item:{id:listing.item_id,name:listing.name},price:Number(listing.price),currency:"P$",seller:listing.seller_id,sellerName:listing.seller_name,balance:Number(updated?.balance||0),tixBalance:Number(updated?.tix_balance||0)});
  }

  if (request.method === "POST" && path === "/api/purchase") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const data = await body(request);
    if (typeof data?.itemId !== "string") return fail("Invalid item.");
    const item = await env.DB.prepare("SELECT * FROM items WHERE id=? AND is_for_sale=1").bind(data.itemId).first();
    if (!item) return fail("Item not found or unavailable.",404);
    if (Number(item.is_offsale) === 1) return fail("This item is Off Sale and cannot be purchased.",409);
    const currencyCode = item.currency === "Tix" ? "Tix" : "P$";
    const walletColumn = currencyCode === "Tix" ? "tix_balance" : "balance";
    const available = Number(user[walletColumn] || 0);
    const price = Number(item.price || 0);
    if (available < price) return fail("Not enough " + currencyCode + ".",400);
    if (await env.DB.prepare("SELECT id FROM inventory WHERE user_id=? AND item_id=?").bind(user.id,item.id).first()) return fail("You already own this item.",409);
    const creatorAccount = await env.DB.prepare("SELECT u.id FROM item_creators ic JOIN users u ON u.id=ic.creator_id WHERE ic.item_id=? LIMIT 1").bind(item.id).first();
    const payoutAccount = creatorAccount || await env.DB.prepare("SELECT id FROM users WHERE username='Admin' COLLATE NOCASE AND role='OWNER' AND is_banned=0 LIMIT 1").first();
    if (!payoutAccount) return fail("The site payment account is unavailable.",503);
    const purchaseId=id(), inventoryId=id();
    try {
      const results = await env.DB.batch([
        env.DB.prepare(`UPDATE items SET stock_sold=stock_sold+1 WHERE id=? AND is_for_sale=1 AND is_offsale=0 AND (stock_limit=0 OR stock_sold<stock_limit) AND EXISTS (SELECT 1 FROM users WHERE id=? AND ${walletColumn}>=?) AND NOT EXISTS (SELECT 1 FROM inventory WHERE user_id=? AND item_id=?) AND EXISTS (SELECT 1 FROM users WHERE id=?)`).bind(item.id,user.id,price,user.id,item.id,payoutAccount.id),
        env.DB.prepare(`UPDATE users SET ${walletColumn}=${walletColumn}-? WHERE id=? AND ${walletColumn}>=? AND changes()=1`).bind(price,user.id,price),
        // Creator-made Shirts and Pants pay their attributed creator; ordinary catalog items still pay Admin.
        env.DB.prepare(`UPDATE users SET ${walletColumn}=${walletColumn}+? WHERE id=? AND changes()=1`).bind(price,payoutAccount.id),
        env.DB.prepare("INSERT INTO inventory (id,user_id,item_id) SELECT ?,?,? WHERE changes()=1").bind(inventoryId,user.id,item.id),
        env.DB.prepare("INSERT INTO purchases (id,user_id,item_id,price,currency) SELECT ?,?,?,?,? WHERE changes()=1").bind(purchaseId,user.id,item.id,price,currencyCode)
      ]);
      if (!results?.[0]?.meta?.changes) {
        const latest = await env.DB.prepare("SELECT stock_limit,stock_sold,is_for_sale,is_offsale FROM items WHERE id=?").bind(item.id).first();
        if (!latest || !latest.is_for_sale) return fail("This item is no longer in the catalog.",409);
        if (Number(latest.is_offsale) === 1) return fail("This item is Off Sale and cannot be purchased.",409);
        if (Number(latest.stock_limit)>0 && Number(latest.stock_sold)>=Number(latest.stock_limit)) return fail("This item is sold out.",409);
        if (await env.DB.prepare("SELECT id FROM inventory WHERE user_id=? AND item_id=?").bind(user.id,item.id).first()) return fail("You already own this item.",409);
        return fail("Not enough " + currencyCode + ".",409);
      }
      if (!results?.[1]?.meta?.changes||!results?.[2]?.meta?.changes||!results?.[3]?.meta?.changes||!results?.[4]?.meta?.changes) return fail("Purchase could not be completed. Please retry.",409);
    } catch (error) {
      console.error("[Sakura purchase] Purchase failed:",error);
      return fail("Purchase could not be completed.",400);
    }
    const updated = await env.DB.prepare("SELECT balance,tix_balance FROM users WHERE id=?").bind(user.id).first();
    return json({ok:true,balance:Number(updated?.balance||0),tixBalance:Number(updated?.tix_balance||0),currency:currencyCode});
  }

  if (request.method === "GET" && path === "/api/currency/history") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const rows = await env.DB.prepare("SELECT p.price,p.currency,p.purchased_at,i.name,i.category FROM purchases p JOIN items i ON i.id=p.item_id WHERE p.user_id=? ORDER BY p.purchased_at DESC LIMIT 50").bind(user.id).all();
    return json({ purchases:rows.results || [] });
  }

  if (request.method === "GET" && path === "/api/inventory") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const rows = await env.DB.prepare("SELECT i.id,i.name,i.description,i.category,i.price,i.currency,i.image_url,i.model_url,i.asset_id,i.asset_type_id,i.is_limited,i.is_offsale,i.stock_limit,i.stock_sold,r.id AS active_listing_id,r.price AS active_listing_price,CASE WHEN i.category='Accessories' THEN CASE WHEN i.model_url<>'' THEN '3D' ELSE '3D_MISSING' END ELSE 'IMAGE_ONLY' END AS asset_kind FROM inventory v JOIN items i ON i.id=v.item_id LEFT JOIN resale_listings r ON r.item_id=i.id AND r.seller_id=v.user_id AND r.status='ACTIVE' WHERE v.user_id=? ORDER BY v.purchased_at DESC").bind(user.id).all();
    return json({ items:rows.results || [] });
  }

  if (request.method === "POST" && path === "/api/inventory/sell") {
    return fail("Direct inventory selling is disabled. Create a player resale listing instead.",410);
  }

  const profileIdInventoryMatch = path.match(/^\/api\/profile\/id\/(\d{1,12})\/inventory$/);
  if (request.method === "GET" && profileIdInventoryMatch) {
    const profile = await env.DB.prepare("SELECT id FROM users WHERE public_id=? AND is_banned=0").bind(Number(profileIdInventoryMatch[1])).first();
    if (!profile) return fail("User not found.",404);
    const rows = await env.DB.prepare("SELECT i.id,i.name,i.description,i.category,i.price,i.currency,i.image_url,i.model_url,i.is_limited,i.is_offsale,i.stock_limit,i.stock_sold,CASE WHEN i.category='Accessories' THEN CASE WHEN i.model_url<>'' THEN '3D' ELSE '3D_MISSING' END ELSE 'IMAGE_ONLY' END AS asset_kind FROM inventory v JOIN items i ON i.id=v.item_id WHERE v.user_id=? ORDER BY v.purchased_at DESC").bind(profile.id).all();
    return json({ items:rows.results || [] });
  }

  const profileIdMatch = path.match(/^\/api\/profile\/id\/(\d{1,12})$/);
  if (request.method === "GET" && profileIdMatch) {
    const profile = await env.DB.prepare(`SELECT u.id,u.public_id,u.username,u.role,u.created_at,u.is_verified,p.description,(SELECT COALESCE(SUM(CASE
          WHEN rap_item.is_limited=1 AND COALESCE(rap_item.is_offsale,0)=0 AND rap_item.rap_currency='P$' AND rap_item.rap_value>0
          THEN MIN(rap_item.rap_value*2,COALESCE(
            (SELECT CAST(ROUND(AVG(recent_sales.price)) AS INTEGER)
             FROM (SELECT r.price FROM resale_listings r WHERE r.item_id=rap_item.id AND r.status='SOLD' ORDER BY r.sold_at DESC LIMIT 10) recent_sales),
            rap_item.rap_value))
          ELSE 0 END),0)
        FROM inventory rap_inventory JOIN items rap_item ON rap_item.id=rap_inventory.item_id
        WHERE rap_inventory.user_id=u.id) AS total_rap
      FROM users u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.public_id=? AND u.is_banned=0`).bind(Number(profileIdMatch[1])).first();
    if (!profile) return fail("User not found.",404);
    const [count,badgeRows] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS n FROM inventory WHERE user_id=?").bind(profile.id).first(),
      env.DB.prepare("SELECT badge_key FROM user_badges WHERE user_id=? ORDER BY created_at,badge_key").bind(profile.id).all()
    ]);
    return json({ profile:{id:profile.public_id,publicId:profile.public_id,username:profile.username,role:profile.role,createdAt:profile.created_at,description:profile.description||"",itemCount:count.n,totalRap:Number(profile.total_rap||0),isVerified:Boolean(profile.is_verified),badges:(badgeRows.results||[]).map(row=>row.badge_key)} });
  }

  const profileInventoryMatch = path.match(/^\/api\/profile\/([A-Za-z0-9_]{1,20})\/inventory$/);
  if (request.method === "GET" && profileInventoryMatch) {
    const username = profileInventoryMatch[1];
    const profile = await env.DB.prepare("SELECT id FROM users WHERE username=? COLLATE NOCASE AND is_banned=0").bind(username).first();
    if (!profile) return fail("User not found.",404);
    const rows = await env.DB.prepare("SELECT i.id,i.name,i.description,i.category,i.price,i.currency,i.image_url,i.model_url,i.is_limited,i.is_offsale,i.stock_limit,i.stock_sold,CASE WHEN i.category='Accessories' THEN CASE WHEN i.model_url<>'' THEN '3D' ELSE '3D_MISSING' END ELSE 'IMAGE_ONLY' END AS asset_kind FROM inventory v JOIN items i ON i.id=v.item_id WHERE v.user_id=? ORDER BY v.purchased_at DESC").bind(profile.id).all();
    return json({ items:rows.results || [] });
  }

  if (request.method === "GET" && path.startsWith("/api/avatar/thumbnail/")) {
    const match = path.match(/^\/api\/avatar\/thumbnail\/([0-9]{1,10})$/);
    if (!match) return fail("Invalid avatar id.",400);
    const publicId = Number(match[1]);
    const target = await env.DB.prepare("SELECT id,public_id FROM users WHERE public_id=? AND is_banned=0").bind(publicId).first();
    if (!target) return fail("Avatar not found.",404);
    const [itemRows,settings] = await Promise.all([env.DB.prepare("SELECT i.id,i.asset_id,i.asset_type_id,i.category FROM equipped_items e JOIN items i ON i.id=e.item_id WHERE e.user_id=? ORDER BY e.equipped_at DESC").bind(target.id).all(),loadAvatarSettings(env,target.id)]);
    const sourceHash = await digest(JSON.stringify({items:(itemRows.results||[]).map(item=>[item.id,item.asset_id,item.asset_type_id,item.category]),bodyColors:settings.bodyColors,rigType:settings.rigType,scales:settings.scales}));
    const cached = await env.DB.prepare("SELECT source_hash,thumbnail_data FROM avatar_render_cache WHERE user_id=?").bind(target.id).first();
    if (cached?.source_hash === sourceHash && cached.thumbnail_data) {
      const cachedBytes = cached.thumbnail_data instanceof Uint8Array ? cached.thumbnail_data : new Uint8Array(cached.thumbnail_data);
      if (cachedBytes.byteLength > 8) return new Response(cachedBytes,{status:200,headers:{"content-type":"image/png","cache-control":"public, max-age=300, s-maxage=300, stale-while-revalidate=3600","x-avatar-renderer":"OpenPekora-RCC"}});
    }
    const rendererBase = String(env.AVATAR_RENDERER_URL || "https://renderer.mopcblox.online").trim().replace(/\/+$/,"");
    if (!/^https:\/\//i.test(rendererBase)) return fail("Avatar renderer URL must use HTTPS.",503);
    const rendererSecret = String(env.AVATAR_RENDERER_SECRET || "").trim();
    if (!rendererSecret) return new Response("Avatar renderer secret is not configured in the Cloudflare Worker.",{status:503,headers:{"content-type":"text/plain; charset=utf-8","cache-control":"no-store"}});
    const rendererHeaders = {"content-type":"application/json","X-Pekora-Renderer-Secret":rendererSecret};
    if (env.AVATAR_RENDERER_ACCESS_ID && env.AVATAR_RENDERER_ACCESS_SECRET) {
      rendererHeaders["CF-Access-Client-Id"] = String(env.AVATAR_RENDERER_ACCESS_ID);
      rendererHeaders["CF-Access-Client-Secret"] = String(env.AVATAR_RENDERER_ACCESS_SECRET);
    }
    let rendererResponse;
    try {
      rendererResponse = await fetch(rendererBase+"/player/thumbnail",{
        method:"POST",
        headers:rendererHeaders,
        body:JSON.stringify({userId:publicId,jobExpiration:60}),
        signal:AbortSignal.timeout(90000)
      });
    } catch (error) {
      console.error("[Sakura avatar] Renderer connection failed:",error);
      return new Response("OpenPekora renderer is offline. Start the renderer and RCCService on the host PC.",{status:503,headers:{"content-type":"text/plain; charset=utf-8","cache-control":"no-store"}});
    }
    if (!rendererResponse.ok) {
      const detail=(await rendererResponse.text()).slice(0,500);
      const safeDetail=detail.replace(/(secret|token|authorization)(\\s*[:=]\\s*)[^,\\s"]+/gi,"$1$2[redacted]");
      console.error("[Sakura avatar] Renderer returned an error:",rendererResponse.status,safeDetail);
      return new Response("OpenPekora renderer returned HTTP "+rendererResponse.status+": "+(safeDetail || "No additional renderer details."),{status:502,headers:{"content-type":"text/plain; charset=utf-8","cache-control":"no-store","x-sakura-renderer-status":String(rendererResponse.status)}});
    }
    let rendererPayload;
    try { rendererPayload=await rendererResponse.json(); }
    catch { return new Response("OpenPekora renderer returned invalid JSON.",{status:502,headers:{"content-type":"text/plain; charset=utf-8","cache-control":"no-store"}}); }
    const encoded=typeof rendererPayload?.data==="string"?rendererPayload.data:
      typeof rendererPayload?.data?.data==="string"?rendererPayload.data.data:null;
    if (!rendererPayload?.success || !encoded || encoded.length>8*1024*1024) {
      console.error("[Sakura avatar] Renderer response did not contain a valid PNG.");
      return new Response("OpenPekora renderer did not return an avatar image. Check avatar-fetch and RCC logs.",{status:502,headers:{"content-type":"text/plain; charset=utf-8","cache-control":"no-store"}});
    }
    let imageBytes;
    try {
      const binary=atob(encoded.replace(/\s/g,""));
      if (binary.length<8 || binary.length>6*1024*1024) throw new Error("PNG size is outside the allowed range.");
      imageBytes=new Uint8Array(binary.length);
      for(let i=0;i<binary.length;i++) imageBytes[i]=binary.charCodeAt(i);
      if (imageBytes[0]!==137 || imageBytes[1]!==80 || imageBytes[2]!==78 || imageBytes[3]!==71) throw new Error("Renderer data is not a PNG image.");
    } catch (error) {
      console.error("[Sakura avatar] Invalid renderer image:",error);
      return new Response("OpenPekora renderer returned an invalid image.",{status:502,headers:{"content-type":"text/plain; charset=utf-8","cache-control":"no-store"}});
    }
    if (imageBytes.byteLength<=1500000) {
      await env.DB.prepare("INSERT INTO avatar_render_cache (user_id,source_hash,thumbnail_data,rendered_at) VALUES (?,?,?,datetime('now')) ON CONFLICT(user_id) DO UPDATE SET source_hash=excluded.source_hash,thumbnail_data=excluded.thumbnail_data,rendered_at=excluded.rendered_at")
        .bind(target.id,sourceHash,imageBytes).run();
    }
    return new Response(imageBytes,{status:200,headers:{"content-type":"image/png","cache-control":"public, max-age=300, s-maxage=300","x-avatar-renderer":"OpenPekora-RCC"}});
  }

  if (path === "/api/avatar" && request.method === "GET") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const [rows,settings] = await Promise.all([env.DB.prepare("SELECT i.id,i.name,i.category,i.image_url,i.model_url,i.asset_id,i.asset_type_id FROM equipped_items e JOIN items i ON i.id=e.item_id WHERE e.user_id=? ORDER BY e.equipped_at DESC").bind(user.id).all(),loadAvatarSettings(env,user.id)]);
    return json({enabled:true,equipped:rows.results||[],...settings});
  }


  if (path === "/api/avatar" && request.method === "PUT") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const data = await body(request);
    if (!data || typeof data !== "object" || Array.isArray(data)) return fail("Invalid avatar update.");
    const action = String(data.action||"");
    const settings = await loadAvatarSettings(env,user.id);

    if (action === "colors") {
      if (!data.bodyColors || typeof data.bodyColors !== "object" || Array.isArray(data.bodyColors)) return fail("Choose a valid body color.");
      const next = {...settings.bodyColors};
      for (const [key,value] of Object.entries(data.bodyColors)) {
        const colorId = Number(value);
        if (!AVATAR_COLOR_KEYS.includes(key) || !Number.isSafeInteger(colorId) || !AVATAR_COLOR_IDS.has(colorId)) return fail("Choose a skin tone from the Sakura palette.");
        next[key] = colorId;
      }
      settings.bodyColors = next;
      await saveAvatarSettings(env,user.id,settings);
      return json({ok:true,bodyColors:settings.bodyColors});
    }

    if (action === "rig") {
      if (!["R6","R15"].includes(data.rigType)) return fail("Choose R6 or R15.");
      settings.rigType = data.rigType;
      await saveAvatarSettings(env,user.id,settings);
      return json({ok:true,rigType:settings.rigType});
    }

    if (action === "scales") {
      const ranges = {height:[0.9,1.05],width:[0.7,1],head:[0.95,1],depth:[0.7,1],proportion:[0,1],bodyType:[0,1]};
      const next = {...settings.scales};
      for (const [key,value] of Object.entries(data.scales||{})) {
        const range=ranges[key],number=Number(value);
        if (!range || !Number.isFinite(number) || number<range[0] || number>range[1]) return fail("Avatar scale is outside the allowed range.");
        next[key]=Math.round(number*100)/100;
      }
      settings.scales = next;
      await saveAvatarSettings(env,user.id,settings);
      return json({ok:true,scales:settings.scales});
    }

    const itemId = String(data.itemId||"");
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(itemId) || !["wear","remove"].includes(action)) return fail("Choose an inventory item and a valid avatar action.");
    const item = await env.DB.prepare("SELECT i.id,i.category,i.asset_id FROM inventory v JOIN items i ON i.id=v.item_id WHERE v.user_id=? AND i.id=?").bind(user.id,itemId).first();
    if (!item) return fail("You can only equip items in your inventory.",404);
    if (!["Hats","Hair","Faces","Shirts","Pants","Accessories"].includes(item.category)) return fail("This item category cannot be equipped on the avatar.");
    if (action === "remove") {
      await env.DB.prepare("DELETE FROM equipped_items WHERE user_id=? AND item_id=?").bind(user.id,itemId).run();
      return json({ok:true,action,equipped:false});
    }
    if (!Number(item.asset_id||0)) return fail("This item has no Roblox asset ID, so the 3D renderer cannot equip it.",409);
    const statements = [];
    if (["Hair","Faces","Shirts","Pants"].includes(item.category)) {
      statements.push(env.DB.prepare("DELETE FROM equipped_items WHERE user_id=? AND category=?").bind(user.id,item.category));
    }
    statements.push(env.DB.prepare("INSERT OR IGNORE INTO equipped_items (user_id,item_id,category) VALUES (?,?,?)").bind(user.id,item.id,item.category));
    await env.DB.batch(statements);
    return json({ok:true,action,equipped:true});
  }

  if (request.method === "GET" && path.startsWith("/api/banned-account/")) {
    let identifier;
    try { identifier = decodeURIComponent(path.slice("/api/banned-account/".length)); }
    catch { return fail("Invalid account identifier.",400); }
    if (!identifier || identifier.length>32) return fail("Invalid account identifier.",400);
    const numericId = /^\d+$/.test(identifier) && Number.isSafeInteger(Number(identifier)) ? Number(identifier) : -1;
    const account = await env.DB.prepare(`SELECT u.public_id,u.username,u.role,u.created_at,
        COALESCE(u.banned_at,(SELECT created_at FROM owner_audit_log WHERE target_user_id=u.id AND action='BAN' ORDER BY created_at DESC LIMIT 1)) AS banned_at,
        COALESCE(NULLIF(u.ban_reason,''),(SELECT details FROM owner_audit_log WHERE target_user_id=u.id AND action='BAN' ORDER BY created_at DESC LIMIT 1),'Account banned by Sakura moderation') AS ban_reason
      FROM users u WHERE u.is_banned=1 AND (u.username=? COLLATE NOCASE OR u.public_id=?)`).bind(identifier,numericId).first();
    if (!account) return fail("This account is not currently banned or could not be found.",404);
    return json({account:{...account,status:"BANNED"}});
  }

  if (request.method === "GET" && path.startsWith("/api/profile/")) {
    let username;
    try { username = decodeURIComponent(path.slice("/api/profile/".length)); }
    catch { return fail("Invalid username.",400); }
    const profile = await env.DB.prepare(`SELECT u.id,u.public_id,u.username,u.role,u.created_at,u.is_verified,p.description,(SELECT COALESCE(SUM(rap_item.price),0) FROM inventory rap_inventory JOIN items rap_item ON rap_item.id=rap_inventory.item_id WHERE rap_inventory.user_id=u.id AND rap_item.is_limited=1 AND COALESCE(rap_item.is_offsale,0)=0 AND COALESCE(rap_item.base_currency,rap_item.currency,'P$')='P$') AS total_rap
      FROM users u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.username=? COLLATE NOCASE AND u.is_banned=0`).bind(username).first();
    if (!profile) return fail("User not found.",404);
    const [count,badgeRows] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS n FROM inventory WHERE user_id=?").bind(profile.id).first(),
      env.DB.prepare("SELECT badge_key FROM user_badges WHERE user_id=? ORDER BY created_at,badge_key").bind(profile.id).all()
    ]);
    return json({ profile:{id:profile.public_id,publicId:profile.public_id,username:profile.username,role:profile.role,createdAt:profile.created_at,description:profile.description||"",itemCount:count.n,totalRap:Number(profile.total_rap||0),isVerified:Boolean(profile.is_verified),badges:(badgeRows.results||[]).map(row=>row.badge_key)} });
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
      env.DB.prepare("SELECT u.username,u.role,u.public_id,u.is_verified FROM friends f JOIN users u ON u.id=f.friend_id WHERE f.user_id=? AND f.status='ACCEPTED' AND u.is_banned=0 UNION SELECT u.username,u.role,u.public_id,u.is_verified FROM friends f JOIN users u ON u.id=f.user_id WHERE f.friend_id=? AND f.status='ACCEPTED' AND u.is_banned=0 ORDER BY username").bind(user.id,user.id).all(),
      env.DB.prepare("SELECT u.username,u.role,u.public_id,u.is_verified FROM friends f JOIN users u ON u.id=f.user_id WHERE f.friend_id=? AND f.status='PENDING' AND u.is_banned=0 ORDER BY u.username").bind(user.id).all(),
      env.DB.prepare("SELECT u.username,u.role,u.public_id,u.is_verified FROM friends f JOIN users u ON u.id=f.friend_id WHERE f.user_id=? AND f.status='PENDING' AND u.is_banned=0 ORDER BY u.username").bind(user.id).all()
    ]);
    return json({ friends:accepted.results||[],incoming:incoming.results||[],outgoing:outgoing.results||[] });
  }

  if (request.method === "GET" && path === "/api/friends/status") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const username = (url.searchParams.get("username")||"").trim();
    if (!/^[A-Za-z0-9_]{1,20}$/.test(username)) return fail("Enter a valid username.");
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
    if (!/^[A-Za-z0-9_]{1,20}$/.test(username)) return fail("Enter a valid username.");
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
    if (!/^[A-Za-z0-9_]{1,20}$/.test(username)) return fail("Enter a valid username.");
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
    if (!/^[A-Za-z0-9_]{1,20}$/.test(username)) return fail("Enter a valid username.");
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

  if (path === "/api/owner/groups" || path.startsWith("/api/owner/groups/")) {
    const actor = await requireUser(request,env);
    if (!actor) return fail("Please sign in.",401);
    if (actor.role !== "OWNER") return fail("Owner access required.",403);
    if (path === "/api/owner/groups" && request.method === "GET") {
      const rows = await env.DB.prepare(`SELECT g.id,g.name,g.is_verified,g.created_at,u.username AS owner_name,
        COUNT(m.user_id) AS member_count
        FROM sakura_groups g JOIN users u ON u.id=g.owner_id
        LEFT JOIN group_members m ON m.group_id=g.id
        GROUP BY g.id ORDER BY g.created_at DESC,g.name LIMIT 200`).all();
      return json({groups:rows.results||[]});
    }
    const match = path.match(/^\/api\/owner\/groups\/([A-Za-z0-9-]+)$/);
    if (!match || request.method !== "POST") return fail("Unsupported group verification action.",405);
    const groupId = match[1];
    const group = await env.DB.prepare("SELECT id,name,owner_id,is_verified FROM sakura_groups WHERE id=?").bind(groupId).first();
    if (!group) return fail("Group not found.",404);
    const data = await body(request);
    const action = String(data?.action||"");
    if (!["verify","unverify"].includes(action)) return fail("Choose verify or unverify.");
    const verified = action==="verify" ? 1 : 0;
    await env.DB.batch([
      env.DB.prepare("UPDATE sakura_groups SET is_verified=? WHERE id=?").bind(verified,groupId),
      env.DB.prepare("INSERT INTO owner_audit_log (id,actor_id,target_user_id,action,details) VALUES (?,?,?,?,?)").bind(id(),actor.id,group.owner_id,verified?"GROUP_VERIFIED":"GROUP_UNVERIFIED",group.name+" ("+group.id+")")
    ]);
    return json({ok:true,is_verified:verified});
  }

  if (path.startsWith("/api/owner/badges/")) {
    const actor=await requireUser(request,env);
    if(!actor)return fail("Please sign in.",401);
    if(actor.role!=="OWNER")return fail("Owner access required.",403);
    const targetId=path.slice("/api/owner/badges/".length);
    if(!/^[A-Za-z0-9-]{1,80}$/.test(targetId))return fail("Invalid user ID.");
    const target=await env.DB.prepare("SELECT id FROM users WHERE id=?").bind(targetId).first();
    if(!target)return fail("User not found.",404);
    if(request.method!=="POST")return fail("Unsupported badge action.",405);
    const data=await body(request),action=String(data?.action||""),badgeKey=String(data?.badgeKey||"");
    if(!["grant_badge","revoke_badge"].includes(action))return fail("Choose a valid badge action.");
    if(badgeKey==="VERIFIED"){
      const verified=action==="grant_badge"?1:0;
      await env.DB.prepare("UPDATE users SET is_verified=? WHERE id=?").bind(verified,targetId).run();
    }else{
      if(!USER_BADGE_KEYS.includes(badgeKey))return fail("Choose a valid badge.");
      if(action==="grant_badge")await env.DB.prepare("INSERT OR IGNORE INTO user_badges (user_id,badge_key,granted_by) VALUES (?,?,?)").bind(targetId,badgeKey,actor.id).run();
      else await env.DB.prepare("DELETE FROM user_badges WHERE user_id=? AND badge_key=?").bind(targetId,badgeKey).run();
    }
    const label=badgeKey==="VERIFIED"?"Verified":USER_BADGE_LABELS[badgeKey];
    await env.DB.prepare("INSERT INTO owner_audit_log (id,actor_id,target_user_id,action,details) VALUES (?,?,?,?,?)").bind(id(),actor.id,targetId,action==="grant_badge"?"BADGE_GRANTED":"BADGE_REVOKED",label).run();
    const [user,badges]=await Promise.all([
      env.DB.prepare("SELECT id,username,public_id,role,is_verified,EXISTS(SELECT 1 FROM user_badges ub WHERE ub.user_id=users.id AND ub.badge_key='ASSET_MODERATOR') AS is_asset_moderator FROM users WHERE id=?").bind(targetId).first(),
      env.DB.prepare("SELECT badge_key FROM user_badges WHERE user_id=? ORDER BY created_at,badge_key").bind(targetId).all()
    ]);
    return json({ok:true,user:{...user,badges:(badges.results||[]).map(row=>row.badge_key)}});
  }

  if (path.startsWith("/api/owner/users")) {
    const actor = await requireUser(request,env);
    if (!actor) return fail("Please sign in.",401);
    if (actor.role !== "OWNER") return fail("Owner access required.",403);

    if (path === "/api/owner/users" && request.method === "GET") {
      const q = (url.searchParams.get("q") || "").trim().slice(0,32);
      if (q.length < 1) return json({users:[]});
      const numericId = /^\d+$/.test(q) && Number.isSafeInteger(Number(q)) ? Number(q) : -1;
      const rows = await env.DB.prepare(`SELECT id,public_id,username,role,balance,tix_balance,created_at,is_banned,is_verified,banned_at,ban_reason FROM users
        WHERE instr(lower(username),lower(?))>0 OR id=? OR public_id=? ORDER BY username LIMIT 30`).bind(q,q,numericId).all();
      return json({users:rows.results||[]});
    }

    const userMatch = path.match(/^\/api\/owner\/users\/([A-Za-z0-9-]+)$/);
    if (!userMatch) return fail("User not found.",404);
    const targetId = userMatch[1];
    const target = await env.DB.prepare("SELECT id,public_id,username,role,balance,tix_balance,created_at,is_banned,is_verified,banned_at,ban_reason FROM users WHERE id=?").bind(targetId).first();
    if (!target) return fail("User not found.",404);

    if (request.method === "GET") {
      const [warnings,logs,badgeRows] = await Promise.all([
        env.DB.prepare("SELECT id,reason,created_at,acknowledged FROM moderation_warnings WHERE user_id=? ORDER BY created_at DESC LIMIT 20").bind(targetId).all(),
        env.DB.prepare("SELECT action,details,created_at FROM owner_audit_log WHERE target_user_id=? ORDER BY created_at DESC LIMIT 20").bind(targetId).all(),
        env.DB.prepare("SELECT badge_key FROM user_badges WHERE user_id=? ORDER BY created_at,badge_key").bind(targetId).all()
      ]);
      return json({user:{...target,badges:(badgeRows.results||[]).map(row=>row.badge_key)},warnings:warnings.results||[],logs:logs.results||[]});
    }

    if (request.method !== "POST") return fail("Unsupported user management action.",405);
    if (target.role === "OWNER") return fail("Owner accounts cannot be modified from user management.",403);
    const data = await body(request);
    const action = String(data?.action||"");
    const details = String(data?.reason||"").trim().slice(0,500);
    if (action === "credit") {
      const amount = Number(data?.amount);
      const currencyCode = data?.currency === "Tix" ? "Tix" : "P$";
      const walletColumn = currencyCode === "Tix" ? "tix_balance" : "balance";
      if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000) return fail("Enter an amount from 1 to 1,000,000 " + currencyCode + ".");
      const result = await env.DB.prepare(`UPDATE users SET ${walletColumn}=${walletColumn}+? WHERE id=? AND ${walletColumn}<=1000000000-?`).bind(amount,targetId,amount).run();
      if (!result?.meta?.changes) return fail("Could not add " + currencyCode + ". The balance limit may have been reached.",409);
      await env.DB.prepare("INSERT INTO owner_audit_log (id,actor_id,target_user_id,action,details) VALUES (?,?,?,?,?)").bind(id(),actor.id,targetId,"CURRENCY_CREDIT",amount+" "+currencyCode+(details?" — "+details:"")).run();
    } else if (action === "verify" || action === "unverify") {
      const verified = action === "verify" ? 1 : 0;
      await env.DB.batch([
        env.DB.prepare("UPDATE users SET is_verified=? WHERE id=?").bind(verified,targetId),
        env.DB.prepare("INSERT INTO owner_audit_log (id,actor_id,target_user_id,action,details) VALUES (?,?,?,?,?)").bind(id(),actor.id,targetId,action.toUpperCase(),verified ? "Verified badge granted" : "Verified badge removed")
      ]);
    } else if (action === "set_public_id") {
      const publicId = Number(data?.publicId);
      if (!Number.isSafeInteger(publicId) || publicId < 1 || publicId > 2147483647) return fail("User ID must be a whole number from 1 to 2,147,483,647.");
      const results = await env.DB.batch([
        env.DB.prepare("UPDATE users SET public_id=? WHERE id=? AND NOT EXISTS (SELECT 1 FROM users WHERE public_id=? AND id<>?)").bind(publicId,targetId,publicId,targetId),
        env.DB.prepare("INSERT INTO owner_audit_log (id,actor_id,target_user_id,action,details) SELECT ?,?,?,?,? WHERE changes()=1").bind(id(),actor.id,targetId,"PUBLIC_ID_CHANGE","User ID changed to "+publicId)
      ]);
      if (!results?.[0]?.meta?.changes) return fail("That User ID is already assigned to another player.",409);
    } else if (action === "warn") {
      if (details.length < 3) return fail("Enter a warning reason (at least 3 characters).");
      await env.DB.batch([
        env.DB.prepare("INSERT INTO moderation_warnings (id,user_id,moderator_id,reason) VALUES (?,?,?,?)").bind(id(),targetId,actor.id,details),
        env.DB.prepare("INSERT INTO owner_audit_log (id,actor_id,target_user_id,action,details) VALUES (?,?,?,?,?)").bind(id(),actor.id,targetId,"WARNING",details)
      ]);
    } else if (action === "ban" || action === "unban") {
      if (action === "ban" && details.length < 3) return fail("Enter a ban reason (at least 3 characters).");
      await env.DB.batch([
        env.DB.prepare("UPDATE users SET is_banned=?,banned_at=CASE WHEN ?=1 THEN datetime('now') ELSE NULL END,ban_reason=CASE WHEN ?=1 THEN ? ELSE '' END WHERE id=?").bind(action==="ban"?1:0,action==="ban"?1:0,action==="ban"?1:0,details,targetId),
        ...(action==="ban"?[env.DB.prepare("INSERT OR REPLACE INTO banned_session_notices (token_hash,user_id,expires_at) SELECT token_hash,user_id,expires_at FROM sessions WHERE user_id=?").bind(targetId)]:[]),
        ...(action==="ban"?[env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(targetId)]:[]),
        ...(action==="unban"?[env.DB.prepare("DELETE FROM banned_session_notices WHERE user_id=?").bind(targetId),env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(targetId)]:[]),
        env.DB.prepare("INSERT INTO owner_audit_log (id,actor_id,target_user_id,action,details) VALUES (?,?,?,?,?)").bind(id(),actor.id,targetId,action.toUpperCase(),details)
      ]);
    } else {
      return fail("Unknown user management action.");
    }
    const updated = await env.DB.prepare("SELECT id,public_id,username,role,balance,tix_balance,created_at,is_banned,is_verified,banned_at,ban_reason FROM users WHERE id=?").bind(targetId).first();
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

  const groupAvatarUploadMatch = path.match(/^\/api\/groups\/([A-Za-z0-9-]+)\/avatar$/);
  if (groupAvatarUploadMatch && request.method === "PUT") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const groupId = groupAvatarUploadMatch[1];
    const group = await env.DB.prepare("SELECT id,owner_id FROM sakura_groups WHERE id=?").bind(groupId).first();
    if (!group) return fail("Group not found.",404);
    if (group.owner_id !== user.id) return fail("Only the group owner can change its image.",403);
    const maxBytes = 2 * 1024 * 1024;
    const length = Number(request.headers.get("content-length")||0);
    if (length > maxBytes) return fail("Group image must be 2 MB or smaller.",413);
    const contentType = (request.headers.get("content-type")||"").toLowerCase().split(";")[0].trim();
    if (!["image/png","image/jpeg","image/webp"].includes(contentType)) return fail("Choose a PNG, JPG or WebP image.",415);
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > maxBytes) return fail("Group image must be between 1 byte and 2 MB.",413);
    const png = bytes.length>=8 && bytes[0]===0x89 && bytes[1]===0x50 && bytes[2]===0x4e && bytes[3]===0x47 && bytes[4]===0x0d && bytes[5]===0x0a && bytes[6]===0x1a && bytes[7]===0x0a;
    const jpeg = bytes.length>=3 && bytes[0]===0xff && bytes[1]===0xd8 && bytes[2]===0xff;
    const webp = bytes.length>=12 && bytes[0]===0x52 && bytes[1]===0x49 && bytes[2]===0x46 && bytes[3]===0x46 && bytes[8]===0x57 && bytes[9]===0x45 && bytes[10]===0x42 && bytes[11]===0x50;
    if (!((contentType==="image/png"&&png)||(contentType==="image/jpeg"&&jpeg)||(contentType==="image/webp"&&webp))) return fail("The selected file does not match its image format.",415);
    const imageId=id();
    const imageUrl="/api/group-images/"+imageId;
    await env.DB.batch([
      env.DB.prepare("DELETE FROM group_image_files WHERE group_id=?").bind(groupId),
      env.DB.prepare("INSERT INTO group_image_files (id,group_id,image_data,content_type) VALUES (?,?,?,?)").bind(imageId,groupId,bytes,contentType),
      env.DB.prepare("UPDATE sakura_groups SET avatar_url=? WHERE id=? AND owner_id=?").bind(imageUrl,groupId,user.id)
    ]);
    return json({ok:true,avatar_url:imageUrl});
  }
  if (groupAvatarUploadMatch && request.method === "DELETE") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const groupId = groupAvatarUploadMatch[1];
    const group = await env.DB.prepare("SELECT owner_id FROM sakura_groups WHERE id=?").bind(groupId).first();
    if (!group) return fail("Group not found.",404);
    if (group.owner_id !== user.id) return fail("Only the group owner can remove its image.",403);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM group_image_files WHERE group_id=?").bind(groupId),
      env.DB.prepare("UPDATE sakura_groups SET avatar_url='' WHERE id=? AND owner_id=?").bind(groupId,user.id)
    ]);
    return json({ok:true});
  }
  const groupImageMatch = path.match(/^\/api\/group-images\/([A-Za-z0-9-]+)$/);
  if (groupImageMatch && request.method === "GET") {
    const image = await env.DB.prepare("SELECT image_data,content_type FROM group_image_files WHERE id=?").bind(groupImageMatch[1]).first();
    if (!image?.image_data) return fail("Group image not found.",404);

    // D1 returns BLOB values as number arrays, not as a Response-compatible body.
    const storedImage = image.image_data;
    let imageBytes;
    if (Array.isArray(storedImage)) {
      imageBytes = Uint8Array.from(storedImage);
    } else if (storedImage instanceof ArrayBuffer) {
      imageBytes = new Uint8Array(storedImage);
    } else if (ArrayBuffer.isView(storedImage)) {
      imageBytes = new Uint8Array(storedImage.buffer.slice(
        storedImage.byteOffset,
        storedImage.byteOffset + storedImage.byteLength
      ));
    } else {
      return fail("Group image data is invalid.",500);
    }

    if (!imageBytes.byteLength) return fail("Group image not found.",404);
    return new Response(imageBytes,{headers:{
      "content-type":image.content_type||"application/octet-stream",
      "content-length":String(imageBytes.byteLength),
      "cache-control":"public, max-age=3600",
      "x-content-type-options":"nosniff"
    }});
  }

  const groupDetailMatch = path.match(/^\/api\/groups\/([A-Za-z0-9-]+)$/);
  if (groupDetailMatch && request.method === "GET") {
    const viewer = await currentUser(request,env);
    const groupId = groupDetailMatch[1];
    const group = await env.DB.prepare(`SELECT g.id,g.name,g.description,g.avatar_url,g.is_verified,g.created_at,g.owner_id,
        u.username AS owner_name,u.public_id AS owner_public_id,
        COUNT(m.user_id) AS member_count,
        MAX(CASE WHEN m.user_id=? THEN 1 ELSE 0 END) AS is_member,
        MAX(CASE WHEN g.owner_id=? THEN 1 ELSE 0 END) AS is_owner
      FROM sakura_groups g JOIN users u ON u.id=g.owner_id
      LEFT JOIN group_members m ON m.group_id=g.id
      WHERE g.id=? GROUP BY g.id`).bind(viewer?.id||"",viewer?.id||"",groupId).first();
    if (!group) return fail("Group not found.",404);
    const members = await env.DB.prepare(`SELECT u.username,u.public_id,u.role AS account_role,m.role AS group_role,m.joined_at
      FROM group_members m JOIN users u ON u.id=m.user_id
      WHERE m.group_id=? AND u.is_banned=0
      ORDER BY CASE WHEN m.role='OWNER' THEN 0 ELSE 1 END,u.username`).bind(groupId).all();
    return json({group,members:members.results||[]});
  }

  if (groupDetailMatch && request.method === "PATCH") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const groupId = groupDetailMatch[1];
    const existing = await env.DB.prepare("SELECT id,name,description,owner_id FROM sakura_groups WHERE id=?").bind(groupId).first();
    if (!existing) return fail("Group not found.",404);
    if (existing.owner_id !== user.id) return fail("Only the group owner can edit these settings.",403);
    const data = await body(request);
    const name = String(data?.name ?? existing.name).trim();
    const description = String(data?.description ?? existing.description).trim();
    if (!/^[a-z0-9а-яёіїєґ _.-]{3,32}$/i.test(name)) return fail("Group names must be 3–32 characters.");
    if (description.length>300) return fail("Group description must be 300 characters or less.");
    const duplicate = await env.DB.prepare("SELECT id FROM sakura_groups WHERE name=? COLLATE NOCASE AND id<>?").bind(name,groupId).first();
    if (duplicate) return fail("A group with this name already exists.",409);
    await env.DB.prepare("UPDATE sakura_groups SET name=?,description=? WHERE id=? AND owner_id=?").bind(name,description,groupId,user.id).run();
    return json({ok:true});
  }

  if (groupDetailMatch && request.method === "DELETE") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const groupId = groupDetailMatch[1];
    const result = await env.DB.prepare("DELETE FROM sakura_groups WHERE id=? AND owner_id=?").bind(groupId,user.id).run();
    if (!result?.meta?.changes) {
      const exists = await env.DB.prepare("SELECT id FROM sakura_groups WHERE id=?").bind(groupId).first();
      return exists ? fail("Only the group owner can delete this group.",403) : fail("Group not found.",404);
    }
    return json({ok:true});
  }

  if (path === "/api/groups" && request.method === "GET") {
    const viewer = await currentUser(request,env);
    const rows = await env.DB.prepare(`SELECT g.id,g.name,g.description,g.avatar_url,g.is_verified,g.created_at,u.username AS owner_name,
      COUNT(m.user_id) AS member_count,
      MAX(CASE WHEN m.user_id=? THEN 1 ELSE 0 END) AS is_member
      FROM sakura_groups g JOIN users u ON u.id=g.owner_id
      LEFT JOIN group_members m ON m.group_id=g.id
      GROUP BY g.id ORDER BY g.created_at DESC,g.name LIMIT 100`).bind(viewer?.id||"").all();
    return json({groups:rows.results||[]});
  }

  if (path === "/api/groups" && request.method === "POST") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in to create a group.",401);
    const data = await body(request);
    const name = String(data?.name||"").trim();
    const description = String(data?.description||"").trim();
    if (!/^[a-z0-9а-яёіїєґ _.-]{3,32}$/i.test(name)) return fail("New group names must be 3–32 characters and use letters, numbers, spaces, dots, underscores or hyphens.");
    if (description.length>300) return fail("Group description must be 300 characters or less.");
    const admin = await env.DB.prepare("SELECT id FROM users WHERE username='Admin' COLLATE NOCASE AND is_banned=0").first();
    if (!admin) return fail("Group creation is temporarily unavailable. Please try again later.",503);
    const duplicate = await env.DB.prepare("SELECT id FROM sakura_groups WHERE name=? COLLATE NOCASE").bind(name).first();
    if (duplicate) return fail("A group with this name already exists.",409);
    if (Number(user.balance)<100) return fail("Creating a group costs 100 P$.",400);

    const groupId = id();
    try {
      const results = await env.DB.batch([
        env.DB.prepare("INSERT INTO sakura_groups (id,name,description,owner_id) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM users WHERE id=? AND balance>=100) AND EXISTS (SELECT 1 FROM users WHERE id=?) AND NOT EXISTS (SELECT 1 FROM sakura_groups WHERE name=? COLLATE NOCASE)").bind(groupId,name,description,user.id,user.id,admin.id,name),
        env.DB.prepare("UPDATE users SET balance=balance-100 WHERE id=? AND balance>=100 AND changes()=1").bind(user.id),
        env.DB.prepare("UPDATE users SET balance=balance+100 WHERE id=? AND changes()=1").bind(admin.id),
        env.DB.prepare("INSERT INTO group_members (group_id,user_id,role) SELECT ?,?,'OWNER' WHERE changes()=1").bind(groupId,user.id)
      ]);
      if (!results?.[0]?.meta?.changes) return fail("Group name is already taken or the group could not be created.",409);
      if (!results?.[1]?.meta?.changes || !results?.[2]?.meta?.changes || !results?.[3]?.meta?.changes || !results?.[4]?.meta?.changes) {
        console.error("[Sakura groups] Group payment transaction did not complete.");
        return fail("Group creation could not be completed. Please try again.",500);
      }
    } catch (error) {
      console.error("[Sakura groups] Group creation failed:",error);
      return fail("A group with this name may already exist. Please try another name.",409);
    }
    const updated = await env.DB.prepare("SELECT balance FROM users WHERE id=?").bind(user.id).first();
    const group = await env.DB.prepare("SELECT g.id,g.name,g.description,g.avatar_url,g.is_verified,g.created_at,u.username AS owner_name,1 AS member_count,1 AS is_member FROM sakura_groups g JOIN users u ON u.id=g.owner_id WHERE g.id=?").bind(groupId).first();
    return json({ok:true,balance:Number(updated?.balance||0),group},201);
  }

  const groupJoinPrefix = "/api/groups/";
  if (path.startsWith(groupJoinPrefix) && path.endsWith("/join") && request.method === "POST") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in to join a group.",401);
    const groupId = path.slice(groupJoinPrefix.length,-5);
    if (!/^[A-Za-z0-9-]{1,80}$/.test(groupId)) return fail("Invalid group.");
    const group = await env.DB.prepare("SELECT id FROM sakura_groups WHERE id=?").bind(groupId).first();
    if (!group) return fail("Group not found.",404);
    const result = await env.DB.prepare("INSERT OR IGNORE INTO group_members (group_id,user_id,role) VALUES (?,?, 'MEMBER')").bind(group.id,user.id).run();
    return json({ok:true,joined:Boolean(result?.meta?.changes)});
  }
  const groupLeaveMatch = path.match(/^\/api\/groups\/([A-Za-z0-9-]+)\/leave$/);
  if (groupLeaveMatch && request.method === "DELETE") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const groupId = groupLeaveMatch[1];
    const group = await env.DB.prepare("SELECT owner_id FROM sakura_groups WHERE id=?").bind(groupId).first();
    if (!group) return fail("Group not found.",404);
    if (group.owner_id === user.id) return fail("The owner cannot leave their own group. Delete it from group settings instead.",409);
    await env.DB.prepare("DELETE FROM group_members WHERE group_id=? AND user_id=?").bind(groupId,user.id).run();
    return json({ok:true});
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
        const found=await env.DB.prepare(`SELECT i.id,i.name,i.category,i.image_url,i.price,i.currency,i.is_limited,i.is_offsale FROM items i WHERE i.id IN (${marks})`).bind(...ids).all();
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
      const rows=await env.DB.prepare(`SELECT v.item_id FROM inventory v JOIN items i ON i.id=v.item_id WHERE v.user_id=? AND (i.is_limited=1 OR i.is_offsale=1) AND NOT EXISTS (SELECT 1 FROM resale_listings rl WHERE rl.item_id=v.item_id AND rl.seller_id=v.user_id AND rl.status='ACTIVE') AND v.item_id IN (${marks})`).bind(ownerId,...ids).all();
      return (rows.results||[]).length===ids.length;
    };
    if(!(await checkOwned(user.id,offered)))return fail("You can only offer Limited or Off Sale items that are in your inventory.",409);
    if(!(await checkOwned(recipient.id,requested)))return fail("You can only request Limited or Off Sale items that are in that player's inventory.",409);
    // Duplicate Limited/Off Sale items are allowed in trades so users can send gifts.
    const tradeId=id();
    const statements=[env.DB.prepare("INSERT INTO trades (id,sender_id,recipient_id,offered_items,requested_items) VALUES (?,?,?,?,?)").bind(tradeId,user.id,recipient.id,JSON.stringify(offered),JSON.stringify(requested))];
    for(const itemId of offered) statements.push(env.DB.prepare("INSERT INTO trade_locks (owner_id,item_id,trade_id) SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM resale_listings WHERE seller_id=? AND item_id=? AND status='ACTIVE')").bind(user.id,itemId,tradeId,user.id,itemId));
    for(const itemId of requested) statements.push(env.DB.prepare("INSERT INTO trade_locks (owner_id,item_id,trade_id) SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM resale_listings WHERE seller_id=? AND item_id=? AND status='ACTIVE')").bind(recipient.id,itemId,tradeId,recipient.id,itemId));
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
        const rows=await env.DB.prepare(`SELECT v.item_id FROM inventory v JOIN items i ON i.id=v.item_id WHERE v.user_id=? AND (i.is_limited=1 OR i.is_offsale=1) AND NOT EXISTS (SELECT 1 FROM resale_listings rl WHERE rl.item_id=v.item_id AND rl.seller_id=v.user_id AND rl.status='ACTIVE') AND v.item_id IN (${marks})`).bind(ownerId,...ids).all();
        return (rows.results||[]).length===ids.length;
      };
      if(!(await owned(trade.sender_id,offered))||!(await owned(trade.recipient_id,requested)))return fail("Only Limited or Off Sale items can be traded. This offer is no longer valid; cancel it and create a new trade.",409);
      // Do not reject incoming items already owned; receiving duplicates is allowed for gifts.
      const changed=await env.DB.prepare("UPDATE trades SET status='ACCEPTED',responded_at=datetime('now') WHERE id=? AND status='PENDING' AND recipient_id=?").bind(trade.id,user.id).run();
      if(!changed?.meta?.changes)return fail("This trade was already answered.",409);
      const statements=[
        ...offered.map(itemId=>env.DB.prepare("DELETE FROM inventory WHERE id=(SELECT id FROM inventory WHERE user_id=? AND item_id=? ORDER BY purchased_at DESC LIMIT 1)").bind(trade.sender_id,itemId)),
        ...requested.map(itemId=>env.DB.prepare("DELETE FROM inventory WHERE id=(SELECT id FROM inventory WHERE user_id=? AND item_id=? ORDER BY purchased_at DESC LIMIT 1)").bind(trade.recipient_id,itemId)),
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

  if (path.startsWith("/api/asset-moderation/models")) {
    const actor=await requireUser(request,env);
    if(!actor)return fail("Please sign in.",401);
    if(actor.role!=="OWNER"&&!actor.is_asset_moderator)return fail("Asset Moderator access required.",403);
    if(path==="/api/asset-moderation/models"&&request.method==="GET"){
      const rows=await env.DB.prepare("SELECT s.id,s.user_id,s.username,s.name,s.description,s.model_url,s.image_url,s.price,s.created_at,u.public_id AS creator_public_id FROM model_submissions s LEFT JOIN users u ON u.id=s.user_id WHERE s.status='PENDING' ORDER BY s.created_at ASC LIMIT 100").all();
      return json({submissions:rows.results||[]});
    }
    const prefix="/api/asset-moderation/models/";
    const submissionId=path.startsWith(prefix)?path.slice(prefix.length):"";
    if(!submissionId||submissionId.length>80||request.method!=="PATCH")return fail("Unsupported model review action.",405);
    const data=await body(request),action=String(data?.action||"");
    if(action!=="approve"&&action!=="reject")return fail("Choose approve or reject.");
    const model=await env.DB.prepare("SELECT id,user_id,name,description,model_url,image_url,price FROM model_submissions WHERE id=? AND status='PENDING'").bind(submissionId).first();
    if(!model)return fail("This model has already been reviewed or no longer exists.",409);
    if(action==="reject"){
      const changed=await env.DB.prepare("UPDATE model_submissions SET status='REJECTED',reviewed_by=?,reviewed_at=datetime('now') WHERE id=? AND status='PENDING'").bind(actor.id,submissionId).run();
      if(!changed||!changed.meta||!changed.meta.changes)return fail("This model has already been reviewed.",409);
      await env.DB.prepare("INSERT INTO owner_audit_log (id,actor_id,target_user_id,action,details) VALUES (?,?,?,?,?)").bind(id(),actor.id,model.user_id,"ASSET_REJECT",model.name+" (3D model)").run();
      return json({ok:true,status:"REJECTED"});
    }
    const itemId=id(),inventoryId=id();
    const results=await env.DB.batch([
      env.DB.prepare("UPDATE model_submissions SET status='APPROVED',reviewed_by=?,reviewed_at=datetime('now') WHERE id=? AND status='PENDING' AND created_item_id IS NULL").bind(actor.id,submissionId),
      env.DB.prepare("INSERT INTO items (id,name,description,category,price,currency,image_url,model_url,asset_id,asset_type_id,is_limited,stock_limit,stock_sold,is_for_sale,is_offsale) SELECT ?,name,description,'Accessories',?,'P$',image_url,model_url,0,0,0,0,0,1,0 FROM model_submissions WHERE id=? AND status='APPROVED' AND reviewed_by=? AND created_item_id IS NULL AND changes()=1").bind(itemId,model.price,submissionId,actor.id),
      env.DB.prepare("INSERT INTO item_creators (item_id,creator_id,creator_name,original_url) SELECT ?,user_id,username,model_url FROM model_submissions WHERE id=? AND status='APPROVED' AND EXISTS (SELECT 1 FROM items WHERE id=?)").bind(itemId,submissionId,itemId),
      env.DB.prepare("UPDATE model_submissions SET created_item_id=? WHERE id=? AND status='APPROVED' AND reviewed_by=? AND EXISTS (SELECT 1 FROM item_creators WHERE item_id=?)").bind(itemId,submissionId,actor.id,itemId),
      env.DB.prepare("INSERT OR IGNORE INTO inventory (id,user_id,item_id) SELECT ?,user_id,? FROM model_submissions WHERE id=? AND status='APPROVED' AND reviewed_by=? AND created_item_id=?").bind(inventoryId,itemId,submissionId,actor.id,itemId)
    ]);
    if(!results||!results.length||!results[0]||!results[0].meta||!results[0].meta.changes)return fail("This model has already been reviewed.",409);
    if(results.slice(1).some(result=>!result||!result.meta||!result.meta.changes))return fail("The model could not be published.",500);
    await env.DB.prepare("INSERT INTO owner_audit_log (id,actor_id,target_user_id,action,details) VALUES (?,?,?,?,?)").bind(id(),actor.id,model.user_id,"ASSET_APPROVE",model.name+" (3D model)").run();
    return json({ok:true,status:"APPROVED",itemId:itemId});
  }

  if (path.startsWith("/api/owner/creator-submissions")) {
    const actor = await requireUser(request,env);
    if (!actor) return fail("Please sign in.",401);
    if (actor.role !== "OWNER" && !actor.is_asset_moderator) return fail("Owner or Asset Moderator access required.",403);
    if (path === "/api/owner/creator-submissions" && request.method === "GET") {
      const rows = await env.DB.prepare(`SELECT s.id,s.user_id,s.username,s.name,s.description,s.category,s.roblox_url,s.asset_id,s.price,s.created_at,u.public_id AS creator_public_id
        FROM creator_submissions s LEFT JOIN users u ON u.id=s.user_id
        WHERE s.status='PENDING' ORDER BY s.created_at ASC LIMIT 100`).all();
      return json({submissions:rows.results||[]});
    }
    const match = path.match(/^\/api\/owner\/creator-submissions\/([A-Za-z0-9_-]{1,80})$/);
    if (!match || request.method!=="PATCH") return fail("Unsupported clothing review action.",405);
    const data = await body(request);
    const action = String(data?.action||"");
    const pending = await env.DB.prepare("SELECT id,asset_id,price FROM creator_submissions WHERE id=? AND status='PENDING'").bind(match[1]).first();
    if (!pending) return fail("This request has already been reviewed or no longer exists.",409);
    if (action==="reject") {
      const result = await env.DB.prepare("UPDATE creator_submissions SET status='REJECTED',reviewed_by=?,reviewed_at=datetime('now') WHERE id=? AND status='PENDING'")
        .bind(actor.id,match[1]).run();
      if (!result?.meta?.changes) return fail("This request has already been reviewed.",409);
      return json({ok:true,status:"REJECTED"});
    }
    if (action!=="approve") return fail("Choose approve or reject.");
    const isAssetModerator = actor.role !== "OWNER" && actor.is_asset_moderator;
    const imageUrl = isAssetModerator
      ? "https://www.roblox.com/asset-thumbnail/image?assetId="+Number(pending.asset_id)+"&width=420&height=420&format=png"
      : String(data?.image_url||"").trim();
    if (!imageUrl || imageUrl.length>500) return fail("Add a catalog image URL (maximum 500 characters).");
    try {
      const image = new URL(imageUrl);
      if (image.protocol!=="https:") throw new Error();
    } catch {
      return fail("Catalog image URL must be a valid HTTPS link.");
    }
    const rawPrice = isAssetModerator ? pending.price : (data?.price===undefined ? 50 : data.price);
    const price = Number(rawPrice);
    if (!Number.isSafeInteger(price) || price<0 || price>1000000) return fail("Price must be a whole number from 0 to 1,000,000 P$.");
    const itemId = id();
    const creatorInventoryId = id();
    const results = await env.DB.batch([
      env.DB.prepare("UPDATE creator_submissions SET status='APPROVED',reviewed_by=?,reviewed_at=datetime('now'),image_url=? WHERE id=? AND status='PENDING' AND created_item_id IS NULL")
        .bind(actor.id,imageUrl,match[1]),
      env.DB.prepare(`INSERT INTO items (id,name,description,category,price,currency,image_url,model_url,asset_id,asset_type_id,is_limited,stock_limit,stock_sold,is_for_sale,is_offsale)
        SELECT ?,s.name,s.description,s.category,?,'P$',?,'',s.asset_id,CASE WHEN s.category='Shirts' THEN 11 ELSE 12 END,0,0,0,1,0
        FROM creator_submissions s
        WHERE s.id=? AND s.status='APPROVED' AND s.reviewed_by=? AND s.created_item_id IS NULL AND changes()=1`)
        .bind(itemId,price,imageUrl,match[1],actor.id),
      env.DB.prepare(`INSERT INTO item_creators (item_id,creator_id,creator_name,original_url,submission_id)
        SELECT ?,s.user_id,s.username,s.roblox_url,s.id
        FROM creator_submissions s
        WHERE s.id=? AND s.status='APPROVED' AND s.reviewed_by=?
          AND EXISTS (SELECT 1 FROM items WHERE id=?)`)
        .bind(itemId,match[1],actor.id,itemId),
      env.DB.prepare(`UPDATE creator_submissions SET created_item_id=?
        WHERE id=? AND status='APPROVED' AND reviewed_by=?
          AND EXISTS (SELECT 1 FROM item_creators WHERE item_id=?)`)
        .bind(itemId,match[1],actor.id,itemId),
      env.DB.prepare(`INSERT OR IGNORE INTO inventory (id,user_id,item_id)
        SELECT ?,ic.creator_id,ic.item_id
        FROM item_creators ic
        JOIN users creator ON creator.id=ic.creator_id
        WHERE ic.item_id=?`)
        .bind(creatorInventoryId,itemId)
    ]);
    if (!results?.[0]?.meta?.changes) return fail("This request has already been reviewed.",409);
    if (!results?.[1]?.meta?.changes || !results?.[2]?.meta?.changes || !results?.[3]?.meta?.changes || !results?.[4]?.meta?.changes) {
      console.error("[Sakura creator] Approval did not create a catalog item:",JSON.stringify(results));
      return fail("The catalog item could not be created. The review transaction was not completed.",500);
    }
    return json({ok:true,status:"APPROVED",itemId});
  }

  if (path.startsWith("/api/owner/items")) {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    if (user.role !== "OWNER") return fail("Owner access required.",403);
    if (path === "/api/owner/items" && request.method === "GET") {
      try { await announceMissingLimitedItems(env, url.origin); }
      catch (error) { console.error("[Sakura Discord] Missing Limited scan failed:",error); }
      const rows = await env.DB.prepare("SELECT i.id,i.name,i.description,i.category,i.price,i.currency,i.image_url,i.model_url,i.asset_id,i.asset_type_id,i.is_limited,i.is_offsale,i.stock_limit,i.stock_sold,i.is_for_sale,i.created_at,ic.creator_name,cu.public_id AS creator_public_id,CASE WHEN i.category='Accessories' THEN CASE WHEN i.model_url<>'' THEN '3D' ELSE '3D_MISSING' END ELSE 'IMAGE_ONLY' END AS asset_kind FROM items i LEFT JOIN item_creators ic ON ic.item_id=i.id LEFT JOIN users cu ON cu.id=ic.creator_id ORDER BY i.created_at DESC,i.name").all();
      return json({items:rows.results||[]});
    }
    if (path === "/api/owner/items" && request.method === "DELETE") {
      const result = await env.DB.prepare("UPDATE items SET is_for_sale=0 WHERE is_for_sale=1").run();
      return json({ok:true,hidden:result?.meta?.changes||0});
    }
    if (path === "/api/owner/items" && request.method === "POST") {
      const data = await body(request), error = validItem(data);
      if (error) return fail(error);
      if (data.is_for_sale !== undefined && typeof data.is_for_sale !== "boolean") return fail("Item catalog visibility must be true or false.");
      if (data.is_offsale !== undefined && typeof data.is_offsale !== "boolean") return fail("Off Sale status must be true or false.");
      if (data.is_limited !== undefined && typeof data.is_limited !== "boolean") return fail("Limited status must be true or false.");
      const isLimited = data.is_limited === true;
      const stockLimit = data.stock_limit === undefined || data.stock_limit === null || data.stock_limit === "" ? 0 : Number(data.stock_limit);
      if (!Number.isSafeInteger(stockLimit) || stockLimit < 0 || stockLimit > 1000000) return fail("Stock must be a whole number from 0 to 1,000,000.");
      if (isLimited && stockLimit < 1) return fail("A Limited item must have a stock quantity of at least 1.");
      const itemId=id();
      const defaultAssetTypes = {Hats:8,Hair:41,Faces:18,Shirts:11,Pants:12};
      const assetId = Number(data.asset_id || 0);
      const assetTypeId = Number(data.asset_type_id || (assetId ? (defaultAssetTypes[data.category] || 0) : 0));
      if (assetId > 0 && assetTypeId < 1) return fail("Accessories need a Roblox asset type ID (for example neck, back, front, shoulder or waist).");
      await env.DB.prepare("INSERT INTO items (id,name,description,category,price,currency,image_url,model_url,asset_id,asset_type_id,is_limited,stock_limit,stock_sold,is_for_sale,is_offsale) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(itemId,data.name.trim(),data.description||"",data.category,Number(data.price),data.currency||"P$",String(data.image_url||"").trim(),String(data.model_url||"").trim(),assetId,assetTypeId,isLimited?1:0,stockLimit,0,data.is_for_sale===false?0:1,data.is_offsale===true?1:0).run();
      if (isLimited && data.is_for_sale !== false) {
        try {
          await announceLimitedItem({id:itemId,name:data.name,category:data.category,price:Number(data.price),currency:data.currency||"P$",image_url:String(data.image_url||"").trim(),stock_limit:stockLimit},env,url.origin);
        } catch (error) { console.error("[Sakura Discord] New Limited announcement failed:",error); }
      }
      return json({ok:true,id:itemId},201);
    }
    const match=path.match(/^\/api\/owner\/items\/([A-Za-z0-9_-]{1,80})$/i);
    if (match && request.method === "PATCH") {
      const current=await env.DB.prepare("SELECT * FROM items WHERE id=?").bind(match[1]).first();
      if (!current) return fail("Item not found.",404);
      const data=await body(request);
      if (!data || typeof data !== "object" || Array.isArray(data)) return fail("Invalid item update.");
      if (data.is_for_sale !== undefined && typeof data.is_for_sale !== "boolean") return fail("Item catalog visibility must be true or false.");
       if (data.is_offsale !== undefined && typeof data.is_offsale !== "boolean") return fail("Off Sale status must be true or false.");
      if (data.is_limited !== undefined && typeof data.is_limited !== "boolean") return fail("Limited status must be true or false.");
      const merged={name:data.name??current.name,description:data.description??current.description,category:data.category??current.category,price:data.price??current.price,currency:data.currency??current.currency??"P$",image_url:data.image_url??current.image_url,model_url:data.model_url??current.model_url??"",asset_id:data.asset_id??current.asset_id??0,asset_type_id:data.asset_type_id??current.asset_type_id??0,is_for_sale:data.is_for_sale===undefined?current.is_for_sale:(data.is_for_sale?1:0),is_offsale:data.is_offsale===undefined?Number(current.is_offsale||0)===1:data.is_offsale,is_limited:data.is_limited===undefined?Number(current.is_limited)===1:data.is_limited,stock_limit:data.stock_limit===undefined?Number(current.stock_limit||0):Number(data.stock_limit)};
      if (!Number.isSafeInteger(merged.stock_limit) || merged.stock_limit < 0 || merged.stock_limit > 1000000) return fail("Stock must be a whole number from 0 to 1,000,000.");
      if (merged.is_limited && merged.stock_limit < 1) return fail("A Limited item must have a stock quantity of at least 1.");
      if (merged.stock_limit > 0 && merged.stock_limit < Number(current.stock_sold||0)) return fail("Stock cannot be lower than the number already sold.");
      const keepLegacyImage = String(merged.image_url||"") === String(current.image_url||"");
      const error=validItem(merged,keepLegacyImage); if(error)return fail(error);
      const defaultAssetTypes = {Hats:8,Hair:41,Faces:18,Shirts:11,Pants:12};
      const assetId = Number(merged.asset_id || 0);
      const assetTypeId = Number(merged.asset_type_id || (assetId ? (defaultAssetTypes[merged.category] || 0) : 0));
      if (assetId > 0 && assetTypeId < 1) return fail("Accessories need a Roblox asset type ID.");
      await env.DB.prepare("UPDATE items SET name=?,description=?,category=?,price=?,currency=?,image_url=?,model_url=?,asset_id=?,asset_type_id=?,is_limited=?,stock_limit=?,is_for_sale=?,is_offsale=? WHERE id=?").bind(merged.name.trim(),merged.description,merged.category,Number(merged.price),merged.currency,String(merged.image_url||"").trim(),String(merged.model_url||"").trim(),assetId,assetTypeId,merged.is_limited?1:0,merged.stock_limit,merged.is_for_sale,merged.is_offsale?1:0,match[1]).run();
      if (String(merged.currency||"P$")===String(current.currency||"P$") && Number(merged.price) > Number(current.price || 0) && Number(merged.is_for_sale) === 1) {
        try {
          await announcePriceIncrease({
            id:match[1],
            name:merged.name,
            image_url:String(merged.image_url||"").trim(),
            currency:merged.currency
          },Number(current.price || 0),Number(merged.price),env,url.origin);
        } catch (error) {
          console.error("[Sakura Discord] Price increase announcement failed:",error);
        }
      }
      return json({ok:true});
    }
    if (match && request.method === "DELETE") {
      if (url.searchParams.get("permanent") === "1") {
        const itemId = match[1];
        const current = await env.DB.prepare("SELECT id FROM items WHERE id=?").bind(itemId).first();
        if (!current) return fail("Item not found.",404);
        await env.DB.batch([
          env.DB.prepare("UPDATE trades SET status='CANCELLED',responded_at=datetime('now') WHERE status='PENDING' AND (EXISTS (SELECT 1 FROM json_each(trades.offered_items) WHERE value=?) OR EXISTS (SELECT 1 FROM json_each(trades.requested_items) WHERE value=?))").bind(itemId,itemId),
          env.DB.prepare("DELETE FROM trade_locks WHERE item_id=?").bind(itemId),
          env.DB.prepare("DELETE FROM resale_listings WHERE item_id=?").bind(itemId),
          env.DB.prepare("DELETE FROM equipped_items WHERE item_id=?").bind(itemId),
          env.DB.prepare("DELETE FROM inventory WHERE item_id=?").bind(itemId),
          env.DB.prepare("DELETE FROM purchases WHERE item_id=?").bind(itemId),
          env.DB.prepare("DELETE FROM promo_code_items WHERE item_id=?").bind(itemId),
          env.DB.prepare("DELETE FROM discord_limited_announcements WHERE item_id=?").bind(itemId),
          env.DB.prepare("DELETE FROM item_creators WHERE item_id=?").bind(itemId),
          env.DB.prepare("UPDATE creator_submissions SET created_item_id=NULL WHERE created_item_id=?").bind(itemId),
          env.DB.prepare("DELETE FROM items WHERE id=?").bind(itemId)
        ]);
        return json({ok:true,deleted:true});
      }
      const result = await env.DB.prepare("UPDATE items SET is_for_sale=0 WHERE id=?").bind(match[1]).run();
      if (!result?.meta?.changes) return fail("Item not found.",404);
      return json({ok:true,deleted:false});
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
    const q = (url.searchParams.get("q") || "").trim().slice(0,32);
    if (q.length < 1) return json({users:[]});
    const numericId = /^\d+$/.test(q) && Number.isSafeInteger(Number(q)) ? Number(q) : -1;
    const rows = await env.DB.prepare("SELECT username,role,public_id,is_verified,is_banned FROM users WHERE (instr(lower(username),lower(?))>0 OR public_id=?) ORDER BY is_banned DESC,username LIMIT 20").bind(q,numericId).all();
    return json({users:rows.results || []});
  }

  if (path === "/api/promocodes" && request.method === "GET") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const rows = await env.DB.prepare(`
      SELECT c.code,c.claimed_at,p.reward_amount,p.reward_currency,
        (SELECT GROUP_CONCAT(i.name, ', ') FROM promo_code_items pi JOIN items i ON i.id=pi.item_id WHERE pi.code=p.code) AS item_names
      FROM promo_code_claims c
      JOIN promo_codes p ON p.code=c.code
      WHERE c.user_id=?
      ORDER BY c.claimed_at DESC
      LIMIT 25
    `).bind(user.id).all();
    return json({claims:rows.results||[]});
  }

  if (path === "/api/promocodes/redeem" && request.method === "POST") {
    const user = await requireUser(request,env);
    if (!user) return fail("Please sign in.",401);
    const data = await body(request);
    const code = String(data?.code||"").trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(code)) return fail("Enter a valid promo code.");
    const promo = await env.DB.prepare("SELECT code,reward_amount,reward_currency,max_uses,expires_at,is_active FROM promo_codes WHERE code=? COLLATE NOCASE").bind(code).first();
    if (!promo || Number(promo.is_active)!==1) return fail("This promo code is invalid or inactive.",404);
    if (promo.expires_at && Date.parse(promo.expires_at)<=Date.now()) return fail("This promo code has expired.",410);
    const rewardItems = await env.DB.prepare("SELECT pi.item_id,i.name FROM promo_code_items pi JOIN items i ON i.id=pi.item_id WHERE pi.code=? ORDER BY i.name").bind(code).all();
    if (Number(promo.reward_amount||0)<=0 && !(rewardItems.results||[]).length) return fail("This promo code has no reward configured.",409);
    const claimId = randomToken();
    const statements = [
      env.DB.prepare(`
        INSERT INTO promo_code_claims (code,user_id,claim_id)
        SELECT ?,?,?
        WHERE EXISTS (
          SELECT 1 FROM promo_codes p
          WHERE p.code=? COLLATE NOCASE
            AND p.is_active=1
            AND (p.expires_at IS NULL OR datetime(p.expires_at)>datetime('now'))
            AND (p.max_uses IS NULL OR (SELECT COUNT(*) FROM promo_code_claims c WHERE c.code=p.code)<p.max_uses)
        )
        ON CONFLICT(code,user_id) DO NOTHING
      `).bind(code,user.id,claimId,code),
      env.DB.prepare("UPDATE users SET balance=balance+? WHERE id=? AND ?='P$' AND EXISTS (SELECT 1 FROM promo_code_claims WHERE code=? COLLATE NOCASE AND user_id=? AND claim_id=?)")
        .bind(Number(promo.reward_amount||0),user.id,promo.reward_currency||"P$",code,user.id,claimId),
      env.DB.prepare("UPDATE users SET tix_balance=tix_balance+? WHERE id=? AND ?='Tix' AND EXISTS (SELECT 1 FROM promo_code_claims WHERE code=? COLLATE NOCASE AND user_id=? AND claim_id=?)")
        .bind(Number(promo.reward_amount||0),user.id,promo.reward_currency||"P$",code,user.id,claimId),
      ...(rewardItems.results||[]).map(item=>env.DB.prepare("INSERT OR IGNORE INTO inventory (id,user_id,item_id) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM promo_code_claims WHERE code=? COLLATE NOCASE AND user_id=? AND claim_id=?)")
        .bind(id(),user.id,item.item_id,code,user.id,claimId))
    ];
    const results = await env.DB.batch(statements);
    if (Number(results?.[0]?.meta?.changes||0)!==1) {
      const duplicate = await env.DB.prepare("SELECT 1 AS claimed FROM promo_code_claims WHERE code=? COLLATE NOCASE AND user_id=?").bind(code,user.id).first();
      if (duplicate) return fail("You have already redeemed this promo code.",409);
      return fail("This promo code has reached its maximum number of uses or is no longer available.",410);
    }
    return json({ok:true,reward:{amount:Number(promo.reward_amount||0),currency:promo.reward_currency||"P$",items:(rewardItems.results||[]).map(item=>item.name)}});
  }

  if (path === "/api/owner/promocodes" || path.startsWith("/api/owner/promocodes/")) {
    const actor = await requireUser(request,env);
    if (!actor) return fail("Please sign in.",401);
    if (actor.role !== "OWNER") return fail("Owner access required.",403);
    if (path === "/api/owner/promocodes" && request.method === "GET") {
      const [codes,items] = await Promise.all([
        env.DB.prepare(`
          SELECT p.code,p.reward_amount,p.reward_currency,p.max_uses,p.expires_at,p.is_active,p.created_at,
            (SELECT COUNT(*) FROM promo_code_claims c WHERE c.code=p.code) AS usage_count,
            (SELECT GROUP_CONCAT(i.name, ', ') FROM promo_code_items pi JOIN items i ON i.id=pi.item_id WHERE pi.code=p.code) AS item_names
          FROM promo_codes p
          ORDER BY p.created_at DESC,p.code
        `).all(),
        env.DB.prepare("SELECT id,name,category,image_url FROM items ORDER BY name").all()
      ]);
      return json({promocodes:codes.results||[],items:items.results||[]});
    }
    if (path === "/api/owner/promocodes" && request.method === "POST") {
      const data = await body(request);
      const code = String(data?.code||"").trim().toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(code)) return fail("Promo codes must be 3–32 characters and use letters, numbers, _ or -.");
      const amount = Number(data?.reward_amount ?? 0);
      if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1000000) return fail("Reward amount must be from 0 to 1,000,000.");
      const currency = String(data?.reward_currency||"P$");
      if (!["P$","Tix"].includes(currency)) return fail("Choose P$ or Tix for the reward.");
      const rawItems = Array.isArray(data?.item_ids) ? data.item_ids : [];
      const itemIds = [...new Set(rawItems.map(value=>String(value||"").trim()).filter(Boolean))];
      if (itemIds.length>25) return fail("Choose up to 25 reward items.");
      if (!amount && !itemIds.length) return fail("Choose at least one currency or item reward.");
      if (itemIds.length) {
        const placeholders = itemIds.map(()=>"?").join(",");
        const found = await env.DB.prepare("SELECT COUNT(*) AS n FROM items WHERE id IN ("+placeholders+")").bind(...itemIds).first();
        if (Number(found?.n||0)!==itemIds.length) return fail("One or more selected reward items were not found.",404);
      }
      const maxUsesRaw = data?.max_uses;
      const maxUses = maxUsesRaw===undefined || maxUsesRaw===null || maxUsesRaw==="" ? null : Number(maxUsesRaw);
      if (maxUses!==null && (!Number.isSafeInteger(maxUses) || maxUses<1 || maxUses>1000000)) return fail("Maximum uses must be between 1 and 1,000,000.");
      let expiresAt = null;
      if (data?.expires_at) {
        const expiry = Date.parse(String(data.expires_at));
        if (!Number.isFinite(expiry) || expiry<=Date.now()) return fail("Expiry date must be a valid future date.");
        expiresAt = new Date(expiry).toISOString();
      }
      const existing = await env.DB.prepare("SELECT code FROM promo_codes WHERE code=? COLLATE NOCASE").bind(code).first();
      if (existing) return fail("That promo code already exists.",409);
      const createStatements = [
        env.DB.prepare("INSERT INTO promo_codes (code,reward_amount,reward_currency,max_uses,expires_at,created_by) VALUES (?,?,?,?,?,?)").bind(code,amount,currency,maxUses,expiresAt,actor.id),
        ...itemIds.map(itemId=>env.DB.prepare("INSERT INTO promo_code_items (code,item_id) VALUES (?,?)").bind(code,itemId))
      ];
      await env.DB.batch(createStatements);
      return json({ok:true,code},201);
    }
    const promoMatch = path.match(/^\/api\/owner\/promocodes\/([A-Za-z0-9_-]{3,32})$/i);
    if (promoMatch && request.method === "PATCH") {
      const data = await body(request);
      if (typeof data?.is_active !== "boolean") return fail("Promo code status must be true or false.");
      const result = await env.DB.prepare("UPDATE promo_codes SET is_active=? WHERE code=? COLLATE NOCASE").bind(data.is_active?1:0,promoMatch[1]).run();
      if (!result?.meta?.changes) return fail("Promo code not found.",404);
      return json({ok:true,is_active:data.is_active});
    }
    return fail("Unsupported promo code management action.",405);
  }

  return fail("API route not found.",404);
}

export default {
  async scheduled(controller,env,ctx) {
    const task = runDailyMembershipPayout(controller,env).catch(error => {
      console.error("[Sakura membership] Daily payout failed:",error);
      throw error;
    });
    ctx.waitUntil(task);
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    const avatarSupportRoute = url.pathname === "/v1.1/avatar-fetch" || url.pathname.toLowerCase() === "/asset/bodycolors.ashx" || url.pathname.toLowerCase() === "/asset" || url.pathname.toLowerCase() === "/asset/";
    if (url.pathname.startsWith("/api/") || avatarSupportRoute) {
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
    const itemShareMatch = url.pathname.match(new RegExp("^/item/([A-Za-z0-9_-]{1,80})/?$"));
    if (request.method === "GET" && itemShareMatch && env.DB) {
      const sharedItem = await env.DB.prepare("SELECT id,name,description,category,price,currency,image_url FROM items WHERE id=? AND is_for_sale=1").bind(itemShareMatch[1]).first();
      if (sharedItem) {
        const pageResponse = await env.ASSETS.fetch(new Request(new URL("/",url), { method:"GET", headers:request.headers }));
        if (pageResponse.ok && (pageResponse.headers.get("content-type")||"").includes("text/html")) {
          const escapeHtml = value => String(value??"").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
          const title = String(sharedItem.name||"Sakura item").slice(0,100);
          const description = (sharedItem.category+" · "+Number(sharedItem.price||0).toLocaleString("en-US")+" "+(sharedItem.currency||"P$")+(String(sharedItem.description||"").trim()?" · "+String(sharedItem.description).trim():"")).slice(0,300);
          const image = /^https:\/\//i.test(String(sharedItem.image_url||"")) ? String(sharedItem.image_url) : "https://raw.githubusercontent.com/Blue7366/OpenPekora/main/frontend/public/img/pekora-logo.png";
          const canonical = new URL("/item/"+encodeURIComponent(sharedItem.id),url.origin).href;
          const metadata = '<meta name="description" content="'+escapeHtml(description)+'">' +
            '<meta property="og:type" content="website"><meta property="og:site_name" content="Sakura">' +
            '<meta property="og:title" content="'+escapeHtml(title)+'">' +
            '<meta property="og:description" content="'+escapeHtml(description)+'">' +
            '<meta property="og:image" content="'+escapeHtml(image)+'"><meta property="og:url" content="'+escapeHtml(canonical)+'">' +
            '<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="'+escapeHtml(title)+'">' +
            '<meta name="twitter:description" content="'+escapeHtml(description)+'"><meta name="twitter:image" content="'+escapeHtml(image)+'">';
          let html = await pageResponse.text();
          html = html.replace(/<title>[\s\S]*?<\/title>/i,'<title>'+escapeHtml(title)+' | Sakura</title>');
          html = html.replace(/<meta\s+name=["']description["'][^>]*>/i,"");
          html = html.replace("</head>",metadata+"</head>");
          const headers = new Headers(pageResponse.headers);
          headers.set("content-type","text/html; charset=utf-8");
          headers.set("cache-control","public, max-age=60, s-maxage=300");
          headers.set("X-Content-Type-Options","nosniff");
          headers.set("X-Frame-Options","DENY");
          headers.set("Referrer-Policy","strict-origin-when-cross-origin");
          headers.set("Permissions-Policy","camera=(), microphone=(), geolocation=()");
          headers.set("Content-Security-Policy","default-src 'self'; script-src 'self' https://cdn.jsdelivr.net https://ajax.googleapis.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' https: data:; connect-src 'self' https:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests");
          return new Response(html,{status:200,headers});
        }
      }
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
