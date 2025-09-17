import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { read, utils } from 'xlsx';

const NASDAQ_LISTED_URL = 'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt';
const OTHER_LISTED_URL = 'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt';
const JPX_LIST_URL = 'https://www.jpx.co.jp/markets/statistics-equities/misc/tvdivq0000001vg2-att/data_j.xls';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'web', 'public', 'data');

const EXCHANGE_MAP = {
  A: 'NYSE American',
  N: 'NYSE',
  P: 'NYSE Arca',
  Z: 'BATS',
  V: 'IEX',
};

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeSecurityName(name) {
  return name
    .replace(/\s+Common Stock$/i, '')
    .replace(/\s+Class\s+([A-Z0-9]+)$/i, (_, c) => ` Class ${c.toUpperCase()}`)
    .replace(/\s+Depositary Shares? representing/gi, '')
    .replace(/\s+ADR$/gi, ' ADR')
    .trim();
}

function pushKeywords(set, ...values) {
  values.forEach((value) => {
    if (!value) return;
    const normalized = slugify(String(value));
    if (normalized) {
      normalized.split(' ').forEach((token) => {
        if (token) set.add(token);
      });
    }
  });
}

function createEntry(symbol, name, extra = {}) {
  const keywords = new Set();
  pushKeywords(keywords, symbol, name, extra.code, extra.exchange, extra.market);
  if (Array.isArray(extra.aliases)) {
    extra.aliases.forEach((alias) => pushKeywords(keywords, alias));
  }
  return {
    symbol,
    name,
    exchange: extra.exchange ?? null,
    market: extra.market ?? null,
    region: extra.region ?? 'US',
    assetType: extra.assetType ?? 'stock',
    code: extra.code ?? null,
    keywords: Array.from(keywords),
  };
}

function mergeEntry(map, entry) {
  const prev = map.get(entry.symbol);
  if (!prev) {
    map.set(entry.symbol, entry);
    return;
  }
  const merged = {
    ...prev,
    ...entry,
    keywords: Array.from(new Set([...(prev.keywords ?? []), ...(entry.keywords ?? [])])),
  };
  map.set(entry.symbol, merged);
}

function assetTypeFromName(name, fallback = 'stock') {
  const upper = name.toUpperCase();
  if (/ETF|ETN/.test(upper)) return 'etf';
  if (/REIT/.test(upper)) return 'reit';
  if (/FUND/.test(upper) && !/ETF/.test(upper)) return 'fund';
  return fallback;
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.text();
}

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function stripFooters(lines) {
  return lines.filter(
    (line) => line && !line.startsWith('File Creation Time') && !line.startsWith('Symbol|File Creation Time'),
  );
}

function parseNasdaqListings(text) {
  const lines = stripFooters(text.trim().split(/\r?\n/));
  const header = lines.shift().split('|');
  const map = new Map();
  lines.forEach((line) => {
    const cols = line.split('|');
    if (cols.length < header.length) return;
    const record = {};
    header.forEach((key, idx) => {
      record[key] = cols[idx];
    });
    if (record['Test Issue'] === 'Y') return;
    const symbol = record.Symbol?.trim();
    if (!symbol) return;
    const name = sanitizeSecurityName(record['Security Name'] || '');
    if (!name) return;
    const marketCategory = record['Market Category'];
    let exchange = 'NASDAQ';
    if (marketCategory === 'G') exchange = 'NASDAQ Global Select';
    else if (marketCategory === 'Q') exchange = 'NASDAQ Global Market';
    else if (marketCategory === 'S') exchange = 'NASDAQ Capital Market';
    const assetType = record.ETF === 'Y' ? 'etf' : assetTypeFromName(name);
    const entry = createEntry(symbol, name, {
      exchange,
      market: marketCategory || null,
      region: 'US',
      assetType,
    });
    mergeEntry(map, entry);
  });
  return map;
}

function parseOtherListings(text, baseMap) {
  const lines = stripFooters(text.trim().split(/\r?\n/));
  const header = lines.shift().split('|');
  lines.forEach((line) => {
    const cols = line.split('|');
    if (cols.length < header.length) return;
    const record = {};
    header.forEach((key, idx) => {
      record[key] = cols[idx];
    });
    if (record['Test Issue'] === 'Y') return;
    const symbol = record['ACT Symbol']?.trim();
    if (!symbol) return;
    const name = sanitizeSecurityName(record['Security Name'] || '');
    if (!name) return;
    const exchangeCode = record.Exchange?.trim();
    const exchange = EXCHANGE_MAP[exchangeCode] || 'NYSE';
    const assetType = record.ETF === 'Y' ? 'etf' : assetTypeFromName(name);
    const entry = createEntry(symbol, name, {
      exchange,
      region: 'US',
      assetType,
    });
    mergeEntry(baseMap, entry);
  });
  return baseMap;
}

async function loadUsSymbols() {
  const [nasdaqText, otherText] = await Promise.all([fetchText(NASDAQ_LISTED_URL), fetchText(OTHER_LISTED_URL)]);
  const map = parseNasdaqListings(nasdaqText);
  parseOtherListings(otherText, map);
  return Array.from(map.values());
}

const JP_HEADERS = {
  code: 'コード',
  name: '銘柄名',
  market: '市場・商品区分',
};

