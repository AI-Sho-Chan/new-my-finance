import { ok, send, fetchJsonTry } from '../_utils.mjs';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return ok(res, {});
  try {
    const symbol = String(req.query?.symbol || '').trim();
    const interval = String(req.query?.interval || '1d');
    const range = String(req.query?.range || '1y');
    if (!symbol) return send(res, 400, { error: 'symbol required' });
    const urls = [
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false&events=div%2Csplit` ,
      `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false&events=div%2Csplit` ,
    ];
    const j = await fetchJsonTry(urls);
    return ok(res, j);
  } catch (e) {
    return send(res, 500, { error: String(e?.message || e) });
  }
}

