import express from 'express';

import compression from 'compression';

import morgan from 'morgan';

import path from 'node:path';

import fs from 'node:fs';

import dotenv from 'dotenv';

import { spawn } from 'node:child_process';

import { Q1Monitor } from './q1-monitor.mjs';

import { createTopixModule } from './topix.mjs';


import { fileURLToPath } from 'node:url';



const __filename = fileURLToPath(import.meta.url);

const __dirname = path.dirname(__filename);

const fsp = fs.promises;

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

dotenv.config({ path: path.resolve(PROJECT_ROOT, '.env') });

const US_INDUSTRY_HISTORY_PATH = path.resolve(PROJECT_ROOT, 'data/us-industries/history.json');

const US_INDUSTRY_TTL_MS = 24 * 60 * 60 * 1000;

const US_INDUSTRY_PERIOD = '5y';

const US_INDUSTRY_SCRIPT = path.resolve(PROJECT_ROOT, 'tools/us_industries/update_dataset.py');

const TOPIX_MODEL_CONFIG_PATH = path.resolve(PROJECT_ROOT, 'config/topix-model.json');

const TOPIX_DATA_DIR = path.resolve(PROJECT_ROOT, 'data/topix');

const TOPIX_HISTORY_PATH = path.resolve(TOPIX_DATA_DIR, 'history.json');

const TOPIX_LATEST_PATH = path.resolve(TOPIX_DATA_DIR, 'latest.json');

const TOPIX_LOG_PATH = path.resolve(PROJECT_ROOT, 'logs/topix-watch.log');

const TOPIX_HISTORY_CACHE_KEY = 'macro:topix:history';

const TOPIX_LATEST_CACHE_KEY = 'macro:topix:latest';

const TOPIX_REFRESH_TTL_MS = 24 * 60 * 60 * 1000;

const TOPIX_ADMIN_TOKEN = process.env.TOPIX_ADMIN_TOKEN || process.env.API_ADMIN_TOKEN || null;

const TOPIX_ADMIN_IPS = String(process.env.TOPIX_ADMIN_IPS || process.env.API_ADMIN_IPS || '').split(',').map((ip) => ip.trim()).filter(Boolean);

const US_INDUSTRY_PYTHON_CANDIDATES = [

  process.env.US_INDUSTRY_PYTHON,

  path.resolve(PROJECT_ROOT, 'backend/.venv/Scripts/python.exe'),

  path.resolve(PROJECT_ROOT, 'backend/.venv/bin/python'),

  'python3',

  'python',

];

let usIndustryLastPayload = null;

let usIndustryLastGeneratedAt = 0;

let usIndustryUpdatePromise = null;



const app = express();

app.use(compression());

app.use(morgan('dev'));

app.use(express.json({ limit: '2mb' }));



// Simple in-memory cache

const cache = new Map(); // key -> { ts: number, data: any, ttl: number }

const Q1_MONITOR_DISABLED = process.env.Q1_MONITOR_DISABLED === '1';

const Q1_MONITOR_DATA_DIR = path.resolve(PROJECT_ROOT, 'data/q1-monitor');

let q1Monitor = null;

if (!Q1_MONITOR_DISABLED) {

  q1Monitor = new Q1Monitor({ dataDir: Q1_MONITOR_DATA_DIR });

  q1Monitor.init().then(() => q1Monitor.start()).catch((err) => {

    console.error('Failed to start Q1 monitor:', err);

  });

}

const now = () => Date.now();



function setCache(key, data, ttlMs) {

  cache.set(key, { ts: now(), data, ttl: ttlMs });

}

function getCache(key) {

  const ent = cache.get(key);

  if (!ent) return null;

  if (now() - ent.ts > ent.ttl) { cache.delete(key); return null; }

  return ent.data;

}



async function fetchJson(url, init) {

  const res = await fetch(url, {

    headers: {

      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',

      'Accept': 'application/json, text/javascript, */*; q=0.01',

    },

    ...init,

  });

  if (!res.ok) {

    const txt = await res.text();

    throw new Error(`Upstream ${res.status}: ${txt.slice(0,200)}`);

  }

  return res.json();

}




