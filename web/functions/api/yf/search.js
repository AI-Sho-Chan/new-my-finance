import { json, text, textOrEmpty, tryParseJSON } from '../../_utils.mjs';

export async function onRequest({ request }) {
  if (request.method === 'OPTIONS') return text('', { status: 204 });
  try {
    const url = new URL(request.url);
    const q = String(url.searchParams.get('q') || '');
    const quotesCount = String(url.searchParams.get('quotesCount') || '10');
    const lang = String(url.searchParams.get('lang') || 'ja-JP');
    const region = String(url.searchParams.get('region') || 'JP');
    const headers = { 'Accept': 'application/json,*/*', 'Accept-Language': 'ja,en;q=0.9' };
    let data = null;
    try {
      const u1 = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&lang=${lang}&region=${region}&quotesCount=${quotesCount}&newsCount=0`;
      let r = await fetch(u1, { headers });
      let t = await textOrEmpty(r);
      data = tryParseJSON(t);
      if (!Array.isArray(data?.quotes)) {
        const u2 = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&lang=${lang}&region=${region}&quotesCount=${quotesCount}&newsCount=0`;
        r = await fetch(u2, { headers });
        t = await textOrEmpty(r);
        data = tryParseJSON(t);
      }
      if (!Array.isArray(data?.quotes)) {
        const au = `https://autoc.finance.yahoo.com/autoc?query=${encodeURIComponent(q)}&region=${region}&lang=${lang}`;
        const ar = await fetch(au, { headers });
        const at = await textOrEmpty(ar);
        const aj = tryParseJSON(at);
        const rs = (aj?.ResultSet?.Result || []).map(x => ({ symbol: x.symbol, shortname: x.name }));
        data = { quotes: rs };
      }
    } catch { data = { quotes: [] }; }
    return json(data || { quotes: [] });
  } catch (e) {
    return json({ error: String(e?.message || e) }, { status: 500 });
  }
}

