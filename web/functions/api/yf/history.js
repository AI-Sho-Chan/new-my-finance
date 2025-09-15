import { json, text, fetchJsonTry } from '../../_utils.mjs';

export async function onRequest({ request }) {
  if (request.method === 'OPTIONS') return text('', { status: 204 });
  try {
    const url = new URL(request.url);
    const symbol = String(url.searchParams.get('symbol') || '').trim();
    const interval = String(url.searchParams.get('interval') || '1d');
    const range = String(url.searchParams.get('range') || '1y');
    if (!symbol) return json({ error: 'symbol required' }, { status: 400 });
    const urls = [
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false&events=div%2Csplit`,
      `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false&events=div%2Csplit`,
    ];
    const data = await fetchJsonTry(urls);
    return json(data);
  } catch (e) {
    return json({ error: String(e?.message || e) }, { status: 500 });
  }
}

