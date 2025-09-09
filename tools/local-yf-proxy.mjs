import http from 'node:http';
import { URL } from 'node:url';

const PORT = 8787;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36 LocalYFProxy/1.0';

const send = (res, status, body, headers = {}) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Cache-Control': 'no-store',
  };
  const h = { 'Content-Type': 'application/json', ...cors, ...headers };
  res.writeHead(status, h);
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    if (req.method === 'OPTIONS') {
      return send(res, 200, '');
    }

  if (path === '/api/yf/ping') {
      return send(res, 200, { ok: true });
    }

    if (path === '/api/yf/quote') {
      const symbols = url.searchParams.get('symbols') || '';
      const headers = { 'User-Agent': UA, 'Accept': 'application/json,*/*', 'Accept-Language': 'en-US,en;q=0.9' };
      const t1 = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}`;
      const r1 = await fetch(t1, { headers });
      let j = await r1.json();
      let items = Array.isArray(j?.quoteResponse?.result) ? j.quoteResponse.result : null;
      const unauthorized = !!(j?.finance?.error?.code === 'Unauthorized');
      if (!items || items.length === 0 || unauthorized) {
        const t2 = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${symbols}`;
        const r2 = await fetch(t2, { headers });
        const j2 = await r2.json();
        items = Array.isArray(j2?.quoteResponse?.result) ? j2.quoteResponse.result : null;
        if (!items || items.length === 0) {
          const out = [];
          const syms = symbols.split(',').map(s => s.trim()).filter(Boolean);
          for (const s of syms) {
            const c1 = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?interval=1d&range=1y&includePrePost=false&events=div%2Csplit`;
            let cr = await fetch(c1, { headers });
            let cj = await cr.json();
            if (!(Array.isArray(cj?.chart?.result) && cj.chart.result[0])) {
              const c2 = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?interval=1d&range=1y&includePrePost=false&events=div%2Csplit`;
              cr = await fetch(c2, { headers });
              cj = await cr.json();
            }
            const r = (cj?.chart?.result || [])[0] || {};
            const meta = r.meta || {};
            const q0 = ((r.indicators||{}).quote||[{}])[0] || {};

            const closes = Array.isArray(q0.close) ? q0.close : [];
            let last = null, prevClose = null;
            for (let i = closes.length - 1; i >= 0; i--) {
              const v = closes[i];
              if (Number.isFinite(v)) {
                if (last === null) last = v; else { prevClose = v; break; }
              }
            }
            let price = Number.isFinite(last) ? last : (meta.regularMarketPrice ?? null);
            let prev = Number.isFinite(prevClose) ? prevClose : null;
            let change = null, changePct = null;
            if (Number.isFinite(price) && Number.isFinite(prev) && prev > 0) {
              change = price - prev;
              changePct = (change / prev) * 100;
              if (Math.abs(changePct) > 12) { change = 0; changePct = 0; }
            } else { change = 0; changePct = 0; }
            out.push({
              symbol: s,
              longName: null,
              shortName: null,
              currency: meta.currency || 'USD',
              regularMarketPrice: Number.isFinite(price) ? price : null,
              regularMarketPreviousClose: Number.isFinite(prev) ? prev : null,
              regularMarketChange: Number.isFinite(change) ? change : null,
              regularMarketChangePercent: Number.isFinite(changePct) ? changePct : null,
              trailingPE: null,
              priceToBook: null,
              trailingAnnualDividendYield: null,
              marketCap: null,
            });
          }
          return send(res, 200, { quoteResponse: { result: out, error: null } });
        } else {
          j = j2;
        }
      }
      return send(res, 200, j);
    }

    // Symbol search proxy (Yahoo Finance Search API)
    if (path === '/api/yf/search') {
      const q = url.searchParams.get('q') || '';
      const quotesCount = url.searchParams.get('quotesCount') || '10';
      const lang = url.searchParams.get('lang') || 'ja-JP';
      const region = url.searchParams.get('region') || 'JP';
      const headers = { 'User-Agent': UA, 'Accept': 'application/json,*/*', 'Accept-Language': 'ja,en;q=0.9' };
      const u1 = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&lang=${lang}&region=${region}&quotesCount=${quotesCount}&newsCount=0`;
      let r = await fetch(u1, { headers });
      let j = await r.json();
      if (!Array.isArray(j?.quotes)) {
        const u2 = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&lang=${lang}&region=${region}&quotesCount=${quotesCount}&newsCount=0`;
        r = await fetch(u2, { headers });
        j = await r.json();
      }
      return send(res, 200, j);
    }

    // Fundamentals/price details via quoteSummary modules
    if (path === '/api/yf/fund') {
      const symbol = url.searchParams.get('symbol');
      if (!symbol) return send(res, 400, { error: 'symbol required' });
      const headers = { 'User-Agent': UA, 'Accept': 'application/json,*/*', 'Accept-Language': 'en-US,en;q=0.9' };
      const modules = 'price,defaultKeyStatistics,financialData,summaryDetail';
      const t1 = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`;
      let r = await fetch(t1, { headers });
      let j = await r.json();
      let resObj = (j?.quoteSummary?.result || [])[0] || null;
      if (!resObj) {
        const t2 = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`;
        r = await fetch(t2, { headers });
        j = await r.json();
        resObj = (j?.quoteSummary?.result || [])[0] || null;
      }
      if (!resObj) return send(res, 200, { symbol, per: null, pbr: null, dividendYield: null, marketCap: null, longName: null, shortName: null });
      const price = resObj.price || {};
      const summ = resObj.summaryDetail || {};
      const stat = resObj.defaultKeyStatistics || {};
      const fin = resObj.financialData || {};
      const out = {
        symbol,
        longName: price.longName || null,
        shortName: price.shortName || null,
        per: (stat.trailingPE?.raw ?? fin.trailingPE?.raw ?? null),
        pbr: (stat.priceToBook?.raw ?? null),
        dividendYield: (summ.trailingAnnualDividendYield?.raw ?? null),
        marketCap: (price.marketCap?.raw ?? stat.marketCap?.raw ?? null),
      };
      return send(res, 200, out);
    }

    if (path === '/api/yf/history') {
      const symbol = url.searchParams.get('symbol');
      const interval = url.searchParams.get('interval') || '1d';
      const range = url.searchParams.get('range') || '1y';
      if (!symbol) return send(res, 400, { error: 'symbol required' });
      const headers = { 'User-Agent': UA, 'Accept': 'application/json,*/*', 'Accept-Language': 'en-US,en;q=0.9' };
      const t1 = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false&events=div%2Csplit`;
      const r1 = await fetch(t1, { headers });
      let j = await r1.json();
      const empty = !(Array.isArray(j?.chart?.result) && (j.chart.result[0]?.timestamp || []).length > 0);
      if (empty) {
        const t2 = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false&events=div%2Csplit`;
        const r2 = await fetch(t2, { headers });
        const j2 = await r2.json();
        if (Array.isArray(j2?.chart?.result) && (j2.chart.result[0]?.timestamp || []).length > 0) {
          j = j2;
        }
      }
      return send(res, 200, j);
    }

    return send(res, 404, 'Not Found', { 'Content-Type': 'text/plain' });
  } catch (e) {
    return send(res, 500, { error: String(e?.message || e) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Local YF proxy listening at http://127.0.0.1:${PORT}`);
});
