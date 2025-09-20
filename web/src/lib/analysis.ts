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

export type TrailPoint = { t: number; F: number | null; V: number | null };
export type SnapshotTrails = Record<string, TrailPoint[]>;
export type SnapshotMeta = Record<string, { dLen: number; wLen: number }>;

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

// US sectors (SPDR)
export const UNIVERSE_US_SECTORS: AssetDef[] = [
  { id: 'XLB', name: 'US Materials (XLB)', cls: 'EQ', symbol: 'XLB', currency: 'USD' },
  { id: 'XLE', name: 'US Energy (XLE)', cls: 'EQ', symbol: 'XLE', currency: 'USD' },
  { id: 'XLF', name: 'US Financials (XLF)', cls: 'EQ', symbol: 'XLF', currency: 'USD' },
  { id: 'XLI', name: 'US Industrials (XLI)', cls: 'EQ', symbol: 'XLI', currency: 'USD' },
  { id: 'XLK', name: 'US Technology (XLK)', cls: 'EQ', symbol: 'XLK', currency: 'USD' },
  { id: 'XLP', name: 'US Staples (XLP)', cls: 'EQ', symbol: 'XLP', currency: 'USD' },
  { id: 'XLU', name: 'US Utilities (XLU)', cls: 'EQ', symbol: 'XLU', currency: 'USD' },
  { id: 'XLV', name: 'US Health Care (XLV)', cls: 'EQ', symbol: 'XLV', currency: 'USD' },
  { id: 'XLY', name: 'US Discretionary (XLY)', cls: 'EQ', symbol: 'XLY', currency: 'USD' },
  { id: 'XLRE', name: 'US Real Estate (XLRE)', cls: 'REIT', symbol: 'XLRE', currency: 'USD' },
  { id: 'XLC', name: 'US Comm Services (XLC)', cls: 'EQ', symbol: 'XLC', currency: 'USD' },
];

// JP sectors (NEXT FUNDSなどのセクターETFを近似、フォールバック可)
export const UNIVERSE_JP_SECTORS: AssetDef[] = [
  { id: '1612.T', name: 'JP 建設 (1612.T)', cls: 'EQ', symbol: '1612.T', currency: 'JPY', priceToUSD: 'JPY' },
  { id: '1613.T', name: 'JP 電機・精密 (1613.T)', cls: 'EQ', symbol: '1613.T', currency: 'JPY', priceToUSD: 'JPY' },
  { id: '1614.T', name: 'JP 機械 (1614.T)', cls: 'EQ', symbol: '1614.T', currency: 'JPY', priceToUSD: 'JPY' },
  { id: '1615.T', name: 'JP 銀行 (1615.T)', cls: 'EQ', symbol: '1615.T', currency: 'JPY', priceToUSD: 'JPY' },
  { id: '1616.T', name: 'JP 鉄鋼・非鉄 (1616.T)', cls: 'EQ', symbol: '1616.T', currency: 'JPY', priceToUSD: 'JPY' },
  { id: '1617.T', name: 'JP 食品 (1617.T)', cls: 'EQ', symbol: '1617.T', currency: 'JPY', priceToUSD: 'JPY' },
  { id: '1618.T', name: 'JP 化学 (1618.T)', cls: 'EQ', symbol: '1618.T', currency: 'JPY', priceToUSD: 'JPY' },
  { id: '1619.T', name: 'JP 卸売 (1619.T)', cls: 'EQ', symbol: '1619.T', currency: 'JPY', priceToUSD: 'JPY' },
  { id: '1620.T', name: 'JP 小売 (1620.T)', cls: 'EQ', symbol: '1620.T', currency: 'JPY', priceToUSD: 'JPY' },
  { id: '1621.T', name: 'JP 医薬品 (1621.T)', cls: 'EQ', symbol: '1621.T', currency: 'JPY', priceToUSD: 'JPY' },
  { id: '1622.T', name: 'JP 情報・通信 (1622.T)', cls: 'EQ', symbol: '1622.T', currency: 'JPY', priceToUSD: 'JPY' },
  { id: '1623.T', name: 'JP 運輸・物流 (1623.T)', cls: 'EQ', symbol: '1623.T', currency: 'JPY', priceToUSD: 'JPY' },
  { id: '1624.T', name: 'JP 電力・ガス (1624.T)', cls: 'EQ', symbol: '1624.T', currency: 'JPY', priceToUSD: 'JPY' },
  { id: '1625.T', name: 'JP パルプ・紙 (1625.T)', cls: 'EQ', symbol: '1625.T', currency: 'JPY', priceToUSD: 'JPY' },
  { id: '1626.T', name: 'JP 不動産 (1626.T)', cls: 'REIT', symbol: '1626.T', currency: 'JPY', priceToUSD: 'JPY' },
];

