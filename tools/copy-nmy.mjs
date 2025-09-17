import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.join(process.cwd(), ".."));
const src = path.join(root, "NMY.html");
const distDir = path.join(root, "web", "dist");
const legacyDest = path.join(distDir, "NMY.html");

fs.mkdirSync(distDir, { recursive: true });
if (!fs.existsSync(src)) {
  console.warn("NMY.html not found at project root (skip copy).");
  process.exit(0);
}

// 1) Copy legacy single-file app for reference / backwards compatibility
fs.copyFileSync(src, legacyDest);
console.log("Copied NMY.html -> web/dist/NMY.html");

// 2) Keep a copy of the React bundle under /react without touching the root index
try {
  const reactIndex = path.join(distDir, "index.html");
  if (fs.existsSync(reactIndex)) {
    const reactHtml = fs.readFileSync(reactIndex, "utf8");
    const reactOutDir = path.join(distDir, "react");
    fs.mkdirSync(reactOutDir, { recursive: true });
    fs.writeFileSync(path.join(reactOutDir, "index.html"), reactHtml, "utf8");
    console.log("Kept React index at root and mirrored it under /react/");
  } else {
    console.warn("index.html not found in dist; skipped React mirror copy");
  }
} catch (e) {
  console.warn("Post-build tweak failed:", e?.message || e);
}

// 3) Copy static data files needed by the legacy app (if present)
try {
  const dataSrc = path.join(root, "data", "jp-stocks.json");
  const dataDestDir = path.join(distDir, "data");
  if (fs.existsSync(dataSrc)) {
    fs.mkdirSync(dataDestDir, { recursive: true });
    fs.copyFileSync(dataSrc, path.join(dataDestDir, "jp-stocks.json"));
    console.log("Copied data/jp-stocks.json -> web/dist/data/jp-stocks.json");
  }
} catch (e) {
  console.warn("Data copy skipped:", e?.message || e);
}
