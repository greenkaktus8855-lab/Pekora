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
const index = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const wrangler = fs.readFileSync(path.join(root, "wrangler.toml"), "utf8");
const checks = [
  ["API body limit", worker.includes("const maxBytes = 16 * 1024")],
  ["HTTPS-only new catalog images", worker.includes("Image URL must use HTTPS.")],
  ["owner-only catalog writes", worker.includes('user.role !== "OWNER"')],
  ["owner moderation API is protected", worker.includes('path.startsWith("/api/owner/users")') && worker.includes('actor.role !== "OWNER"')],
  ["currency grants are capped", worker.includes("amount > 1000000") && worker.includes("balance<=1000000000-?")],
  ["warnings are persisted", worker.includes("CREATE TABLE IF NOT EXISTS moderation_warnings")],
  ["bans revoke sessions", worker.includes('action==="ban"?[env.DB.prepare("DELETE FROM sessions WHERE user_id=?")')],
  ["owner moderation UI exists", app.includes("ownerUserSearch") && app.includes("ownerCreditForm") && app.includes("ownerWarnForm") && app.includes("ownerBanForm")],
  ["purchase transaction checks sale status and available stock", worker.includes("is_for_sale=1 AND (stock_limit=0 OR stock_sold<stock_limit)")],
  ["profile UPSERT", worker.includes("ON CONFLICT(user_id) DO UPDATE SET description=excluded.description")],
  ["item trade API", worker.includes('path === "/api/trades" && request.method === "POST"') && worker.includes("CREATE TABLE IF NOT EXISTS trade_locks")],
  ["owner game creation API", worker.includes('path === "/api/owner/games" && request.method === "POST"')],
  ["locked game cards", app.includes("game-locked-button") && app.includes("game-lock-icon")],
  ["trade UI", app.includes("tradeTargetForm") && app.includes("tradeList")],
  ["old RCC renderer removed", !worker.includes("AVATAR_RENDERER_URL") && !app.includes("openpekora-avatar-renderer")],
  ["no old procedural avatar renderer", !app.includes("render3DAvatar") && !app.includes("avatar3d.js")],
  ["no fake wearable CSS", !/avatar-artwork|avatar-worn-chip|avatar-wearing-label/.test(css)],
  ["no missing legacy loading GIF", !/\/img\/loading(?:_old)?\.gif/.test(fs.readFileSync(path.join(root,"public/openpekora-globals.css"),"utf8"))],
  ["public IDs are uniquely indexed", worker.includes("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_public_id") && worker.includes("action === \"set_public_id\"")],
  ["owner can edit player IDs", app.includes("ownerPublicIdForm") && app.includes("set_public_id")],
  ["Limited flags are preserved", !worker.includes("UPDATE items SET is_limited=0")],
  ["Limited items have OpenPekora overlay", app.includes("CatalogOverlays/Limited.png") && css.includes(".limited-overlay") && css.includes("width:70px;height:24px")],
  ["stock is capped in the purchase transaction", worker.includes("stock_sold=stock_sold+1") && worker.includes("stock_sold<stock_limit") && worker.includes("merged.stock_limit < Number(current.stock_sold")],
  ["Owner Panel can create and edit stock", app.includes("name=\"stock_limit\"") && app.includes("name=\"is_limited\"")],
  ["trade creation rejects non-Limited items", worker.includes("i.is_limited=1") && worker.includes("You can only offer Limited items")],
  ["trade acceptance rechecks Limited status", worker.includes("Only Limited items can be traded") && worker.includes("i.is_limited=1")],
  ["trade picker only displays Limited items", app.includes("own.filter(item=>Number(item.is_limited)===1)") && app.includes("target.filter(item=>Number(item.is_limited)===1)")],
  ["Sakura site branding is configured", index.includes("<title>Sakura</title>") && index.includes("sakura-brand-wordmark") && wrangler.includes('SITE_NAME = "Sakura"')],
  ["Sakura cache versions are refreshed", index.includes("20261102-sakura-fix-2") && index.includes("app.js?v=20261102-sakura-fix-2")],
  ["Sakura theme primary accents are violet", globals.includes("rgb(166, 77, 255)") && globals.includes("rgba(106,27,177,1)") && !globals.includes("rgb(0, 162, 255)") && !globals.includes("rgba(8,79,192,1)")]

];

for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
if (missing.length) {
  console.error("Missing local assets:\\n" + missing.join("\\n"));
}
if (checks.some(([, ok]) => !ok) || missing.length) process.exit(1);
console.log("Sakura static checks passed.");
