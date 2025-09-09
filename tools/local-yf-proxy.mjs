import http from 'node:http';
import { URL } from 'node:url';

const PORT = 8787;
const UA = 'Mozilla/5.0 (compatible; LocalYFProxy/1.0)';

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
      const target = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}`;
      const r = await fetch(target, { headers: { 'User-Agent': UA, 'Accept': 'application/json,*/*' } });
      const j = await r.json();
      return send(res, 200, j);
    }

    if (path === '/api/yf/history') {
      const symbol = url.searchParams.get('symbol');
      const interval = url.searchParams.get('interval') || '1d';
      const range = url.searchParams.get('range') || '1y';
      if (!symbol) return send(res, 400, { error: 'symbol required' });
      const target = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false&events=div%2Csplit`;
      const r = await fetch(target, { headers: { 'User-Agent': UA, 'Accept': 'application/json,*/*' } });
      const j = await r.json();
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

