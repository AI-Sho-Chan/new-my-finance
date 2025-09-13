import type { Candle } from '../types';
import { fetchHistoricalCandles } from './data';

export type AssetDef = { id: string; name: string; cls: string; symbol: string; currency?: 'USD' | 'JPY' | 'EUR'; priceToUSD?: 'JPY'; };
export type SnapshotItem = {
  id: string; name: string; cls: string; currency: string;
  last_price: number | null;
  rp: number | null;
  F: number | null;
  V: number | null;
  A: number | null;
  f_pctl: number | null;
  v_pctl: number | null;
  a_rank: number | null;
  quadrant: 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'NA';
};

export const DEFAULT_PARAMS = {
  windows: { short: 20, mid: 63, long: 252 },
  weights: { short: 0.5, mid: 0.35, long: 0.15 },
  lambda_AV: 0.6,
  winsor_sigma: 3.0,
  ewma_half_life_rp: 10,
};

export const UNIVERSE: AssetDef[] = [
  { id: 'USD', name: 'US Dollar (UUP)', cls: 'FX', symbol: 'UUP', currency: 'USD' },
  { id: 'EUR', name: 'Euro (FXE)', cls: 'FX', symbol: 'FXE', currency: 'USD' },
  { id: 'JPY', name: 'Japanese Yen (FXY)', cls: 'FX', symbol: 'FXY', currency: 'USD' },

  { id: 'UST_0_3', name: 'US Treas 0-3Y (SHY)', cls: 'BOND', symbol: 'SHY', currency: 'USD' },
  { id: 'UST_3_7', name: 'US Treas 3-7Y (IEI)', cls: 'BOND', symbol: 'IEI', currency: 'USD' },
  { id: 'UST_20P', name: 'US Treas 20Y+ (TLT)', cls: 'BOND', symbol: 'TLT', currency: 'USD' },

  { id: 'SPX', name: 'S&P 500 (^GSPC)', cls: 'EQ', symbol: '^GSPC', currency: 'USD' },
  { id: 'NASDAQ', name: 'NASDAQ (^IXIC)', cls: 'EQ', symbol: '^IXIC', currency: 'USD' },
  { id: 'RUSSELL', name: 'Russell 2000 (^RUT)', cls: 'EQ', symbol: '^RUT', currency: 'USD' },
  { id: 'NIKKEI', name: 'Nikkei 225 (^N225)', cls: 'EQ', symbol: '^N225', currency: 'JPY', priceToUSD: 'JPY' },
  { id: 'TOPIX', name: 'TOPIX ETF (1306.T)', cls: 'EQ', symbol: '1306.T', currency: 'JPY', priceToUSD: 'JPY' },

  { id: 'GOLD', name: 'Gold (GLD)', cls: 'CMD', symbol: 'GLD', currency: 'USD' },
  { id: 'OIL', name: 'WTI (USO)', cls: 'CMD', symbol: 'USO', currency: 'USD' },
  { id: 'BTC', name: 'Bitcoin (BTC-USD)', cls: 'CRYPTO', symbol: 'BTC-USD', currency: 'USD' },
  { id: 'JP_REIT', name: 'JP REIT (1343.T)', cls: 'REIT', symbol: '1343.T', currency: 'JPY', priceToUSD: 'JPY' },
  { id: 'US_REIT', name: 'US REIT (VNQ)', cls: 'REIT', symbol: 'VNQ', currency: 'USD' },
];

type Series = { time: number; price: number | null }[];

function log(n: number) { return Math.log(Math.max(n, 1e-9)); }
function mean(arr: number[]) { return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0; }
function std(arr: number[]) { const m = mean(arr); const v = mean(arr.map(x => (x-m)*(x-m))); return Math.sqrt(v); }
function clamp(x: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, x)); }

function ewma(src: number[], halflife: number): number[] {
  if (!src.length) return [];
  const alpha = 1 - Math.exp(Math.log(0.5) / halflife);
  const out = new Array(src.length);
  let m = src[0]; out[0] = m;
  for (let i=1;i<src.length;i++){ m = alpha*src[i] + (1-alpha)*m; out[i]=m; }
  return out;
}

