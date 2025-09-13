import express from 'express';
import compression from 'compression';
import morgan from 'morgan';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(compression());
app.use(morgan('dev'));
app.use(express.json({ limit: '2mb' }));

// Simple in-memory cache
const cache = new Map(); // key -> { ts: number, data: any, ttl: number }
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

async function fetchJsonTry(urls, init) {
  let lastErr = null;
  for (const u of urls) {
    try { return await fetchJson(u, init); } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('all upstream failed');
}

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
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Fundamentals (YoY metrics) via quoteSummary
app.get('/api/fundamentals', async (req, res) => {
  try {
    const symbol = String(req.query.symbol || '').trim();
    if (!symbol) return res.status(400).json({ error: 'symbol required' });
    const key = `f:${symbol}`;
    const cached = getCache(key);
    if (cached) return res.json(cached);
    const modules = ['incomeStatementHistoryQuarterly','defaultKeyStatistics','financialData','summaryDetail'];
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules.join(',')}`;
    const data = await fetchJson(url);
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
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
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
    const data = await fetchJsonTry(urls);
    setCache(key, data, 15 * 60_000);
    res.json(data);
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
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
  res.json({ now: null, previousClose: null, history: [] });
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
const distDir = path.resolve(__dirname, '../dist');
app.use(express.static(distDir, { index: false }));

// Serve legacy single-file app and make it the default UI
function sendNMY(res) {
  try {
    const file = path.resolve(__dirname, '../../NMY.html');
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    res.status(404).send('NMY.html not found');
  }
}
app.get('/NMY.html', (_req, res) => sendNMY(res));
app.get('/', (_req, res) => sendNMY(res));
app.get('*', (_req, res) => sendNMY(res));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
