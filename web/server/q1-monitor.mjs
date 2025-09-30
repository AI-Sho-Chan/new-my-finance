import fs from 'node:fs';
import path from 'node:path';
import { DateTime } from 'luxon';
import nodemailer from 'nodemailer';

const STATE_VERSION = 4;
const DEFAULT_INTERVAL_MIN = Math.max(1, Number.parseInt(process.env.Q1_MONITOR_INTERVAL_MIN ?? '5', 10) || 5);
const FALLBACK_INTERVAL_MIN = Math.max(DEFAULT_INTERVAL_MIN, Number.parseInt(process.env.Q1_MONITOR_FALLBACK_MIN ?? '10', 10) || 10);
const DEFAULT_F_PCTL_MIN = Math.max(0, Math.min(100, Number.parseFloat(process.env.Q1_F_PCTL_MIN ?? '95')));
const DEFAULT_V_PCTL_MIN = Math.max(0, Math.min(100, Number.parseFloat(process.env.Q1_V_PCTL_MIN ?? '70')));
const DEFAULT_F_PCTL_LOW = Math.max(0, Math.min(100, Number.parseFloat(process.env.Q1_F_PCTL_LOW ?? '20')));
const DEFAULT_V_PCTL_LOW = Math.max(0, Math.min(100, Number.parseFloat(process.env.Q1_V_PCTL_LOW ?? '40')));
const MAX_HISTORY = Number.parseInt(process.env.Q1_MONITOR_HISTORY_LIMIT ?? '500', 10) || 500;
const DROP_RETENTION_DAYS = Number.parseInt(process.env.Q1_MONITOR_DROP_RETENTION_DAYS ?? '30', 10) || 30;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 15000;
const REQUEST_DELAY_MS = Math.max(200, Number.parseInt(process.env.Q1_MONITOR_REQUEST_DELAY_MS ?? '350', 10) || 350);

const FULL_SCAN_CONCURRENCY = Math.max(1, Number.parseInt(process.env.Q1_MONITOR_FETCH_CONCURRENCY ?? '1', 10) || 1);
const MAX_UNIVERSE_SYMBOLS = Number.parseInt(process.env.Q1_MONITOR_MAX_SYMBOLS ?? '0', 10) || 0;
const WATCHLIST_DUPLICATE_MONTHS = 6;
const WATCHLIST_PRICE_STALE_MS = 3 * 60 * 60 * 1000;
const PURCHASE_PRICE_RETRY_MS = 6 * 60 * 60 * 1000;
const BENCHMARK_PURCHASE_DATE = '2025-09-30';
const BENCHMARK_DEFS = [
  { id: 'BENCHMARK_JP_TOPIX', symbol: '1306.T', name: 'TOPIX ETF (1306.T)', market: 'JP', currency: 'JPY', cls: 'INDEX' },
  { id: 'BENCHMARK_US_SP500', symbol: '^GSPC', name: 'S&P 500 (^GSPC)', market: 'US', currency: 'USD', cls: 'INDEX' },
  { id: 'BENCHMARK_US_NASDAQ', symbol: '^IXIC', name: 'NASDAQ Composite (^IXIC)', market: 'US', currency: 'USD', cls: 'INDEX' },
];
const JP_SCAN_HOUR = Number.parseInt(process.env.Q1_MONITOR_JP_SCAN_HOUR ?? '6', 10) || 6;
const JP_SCAN_MINUTE = Number.parseInt(process.env.Q1_MONITOR_JP_SCAN_MINUTE ?? '0', 10) || 0;
const US_SCAN_JST_HOUR = Number.parseInt(process.env.Q1_MONITOR_US_SCAN_JST_HOUR ?? '6', 10) || 6;
const US_SCAN_JST_MINUTE = Number.parseInt(process.env.Q1_MONITOR_US_SCAN_JST_MINUTE ?? '0', 10) || 0;
const FULL_SCAN_BATCH_PAUSE_MS = Math.max(0, Number.parseInt(process.env.Q1_MONITOR_BATCH_PAUSE_MS ?? '0', 10) || 0);
const FULL_SCAN_PROGRESS_EVERY = Math.max(5, Number.parseInt(process.env.Q1_MONITOR_PROGRESS_EVERY ?? '50', 10) || 50);

const PRIORITY_REFRESH_LIMIT = Math.max(1, Number.parseInt(process.env.Q1_MONITOR_PRIORITY_LIMIT ?? '30', 10) || 30);
const PRIORITY_REFRESH_CONCURRENCY = Math.max(1, Number.parseInt(process.env.Q1_MONITOR_PRIORITY_CONCURRENCY ?? '3', 10) || 3);
const PRIORITY_REFRESH_DELAY_MS = Math.max(0, Number.parseInt(process.env.Q1_MONITOR_PRIORITY_DELAY_MS ?? '750', 10) || 750);
const PRIORITY_REFRESH_INTERVAL_MIN = Math.max(1, Number.parseInt(process.env.Q1_MONITOR_PRIORITY_INTERVAL_MIN ?? '15', 10) || 15);

const symbolSetCache = new Map();

function resolveUniverseFile(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const trimmed = String(value).trim();
  if (!trimmed || trimmed.toLowerCase() === 'none' || trimmed === '0') return null;
  return trimmed;
}

async function loadSymbolSet(filePath) {
  if (!filePath) return null;
  if (symbolSetCache.has(filePath)) return symbolSetCache.get(filePath);
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    const values = raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
    const set = new Set(values.map((line) => line.toUpperCase()));
    symbolSetCache.set(filePath, set);
    return set;
  } catch (error) {
    console.warn(`[Q1Monitor] failed to load symbol list ${filePath}:`, error?.message || error);
    symbolSetCache.set(filePath, null);
    return null;
  }
}

const PRIME_JP_LABEL = '\u30D7\u30E9\u30A4\u30E0';

function hasPrimeLabel(value) {
  if (value == null) return false;
  const normalized = String(value).normalize('NFKC');
  if (normalized.includes(PRIME_JP_LABEL)) return true;
  return normalized.toLowerCase().includes('prime');
}

function isPrimeMarketEntry(entry) {
  if (!entry) return false;
  if (hasPrimeLabel(entry.exchange ?? '')) return true;
  const keywords = Array.isArray(entry.keywords) ? entry.keywords : [];
  return keywords.some((kw) => hasPrimeLabel(kw));
}

const CORE_ASSETS = [
  { id: 'USD', name: 'US Dollar (UUP)', cls: 'FX', symbol: 'UUP', currency: 'USD', priceToUSD: null, market: 'US' },
  { id: 'EUR', name: 'Euro (FXE)', cls: 'FX', symbol: 'FXE', currency: 'USD', priceToUSD: null, market: 'US' },
  { id: 'JPY', name: 'Japanese Yen (FXY)', cls: 'FX', symbol: 'FXY', currency: 'USD', priceToUSD: null, market: 'US' },
  { id: 'UST_0_3', name: 'US Treas 0-3Y (SHY)', cls: 'BOND', symbol: 'SHY', currency: 'USD', priceToUSD: null, market: 'US' },
  { id: 'UST_3_7', name: 'US Treas 3-7Y (IEI)', cls: 'BOND', symbol: 'IEI', currency: 'USD', priceToUSD: null, market: 'US' },
  { id: 'UST_20P', name: 'US Treas 20Y+ (TLT)', cls: 'BOND', symbol: 'TLT', currency: 'USD', priceToUSD: null, market: 'US' },
  { id: 'SPX', name: 'S&P 500 (^GSPC)', cls: 'EQ', symbol: '^GSPC', currency: 'USD', priceToUSD: null, market: 'US' },
  { id: 'NASDAQ', name: 'NASDAQ (^IXIC)', cls: 'EQ', symbol: '^IXIC', currency: 'USD', priceToUSD: null, market: 'US' },
  { id: 'RUSSELL', name: 'Russell 2000 (^RUT)', cls: 'EQ', symbol: '^RUT', currency: 'USD', priceToUSD: null, market: 'US' },
  { id: 'NIKKEI', name: 'Nikkei 225 (^N225)', cls: 'EQ', symbol: '^N225', currency: 'JPY', priceToUSD: 'JPY', market: 'JP' },
  { id: 'TOPIX', name: 'TOPIX ETF (1306.T)', cls: 'EQ', symbol: '1306.T', currency: 'JPY', priceToUSD: 'JPY', market: 'JP' },
  { id: 'GOLD', name: 'Gold (GLD)', cls: 'CMD', symbol: 'GLD', currency: 'USD', priceToUSD: null, market: 'US' },
  { id: 'OIL', name: 'WTI (USO)', cls: 'CMD', symbol: 'USO', currency: 'USD', priceToUSD: null, market: 'US' },
  { id: 'BTC', name: 'Bitcoin (BTC-USD)', cls: 'CRYPTO', symbol: 'BTC-USD', currency: 'USD', priceToUSD: null, market: 'US' },
  { id: 'JP_REIT', name: 'JP REIT (1343.T)', cls: 'REIT', symbol: '1343.T', currency: 'JPY', priceToUSD: 'JPY', market: 'JP' },
  { id: 'US_REIT', name: 'US REIT (VNQ)', cls: 'REIT', symbol: 'VNQ', currency: 'USD', priceToUSD: null, market: 'US' },
];

const UNIVERSE_US_SECTORS = [
  { id: 'XLB', name: 'US Materials (XLB)', cls: 'EQ', symbol: 'XLB', currency: 'USD', priceToUSD: null, market: 'US' },
  { id: 'XLE', name: 'US Energy (XLE)', cls: 'EQ', symbol: 'XLE', currency: 'USD', priceToUSD: null, market: 'US' },
  { id: 'XLF', name: 'US Financials (XLF)', cls: 'EQ', symbol: 'XLF', currency: 'USD', priceToUSD: null, market: 'US' },
  { id: 'XLI', name: 'US Industrials (XLI)', cls: 'EQ', symbol: 'XLI', currency: 'USD', priceToUSD: null, market: 'US' },
  { id: 'XLK', name: 'US Technology (XLK)', cls: 'EQ', symbol: 'XLK', currency: 'USD', priceToUSD: null, market: 'US' },
  { id: 'XLP', name: 'US Staples (XLP)', cls: 'EQ', symbol: 'XLP', currency: 'USD', priceToUSD: null, market: 'US' },
  { id: 'XLU', name: 'US Utilities (XLU)', cls: 'EQ', symbol: 'XLU', currency: 'USD', priceToUSD: null, market: 'US' },
  { id: 'XLV', name: 'US Health Care (XLV)', cls: 'EQ', symbol: 'XLV', currency: 'USD', priceToUSD: null, market: 'US' },
  { id: 'XLY', name: 'US Discretionary (XLY)', cls: 'EQ', symbol: 'XLY', currency: 'USD', priceToUSD: null, market: 'US' },
  { id: 'XLRE', name: 'US Real Estate (XLRE)', cls: 'REIT', symbol: 'XLRE', currency: 'USD', priceToUSD: null, market: 'US' },
  { id: 'XLC', name: 'US Comm Services (XLC)', cls: 'EQ', symbol: 'XLC', currency: 'USD', priceToUSD: null, market: 'US' },
];

