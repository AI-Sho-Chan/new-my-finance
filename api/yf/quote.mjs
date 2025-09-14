import { ok, send, fetchJsonTry, normalizeQuote } from '../_utils.mjs';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return ok(res, {});
  try {
    const symbolsParam = String((req.query?.symbols ?? '')).trim();
    if (!symbolsParam) return send(res, 400, { error: 'symbols required' });
    const symbols = symbolsParam.split(',').map(s => s.trim()).filter(Boolean);
    let result = {};
    try {
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
      for (const s of symbols) {
        try {
          const urls = [
            `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=5d&interval=1d&includePrePost=false&events=div%2Csplits`,
            `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=5d&interval=1d&includePrePost=false&events=div%2Csplits`,
          ];
          const data = await fetchJsonTry(urls);
          const r = data?.chart?.result?.[0] ?? {};
          const meta = r?.meta ?? {};
          const q = r?.indicators?.quote?.[0] ?? {};
          const closes = (q?.close || []).filter(v=>Number.isFinite(v));
          const price = closes.length ? closes[closes.length-1] : null;
          const prev = closes.length>1 ? closes[closes.length-2] : null;
          result[s] = normalizeQuote({
            symbol: s, shortName: null, longName: null,
            regularMarketPrice: price, regularMarketPreviousClose: prev, currency: meta.currency || (s.endsWith('.T') ? 'JPY':'USD')
          });
        } catch {}
      }
    }
    return ok(res, result);
  } catch (e) {
    return send(res, 500, { error: String(e?.message || e) });
  }
}