async function fetchText(url, init) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/xml, text/xml, */*; q=0.1',
    },
    ...init,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Upstream ${res.status}: ${txt.slice(0,200)}`);
  }
  return res.text();
}

async function fetchJsonTry(urls, init) {

  let lastErr = null;

  for (const u of urls) {

    try { return await fetchJson(u, init); } catch (e) { lastErr = e; }

  }

  throw lastErr || new Error('all upstream failed');

}



app.get('/api/q1/status', (req, res) => {

  if (!q1Monitor) {

    return res.json({ enabled: false, reason: 'disabled' });

  }

  try {

    res.json(q1Monitor.getStatus());

  } catch (error) {

    res.status(500).json({ enabled: false, error: String(error?.message || error) });

  }

});



app.get('/api/q1/analysis', async (req, res) => {
  if (!q1Monitor) {
    return res.json({ enabled: false, reason: 'disabled' });
  }
  try {
    await q1Monitor.refreshWatchlistSpotPrices();
    res.json(q1Monitor.getAnalysis());
  } catch (error) {
    res.status(500).json({ enabled: false, error: String(error?.message || error) });
  }
});







app.post('/api/q1/run-scan', (req, res) => {

  if (!q1Monitor) {

    return res.status(503).json({ ok: false, error: 'disabled' });

  }

  try {

    const raw = (req.body?.market ?? req.query?.market ?? 'JP');

    const market = String(raw).toUpperCase();

    if (!['JP', 'US', 'ALL'].includes(market)) {

      return res.status(400).json({ ok: false, error: 'invalid_market' });

    }

    if (q1Monitor.fullScanInProgress) {

      return res.status(409).json({ ok: false, error: 'scan_in_progress' });

    }

    const run = async () => {

      try {

        if (market === 'ALL') {

          await q1Monitor.runMarketScan('JP');

          await q1Monitor.runMarketScan('US');

        } else {

          await q1Monitor.runMarketScan(market);

        }

      } catch (error) {

        console.error('[Q1Monitor] manual scan failed:', error);

      }

    };

    run();

    return res.status(202).json({ ok: true, started: market });

  } catch (error) {

    return res.status(500).json({ ok: false, error: String(error?.message || error) });

  }

});





function resolveUsIndustryPython() {

  for (const candidate of US_INDUSTRY_PYTHON_CANDIDATES) {

    if (!candidate) continue;

    const looksLikePath = candidate.includes('/') || candidate.includes('\\');

    if (looksLikePath) {

      if (fs.existsSync(candidate)) return candidate;

      continue;

    }

    return candidate;

  }

  throw new Error('Python executable for US industry updater not found. Set US_INDUSTRY_PYTHON env.');

}



async function readUsIndustryDatasetFromDisk() {

  try {

    const raw = await fsp.readFile(US_INDUSTRY_HISTORY_PATH, 'utf8');

    const payload = JSON.parse(raw);

    let generatedMs = null;

    if (typeof payload?.generatedAt === 'string') {

      const ts = Date.parse(payload.generatedAt);

      if (!Number.isNaN(ts)) generatedMs = ts;

    }

    if (!generatedMs) {

      const stat = await fsp.stat(US_INDUSTRY_HISTORY_PATH);

      generatedMs = stat.mtimeMs;

    }

    usIndustryLastPayload = payload;

    usIndustryLastGeneratedAt = generatedMs || Date.now();

    return payload;

  } catch (error) {

    console.warn('US industry dataset read failed:', error?.message || error);

    usIndustryLastPayload = null;

    usIndustryLastGeneratedAt = 0;

    return null;

  }

}



async function runUsIndustryUpdate() {

  const python = resolveUsIndustryPython();

  await new Promise((resolve, reject) => {

    const proc = spawn(python, [US_INDUSTRY_SCRIPT, '--period', US_INDUSTRY_PERIOD], {

      cwd: PROJECT_ROOT,

      stdio: ['ignore', 'pipe', 'pipe'],

    });

    let stderr = '';

    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('error', reject);

    proc.on('close', (code) => {

      if (code === 0) {

        resolve();

      } else {

        reject(new Error(`US industry updater exited with code ${code}: ${stderr.trim()}`));

      }

    });

  });

  await readUsIndustryDatasetFromDisk();

}



function ensureUsIndustryUpdate(force = false) {

  if (usIndustryUpdatePromise) {

    return force ? usIndustryUpdatePromise : usIndustryUpdatePromise.catch(() => {});

  }

  const promise = runUsIndustryUpdate()

    .catch((error) => {

      console.error('US industry dataset update failed:', error);

      throw error;

    })

    .finally(() => {

      usIndustryUpdatePromise = null;

    });

  usIndustryUpdatePromise = promise;

  return promise;

}



async function getUsIndustryDataset(force = false) {

  if (!usIndustryLastPayload) {

    await readUsIndustryDatasetFromDisk();

  }

  if (force) {

    await ensureUsIndustryUpdate(true);

    if (!usIndustryLastPayload) throw new Error('US industry dataset unavailable after update');

    return usIndustryLastPayload;

  }

  const stale = !usIndustryLastPayload || !usIndustryLastGeneratedAt || (Date.now() - usIndustryLastGeneratedAt > US_INDUSTRY_TTL_MS);

  if (stale) {

    ensureUsIndustryUpdate(false).catch(() => {});

  }

  if (!usIndustryLastPayload) {

    await ensureUsIndustryUpdate(true);

    if (!usIndustryLastPayload) throw new Error('US industry dataset unavailable');

  }

  return usIndustryLastPayload;

}





// US Industries dataset API (auto-refresh at most once per 24h)

app.get('/api/us-industries/history', async (req, res) => {

  const rawForce = String(req.query.force ?? '').toLowerCase();

  const force = rawForce === '1' || rawForce === 'true' || rawForce === 'yes';

  try {

    const payload = await getUsIndustryDataset(force);

    res.json(payload);

  } catch (error) {

    console.error('US industry dataset endpoint error:', error);

    res.status(500).json({ error: 'Failed to load US industry dataset' });

  }

});



// Normalize Yahoo Quote (to MarketQuote used by UI)

function normalizeQuote(q) {

  const price = q.regularMarketPrice;

  const prevClose = q.regularMarketPreviousClose ?? q.previousClose;

  const change = price != null && prevClose != null ? price - prevClose : undefined;

  const changePct = change != null && prevClose ? (change / prevClose) * 100 : undefined;

  const dividendYield = q.trailingAnnualDividendYield ?? q.dividendYield; // ratio

  return {

    symbol: q.symbol,

    name: q.shortName ?? q.longName ?? q.symbol,

    price: price ?? null,

    prevClose: prevClose ?? null,

    change: change != null ? Math.round(change * 100) / 100 : null,

    changePct: changePct != null ? Math.round(changePct * 100) / 100 : null,

    currency: q.currency ?? (q.symbol?.endsWith?.('.T') ? 'JPY' : 'USD'),

    per: q.trailingPE ?? q.forwardPE ?? null,

    pbr: q.priceToBook ?? null,

    dividendYieldPct: dividendYield != null ? Math.round(dividendYield * 10000) / 100 : null,

    marketCap: q.marketCap ?? null,

    updatedAt: Date.now(),

  };

}



// ----- Core APIs used by React UI -----



// Quotes (Record<symbol, MarketQuote>)

app.get('/api/quote', async (req, res) => {

  try {

    const symbolsParam = String(req.query.symbols || '').trim();

    if (!symbolsParam) return res.status(400).json({ error: 'symbols required' });

    const symbols = symbolsParam.split(',').map(s => s.trim()).filter(Boolean);

    const key = `q:${symbols.join(',')}`;

    const cached = getCache(key);

    if (cached) return res.json(cached);



    let result = {};

    try {

      // Primary: use Yahoo v7 quote API

      const urls = [

        `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(','))}`,

        `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(','))}`,

      ];

      const data = await fetchJsonTry(urls);

      (data?.quoteResponse?.result ?? []).forEach((q) => {

        result[q.symbol] = normalizeQuote(q);

      });

    } catch (e) {

      // Fallback: compose from chart v8 (5d/1d)

      const out = {};

      for (const s of symbols) {

        try {

          const data = await fetchJsonTry([

            `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=5d&interval=1d&includePrePost=false&events=div%2Csplits`,

            `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=5d&interval=1d&includePrePost=false&events=div%2Csplits`,

          ]);

          const r = data?.chart?.result?.[0] ?? {};

          const meta = r?.meta ?? {};

          const q = r?.indicators?.quote?.[0] ?? {};

          const closes = (q?.close || []).filter(v=>Number.isFinite(v));

          const price = closes.length ? closes[closes.length-1] : null;

          const prev = closes.length>1 ? closes[closes.length-2] : null;

          const norm = normalizeQuote({

            symbol: s,

            shortName: null,

            longName: null,

            regularMarketPrice: price,

            regularMarketPreviousClose: prev,

            currency: meta.currency || (s.endsWith('.T') ? 'JPY' : 'USD'),

            trailingPE: null,

            forwardPE: null,

            priceToBook: null,

            trailingAnnualDividendYield: null,

            dividendYield: null,

            marketCap: null,

          });

          out[s] = norm;

        } catch {}

      }

      result = out;

    }

    setCache(key, result, 30_000);

    res.json(result);

  } catch (e) {

    res.status(500).json({ error: String(e?.message || e) });

  }

});



const ESTAT_APP_ID = process.env.ESTAT_APP_ID?.trim() || null;
const ESTAT_CPI_STATS_CODE = process.env.ESTAT_CPI_STATS_CODE?.trim() || '00200573';
const ESTAT_CPI_STATS_ID = process.env.ESTAT_CPI_STATS_ID?.trim() || null;
const ESTAT_CPI_AREA_CODE = process.env.ESTAT_CPI_AREA_CODE?.trim() || null;
const ESTAT_CPI_CAT01_CODE = process.env.ESTAT_CPI_CAT01_CODE?.trim() || null;
const ESTAT_CPI_TAB_CODE = process.env.ESTAT_CPI_TAB_CODE?.trim() || null;
const ESTAT_CPI_CAT02_CODE = process.env.ESTAT_CPI_CAT02_CODE?.trim() || null;
const ESTAT_CPI_CAT03_CODE = process.env.ESTAT_CPI_CAT03_CODE?.trim() || null;
const ESTAT_AUTODISCOVER = process.env.ESTAT_AUTODISCOVER !== '0';
const ESTAT_API_BASE = 'https://api.e-stat.go.jp/rest/3.0/app/json';

const ESTAT_DEFAULT_CONFIG = {
  statsDataId: '0003427113',
  areaCode: '00000',
  cat01Code: '0001',
};

const ESTAT_CONFIG_READY = Boolean(
  ESTAT_APP_ID &&
  ESTAT_CPI_STATS_ID &&
  ESTAT_CPI_AREA_CODE &&
  ESTAT_CPI_CAT01_CODE,
);

let estatResolvedConfig = ESTAT_CONFIG_READY ? {
  statsDataId: ESTAT_CPI_STATS_ID,
  areaCode: ESTAT_CPI_AREA_CODE,
  cat01Code: ESTAT_CPI_CAT01_CODE,
  tabCode: ESTAT_CPI_TAB_CODE,
  cat02Code: ESTAT_CPI_CAT02_CODE,
  cat03Code: ESTAT_CPI_CAT03_CODE,
} : null;

let estatDiscoveryPromise = null;

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function buildEstatConfigFromEnv() {
  if (!ESTAT_CONFIG_READY) return null;
  return {
    statsDataId: ESTAT_CPI_STATS_ID,
    areaCode: ESTAT_CPI_AREA_CODE,
    cat01Code: ESTAT_CPI_CAT01_CODE,
    tabCode: ESTAT_CPI_TAB_CODE,
    cat02Code: ESTAT_CPI_CAT02_CODE,
    cat03Code: ESTAT_CPI_CAT03_CODE,
  };
}

function buildEstatUrl(endpoint, params) {
  const search = new URLSearchParams(params);
  return `${ESTAT_API_BASE}/${endpoint}?${search.toString()}`;
}

async function discoverEstatConfig() {
  if (!ESTAT_APP_ID) return null;
  try {
    const listParams = {
      appId: ESTAT_APP_ID,
      statsCode: ESTAT_CPI_STATS_CODE,
      limit: '100',
    };
    const listJson = await fetchJson(buildEstatUrl('getStatsList', listParams));
    const tables = toArray(listJson?.GET_STATS_LIST?.DATALIST_INF?.TABLE_INF);
    const target = tables.find((table) => String(table?.STATISTICS_NAME || '').includes('2020\u5e74\u57fa\u6e96'))
      || tables.find((table) => String(table?.TITLE?.$ || table?.TITLE || '').includes('2020\u5e74\u57fa\u6e96'))
      || null;
    const statsDataId = target?.['@id'] || ESTAT_DEFAULT_CONFIG.statsDataId;

    const metaParams = {
      appId: ESTAT_APP_ID,
      statsDataId,
      explanationGetFlg: 'N',
    };
    const metaJson = await fetchJson(buildEstatUrl('getMetaInfo', metaParams));
    const classObjs = toArray(metaJson?.GET_META_INFO?.METADATA_INF?.CLASS_INF?.CLASS_OBJ);

    const findClassCode = (classId, predicate) => {
      const obj = classObjs.find((entry) => entry?.['@id'] === classId);
      if (!obj) return null;
      const entries = toArray(obj.CLASS);
      const hit = entries.find((entry) => predicate(entry));
      return hit?.['@code'] || null;
    };

    const areaCode = ESTAT_CPI_AREA_CODE
      || findClassCode('area', (entry) => entry?.['@code'] === '00000' || String(entry?.['@name'] || '').includes('\u5168\u56fd'))
      || ESTAT_DEFAULT_CONFIG.areaCode;
    const cat01Code = ESTAT_CPI_CAT01_CODE
      || findClassCode('cat01', (entry) => entry?.['@code'] === '0001' || String(entry?.['@name'] || '').includes('\u7dcf\u5408'))
      || ESTAT_DEFAULT_CONFIG.cat01Code;
    const tabCode = ESTAT_CPI_TAB_CODE
      || findClassCode('tab', (entry) => entry?.['@code'] === '1' || String(entry?.['@name'] || '').includes('\u6307\u6570'))
      || null;

    return {
      statsDataId,
      areaCode,
      cat01Code,
      tabCode,
      cat02Code: ESTAT_CPI_CAT02_CODE || null,
      cat03Code: ESTAT_CPI_CAT03_CODE || null,
    };
  } catch (error) {
    console.warn('e-Stat configuration discovery failed:', error?.message || error);
    return null;
  }
}

async function ensureEstatConfig() {
  if (estatResolvedConfig) return estatResolvedConfig;

  const envConfig = buildEstatConfigFromEnv();
  if (envConfig) {
    estatResolvedConfig = envConfig;
    return envConfig;
  }

  if (!ESTAT_AUTODISCOVER) {
    estatResolvedConfig = { ...ESTAT_DEFAULT_CONFIG, tabCode: ESTAT_CPI_TAB_CODE || null, cat02Code: ESTAT_CPI_CAT02_CODE || null, cat03Code: ESTAT_CPI_CAT03_CODE || null };
    return estatResolvedConfig;
  }

  if (!estatDiscoveryPromise) {
    estatDiscoveryPromise = discoverEstatConfig().catch((error) => {
      console.warn('e-Stat discovery promise failed:', error?.message || error);
      return null;
    });
  }

  const discovered = await estatDiscoveryPromise;
  estatResolvedConfig = discovered || { ...ESTAT_DEFAULT_CONFIG, tabCode: ESTAT_CPI_TAB_CODE || null, cat02Code: ESTAT_CPI_CAT02_CODE || null, cat03Code: ESTAT_CPI_CAT03_CODE || null };
  return estatResolvedConfig;
}

function buildEstatCacheKey(config) {
  return `estat:cpi:index:${config.statsDataId}:${config.areaCode}:${config.cat01Code}:${config.tabCode || ''}:${config.cat02Code || ''}:${config.cat03Code || ''}`;
}

async function fetchEstatCpiIndexSeries(limit = 720) {
  if (!ESTAT_APP_ID) return null;
  const config = await ensureEstatConfig();
  if (!config) return null;

  const params = {
    appId: ESTAT_APP_ID,
    statsDataId: config.statsDataId,
    cdArea: config.areaCode,
    cdCat01: config.cat01Code,
    lang: 'J',
    metaGetFlg: 'N',
    cntGetFlg: 'N',
    sectionHeaderFlg: '2',
    startPosition: '1',
    limit: String(Math.max(limit, 120)),
  };
  if (config.tabCode) params.cdTab = config.tabCode;
  if (config.cat02Code) params.cdCat02 = config.cat02Code;
  if (config.cat03Code) params.cdCat03 = config.cat03Code;

  try {
    const json = await fetchJson(buildEstatUrl('getStatsData', params));
    const resultInfo = json?.GET_STATS_DATA?.RESULT;
    const statusCode = Number(resultInfo?.STATUS ?? 0);
    if (Number.isFinite(statusCode) && statusCode !== 0) {
      const msg = resultInfo?.ERROR_MSG || resultInfo?.ERROR_MSG_L1 || 'unknown error';
      throw new Error(`e-Stat API status ${statusCode}: ${msg}`);
    }
    const dataInf = json?.GET_STATS_DATA?.STATISTICAL_DATA?.DATA_INF?.VALUE;
    const values = toArray(dataInf);
    const series = values.map((entry) => {
      const iso = estatTimeToIso(entry?.['@time'] ?? entry?.time);
      const value = extractEstatValue(entry);
      if (!iso || !Number.isFinite(value)) return null;
      return { date: iso, value };
    }).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date));
    return { series, config };
  } catch (error) {
    console.warn('e-Stat CPI fetch failed:', error?.message || error);
    return null;
  }
}

function estatTimeToIso(timeCode) {
  if (!timeCode) return null;
  const str = String(timeCode).trim();
  if (!/^\d{8,10}$/.test(str)) return null;
  const year = str.slice(0, 4);
  const monthRaw = str.slice(-2);
  const monthNum = Number(monthRaw);
  if (!Number.isFinite(monthNum) || monthNum < 1 || monthNum > 12) return null;
  const normalizedMonth = String(monthNum).padStart(2, '0');
  return `${year}-${normalizedMonth}-01`;
}

function addMonthsToIso(iso, offsetMonths) {
  if (!iso) return null;
  const [yearStr, monthStr] = iso.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  const utcDate = new Date(Date.UTC(year, month - 1, 1));
  utcDate.setUTCMonth(utcDate.getUTCMonth() + offsetMonths);
  const newYear = utcDate.getUTCFullYear();
  const newMonth = utcDate.getUTCMonth() + 1;
  const yearPart = newYear.toString().padStart(4, '0');
  const monthPart = newMonth.toString().padStart(2, '0');
  return `${yearPart}-${monthPart}-01`;
}

function extractEstatValue(entry) {
  if (!entry) return null;
  const raw = entry.$ ?? entry['@value'] ?? entry.value ?? null;
  if (raw == null || raw === '-') return null;
  const numeric = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

function indexSeriesToYoY(series) {
  if (!Array.isArray(series) || series.length === 0) return [];
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  const valueByDate = new Map(sorted.map((row) => [row.date, row.value]));
  return sorted.map((row) => {
    const prevDate = addMonthsToIso(row.date, -12);
    const prevVal = valueByDate.get(prevDate);
    if (Number.isFinite(prevVal) && Number.isFinite(row.value) && prevVal !== 0) {
      const yoy = ((row.value / prevVal) - 1) * 100;
      return { date: row.date, value: yoy };
    }
    return { date: row.date, value: null };
  });
}

async function getEstatCpiSeries() {
  if (!ESTAT_APP_ID) return null;
  const config = await ensureEstatConfig();
  if (!config) return null;

  const cacheKey = buildEstatCacheKey(config);
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const result = await fetchEstatCpiIndexSeries();
  if (!result || !Array.isArray(result.series) || result.series.length === 0) return null;

  const yoySeries = indexSeriesToYoY(result.series);
  const payload = {
    index: result.series,
    yoy: yoySeries,
    config,
    updatedAt: Date.now(),
  };
  setCache(cacheKey, payload, 6 * 60 * 60_000);
  return payload;
}
const GAITAME_POLICY_URL = 'https://www.gaitame.com/market/seisakukinri_gdc.xml';
const GAITAME_POLICY_CACHE_KEY = 'gaitame:policy';
const GAITAME_POLICY_TTL = 30 * 60_000;

function toHalfWidth(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/\u3000/g, ' ');
}

function extractGaitameSection(xml, tag) {
  if (typeof xml !== 'string') return null;
  const startToken = `<${tag}>`;
  const endToken = `</${tag}>`;
  const start = xml.indexOf(startToken);
  if (start === -1) return null;
  const end = xml.indexOf(endToken, start);
  if (end === -1) return null;
  return xml.slice(start, end + endToken.length);
}

function extractGaitameItem(section, keyword) {
  if (typeof section !== 'string') return null;
  const itemRegex = keyword
    ? new RegExp(`<item\s+name="([^"]*${keyword}[^"]*)">([\s\S]*?)</item>`, 'i')
    : new RegExp(`<item\s+name="([^"]*)">([\s\S]*?)</item>`, 'i');
  const match = section.match(itemRegex);
  if (!match) return null;
  return { name: match[1], body: match[2] };
}

function extractSimpleTag(body, tag) {
  if (typeof body !== 'string') return null;
  const regex = new RegExp(`<${tag}>([\s\S]*?)</${tag}>`, 'i');
  const match = body.match(regex);
  return match ? match[1].trim() : null;
}

function normalizeGaitameRateText(text) {
  if (typeof text !== 'string') return null;
  const half = toHalfWidth(text);
  return half.replace(/％/g, '%').replace(/[\uFF5E\u301C]/g, '~').replace(/\s+/g, ' ').trim();
}

function parseGaitameRateValue(text) {
  if (typeof text !== 'string') return null;
  const cleaned = text.replace(/％/g, '').replace(/\s+/g, '').replace(/,/g, '');
  if (!cleaned) return null;
  const parts = cleaned.replace(/[\uFF5E\u301C]/g, '~').split('~').map((part) => Number(part)).filter((num) => Number.isFinite(num));
  if (parts.length === 0) {
    const single = Number(cleaned.replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(single) ? single : null;
  }
  return Math.max(...parts);
}

function parseGaitameDateString(str) {
  if (typeof str !== 'string' || !str.trim()) return null;
  const normalized = toHalfWidth(str)
    .replace(/[?N????]/g, '/')
    .replace(/[^0-9/]/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/|\/$/g, '');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length < 3) return null;
  const [yStr, mStr, dStr] = parts;
  const year = Number.parseInt(yStr, 10);
  const month = Number.parseInt(mStr, 10);
  const day = Number.parseInt(dStr, 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function parseGaitamePolicy(section, keyword) {
  const item = extractGaitameItem(section, keyword);
  if (!item) return null;
  const rateRaw = extractSimpleTag(item.body, 'rate');
  const publishedRaw = extractSimpleTag(item.body, 'published');
  const rateText = normalizeGaitameRateText(rateRaw);
  const value = parseGaitameRateValue(rateRaw);
  const published = parseGaitameDateString(publishedRaw);
  const sourceLabelParts = [item.name];
  if (rateText) sourceLabelParts.push(rateText);
  const sourceLabel = `Gaitame.com(${sourceLabelParts.join(' ')})`;
  return {
    value,
    rateText,
    date: published,
    displayName: item.name,
    sourceLabel,
  };
}

async function fetchGaitamePolicyRates() {
  const cached = getCache(GAITAME_POLICY_CACHE_KEY);
  if (cached) return cached;

  const xml = await fetchText(GAITAME_POLICY_URL);
  const jpSection = extractGaitameSection(xml, 'JP');
  const usSection = extractGaitameSection(xml, 'US');

  const jp = parseGaitamePolicy(jpSection, '政策金利') || parseGaitamePolicy(jpSection, '');
  const us = parseGaitamePolicy(usSection, 'Federal') || parseGaitamePolicy(usSection, '');

  const payload = {
    JP: jp || null,
    US: us || null,
    fetchedAt: Date.now(),
  };
  console.debug('gaitame policy parse', {
    jpRate: jp?.rateText || null,
    usRate: us?.rateText || null,
  });
  setCache(GAITAME_POLICY_CACHE_KEY, payload, GAITAME_POLICY_TTL);
  return payload;
}

async function fetchWorldBankIndicator(countryCode, indicator, options = {}) {
  const perPage = options?.perPage ?? 120;
  const url = `https://api.worldbank.org/v2/country/${encodeURIComponent(countryCode)}/indicator/${encodeURIComponent(indicator)}?per_page=${perPage}&format=json`;
  const json = await fetchJson(url);
  if (!Array.isArray(json) || json.length < 2 || !Array.isArray(json[1])) {
    throw new Error('World Bank API unexpected response');
  }
  const entries = json[1]
    .map((entry) => {
      const rawYear = entry?.date != null ? String(entry.date).trim() : '';
      if (!/^\d{4}$/.test(rawYear)) return null;
      const year = Number.parseInt(rawYear, 10);
      if (!Number.isFinite(year)) return null;
      const num = Number(entry?.value);
      return {
        year,
        date: `${rawYear}-12-31`,
        value: Number.isFinite(num) ? num : null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.year - b.year);
  return entries;
}

function expandAnnualSeriesToMonthly(series) {
  const out = [];
  const sorted = (series || [])
    .map((entry) => {
      const year = Number.isFinite(entry?.year) ? entry.year : Number.parseInt(String(entry?.date || '').slice(0, 4), 10);
      return {
        year,
        value: Number.isFinite(entry?.value) ? Number(entry.value) : null,
      };
    })
    .filter((entry) => Number.isFinite(entry.year))
    .sort((a, b) => a.year - b.year);
  let lastValue = null;
  let lastYear = null;
  for (const { year, value } of sorted) {
    if (Number.isFinite(value)) {
      lastValue = value;
    }
    if (lastValue == null) continue;
    lastYear = year;
    for (let m = 1; m <= 12; m += 1) {
      const month = String(m).padStart(2, '0');
      out.push({ date: `${year}-${month}-01`, value: lastValue });
    }
  }
  if (lastYear != null && lastValue != null) {
    const now = new Date();
    for (let year = lastYear + 1; year <= now.getFullYear(); year += 1) {
      const maxMonth = year === now.getFullYear() ? now.getMonth() + 1 : 12;
      for (let m = 1; m <= maxMonth; m += 1) {
        const month = String(m).padStart(2, '0');
        const key = `${year}-${month}-01`;
        out.push({ date: key, value: lastValue });
      }
    }
  }
  return out;
}

async function fetchFredCSV(seriesId) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`FRED CSV ${seriesId} HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines.shift();
  const out = [];
  for (const line of lines) {
    const [date, valRaw] = line.split(',');
    const v = valRaw === '.' ? null : Number(valRaw);
    out.push({ date, value: Number.isFinite(v) ? v : null });
  }
  return out;
}

const topixModule = createTopixModule({
  fetchJson,
  buildEstatUrl,
  ESTAT_APP_ID,
  fetchFredCSV,
  setCache,
  getCache,
  configPath: TOPIX_MODEL_CONFIG_PATH,
  dataDir: TOPIX_DATA_DIR,
  historyPath: TOPIX_HISTORY_PATH,
  latestPath: TOPIX_LATEST_PATH,
  logPath: TOPIX_LOG_PATH,
  historyCacheKey: TOPIX_HISTORY_CACHE_KEY,
  latestCacheKey: TOPIX_LATEST_CACHE_KEY,
  refreshTtl: TOPIX_REFRESH_TTL_MS,
});
const {
  refreshTopixData,
  getTopixHistory,
  getTopixLatest,
  getTopixLogs,
  scheduleTopixRefresh,
} = topixModule;

function extractClientIp(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const remote = req.socket?.remoteAddress || req.connection?.remoteAddress || '';
  const raw = forwarded || remote || '';
  return raw.replace('::ffff:', '').trim();
}

function isAllowedTopixAdmin(req) {
  if (TOPIX_ADMIN_IPS.length > 0) {
    const clientIp = extractClientIp(req);
    if (clientIp && !TOPIX_ADMIN_IPS.includes(clientIp)) {
      return false;
    }
  }
  if (TOPIX_ADMIN_TOKEN) {
    const token = String(req.headers?.['x-api-key'] || req.headers?.['x-admin-token'] || req.query?.token || req.body?.token || '').trim();
    if (token !== TOPIX_ADMIN_TOKEN) {
      return false;
    }
  }
  return true;
}

function latestNonNull(series) {
  for (let i = series.length - 1; i >= 0; i -= 1) {
    const v = series[i]?.value;
    if (Number.isFinite(v)) return { index: i, value: v, date: series[i].date };
  }
  return null;
}

function yoyPct(series) {
  const last = latestNonNull(series);
  if (!last) return null;
  const idx = last.index;
  if (idx - 12 < 0) return null;
  const prev = series[idx - 12]?.value;
  if (!Number.isFinite(prev)) return null;
  return ((last.value / prev) - 1) * 100;
}

function yoySeriesFull(series) {
  return series.map((entry, idx) => {
    const currVal = entry?.value;
    let nextVal = null;
    if (idx >= 12) {
      const prevVal = series[idx - 12]?.value;
      if (Number.isFinite(currVal) && Number.isFinite(prevVal) && prevVal !== 0) {
        nextVal = ((currVal / prevVal) - 1) * 100;
      }
    }
    return { date: entry?.date, value: Number.isFinite(nextVal) ? nextVal : null };
  });
}

function toYearMonthKey(dateStr) {
  if (typeof dateStr !== 'string' || dateStr.length < 7) return null;
  return dateStr.slice(0, 7);
}

function seriesToNumericMap(series) {
  const map = new Map();
  for (const entry of series) {
    const key = toYearMonthKey(entry?.date);
    if (!key) continue;
    const value = entry?.value;
    map.set(key, Number.isFinite(value) ? Number(value) : null);
  }
  return map;
}

function pickNumber(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v == null) continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

async function getMacroUS() {
  const key = 'macro:us';
  const cached = getCache(key);
  if (cached) return cached;

  let gaitameRates = null;
  try {
    gaitameRates = await fetchGaitamePolicyRates();
  } catch (error) {
    console.warn('Gaitame policy fetch (US) failed:', error?.message || error);
  }

  const gaitameUS = gaitameRates?.US || null;

  let policyRate = Number.isFinite(gaitameUS?.value) ? gaitameUS.value : null;
  let policyDate = gaitameUS?.date ?? null;
  let policySource = gaitameUS?.sourceLabel ?? null;
  let policyRateText = gaitameUS?.rateText ?? null;

  let fedfunds = [];
  try {
    fedfunds = await fetchFredCSV('FEDFUNDS');
  } catch (error) {
    console.warn('FRED FEDFUNDS fetch failed:', error?.message || error);
  }
  const fedLatest = latestNonNull(fedfunds);

  if (!Number.isFinite(policyRate) && fedLatest) {
    policyRate = fedLatest.value ?? null;
    policyDate = fedLatest?.date ?? null;
    policySource = 'FRED(FEDFUNDS)';
    policyRateText = null;
  }

  let cpius = [];
  try {
    cpius = await fetchFredCSV('CPIAUCSL');
  } catch (error) {
    console.warn('FRED CPIAUCSL fetch failed:', error?.message || error);
  }
  const cpiYoY = cpius.length ? yoyPct(cpius) : null;
  const cpiDate = cpius.length ? latestNonNull(cpius)?.date ?? null : null;

  const payload = {
    policyRate: policyRate ?? null,
    policyRateText: policyRateText ?? null,
    policyDate: policyDate ?? null,
    policySource: policySource ?? (fedLatest ? 'FRED(FEDFUNDS)' : null),
    cpiYoY: cpiYoY ?? null,
    cpiDate,
    cpiSource: 'FRED(CPIAUCSL)',
    updatedAt: Date.now(),
    source: policySource?.startsWith('Gaitame.com') ? 'Gaitame & FRED' : 'FRED',
  };
  setCache(key, payload, 30 * 60_000);
  return payload;
}


async function getMacroJP() {
  const key = 'macro:jp';
  const cached = getCache(key);
  if (cached) return cached;

  let policyRate = null;
  let policyRateText = null;
  let policyDate = null;
  let policySource = null;

  let gaitameRates = null;
  try {
    gaitameRates = await fetchGaitamePolicyRates();
  } catch (error) {
    console.warn('Gaitame policy fetch (JP) failed:', error?.message || error);
  }
  const gaitameJP = gaitameRates?.JP || null;
  if (Number.isFinite(gaitameJP?.value)) {
    policyRate = gaitameJP.value;
    policyDate = gaitameJP?.date ?? null;
    policySource = gaitameJP?.sourceLabel ?? null;
    policyRateText = gaitameJP?.rateText ?? null;
  }

  if (!Number.isFinite(policyRate)) {
    try {
      const irJp = await fetchFredCSV('IR3TIB01JPM156N');
      const irLatest = latestNonNull(irJp);
      if (irLatest) {
        policyRate = irLatest.value ?? null;
        policyDate = irLatest?.date ?? null;
        policySource = 'FRED(IR3TIB01JPM156N)';
      }
    } catch (error) {
      console.warn('FRED IR3TIB01JPM156N fetch failed:', error?.message || error);
    }
  }

  let cpiYoY = null;
  let cpiDate = null;
  let cpiSource = null;
  let sourceLabel = policySource?.startsWith('Gaitame.com') ? 'Gaitame & FRED' : 'FRED';

  let estatSeries = null;
  try {
    estatSeries = await getEstatCpiSeries();
  } catch (error) {
    console.warn('e-Stat CPI fetch failed:', error?.message || error);
  }
  const estatYoY = estatSeries?.yoy || null;
  if (Array.isArray(estatYoY) && estatYoY.length) {
    const latest = [...estatYoY].reverse().find((entry) => Number.isFinite(entry?.value));
    if (latest) {
      cpiYoY = latest.value;
      cpiDate = latest.date;
      cpiSource = 'e-Stat(CPI All Items)';
      sourceLabel = policySource?.startsWith('Gaitame.com') ? 'Gaitame & e-Stat' : 'FRED & e-Stat';
    }
  }

  if (cpiYoY == null) {
    try {
      const wbSeries = await fetchWorldBankIndicator('JPN', 'FP.CPI.TOTL.ZG');
      if (Array.isArray(wbSeries) && wbSeries.length) {
        const latest = [...wbSeries].reverse().find((entry) => Number.isFinite(entry?.value));
        if (latest) {
          cpiYoY = latest.value;
          cpiDate = latest.date;
          cpiSource = 'WorldBank(FP.CPI.TOTL.ZG)';
          sourceLabel = policySource?.startsWith('Gaitame.com') ? 'Gaitame & WorldBank' : 'FRED & WorldBank';
        }
      }
    } catch (error) {
      console.warn('World Bank CPI fetch failed:', error?.message || error);
    }
  }

  if (cpiYoY == null) {
    try {
      const cpiJp = await fetchFredCSV('JPNCPIALLMINMEI');
      const jpYoY = yoyPct(cpiJp);
      const fredLatest = latestNonNull(cpiJp);
      cpiYoY = jpYoY ?? null;
      cpiDate = fredLatest?.date ?? null;
      cpiSource = 'FRED(JPNCPIALLMINMEI)';
      sourceLabel = policySource?.startsWith('Gaitame.com') ? 'Gaitame & FRED' : 'FRED';
    } catch (fallbackErr) {
      console.warn('FRED CPI fallback failed:', fallbackErr?.message || fallbackErr);
    }
  }

  const payload = {
    policyRate: policyRate ?? null,
    policyRateText: policyRateText ?? null,
    policyDate: policyDate ?? null,
    policySource: policySource ?? null,
    cpiYoY: cpiYoY ?? null,
    cpiDate: cpiDate ?? null,
    cpiSource: cpiSource ?? null,
    updatedAt: Date.now(),
    source: sourceLabel,
  };
  setCache(key, payload, 30 * 60_000);
  return payload;
}


async function fetchUsdJpyMonthlyHistory(months = 360) {
  const nowSec = Math.floor(Date.now() / 1000);
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months);
  const startSec = Math.floor(startDate.getTime() / 1000);
  const symbol = 'USDJPY=X';
  const query = `period1=${startSec}&period2=${nowSec}&interval=1mo&includePrePost=false&events=div%2Csplits`;
  const urls = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${query}`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${query}`,
  ];
  const data = await fetchJsonTry(urls);
  const result = data?.chart?.result?.[0];
  if (!result) return [];
  const ts = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0] ?? {};
  const closes = quote.close ?? [];
  const out = [];
  for (let i = 0; i < ts.length; i += 1) {
    const close = Number(closes[i]);
    const time = Number(ts[i]);
    if (!Number.isFinite(close) || close <= 0 || !Number.isFinite(time)) continue;
    const iso = new Date(time * 1000).toISOString().slice(0, 10);
    out.push({ date: iso, value: close });
  }
  return out;
}

async function getUsdJpyHistory() {
  const key = 'macro:usdjpy:history';
  const cached = getCache(key);
  if (cached) return cached;

  const months = 360;
  const [fedfunds, cpius, irJp, usdJpy, estatSeries, wbCpi, cpiJpFred] = await Promise.all([
    fetchFredCSV('FEDFUNDS'),
    fetchFredCSV('CPIAUCSL'),
    fetchFredCSV('IR3TIB01JPM156N'),
    fetchUsdJpyMonthlyHistory(months + 12),
    getEstatCpiSeries().catch((err) => {
      console.warn('e-Stat CPI history fetch failed:', err?.message || err);
      return null;
    }),
    fetchWorldBankIndicator('JPN', 'FP.CPI.TOTL.ZG').catch((err) => {
      console.warn('World Bank CPI history fetch failed:', err?.message || err);
      return null;
    }),
    fetchFredCSV('JPNCPIALLMINMEI').catch(() => null),
  ]);

  const usPolicyMap = seriesToNumericMap(fedfunds);
  const usCpiYoYMap = seriesToNumericMap(yoySeriesFull(cpius));
  const jpPolicyMap = seriesToNumericMap(irJp);
  const estatYoYSeries = estatSeries?.yoy || null;
  const estatHasYoY = Array.isArray(estatYoYSeries) && estatYoYSeries.some((entry) => Number.isFinite(entry?.value));
  const jpCpiSerie = estatHasYoY
    ? estatYoYSeries
    : (wbCpi && wbCpi?.length ? expandAnnualSeriesToMonthly(wbCpi) : (cpiJpFred ? yoySeriesFull(cpiJpFred) : []));
  const jpCpiYoYMap = seriesToNumericMap(jpCpiSerie);
  const jpCpiSourceLabel = estatHasYoY
    ? 'e-Stat(CPI All Items)'
    : (wbCpi && wbCpi?.length ? 'WorldBank(FP.CPI.TOTL.ZG)' : 'FRED(JPNCPIALLMINMEI)');
  const usdJpyMap = seriesToNumericMap(usdJpy);

  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - 30);
  const startKey = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`;

  const keys = new Set([
    ...usPolicyMap.keys(),
    ...usCpiYoYMap.keys(),
    ...jpPolicyMap.keys(),
    ...jpCpiYoYMap.keys(),
    ...usdJpyMap.keys(),
  ]);

  const sortedKeys = Array.from(keys).filter((key) => key >= startKey).sort();

  const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

  let lastUsPolicy = null;
  let lastUsCpi = null;
  let lastJpPolicy = null;
  let lastJpCpi = null;

  const history = sortedKeys.map((key) => {
    const date = `${key}-01`;
    const actual = usdJpyMap.get(key) ?? null;

    const rawUsPolicy = usPolicyMap.get(key);
    if (isFiniteNumber(rawUsPolicy)) lastUsPolicy = rawUsPolicy;
    const usPolicy = isFiniteNumber(rawUsPolicy) ? rawUsPolicy : lastUsPolicy;

    const rawUsCpi = usCpiYoYMap.get(key);
    if (isFiniteNumber(rawUsCpi)) lastUsCpi = rawUsCpi;
    const usCpi = isFiniteNumber(rawUsCpi) ? rawUsCpi : lastUsCpi;

    const rawJpPolicy = jpPolicyMap.get(key);
    if (isFiniteNumber(rawJpPolicy)) lastJpPolicy = rawJpPolicy;
    const jpPolicy = isFiniteNumber(rawJpPolicy) ? rawJpPolicy : lastJpPolicy;

    const rawJpCpi = jpCpiYoYMap.get(key);
    if (isFiniteNumber(rawJpCpi)) lastJpCpi = rawJpCpi;
    const jpCpi = isFiniteNumber(rawJpCpi) ? rawJpCpi : lastJpCpi;

    let theoretical = null;
    let diffPct = null;

    if (isFiniteNumber(usPolicy) && isFiniteNumber(usCpi) && isFiniteNumber(jpPolicy) && isFiniteNumber(jpCpi)) {
      const usReal = usPolicy - usCpi;
      const jpReal = jpPolicy - jpCpi;
      theoretical = 120 + 15 * (usReal - jpReal);
    }

    if (isFiniteNumber(actual) && isFiniteNumber(theoretical) && theoretical !== 0) {
      diffPct = ((actual - theoretical) / theoretical) * 100;
    }

    return {
      date,
      actual: isFiniteNumber(actual) ? actual : null,
      theoretical: isFiniteNumber(theoretical) ? theoretical : null,
      diffPct: isFiniteNumber(diffPct) ? diffPct : null,
    };
  }).filter((row) => row.actual != null || row.theoretical != null);

  const payload = {
    history,
    meta: {
      start: history[0]?.date ?? null,
      end: history[history.length - 1]?.date ?? null,
      months,
      sources: {
        actual: 'Yahoo Finance (USDJPY=X)',
        usPolicy: 'FRED(FEDFUNDS)',
        usCpi: 'FRED(CPIAUCSL)',
        jpPolicy: 'FRED(IR3TIB01JPM156N)',
        jpCpi: jpCpiSourceLabel,
      },
      updatedAt: Date.now(),
    },
  };
  setCache(key, payload, 6 * 60 * 60_000);
  return payload;
}

app.get('/api/macro/us', async (_req, res) => {
  try {
    const payload = await getMacroUS();
    res.json(payload);
  } catch (e) {
    console.error('macro/us error:', e?.message || e);
    res.status(500).json({ error: 'Failed to fetch US macro', detail: String(e?.message || e) });
  }
});

app.get('/api/macro/jp', async (_req, res) => {
  try {
    const payload = await getMacroJP();
    res.json(payload);
  } catch (e) {
    console.error('macro/jp error:', e?.message || e);
    res.status(500).json({ error: 'Failed to fetch JP macro', detail: String(e?.message || e) });
  }
});

app.get('/api/debug/gaitame', async (_req, res) => {
  try {
    const payload = await fetchGaitamePolicyRates();
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: String(error?.message || error) });
  }
});

app.get('/api/topix/history', async (req, res) => {
  try {
    const payload = await getTopixHistory();
    let history = Array.isArray(payload?.history) ? payload.history : [];
    const start = String(req.query.start || '').trim();
    const end = String(req.query.end || '').trim();
    if (start) history = history.filter((row) => row?.date >= start);
    if (end) history = history.filter((row) => row?.date <= end);
    res.json({ history, meta: payload?.meta || null });
  } catch (error) {
    console.error('topix history error:', error?.message || error);
    res.status(500).json({ error: 'Failed to fetch TOPIX history', detail: String(error?.message || error) });
  }
});

app.get('/api/topix/latest', async (_req, res) => {
  try {
    const payload = await getTopixLatest();
    res.json(payload || { data: null });
  } catch (error) {
    console.error('topix latest error:', error?.message || error);
    res.status(500).json({ error: 'Failed to fetch TOPIX latest', detail: String(error?.message || error) });
  }
});

app.get('/api/topix/logs', async (req, res) => {
  try {
    const tail = Number.parseInt(req.query.tail ?? '200', 10) || 200;
    const lines = await getTopixLogs(tail);
    res.json({ lines });
  } catch (error) {
    res.status(500).json({ error: 'Failed to read TOPIX logs', detail: String(error?.message || error) });
  }
});

app.post('/api/topix/recalc', async (req, res) => {
  if (!isAllowedTopixAdmin(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const payload = await refreshTopixData('manual');
    const latest = await getTopixLatest();
    res.json({ ok: true, historyRows: payload?.history?.length ?? 0, latest });
  } catch (error) {
    console.error('topix recalc error:', error?.message || error);
    res.status(500).json({ error: 'TOPIX recalculation failed', detail: String(error?.message || error) });
  }
});
app.get('/api/usdjpy/history', async (_req, res) => {
  try {
    const payload = await getUsdJpyHistory();
    res.json(payload);
  } catch (e) {
    console.error('macro/usdjpy history error:', e?.message || e);
    res.status(500).json({ error: 'Failed to fetch USDJPY macro history', detail: String(e?.message || e) });
  }
});


// Chart candles (D/W/M)



// Chart candles (D/W/M)

app.get('/api/chart', async (req, res) => {

  try {

    const symbol = String(req.query.symbol || '').trim();

    const tf = String(req.query.tf || 'D');

    if (!symbol) return res.status(400).json({ error: 'symbol required' });

    const range = tf === 'D' ? '1y' : tf === 'W' ? '5y' : '15y';

    const interval = tf === 'D' ? '1d' : tf === 'W' ? '1wk' : '1mo';

    const key = `c:${symbol}:${range}:${interval}`;

    const cached = getCache(key);

    if (cached) return res.json(cached);

    const urls = [

      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false&events=div%2Csplits`,

      `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false&events=div%2Csplits`,

    ];

    const data = await fetchJsonTry(urls);

    const r = data?.chart?.result?.[0];

    const ts = r?.timestamp ?? [];

    const quote = r?.indicators?.quote?.[0] ?? {};

    const out = ts.map((t, i) => ({

      time: t,

      open: Number(quote.open?.[i] ?? 0),

      high: Number(quote.high?.[i] ?? 0),

      low: Number(quote.low?.[i] ?? 0),

      close: Number(quote.close?.[i] ?? 0),

      value: Number(quote.volume?.[i] ?? 0),

    })).filter(c => Number.isFinite(c.close) && c.close > 0);

    setCache(key, out, tf === 'D' ? 15 * 60_000 : 2 * 60 * 60_000);

    res.json(out);

  } catch (e) {

    // Return empty candles instead of 500 to keep UI stable

    res.json([]);

  }

});



// Fundamentals (YoY metrics) via quoteSummary

app.get('/api/fundamentals', async (req, res) => {

  const fallback = { yoyRevenuePct: null, yoyOperatingIncomePct: null };

  let symbol = '';

  let key = '';

  try {

    symbol = String(req.query.symbol || '').trim();

    if (!symbol) return res.status(400).json({ error: 'symbol required' });

    key = `f:${symbol}`;

    const cached = getCache(key);

    if (cached) return res.json(cached);

    const modules = ['incomeStatementHistoryQuarterly','defaultKeyStatistics','financialData','summaryDetail'];

    const urls = [

      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules.join(',')}`,

      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules.join(',')}`,

    ];



    let data;

    try {

      data = await fetchJsonTry(urls);

    } catch (err) {

      console.warn('fundamentals upstream failed', symbol, err);

      if (key) setCache(key, fallback, 5 * 60_000);

      return res.json(fallback);

    }



    const r = data?.quoteSummary?.result?.[0] ?? {};

    const inc = r?.incomeStatementHistoryQuarterly?.incomeStatementHistory ?? [];

    let yoyRevenuePct = null;

    let yoyOperatingIncomePct = null;

    if (inc.length >= 5) {

      const latest = inc[0];

      const back = inc[4];

      const revA = latest?.totalRevenue?.raw;

      const revB = back?.totalRevenue?.raw;

      const opA = latest?.operatingIncome?.raw;

      const opB = back?.operatingIncome?.raw;

      if (revA != null && revB) yoyRevenuePct = Math.round(((revA - revB) / revB) * 10000) / 100;

      if (opA != null && opB) yoyOperatingIncomePct = Math.round(((opA - opB) / opB) * 10000) / 100;

    }

    const out = { yoyRevenuePct, yoyOperatingIncomePct };

    setCache(key, out, 12 * 60 * 60_000);

    return res.json(out);

  } catch (e) {

    console.warn('fundamentals handler error', symbol, e);

    if (key) setCache(key, fallback, 5 * 60_000);

    return res.json(fallback);

  }

});



// ----- Yahoo passthroughs for legacy NMY.html -----



// Compose quote-like response from chart API (5d/1d)

app.get('/api/yf/quote', async (req, res) => {

  try {

    const symbolsParam = String(req.query.symbols || '').trim();

    if (!symbolsParam) return res.status(400).json({ error: 'symbols required' });

    const syms = symbolsParam.split(',').map(s=>s.trim()).filter(Boolean);

    const results = {};

    for (const s of syms) {

      try {

        const data = await fetchJsonTry([

          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=5d&interval=1d&includePrePost=false&events=div%2Csplits`,

          `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=5d&interval=1d&includePrePost=false&events=div%2Csplits`,

        ]);

        const r = data?.chart?.result?.[0] ?? {};

        const q = r?.indicators?.quote?.[0] ?? {};

        const closes = (q?.close || []).filter(v=>Number.isFinite(v));

        const price = closes.length ? closes[closes.length-1] : null;

        const prev = closes.length>1 ? closes[closes.length-2] : null;

        results[s] = {

          symbol: s,

          regularMarketPrice: price,

          regularMarketPreviousClose: prev,

          longName: null,

          shortName: null,

          currency: s.endsWith('.T') ? 'JPY' : 'USD',

          price,

          prevClose: prev,

        };

      } catch {}

    }

    res.json({ quoteResponse: { result: Object.values(results) } });

  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }

});



app.get('/api/yf/history', async (req, res) => {

  try {

    const symbol = String(req.query.symbol || '').trim();

    const range = String(req.query.range || '1y');

    const interval = String(req.query.interval || '1d');

    if (!symbol) return res.status(400).json({ error: 'symbol required' });

    const key = `yf:h:${symbol}:${range}:${interval}`;

    const cached = getCache(key);

    if (cached) return res.json(cached);

    const urls = [

      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}&includePrePost=false&events=div%2Csplits`,

      `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}&includePrePost=false&events=div%2Csplits`,

    ];

    try {

      const data = await fetchJsonTry(urls);

      setCache(key, data, 15 * 60_000);

      res.json(data);

    } catch (e) {

      // Return a minimal empty Yahoo v8 chart shape with 200

      const empty = { chart: { result: [{ timestamp: [], indicators: { quote: [{}] } }] , error: null } };

      res.json(empty);

    }

  } catch (e) { res.json({ chart: { result: [{ timestamp: [], indicators: { quote: [{}] } }], error: null } }); }

});



app.get('/api/yf/fund', async (req, res) => {

  try {

    const symbol = String(req.query.symbol || '').trim();

    if (!symbol) return res.status(400).json({ error: 'symbol required' });

    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=price,quoteType,summaryProfile,assetProfile`;

    const data = await fetchJson(url);

    const r = data?.quoteSummary?.result?.[0] ?? {};

    const longName = r?.price?.longName ?? null;

    const shortName = r?.price?.shortName ?? r?.quoteType?.shortName ?? null;

    res.json({ longName, shortName });

  } catch (e) { res.json({ longName: null, shortName: null }); }

});



app.get('/api/yf/search', async (req, res) => {

  try {

    const q = String(req.query.q || '').trim();

    if (!q) return res.status(400).json({ error: 'q required' });

    const region = String(req.query.region || 'JP');

    const lang = String(req.query.lang || 'ja-JP');

    const urls = [

      `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=40&newsCount=0&listsCount=0&enableFuzzyQuery=true&lang=${encodeURIComponent(lang)}&region=${encodeURIComponent(region)}`,

      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=40&newsCount=0&listsCount=0&enableFuzzyQuery=true&lang=${encodeURIComponent(lang)}&region=${encodeURIComponent(region)}`,

    ];

    const data = await fetchJsonTry(urls);

    res.json(data);

  } catch (e) { res.json({ longName: null, shortName: null }); }

});



// Fear & Greed (stub)

app.get('/api/fgi', async (_req, res) => {

  try {

    const key = `fgi:cnn`;

    const cached = getCache(key);

    if (cached) return res.json(cached);

    const headers = {

      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36 NMY/1.0',

      'Accept': 'application/json,*/*',

      'Accept-Language': 'ja,en;q=0.9',

      'Referer': 'https://edition.cnn.com/markets/fear-and-greed',

      'Origin': 'https://edition.cnn.com',

    };

    const curU = 'https://production.dataviz.cnn.io/index/fearandgreed/current';

    const graphU = 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata';

    let now = null, previousClose = null;

    let history = [];

    try {

      const [cr, gr] = await Promise.all([

        fetch(curU, { headers }),

        fetch(graphU, { headers }),

      ]);

      const ct = await cr.text();

      const gt = await gr.text();

      let cj = null; try { cj = JSON.parse(ct); } catch {}

      let gj = null; try { gj = JSON.parse(gt); } catch {}

      now = Number(cj?.fear_and_greed?.now?.value ?? cj?.fear_and_greed?.now ?? cj?.now ?? cj?.score ?? null);

      previousClose = Number(cj?.fear_and_greed?.previous_close?.value ?? cj?.fear_and_greed?.previous_close ?? cj?.previous_close ?? null);

      const hist = Array.isArray(gj?.fear_and_greed_historical) ? gj.fear_and_greed_historical : [];

      history = hist.map(x => ({ t: Number(x.x) || null, v: Number(x.y) || null })).filter(x => Number.isFinite(x.t) && Number.isFinite(x.v));

    } catch {}



    // Fallback 1: try to scrape from CNN HTML if history is empty

    if (!Array.isArray(history) || history.length === 0) {

      try {

        const hr = await fetch('https://edition.cnn.com/markets/fear-and-greed', {

          headers: {

            'User-Agent': headers['User-Agent'],

            'Accept': 'text/html,*/*',

            'Accept-Language': headers['Accept-Language'],

            'Referer': 'https://edition.cnn.com/',

          },

        });

        const html = await hr.text();

        // Attempt to locate a JSON array named fear_and_greed_historical: [...]

        const key = 'fear_and_greed_historical';

        const i = html.indexOf(key);

        if (i >= 0) {

          const after = html.slice(i);

          const lb = after.indexOf('[');

          if (lb >= 0) {

            let depth = 0; let j = lb; let end = -1;

            for (; j < after.length; j++) {

              const ch = after[j];

              if (ch === '[') depth++;

              else if (ch === ']') { depth--; if (depth === 0) { end = j; break; } }

            }

            if (end > lb) {

              const arrTxt = after.slice(lb, end + 1);

              try {

                const arr = JSON.parse(arrTxt);

                if (Array.isArray(arr)) {

                  history = arr.map(x => ({ t: Number(x.x) || null, v: Number(x.y) || null })).filter(x => Number.isFinite(x.t) && Number.isFinite(x.v));

                }

              } catch {}

            }

          }

        }

      } catch {}

    }



    // Fallback 2: local cached file if still empty

    if (!Array.isArray(history) || history.length === 0) {

      try {

        const f = path.resolve(__dirname, '../../data/fgi/history.json');

        if (fs.existsSync(f)) {

          const j = JSON.parse(fs.readFileSync(f, 'utf8'));

          const arr = Array.isArray(j?.history) ? j.history : [];

          history = arr.map(x => ({ t: Number(x.t) || null, v: Number(x.v) || null })).filter(x => Number.isFinite(x.t) && Number.isFinite(x.v));

        }

      } catch {}

    }



    // Merge with local on-disk history and persist

    try {

      const file = path.resolve(__dirname, '../../data/fgi/history.json');

      let existing = [];

      if (fs.existsSync(file)) {

        try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); existing = Array.isArray(j?.history) ? j.history : []; } catch {}

      }

      // Optionally add today's point from `now` if missing

      if (Number.isFinite(now)) {

        const d = new Date(); d.setHours(0,0,0,0);

        const t0 = d.getTime();

        if (!history.some(x => x && Number(x.t) === t0)) {

          history = history.concat([{ t: t0, v: Number(now) }]);

        }

      }

      // Union by timestamp

      const map = new Map();

      for (const x of existing) { const tt = Number(x?.t); if (Number.isFinite(tt)) map.set(tt, Number(x.v)); }

      for (const x of history) { const tt = Number(x?.t); if (Number.isFinite(tt)) map.set(tt, Number(x.v)); }

      const merged = Array.from(map.entries()).map(([t, v]) => ({ t, v })).sort((a,b)=>a.t-b.t);

      // Persist

      try {

        const outFileDir = path.dirname(file);

        if (!fs.existsSync(outFileDir)) { fs.mkdirSync(outFileDir, { recursive: true }); }

        fs.writeFileSync(file, JSON.stringify({ history: merged }, null, 2), 'utf8');

      } catch {}

      const out = { now: Number.isFinite(now) ? now : null, previousClose: Number.isFinite(previousClose) ? previousClose : null, history: merged };

      setCache(key, out, 30 * 60_000);

      return res.json(out);

    } catch {

      const out = { now: Number.isFinite(now) ? now : null, previousClose: Number.isFinite(previousClose) ? previousClose : null, history };

      setCache(key, out, 30 * 60_000);

      return res.json(out);

    }

  } catch (e) {

    res.json({ now: null, previousClose: null, history: [] });

  }

});