type Series = { time: number; price: number | null }[];

function log(n: number) { return Math.log(Math.max(n, 1e-9)); }
function finite(n: any): n is number { return typeof n === 'number' && Number.isFinite(n); }
function mean(arr: number[]) { return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0; }
function meanFinite(arr: number[]) { const xs = arr.filter(finite); return xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : NaN; }
function std(arr: number[]) { const m = mean(arr); const v = mean(arr.map(x => (x-m)*(x-m))); return Math.sqrt(v); }
function stdFinite(arr: number[]) { const xs = arr.filter(finite); if (!xs.length) return NaN; const m = xs.reduce((a,b)=>a+b,0)/xs.length; const v = xs.reduce((s,x)=> s + (x-m)*(x-m), 0) / xs.length; return Math.sqrt(v); }
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

export async function computeSnapshot(params = DEFAULT_PARAMS, universe?: AssetDef[]) {
  // fetch D (1y) and W (5y) series
  const uni = universe && universe.length ? universe : UNIVERSE;
  const daily: Record<string, Series> = {};
  const weekly: Record<string, Series> = {};
  const overrideMap = opts.overrides || {} as SnapshotOverrides;

  // FX for JPY conversion
  const fxJPY = await fetchHistoricalCandles('USDJPY=X', 'D').catch(()=>[]) as Candle[];
  const fxJPY_W = await fetchHistoricalCandles('USDJPY=X', 'W').catch(()=>[]) as Candle[];
  const fxD: Series = fxJPY.map(c=>({time:c.time, price: c.close||null}));
  const fxW: Series = fxJPY_W.map(c=>({time:c.time, price: c.close||null}));
  const fxDMap: Series = fxD;
  const fxWMap: Series = fxW;

  // helpers
  const toSeries = (candles: Candle[], conv: 'JPY' | undefined, fx: Series): Series => {
    return candles.map(c => {
      if (c.close == null) return { time: c.time, price: null };
      if (conv === 'JPY') {
        const rate = nearestValue(fx, c.time);
        if (rate == null || !Number.isFinite(rate)) return { time: c.time, price: null };
        return { time: c.time, price: c.close / rate };
      }
      return { time: c.time, price: c.close };
    });
  };
  function nearestValue(series: Series, t: number): number | null {
    // find nearest at or before t
    for (let i=series.length-1;i>=0;i--) if (series[i].time <= t) return series[i].price ?? null;
    return null;
  }

  await Promise.all(uni.map(async a => {
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
  for (const id of Object.keys(fd)) logP[id] = fd[id].map(v => finite(v) ? log(v) : NaN);
  const lnG = gd.map((_,i) => meanFinite(Object.keys(logP).map(id => logP[id][i])));
  const rpD: Record<string, number[]> = {};
  for (const id of Object.keys(logP)) rpD[id] = logP[id].map((x,i)=> (finite(x) && finite(lnG[i])) ? x - lnG[i] : NaN);
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
      if (!finite(rp[last]) || !finite(rp[last-L])) { m[id] = NaN; continue; }
      const delta = rp[last] - rp[last - L];
      const diffs: number[] = [];
      for (let k = last - L + 1; k <= last; k++) {
        const a = rp[k]; const b = rp[k-1];
        if (finite(a) && finite(b)) diffs.push(a - b);
      }
      const sigma = stdFinite(diffs);
      m[id] = finite(sigma) && sigma>0 ? delta / sigma : NaN;
    }
    const vals = Object.values(m).filter(finite);
    const mu = meanFinite(vals); const sd = stdFinite(vals);
    const z: Record<string, number> = {};
    for (const id of Object.keys(m)) {
      const v = m[id];
      if (!finite(v) || !finite(mu) || !finite(sd) || sd===0) { z[id] = NaN; continue; }
      const zi = (v - mu) / sd;
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
  for (const id of Object.keys(fw)) logPW[id] = fw[id].map(v => finite(v) ? log(v) : NaN);
  const lnGW = gw.map((_,i) => meanFinite(Object.keys(logPW).map(id => logPW[id][i])));
  const rpW: Record<string, number[]> = {};
  for (const id of Object.keys(logPW)) rpW[id] = logPW[id].map((x,i)=> (finite(x) && finite(lnGW[i])) ? x - lnGW[i] : NaN);

  function olsFitYhat(arrRaw: number[]): { yhatLast: number, dSeries: number[] } | null {
    const arr = arrRaw.filter(finite);
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
    const mu = meanFinite(r.dSeries); const sd = stdFinite(r.dSeries);
    if (!finite(mu) || !finite(sd) || sd===0) { V[id] = null; continue; }
    const zts = (r.dSeries[r.dSeries.length-1] - mu) / sd;
    V[id] = finite(zts) ? -zts : null;
  }

  // Assemble snapshot
  const lastPrice: Record<string, number | null> = {};
  const rpNow: Record<string, number | null> = {};
  for (const id of Object.keys(fd)) {
    const p = fd[id][last];
    lastPrice[id] = finite(p) ? p : null;
    const rps = rpDS[id];
    const v = rps && rps.length ? rps[rps.length-1] : NaN;
    rpNow[id] = finite(v) ? v : null;
  }

  // percentiles for F and V
  function percentileRank(values: number[], v: number) {
    const sorted = [...values].sort((a,b)=>a-b);
    const idx = sorted.findIndex(x=>x>=v);
    const i = idx<0 ? sorted.length-1 : idx;
    return Math.round((i/(sorted.length-1)) * 100);
  }
  const fVals = Object.values(F).filter(finite);
  const vVals = Object.values(V).filter((x): x is number => typeof x==='number' && Number.isFinite(x));

  const items: SnapshotItem[] = uni.map(a => {
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

type SnapshotOverrides = Record<string, { daily: Candle[]; weekly: Candle[] }>;

export async function computeSnapshotWithTrails(params = DEFAULT_PARAMS, uni: AssetDef[], monthsBack = 6, opts: { overrides?: SnapshotOverrides } = {}): Promise<{ items: SnapshotItem[]; trails: SnapshotTrails; meta: SnapshotMeta; params: typeof DEFAULT_PARAMS }>
{
  type Series = { time: number, price: number | null }[];
  const daily: Record<string, Series> = {};
  const weekly: Record<string, Series> = {};
  const overrideMap = opts.overrides || {} as SnapshotOverrides;

  const fxJPY = await fetchHistoricalCandles('USDJPY=X', 'D').catch(()=>[]) as Candle[];
  const fxJPY_W = await fetchHistoricalCandles('USDJPY=X', 'W').catch(()=>[]) as Candle[];
  const fxD: Series = fxJPY.map(c=>({time:c.time, price: c.close||null}));
  const fxW: Series = fxJPY_W.map(c=>({time:c.time, price: c.close||null}));

  const toSeries = (candles: Candle[], conv: 'JPY' | undefined, fx: Series): Series => candles.map(c => {
    if (c.close == null) return { time: c.time, price: null };
    if (conv === 'JPY') {
      const rate = nearestValue(fx, c.time);
      if (rate == null || !Number.isFinite(rate)) return { time: c.time, price: null };
      return { time: c.time, price: c.close / rate };
    }
    return { time: c.time, price: c.close };
  });
  function nearestValue(series: Series, t: number): number | null { for (let i=series.length-1;i>=0;i--) if (series[i].time <= t) return series[i].price ?? null; return null; }

  await Promise.all(uni.map(async a => {
    const override = overrideMap[a.id] || overrideMap[a.symbol];
    if (override) {
      daily[a.id] = toSeries(override.daily, a.priceToUSD, fxD);
      weekly[a.id] = toSeries(override.weekly, a.priceToUSD, fxW);
      return;
    }
    const [cd, cw] = await Promise.all([
      fetchHistoricalCandles(a.symbol, 'D').catch(()=>[]),
      fetchHistoricalCandles(a.symbol, 'W').catch(()=>[]),
    ]);
    daily[a.id] = toSeries(cd as Candle[], a.priceToUSD, fxD);
    weekly[a.id] = toSeries(cw as Candle[], a.priceToUSD, fxW);
  }));

  // Align
  const { grid: gd, filled: fd } = alignForwardFill(daily);
  const { grid: gw, filled: fw } = alignForwardFill(weekly);

  // Prepare RP D & W
  const logPD: Record<string, number[]> = {}; for (const id of Object.keys(fd)) logPD[id] = fd[id].map(v => finite(v) ? log(v) : NaN);
  const lnGD = gd.map((_,i) => meanFinite(Object.keys(logPD).map(id => logPD[id][i])));
  const rpD: Record<string, number[]> = {}; for (const id of Object.keys(logPD)) rpD[id] = logPD[id].map((x,i)=> (finite(x) && finite(lnGD[i])) ? x - lnGD[i] : NaN);
  const rpDS: Record<string, number[]> = {}; for (const id of Object.keys(rpD)) rpDS[id] = ewma(rpD[id], params.ewma_half_life_rp);

  const logPW: Record<string, number[]> = {}; for (const id of Object.keys(fw)) logPW[id] = fw[id].map(v => finite(v) ? log(v) : NaN);
  const lnGW = gw.map((_,i) => meanFinite(Object.keys(logPW).map(id => logPW[id][i])));
  const rpW: Record<string, number[]> = {}; for (const id of Object.keys(logPW)) rpW[id] = logPW[id].map((x,i)=> (finite(x) && finite(lnGW[i])) ? x - lnGW[i] : NaN);

  // Build sampling indices for past N months (oldest..latest)
  const samples: number[] = [];
  for (let m = monthsBack; m >= 1; m--) {
    const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); d.setMonth(d.getMonth()-m+1);
    const t = Math.floor(d.getTime()/1000);
    let ti = -1; for (let i=0;i<gd.length;i++){ if (gd[i] >= t) { ti = i; break; } }
    if (ti < 0) continue; if (samples.length===0 || samples[samples.length-1] !== ti) samples.push(ti);
  }
  if (samples.length===0 || samples[samples.length-1] !== gd.length-1) samples.push(gd.length-1);

  function F_at(ti: number): Record<string, number | null> {
    const Ls = [params.windows.short, params.windows.mid, params.windows.long];
    const mByL: Record<number, Record<string, number>> = {};
    for (const L of Ls) {
      const m: Record<string, number> = {};
      for (const id of Object.keys(rpDS)) {
        if (ti - L < 2) { m[id] = NaN; continue; }
        const rp = rpDS[id];
        if (!finite(rp[ti]) || !finite(rp[ti-L])) { m[id] = NaN; continue; }
        const delta = rp[ti] - rp[ti - L];
        const diffs: number[] = [];
        for (let k = ti - L + 1; k <= ti; k++) {
          const a = rp[k]; const b = rp[k-1];
          if (finite(a) && finite(b)) diffs.push(a - b);
        }
        const sigma = stdFinite(diffs);
        m[id] = finite(sigma) && sigma>0 ? delta / sigma : NaN;
      }
      const vals = Object.values(m).filter(finite);
      const mu = meanFinite(vals); const sd = stdFinite(vals);
      const z: Record<string, number> = {};
      for (const id of Object.keys(m)) {
        const v = m[id];
        if (!finite(v) || !finite(mu) || !finite(sd) || sd===0) { z[id] = NaN; continue; }
        const zi = (v - mu) / sd;
        z[id] = clamp(zi, -params.winsor_sigma, params.winsor_sigma);
      }
      mByL[L] = z;
    }
    const F: Record<string, number | null> = {};
    for (const id of Object.keys(rpDS)) {
      const z20 = mByL[params.windows.short]?.[id] ?? NaN;
      const z63 = mByL[params.windows.mid]?.[id] ?? NaN;
      const z252 = mByL[params.windows.long]?.[id] ?? NaN;
      const v = z20 * params.weights.short + z63 * params.weights.mid + z252 * params.weights.long;
      F[id] = Number.isFinite(v) ? v : null;
    }
    return F;
  }

  function V_at(ti: number): Record<string, number | null> {
    const t = gd[ti];
    let wi = -1; for (let i=0;i<gw.length;i++){ if (gw[i] <= t) wi = i; else break; }
    const V: Record<string, number | null> = {};
    if (wi < 0) { for (const id of Object.keys(rpW)) V[id] = null; return V; }
    function olsD(arrRaw: number[]): { z: number | null } {
      const arr = arrRaw.slice(0, wi+1).filter(finite);
      const n = arr.length; if (n < 40) return { z: null };
      const x = Array.from({length: n}, (_,i)=>i);
      const mx = mean(x); const my = mean(arr);
      let num = 0, den = 0;
      for (let i=0;i<n;i++){ num += (x[i]-mx)*(arr[i]-my); den += (x[i]-mx)*(x[i]-mx); }
      const b1 = den ? num/den : 0; const b0 = my - b1*mx;
      const yhat = x.map(xi => b0 + b1*xi);
      const d = arr.map((v,i)=> v - yhat[i]);
      const mu = meanFinite(d); const sd = stdFinite(d);
      if (!finite(mu) || !finite(sd) || sd===0) return { z: null };
      const zts = (d[d.length-1] - mu) / sd;
      return { z: finite(zts) ? -zts : null };
    }
    for (const id of Object.keys(rpW)) {
      const rr = olsD(rpW[id]);
      V[id] = rr.z;
    }
    return V;
  }

  const meta: SnapshotMeta = {};
  for (const id of Object.keys(fd)) meta[id] = { dLen: fd[id].length, wLen: fw[id]?.length || 0 };

  const last = gd.length - 1;
  const F_now = F_at(last);
  const V_now = V_at(last);
  const items: SnapshotItem[] = uni.map(a => {
    const lastPrice = (() => { const arr = fd[a.id]; const v = arr && arr.length ? arr[arr.length-1] : null; return (v!=null && Number.isFinite(v) ? v : null); })();
    const rpNow = (() => { const rps = rpDS[a.id]; const v = rps && rps.length ? rps[rps.length-1] : NaN; return Number.isFinite(v) ? v : null; })();
    const f = F_now[a.id] ?? null;
    const v = V_now[a.id] ?? null;
    const aScore = (f!=null && v!=null) ? (params.lambda_AV * f + (1-params.lambda_AV) * v) : null;
    const fVals = Object.values(F_now).filter((x): x is number => Number.isFinite(x as number));
    const vVals = Object.values(V_now).filter((x): x is number => Number.isFinite(x as number));
    function percentileRank(values: number[], vv: number) { const sorted = [...values].sort((a,b)=>a-b); const idx = sorted.findIndex(x=>x>=vv); const i = idx<0 ? sorted.length-1 : idx; return Math.round((i/(sorted.length-1)) * 100); }
    const fPctl = (f!=null) ? percentileRank(fVals, f) : null;
    const vPctl = (v!=null) ? percentileRank(vVals, v) : null;
    let quad: SnapshotItem['quadrant'] = 'NA';
    if (fPctl!=null && vPctl!=null) {
      if (fPctl>=80 && vPctl>=60) quad='Q1'; else if (fPctl>=80 && vPctl<40) quad='Q2'; else if (fPctl<20 && vPctl>=60) quad='Q3'; else if (fPctl<20 && vPctl<40) quad='Q4'; else quad='NA';
    }
    return { id: a.id, name: a.name, cls: a.cls, currency: a.currency || 'USD', last_price: lastPrice, rp: rpNow, F: f, V: v, A: aScore, f_pctl: fPctl, v_pctl: vPctl, a_rank: null, quadrant: quad };
  });
  const aVals = items.map(i => (i.A!=null? i.A: -Infinity)); const sortedIdx = aVals.map((v,i)=>({v,i})).sort((a,b)=> (b.v - a.v)); sortedIdx.forEach((o,rank)=>{ if (Number.isFinite(o.v)) items[o.i].a_rank = rank+1; });

  const trails: SnapshotTrails = {};
  for (const a of uni) trails[a.id] = [];
  for (const ti of samples) {
    const F_t = F_at(ti);
    const V_t = V_at(ti);
    const tt = gd[ti];
    for (const a of uni) trails[a.id].push({ t: tt, F: F_t[a.id] ?? null, V: V_t[a.id] ?? null });
  }

  return { items, trails, meta, params };
}
