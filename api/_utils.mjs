// Shared helpers for Vercel serverless API

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36 NMY-Serverless/1.0';

export function setCORS(res) {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    res.setHeader('Cache-Control', 'no-store');
  } catch {}
}

export function ok(res, body, headers = {}) {
  setCORS(res);
  Object.entries(headers || {}).forEach(([k, v]) => res.setHeader(k, v));
  return res.status(200).json(body);
}

export function send(res, status, body, headers = {}) {
  setCORS(res);
  Object.entries(headers || {}).forEach(([k, v]) => res.setHeader(k, v));
  if (typeof body === 'object') return res.status(status).json(body);
  res.status(status).send(String(body ?? ''));
}

export async function textOrEmpty(resp) {
  try { return await resp.text(); } catch { return ''; }
}
export function tryParseJSON(txt) { try { return JSON.parse(txt); } catch { return null; } }

export async function fetchJson(url, init) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json,*/*' },
    ...init,
  });
  if (!res.ok) {
    const t = await textOrEmpty(res);
    throw new Error(`Upstream ${res.status}: ${t.slice(0,200)}`);
  }
  return res.json();
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