function alignForwardFill(seriesMap: Record<string, Series>): { grid: number[]; filled: Record<string, number[]> } {
  // build union time grid (sorted)
  const set = new Set<number>();
  for (const k of Object.keys(seriesMap)) for (const p of seriesMap[k]) set.add(p.time);
  const grid = Array.from(set.values()).sort((a,b)=>a-b);
  const filled: Record<string, number[]> = {};
  for (const k of Object.keys(seriesMap)) {
    const ser = seriesMap[k];
    let j = 0; let last: number | null = null;
    const row: number[] = [];
    for (const t of grid) {
      while (j < ser.length && ser[j].time <= t) { last = ser[j].price ?? last; j++; }
      row.push(last ?? NaN);
    }
    // forward-fill left side: still NaN -> first observed
    let first = row.find(v=>Number.isFinite(v));
    if (first == null) first = NaN;
    for (let i=0;i<row.length;i++) { if (!Number.isFinite(row[i])) row[i] = first as number; else break; }
    filled[k] = row;
  }
  return { grid, filled };
}

export async function computeSnapshot(params = DEFAULT_PARAMS) {
  // fetch D (1y) and W (5y) series
  const daily: Record<string, Series> = {};
  const weekly: Record<string, Series> = {};

  // FX for JPY conversion
  const fxJPY = await fetchHistoricalCandles('USDJPY=X', 'D').catch(()=>[]) as Candle[];
  const fxJPY_W = await fetchHistoricalCandles('USDJPY=X', 'W').catch(()=>[]) as Candle[];
  const fxD: Series = fxJPY.map(c=>({time:c.time, price: c.close||null}));
  const fxW: Series = fxJPY_W.map(c=>({time:c.time, price: c.close||null}));
  const fxDMap: Series = fxD;
  const fxWMap: Series = fxW;

  // helpers
  const toSeries = (candles: Candle[], conv: 'JPY' | undefined, fx: Series): Series => {
    return candles.map(c => ({ time: c.time, price: (c.close!=null) ? (conv==='JPY' ? (c.close / (nearestValue(fx, c.time) || 150)) : c.close) : null }));
  };
  function nearestValue(series: Series, t: number): number | null {
    // find nearest at or before t
    for (let i=series.length-1;i>=0;i--) if (series[i].time <= t) return series[i].price ?? null;
    return null;
  }

  await Promise.all(UNIVERSE.map(async a => {
    const [cd, cw] = await Promise.all([
      fetchHistoricalCandles(a.symbol, 'D').catch(()=>[]),
      fetchHistoricalCandles(a.symbol, 'W').catch(()=>[]),
    ]);
    daily[a.id] = toSeries(cd as Candle[], a.priceToUSD, fxDMap);
    weekly[a.id] = toSeries(cw as Candle[], a.priceToUSD, fxWMap);
  }));

  // RP (daily) for Flow
  const { grid: gd, filled: fd } = alignForwardFill(daily);
  const logP: Record<string, number[]> = {};
  for (const id of Object.keys(fd)) logP[id] = fd[id].map(v => log(v));
  const lnG = gd.map((_,i) => mean(Object.keys(logP).map(id => logP[id][i])));
  const rpD: Record<string, number[]> = {};
  for (const id of Object.keys(logP)) rpD[id] = logP[id].map((x,i)=> x - lnG[i]);
  // smooth RP
  const rpDS: Record<string, number[]> = {};
  for (const id of Object.keys(rpD)) rpDS[id] = ewma(rpD[id], params.ewma_half_life_rp);

  // Flow at last index
  const Ls = [params.windows.short, params.windows.mid, params.windows.long];
  const last = gd.length - 1;
  const eps = 1e-9;
  const mByL: Record<number, Record<string, number>> = {};
  for (const L of Ls) {
    const m: Record<string, number> = {};
    for (const id of Object.keys(rpDS)) {
      if (last - L < 2) { m[id] = NaN; continue; }
      const rp = rpDS[id];
      const delta = rp[last] - rp[last - L];
      const diffs: number[] = [];
      for (let k = last - L + 1; k <= last; k++) diffs.push(rp[k] - rp[k - 1]);
      const sigma = std(diffs) || eps;
      m[id] = delta / (sigma || eps);
    }
    // cross-sectional z
    const vals = Object.values(m).filter(x=>Number.isFinite(x));
    const mu = mean(vals); const sd = std(vals) || 1;
    const z: Record<string, number> = {};
    for (const id of Object.keys(m)) {
      const zi = (m[id] - mu) / sd;
      z[id] = clamp(zi, -params.winsor_sigma, params.winsor_sigma);
    }
    mByL[L] = z;
  }
  const F: Record<string, number> = {};
  for (const id of Object.keys(rpDS)) {
    const z20 = mByL[params.windows.short]?.[id] ?? NaN;
    const z63 = mByL[params.windows.mid]?.[id] ?? NaN;
    const z252 = mByL[params.windows.long]?.[id] ?? NaN;
    F[id] = z20 * params.weights.short + z63 * params.weights.mid + z252 * params.weights.long;
  }

  // Value using weekly (5y)
  const { grid: gw, filled: fw } = alignForwardFill(weekly);
  const logPW: Record<string, number[]> = {};
  for (const id of Object.keys(fw)) logPW[id] = fw[id].map(v => log(v));
  const lnGW = gw.map((_,i) => mean(Object.keys(logPW).map(id => logPW[id][i])));
  const rpW: Record<string, number[]> = {};
  for (const id of Object.keys(logPW)) rpW[id] = logPW[id].map((x,i)=> x - lnGW[i]);

  function olsFitYhat(arr: number[]): { yhatLast: number, dSeries: number[] } | null {
    const n = arr.length; if (n < 40) return null;
    const x = Array.from({length: n}, (_,i)=>i);
    const mx = mean(x); const my = mean(arr);
    let num = 0, den = 0;
    for (let i=0;i<n;i++){ num += (x[i]-mx)*(arr[i]-my); den += (x[i]-mx)*(x[i]-mx); }
    const b1 = den ? num/den : 0; const b0 = my - b1*mx;
    const yhat = x.map(xi => b0 + b1*xi);
    const d = arr.map((v,i)=> v - yhat[i]);
    return { yhatLast: yhat[n-1], dSeries: d };
  }

  const V: Record<string, number | null> = {};
  for (const id of Object.keys(rpW)) {
    const r = olsFitYhat(rpW[id]);
    if (!r) { V[id] = null; continue; }
    const mu = mean(r.dSeries); const sd = std(r.dSeries) || 1;
    const zts = (r.dSeries[r.dSeries.length-1] - mu) / sd;
    V[id] = -zts;
  }

  // Assemble snapshot
  const lastPrice: Record<string, number | null> = {};
  const rpNow: Record<string, number | null> = {};
  for (const id of Object.keys(fd)) {
    const p = fd[id][last];
    lastPrice[id] = Number.isFinite(p) ? p : null;
    const rps = rpDS[id];
    rpNow[id] = rps && rps.length ? rps[rps.length-1] : null;
  }

  // percentiles for F and V
  function percentileRank(values: number[], v: number) {
    const sorted = [...values].sort((a,b)=>a-b);
    const idx = sorted.findIndex(x=>x>=v);
    const i = idx<0 ? sorted.length-1 : idx;
    return Math.round((i/(sorted.length-1)) * 100);
  }
  const fVals = Object.values(F).filter(x=>Number.isFinite(x));
  const vVals = Object.values(V).filter((x): x is number => typeof x==='number' && Number.isFinite(x));

  const items: SnapshotItem[] = UNIVERSE.map(a => {
    const f = F[a.id];
    const v = V[a.id];
    const aScore = (Number.isFinite(f) && Number.isFinite(v as number)) ? (params.lambda_AV * f + (1-params.lambda_AV) * (v as number)) : null;
    const fPctl = Number.isFinite(f) ? percentileRank(fVals, f) : null;
    const vPctl = Number.isFinite(v as number) ? percentileRank(vVals, v as number) : null;
    let quad: SnapshotItem['quadrant'] = 'NA';
    if (fPctl!=null && vPctl!=null) {
      if (fPctl>=80 && vPctl>=60) quad='Q1';
      else if (fPctl>=80 && vPctl<40) quad='Q2';
      else if (fPctl<20 && vPctl>=60) quad='Q3';
      else if (fPctl<20 && vPctl<40) quad='Q4';
      else quad='NA';
    }
    return {
      id: a.id,
      name: a.name,
      cls: a.cls,
      currency: a.currency || 'USD',
      last_price: lastPrice[a.id] ?? null,
      rp: rpNow[a.id] ?? null,
      F: Number.isFinite(f) ? f : null,
      V: Number.isFinite(v as number) ? (v as number) : null,
      A: aScore,
      f_pctl: fPctl,
      v_pctl: vPctl,
      a_rank: null, // fill later
      quadrant: quad,
    };
  });
  // ranks
  const aVals = items.map(i => (i.A!=null? i.A: -Infinity));
  const sortedIdx = aVals.map((v,i)=>({v,i})).sort((a,b)=> (b.v - a.v));
  sortedIdx.forEach((o,rank)=>{ if (Number.isFinite(o.v)) items[o.i].a_rank = rank+1; });

  return { items, params };
}

