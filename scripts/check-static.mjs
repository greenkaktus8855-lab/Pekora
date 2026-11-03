import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const files = [
  "public/index.html",
  "public/style.css",
  "public/openpekora-globals.css",
  "public/openpekora-icons.css"
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
const index = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const wrangler = fs.readFileSync(path.join(root, "wrangler.toml"), "utf8");
const checks = [
  ["API body limit", worker.includes("const maxBytes = 16 * 1024")],
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
  ["locked game cards", app.includes("game-locked-button") && app.includes("game-lock-icon")],
  ["trade UI", app.includes("tradeTargetForm") && app.includes("tradeList")],
  ["avatar renderer configuration removed", !worker.includes("http://176.100.36.98:7832/") && !worker.includes("AVATAR_RENDERER_URL") && !app.includes("openpekora-avatar-renderer")],
  ["no old procedural avatar renderer", !app.includes("render3DAvatar") && !app.includes("avatar3d.js")],
  ["no fake wearable CSS", !/avatar-artwork|avatar-worn-chip|avatar-wearing-label/.test(css)],
  ["no missing legacy loading GIF", !/\/img\/loading(?:_old)?\.gif/.test(fs.readFileSync(path.join(root,"public/openpekora-globals.css"),"utf8"))],
  ["public IDs are uniquely indexed", worker.includes("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_public_id") && worker.includes("action === \"set_public_id\"")],
  ["owner can edit player IDs", app.includes("ownerPublicIdForm") && app.includes("set_public_id")],
  ["Limited flags are preserved", !worker.includes("UPDATE items SET is_limited=0")],
  ["Limited items use the local OpenPekora sprite", app.includes("limited-overlay icon-labels Limited") && components.includes(".icon-labels.Limited") && components.includes("background-image:url('/icon_labels.svg')")],
  ["stock is capped in the purchase transaction", worker.includes("stock_sold=stock_sold+1") && worker.includes("stock_sold<stock_limit") && worker.includes("merged.stock_limit < Number(current.stock_sold")],
  ["Owner Panel can create and edit stock", app.includes("name=\"stock_limit\"") && app.includes("name=\"is_limited\"")],
  ["trade creation only allows Limited or Off Sale items", worker.includes("(i.is_limited=1 OR i.is_offsale=1)") && worker.includes("You can only offer Limited or Off Sale items")],
  ["trade acceptance rechecks Limited or Off Sale status", worker.includes("Only Limited or Off Sale items can be traded") && worker.includes("(i.is_limited=1 OR i.is_offsale=1)")],
  ["trade picker only displays Limited or Off Sale items", app.includes("items.filter(item=>Number(item.is_limited)===1||Number(item.is_offsale)===1)") && app.includes("ownEligible=uniqueEligible(own),targetEligible=uniqueEligible(target)")],
  ["Sakura site branding is configured", index.includes("<title>Sakura</title>") && index.includes("sakura-brand-logo") && wrangler.includes('SITE_NAME = "Sakura"')],
  ["Sakura app cache version is refreshed", index.includes("app.js?v=20261103-avatar-removed-1") && index.includes("openpekora-components.css?v=20261103-openpekora-rcc-render-5")],
  ["Sakura theme primary accents are violet", globals.includes("rgb(166, 77, 255)") && globals.includes("rgba(106,27,177,1)") && !globals.includes("rgb(0, 162, 255)") && !globals.includes("rgba(8,79,192,1)")],
  ["promo codes can grant currency and multiple catalog items", worker.includes("CREATE TABLE IF NOT EXISTS promo_code_items") && worker.includes("reward_currency") && app.includes("ownerPromoItems")],
  ["promo codes enforce use limits and expiry", worker.includes("max_uses IS NULL") && worker.includes("expires_at") && app.includes('name="max_uses"') && app.includes('type="datetime-local"')],
  ["promo codes can only be claimed once per user", worker.includes("PRIMARY KEY(code,user_id)") && worker.includes("ON CONFLICT(code,user_id) DO NOTHING")],
  ["promo code page and sidebar link exist", app.includes("async function promocodesPage()") && app.includes("side-promo-button")],
  ["Premium and OBC require accounts older than three days", worker.includes("Date.now() - createdAtMs <= 3 * 24 * 60 * 60 * 1000") && worker.includes("datetime(u.created_at)<datetime('now','-3 days')") && app.includes("canUseAdvancedMemberships") && app.includes("OBC and Premium unlock")],
  ["avatar page, preview, wardrobe and RCC endpoints are removed", !app.includes("avatarPage") && !app.includes("/api/avatar") && !app.includes("op-profile-render-image") && !worker.includes("AVATAR_RENDERER_URL") && !worker.includes("/player/thumbnail") && !worker.includes("/v1.1/avatar-fetch") && !worker.includes("equipped_items") && !wrangler.includes("/v1.1/*") && !wrangler.includes("/Asset/*")],

];

for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
if (missing.length) {
  console.error("Missing local assets:\\n" + missing.join("\\n"));
}
if (checks.some(([, ok]) => !ok) || missing.length) process.exit(1);
console.log("Sakura static checks passed.");
