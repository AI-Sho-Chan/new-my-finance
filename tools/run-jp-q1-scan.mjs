import path from "node:path";
import { fileURLToPath } from "node:url";
import { Q1Monitor } from "../web/server/q1-monitor.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const dataDir = path.resolve(root, "data", "q1-monitor");

const args = process.argv.slice(2);
let target = 'JP';
for (const arg of args) {
  if (arg.startsWith('--market=')) {
    target = arg.split('=')[1].toUpperCase();
  }
}
if (!['JP', 'US', 'ALL'].includes(target)) {
  console.error("Invalid --market value. Use JP, US, or ALL.");
  process.exit(1);
}

const monitor = new Q1Monitor({ dataDir });
await monitor.init();

if (target === 'ALL') {
  await monitor.runMarketScan('JP');
  await monitor.runMarketScan('US');
} else {
  await monitor.runMarketScan(target);
}

const status = monitor.getStatus();
const summary = {
  target,
  currentQ1JP: status.currentQ1JP?.length ?? 0,
  currentQ1US: status.currentQ1US?.length ?? 0,
  currentQ1DropJP: status.currentQ1DropJP?.length ?? 0,
  currentQ1DropUS: status.currentQ1DropUS?.length ?? 0,
  lastJPScanAt: status.lastJPScanAt ?? null,
  lastUSScanAt: status.lastUSScanAt ?? null,
  generatedAt: status.snapshotGeneratedAt ?? null,
};
console.log(JSON.stringify(summary, null, 2));