import { ok, send, textOrEmpty, tryParseJSON, UA } from '../_utils.mjs';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return ok(res, {});
  try {
    const q = String(req.query?.q || '');
    const quotesCount = String(req.query?.quotesCount || '10');
    const lang = String(req.query?.lang || 'ja-JP');
    const region = String(req.query?.region || 'JP');
    const headers = { 'User-Agent': UA, 'Accept': 'application/json,*/*', 'Accept-Language': 'ja,en;q=0.9' };
    let data = null;
    try {
      const u1 = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&lang=${lang}&region=${region}&quotesCount=${quotesCount}&newsCount=0`;
      const r1 = await fetch(u1, { headers });
      const t1 = await textOrEmpty(r1);
      data = tryParseJSON(t1);
      if (!Array.isArray(data?.quotes)) {
        const u2 = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&lang=${lang}&region=${region}&quotesCount=${quotesCount}&newsCount=0`;
        const r2 = await fetch(u2, { headers });
        const t2 = await textOrEmpty(r2);
        data = tryParseJSON(t2);
      }
      if (!Array.isArray(data?.quotes)) {
        // Autocomplete fallback
        const au = `https://autoc.finance.yahoo.com/autoc?query=${encodeURIComponent(q)}&region=${region}&lang=${lang}`;
        const ar = await fetch(au, { headers });
        const at = await textOrEmpty(ar);
        const aj = tryParseJSON(at);
        const rs = (aj?.ResultSet?.Result || []).map(x => ({ symbol: x.symbol, shortname: x.name }));
        data = { quotes: rs };
      }
    } catch { data = { quotes: [] }; }
    return ok(res, data || { quotes: [] });
  } catch (e) {
    return send(res, 500, { error: String(e?.message || e) });
  }
}

