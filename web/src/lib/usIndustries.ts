import type { AssetDef } from './analysis';
import type { Candle } from '../types';

type USIndustryPoint = { date: string; close: number; componentCount?: number | null; source?: string | null };
export type USIndustryEntry = {
  id: string;
  sector: string;
  industryGroup: string;
  industry: string;
  components: { symbol: string; name: string; marketCap?: string; exchange?: string }[];
  series: USIndustryPoint[];
};
export type USIndustriesHistory = {
  generatedAt?: string;
  source?: string;
  period?: string;
  industries: USIndustryEntry[];
};

export type USIndustryOverrides = {
  assets: AssetDef[];
  overrides: Record<string, { daily: Candle[]; weekly: Candle[] }>;
  metadata: {
    total: number;
    withHistory: number;
    longCount: number;
    start?: string | null;
    end?: string | null;
  };
};

const HISTORY_URL = '/api/us-industries/history';

let historyPromise: Promise<USIndustriesHistory> | null = null;

export async function fetchUSIndustriesHistory(): Promise<USIndustriesHistory> {
  if (!historyPromise) {
    historyPromise = fetch(HISTORY_URL, { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`failed to load ${HISTORY_URL}: ${res.status}`);
        return res.json();
      })
      .then((json) => normalizeHistory(json))
      .catch((err) => {
        historyPromise = null;
        throw err;
      });
  }
  return historyPromise;
}

function normalizeHistory(raw: any): USIndustriesHistory {
  const industries = Array.isArray(raw?.industries) ? raw.industries : [];
  const normalized: USIndustryEntry[] = industries.map((item: any) => ({
    id: String(item?.id || ''),
    sector: String(item?.sector || ''),
    industryGroup: String(item?.industryGroup || ''),
    industry: String(item?.industry || ''),
    components: Array.isArray(item?.components)
      ? item.components
          .map((comp: any) => ({
            symbol: String(comp?.symbol || ''),
            name: String(comp?.name || comp?.symbol || ''),
            marketCap: comp?.marketCap ? String(comp.marketCap) : undefined,
            exchange: comp?.exchange ? String(comp.exchange) : undefined,
          }))
          .filter((comp) => !!comp.symbol)
      : [],
    series: Array.isArray(item?.series)
      ? item.series
          .map((p: any) => ({
            date: String(p?.date || ''),
            close: typeof p?.close === 'number' ? p.close : Number(p?.close),
            componentCount: typeof p?.componentCount === 'number' ? p.componentCount : null,
            source: p?.source ? String(p.source) : null,
          }))
          .filter((p) => p.date && Number.isFinite(p.close))
      : [],
  }));
  return {
    generatedAt: typeof raw?.generatedAt === 'string' ? raw.generatedAt : undefined,
    source: typeof raw?.source === 'string' ? raw.source : undefined,
    period: typeof raw?.period === 'string' ? raw.period : undefined,
    industries: normalized,
  };
}

export function buildUSIndustryOverrides(history: USIndustriesHistory): USIndustryOverrides {
  const overrides: Record<string, { daily: Candle[]; weekly: Candle[] }> = {};
  const assets: AssetDef[] = [];
  let total = 0;
  let withHistory = 0;
  let longCount = 0;
  let start: string | null = null;
  let end: string | null = null;

  history.industries.forEach((entry) => {
    if (!entry.id) return;
    total += 1;
    const daily = seriesToDailyCandles(entry.series);
    if (daily.length === 0) return;
    withHistory += 1;
    if (daily.length >= 750) longCount += 1;
    const weekly = dailyToWeekly(daily);
    overrides[entry.id] = { daily, weekly };
    const first = entry.series[0];
    const last = entry.series[entry.series.length - 1];
    if (first?.date && (!start || first.date < start)) start = first.date;
    if (last?.date && (!end || last.date > end)) end = last.date;
    assets.push({
      id: entry.id,
      name: `US ${entry.industry}`,
      cls: 'INDEX',
      symbol: `USIND:${entry.id}`,
      currency: 'USD',
    });
  });

  return {
    assets,
    overrides,
    metadata: { total, withHistory, longCount, start, end },
  };
}

function seriesToDailyCandles(series: USIndustryPoint[]): Candle[] {
  const candles: Candle[] = [];
  series
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .forEach((point) => {
      const dt = parseUsDate(point.date);
      if (!dt) return;
      const time = Math.floor(dt.getTime() / 1000);
      const close = Number(point.close);
      if (!Number.isFinite(close)) return;
      candles.push({ time, open: close, high: close, low: close, close, value: 0 });
    });
  return candles;
}

function parseUsDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const iso = `${dateStr}T21:00:00Z`;
  const time = Date.parse(iso);
  return Number.isFinite(time) ? new Date(time) : null;
}

function dailyToWeekly(daily: Candle[]): Candle[] {
  if (!daily.length) return [];
  const groups = new Map<string, { open: number; high: number; low: number; close: number; time: number }>();
  daily.forEach((candle) => {
    const date = new Date(candle.time * 1000);
    const { year, week } = isoWeek(date);
    const key = `${year}-W${week.toString().padStart(2, '0')}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        time: candle.time,
      });
    } else {
      existing.high = Math.max(existing.high, candle.high);
      existing.low = Math.min(existing.low, candle.low);
      existing.close = candle.close;
      existing.time = candle.time;
    }
  });
  return Array.from(groups.values())
    .sort((a, b) => a.time - b.time)
    .map((item) => ({
      time: item.time,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
      value: 0,
    }));
}

function isoWeek(date: Date): { year: number; week: number } {
  const tmp = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: tmp.getUTCFullYear(), week };
}