// Signals stub

app.get('/api/signals', async (_req, res) => { res.json({}); });

app.post('/api/signals', async (_req, res) => { res.json({}); });



// --- Lightweight collection endpoint for cross-origin bookmarklet ---

const collected = [];

function setCORS(res) {

  res.setHeader('Access-Control-Allow-Origin', '*');

  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');

}

app.options('/api/collect', (req, res) => { setCORS(res); res.sendStatus(204); });

app.post('/api/collect', (req, res) => {

  setCORS(res);

  try {

    const { origin, href, nmy, my } = req.body || {};

    const entry = {

      ts: Date.now(),

      origin: typeof origin === 'string' ? origin : null,

      href: typeof href === 'string' ? href : null,

      nmySize: typeof nmy === 'string' ? nmy.length : 0,

      mySize: typeof my === 'string' ? my.length : 0,

      nmy, my,

    };

    collected.push(entry);

    if (collected.length > 100) collected.shift();

    res.json({ status: 'ok', count: collected.length });

  } catch (e) {

    res.status(400).json({ status: 'error', error: String(e?.message || e) });

  }

});

app.get('/api/collected', (req, res) => {

  setCORS(res);

  const out = collected.map((c) => ({ ts: c.ts, origin: c.origin, href: c.href, nmySize: c.nmySize, mySize: c.mySize }));

  res.json(out);

});



