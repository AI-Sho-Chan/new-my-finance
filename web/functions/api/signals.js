import { json, text } from '../_utils.mjs';

function sma(arr, n){ const r=[]; let s=0; for(let i=0;i<arr.length;i++){ s+=arr[i]; if(i>=n) s-=arr[i-n]; if(i>=n-1) r.push(s/n); else r.push(null); } return r; }
function ema(vals, n=20){ const k=2/(n+1); const res=[]; let e=null; for(let i=0;i<vals.length;i++){ const v=vals[i]; if(!Number.isFinite(v)){ res.push(null); continue;} e = (e==null)? v : e + k*(v-e); res.push(e);} return res; }
function atr(h,l,c, n=14){ const tr=[]; for(let i=0;i<c.length;i++){ const prev = i>0 ? c[i-1] : c[i]; tr[i] = Math.max(h[i]-l[i], Math.abs(h[i]-prev), Math.abs(l[i]-prev)); } return sma(tr,n); }
function rsi(cl, n=14){ const r=[]; let up=0, dn=0; for(let i=1;i<cl.length;i++){ const ch=cl[i]-cl[i-1]; const g=Math.max(0,ch), d=Math.max(0,-ch); if(i<=n){ up+=g; dn+=d; r.push(null); if(i===n){ const rs= dn===0? 100 : up/dn; r.push(100-100/(1+rs)); } } else { up = (up*(n-1)+g)/n; dn = (dn*(n-1)+d)/n; const rs = dn===0? 100 : up/dn; r.push(100-100/(1+rs)); } } r.unshift(null); return r; }
function lastIdx(vals){ for(let i=vals.length-1;i>=0;i--){ if(vals[i]!=null && Number.isFinite(vals[i])) return i; } return -1; }
function maxN(arr, n){ let m=-Infinity; for(let i=Math.max(0,arr.length-n); i<arr.length; i++){ m=Math.max(m, arr[i]); } return m; }

export async function onRequest({ request }) {
  if (request.method === 'OPTIONS') return text('', { status: 204 });
  try {
    let body = {};
    if (request.method === 'POST') {
      try { body = await request.json(); } catch {}
    }
    const symbols = Array.isArray(body.symbols) ? body.symbols : [];
    const out = {};
    for (const sym of symbols){
      try {
        const urls = [
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=2y&includePrePost=false&events=div%2Csplit`,
          `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=2y&includePrePost=false&events=div%2Csplit`,
        ];
        let rr=null;
        for (const u of urls) {
          const r = await fetch(u);
          const j = await r.json();
          rr = (j?.chart?.result||[])[0];
          if (rr) break;
        }
        if(!rr){ out[sym] = { signals: [] }; continue; }
        const ts = rr.timestamp||[];
        const q = (rr.indicators||{}).quote?.[0]||{};
        const open=q.open||[], high=q.high||[], low=q.low||[], close=q.close||[], vol=q.volume||[];
        const ema20 = ema(close,20);
        const ma50 = sma(close,50), ma150=sma(close,150), ma200=sma(close,200);
        const atr14 = atr(high,low,close,14);
        const rsi14 = rsi(close,14);
        const iLast = lastIdx(close);
        const signals=[];
        if(iLast>0){
          const max252 = maxN(close.slice(0,iLast), 252);
          const broke = close[iLast-1] >= max252 && close[iLast-2] < max252 ? true : false;
          const pulled = (close[iLast] <= (ema20[iLast] + (atr14[iLast]||0)*0.2)) && (close[iLast] >= ema20[iLast] - (atr14[iLast]||0)*1.2);
          if (broke && pulled) signals.push({ type:'52H+', date: ts[iLast], strength: 0.7, reason: 'Breakout then first pullback near 20EMA' });
        }
        const uptrend = ma50[iLast]>ma150[iLast] && ma150[iLast]>ma200[iLast];
        if(uptrend){
          const bandLow = (ema20[iLast]||0) - (atr14[iLast]||0)*1.5;
          const nearBand = close[iLast] <= (ema20[iLast]||0) && close[iLast] >= bandLow;
          const rsiOk = (rsi14[iLast]||50) <= 45 && (rsi14[iLast]||50) >= 28;
          if(nearBand && rsiOk) signals.push({ type:'押', date: ts[iLast], strength: 0.6, reason: 'Pullback to EMA20 - 1.5*ATR with RSI zone' });
        }
        out[sym] = { signals };
      } catch (e) { out[sym] = { signals: [] }; }
    }
    return json(out);
  } catch (e) {
    return json({ error: String(e?.message||e) }, { status: 400 });
  }
}

