
import fs from 'node:fs';
import path from 'node:path';
import { DateTime } from 'luxon';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const TRACKER_VERSION = 1;
const TRACKER_FILE = path.resolve(PROJECT_ROOT, 'data/q1-monitor/trackers.json');
const STATE_FILE = path.resolve(PROJECT_ROOT, 'data/q1-monitor/state.json');
const BENCHMARKS = { JP: '1306.T', US: '^GSPC' };

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (error) {
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function resolveMarket(symbol, fallback) {
  if (symbol?.endsWith('.T')) return 'JP';
  if (symbol?.includes('-US') || symbol?.startsWith('^') || /[A-Z]{2,}/.test(symbol || '')) return 'US';
  return fallback ?? 'US';
}

async function fetchDailySeries(symbol, market, range = '1mo') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}&includePrePost=false&events=div%2Csplits`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`chart http ${res.status}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) return [];
  const ts = Array.isArray(result.timestamp) ? result.timestamp : [];
  const quote = Array.isArray(result.indicators?.quote) ? result.indicators.quote[0] : {};
  const opens = Array.isArray(quote?.open) ? quote.open : [];
  const closes = Array.isArray(quote?.close) ? quote.close : [];
  const zone = market === 'JP' ? 'Asia/Tokyo' : 'America/New_York';
  return ts.map((t, idx) => ({
    date: DateTime.fromSeconds(t, { zone }).toISODate(),
    open: opens[idx] ?? null,
    close: closes[idx] ?? null,
  }));
}

async function fetchPurchasePrice(symbol, tradeDate, market, fallback) {
  try {
    const series = await fetchDailySeries(symbol, market);
    const idx = series.findIndex((row) => row.date && row.date > tradeDate);
    if (idx >= 0) {
      const row = series[idx];
      if (row?.open && Number.isFinite(row.open)) return row.open;
      if (row?.close && Number.isFinite(row.close)) return row.close;
    }
    const sameIdx = series.findIndex((row) => row.date === tradeDate);
    if (sameIdx >= 0) {
      const row = series[sameIdx];
      if (row?.close && Number.isFinite(row.close)) return row.close;
      if (row?.open && Number.isFinite(row.open)) return row.open;
    }
  } catch (error) {
    console.warn('purchase price fetch failed', symbol, error?.message || error);
  }
  return fallback ?? null;
}

function computePerformance(entry, latestSnapshot) {
  const latestPrice = entry.latest?.price ?? null;
  const latestBenchmarkItem = latestSnapshot.get(entry.benchmark);
  const latestBenchmarkPrice = latestBenchmarkItem
    ? latestBenchmarkItem.lastPrice ?? latestBenchmarkItem.last_price ?? latestBenchmarkItem.price ?? null
    : null;

  entry.latestBenchmarkPrice = latestBenchmarkPrice;
  entry.updatedAt = Date.now();

  if (entry.purchasePrice && latestPrice) {
    entry.returnPct = ((latestPrice - entry.purchasePrice) / entry.purchasePrice) * 100;
  } else {
    entry.returnPct = null;
  }

  if (entry.benchmarkPrice && latestBenchmarkPrice) {
    entry.benchmarkReturnPct = ((latestBenchmarkPrice - entry.benchmarkPrice) / entry.benchmarkPrice) * 100;
  } else {
    entry.benchmarkReturnPct = null;
  }

  if (entry.returnPct != null && entry.benchmarkReturnPct != null) {
    entry.alphaPct = entry.returnPct - entry.benchmarkReturnPct;
  } else {
    entry.alphaPct = null;
  }

  if (entry.detectedAt) {
    entry.daysHeld = Math.max(0, Math.floor((Date.now() - entry.detectedAt) / (1000 * 60 * 60 * 24)));
  } else {
    entry.daysHeld = null;
  }
}

async function main() {
  const state = readJSON(STATE_FILE, null);
  if (!state) {
    console.error('state.json not available');
    return;
  }

  const snapshot = Array.isArray(state.snapshot?.items) ? state.snapshot.items : [];
  const history = Array.isArray(state.history) ? state.history : [];
  const latestSnapshot = new Map(snapshot.map((item) => [item.symbol, item]));

  const trackerData = readJSON(TRACKER_FILE, { version: TRACKER_VERSION, entries: [] });
  if (trackerData.version !== TRACKER_VERSION || !Array.isArray(trackerData.entries)) {
    trackerData.version = TRACKER_VERSION;
    trackerData.entries = [];
  }

  const entries = trackerData.entries;
  const seenSymbols = new Set(entries.map((entry) => entry.symbol));
  const newEntries = [];

  history.forEach((evt) => {
    if (!evt || evt.type !== 'ENTER') return;
    const symbol = evt.symbol;
    if (!symbol || seenSymbols.has(symbol)) return;
    const market = resolveMarket(symbol, evt.market);
    const benchmark = BENCHMARKS[market === 'JP' ? 'JP' : 'US'];
    const detectedAt = evt.ts || Date.now();
    const tradeDate = evt.tradeDate || DateTime.fromMillis(detectedAt).toISODate();

    const entry = {
      symbol,
      name: evt.name || symbol,
      market,
      detectedAt,
      tradeDate,
      benchmark,
      purchasePrice: null,
      benchmarkPrice: null,
      history: [],
      metricsAtDetection: evt.metrics || null,
    };
    entries.push(entry);
    newEntries.push(entry);
    seenSymbols.add(symbol);
  });

  for (const entry of newEntries) {
    const market = entry.market;
    const fallback = entry.metricsAtDetection?.lastPrice ?? null;
    entry.purchasePrice = await fetchPurchasePrice(entry.symbol, entry.tradeDate, market, fallback);
    entry.benchmarkPrice = await fetchPurchasePrice(entry.benchmark, entry.tradeDate, market === 'JP' ? 'JP' : 'US', null);
  }

  entries.forEach((entry) => {
    const item = latestSnapshot.get(entry.symbol);
    entry.latest = item
      ? {
          price: item.lastPrice ?? item.last_price ?? item.price ?? null,
          change: item.change ?? item.regularMarketChange ?? null,
          changePct: item.changePct ?? item.regularMarketChangePercent ?? null,
          fPct: item.fPct ?? item.f_pctl ?? null,
          vPct: item.vPct ?? item.v_pctl ?? null,
          quadrant: item.quadrant ?? null,
        }
      : null;
    computePerformance(entry, latestSnapshot);
  });

  trackerData.entries = entries;
  writeJSON(TRACKER_FILE, trackerData);
  console.log('tracker updated: ' + trackerData.entries.length + ' entries');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
