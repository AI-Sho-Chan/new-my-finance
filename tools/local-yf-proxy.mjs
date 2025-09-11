import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

const PORT = 8787;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36 LocalYFProxy/1.0';

const textOrEmpty = async (resp) => {
  try { return await resp.text(); } catch { return ''; }
};
const tryParseJSON = (txt) => { try { return JSON.parse(txt); } catch { return null; } };

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

    // Minimal fetch polyfill for Node < 18
    if (typeof globalThis.fetch !== 'function') {
      globalThis.fetch = (urlStr, opts = {}) => new Promise((resolve, reject) => {
        try {
          const u = new URL(urlStr);
          const isHttps = u.protocol === 'https:';
          const mod = isHttps ? https : http;
          const reqOpts = {
            method: opts.method || 'GET',
            headers: opts.headers || {},
          };
          const req = mod.request(u, reqOpts, (resp) => {
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
          req.on('error', reject);
          if (opts.body) req.write(opts.body);
          req.end();
        } catch (e) { reject(e); }
      });
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
        // Fallback: autocomplete API (often better for JP stocks)
        if (!Array.isArray(j?.quotes) || j.quotes.length === 0) {
          const au = `https://autoc.finance.yahoo.com/autoc?query=${encodeURIComponent(q)}&region=${region}&lang=${lang}`;
          const ar = await fetch(au, { headers });
          const at = await textOrEmpty(ar);
          const aj = tryParseJSON(at);
          const rs = (aj?.ResultSet?.Result || []).map(x => ({ symbol: x.symbol, shortname: x.name }));
          j = { quotes: rs };
        }
        return send(res, 200, j || { quotes: [] });
      } catch (e) {
        // Never 500 on search; return empty
        return send(res, 200, { quotes: [] });
      }
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

    // Simple signals engine (EOD price-action based)
    if (path === '/api/signals') {
      try {
        let body = '';
        await new Promise((r)=>{ req.on('data',c=>body+=c); req.on('end',r); });
        const j = body ? JSON.parse(body) : {};
        const symbols = Array.isArray(j.symbols) ? j.symbols : [];
        const out = {};
        const headers = { 'User-Agent': UA, 'Accept': 'application/json,*/*', 'Accept-Language': 'en-US,en;q=0.9' };
        const now = Date.now();
        function sma(arr, n){ const r=[]; let s=0; for(let i=0;i<arr.length;i++){ s+=arr[i]; if(i>=n) s-=arr[i-n]; if(i>=n-1) r.push(s/n); else r.push(null); } return r; }
        function atr(h,l,c, n=14){ const tr=[]; for(let i=0;i<c.length;i++){ const prev = i>0 ? c[i-1] : c[i]; tr[i] = Math.max(h[i]-l[i], Math.abs(h[i]-prev), Math.abs(l[i]-prev)); } return sma(tr,n); }
        function rsi(cl, n=14){ const r=[]; let up=0, dn=0; for(let i=1;i<cl.length;i++){ const ch=cl[i]-cl[i-1]; const g=Math.max(0,ch), d=Math.max(0,-ch); if(i<=n){ up+=g; dn+=d; r.push(null); if(i===n){ const rs= dn===0? 100 : up/dn; r.push(100-100/(1+rs)); } } else { up = (up*(n-1)+g)/n; dn = (dn*(n-1)+d)/n; const rs = dn===0? 100 : up/dn; r.push(100-100/(1+rs)); } }
          r.unshift(null); return r; }
        function lastIdx(vals){ for(let i=vals.length-1;i>=0;i--){ if(vals[i]!=null && Number.isFinite(vals[i])) return i; } return -1; }
        function maxN(arr, n){ let m=-Infinity; for(let i=Math.max(0,arr.length-n); i<arr.length; i++){ m=Math.max(m, arr[i]); } return m; }

        for (const sym of symbols){
          try {
            const url1 = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=2y&includePrePost=false&events=div%2Csplit`;
            let r1 = await fetch(url1, { headers });
            let j1 = await r1.json();
            let rr = (j1?.chart?.result||[])[0];
            if(!rr){
              const url2 = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=2y&includePrePost=false&events=div%2Csplit`;
              const r2 = await fetch(url2, { headers });
              const j2 = await r2.json(); rr = (j2?.chart?.result||[])[0];
            }
            if(!rr){ out[sym] = { signals: [] }; continue; }
            const ts = rr.timestamp||[];
            const q = (rr.indicators||{}).quote?.[0]||{};
            const open=q.open||[], high=q.high||[], low=q.low||[], close=q.close||[], vol=q.volume||[];
            const ema20 = (function ema(vals, n=20){ const k=2/(n+1); const res=[]; let e=null; for(let i=0;i<vals.length;i++){ const v=vals[i]; if(!Number.isFinite(v)){ res.push(null); continue;} e = (e==null)? v : e + k*(v-e); res.push(e);} return res; })(close,20);
            const ma50 = sma(close,50), ma150=sma(close,150), ma200=sma(close,200);
            const atr14 = atr(high,low,close,14);
            const rsi14 = rsi(close,14);
            const iLast = lastIdx(close);
            const signals=[];
            // C) 52-week high + first pullback (approx)
            if(iLast>0){
              const max252 = maxN(close.slice(0,iLast), 252);
              const broke = close[iLast-1] >= max252 && close[iLast-2] < max252 ? true : false;
              const pulled = (close[iLast] <= (ema20[iLast] + (atr14[iLast]||0)*0.2)) && (close[iLast] >= ema20[iLast] - (atr14[iLast]||0)*1.2);
              if (broke && pulled) {
                signals.push({ type:'52H+', date: ts[iLast], strength: 0.7, reason:'Breakout then first pullback near 20EMA' });
              }
            }
            // A) Uptrend pullback (ATR x RSI)
            const uptrend = ma50[iLast]>ma150[iLast] && ma150[iLast]>ma200[iLast];
            if(uptrend){
              const bandLow = (ema20[iLast]||0) - (atr14[iLast]||0)*1.5;
              const nearBand = close[iLast] <= (ema20[iLast]||0) && close[iLast] >= bandLow;
              const rsiOk = (rsi14[iLast]||50) <= 45 && (rsi14[iLast]||50) >= 28;
              if(nearBand && rsiOk){
                signals.push({ type:'押', date: ts[iLast], strength: 0.6, reason:'Pullback to EMA20 - 1.5*ATR with RSI recovery zone' });
              }
            }
            out[sym] = { signals };
          } catch (e) {
            out[sym] = { signals: [] };
          }
        }
        return send(res, 200, out);
      } catch (e) {
        return send(res, 400, { error: String(e?.message||e) });
      }
    }

    // CNN Fear & Greed Index (stocks)
    if (path === '/api/fgi') {
      try {
        const headers = { 'User-Agent': UA, 'Accept': 'application/json,*/*', 'Accept-Language': 'ja,en;q=0.9' };
        const curU = 'https://production.dataviz.cnn.io/index/fearandgreed/current';
        const graphU = 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata';
        const [cr, gr] = await Promise.all([
          fetch(curU, { headers }),
          fetch(graphU, { headers }),
        ]);
        const ct = await textOrEmpty(cr); const gt = await textOrEmpty(gr);
        const cj = tryParseJSON(ct) || {}; const gj = tryParseJSON(gt) || {};
        const now = Number(cj?.fear_and_greed?.now?.value ?? cj?.fear_and_greed?.now ?? cj?.now ?? cj?.score ?? null);
        const previousClose = Number(cj?.fear_and_greed?.previous_close?.value ?? cj?.fear_and_greed?.previous_close ?? cj?.previous_close ?? null);
        const hist = Array.isArray(gj?.fear_and_greed_historical) ? gj.fear_and_greed_historical : [];
        const history = hist.map(x => ({ t: Number(x.x) || null, v: Number(x.y) || null })).filter(x => Number.isFinite(x.t) && Number.isFinite(x.v));
        return send(res, 200, { now, previousClose, history });
      } catch (e) {
        return send(res, 200, { now: null, previousClose: null, history: [] });
      }
    }

    return send(res, 404, 'Not Found', { 'Content-Type': 'text/plain' });
  } catch (e) {
    return send(res, 500, { error: String(e?.message || e) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Local YF proxy listening at http://127.0.0.1:${PORT}`);
});
