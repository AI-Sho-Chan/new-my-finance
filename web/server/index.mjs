import express from 'express';
import compression from 'compression';
import morgan from 'morgan';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(compression());
app.use(morgan('dev'));

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

// Normalize Yahoo Quote
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
    currency: q.currency ?? 'USD',
    per: q.trailingPE ?? q.forwardPE ?? null,
    pbr: q.priceToBook ?? null,
    dividendYieldPct: dividendYield != null ? Math.round(dividendYield * 10000) / 100 : null,
    marketCap: q.marketCap ?? null,
  };
}

app.get('/api/quote', async (req, res) => {
  try {
    const symbolsParam = String(req.query.symbols || '').trim();
    if (!symbolsParam) return res.status(400).json({ error: 'symbols required' });
    const symbols = symbolsParam.split(',').map(s => s.trim()).filter(Boolean);
    const key = `q:${symbols.sort().join(',')}`;
    const cached = getCache(key);
    if (cached) return res.json(cached);

    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(','))}`;
    const data = await fetchJson(url);
    const result = {};
    (data?.quoteResponse?.result ?? []).forEach((q) => {
      result[q.symbol] = normalizeQuote(q);
    });
    // Cache for 30s
    setCache(key, result, 30_000);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Chart candles
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
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false&events=div%2Csplits`;
    const data = await fetchJson(url);
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
    // Cache: 15min for D, 2h for W/M
    setCache(key, out, tf === 'D' ? 15 * 60_000 : 2 * 60 * 60_000);
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
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
    // Cache for 12h
    setCache(key, out, 12 * 60 * 60_000);
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Serve static built assets if present
const distDir = path.resolve(__dirname, '../dist');
app.use(express.static(distDir));
app.get('*', (req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
