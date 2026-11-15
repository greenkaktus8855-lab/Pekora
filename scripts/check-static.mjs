import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const files = [
  "public/index.html",
  "public/style.css",
  "public/openpekora-globals.css",
  "public/openpekora-icons.css",
  "public/bc.svg",
  "public/openpekora-icons.css",
  "public/roblox_badges.svg"
];
const missing = [];

for (const file of files) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const refs = [
    ...source.matchAll(/(?:src|href)=["'](\/[^"'?#]+)|url\(\s*["']?(\/[^)'"\s?#]+)/g)
  ];
  for (const match of refs) {
    const url = match[1] || match[2];
    if (url.startsWith("/api/")) continue;
    const target = path.join(root, "public", url.replace(/^\/+/, ""));
    if (!fs.existsSync(target)) missing.push(`${file} -> ${url}`);
  }
}

const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const worker = fs.readFileSync(path.join(root, "src/worker.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public/style.css"), "utf8");
const globals = fs.readFileSync(path.join(root, "public/openpekora-globals.css"), "utf8");
const components = fs.readFileSync(path.join(root, "public/openpekora-components.css"), "utf8");
const classic = fs.readFileSync(path.join(root, "public/openpekora-classic.css"), "utf8");
const index = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const icons = fs.readFileSync(path.join(root, "public/openpekora-icons.css"), "utf8");
const wrangler = fs.readFileSync(path.join(root, "wrangler.toml"), "utf8");
const checks = [
  ["API body limit", worker.includes("const maxBytes = 16 * 1024")],
  ["Avatar editor and renderer are removed", !app.includes("async function avatarPage()") && !app.includes("/api/avatar") && !worker.includes("AVATAR_RENDERER_URL") && !worker.includes("_sakura-rcc/") && !index.includes('data-page="avatar"') && !fs.existsSync(path.join(root,"public/avatar-renderer.js")) && !fs.existsSync(path.join(root,"renderer")) && !fs.existsSync(path.join(root,"scripts/start-rcc-2020.ps1")) && !worker.includes("equipped_items") && !css.includes("op-avatar-") && !css.includes(".avatar-render-frame")],
  ["HTTPS-only new catalog images", worker.includes("Image URL must use HTTPS.")],
  ["owner-only catalog writes", worker.includes('user.role !== "OWNER"')],
  ["owner moderation API is protected", worker.includes('path.startsWith("/api/owner/users")') && worker.includes('actor.role !== "OWNER"')],
  ["currency grants are capped", worker.includes("amount > 1000000") && worker.includes("${walletColumn}<=1000000000-?")],
  ["warnings are persisted", worker.includes("CREATE TABLE IF NOT EXISTS moderation_warnings")],
  ["bans revoke sessions", worker.includes('action==="ban"?[env.DB.prepare("DELETE FROM sessions WHERE user_id=?")')],
  ["owner moderation UI exists", app.includes("ownerUserSearch") && app.includes("ownerCreditForm") && app.includes("ownerWarnForm") && app.includes("ownerBanForm")],
  ["purchase transaction checks sale status and available stock", worker.includes("is_for_sale=1 AND is_offsale=0 AND (stock_limit=0 OR stock_sold<stock_limit)")],
  ["profile UPSERT", worker.includes("ON CONFLICT(user_id) DO UPDATE SET description=excluded.description")],
  ["item trade API", worker.includes('path === "/api/trades" && request.method === "POST"') && worker.includes("CREATE TABLE IF NOT EXISTS trade_locks")],
  ["owner game creation API", worker.includes('path === "/api/owner/games" && request.method === "POST"')],
  ["Owner game management clearly marks all game cards as non-launchable", app.includes("Game Management") && app.includes("All games remain locked and cannot be launched.")],
  ["trade UI", app.includes("tradeTargetForm") && app.includes("tradeList")],

  ["Classic theme gives the Sakura Home dashboard light surfaces", classic.includes("#app .sakura-home-card") && classic.includes("background:#fff!important")],
  ["no old procedural avatar renderer", !app.includes("render3DAvatar") && !app.includes("avatar3d.js")],
  ["no fake wearable CSS", !/avatar-artwork|avatar-worn-chip|avatar-wearing-label/.test(css)],
  ["no missing legacy loading GIF", !/\/img\/loading(?:_old)?\.gif/.test(fs.readFileSync(path.join(root,"public/openpekora-globals.css"),"utf8"))],
  ["public IDs are uniquely indexed", worker.includes("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_public_id") && worker.includes("action === \"set_public_id\"")],
  ["owner can edit player IDs", app.includes("ownerPublicIdForm") && app.includes("set_public_id")],
  ["Limited flags are preserved", !worker.includes("UPDATE items SET is_limited=0")],
  ["Limited items use the local OpenPekora sprite", app.includes("limited-overlay icon-labels Limited") && components.includes(".icon-labels.Limited") && components.includes("background-image:url('/icon_labels.svg')")],
  ["stock is capped in the purchase transaction", worker.includes("stock_sold=stock_sold+1") && worker.includes("stock_sold<stock_limit") && worker.includes("merged.stock_limit < Number(current.stock_sold")],
  ["Owner Panel can create and edit stock", app.includes("name=\"stock_limit\"") && app.includes("name=\"is_limited\"")],
  ["trade creation checks both players own eligible Limited items", worker.includes("WHERE v.user_id=? AND (i.is_limited=1)") && worker.includes("You can only offer Limited or Off Sale items that are in your inventory.")],
  ["trade acceptance rechecks that both players still own Limited items", worker.includes("Only Limited or Off Sale items can be traded. This offer is no longer valid") && worker.includes("WHERE v.user_id=? AND (i.is_limited=1)")],
  ["trade picker only displays Limited or Off Sale items", app.includes("items.filter(item=>Number(item.is_limited)===1||Number(item.is_offsale)===1)") && app.includes("ownEligible=uniqueEligible(own),targetEligible=uniqueEligible(target)")],
  ["Classic theme uses white panels throughout Home", classic.includes("#app .sakura-home-card") && classic.includes("#app .section-content") && classic.includes("background:#fff!important")],
  ["Sakura site branding is configured", index.includes("<title>Sakura — Community</title>") && index.includes("sakura-brand-logo") && wrangler.includes('SITE_NAME = "Sakura"')],
  ["Sakura app and classic stylesheet cache versions are refreshed", index.includes("app.js?v=20261115-openpekora-profile-2") && index.includes("style.css?v=sakura-no-avatar-20261115-3") && index.includes("openpekora-classic.css?v=20261115-classic-4")],
  ["Group avatars are uploaded as validated image files and stored in D1", worker.includes("CREATE TABLE IF NOT EXISTS group_image_files") && worker.includes("request.arrayBuffer()") && worker.includes("The selected file does not match its image format.") && worker.includes("/api/group-images/")],
  ["Group image BLOBs are converted to browser-readable bytes", worker.includes("Array.isArray(storedImage)") && worker.includes("Uint8Array.from(storedImage)") && worker.includes("new Response(imageBytes")],
  ["Group avatar upload is restricted to the group owner", worker.includes("Only the group owner can change its image.") && worker.includes('groupAvatarUploadMatch && request.method === "PUT"')],
  ["Group verification is persisted and owner-only", worker.includes("ALTER TABLE sakura_groups ADD COLUMN is_verified") && worker.includes('path === "/api/owner/groups"') && worker.includes('actor.role !== "OWNER"')],
  ["Group verification badges appear in public group pages", app.includes("group-verified-badge") && app.includes("Verified group") && app.includes("data-group-verify")],
  ["Group settings accept image files instead of requiring a URL", app.includes('type="file" accept="image/png,image/jpeg,image/webp"') && app.includes('method:"PUT",credentials:"same-origin"')],
  ["Group settings dark theme overrides white surfaces", css.includes(".group-detail-card{") && css.includes("background:#17151f!important") && css.includes(".group-settings-form textarea") && css.includes("background:#282433!important")],
  ["Banned account page uses the Sakura dark theme", css.includes(".banned-account-page{") && css.includes("min-height:calc(100vh - 170px)") && css.includes(".banned-account-card{") && css.includes("background:#17151f!important") && css.includes(".ban-detail-row") && css.includes("color:#c49aff")],
  ["Player resale listings are stored with seller and buyer records", worker.includes("CREATE TABLE IF NOT EXISTS resale_listings") && worker.includes("buyer_id TEXT REFERENCES users(id)") && worker.includes("status IN ('ACTIVE','SOLD','CANCELLED')")],
  ["Only Limited and sold-out inventory can be listed by players", worker.includes("Number(item.is_limited)!==1&&!soldOut") && worker.includes("stock_limit>0 AND stock_sold>=stock_limit") && worker.includes('request.method === "POST" && path === "/api/resale/listings"')],
  ["Resale listing prices update the catalog using a protected baseline", worker.includes("async function syncItemMarketPrice") && worker.includes("UPDATE items SET price=?,currency='P$' WHERE id=?") && worker.includes("await syncItemMarketPrice(env,itemId)") && worker.includes("UPDATE items SET price=?,currency=? WHERE id=?")],
  ["Active resale listings never overwrite the catalog price", !worker.includes("Keep the catalog price synchronized with the latest valid active player listing") && !worker.includes("SET price=(\n          SELECT r.price")],
  ["Profile and RAP leaderboard use current P$ inventory value and exclude the Owner", worker.includes("async function getProfileTotalRap") && worker.includes("THEN MAX(COALESCE(i.price,0),0) * MAX(COALESCE(v.quantity,0),0)") && worker.includes("WHERE u.is_banned=0 AND u.role<>'OWNER'")],
  ["Resale transfers P$ from buyer to seller and transfers item ownership", worker.includes("balance=balance-? WHERE id=? AND balance>=? AND changes()=1") && worker.includes("balance=balance+? WHERE id=? AND changes()=1") && worker.includes("INSERT INTO inventory (id,user_id,item_id,quantity) SELECT ?,?,?,1 WHERE changes()=1") && worker.includes("status='SOLD',buyer_id=?")],
  ["Active resale listings cannot be traded", worker.includes("trg_trade_lock_no_resale") && worker.includes("trg_resale_no_trade_lock") && worker.includes("rl.status='ACTIVE'")],
  ["Inventory quick-sell UI is removed", !app.includes("inventorySellPanel") && !app.includes("inventory-confirm-sell") && !app.includes("/api/inventory/sell") && app.includes("function inventoryItemCard(item)")],
  ["Resale market, seller identity and listing controls are connected", app.includes("async function resaleMarketPage()") && app.includes("data-resale-buy") && app.includes("createResaleListing") && app.includes("cancelResaleListing") && app.includes("seller_name")],
  ["Ordinary catalog purchases still credit Admin when an item has no creator", worker.includes("username='Admin' COLLATE NOCASE AND role='OWNER' AND is_banned=0") && worker.includes("const payoutAccount = creatorAccount ||") && worker.includes("payoutAccount.id") && worker.includes("walletColumn}=${walletColumn}+?")],
  ["P$ uses the original OpenPekora Robux icon", app.includes("icon-robux-16x16 currency-icon-original") && !app.includes("currency-p-coin") && icons.includes(".icon-robux-16x16") && icons.includes("background-image:url('/branded.svg')")],
  ["Membership API uses Sakura reward terminology rather than Robux terminology", worker.includes("dailyReward:Number(") && !worker.includes("dailyRobux")],
  ["Group creation payment errors do not reveal the Admin payout account", !worker.includes("The Admin account could not be found")],
  ["Player-facing group fee copy does not disclose the Admin payout destination", !app.includes("fee is transferred to the Sakura Admin account")],
  ["Resale marketplace styles and current asset cache versions are refreshed", css.includes(".resale-market-card{") && css.includes(".resale-create-form") && index.includes("app.js?v=20261115-openpekora-profile-2") && index.includes("style.css?v=sakura-no-avatar-20261115-3")],
  ["Ban, inventory and group status panels use classic light colors", classic.includes("#app .notice,") && classic.includes("#app .danger-button,") && classic.includes("#app .group-owner-tag")],
  ["3D item previews use classic light placeholders", classic.includes("#app model-viewer.pekora-model") && classic.includes("--poster-color:#f3f3f3") && classic.includes("#app .pekora-model-missing")],
  ["Sakura controls use the classic light color scheme", classic.includes("color-scheme:light;")],
  ["Create stays in top navigation and is omitted from the sidebar", index.includes('href="/#create" data-page="create">Create</a>') && !app.includes('["create","icon-nav-create","Create"]')],
  ["Create form only accepts server-supported Shirts and Pants", app.includes('const CREATABLE_CATEGORIES=["Shirts","Pants"]') && app.includes('CREATABLE_CATEGORIES.map(category=>')],
  ["Creator submissions remain pending outside the public catalog", worker.includes("CREATE TABLE IF NOT EXISTS creator_submissions") && worker.includes('status TEXT NOT NULL DEFAULT \'PENDING\'') && worker.includes('path === "/api/creator/submissions" && request.method === "POST"')],
  ["Only the Owner can review clothing submissions", worker.includes('path.startsWith("/api/owner/creator-submissions")') && worker.includes('actor.role !== "OWNER"') && worker.includes('action==="reject"')],
  ["Approval requires an Owner-provided HTTPS image and creates the catalog item", worker.includes("Catalog image URL must be a valid HTTPS link.") && worker.includes("INSERT INTO items (id,name,description,category,price,currency,image_url,model_url,asset_id,asset_type_id,is_limited,stock_limit,stock_sold,is_for_sale,is_offsale)") && worker.includes("status='APPROVED'")],
  ["Approved clothing retains its player creator identity", worker.includes("CREATE TABLE IF NOT EXISTS item_creators") && worker.includes("ic.creator_name") && app.includes("function itemCreatorMarkup(item)") && app.includes("Created by ")],
  ["Owner Panel shows the applicant and lets Owner preview an image URL", app.includes("ownerCreatorSubmissions") && app.includes("Submitted by") && app.includes("creator-review-image-preview") && app.includes("Approve and publish")],
  ["Player Create page shows submission status and waits for approval", app.includes("My submissions") && app.includes("Not visible in Catalog until approval.") && app.includes('api("/api/creator/submissions")')],
  ["Clothing Create assets use current cache versions", index.includes("app.js?v=20261115-openpekora-profile-2") && index.includes("openpekora-components.css?v=20261105-dark-theme-1")],
  ["Create navigation has no highlighted button style", components.includes('.op-navigation a[href="#create"]{\n background:transparent!important') && components.includes("user-select:none")],
  ["Sidebar uses original OpenPekora currency and membership icons", app.includes('["currency","icon-nav-robux","Currency"]') && app.includes('["membership","icon-bc","Membership"]') && icons.includes(".icon-nav-robux") && icons.includes("background-image:url(\'/bc.svg\')") && !app.includes("icon-nav-create")],
  ["Creator submission accepts long Roblox IDs and bare catalog URLs in browser and API", app.includes("if(/^[0-9]+$/.test(raw)){") && app.includes("Number.isSafeInteger(assetId)&&assetId>0?") && app.includes("raw.startsWith(\"//\")?\"https:\"") && worker.includes("if (/^[0-9]+$/.test(suppliedUrl)) {") && worker.includes("suppliedUrl.startsWith(\"//\") ? \"https:\"") && worker.includes("if (!Number.isSafeInteger(assetId) || assetId<1) throw new Error();")],
  ["Creator form clears validation errors when any input changes", app.includes('form?.querySelectorAll("input,select,textarea")') && app.includes('field.addEventListener("input",clearCreateValidation)') && app.includes("delete message.dataset.validationError;")],
  ["Create validates all fields and clears errors after edits", app.includes("CREATABLE_CATEGORIES.includes(category)") && app.includes("const clearCreateValidation") && app.includes('querySelectorAll("input,select,textarea")') && app.includes("Number.isSafeInteger(price)")],
  ["Create lets players choose a price and sends it for review", app.includes('name="price" type="number" min="0" max="1000000"') && app.includes("const payload={name,category,description,price,roblox_url:robloxReference.url}")],
  ["Creator submission prices persist and prefill the Owner review form", worker.includes('ALTER TABLE creator_submissions ADD COLUMN price INTEGER NOT NULL DEFAULT 50') && worker.includes('asset_id,price) VALUES (?,?,?,?,?,?,?,?,?)') && worker.includes('!/^\\d+$/.test(rawPrice.trim())') && app.includes('Number(submission.price??50)')],
  ["Approved creator clothing is granted to its creator for free", worker.includes("creatorInventoryId = id()") && worker.includes("INSERT OR IGNORE INTO inventory (id,user_id,item_id)") && worker.includes("JOIN users creator ON creator.id=ic.creator_id") && worker.includes("results?.[4]?.meta?.changes")],
  ["Catalog purchases of creator clothing credit the attributed creator", worker.includes("SELECT u.id FROM item_creators ic JOIN users u ON u.id=ic.creator_id") && worker.includes("const payoutAccount = creatorAccount ||") && worker.includes(".bind(price,payoutAccount.id)") && worker.includes("You already own this item.")],
  ["New Shirts and Pants appear first in the public catalog", worker.includes("ORDER BY i.created_at DESC,i.rowid DESC") && app.includes('catalogSort="newest"') && app.includes('<option value="newest">Newest first</option>') && app.includes('<option value="Shirts">Shirts</option>') && app.includes('<option value="Pants">Pants</option>')],
  ["Owner can permanently delete catalog items and clean linked records", app.includes('data-delete-item=') && app.includes('?permanent=1') && worker.includes('url.searchParams.get("permanent") === "1"') && worker.includes('DELETE FROM inventory WHERE item_id=?') && worker.includes('DELETE FROM purchases WHERE item_id=?') && worker.includes('DELETE FROM resale_listings WHERE item_id=?') && worker.includes('DELETE FROM promo_code_items WHERE item_id=?')],
  ["Creator history explains when an approved item is deleted by Owner", app.includes("This item was removed by the Owner.") && app.includes("The player’s suggested price is prefilled")],
  ["Existing Owner Remove still only hides catalog items", worker.includes('UPDATE items SET is_for_sale=0 WHERE id=?') && worker.includes('deleted:false')],
  ["Create form omits the long Sakura warning copy", !app.includes("A Sakura page link or image URL is not an original Roblox clothing item.") && !app.includes("The Owner will add the catalog image before publishing.")],
  ["Sakura theme primary accents use classic OpenPekora blue", classic.includes("--primary-color:#00a2ff;") && classic.includes("background:#00a2ff!important")],
  ["promo codes can grant currency and multiple catalog items", worker.includes("CREATE TABLE IF NOT EXISTS promo_code_items") && worker.includes("reward_currency") && app.includes("ownerPromoItems")],
  ["promo codes enforce use limits and expiry", worker.includes("max_uses IS NULL") && worker.includes("expires_at") && app.includes('name="max_uses"') && app.includes('type="datetime-local"')],
  ["promo codes can only be claimed once per user", worker.includes("PRIMARY KEY(code,user_id)") && worker.includes("ON CONFLICT(code,user_id) DO NOTHING")],
  ["promo code page and sidebar link exist", app.includes("async function promocodesPage()") && app.includes("side-promo-button")],
  ["Premium and OBC require accounts older than three days", worker.includes("Date.now() - createdAtMs <= 3 * 24 * 60 * 60 * 1000") && worker.includes("datetime(u.created_at)<datetime('now','-3 days')") && app.includes("canUseAdvancedMemberships") && app.includes("OBC and Premium unlock")],
  ["Profile badges read assigned database badges", app.includes("const assigned=new Set(Array.isArray(profileData?.badges)?profileData.badges:[])") && app.includes("assigned.has(key)") && app.includes("ASSET_MODERATOR")],
  ["Profile Badges section lists Administrator and Verified badges in a larger grid", app.includes("function profileBadgesMarkup(profileData)") && app.includes('op-profile-badges-section"><h2>Badges</h2>') && app.includes("profileBadgesMarkup(p)") && css.includes("minmax(190px,1fr)") && css.includes("min-height:168px")],
  ["Friends menu route has a page handler and working friends list", app.includes('else if(name==="friends")await friends();') && app.includes("async function friends()") && app.includes("await loadFriendsList(view)") && app.includes("data-friend-action")],
  ["Friend list supports profile links, accept, cancel and remove actions", app.includes('data-profile="') && app.includes('data-friend-action="') && app.includes('"/api/friends/accept"') && app.includes('"/api/friends?username="')],
  ["Original OpenPekora Administrator sprite is connected to the profile Badges card", icons.includes("icon-administrator-small") && icons.includes("/roblox_badges.svg") && css.includes(".profile-badge-icon.icon-administrator-small") && fs.existsSync(path.join(root,"public/roblox_badges.svg"))],

  ["Owner Panel can grant and revoke supported badges", app.includes("owner-badge-manager") && app.includes("data-owner-badge-toggle") && app.includes("/api/owner/badges/") && worker.includes("/api/owner/badges/")],
  ["Asset Moderator permission is distinct from Owner access", worker.includes("is_asset_moderator") && worker.includes('actor.role !== "OWNER" && !actor.is_asset_moderator') && app.includes("me.isAssetModerator")],
  ["Asset Moderator sees a dedicated panel route", app.includes("async function assetModeratorPage()") && app.includes('else if(name==="asset-panel")await assetModeratorPage();') && app.includes("Asset Moderator access required.")],
  ["Asset Panel has a review queue and full tutorial", app.includes("/api/owner/creator-submissions") && app.includes("/api/asset-moderation/models") && app.includes("Как сохранить картинку одежды или аватара") && app.includes("Сохранить изображение как") && app.includes("Открыть оригинал в Roblox")],
  ["Asset review UI only exposes Approve and Reject actions", app.includes('data-asset-action="approve"') && app.includes('data-asset-action="reject"') && app.includes("data-asset-review")],
  ["Asset Moderators can review clothing without Owner Panel access", worker.includes("Owner or Asset Moderator access required.") && worker.includes('path.startsWith("/api/owner/creator-submissions")')],
  ["3D model creator submissions are validated and stored", app.includes("creatorModelSubmissionForm") && worker.includes("/api/creator/model-submissions") && worker.includes("model_submissions") && worker.includes(".glb") && worker.includes(".gltf")],
  ["3D model queue approves or rejects Accessories", worker.includes("/api/asset-moderation/models") && worker.includes("'Accessories'") && worker.includes("ASSET_APPROVE") && worker.includes("ASSET_REJECT")],
  ["Approved 3D models grant a free copy to the creator", worker.includes("INSERT OR IGNORE INTO inventory (id,user_id,item_id) SELECT ?,user_id,? FROM model_submissions") && worker.includes("created_item_id")],
  ["Profile badges display assigned keys including Asset Moderator", app.includes("ASSET_MODERATOR") && app.includes("profileBadgesMarkup(p)") && app.includes("profile-badge-symbol")],
  ["Profile uses functional About and Creations tabs with real profile fields", app.includes('data-profile-tab="about"') && app.includes('data-profile-tab="creations"') && app.includes("Number(p.friendCount||0)") && app.includes("creator_public_id")],
  ["Public profile API returns accepted-friend count", worker.includes("friendCount:Number(friendCount?.n||0)") && worker.includes("COUNT(*) AS n FROM friends WHERE user_id=? AND status='ACCEPTED'")],
  ["Classic theme loads after original OpenPekora component styles", index.indexOf("openpekora-classic.css") > index.indexOf("openpekora-components.css") && classic.includes("color-scheme:light;") && classic.includes("#app .op-profile-tabs")]
];

for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
if (missing.length) {
  console.error("Missing local assets:\\n" + missing.join("\\n"));
}
if (checks.some(([, ok]) => !ok) || missing.length) process.exit(1);
console.log("Sakura static checks passed.");
