import type { AssetDef } from './analysis';
import type { Candle } from '../types';

type Topix33Point = { date: string; close: number; source?: string | null };
export type Topix33Sector = {
  id: string;
  nameJa: string;
  nameEn: string;
  qcode: string;
  jquantsCode?: string;
  series: Topix33Point[];
};
export type Topix33History = { sectors: Topix33Sector[] };

export type Topix33Overrides = {
  assets: AssetDef[];
  overrides: Record<string, { daily: Candle[]; weekly: Candle[] }>;
};

const HISTORY_URL = '/data/topix33-history.json';

let historyPromise: Promise<Topix33History> | null = null;

export async function fetchTopix33History(): Promise<Topix33History> {
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

function normalizeHistory(raw: any): Topix33History {
  if (!raw || typeof raw !== 'object') throw new Error('invalid topix33 history payload');
  const sectors = Array.isArray(raw.sectors) ? raw.sectors : [];
  const normalized: Topix33Sector[] = sectors.map((s: any) => ({
    id: String(s?.id || ''),
    nameJa: String(s?.nameJa || s?.name || s?.id || ''),
    nameEn: String(s?.nameEn || s?.name || s?.id || ''),
    qcode: String(s?.qcode || s?.jquantsCode || ''),
    jquantsCode: s?.jquantsCode ? String(s.jquantsCode) : undefined,
    series: Array.isArray(s?.series)
      ? s.series
          .map((p: any) => ({
            date: String(p?.date || ''),
            close: typeof p?.close === 'number' ? p.close : Number(p?.close),
            source: p?.source ?? null,
          }))
          .filter((p) => p.date && Number.isFinite(p.close))
      : [],
  }));
  return { sectors: normalized };
}

export function buildTopix33Overrides(history: Topix33History): Topix33Overrides {
  const overrides: Record<string, { daily: Candle[]; weekly: Candle[] }> = {};
  const assets: AssetDef[] = [];
  history.sectors.forEach((sector) => {
    if (!sector.id) return;
    const daily = seriesToDailyCandles(sector.series);
    if (!daily.length) return;
    const weekly = dailyToWeekly(daily);
    overrides[sector.id] = { daily, weekly };
    assets.push({
      id: sector.id,
      name: sector.nameJa || sector.nameEn || sector.id,
      cls: 'INDEX',
      symbol: `TOPIX33:${sector.id}`,
      currency: 'JPY',
      priceToUSD: 'JPY',
    });
  });
  return { assets, overrides };
}

function seriesToDailyCandles(series: Topix33Point[]): Candle[] {
  const candles: Candle[] = [];
  series
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .forEach((point) => {
      const date = parseJstDate(point.date);
      if (!date) return;
      const time = Math.floor(date.getTime() / 1000);
      const close = Number(point.close);
      if (!Number.isFinite(close)) return;
      candles.push({ time, open: close, high: close, low: close, close, value: 0 });
    });
  return candles;
}

function parseJstDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const normalized = dateStr.replace(/\./g, '-');
  const isoMatch = normalized.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
  if (!isoMatch) return null;
  try {
    return new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T15:00:00+09:00`);
  } catch {
    return null;
  }
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
