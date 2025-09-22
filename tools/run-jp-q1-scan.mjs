import path from "node:path";
import { fileURLToPath } from "node:url";
import { Q1Monitor } from "../web/server/q1-monitor.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const dataDir = path.resolve(root, "data", "q1-monitor");
const monitor = new Q1Monitor({ dataDir });

await monitor.init();
const originalEnsure = monitor.ensureUniverse.bind(monitor);
monitor.ensureUniverse = async () => {
  const universe = await originalEnsure();
  return universe.filter((asset) => asset.market === "JP");
};

const toIsoDate = (zoneOffsetMinutes) => {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const shifted = new Date(utc + zoneOffsetMinutes * 60000);
  return shifted.toISOString().slice(0, 10);
};

const jpTradeDate = toIsoDate(9 * 60); // UTC+9
const usTradeDate = toIsoDate(-4 * 60); // assume EDT
const dummyStatus = { isOpen: false, isWeekend: false, minutesToOpen: null, minutesToClose: null };

await monitor.performFullScan({ us: usTradeDate, jp: jpTradeDate }, { usStatus: dummyStatus, jpStatus: dummyStatus });
await monitor.saveState();
const status = monitor.getStatus();
console.log(JSON.stringify({ currentQ1: status.currentQ1.length, currentQ1Drop: status.currentQ1Drop.length, generatedAt: status.snapshotGeneratedAt }, null, 2));
