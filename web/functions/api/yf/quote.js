import { json, text, fetchJsonTry, normalizeQuote } from '../../_utils.mjs';

export async function onRequest({ request }) {
  if (request.method === 'OPTIONS') return text('', { status: 204 });
  try {
    const url = new URL(request.url);
    const symbolsParam = String(url.searchParams.get('symbols') || '').trim();
    if (!symbolsParam) return json({ error: 'symbols required' }, { status: 400 });
    const symbols = symbolsParam.split(',').map(s => s.trim()).filter(Boolean);

    let mode = 'v7';
    let data = null;
    try {
      const urls = [
        `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(','))}`,
        `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(','))}`,
      ];
      data = await fetchJsonTry(urls);
    } catch (e) {
      mode = 'chart_fallback';
      const res = [];
      for (const s of symbols) {
        try {
          const urls = [
            `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=5d&interval=1d&includePrePost=false&events=div%2Csplits`,
            `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=5d&interval=1d&includePrePost=false&events=div%2Csplits`,
          ];
          const d = await fetchJsonTry(urls);
          const r = d?.chart?.result?.[0] ?? {};
          const meta = r?.meta ?? {};
          const q = r?.indicators?.quote?.[0] ?? {};
          const closes = (q?.close || []).filter((v) => Number.isFinite(v));
          const price = closes.length ? closes[closes.length - 1] : null;
          const prev = closes.length > 1 ? closes[closes.length - 2] : null;
          res.push({ symbol: s, shortName: null, longName: null, regularMarketPrice: price, regularMarketPreviousClose: prev, currency: meta.currency || (s.endsWith('.T') ? 'JPY' : 'USD') });
        } catch {
          res.push({ symbol: s, shortName: null, longName: null, regularMarketPrice: null, regularMarketPreviousClose: null, currency: s.endsWith('.T') ? 'JPY' : 'USD' });
        }
      }
      data = { quoteResponse: { result: res } };
    }
    return json({ ...data, _meta: { asOf: new Date().toISOString(), mode } });
  } catch (e) {
    return json({ error: String(e?.message || e) }, { status: 500 });
  }
}



