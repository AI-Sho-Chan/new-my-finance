export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Cache-Control': 'no-store',
    };
    if (request.method === 'OPTIONS') return new Response('', { headers: cors });

    const UA = 'Mozilla/5.0 (compatible; YFProxy/1.0)';
    const yf = (u) => fetch(u, { headers: { 'User-Agent': UA, 'Accept': 'application/json,*/*' } });

    try {
      if (path.endsWith('/api/yf/quote')) {
        const symbols = url.searchParams.get('symbols') || '';
        const target = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}`;
        const r = await yf(target); const j = await r.json();
        return new Response(JSON.stringify(j), { status: 200, headers: { 'Content-Type': 'application/json', ...cors } });
      }

      if (path.endsWith('/api/yf/history')) {
        const symbol = url.searchParams.get('symbol');
        const interval = url.searchParams.get('interval') || '1d';
        const range = url.searchParams.get('range') || '1y';
        if (!symbol) return new Response(JSON.stringify({ error: 'symbol required' }), { status: 400, headers: { 'Content-Type': 'application/json', ...cors } });
        const target = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false&events=div,split`;
        const r = await yf(target); const j = await r.json();
        return new Response(JSON.stringify(j), { status: 200, headers: { 'Content-Type': 'application/json', ...cors } });
      }

      if (path.endsWith('/api/yf/ping')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json', ...cors } });
      }

      return new Response('Not Found', { status: 404, headers: cors });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { 'Content-Type': 'application/json', ...cors } });
    }
  },
};

