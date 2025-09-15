import { json, text, fetchJsonTry } from '../../_utils.mjs';

export async function onRequest({ request }) {
  if (request.method === 'OPTIONS') return text('', { status: 204 });
  try {
    const url = new URL(request.url);
    const symbol = String(url.searchParams.get('symbol') || '').trim();
    if (!symbol) return json({ error: 'symbol required' }, { status: 400 });
    const mod = 'price,summaryDetail,defaultKeyStatistics,financialData';
    const urls = [
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${mod}`,
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${mod}`,
    ];
    const data = await fetchJsonTry(urls);
    const resObj = (data?.quoteSummary?.result || [])[0] || {};
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
    return json(out);
  } catch (e) {
    return json({ error: String(e?.message || e) }, { status: 500 });
  }
}

