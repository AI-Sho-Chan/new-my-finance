import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const outFile = path.resolve(root, 'data', 'fgi', 'history.json');

async function fetchText(url, headers) {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}

async function main() {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36 FGI/cron',
    'Accept': 'application/json,*/*',
    'Accept-Language': 'ja,en;q=0.9',
    'Referer': 'https://edition.cnn.com/markets/fear-and-greed',
    'Origin': 'https://edition.cnn.com',
  };
  let now = null, previousClose = null, history = [];
  try {
    const [ct, gt] = await Promise.all([
      fetchText('https://production.dataviz.cnn.io/index/fearandgreed/current', headers),
      fetchText('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', headers),
    ]);
    const cj = JSON.parse(ct);
    const gj = JSON.parse(gt);
    now = Number(cj?.fear_and_greed?.now?.value ?? cj?.fear_and_greed?.now ?? cj?.now ?? cj?.score ?? null);
    previousClose = Number(cj?.fear_and_greed?.previous_close?.value ?? cj?.fear_and_greed?.previous_close ?? cj?.previous_close ?? null);
    const hist = Array.isArray(gj?.fear_and_greed_historical) ? gj.fear_and_greed_historical : [];
    history = hist.map(x => ({ t: Number(x.x) || null, v: Number(x.y) || null })).filter(x => Number.isFinite(x.t) && Number.isFinite(x.v));
  } catch {}

  if (!Array.isArray(history) || history.length === 0) {
    try {
      const html = await fetchText('https://edition.cnn.com/markets/fear-and-greed', {
        'User-Agent': headers['User-Agent'],
        'Accept': 'text/html,*/*',
        'Accept-Language': headers['Accept-Language'],
        'Referer': 'https://edition.cnn.com/',
      });
      const key = 'fear_and_greed_historical';
      const i = html.indexOf(key);
      if (i >= 0) {
        const after = html.slice(i);
        const lb = after.indexOf('[');
        if (lb >= 0) {
          let depth = 0; let j = lb; let end = -1;
          for (; j < after.length; j++) {
            const ch = after[j];
            if (ch === '[') depth++;
            else if (ch === ']') { depth--; if (depth === 0) { end = j; break; } }
          }
          if (end > lb) {
            const arrTxt = after.slice(lb, end + 1);
            try {
              const arr = JSON.parse(arrTxt);
              if (Array.isArray(arr)) history = arr.map(x => ({ t: Number(x.x) || null, v: Number(x.y) || null })).filter(x => Number.isFinite(x.t) && Number.isFinite(x.v));
            } catch {}
          }
        }
      }
    } catch {}
  }

  // Merge with local file and persist
  let existing = [];
  if (fs.existsSync(outFile)) {
    try { const j = JSON.parse(fs.readFileSync(outFile, 'utf8')); existing = Array.isArray(j?.history) ? j.history : []; } catch {}
  }
  // add today's now if missing
  if (Number.isFinite(now)) {
    const d = new Date(); d.setHours(0,0,0,0);
    const t0 = d.getTime();
    if (!history.some(x => x && Number(x.t) === t0)) history = history.concat([{ t: t0, v: Number(now) }]);
  }
  const map = new Map();
  for (const x of existing) { const tt = Number(x?.t); if (Number.isFinite(tt)) map.set(tt, Number(x.v)); }
  for (const x of history) { const tt = Number(x?.t); if (Number.isFinite(tt)) map.set(tt, Number(x.v)); }
  const merged = Array.from(map.entries()).map(([t,v])=>({t,v})).sort((a,b)=>a.t-b.t);
  const dir = path.dirname(outFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ history: merged }, null, 2), 'utf8');
  console.log('FGI update: now=', now, 'prev=', previousClose, 'hist_len=', merged.length, 'file=', outFile);
}

main().catch(e=>{ console.error(e); process.exitCode=1; });

