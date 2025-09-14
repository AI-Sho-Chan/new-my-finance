import { ok, send, fetchJsonTry } from '../_utils.mjs';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return ok(res, {});
  try {
    const symbol = String(req.query?.symbol || '').trim();
    if (!symbol) return send(res, 400, { error: 'symbol required' });
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
    return ok(res, out);
  } catch (e) {
    return send(res, 500, { error: String(e?.message || e) });
  }
}