async function loadJpSymbols() {
  const buffer = await fetchBuffer(JPX_LIST_URL);
  const workbook = read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = utils.sheet_to_json(sheet, { header: 1, blankrows: false });
  const headerRow = rows[0].map((value) => String(value).trim());
  const idxCode = headerRow.indexOf(JP_HEADERS.code);
  const idxName = headerRow.indexOf(JP_HEADERS.name);
  const idxMarket = headerRow.indexOf(JP_HEADERS.market);
  if (idxCode === -1 || idxName === -1) {
    throw new Error('Unexpected JPX header format');
  }
  const entries = [];
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row) continue;
    let code = String(row[idxCode] ?? '').trim();
    if (!code) continue;
    if (code.includes('-')) code = code.split('-')[0];
    const padded = code.padStart(4, '0');
    const name = String(row[idxName] ?? '').trim();
    if (!name) continue;
    const market = idxMarket >= 0 ? String(row[idxMarket] ?? '').trim() : '';
    let assetType = 'stock';
    if (market.includes('ETF') || market.includes('ETN')) assetType = 'etf';
    else if (market.includes('REIT')) assetType = 'reit';
    else if (market.includes('インフラファンド')) assetType = 'fund';
    const entry = createEntry(`${padded}.T`, name, {
      code: padded,
      exchange: market || 'TSE',
      region: 'JP',
      assetType,
      aliases: [name.replace(/\s+/g, ''), padded],
    });
    entries.push(entry);
  }
  return entries;
}

function manualSymbols() {
  return [
    createEntry('^GSPC', 'S&P 500', {
      exchange: 'Index',
      region: 'GLOBAL',
      assetType: 'index',
      aliases: ['sp500', 's&p500', 'standard and poor'],
    }),
    createEntry('^DJI', 'Dow Jones Industrial Average', {
      exchange: 'Index',
      region: 'GLOBAL',
      assetType: 'index',
      aliases: ['dow', 'dow jones'],
    }),
    createEntry('^IXIC', 'NASDAQ Composite', {
      exchange: 'Index',
      region: 'GLOBAL',
      assetType: 'index',
      aliases: ['nasdaq composite', 'nasdaq index'],
    }),
    createEntry('^NDX', 'NASDAQ 100', {
      exchange: 'Index',
      region: 'GLOBAL',
      assetType: 'index',
      aliases: ['nasdaq 100', 'ndx'],
    }),
    createEntry('^RUT', 'Russell 2000', {
      exchange: 'Index',
      region: 'GLOBAL',
      assetType: 'index',
      aliases: ['russell2000'],
    }),
    createEntry('^N225', '日経平均株価', {
      exchange: 'Index',
      region: 'JP',
      assetType: 'index',
      aliases: ['nikkei', '日経平均'],
    }),
    createEntry('^TOPX', 'TOPIX', {
      exchange: 'Index',
      region: 'JP',
      assetType: 'index',
      aliases: ['topix'],
    }),
    createEntry('^TNX', 'US 10Y Treasury Yield', {
      exchange: 'Index',
      region: 'GLOBAL',
      assetType: 'index',
      aliases: ['ust10y', '10y yield'],
    }),
    createEntry('GC=F', 'Gold Futures', {
      exchange: 'COMEX',
      region: 'GLOBAL',
      assetType: 'commodity',
      aliases: ['gold', 'gold futures', '金'],
    }),
    createEntry('SI=F', 'Silver Futures', {
      exchange: 'COMEX',
      region: 'GLOBAL',
      assetType: 'commodity',
      aliases: ['silver', '銀'],
    }),
    createEntry('BTC-USD', 'Bitcoin / USD', {
      exchange: 'Crypto',
      region: 'GLOBAL',
      assetType: 'crypto',
      aliases: ['bitcoin', 'btc'],
    }),
    createEntry('JPY=X', 'USD/JPY', {
      exchange: 'FX',
      region: 'GLOBAL',
      assetType: 'fx',
      aliases: ['ドル円', 'usd jpy', 'usdjpy'],
    }),
  ];
}

function computeCounts(entries) {
  const counts = {
    total: entries.length,
    byRegion: {},
    byAssetType: {},
  };
  entries.forEach((entry) => {
    counts.byRegion[entry.region] = (counts.byRegion[entry.region] || 0) + 1;
    counts.byAssetType[entry.assetType] = (counts.byAssetType[entry.assetType] || 0) + 1;
  });
  return counts;
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  console.log('Fetching symbol directories...');
  const [us, jp] = await Promise.all([loadUsSymbols(), loadJpSymbols()]);
  const manual = manualSymbols();

  const map = new Map();
  [...us, ...jp, ...manual].forEach((entry) => mergeEntry(map, entry));

  const entries = Array.from(map.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
  const counts = computeCounts(entries);

  const output = {
    version: 1,
    generatedAt: new Date().toISOString(),
    counts,
    sources: {
      us: NASDAQ_LISTED_URL,
      other: OTHER_LISTED_URL,
      jp: JPX_LIST_URL,
      manual: manual.length,
    },
    entries,
  };

  await fs.writeFile(path.join(OUT_DIR, 'symbols.json'), JSON.stringify(output, null, 2), 'utf8');
  console.log(`Wrote ${entries.length} symbol entries to ${path.join(OUT_DIR, 'symbols.json')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
