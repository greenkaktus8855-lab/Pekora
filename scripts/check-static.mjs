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
    ...source.matchAll(/(?:src|href)=["'](\/[^"'?#]+)|url\\(\\s*["']?(\/[^)'"\\s?#]+)/g)
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
const checks = [
  ["API body limit", worker.includes("const maxBytes = 16 * 1024")],
  ["HTTPS-only new catalog images", worker.includes("Image URL must use HTTPS.")],
  ["owner-only catalog writes", worker.includes('user.role !== "OWNER"')],
  ["purchase transaction checks current sale status", worker.includes("EXISTS (SELECT 1 FROM items WHERE id=? AND is_for_sale=1)")],
  ["profile UPSERT", worker.includes("ON CONFLICT(user_id) DO UPDATE SET description=excluded.description")],
  ["no old procedural avatar renderer", !app.includes("render3DAvatar") && !app.includes("avatar3d.js")],
  ["no fake wearable CSS", !/avatar-artwork|avatar-worn-chip|avatar-wearing-label/.test(css)],
  ["no missing legacy loading GIF", !/\/img\/loading(?:_old)?\.gif/.test(fs.readFileSync(path.join(root,"public/openpekora-globals.css"),"utf8"))]
];

for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
if (missing.length) {
  console.error("Missing local assets:\\n" + missing.join("\\n"));
}
if (checks.some(([, ok]) => !ok) || missing.length) process.exit(1);
console.log("Pekora static checks passed.");