// Serve static built assets if present

// Allow asset loads from sandboxed iframe (Origin: null)

function assetCORS(req, res, next) {

  try {

    if (req.path && (req.path.startsWith('/assets/') || req.path.startsWith('/react/assets/'))) {

      res.setHeader('Access-Control-Allow-Origin', '*');

      res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');

    }

  } catch {}

  next();

}

const distDir = path.resolve(__dirname, '../dist');

// Serve built assets at root (no index) so /assets/* works

app.use(assetCORS);

app.use(express.static(distDir, { index: false }));

// Serve React app under /react path

app.use('/react', express.static(distDir));

function sendReactIndex(res) {

  try {

    const pth = path.join(distDir, 'index.html');

    let html = fs.readFileSync(pth, 'utf8');

    const inject = '<script>try{window.__REACT_DEVTOOLS_GLOBAL_HOOK__=undefined;}catch(e){}</script>';

    if (!html.includes('__REACT_DEVTOOLS_GLOBAL_HOOK__')) {

      html = html.replace(/<head>/i, '<head>' + inject);

    }

    try { html = html.replace(/\s+crossorigin(\s*=\s*['\"][^'\"]*['\"])?/gi, ''); } catch {}

    res.type('html').send(html);

  } catch {

    res.status(404).send('react index not found');

  }

}

app.get('/react', (_req, res) => sendReactIndex(res));

app.get('/react/*', (_req, res) => sendReactIndex(res));







// Serve legacy single-file app and make it the default UI

function sendLegacy(res) {

  try {

    const file = path.resolve(__dirname, '../../NMY.html');

    res.setHeader('Cache-Control', 'no-store');

    res.type('html').send(fs.readFileSync(file, 'utf8'));

  } catch (e) {

    res.status(404).send('legacy NMY.html not found');

  }

}

app.get('/NMY.html', (_req, res) => sendLegacy(res));

app.get('/legacy', (_req, res) => sendLegacy(res));

app.get('/legacy/*', (_req, res) => sendLegacy(res));

app.get('/', (_req, res) => sendReactIndex(res));

// Serve alternate completed single-file app

app.get('/asset_manager_app.html', (_req, res) => {

  try {

    const file = path.resolve(__dirname, '../../asset_manager_app.html');

    res.setHeader('Cache-Control', 'no-store');

    res.type('html').send(fs.readFileSync(file, 'utf8'));

  } catch (e) {

    res.status(404).send('asset_manager_app.html not found');

  }

});

app.get('*', (_req, res) => sendReactIndex(res));



const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {

  console.log(`Server listening on http://localhost:${PORT}`);

  // Background refresher for FGI (every 6h)

  const base = `http://127.0.0.1:${PORT}`;

  const refresh = async () => { try { await fetch(base + '/api/fgi'); } catch {} };

  refresh();

  setInterval(refresh, 6 * 60 * 60_000);

  readUsIndustryDatasetFromDisk().catch(() => {});
  scheduleTopixRefresh();

});





































