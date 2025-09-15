import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.join(process.cwd(), ".."));
const src = path.join(root, "NMY.html");
const distDir = path.join(root, "web", "dist");
const dest = path.join(distDir, "NMY.html");

fs.mkdirSync(distDir, { recursive: true });
if (!fs.existsSync(src)) {
  console.warn("NMY.html not found at project root (skip copy).");
  process.exit(0);
}
// 1) Copy NMY.html into dist
fs.copyFileSync(src, dest);
console.log("Copied NMY.html -> web/dist/NMY.html");

// 2) Keep React app at /react and use NMY as root index
try {
  const reactIndex = path.join(distDir, "index.html");
  if (fs.existsSync(reactIndex)) {
    const reactHtml = fs.readFileSync(reactIndex, "utf8");
    const reactOutDir = path.join(distDir, "react");
    fs.mkdirSync(reactOutDir, { recursive: true });
    fs.writeFileSync(path.join(reactOutDir, "index.html"), reactHtml, "utf8");
    // Overwrite root index with NMY
    const nmyHtml = fs.readFileSync(dest, "utf8");
    fs.writeFileSync(reactIndex, nmyHtml, "utf8");
    console.log("Set NMY.html as root index and kept React at /react/");
  } else {
    console.warn("index.html not found in dist; skipped root index swap");
  }
} catch (e) {
  console.warn("Post-build tweak failed:", e?.message || e);
}
