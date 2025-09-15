export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Cache-Control': 'no-store',
};

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}), ...CORS },
  });
}

export function text(body = '', init = {}) {
  return new Response(String(body ?? ''), { ...init, headers: { ...(init.headers || {}), ...CORS } });
}

export async function textOrEmpty(resp) {
  try { return await resp.text(); } catch { return ''; }
}

export function tryParseJSON(t) { try { return JSON.parse(t); } catch { return null; } }

export async function fetchJson(url, init) {
  const r = await fetch(url, { headers: { 'Accept': 'application/json,*/*' }, ...init });
  if (!r.ok) throw new Error(`Upstream ${r.status}`);
  return r.json();
}

export async function fetchJsonTry(urls, init) {
  let last = null;
  for (const u of urls) {
    try { return await fetchJson(u, init); } catch (e) { last = e; }
  }
  throw last || new Error('all upstream failed');
}

export function normalizeQuote(q) {
  const price = q.regularMarketPrice;
  const prevClose = q.regularMarketPreviousClose ?? q.previousClose;
  const change = price != null && prevClose != null ? price - prevClose : undefined;
  const changePct = change != null && prevClose ? (change / prevClose) * 100 : undefined;
  const dividendYield = q.trailingAnnualDividendYield ?? q.dividendYield;
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