const UNIVERSE_JP_SECTORS = [
  { id: '1612.T', name: 'JP  (1612.T)', cls: 'EQ', symbol: '1612.T', currency: 'JPY', priceToUSD: 'JPY', market: 'JP' },
  { id: '1613.T', name: 'JP d@E (1613.T)', cls: 'EQ', symbol: '1613.T', currency: 'JPY', priceToUSD: 'JPY', market: 'JP' },
  { id: '1614.T', name: 'JP @B (1614.T)', cls: 'EQ', symbol: '1614.T', currency: 'JPY', priceToUSD: 'JPY', market: 'JP' },
  { id: '1615.T', name: 'JP s (1615.T)', cls: 'EQ', symbol: '1615.T', currency: 'JPY', priceToUSD: 'JPY', market: 'JP' },
  { id: '1616.T', name: 'JP S|ES (1616.T)', cls: 'EQ', symbol: '1616.T', currency: 'JPY', priceToUSD: 'JPY', market: 'JP' },
  { id: '1617.T', name: 'JP Hi (1617.T)', cls: 'EQ', symbol: '1617.T', currency: 'JPY', priceToUSD: 'JPY', market: 'JP' },
  { id: '1618.T', name: 'JP w (1618.T)', cls: 'EQ', symbol: '1618.T', currency: 'JPY', priceToUSD: 'JPY', market: 'JP' },
  { id: '1619.T', name: 'JP  (1619.T)', cls: 'EQ', symbol: '1619.T', currency: 'JPY', priceToUSD: 'JPY', market: 'JP' },
  { id: '1620.T', name: 'JP  (1620.T)', cls: 'EQ', symbol: '1620.T', currency: 'JPY', priceToUSD: 'JPY', market: 'JP' },
  { id: '1621.T', name: 'JP i (1621.T)', cls: 'EQ', symbol: '1621.T', currency: 'JPY', priceToUSD: 'JPY', market: 'JP' },
  { id: '1622.T', name: 'JP ?M (1622.T)', cls: 'EQ', symbol: '1622.T', currency: 'JPY', priceToUSD: 'JPY', market: 'JP' },
  { id: '1623.T', name: 'JP ^AE (1623.T)', cls: 'EQ', symbol: '1623.T', currency: 'JPY', priceToUSD: 'JPY', market: 'JP' },
  { id: '1624.T', name: 'JP d?EKX (1624.T)', cls: 'EQ', symbol: '1624.T', currency: 'JPY', priceToUSD: 'JPY', market: 'JP' },
  { id: '1625.T', name: 'JP pvE (1625.T)', cls: 'EQ', symbol: '1625.T', currency: 'JPY', priceToUSD: 'JPY', market: 'JP' },
  { id: '1626.T', name: 'JP sY (1626.T)', cls: 'REIT', symbol: '1626.T', currency: 'JPY', priceToUSD: 'JPY', market: 'JP' },
];

const US_SESSIONS = [
  { startHour: 9, startMinute: 30, endHour: 16, endMinute: 0 },
];
const JP_SESSIONS = [
  { startHour: 9, startMinute: 0, endHour: 11, endMinute: 30 },
  { startHour: 12, startMinute: 30, endHour: 15, endMinute: 0 },
];

const CORE_ASSET_SYMBOLS = new Set(CORE_ASSETS.map((asset) => asset.symbol.toUpperCase()));
const US_SECTOR_SYMBOLS = new Set(UNIVERSE_US_SECTORS.map((asset) => asset.symbol.toUpperCase()));
const JP_SECTOR_SYMBOLS = new Set(UNIVERSE_JP_SECTORS.map((asset) => asset.symbol.toUpperCase()));

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function finite(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((acc, v) => acc + v, 0) / arr.length;
}

function meanFinite(arr) {
  const xs = arr.filter(finite);
  if (!xs.length) return NaN;
  return xs.reduce((acc, v) => acc + v, 0) / xs.length;
}

function stdFinite(arr) {
  const xs = arr.filter(finite);
  if (!xs.length) return NaN;
  const m = xs.reduce((acc, v) => acc + v, 0) / xs.length;
  const variance = xs.reduce((acc, v) => acc + (v - m) * (v - m), 0) / xs.length;
  return Math.sqrt(variance);
}

function ewma(src, halflife) {
  if (!src.length) return [];
  const alpha = 1 - Math.exp(Math.log(0.5) / halflife);
  const out = new Array(src.length);
  let m = src[0];
  out[0] = m;
  for (let i = 1; i < src.length; i += 1) {
    m = alpha * src[i] + (1 - alpha) * m;
    out[i] = m;
  }
  return out;
}

function alignForwardFill(seriesMap) {
  const set = new Set();
  Object.values(seriesMap).forEach((series) => {
    series.forEach((p) => set.add(p.time));
  });
  const grid = Array.from(set.values()).sort((a, b) => a - b);
  const filled = {};
  Object.entries(seriesMap).forEach(([key, series]) => {
    let j = 0;
    let last = null;
    const row = [];
    grid.forEach((t) => {
      while (j < series.length && series[j].time <= t) {
        if (finite(series[j].price)) last = series[j].price;
        j += 1;
      }
      if (last == null) {
        row.push(NaN);
      } else {
        row.push(last);
      }
    });
    let first = row.find((v) => Number.isFinite(v));
    if (first == null) first = NaN;
    for (let i = 0; i < row.length; i += 1) {
      if (!Number.isFinite(row[i])) {
        row[i] = first;
      } else {
        break;
      }
    }
    filled[key] = row;
  });
  return { grid, filled };
}

function percentileRank(values, v) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const idx = sorted.findIndex((x) => x >= v);
  const i = idx < 0 ? sorted.length - 1 : idx;
  if (sorted.length === 1) return 100;
  return Math.round((i / (sorted.length - 1)) * 100);
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toSeries(candles, convert, fxSeries) {
  return candles.map((c) => {
    const close = toNumber(c.close);
    if (close == null) return { time: c.time, price: null };
    if (convert === 'JPY') {
      const rate = nearestValue(fxSeries, c.time);
      if (rate == null || !Number.isFinite(rate)) return { time: c.time, price: null };
      return { time: c.time, price: close / rate };
    }
    return { time: c.time, price: close };
  });
}

function nearestValue(series, t) {
  for (let i = series.length - 1; i >= 0; i -= 1) {
    if (series[i].time <= t) return series[i].price ?? null;
  }
  return null;
}

function tradeDateFor(zone) {
  return previousBusinessDate(zone).toISODate();
}

function marketStatus(zone, sessions) {
  const now = DateTime.now().setZone(zone);
  const weekday = now.weekday;
  const isWeekend = weekday === 6 || weekday === 7;
  let isOpen = false;
  let minutesToClose = null;
  let minutesToOpen = null;
  if (!isWeekend) {
    sessions.forEach((session) => {
      const start = now.set({ hour: session.startHour, minute: session.startMinute, second: 0, millisecond: 0 });
      const end = now.set({ hour: session.endHour, minute: session.endMinute, second: 0, millisecond: 0 });
      if (now >= start && now < end) {
        isOpen = true;
        minutesToClose = Math.round(end.diff(now, 'minutes').minutes);
      }
      if (now < start) {
        const diff = Math.round(start.diff(now, 'minutes').minutes);
        minutesToOpen = minutesToOpen == null ? diff : Math.min(minutesToOpen, diff);
      }
    });
  }
  return {
    zone,
    isOpen,
    isWeekend,
    minutesToClose,
    minutesToOpen,
  };
}
function previousBusinessDate(zone) {
  let dt = DateTime.now().setZone(zone);
  while (dt.weekday === 6 || dt.weekday === 7) {
    dt = dt.minus({ days: 1 });
  }
  return dt;
}

function nextBusinessDateFrom(dateStr, zone) {
  if (!dateStr) return null;
  let dt = DateTime.fromISO(String(dateStr), { zone });
  if (!dt.isValid) {
    dt = DateTime.fromISO(String(dateStr));
  }
  if (!dt.isValid) return null;
  dt = dt.plus({ days: 1 });
  let guard = 0;
  while ((dt.weekday === 6 || dt.weekday === 7) && guard < 10) {
    dt = dt.plus({ days: 1 });
    guard += 1;
  }
  return dt;
}

function isoDateSafe(dt) {
  if (!dt || typeof dt.toISODate !== 'function') return null;
  try {
    return dt.toISODate();
  } catch {
    return null;
  }
}

function monthsBetween(start, end) {
  if (!start || !end) return null;
  const a = DateTime.fromISO(String(start));
  const b = DateTime.fromISO(String(end));
  if (!a.isValid || !b.isValid) return null;
  const diff = b.diff(a, 'months').months;
  return Number.isFinite(diff) ? diff : null;
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  const dt = DateTime.fromISO(String(dateStr));
  if (!dt.isValid) return null;
  const diff = DateTime.now().diff(dt, 'days').days;
  if (!Number.isFinite(diff)) return null;
  return Math.max(0, Math.floor(diff));
}

function isoDateFromUnix(time, zone) {
  if (!Number.isFinite(time)) return null;
  const dt = DateTime.fromSeconds(time, { zone: zone || 'UTC' });
  if (!dt.isValid) return null;
  return dt.toISODate();
}
async function loadSymbolUniverse(symbolsPath, options = {}) {
  const raw = await fs.promises.readFile(symbolsPath, 'utf8');
  const json = JSON.parse(raw);
  const entries = Array.isArray(json?.entries) ? json.entries : [];
  const jpWhitelist = options.jpWhitelist instanceof Set ? options.jpWhitelist : options.jpWhitelist ? new Set(options.jpWhitelist) : null;
  const usWhitelist = options.usWhitelist instanceof Set ? options.usWhitelist : options.usWhitelist ? new Set(options.usWhitelist) : null;
  const assets = [];
  for (const entry of entries) {
    if (!entry || entry.assetType !== 'stock') continue;
    const region = entry.region;
    if (region !== 'US' && region !== 'JP') continue;
    const symbol = String(entry.symbol || '').trim().toUpperCase();
    if (!symbol) continue;
    if (region === 'JP') {
      if (options.jpPrimeOnly && !isPrimeMarketEntry(entry)) continue;
      if (jpWhitelist && jpWhitelist.size && !jpWhitelist.has(symbol)) continue;
    } else if (region === 'US') {
      if (usWhitelist && usWhitelist.size && !usWhitelist.has(symbol)) continue;
    }
    const currency = region === 'JP' ? 'JPY' : 'USD';
    assets.push({
      id: symbol,
      name: entry.name || symbol,
      cls: 'EQ',
      symbol,
      currency,
      priceToUSD: currency === 'JPY' ? 'JPY' : null,
      market: region,
    });
  }
  return assets;
}

function dedupeAssets(list) {
  const map = new Map();
  list.forEach((asset) => {
    const key = asset.symbol.toUpperCase();
    if (!map.has(key)) map.set(key, { ...asset, id: key });
  });
  return Array.from(map.values());
}

