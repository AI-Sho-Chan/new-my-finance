import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

const PORT = 8787;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36 LocalYFProxy/1.0';

const textOrEmpty = async (resp) => { try { return await resp.text(); } catch { return ''; } };
const tryParseJSON = (txt) => { try { return JSON.parse(txt); } catch { return null; } };

const send = (res, status, body, headers = {}) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Cache-Control': 'no-store',
  };
  const isString = typeof body === 'string';
  const base = { 'Content-Type': 'application/json; charset=utf-8' };
  const h = { ...base, ...cors, ...headers };
  res.writeHead(status, h);
  res.end(isString ? body : JSON.stringify(body));
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    if (req.method === 'OPTIONS') return send(res, 200, '');

    if (path === '/api/yf/ping') return send(res, 200, { ok: true });

    // Minimal fetch polyfill for Node < 18
    if (typeof globalThis.fetch !== 'function') {
      globalThis.fetch = (urlStr, opts = {}) => new Promise((resolve, reject) => {
        try {
          const u = new URL(urlStr);
          const isHttps = u.protocol === 'https:';
          const mod = isHttps ? https : http;
          const reqOpts = { method: opts.method || 'GET', headers: opts.headers || {} };
          const preq = mod.request(u, reqOpts, (resp) => {
            let data = '';
            resp.setEncoding('utf8');
            resp.on('data', (chunk) => { data += chunk; });
            resp.on('end', () => {
              resolve({
                ok: (resp.statusCode >= 200 && resp.statusCode < 300),
                status: resp.statusCode || 0,
                headers: resp.headers,
                json: async () => { try { return JSON.parse(data || 'null'); } catch (e) { throw new Error('Invalid JSON: ' + (e?.message || e)); } },
                text: async () => data,
              });
            });
          });
          preq.on('error', reject);
          if (opts.body) preq.write(opts.body);
          preq.end();
        } catch (e) { reject(e); }
      });
    }

    // Quote
    if (path === '/api/yf/quote') {
      const symbols = url.searchParams.get('symbols') || '';
      const headers = { 'User-Agent': UA, 'Accept': 'application/json,*/*', 'Accept-Language': 'en-US,en;q=0.9' };
      const t1 = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}`;
      const r1 = await fetch(t1, { headers });
      let j = await r1.json();
      let items = Array.isArray(j?.quoteResponse?.result) ? j.quoteResponse.result : null;
      const unauthorized = !!(j?.finance?.error?.code === 'Unauthorized');
      const symsList = symbols.split(',').map(s=>s.trim()).filter(Boolean);
      if (symsList.includes('ZZTEST')) {
        const dummy = { symbol: 'ZZTEST', longName: 'Signal Test', shortName: 'Signal Test', currency: 'JPY', regularMarketPrice: 1500, regularMarketPreviousClose: 1450, regularMarketChange: 50, regularMarketChangePercent: 3.45 };
        items = (items||[]).filter(x=>x.symbol!=='ZZTEST').concat([dummy]);
        j = { quoteResponse: { result: items, error: null } };
      }
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
              if (Number.isFinite(v)) { if (last === null) last = v; else { prevClose = v; break; } }
            }
            const price = Number.isFinite(last) ? last : (meta.regularMarketPrice ?? null);
            const prev = Number.isFinite(prevClose) ? prevClose : null;
            let change = 0, changePct = 0;
            if (Number.isFinite(price) && Number.isFinite(prev) && prev > 0) {
              change = price - prev;
              changePct = (change / prev) * 100;
              if (Math.abs(changePct) > 12) { change = 0; changePct = 0; }
            }
            out.push({ symbol: s, longName: null, shortName: null, currency: meta.currency || 'USD', regularMarketPrice: Number.isFinite(price) ? price : null, regularMarketPreviousClose: Number.isFinite(prev) ? prev : null, regularMarketChange: Number.isFinite(change) ? change : null, regularMarketChangePercent: Number.isFinite(changePct) ? changePct : null, trailingPE: null, priceToBook: null, trailingAnnualDividendYield: null, marketCap: null });
          }
          return send(res, 200, { quoteResponse: { result: out, error: null } });
        } else {
          j = j2;
        }
      }
      return send(res, 200, j);
    }

    // Search
    if (path === '/api/yf/search') {
      const q = url.searchParams.get('q') || '';
      const quotesCount = url.searchParams.get('quotesCount') || '10';
      const lang = url.searchParams.get('lang') || 'ja-JP';
      const region = url.searchParams.get('region') || 'JP';
      const headers = { 'User-Agent': UA, 'Accept': 'application/json,*/*', 'Accept-Language': 'ja,en;q=0.9' };
      try {
        const u1 = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&lang=${lang}&region=${region}&quotesCount=${quotesCount}&newsCount=0`;
        let r = await fetch(u1, { headers });
        let t = await textOrEmpty(r);
        let j = tryParseJSON(t);
        if (!Array.isArray(j?.quotes)) {
          const u2 = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&lang=${lang}&region=${region}&quotesCount=${quotesCount}&newsCount=0`;
          r = await fetch(u2, { headers });
          t = await textOrEmpty(r);
          j = tryParseJSON(t);
        }
        if (!Array.isArray(j?.quotes) || j.quotes.length === 0) {
          const au = `https://autoc.finance.yahoo.com/autoc?query=${encodeURIComponent(q)}&region=${region}&lang=${lang}`;
          const ar = await fetch(au, { headers });
          const at = await textOrEmpty(ar);
          const aj = tryParseJSON(at);
          const rs = (aj?.ResultSet?.Result || []).map(x => ({ symbol: x.symbol, shortname: x.name }));
          j = { quotes: rs };
        }
        return send(res, 200, j || { quotes: [] });
      } catch {
        return send(res, 200, { quotes: [] });
      }
    }

    // History (chart v8 passthrough)
    if (path === '/api/yf/history') {
      const symbol = url.searchParams.get('symbol') || '';
      const interval = url.searchParams.get('interval') || '1d';
      const range = url.searchParams.get('range') || '1y';
      if (!symbol) return send(res, 400, { error: 'symbol required' });
      const headers = { 'User-Agent': UA, 'Accept': 'application/json,*/*', 'Accept-Language': 'en-US,en;q=0.9' };
      const u1 = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}&includePrePost=false&events=div%2Csplit`;
      const r1 = await fetch(u1, { headers });
      let j = await r1.json();
      if (!(Array.isArray(j?.chart?.result) && j.chart.result[0])) {
        const u2 = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}&includePrePost=false&events=div%2Csplit`;
        const r2 = await fetch(u2, { headers });
        j = await r2.json();
      }
      return send(res, 200, j);
    }

    // Fundamentals (quoteSummary digest)
    if (path === '/api/yf/fund') {
      const symbol = url.searchParams.get('symbol');
      if (!symbol) return send(res, 400, { error: 'symbol required' });
      if (symbol === 'ZZTEST') {
        return send(res, 200, { symbol, longName: 'Signal Test', shortName: 'Signal Test' });
      }
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
      const out = {
        symbol,
        longName: price.longName || null,
        shortName: price.shortName || null,
        per: Number(stat.trailingPE?.raw ?? stat.trailingPE ?? null),
        pbr: Number(stat.priceToBook?.raw ?? stat.priceToBook ?? null),
        dividendYield: Number(summ.dividendYield?.raw ?? summ.dividendYield ?? null),
        marketCap: Number(price.marketCap?.raw ?? price.marketCap ?? null),
      };
      return send(res, 200, out);
    }

    // Signals stub for compatibility
    if (path === '/api/signals') {
      if (req.method === 'GET') return send(res, 200, {});
      if (req.method === 'POST') return send(res, 200, {});
      return send(res, 405, { error: 'method not allowed' });
    }

    // Fear & Greed index (normalize to { now, previousClose, history: [{t,v}] })
    if (path === '/api/fgi') {
      try {
        const headers = { 'User-Agent': UA, 'Accept': 'application/json,*/*', 'Referer': 'https://edition.cnn.com/' };
        const r = await fetch('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', { headers });
        const j = await r.json();
        const num = (v)=>{ const n = Number(v); return Number.isFinite(n) ? n : null; };
        const out = { now: null, previousClose: null, history: [] };
        // Try common shapes
        out.now = num(j?.fear_and_greed?.now ?? j?.fear_greed?.now ?? j?.now ?? j?.score);
        out.previousClose = num(j?.fear_and_greed?.previous_close ?? j?.fear_greed?.previous_close ?? j?.previousClose ?? j?.previous_close);
        // History: try various locations; prefer array of {x,y}
        const pickXY = (root)=>{
          try{
            if (Array.isArray(root)) return root;
            for (const k of Object.keys(root||{})){
              const v = root[k];
              if (Array.isArray(v) && v.length && typeof v[0] === 'object' && v[0] && ('x' in v[0]) && ('y' in v[0])) return v;
            }
          }catch{}
          return [];
        };
        let hist = [];
        if (Array.isArray(j?.history)) hist = j.history;
        else if (Array.isArray(j?.historical)) hist = j.historical;
        else if (j?.fear_and_greed_historical) hist = pickXY(j.fear_and_greed_historical);
        else if (j?.data) hist = pickXY(j);
        // Normalize to {t,v}
        out.history = (hist||[]).map(o=>({ t: Number(o.x)||0, v: Number(o.y)||0 })).filter(x=>x.t && Number.isFinite(x.v));
        if ((out.now==null || !Number.isFinite(out.now)) && out.history.length){ out.now = out.history[out.history.length-1].v; }
        if ((out.previousClose==null || !Number.isFinite(out.previousClose)) && out.history.length>1){ out.previousClose = out.history[out.history.length-2].v; }
        return send(res, 200, out);
      } catch {
        return send(res, 200, { now: null, previousClose: null, history: [] });
      }
    }

    return send(res, 404, { error: 'not found' });
  } catch (e) {
    return send(res, 500, { error: String(e?.message || e) });
  }
});

server.listen(PORT, () => {
  console.log('Local YF proxy listening on http://127.0.0.1:' + PORT);
});
