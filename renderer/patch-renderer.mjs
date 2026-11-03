import fs from "node:fs";

const mainPath = "/opt/openpekora/game-renderer/src/Main.ts";
let source = fs.readFileSync(mainPath, "utf8");

function replaceOnce(before, after, label) {
    if (source.includes(after)) return;
    const count = source.split(before).length - 1;
    if (count !== 1) {
        throw new Error("Could not safely patch OpenPekora Main.ts: " + label);
    }
    source = source.replace(before, after);
}

replaceOnce(
    'import express from "ultimate-express";',
    'import express from "ultimate-express";\nimport { timingSafeEqual } from "node:crypto";',
    "crypto import"
);

replaceOnce(
    "const ProcessPort = Config.Ports.Process;",
    "const ProcessPort = Number(process.env.PORT || Config.Ports.Process);",
    "Render port"
);

const oldParsers = 'App.use(express.text({ limit: "250mb" }));\nApp.use(express.json());';
const protectedParsers = `const rendererSecret = String(process.env.PEKORA_RENDERER_SECRET || "").trim();
if (rendererSecret.length < 24) {
    throw new Error("PEKORA_RENDERER_SECRET must contain at least 24 characters.");
}

App.use((req: any, res: any, next: any) => {
    if (req.path === "/") return next();

    const expected = Buffer.from(rendererSecret, "utf8");
    const supplied = Buffer.from(String(req.headers["x-pekora-renderer-secret"] || ""), "utf8");

    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
        return res.status(401).send("Unauthorized");
    }

    return next();
});

App.use(express.text({ limit: "250mb" }));
App.use(express.json());`;

replaceOnce(oldParsers, protectedParsers, "shared-secret authentication");

replaceOnce(
    "App.listen(ProcessPort, () =>",
    'App.listen(ProcessPort, "0.0.0.0", () =>',
    "Render network binding"
);

fs.writeFileSync(mainPath, source, "utf8");
console.log("OpenPekora renderer patched for Render with secret authentication.");