async function buildUniverse(symbolsPath, options = {}) {
  let jpWhitelist = null;
  let usWhitelist = null;
  if (options.listsDir) {
    if (options.jpWhitelistFile) {
      const jpPath = path.resolve(options.listsDir, options.jpWhitelistFile);
      jpWhitelist = await loadSymbolSet(jpPath);
    }
    if (options.usWhitelistFile) {
      const usPath = path.resolve(options.listsDir, options.usWhitelistFile);
      usWhitelist = await loadSymbolSet(usPath);
    }
  }
  const stockAssets = await loadSymbolUniverse(symbolsPath, {
    jpPrimeOnly: options.jpPrimeOnly,
    jpWhitelist,
    usWhitelist,
  });
  const jpCount = stockAssets.filter((asset) => asset.market === 'JP').length;
  const usCount = stockAssets.filter((asset) => asset.market === 'US').length;
  console.log(`[Q1Monitor] symbol universe ready (JP ${jpCount}, US ${usCount}, total ${stockAssets.length})`);
  const merged = dedupeAssets([...CORE_ASSETS, ...UNIVERSE_US_SECTORS, ...UNIVERSE_JP_SECTORS, ...stockAssets]);
  if (MAX_UNIVERSE_SYMBOLS > 0 && merged.length > MAX_UNIVERSE_SYMBOLS) {
    return merged.slice(0, MAX_UNIVERSE_SYMBOLS);
  }
  return merged;
}



function sessionTradeDate(market) {
  return market === 'JP' ? tradeDateFor('Asia/Tokyo') : tradeDateFor('America/New_York');
}

