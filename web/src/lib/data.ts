import type { Candle, MarketQuote, Timeframe, TickerSymbol } from '../types';

const API_BASE = '';

// Real data fetchers (with graceful fallback to sim)
export async function fetchMarketQuotes(symbols: TickerSymbol[]): Promise<Record<string, MarketQuote>> {
  try {
    const u = new URL(API_BASE + '/api/quote', window.location.origin);
    u.searchParams.set('symbols', symbols.join(','));
    const res = await fetch(u.toString());
    if (!res.ok) throw new Error('quote http ' + res.status);
    const json = await res.json();
    return json;
  } catch (e) {
    // 実データが取得できない場合は乱数での擬似データは返さず、呼び出し側でハンドリングさせる
    console.error('Failed to fetch quotes:', e);
    throw e;
  }
}

export async function fetchHistoricalCandles(symbol: TickerSymbol, timeframe: Timeframe): Promise<Candle[]> {
  try {
    const u = new URL(API_BASE + '/api/chart', window.location.origin);
    u.searchParams.set('symbol', symbol);
    u.searchParams.set('tf', timeframe);
    const res = await fetch(u.toString());
    if (!res.ok) throw new Error('chart http ' + res.status);
    return await res.json();
  } catch (e) {
    console.warn('chart fallback (sim)', e);
    return simulateCandles(symbol, timeframe);
  }
}

export async function fetchFundamentals(symbol: TickerSymbol): Promise<{ yoyRevenuePct: number | null, yoyOperatingIncomePct: number | null }> {
  try {
    const u = new URL(API_BASE + '/api/fundamentals', window.location.origin);
    u.searchParams.set('symbol', symbol);
    const res = await fetch(u.toString());
    if (!res.ok) throw new Error('fundamentals http ' + res.status);
    return await res.json();
  } catch (e) {
    console.warn('fundamentals fallback (sim)', e);
    return { yoyRevenuePct: null, yoyOperatingIncomePct: null };
  }
}

export function movingAverage(src: Candle[], length: number): { time: number; value: number }[] {
  const out: { time: number; value: number }[] = [];
  let sum = 0;
  for (let i = 0; i < src.length; i++) {
    sum += src[i].close;
    if (i >= length) sum -= src[i - length].close;
    if (i >= length - 1) out.push({ time: src[i].time, value: round2(sum / length) });
  }
  return out;
}

export function bollingerBands(src: Candle[], length = 20, mul = 2): { time: number; upper: number; basis: number; lower: number }[] {
  const out: { time: number; upper: number; basis: number; lower: number }[] = [];
  const q: number[] = [];
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < src.length; i++) {
    const v = src[i].close;
    q.push(v);
    sum += v;
    sumSq += v * v;
    if (q.length > length) {
      const rm = q.shift()!;
      sum -= rm;
      sumSq -= rm * rm;
    }
    if (q.length === length) {
      const mean = sum / length;
      const variance = sumSq / length - mean * mean;
      const stdev = Math.sqrt(Math.max(variance, 0));
      out.push({ time: src[i].time, upper: round2(mean + mul * stdev), basis: round2(mean), lower: round2(mean - mul * stdev) });
    }
  }
  return out;
}

export function inferTrend(src: Candle[]): 'up' | 'down' | 'flat' {
  const ma50 = movingAverage(src, 50);
  const ma200 = movingAverage(src, 200);
  if (ma200.length === 0 || ma50.length === 0 || !src.length) return 'flat';
  const last50 = ma50[ma50.length - 1];
  const last200 = ma200[ma200.length - 1];
  const lastClose = src[src.length - 1]?.close;

  if (lastClose != null && Number.isFinite(lastClose)) {
    if (lastClose > last50.value && last50.value > last200.value) {
      return 'up';
    }
    if (lastClose < last50.value && last50.value < last200.value) {
      return 'down';
    }
  }
  return 'flat';
}

// ----- simulation fallback helpers -----
function seededNumber(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return Math.abs(h >>> 0);
}

function randRange(min: number, max: number) {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

async function simulateQuotes(symbols: TickerSymbol[]): Promise<Record<string, MarketQuote>> {
  const out: Record<string, MarketQuote> = {};
  for (const sym of symbols) {
    const base = seededNumber(sym) % 500 + 50;
    const noise = (Math.random() - 0.5) * base * 0.02;
    const prevClose = round2(base + noise);
    const drift = (Math.random() - 0.5) * prevClose * 0.03;
    const price = round2(prevClose + drift);
    const change = round2(price - prevClose);
    const changePct = round2((change / Math.max(prevClose, 0.01)) * 100);
    const currency: 'JPY' | 'USD' = sym.endsWith('.T') || sym.includes('=X') ? 'JPY' : 'USD';
    out[sym] = {
      symbol: sym,
      name: sym,
      price,
      prevClose,
      change,
      changePct,
      currency,
      per: randRange(8, 30), pbr: randRange(0.8, 5), dividendYieldPct: Math.max(0, randRange(-0.5, 4)), marketCap: Math.round(randRange(1, 200) * 1e10),
      trend: 'flat',
    } as any;
  }
  return out;
}

function simulateCandles(symbol: TickerSymbol, timeframe: Timeframe): Candle[] {
  const out: Candle[] = [];
  const now = Math.floor(Date.now() / 1000);
  const points = timeframe === 'D' ? 380 : timeframe === 'W' ? 52 * 5 : 12 * 15;
  const step = timeframe === 'D' ? 86400 : timeframe === 'W' ? 7 * 86400 : 30 * 86400;
  let price = seededNumber(symbol) % 600 + 100;
  for (let i = points - 1; i >= 0; i--) {
    const t = now - i * step;
    const open = price;
    const change = (Math.random() - 0.48) * price * 0.04;
    const close = open + change;
    const high = Math.max(open, close) + Math.random() * price * 0.01;
    const low = Math.min(open, close) - Math.random() * price * 0.01;
    const volume = Math.random() * 2e6 + 5e5;
    out.push({ time: t, open: round2(open), high: round2(high), low: round2(low), close: round2(close), value: Math.round(volume) });
    price = close;
  }
  return out;
}
