import { json, text, textOrEmpty, tryParseJSON, UA } from '../_utils.mjs';

export async function onRequest({ request }) {
  if (request.method === 'OPTIONS') return text('', { status: 204 });
  try {
    const headers = { 'Accept': 'application/json,*/*', 'Accept-Language': 'ja,en;q=0.9', 'User-Agent': UA };
    const curU = 'https://production.dataviz.cnn.io/index/fearandgreed/current';
    const graphU = 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata';
    const [cr, gr] = await Promise.all([
      fetch(curU, { headers }),
      fetch(graphU, { headers }),
    ]);
    const ct = await textOrEmpty(cr); const gt = await textOrEmpty(gr);
    const cj = tryParseJSON(ct) || {}; const gj = tryParseJSON(gt) || {};
    const now = Number(cj?.fear_and_greed?.now?.value ?? cj?.fear_and_greed?.now ?? cj?.now ?? cj?.score ?? null);
    const previousClose = Number(cj?.fear_and_greed?.previous_close?.value ?? cj?.fear_and_greed?.previous_close ?? cj?.previous_close ?? null);
    const hist = Array.isArray(gj?.fear_and_greed_historical) ? gj.fear_and_greed_historical : [];
    const history = hist.map(x => ({ t: Number(x.x) || null, v: Number(x.y) || null })).filter(x => Number.isFinite(x.t) && Number.isFinite(x.v));
    return json({ now, previousClose, history });
  } catch (e) {
    return json({ now: null, previousClose: null, history: [] });
  }
}