async function fetchYahooChart(symbol, interval, range) {
  const urls = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false&events=div%2Csplits`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false&events=div%2Csplits`,
  ];
  let lastErr = null;
  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json, text/javascript, */*; q=0.01' },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status}`);
        await wait(200);
        continue;
      }
      const json = await res.json();
      const result = json?.chart?.result?.[0];
      const timestamps = result?.timestamp;
      const quote = result?.indicators?.quote?.[0] ?? {};
      if (!Array.isArray(timestamps) || !timestamps.length) {
        lastErr = new Error('empty chart response');
        await wait(200);
        continue;
      }
      const out = [];
      for (let i = 0; i < timestamps.length; i += 1) {
        const time = Number(timestamps[i]);
        if (!Number.isFinite(time)) continue;
        out.push({
          time,
          open: toNumber(quote.open?.[i]),
          high: toNumber(quote.high?.[i]),
          low: toNumber(quote.low?.[i]),
          close: toNumber(quote.close?.[i]),
          volume: toNumber(quote.volume?.[i]),
        });
      }
      if (out.length) return out;
      lastErr = new Error('no usable candles');
    } catch (error) {
      lastErr = error;
      await wait(250);
    }
  }
  throw lastErr ?? new Error('chart fetch failed');
}

async function computeSnapshot(universe, opts = {}) {
  const params = {
    windows: { short: 20, mid: 63, long: 252 },
    weights: { short: 0.5, mid: 0.35, long: 0.15 },
    lambda_AV: 0.6,
    winsor_sigma: 3.0,
    ewma_half_life_rp: 10,
  };

  const fPctMin = Math.min(100, Math.max(0, Number.isFinite(opts.fPctMin) ? opts.fPctMin : DEFAULT_F_PCTL_MIN));
  const vPctMin = Math.min(100, Math.max(0, Number.isFinite(opts.vPctMin) ? opts.vPctMin : DEFAULT_V_PCTL_MIN));
  const fPctLow = Math.min(fPctMin, Math.max(0, Number.isFinite(opts.fPctLow) ? opts.fPctLow : DEFAULT_F_PCTL_LOW));
  const vPctLow = Math.min(vPctMin, Math.max(0, Number.isFinite(opts.vPctLow) ? opts.vPctLow : DEFAULT_V_PCTL_LOW));

  const progressEvery = Math.max(1, opts.progressEvery ?? FULL_SCAN_PROGRESS_EVERY);
  const total = universe.length;
  const startedAt = Date.now();
  let processed = 0;

  const fxDailyRaw = await fetchYahooChart('USDJPY=X', '1d', '1y').catch(() => []);
  await wait(REQUEST_DELAY_MS);
  const fxWeeklyRaw = await fetchYahooChart('USDJPY=X', '1wk', '5y').catch(() => []);
  await wait(REQUEST_DELAY_MS);
  const fxDaily = fxDailyRaw.map((c) => ({ time: c.time, price: c.close ?? null }));
  const fxWeekly = fxWeeklyRaw.map((c) => ({ time: c.time, price: c.close ?? null }));

  const daily = {};
  const weekly = {};

  let index = 0;
  while (index < universe.length) {
    const batch = [];
    for (let i = 0; i < FULL_SCAN_CONCURRENCY && index < universe.length; i += 1, index += 1) {
      const asset = universe[index];
      batch.push((async () => {
        try {
          const dailyCandles = await fetchYahooChart(asset.symbol, '1d', '1y').catch(() => []);
          await wait(REQUEST_DELAY_MS);
          const weeklyCandles = await fetchYahooChart(asset.symbol, '1wk', '5y').catch(() => []);
          await wait(REQUEST_DELAY_MS);
          return { asset, daily: dailyCandles, weekly: weeklyCandles };
        } catch (error) {
          return { asset, daily: [], weekly: [] };
        }
      })());
    }
    // eslint-disable-next-line no-await-in-loop
    const results = await Promise.all(batch);
    results.forEach(({ asset, daily: dailyCandles, weekly: weeklyCandles }) => {
      daily[asset.id] = toSeries(dailyCandles, asset.priceToUSD, fxDaily);
      weekly[asset.id] = toSeries(weeklyCandles, asset.priceToUSD, fxWeekly);
    });
    processed += results.length;

    if (opts.onProgress && (processed === total || processed % progressEvery === 0)) {
      const elapsedMs = Date.now() - startedAt;
      const rate = processed > 0 ? processed / Math.max(elapsedMs / 1000, 1) : 0;
      const remaining = Math.max(total - processed, 0);
      const etaMs = rate > 0 ? Math.round((remaining / rate) * 1000) : null;
      try {
        opts.onProgress({ processed, total, etaMs });
      } catch (error) {
        console.warn('[Q1Monitor] progress callback failed:', error);
      }
    }

    if (FULL_SCAN_BATCH_PAUSE_MS > 0 && index < universe.length) {
      // eslint-disable-next-line no-await-in-loop
      await wait(FULL_SCAN_BATCH_PAUSE_MS);
    }
  }

  if (opts.onProgress && processed < total) {
    try {
      opts.onProgress({ processed: total, total, etaMs: 0 });
    } catch (error) {
      console.warn('[Q1Monitor] progress callback failed:', error);
    }
  }

  const { grid: gd, filled: fd } = alignForwardFill(daily);
  const logP = {};
  Object.keys(fd).forEach((id) => {
    logP[id] = fd[id].map((v) => (finite(v) ? Math.log(Math.max(v, 1e-9)) : NaN));
  });
  const lnG = gd.map((_, i) => meanFinite(Object.keys(logP).map((id) => logP[id][i])));
  const rpD = {};
  Object.keys(logP).forEach((id) => {
    rpD[id] = logP[id].map((x, i) => (finite(x) && finite(lnG[i]) ? x - lnG[i] : NaN));
  });
  const rpDS = {};
  Object.keys(rpD).forEach((id) => {
    rpDS[id] = ewma(rpD[id], params.ewma_half_life_rp);
  });

  const Ls = [params.windows.short, params.windows.mid, params.windows.long];
  const last = gd.length - 1;
  const mByL = {};
  Ls.forEach((L) => {
    const m = {};
    Object.keys(rpDS).forEach((id) => {
      if (last - L < 2) {
        m[id] = NaN;
        return;
      }
      const rp = rpDS[id];
      if (!finite(rp[last]) || !finite(rp[last - L])) {
        m[id] = NaN;
        return;
      }
      const delta = rp[last] - rp[last - L];
      const diffs = [];
      for (let k = last - L + 1; k <= last; k += 1) {
        const a = rp[k];
        const b = rp[k - 1];
        if (finite(a) && finite(b)) diffs.push(a - b);
      }
      const sigma = stdFinite(diffs);
      m[id] = finite(sigma) && sigma > 0 ? delta / sigma : NaN;
    });
    const vals = Object.values(m).filter(finite);
    const mu = meanFinite(vals);
    const sd = stdFinite(vals);
    const z = {};
    Object.keys(m).forEach((id) => {
      const v = m[id];
      if (!finite(v) || !finite(mu) || !finite(sd) || sd === 0) {
        z[id] = NaN;
      } else {
        const zi = (v - mu) / sd;
        z[id] = clamp(zi, -params.winsor_sigma, params.winsor_sigma);
      }
    });
    mByL[L] = z;
  });

  const F = {};
  Object.keys(rpDS).forEach((id) => {
    const z20 = mByL[params.windows.short]?.[id] ?? NaN;
    const z63 = mByL[params.windows.mid]?.[id] ?? NaN;
    const z252 = mByL[params.windows.long]?.[id] ?? NaN;
    const combined = (Number.isFinite(z20) ? z20 : 0) * params.weights.short
      + (Number.isFinite(z63) ? z63 : 0) * params.weights.mid
      + (Number.isFinite(z252) ? z252 : 0) * params.weights.long;
    F[id] = Number.isFinite(combined) ? combined : NaN;
  });

  const { grid: gw, filled: fw } = alignForwardFill(weekly);
  const logPW = {};
  Object.keys(fw).forEach((id) => {
    logPW[id] = fw[id].map((v) => (finite(v) ? Math.log(Math.max(v, 1e-9)) : NaN));
  });
  const lnGW = gw.map((_, i) => meanFinite(Object.keys(logPW).map((id) => logPW[id][i])));
  const rpW = {};
  Object.keys(logPW).forEach((id) => {
    rpW[id] = logPW[id].map((x, i) => (finite(x) && finite(lnGW[i]) ? x - lnGW[i] : NaN));
  });

  function olsFit(arrRaw) {
    const arr = arrRaw.filter(finite);
    const n = arr.length;
    if (n < 40) return null;
    const x = Array.from({ length: n }, (_, i) => i);
    const mx = mean(x);
    const my = mean(arr);
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i += 1) {
      num += (x[i] - mx) * (arr[i] - my);
      den += (x[i] - mx) * (x[i] - mx);
    }
    const b1 = den ? num / den : 0;
    const b0 = my - b1 * mx;
    const yhat = x.map((xi) => b0 + b1 * xi);
    const d = arr.map((v, i) => v - yhat[i]);
    return { yhatLast: yhat[n - 1], dSeries: d };
  }

  const V = {};
  Object.keys(rpW).forEach((id) => {
    const r = olsFit(rpW[id]);
    if (!r) {
      V[id] = NaN;
      return;
    }
    const mu = meanFinite(r.dSeries);
    const sd = stdFinite(r.dSeries);
    if (!finite(mu) || !finite(sd) || sd === 0) {
      V[id] = NaN;
      return;
    }
    const zts = (r.dSeries[r.dSeries.length - 1] - mu) / sd;
    V[id] = finite(zts) ? -zts : NaN;
  });

  const lastPrice = {};
  const rpNow = {};
  Object.keys(fd).forEach((id) => {
    const p = fd[id][last];
    lastPrice[id] = finite(p) ? p : null;
    const rps = rpDS[id];
    const val = rps && rps.length ? rps[rps.length - 1] : NaN;
    rpNow[id] = finite(val) ? val : null;
  });

  const fVals = Object.values(F).filter(finite);
  const vVals = Object.values(V).filter(finite);

  const items = universe.map((asset) => {
    const f = F[asset.id];
    const v = V[asset.id];
    const aScore = Number.isFinite(f) && Number.isFinite(v) ? (params.lambda_AV * f + (1 - params.lambda_AV) * v) : null;
    const fPctl = Number.isFinite(f) ? percentileRank(fVals, f) : null;
    const vPctl = Number.isFinite(v) ? percentileRank(vVals, v) : null;
    let quadrant = 'NA';
    if (fPctl != null && vPctl != null) {
      if (fPctl >= fPctMin && vPctl >= vPctMin) quadrant = 'Q1';
      else if (fPctl >= fPctMin && vPctl < vPctMin) quadrant = 'Q2';
      else if (fPctl < fPctLow && vPctl >= vPctMin) quadrant = 'Q3';
      else if (fPctl < fPctLow && vPctl < vPctLow) quadrant = 'Q4';
      else quadrant = 'NA';
    }
    return {
      id: asset.id,
      symbol: asset.symbol,
      market: asset.market,
      name: asset.name,
      cls: asset.cls,
      currency: asset.currency,
      lastPrice: lastPrice[asset.id] ?? null,
      rp: rpNow[asset.id] ?? null,
      F: Number.isFinite(f) ? f : null,
      V: Number.isFinite(v) ? v : null,
      A: aScore,
      fPct: fPctl,
      vPct: vPctl,
      quadrant,
    };
  });

  const ranked = items
    .map((item, index) => ({ index, score: item.A ?? Number.NEGATIVE_INFINITY }))
    .sort((a, b) => b.score - a.score);
  ranked.forEach(({ index, score }, rank) => {
    if (Number.isFinite(score)) items[index].aRank = rank + 1;
  });

  return { generatedAt: Date.now(), items };
}

function extractLastClose(candles) {
  if (!Array.isArray(candles) || !candles.length) return null;
  for (let i = candles.length - 1; i >= 0; i -= 1) {
    const close = toNumber(candles[i]?.close);
    if (Number.isFinite(close)) return close;
  }
  return null;
}


class Q1Monitor {
  constructor({ dataDir }) {
    this.dataDir = dataDir;
    this.statePath = path.join(dataDir, 'state.json');
    this.state = null;
    this.running = false;
    this.started = false;
    this.timer = null;
    this.failCount = 0;
    this.intervalMinutes = DEFAULT_INTERVAL_MIN;
    this.emailEnabled = false;
    this.transporter = null;
    this.symbolsDatasetPath = path.resolve(this.dataDir, '..', '..', 'web', 'public', 'data', 'symbols.json');
    this.symbolListDir = path.resolve(this.dataDir, 'symbols');
    const jpUniverseFile = resolveUniverseFile(process.env.Q1_JP_UNIVERSE_FILE, 'jp_topix100.txt');
    const usUniverseFile = resolveUniverseFile(process.env.Q1_US_UNIVERSE_FILE, 'us_large_all.txt');
    this.universeOptions = {
      listsDir: this.symbolListDir,
      jpPrimeOnly: true,
      jpWhitelistFile: jpUniverseFile,
      usWhitelistFile: usUniverseFile,
    };
    this.snapshotOptions = {
      fPctMin: DEFAULT_F_PCTL_MIN,
      vPctMin: DEFAULT_V_PCTL_MIN,
      fPctLow: DEFAULT_F_PCTL_LOW,
      vPctLow: DEFAULT_V_PCTL_LOW,
    };
    this.universeCache = null;
    this.universePromise = null;
    this.fullScanInProgress = false;
    this.emailConfig = this.resolveEmailConfig();
    if (this.emailConfig) {
      this.emailEnabled = true;
      this.transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user: this.emailConfig.user, pass: this.emailConfig.pass },
      });
    }
  }

  resolveEmailConfig() {
    const user = process.env.Q1_ALERT_EMAIL_USER;
    const pass = process.env.Q1_ALERT_EMAIL_PASS;
    const to = process.env.Q1_ALERT_EMAIL_TO || user || process.env.Q1_ALERT_EMAIL_RECIPIENT;
    const from = process.env.Q1_ALERT_EMAIL_FROM || user;
    if (!user || !pass || !to) return null;
    return { user, pass, to, from: from || user };
  }

  async init() {
    await fs.promises.mkdir(this.dataDir, { recursive: true });
    await this.loadState();
  }

  async loadState() {
    try {
      const raw = await fs.promises.readFile(this.statePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed.stateVersion === STATE_VERSION || parsed.stateVersion === 3) {
        this.state = parsed;
        this.state.stateVersion = STATE_VERSION;
        const ensure = (key, fallback) => {
          if (!Object.prototype.hasOwnProperty.call(this.state, key)) {
            this.state[key] = fallback;
          }
        };
        ensure('lastPriorityRefreshAt', null);
        ensure('lastJPScanKey', null);
        ensure('lastUSScanKey', null);
        ensure('lastGlobalScanKey', null);
        ensure('lastUSSectorScanKey', null);
        ensure('lastJPSectorScanKey', null);
        ensure('lastAllScanKey', null);
        ensure('lastJPScanAt', null);
        ensure('lastUSScanAt', null);
        ensure('lastGlobalScanAt', null);
        ensure('lastUSSectorScanAt', null);
        ensure('lastJPSectorScanAt', null);
        ensure('lastAllScanAt', null);
        ensure('watchlist', []);
        if (!Array.isArray(this.state.watchlist)) this.state.watchlist = [];
        if (!Object.prototype.hasOwnProperty.call(this.state, 'snapshotByMarket') || !this.state.snapshotByMarket) {
          this.state.snapshotByMarket = { JP: null, US: null };
        }
        if (!Object.prototype.hasOwnProperty.call(this.state, 'snapshotByCategory') || !this.state.snapshotByCategory) {
          this.state.snapshotByCategory = {};
        }
        this.intervalMinutes = this.state.intervalMinutes ?? DEFAULT_INTERVAL_MIN;
        await this.ensureBenchmarkEntries();
        await this.refreshPurchasePrices();
        await this.refreshBenchmarkPrices();
        return;
      }
      if (parsed.stateVersion === 1) {
        this.state = {
          stateVersion: STATE_VERSION,
          lastRun: parsed.lastRun || 0,
          lastSuccessAt: parsed.lastSuccessAt ?? null,
          intervalMinutes: parsed.intervalMinutes ?? DEFAULT_INTERVAL_MIN,
          snapshot: parsed.snapshot ?? null,
          symbols: parsed.symbols ?? {},
          history: parsed.history ?? [],
          lastError: parsed.lastError ?? null,
          marketStatus: parsed.marketStatus ?? null,
          lastFullScanKey: null,
          lastFullScanAt: parsed.lastSuccessAt ?? null,
          universeSize: parsed.snapshot?.items?.length ?? CORE_ASSETS.length,
          lastPriorityRefreshAt: null,
          lastJPScanKey: null,
          lastUSScanKey: null,
          lastGlobalScanKey: null,
          lastUSSectorScanKey: null,
          lastJPSectorScanKey: null,
          lastAllScanKey: null,
          lastJPScanAt: null,
          lastUSScanAt: null,
          lastGlobalScanAt: null,
          lastUSSectorScanAt: null,
          lastJPSectorScanAt: null,
          lastAllScanAt: null,
          watchlist: Array.isArray(parsed.watchlist) ? parsed.watchlist : [],
          snapshotByMarket: { JP: null, US: null },
          snapshotByCategory: {},
        };
        this.intervalMinutes = this.state.intervalMinutes ?? DEFAULT_INTERVAL_MIN;
        await this.ensureBenchmarkEntries();
        await this.refreshPurchasePrices();
        await this.refreshBenchmarkPrices();
        return;
      }
    } catch (error) {
      // ignore broken state files
    }
    this.state = {
      stateVersion: STATE_VERSION,
      lastRun: 0,
      lastSuccessAt: null,
      intervalMinutes: DEFAULT_INTERVAL_MIN,
      snapshot: null,
      symbols: {},
      history: [],
      lastError: null,
      marketStatus: null,
      lastFullScanKey: null,
      lastFullScanAt: null,
      universeSize: CORE_ASSETS.length,
      lastPriorityRefreshAt: null,
      lastJPScanKey: null,
      lastUSScanKey: null,
      lastGlobalScanKey: null,
      lastUSSectorScanKey: null,
      lastJPSectorScanKey: null,
      lastAllScanKey: null,
      lastJPScanAt: null,
      lastUSScanAt: null,
      lastGlobalScanAt: null,
      lastUSSectorScanAt: null,
      lastJPSectorScanAt: null,
      lastAllScanAt: null,
      watchlist: [],
      snapshotByMarket: { JP: null, US: null },
      snapshotByCategory: {},
    };
    this.intervalMinutes = this.state.intervalMinutes ?? DEFAULT_INTERVAL_MIN;
    await this.ensureBenchmarkEntries();
    await this.refreshPurchasePrices();
    await this.refreshBenchmarkPrices();
  }

  async saveState() {
    if (!this.state) return;
    const payload = JSON.stringify(this.state, null, 2);
    await fs.promises.writeFile(this.statePath, payload, 'utf8');
  }

  async ensureUniverse() {
    if (this.universeCache) return this.universeCache;
    if (!this.universePromise) {
      this.universePromise = buildUniverse(this.symbolsDatasetPath, this.universeOptions)
        .then((assets) => {
          this.universeCache = assets;
          if (this.state) this.state.universeSize = assets.length;
          return assets;
        })
        .catch((error) => {
          this.universePromise = null;
          throw error;
        });
    }
    return this.universePromise;
  }

  pendingScanReasons(tradeDates, usStatus, jpStatus) {
    if (!this.state) {
      return ['JP', 'US', 'GLOBAL', 'US_SECTORS', 'JP_SECTORS', 'ALL'];
    }
    if (this.fullScanInProgress) return [];
    const reasons = [];
    const jpNow = DateTime.now().setZone('Asia/Tokyo');
    const initialJP = this.state.lastJPScanKey == null;
    const initialUS = this.state.lastUSScanKey == null;
    const initialGlobal = this.state.lastGlobalScanKey == null;
    const initialUSSector = this.state.lastUSSectorScanKey == null;
    const initialJPSector = this.state.lastJPSectorScanKey == null;
    const initialAll = this.state.lastAllScanKey == null;
    const jpDue = !jpStatus.isWeekend && (jpNow.hour > JP_SCAN_HOUR || (jpNow.hour === JP_SCAN_HOUR && jpNow.minute >= JP_SCAN_MINUTE));
    const usDue = !usStatus.isWeekend && (jpNow.hour > US_SCAN_JST_HOUR || (jpNow.hour === US_SCAN_JST_HOUR && jpNow.minute >= US_SCAN_JST_MINUTE));
    if (initialJP || (jpDue && this.state.lastJPScanKey !== tradeDates.jp)) {
      reasons.push('JP');
    }
    if (initialUS || (usDue && this.state.lastUSScanKey !== tradeDates.us)) {
      reasons.push('US');
    }
    if (initialGlobal || (jpDue && this.state.lastGlobalScanKey !== tradeDates.jp)) {
      reasons.push('GLOBAL');
    }
    if (initialUSSector || (usDue && this.state.lastUSSectorScanKey !== tradeDates.us)) {
      reasons.push('US_SECTORS');
    }
    if (initialJPSector || (jpDue && this.state.lastJPSectorScanKey !== tradeDates.jp)) {
      reasons.push('JP_SECTORS');
    }
    const allKeyToday = `${tradeDates.jp}|${tradeDates.us}`;
    if (initialAll || (jpDue && this.state.lastAllScanKey !== allKeyToday)) {
      reasons.push('ALL');
    }
    return reasons;
  }

  collectPrioritySymbols(limit = PRIORITY_REFRESH_LIMIT) {
    if (!this.state || !this.state.snapshot || !Array.isArray(this.state.snapshot.items)) return [];
    const picks = [];
    const seen = new Set();
    const sortedQ1 = [...this.state.snapshot.items]
      .filter((item) => item && item.quadrant === 'Q1')
      .sort((a, b) => ((b.A ?? Number.NEGATIVE_INFINITY) - (a.A ?? Number.NEGATIVE_INFINITY)));
    for (const item of sortedQ1) {
      const sym = String(item.symbol || '').toUpperCase();
      if (!sym || seen.has(sym)) continue;
      picks.push(sym);
      seen.add(sym);
      if (picks.length >= limit) break;
    }
    if (picks.length < limit) {
      const dropEntries = this.currentQ1DropList().slice(0, Math.max(3, Math.floor(limit / 3)));
      dropEntries.forEach((entry) => {
        const sym = String(entry.symbol || '').toUpperCase();
        if (!sym || seen.has(sym)) return;
        picks.push(sym);
        seen.add(sym);
      });
    }
    if (this.state.history && picks.length < limit) {
      const tail = [...this.state.history].slice(-10);
      tail.forEach((evt) => {
        const sym = String(evt?.symbol || '').toUpperCase();
        if (!sym || seen.has(sym)) return;
        picks.push(sym);
        seen.add(sym);
      });
    }
    return picks.slice(0, limit);
  }

  shouldRunPriorityRefresh(usStatus, jpStatus) {
    if (!this.state) return false;
    if (!(usStatus?.isOpen || jpStatus?.isOpen)) return false;
    if (this.fullScanInProgress) return false;
    const symbols = this.collectPrioritySymbols();
    if (!symbols.length) return false;
    const last = this.state.lastPriorityRefreshAt || 0;
    const intervalMs = PRIORITY_REFRESH_INTERVAL_MIN * 60 * 1000;
    return Date.now() - last >= intervalMs;
  }

  async performPriorityRefresh(marketInfo) {
    if (!this.state) return;
    const symbolSet = this.collectPrioritySymbols();
    if (!symbolSet.length) {
      this.state.marketStatus = { us: marketInfo.usStatus, jp: marketInfo.jpStatus };
      return;
    }
    const universe = await this.ensureUniverse();
    const assetBySymbol = new Map(universe.map((asset) => [asset.symbol.toUpperCase(), asset]));
    const targets = symbolSet
      .map((sym) => assetBySymbol.get(sym))
      .filter((asset) => Boolean(asset));
    if (!targets.length) {
      this.state.marketStatus = { us: marketInfo.usStatus, jp: marketInfo.jpStatus };
      this.state.lastPriorityRefreshAt = Date.now();
      return;
    }
    console.log(`[Q1Monitor] priority refresh ${targets.length} symbols`);
    const updates = [];
    let index = 0;
    while (index < targets.length) {
      const batch = [];
      for (let i = 0; i < PRIORITY_REFRESH_CONCURRENCY && index < targets.length; i += 1, index += 1) {
        const asset = targets[index];
        batch.push((async () => {
          try {
            const candles = await fetchYahooChart(asset.symbol, '1d', '5d').catch(() => []);
            return { asset, price: extractLastClose(candles) };
          } catch (error) {
            console.warn(`[Q1Monitor] priority refresh failed for ${asset.symbol}:`, error);
            return { asset, price: null };
          }
        })());
      }
      // eslint-disable-next-line no-await-in-loop
      const chunk = await Promise.all(batch);
      updates.push(...chunk);
      if (PRIORITY_REFRESH_DELAY_MS > 0 && index < targets.length) {
        // eslint-disable-next-line no-await-in-loop
        await wait(PRIORITY_REFRESH_DELAY_MS);
      }
    }
    const priceMap = new Map();
    updates.forEach(({ asset, price }) => {
      if (price != null && Number.isFinite(price)) {
        priceMap.set(asset.symbol, price);
      }
    });
    if (priceMap.size) {
      const now = Date.now();
      const symbolsState = this.state.symbols || {};
      priceMap.forEach((price, symbol) => {
        const key = symbol;
        const entry = symbolsState[key] || {
          symbol: key,
          name: (assetBySymbol.get(symbol.toUpperCase()) || {}).name || key,
          market: (assetBySymbol.get(symbol.toUpperCase()) || {}).market || 'US',
          lastQuadrant: 'INIT',
          lastEnterAt: null,
          lastDropAt: null,
          lastEnterTradeDate: null,
          lastDropTradeDate: null,
          lastEnterEmailAt: null,
          lastDropEmailAt: null,
          lastMetrics: null,
          lastDropMetrics: null,
        };
        const asset = assetBySymbol.get(symbol.toUpperCase());
        if (asset) {
          entry.name = asset.name;
          entry.market = asset.market;
        }
        const metrics = { ...(entry.lastMetrics || {}) };
        metrics.lastPrice = price;
        entry.lastMetrics = metrics;
        entry.updatedAt = now;
        symbolsState[key] = entry;
      });
      this.state.symbols = symbolsState;
      if (this.state.snapshot?.items?.length) {
        const updatedItems = this.state.snapshot.items.map((item) => {
          const price = priceMap.get(item.symbol);
          if (price == null) return item;
          return { ...item, lastPrice: price };
        });
        this.state.snapshot = { ...this.state.snapshot, items: updatedItems };
      }
    }
    this.state.lastPriorityRefreshAt = Date.now();
    this.state.marketStatus = { us: marketInfo.usStatus, jp: marketInfo.jpStatus };
  }

  async runMarketScan(market) {
    const requested = String(market ?? '').toUpperCase();
    const allowed = new Set(['JP', 'US', 'GLOBAL', 'US_SECTORS', 'JP_SECTORS', 'ALL']);
    const sequence = requested === 'ALL'
      ? ['JP', 'US', 'GLOBAL', 'US_SECTORS', 'JP_SECTORS', 'ALL']
      : [requested || 'JP'];
    if (!sequence.every((reason) => allowed.has(reason))) {
      throw new Error('invalid_market');
    }
    const usStatus = marketStatus('America/New_York', US_SESSIONS);
    const jpStatus = marketStatus('Asia/Tokyo', JP_SESSIONS);
    const tradeDates = { us: sessionTradeDate('US'), jp: sessionTradeDate('JP') };
    for (const reason of sequence) {
      await this.performFullScan(reason, tradeDates, { usStatus, jpStatus });
    }
    if (this.state) {
      this.state.lastRun = Date.now();
      await this.saveState();
    }
  }

  scheduleNext() {
    const delay = Math.max(1, this.intervalMinutes) * 60 * 1000;
    this.timer = setTimeout(() => this.runLoop(false), delay);
  }

  async performFullScan(reason, tradeDates, marketInfo) {
    if (this.fullScanInProgress) return;
    this.fullScanInProgress = true;
    try {
      const universe = await this.ensureUniverse();
      let scanUniverse;
      switch (reason) {
        case 'JP':
          scanUniverse = universe.filter((asset) => asset.market === 'JP');
          break;
        case 'US':
          scanUniverse = universe.filter((asset) => asset.market === 'US');
          break;
        case 'GLOBAL':
          scanUniverse = universe.filter((asset) => CORE_ASSET_SYMBOLS.has(String(asset.symbol || '').toUpperCase()));
          break;
        case 'US_SECTORS':
          scanUniverse = universe.filter((asset) => US_SECTOR_SYMBOLS.has(String(asset.symbol || '').toUpperCase()));
          break;
        case 'JP_SECTORS':
          scanUniverse = universe.filter((asset) => JP_SECTOR_SYMBOLS.has(String(asset.symbol || '').toUpperCase()));
          break;
        case 'ALL':
          scanUniverse = universe;
          break;
        default:
          scanUniverse = universe;
          break;
      }
      console.log(`[Q1Monitor] starting full scan (${reason}) for ${scanUniverse.length} symbols`);
      const progressEvery = Math.max(1, FULL_SCAN_PROGRESS_EVERY);
      const startedAt = Date.now();
      const snapshot = await computeSnapshot(scanUniverse, {
        progressEvery,
        onProgress: ({ processed, total, etaMs }) => {
          if (!total) return;
          if (processed < total && processed % progressEvery !== 0) return;
          const percent = ((processed / total) * 100).toFixed(1);
          const eta = etaMs != null ? `${Math.round(etaMs / 60000)}m` : 'n/a';
          console.log(`[Q1Monitor] full scan (${reason}) progress ${processed}/${total} (${percent}%) ETA ${eta}`);
        },
        ...this.snapshotOptions,
      });
      this.failCount = 0;
      this.intervalMinutes = DEFAULT_INTERVAL_MIN;
      await this.updateStateWithSnapshot(reason, snapshot, marketInfo, tradeDates);
      if (this.state) {
        this.state.lastSuccessAt = snapshot.generatedAt;
        this.state.lastFullScanAt = snapshot.generatedAt;
        this.state.lastFullScanKey = `${reason}|${tradeDates.us}|${tradeDates.jp}`;
        this.state.universeSize = scanUniverse.length;
        const allScanKey = `${tradeDates.jp}|${tradeDates.us}`;
        switch (reason) {
          case 'JP':
            this.state.lastJPScanKey = tradeDates.jp;
            this.state.lastJPScanAt = snapshot.generatedAt;
            break;
          case 'US':
            this.state.lastUSScanKey = tradeDates.us;
            this.state.lastUSScanAt = snapshot.generatedAt;
            break;
          case 'GLOBAL':
            this.state.lastGlobalScanKey = tradeDates.jp;
            this.state.lastGlobalScanAt = snapshot.generatedAt;
            break;
          case 'US_SECTORS':
            this.state.lastUSSectorScanKey = tradeDates.us;
            this.state.lastUSSectorScanAt = snapshot.generatedAt;
            break;
          case 'JP_SECTORS':
            this.state.lastJPSectorScanKey = tradeDates.jp;
            this.state.lastJPSectorScanAt = snapshot.generatedAt;
            break;
          case 'ALL':
            this.state.lastAllScanKey = allScanKey;
            this.state.lastAllScanAt = snapshot.generatedAt;
            break;
          default:
            break;
        }
        const durationMin = ((Date.now() - startedAt) / 60000).toFixed(1);
        console.log(`[Q1Monitor] full scan (${reason}) completed in ${durationMin}m`);
      }
    } finally {
      this.fullScanInProgress = false;
    }
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.runLoop(true);
  }

  stop() {
    this.started = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async runLoop(initial = false) {
    if (!this.started) return;
    await this.runOnce(initial);
    if (!this.started) return;
    this.scheduleNext();
  }

  async runOnce(initial = false) {
    if (this.running) return;
    this.running = true;
    try {
      if (!this.state) await this.loadState();
      const usStatus = marketStatus('America/New_York', US_SESSIONS);
      const jpStatus = marketStatus('Asia/Tokyo', JP_SESSIONS);
      const tradeDates = { us: sessionTradeDate('US'), jp: sessionTradeDate('JP') };

      let performedScan = false;
      const scanReasons = this.pendingScanReasons(tradeDates, usStatus, jpStatus);
      for (const reason of scanReasons) {
        try {
          await this.performFullScan(reason, tradeDates, { usStatus, jpStatus });
          performedScan = true;
        } catch (error) {
          this.failCount += 1;
          if (this.failCount >= 1) this.intervalMinutes = FALLBACK_INTERVAL_MIN;
          if (this.state) this.state.lastError = String(error?.message || error);
          console.error(`[Q1Monitor] full scan (${reason}) failed:`, error);
        }
      }

      if (!performedScan && this.shouldRunPriorityRefresh(usStatus, jpStatus)) {
        try {
          await this.performPriorityRefresh({ usStatus, jpStatus });
        } catch (error) {
          console.error('[Q1Monitor] priority refresh failed:', error);
        }
      } else if (!performedScan && this.state) {
        this.state.marketStatus = { us: usStatus, jp: jpStatus };
      }
    } finally {
      if (this.state) {
        this.state.lastRun = Date.now();
        this.state.intervalMinutes = this.intervalMinutes;
        await this.saveState();
      }
      this.running = false;
    }
  }

  async updateStateWithSnapshot(reason, snapshot, marketInfo, tradeDates) {
    if (!this.state) return;
    const now = Date.now();
    const symbolsState = this.state.symbols || {};
    const events = [];
    for (const item of snapshot.items) {
      const prev = symbolsState[item.symbol] || {
        symbol: item.symbol,
        name: item.name,
        market: item.market,
        currency: item.currency || (item.market === 'JP' ? 'JPY' : 'USD'),
        cls: item.cls || 'EQ',
        lastQuadrant: 'INIT',
        lastEnterAt: null,
        lastDropAt: null,
        lastEnterTradeDate: null,
        lastDropTradeDate: null,
        lastEnterEmailAt: null,
        lastDropEmailAt: null,
        lastMetrics: null,
        lastDropMetrics: null,
        lastKnownPrice: null,
        lastKnownPriceAt: null,
        lastMetricsAt: null,
      };
      const metrics = {
        F: item.F,
        V: item.V,
        A: item.A,
        flowPercentile: item.fPct,
        valuePercentile: item.vPct,
        lastPrice: item.lastPrice,
        rp: item.rp,
      };
      prev.cls = item.cls || prev.cls || 'EQ';
      prev.currency = item.currency || prev.currency || (item.market === 'JP' ? 'JPY' : 'USD');
      if (Number.isFinite(item.lastPrice)) {
        prev.lastKnownPrice = Number(item.lastPrice);
        prev.lastKnownPriceAt = snapshot.generatedAt || now;
      }
      prev.lastMetricsAt = snapshot.generatedAt || now;
      const useUSTradeDate = reason === 'US' || reason === 'US_SECTORS' || reason === 'GLOBAL';
      const tradeDate = useUSTradeDate ? tradeDates.us : tradeDates.jp;
      const isQ1 = item.quadrant === 'Q1';
      const wasQ1 = prev.lastQuadrant === 'Q1';
      let emitted = null;
      if (isQ1 && !wasQ1) {
        if (prev.lastEnterTradeDate !== tradeDate) {
          emitted = {
            type: 'ENTER',
            ts: now,
            tradeDate,
            symbol: item.symbol,
            name: item.name,
            market: item.market,
            metrics,
          };
          prev.lastEnterAt = now;
          prev.lastEnterTradeDate = tradeDate;
          prev.lastEnterMetrics = metrics;
        }
        prev.lastQuadrant = 'Q1';
      } else if (!isQ1 && wasQ1) {
        if (prev.lastDropTradeDate !== tradeDate) {
          emitted = {
            type: 'DROP',
            ts: now,
            tradeDate,
            symbol: item.symbol,
            name: item.name,
            market: item.market,
            metrics,
          };
          prev.lastDropAt = now;
          prev.lastDropTradeDate = tradeDate;
          prev.lastDropMetrics = metrics;
        }
        prev.lastQuadrant = 'NON_Q1';
      } else {
        prev.lastQuadrant = isQ1 ? 'Q1' : prev.lastQuadrant === 'INIT' ? 'NON_Q1' : prev.lastQuadrant;
      }
      prev.lastMetrics = metrics;
      prev.name = item.name;
      prev.market = item.market;
      prev.currency = item.currency || prev.currency || (item.market === 'JP' ? 'JPY' : 'USD');
      if (Number.isFinite(item.lastPrice)) {
        prev.lastKnownPrice = item.lastPrice;
        prev.lastKnownPriceAt = snapshot.generatedAt;
      }
      symbolsState[item.symbol] = prev;
      if (emitted) {
        events.push(emitted);
      }
    }

    if (!Array.isArray(this.state.history)) this.state.history = [];
    events.forEach((evt) => {
      this.state.history.push(evt);
    });
    if (this.state.history.length > MAX_HISTORY) {
      this.state.history = this.state.history.slice(this.state.history.length - MAX_HISTORY);
    }

    if (events.length && this.emailEnabled && this.transporter) {
      await this.dispatchEmails(events);
    }

    this.state.symbols = symbolsState;
    this.ensureWatchlistArray();
    await this.ensureBenchmarkEntries();
    if (events.length) {
      await this.applyWatchlistEvents(events);
    }
    this.updateWatchlistPricesFromSnapshot(snapshot);
    await this.refreshPurchasePrices();
    await this.refreshBenchmarkPrices();
    if (!this.state.snapshotByMarket) {
      this.state.snapshotByMarket = { JP: null, US: null };
    }
    if (!this.state.snapshotByCategory) {
      this.state.snapshotByCategory = {};
    }
    if (reason === 'JP' || reason === 'US') {
      this.state.snapshotByMarket[reason] = {
        generatedAt: snapshot.generatedAt,
        items: snapshot.items,
      };
      const combinedItems = [
        ...(this.state.snapshotByMarket.JP?.items ?? []),
        ...(this.state.snapshotByMarket.US?.items ?? []),
      ];
      this.state.snapshot = {
        generatedAt: snapshot.generatedAt,
        items: combinedItems,
      };
      this.state.universeSize = combinedItems.length;
    } else {
      this.state.snapshotByCategory[reason] = {
        generatedAt: snapshot.generatedAt,
        items: snapshot.items,
      };
      if (reason === 'ALL') {
        this.state.snapshot = {
          generatedAt: snapshot.generatedAt,
          items: snapshot.items,
        };
        this.state.universeSize = snapshot.items.length;
      }
    }
    this.state.marketStatus = {
      us: marketInfo.usStatus,
      jp: marketInfo.jpStatus,
    };
    this.state.lastPriorityRefreshAt = snapshot.generatedAt;
    this.state.lastError = null;
  }

  normalizeWatchlistSymbol(symbol) {
    return String(symbol || '').trim().toUpperCase();
  }

  ensureWatchlistArray() {
    if (!this.state) return;
    if (!Array.isArray(this.state.watchlist)) {
      this.state.watchlist = [];
    }
  }

  findWatchlistEntries(symbol) {
    if (!this.state || !Array.isArray(this.state.watchlist)) return [];
    const target = this.normalizeWatchlistSymbol(symbol);
    return this.state.watchlist.filter((entry) => !entry?.benchmarkId && this.normalizeWatchlistSymbol(entry?.symbol) === target);
  }

  async ensureBenchmarkEntries() {
    if (!this.state) return;
    this.ensureWatchlistArray();
    const list = this.state.watchlist;
    const now = Date.now();
    let mutated = false;
    for (const def of BENCHMARK_DEFS) {
      let entry = list.find((item) => item?.benchmarkId === def.id);
      const baseDate = DateTime.fromISO(BENCHMARK_PURCHASE_DATE, { zone: def.market === 'JP' ? 'Asia/Tokyo' : 'America/New_York' });
      const baseTs = baseDate.isValid ? baseDate.toMillis() : null;
      if (!entry) {
        entry = {
          id: `BENCHMARK:${def.id}`,
          benchmarkId: def.id,
          symbol: def.symbol,
          name: def.name,
          market: def.market,
          currency: def.currency || (def.market === 'JP' ? 'JPY' : 'USD'),
          cls: def.cls || 'INDEX',
          firstEnterAt: baseTs,
          firstEnterTradeDate: BENCHMARK_PURCHASE_DATE,
          purchaseDate: BENCHMARK_PURCHASE_DATE,
          purchasePrice: null,
          purchasePriceSource: null,
          purchasePriceResolvedAt: null,
          purchasePriceCheckedAt: null,
          lastEventType: 'BENCHMARK',
          lastEventAt: now,
          lastEventTradeDate: BENCHMARK_PURCHASE_DATE,
          lastKnownPrice: null,
          lastKnownPriceAt: null,
          metricsAtEnter: null,
          reopenedCount: 0,
          createdAt: now,
          updatedAt: now,
        };
        list.push(entry);
        mutated = true;
      } else {
        let updated = false;
        if (entry.symbol !== def.symbol) { entry.symbol = def.symbol; updated = true; }
        if (entry.name !== def.name) { entry.name = def.name; updated = true; }
        if (entry.market !== def.market) { entry.market = def.market; updated = true; }
        if (!entry.cls) { entry.cls = def.cls || 'INDEX'; updated = true; }
        if (!entry.currency) { entry.currency = def.currency || (def.market === 'JP' ? 'JPY' : 'USD'); updated = true; }
        if (!entry.firstEnterTradeDate) { entry.firstEnterTradeDate = BENCHMARK_PURCHASE_DATE; updated = true; }
        if (!entry.purchaseDate) { entry.purchaseDate = BENCHMARK_PURCHASE_DATE; updated = true; }
        if (entry.firstEnterAt == null && baseTs != null) { entry.firstEnterAt = baseTs; updated = true; }
        if (updated) {
          entry.updatedAt = now;
        }
      }
    }
    if (mutated) {
      await this.refreshPurchasePrices();
      await this.refreshBenchmarkPrices(true);
    }
  }

  async resolvePurchasePrice(symbol, market, purchaseDate) {
    if (!symbol || !purchaseDate) {
      return { price: null, source: null, resolvedAt: Date.now() };
    }
    try {
      const candles = await fetchYahooChart(symbol, '1d', '5y').catch(() => []);
      if (!Array.isArray(candles) || candles.length === 0) {
        return { price: null, source: null, resolvedAt: Date.now() };
      }
      const zone = market === 'JP' ? 'Asia/Tokyo' : 'America/New_York';
      const target = String(purchaseDate);
      let chosen = null;
      for (const candle of candles) {
        const iso = isoDateFromUnix(candle.time, zone) || isoDateFromUnix(candle.time, 'UTC');
        if (!iso) continue;
        if (iso === target) {
          chosen = candle;
          break;
        }
        if (!chosen && iso > target) {
          chosen = candle;
        }
      }
      if (!chosen) {
        chosen = candles[candles.length - 1];
      }
      const open = Number.isFinite(chosen?.open) ? Number(chosen.open) : null;
      const close = Number.isFinite(chosen?.close) ? Number(chosen.close) : null;
      const price = open != null ? open : close;
      return { price, source: 'yahoo', resolvedAt: Date.now() };
    } catch (error) {
      console.warn('[Q1Monitor] purchase price lookup failed:', symbol, error?.message || error);
      return { price: null, source: null, resolvedAt: Date.now() };
    }
  }

  async ensurePurchasePrice(entry, force = false) {
    if (!entry || !entry.purchaseDate) return;
    const now = Date.now();
    const purchaseDt = DateTime.fromISO(String(entry.purchaseDate));
    if (!purchaseDt.isValid) return;
    if (purchaseDt > DateTime.now()) return;
    if (!force) {
      if (Number.isFinite(entry.purchasePrice)) return;
      if (entry.purchasePriceCheckedAt && (now - entry.purchasePriceCheckedAt) < PURCHASE_PRICE_RETRY_MS) return;
    }
    const result = await this.resolvePurchasePrice(entry.symbol, entry.market, entry.purchaseDate);
    entry.purchasePriceCheckedAt = result.resolvedAt;
    entry.purchasePriceResolvedAt = result.resolvedAt;
    if (Number.isFinite(result.price)) {
      entry.purchasePrice = result.price;
      entry.purchasePriceSource = result.source ?? entry.purchasePriceSource ?? null;
      entry.updatedAt = now;
    }
  }

  async handleWatchlistEnter(evt) {
    if (!this.state) return null;
    this.ensureWatchlistArray();
    const list = this.state.watchlist;
    const now = Date.now();
    const symbolUpper = this.normalizeWatchlistSymbol(evt.symbol);
    const entries = this.findWatchlistEntries(evt.symbol);
    const tradeDate = evt.tradeDate || null;
    let tradeDateIso = null;
    if (tradeDate) {
      const dt = DateTime.fromISO(String(tradeDate));
      if (dt.isValid) {
        tradeDateIso = dt.toISODate();
      }
    }
    if (!tradeDateIso) {
      tradeDateIso = evt.market === 'US' ? sessionTradeDate('US') : sessionTradeDate('JP');
    }
    const purchaseDt = nextBusinessDateFrom(tradeDateIso, evt.market === 'JP' ? 'Asia/Tokyo' : 'America/New_York');
    const purchaseDate = isoDateSafe(purchaseDt) || tradeDateIso;
    const eventDt = DateTime.fromISO(String(tradeDateIso));
    const cutoff = eventDt.isValid ? eventDt.minus({ months: WATCHLIST_DUPLICATE_MONTHS }) : null;
    let targetEntry = null;
    if (cutoff) {
      for (const entry of entries) {
        const refStr = entry.firstEnterTradeDate || entry.purchaseDate || null;
        const refDt = refStr ? DateTime.fromISO(String(refStr)) : null;
        if (refDt?.isValid && refDt >= cutoff) {
          if (!targetEntry) {
            targetEntry = entry;
          } else {
            const currentKey = targetEntry.firstEnterTradeDate || targetEntry.purchaseDate || '';
            const candidateKey = refStr || '';
            if (candidateKey > currentKey) {
              targetEntry = entry;
            }
          }
        }
      }
    }
    if (!targetEntry) {
      const suffix = purchaseDate || tradeDateIso || String(now);
      let idBase = `${symbolUpper}-${suffix}`;
      let id = idBase;
      let idx = 1;
      while (list.some((item) => item?.id === id)) {
        idx += 1;
        id = `${idBase}-${idx}`;
      }
      targetEntry = {
        id,
        symbol: evt.symbol,
        name: evt.name,
        market: evt.market,
        currency: this.state.symbols?.[evt.symbol]?.currency || (evt.market === 'JP' ? 'JPY' : 'USD'),
        firstEnterAt: evt.ts || now,
        firstEnterTradeDate: tradeDateIso,
        purchaseDate,
        purchasePrice: null,
        purchasePriceSource: null,
        purchasePriceResolvedAt: null,
        purchasePriceCheckedAt: null,
        lastEventType: 'ENTER',
        lastEventAt: evt.ts || now,
        lastEventTradeDate: tradeDateIso,
        lastKnownPrice: this.state.symbols?.[evt.symbol]?.lastKnownPrice ?? evt.metrics?.lastPrice ?? null,
        lastKnownPriceAt: this.state.symbols?.[evt.symbol]?.lastKnownPriceAt ?? null,
        metricsAtEnter: evt.metrics ?? null,
        reopenedCount: entries.length,
        benchmarkId: null,
        createdAt: now,
        updatedAt: now,
      };
      list.push(targetEntry);
    } else {
      targetEntry.lastEventType = 'ENTER';
      targetEntry.lastEventAt = evt.ts || now;
      targetEntry.lastEventTradeDate = tradeDateIso;
      targetEntry.name = evt.name || targetEntry.name;
      targetEntry.market = evt.market || targetEntry.market;
      targetEntry.currency = this.state.symbols?.[evt.symbol]?.currency || targetEntry.currency || (evt.market === 'JP' ? 'JPY' : 'USD');
      if (!targetEntry.firstEnterAt) targetEntry.firstEnterAt = evt.ts || now;
      if (!targetEntry.firstEnterTradeDate) targetEntry.firstEnterTradeDate = tradeDateIso;
      if (!targetEntry.purchaseDate) targetEntry.purchaseDate = purchaseDate;
      if (evt.metrics?.lastPrice != null && Number.isFinite(evt.metrics.lastPrice)) {
        targetEntry.lastKnownPrice = evt.metrics.lastPrice;
        targetEntry.lastKnownPriceAt = evt.ts || now;
      }
      targetEntry.metricsAtEnter = evt.metrics ?? targetEntry.metricsAtEnter ?? null;
      targetEntry.updatedAt = now;
    }
    return targetEntry;
  }

  async handleWatchlistDrop(evt) {
    if (!this.state) return;
    this.ensureWatchlistArray();
    const entries = this.findWatchlistEntries(evt.symbol);
    if (!entries.length) return;
    const sorted = [...entries].sort((a, b) => {
      const aKey = a.firstEnterTradeDate || a.purchaseDate || '';
      const bKey = b.firstEnterTradeDate || b.purchaseDate || '';
      if (aKey === bKey) return 0;
      return aKey > bKey ? 1 : -1;
    });
    const target = sorted[sorted.length - 1];
    const now = Date.now();
    target.lastEventType = 'DROP';
    target.lastEventAt = evt.ts || now;
    target.lastEventTradeDate = evt.tradeDate || target.lastEventTradeDate || null;
    target.name = evt.name || target.name;
    target.market = evt.market || target.market;
    target.updatedAt = now;
  }

  async applyWatchlistEvents(events) {
    if (!this.state || !events || !events.length) return;
    for (const evt of events) {
      try {
        if (evt.type === 'ENTER') {
          const entry = await this.handleWatchlistEnter(evt);
          if (entry) await this.ensurePurchasePrice(entry);
        } else if (evt.type === 'DROP') {
          this.handleWatchlistDrop(evt);
        }
      } catch (error) {
        console.warn('[Q1Monitor] watchlist update failed:', evt?.symbol, error?.message || error);
      }
    }
  }

  updateWatchlistPricesFromSnapshot(snapshot) {
    if (!this.state || !snapshot || !Array.isArray(snapshot.items)) return;
    this.ensureWatchlistArray();
    const list = this.state.watchlist;
    if (!list.length) return;
    const map = new Map();
    snapshot.items.forEach((item) => {
      if (Number.isFinite(item?.lastPrice)) {
        map.set(this.normalizeWatchlistSymbol(item.symbol), {
          price: Number(item.lastPrice),
          currency: item.currency || null,
        });
      }
    });
    const updatedAt = snapshot.generatedAt || Date.now();
    list.forEach((entry) => {
      if (!entry || entry.benchmarkId) return;
      const info = map.get(this.normalizeWatchlistSymbol(entry.symbol));
      if (!info) return;
      entry.lastKnownPrice = info.price;
      entry.lastKnownPriceAt = updatedAt;
      if (!entry.currency && info.currency) entry.currency = info.currency;
      entry.updatedAt = updatedAt;
    });
  }

  async refreshPurchasePrices(force = false) {
    if (!this.state) return;
    this.ensureWatchlistArray();
    for (const entry of this.state.watchlist) {
      if (!entry || entry.benchmarkId) continue;
      await this.ensurePurchasePrice(entry, force);
    }
  }

  async refreshBenchmarkPrices(force = false) {
    if (!this.state) return;
    this.ensureWatchlistArray();
    const now = Date.now();
    for (const entry of this.state.watchlist) {
      if (!entry?.benchmarkId) continue;
      if (!force && entry.lastKnownPriceAt && (now - entry.lastKnownPriceAt) < WATCHLIST_PRICE_STALE_MS) continue;
      try {
        const candles = await fetchYahooChart(entry.symbol, '1d', '1mo').catch(() => []);
        if (!Array.isArray(candles) || !candles.length) continue;
        const latest = candles[candles.length - 1];
        const close = Number.isFinite(latest?.close) ? Number(latest.close) : null;
        if (close != null) {
          entry.lastKnownPrice = close;
          entry.lastKnownPriceAt = now;
          entry.updatedAt = now;
        }
        if (!Number.isFinite(entry.purchasePrice)) {
          await this.ensurePurchasePrice(entry, true);
        }
      } catch (error) {
        console.warn('[Q1Monitor] benchmark price refresh failed:', entry.symbol, error?.message || error);
      }
    }
  }

  buildWatchlistSummary() {
    if (!this.state) return [];
    this.ensureWatchlistArray();
    const list = Array.isArray(this.state.watchlist) ? this.state.watchlist : [];
    if (!list.length) return [];

    const toNumber = (value) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : null;
    };
    const thresholds = {
      fPctMin: this.snapshotOptions?.fPctMin ?? DEFAULT_F_PCTL_MIN,
      vPctMin: this.snapshotOptions?.vPctMin ?? DEFAULT_V_PCTL_MIN,
      fPctLow: this.snapshotOptions?.fPctLow ?? DEFAULT_F_PCTL_LOW,
      vPctLow: this.snapshotOptions?.vPctLow ?? DEFAULT_V_PCTL_LOW,
    };
    const classifyQuadrant = (flowPct, valuePct, fallback) => {
      if (Number.isFinite(flowPct) && Number.isFinite(valuePct)) {
        if (flowPct >= thresholds.fPctMin && valuePct >= thresholds.vPctMin) return 'Q1';
        if (flowPct >= thresholds.fPctMin && valuePct < thresholds.vPctMin) return 'Q2';
        if (flowPct < thresholds.fPctLow && valuePct >= thresholds.vPctMin) return 'Q3';
        if (flowPct < thresholds.fPctLow && valuePct < thresholds.vPctLow) return 'Q4';
        return 'NA';
      }
      const norm = typeof fallback === 'string' ? fallback.toUpperCase() : null;
      if (norm && ['Q1','Q2','Q3','Q4'].includes(norm)) return norm;
      return 'NA';
    };

    const summary = list.map((entry) => {
      const normalizedSymbol = this.normalizeWatchlistSymbol(entry.symbol);
      const symbolState = this.state.symbols?.[entry.symbol] || this.state.symbols?.[normalizedSymbol] || null;
      const latestMetricsRaw = symbolState?.lastMetrics || entry.lastMetrics || entry.metricsAtEnter || null;
      const metrics = latestMetricsRaw ? {
        F: toNumber(latestMetricsRaw.F),
        V: toNumber(latestMetricsRaw.V),
        A: toNumber(latestMetricsRaw.A),
        flowPercentile: toNumber(latestMetricsRaw.flowPercentile),
        valuePercentile: toNumber(latestMetricsRaw.valuePercentile),
        lastPrice: toNumber(latestMetricsRaw.lastPrice),
        rp: toNumber(latestMetricsRaw.rp),
      } : null;
      const flowPct = metrics?.flowPercentile ?? null;
      const valuePct = metrics?.valuePercentile ?? null;
      const derivedQuadrant = classifyQuadrant(flowPct, valuePct, symbolState?.lastQuadrant ?? entry.lastQuadrant ?? (entry.lastEventType === 'ENTER' ? 'Q1' : null));
      const cls = symbolState?.cls || entry.cls || (entry.benchmarkId ? 'INDEX' : 'EQ');
      const eventType = entry.lastEventType || (entry.benchmarkId ? 'BENCHMARK' : 'ENTER');
      let eventLabel = 'Event';
      if (eventType === 'ENTER') eventLabel = 'Entered Q1';
      else if (eventType === 'DROP') eventLabel = 'Dropped from Q1';
      else eventLabel = 'Benchmark';
      const firstDate = entry.firstEnterTradeDate || entry.purchaseDate || null;
      const daysElapsed = daysSince(firstDate);
      const purchasePrice = Number.isFinite(entry.purchasePrice) && entry.purchasePrice > 0 ? Number(entry.purchasePrice) : null;
      const currentPrice = Number.isFinite(entry.lastKnownPrice) ? Number(entry.lastKnownPrice) : null;
      let gainPct = null;
      if (purchasePrice != null && purchasePrice > 0 && currentPrice != null) {
        gainPct = ((currentPrice - purchasePrice) / purchasePrice) * 100;
      }
      const lastPrice = metrics?.lastPrice ?? currentPrice ?? purchasePrice ?? null;
      return {
        id: entry.id,
        symbol: entry.symbol,
        name: entry.name,
        market: entry.market,
        currency: entry.currency || null,
        cls,
        firstEnterTradeDate: entry.firstEnterTradeDate || null,
        purchaseDate: entry.purchaseDate || null,
        purchasePrice,
        currentPrice,
        lastPrice,
        gainPct: Number.isFinite(gainPct) ? gainPct : null,
        daysElapsed,
        lastEventType: eventType,
        lastEventAt: entry.lastEventAt || null,
        lastEventTradeDate: entry.lastEventTradeDate || null,
        eventLabel,
        isBenchmark: Boolean(entry.benchmarkId),
        purchasePriceSource: entry.purchasePriceSource || null,
        lastKnownPriceAt: entry.lastKnownPriceAt || null,
        metrics,
        quadrant: derivedQuadrant,
        flowPercentile: flowPct,
        valuePercentile: valuePct,
        F: metrics?.F ?? null,
        V: metrics?.V ?? null,
        A: metrics?.A ?? null,
        rp: metrics?.rp ?? null,
        lastMetricsAt: symbolState?.lastMetricsAt ?? null,
      };
    });

    return summary.sort((a, b) => {
      if (a.isBenchmark && !b.isBenchmark) return -1;
      if (!a.isBenchmark && b.isBenchmark) return 1;
      const aKey = a.firstEnterTradeDate || a.purchaseDate || '';
      const bKey = b.firstEnterTradeDate || b.purchaseDate || '';
      if (aKey === bKey) return a.symbol.localeCompare(b.symbol);
      return aKey > bKey ? -1 : 1;
    });
  }

  async dispatchEmails(events) {
    if (!this.transporter || !this.emailConfig) return;
    for (const evt of events) {
      try {
        const subject = evt.type === 'ENTER'
          ? `[Q1] ${evt.symbol} ENTERED Q1`
          : `[Q1] ${evt.symbol} LEFT Q1`;
        const lines = [
          `Symbol: ${evt.symbol} (${evt.name})`,
          `Market: ${evt.market}`,
          `Event: ${evt.type === 'ENTER' ? 'Entered Q1' : 'Dropped from Q1'}`,
          `Detected at: ${new Date(evt.ts).toISOString()}`,
          `Trade date: ${evt.tradeDate}`,
          `Flow z-score: ${evt.metrics.F != null ? evt.metrics.F.toFixed(2) : 'n/a'} (pct ${evt.metrics.flowPercentile ?? 'n/a'})`,
          `Value z-score: ${evt.metrics.V != null ? evt.metrics.V.toFixed(2) : 'n/a'} (pct ${evt.metrics.valuePercentile ?? 'n/a'})`,
          `Composite A: ${evt.metrics.A != null ? evt.metrics.A.toFixed(2) : 'n/a'}`,
          `Last price (USD): ${evt.metrics.lastPrice != null ? evt.metrics.lastPrice.toFixed(2) : 'n/a'}`,
        ];
        const textBody = lines.join('\n');
        const htmlBody = `<p>${lines.join('</p><p>')}</p>`;
        await this.transporter.sendMail({
          from: this.emailConfig.from,
          to: this.emailConfig.to,
          subject,
          text: textBody,
          html: htmlBody,
        });
        const symbolState = this.state?.symbols?.[evt.symbol];
        if (symbolState) {
          if (evt.type === 'ENTER') symbolState.lastEnterEmailAt = evt.ts;
          if (evt.type === 'DROP') symbolState.lastDropEmailAt = evt.ts;
        }
        await wait(250);
      } catch (error) {
        console.error('[Q1Monitor] email dispatch failed:', error);
      }
    }
  }

  currentQ1List(market) {
    if (!this.state?.snapshot?.items) return [];
    const list = [];
    this.state.snapshot.items.forEach((item) => {
      if (item.quadrant === 'Q1' && (!market || item.market === market)) {
        const meta = this.state.symbols?.[item.symbol] || {};
        list.push({
          symbol: item.symbol,
          name: item.name,
          market: item.market,
          detectedAt: meta.lastEnterAt || null,
          tradeDate: meta.lastEnterTradeDate || null,
          metrics: meta.lastMetrics || null,
        });
      }
    });
    return list;
  }

  currentQ1DropList(market) {
    if (!this.state?.symbols) return [];
    const now = Date.now();
    const cutoff = now - DROP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const list = [];
    Object.values(this.state.symbols).forEach((entry) => {
      if (!entry) return;
      if (market && entry.market !== market) return;
      const lastDrop = entry.lastDropAt;
      const lastEnter = entry.lastEnterAt;
      if (!lastDrop || lastDrop < cutoff) return;
      if (lastEnter && lastEnter > lastDrop) return;
      list.push({
        symbol: entry.symbol,
        name: entry.name,
        market: entry.market,
        droppedAt: entry.lastDropAt,
        tradeDate: entry.lastDropTradeDate,
        metrics: entry.lastDropMetrics || entry.lastMetrics || null,
      });
    });
    return list;
  }

  buildScanSummary() {
    if (!this.state) return {};
    const snapshotByMarket = this.state.snapshotByMarket ?? { JP: null, US: null };
    const snapshotByCategory = this.state.snapshotByCategory ?? {};
    const baseSnapshot = this.state.snapshot ?? null;
    const lastAtMap = {
      JP: this.state.lastJPScanAt ?? null,
      US: this.state.lastUSScanAt ?? null,
      GLOBAL: this.state.lastGlobalScanAt ?? null,
      US_SECTORS: this.state.lastUSSectorScanAt ?? null,
      JP_SECTORS: this.state.lastJPSectorScanAt ?? null,
      ALL: this.state.lastAllScanAt ?? null,
    };
    const tradeKeyMap = {
      JP: this.state.lastJPScanKey ?? null,
      US: this.state.lastUSScanKey ?? null,
      GLOBAL: this.state.lastGlobalScanKey ?? null,
      US_SECTORS: this.state.lastUSSectorScanKey ?? null,
      JP_SECTORS: this.state.lastJPSectorScanKey ?? null,
      ALL: this.state.lastAllScanKey ?? null,
    };
    const reasons = ['JP', 'US', 'GLOBAL', 'US_SECTORS', 'JP_SECTORS', 'ALL'];
    const summary = {};
    reasons.forEach((reason) => {
      let snapshot;
      if (reason === 'JP' || reason === 'US') {
        snapshot = snapshotByMarket[reason] || null;
      } else if (reason === 'ALL') {
        snapshot = snapshotByCategory.ALL || baseSnapshot || null;
      } else {
        snapshot = snapshotByCategory[reason] || null;
      }
      const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
      const q1Count = items.filter((item) => item?.quadrant === 'Q1').length;
      summary[reason] = {
        reason,
        generatedAt: snapshot?.generatedAt ?? null,
        lastScanAt: lastAtMap[reason] ?? null,
        tradeDate: tradeKeyMap[reason] ?? null,
        total: items.length,
        q1Count,
      };
    });
    return summary;
  }

  getStatus() {
    if (!this.state) return { enabled: false };
    return {
      enabled: true,
      lastRun: this.state.lastRun,
      lastSuccessAt: this.state.lastSuccessAt,
      intervalMinutes: this.state.intervalMinutes,
      marketStatus: this.state.marketStatus,
      currentQ1: this.currentQ1List(),
      currentQ1Drop: this.currentQ1DropList(),
      currentQ1JP: this.currentQ1List('JP'),
      currentQ1US: this.currentQ1List('US'),
      currentQ1DropJP: this.currentQ1DropList('JP'),
      currentQ1DropUS: this.currentQ1DropList('US'),
      recentEvents: (this.state.history || []).slice(-20).reverse(),
      snapshotGeneratedAt: this.state.snapshot?.generatedAt || null,
      universeSize: this.state.universeSize || 0,
      emailConfigured: this.emailEnabled,
      lastFullScanAt: this.state.lastFullScanAt || null,
      lastPriorityRefreshAt: this.state.lastPriorityRefreshAt || null,
      lastJPScanAt: this.state.lastJPScanAt || null,
      lastUSScanAt: this.state.lastUSScanAt || null,
      lastGlobalScanAt: this.state.lastGlobalScanAt || null,
      lastUSSectorScanAt: this.state.lastUSSectorScanAt || null,
      lastJPSectorScanAt: this.state.lastJPSectorScanAt || null,
      lastAllScanAt: this.state.lastAllScanAt || null,
      scanSummary: this.buildScanSummary(),

      thresholds: {
        fPctMin: this.snapshotOptions?.fPctMin ?? DEFAULT_F_PCTL_MIN,
        vPctMin: this.snapshotOptions?.vPctMin ?? DEFAULT_V_PCTL_MIN,
        fPctLow: this.snapshotOptions?.fPctLow ?? DEFAULT_F_PCTL_LOW,
        vPctLow: this.snapshotOptions?.vPctLow ?? DEFAULT_V_PCTL_LOW,
      },
    };
  }

  getAnalysis() {
    if (!this.state) return { enabled: false };
    return {
      enabled: true,
      generatedAt: this.state.snapshot?.generatedAt || null,
      currentQ1: this.currentQ1List(),
      currentQ1Drop: this.currentQ1DropList(),
      currentQ1JP: this.currentQ1List('JP'),
      currentQ1US: this.currentQ1List('US'),
      currentQ1DropJP: this.currentQ1DropList('JP'),
      currentQ1DropUS: this.currentQ1DropList('US'),
      history: this.state.history || [],
      watchlist: this.buildWatchlistSummary(),
      scanSummary: this.buildScanSummary(),
      thresholds: {
        fPctMin: this.snapshotOptions?.fPctMin ?? DEFAULT_F_PCTL_MIN,
        vPctMin: this.snapshotOptions?.vPctMin ?? DEFAULT_V_PCTL_MIN,
        fPctLow: this.snapshotOptions?.fPctLow ?? DEFAULT_F_PCTL_LOW,
        vPctLow: this.snapshotOptions?.vPctLow ?? DEFAULT_V_PCTL_LOW,
      },
    };
  }
}

export { Q1Monitor };
















