import { json, text, fetchJsonTry, normalizeQuote } from '../../_utils.mjs';

export async function onRequest({ request }) {
  if (request.method === 'OPTIONS') return text('', { status: 204 });
  try {
    const url = new URL(request.url);
    const symbolsParam = String(url.searchParams.get('symbols') || '').trim();
    if (!symbolsParam) return json({ error: 'symbols required' }, { status: 400 });
    const symbols = symbolsParam.split(',').map(s => s.trim()).filter(Boolean);
    let result = {};
    try {
      const urls = [
        `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(','))}`,
        `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(','))}`,
      ];
      const data = await fetchJsonTry(urls);
      (data?.quoteResponse?.result ?? []).forEach((q) => { result[q.symbol] = normalizeQuote(q); });
    } catch (e) {
      // fallback via chart v8 5d/1d
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
          result[s] = normalizeQuote({ symbol: s, shortName: null, longName: null, regularMarketPrice: price, regularMarketPreviousClose: prev, currency: meta.currency || (s.endsWith('.T')?'JPY':'USD') });
        } catch {}
      }
    }
    return json(result);
  } catch (e) {
    return json({ error: String(e?.message || e) }, { status: 500 });
  }
}

