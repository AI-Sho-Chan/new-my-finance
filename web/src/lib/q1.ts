import { normalizeQuadrantThresholds, type QuadrantThresholds } from './analysis';

export type Q1Metrics = {
  F: number | null;
  V: number | null;
  A: number | null;
  flowPercentile: number | null;
  valuePercentile: number | null;
  lastPrice?: number | null;
  rp?: number | null;
};

export type Q1StatusEntry = {
  symbol: string;
  name: string;
  market: string;
  detectedAt?: number | null;
  droppedAt?: number | null;
  tradeDate?: string | null;
  metrics?: Q1Metrics | null;
};

export type Q1Event = {
  type: 'ENTER' | 'DROP';
  ts: number;
  tradeDate: string | null;
  symbol: string;
  name: string;
  market: string;
  metrics: Q1Metrics | null;
};

export type Q1WatchlistEntry = {
  id: string;
  symbol: string;
  name: string;
  market: 'JP' | 'US';
  currency: string | null;
  cls?: string | null;
  firstEnterTradeDate: string | null;
  purchaseDate: string | null;
  purchasePrice: number | null;
  currentPrice: number | null;
  lastPrice?: number | null;
  gainPct: number | null;
  daysElapsed: number | null;
  lastEventType: string;
  lastEventAt: number | null;
  lastEventTradeDate: string | null;
  eventLabel: string;
  isBenchmark: boolean;
  purchasePriceSource?: string | null;
  lastKnownPriceAt?: number | null;
  metrics?: {
    F: number | null;
    V: number | null;
    A: number | null;
    flowPercentile: number | null;
    valuePercentile: number | null;
    lastPrice?: number | null;
    rp?: number | null;
  } | null;
  quadrant?: string | null;
  flowPercentile?: number | null;
  valuePercentile?: number | null;
  F?: number | null;
  V?: number | null;
  A?: number | null;
  rp?: number | null;
  lastMetricsAt?: number | null;
};

export type Q1ScanSummaryEntry = {
  reason: string;
  generatedAt: number | null;
  lastScanAt: number | null;
  tradeDate: string | null;
  total: number;
  q1Count: number;
};

function parseScanSummary(raw: unknown): Record<string, Q1ScanSummaryEntry> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const summary: Record<string, Q1ScanSummaryEntry> = {};
  Object.entries(raw as Record<string, any>).forEach(([key, value]) => {
    if (!value || typeof value !== 'object') return;
    const entry = value as Record<string, any>;
    summary[key] = {
      reason: typeof entry.reason === 'string' ? entry.reason : key,
      generatedAt: entry.generatedAt == null ? null : Number(entry.generatedAt) || null,
      lastScanAt: entry.lastScanAt == null ? null : Number(entry.lastScanAt) || null,
      tradeDate: entry.tradeDate == null ? null : String(entry.tradeDate),
      total: Number(entry.total ?? 0) || 0,
      q1Count: Number(entry.q1Count ?? 0) || 0,
    };
  });
  return Object.keys(summary).length ? summary : undefined;
}

export type Q1QuadrantThresholds = QuadrantThresholds;

function sanitizeThresholds(input: unknown): Q1QuadrantThresholds {
  if (input && typeof input === 'object') {
    return normalizeQuadrantThresholds(input as Partial<QuadrantThresholds>);
  }
  return normalizeQuadrantThresholds();
}

function parseWatchlist(raw: unknown): Q1WatchlistEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((value, index) => {
    const entry = (value || {}) as Record<string, any>;
    const symbol = typeof entry.symbol === 'string' && entry.symbol ? entry.symbol : `UNKNOWN_${index}`;
    const marketRaw = typeof entry.market === 'string' ? entry.market.toUpperCase() : '';
    const market: 'JP' | 'US' = marketRaw === 'US' ? 'US' : 'JP';
    const id = typeof entry.id === 'string' && entry.id
      ? entry.id
      : `${symbol}-${entry.firstEnterTradeDate ?? entry.purchaseDate ?? index}`;
    const num = (input: any) => {
      const n = Number(input);
      return Number.isFinite(n) ? n : null;
    };
    const str = (input: any) => {
      if (input == null) return null;
      const s = String(input);
      return s.length ? s : null;
    };
    const bool = (input: any) => Boolean(input);
    const metricsRaw = entry.metrics;
    const metrics = metricsRaw && typeof metricsRaw === 'object' ? {
      F: num(metricsRaw.F),
      V: num(metricsRaw.V),
      A: num(metricsRaw.A),
      flowPercentile: num(metricsRaw.flowPercentile),
      valuePercentile: num(metricsRaw.valuePercentile),
      lastPrice: num(metricsRaw.lastPrice),
      rp: num(metricsRaw.rp),
    } : null;
    const flowPct = metrics?.flowPercentile ?? num(entry.flowPercentile);
    const valuePct = metrics?.valuePercentile ?? num(entry.valuePercentile);
    return {
      id,
      symbol,
      name: typeof entry.name === 'string' && entry.name ? entry.name : symbol,
      market,
      currency: str(entry.currency),
      cls: str(entry.cls),
      firstEnterTradeDate: str(entry.firstEnterTradeDate),
      purchaseDate: str(entry.purchaseDate),
      purchasePrice: num(entry.purchasePrice),
      currentPrice: num(entry.currentPrice),
      lastPrice: num(entry.lastPrice) ?? metrics?.lastPrice ?? null,
      gainPct: num(entry.gainPct),
      daysElapsed: num(entry.daysElapsed),
      lastEventType: typeof entry.lastEventType === 'string' ? entry.lastEventType : (bool(entry.isBenchmark) ? 'BENCHMARK' : 'ENTER'),
      lastEventAt: num(entry.lastEventAt),
      lastEventTradeDate: str(entry.lastEventTradeDate),
      eventLabel: typeof entry.eventLabel === 'string' ? entry.eventLabel : (bool(entry.isBenchmark) ? 'Benchmark' : 'Entered Q1'),
      isBenchmark: bool(entry.isBenchmark),
      purchasePriceSource: str(entry.purchasePriceSource),
      lastKnownPriceAt: num(entry.lastKnownPriceAt),
      metrics,
      quadrant: typeof entry.quadrant === 'string' ? entry.quadrant : null,
      flowPercentile: flowPct,
      valuePercentile: valuePct,
      F: metrics?.F ?? num(entry.F),
      V: metrics?.V ?? num(entry.V),
      A: metrics?.A ?? num(entry.A),
      rp: metrics?.rp ?? num(entry.rp),
      lastMetricsAt: num(entry.lastMetricsAt),
    };
  });
}

export type Q1Status = {
  enabled: boolean;
  lastRun?: number;
  lastSuccessAt?: number | null;
  intervalMinutes?: number;
  marketStatus?: {
    us?: { isOpen: boolean; minutesToOpen: number | null; minutesToClose: number | null; isWeekend: boolean };
    jp?: { isOpen: boolean; minutesToOpen: number | null; minutesToClose: number | null; isWeekend: boolean };
  };
  currentQ1: Q1StatusEntry[];
  currentQ1Drop: Q1StatusEntry[];
  currentQ1JP?: Q1StatusEntry[];
  currentQ1US?: Q1StatusEntry[];
  currentQ1DropJP?: Q1StatusEntry[];
  currentQ1DropUS?: Q1StatusEntry[];
  recentEvents: Q1Event[];
  emailConfigured?: boolean;
  snapshotGeneratedAt?: number | null;
  universeSize?: number;
  lastFullScanAt?: number | null;
  lastPriorityRefreshAt?: number | null;
  lastJPScanAt?: number | null;
  lastUSScanAt?: number | null;
  lastGlobalScanAt?: number | null;
  lastUSSectorScanAt?: number | null;
  lastJPSectorScanAt?: number | null;
  lastAllScanAt?: number | null;
  scanSummary?: Record<string, Q1ScanSummaryEntry>;
  thresholds?: Q1QuadrantThresholds;
};

export type Q1Analysis = {
  enabled: boolean;
  generatedAt: number | null;
  currentQ1: Q1StatusEntry[];
  currentQ1Drop: Q1StatusEntry[];
  currentQ1JP?: Q1StatusEntry[];
  currentQ1US?: Q1StatusEntry[];
  currentQ1DropJP?: Q1StatusEntry[];
  currentQ1DropUS?: Q1StatusEntry[];
  history: Q1Event[];
  watchlist: Q1WatchlistEntry[];
  scanSummary?: Record<string, Q1ScanSummaryEntry>;
  thresholds?: Q1QuadrantThresholds;
};

async function fetchJson<T>(path: string): Promise<T> {
  const url = new URL(path, window.location.origin);
  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 120)}`);
  }
  return res.json();
}

export async function fetchQ1Status(): Promise<Q1Status> {
  const json = await fetchJson<Q1Status>('/api/q1/status');
  return {
    enabled: Boolean(json?.enabled),
    lastRun: json?.lastRun ?? undefined,
    lastSuccessAt: json?.lastSuccessAt ?? undefined,
    intervalMinutes: json?.intervalMinutes ?? undefined,
    marketStatus: json?.marketStatus ?? {},
    currentQ1: Array.isArray(json?.currentQ1) ? json.currentQ1 : [],
    currentQ1Drop: Array.isArray(json?.currentQ1Drop) ? json.currentQ1Drop : [],
    currentQ1JP: Array.isArray(json?.currentQ1JP) ? json.currentQ1JP : undefined,
    currentQ1US: Array.isArray(json?.currentQ1US) ? json.currentQ1US : undefined,
    currentQ1DropJP: Array.isArray(json?.currentQ1DropJP) ? json.currentQ1DropJP : undefined,
    currentQ1DropUS: Array.isArray(json?.currentQ1DropUS) ? json.currentQ1DropUS : undefined,
    recentEvents: Array.isArray(json?.recentEvents) ? json.recentEvents : [],
    emailConfigured: json?.emailConfigured ?? false,
    snapshotGeneratedAt: json?.snapshotGeneratedAt ?? undefined,
    universeSize: json?.universeSize ?? undefined,
    lastFullScanAt: json?.lastFullScanAt ?? undefined,
    lastPriorityRefreshAt: json?.lastPriorityRefreshAt ?? undefined,
    lastJPScanAt: json?.lastJPScanAt ?? undefined,
    lastUSScanAt: json?.lastUSScanAt ?? undefined,
    lastGlobalScanAt: json?.lastGlobalScanAt ?? undefined,
    lastUSSectorScanAt: json?.lastUSSectorScanAt ?? undefined,
    lastJPSectorScanAt: json?.lastJPSectorScanAt ?? undefined,
    lastAllScanAt: json?.lastAllScanAt ?? undefined,
    scanSummary: parseScanSummary(json?.scanSummary),
    thresholds: sanitizeThresholds(json?.thresholds),
  };
}

export async function fetchQ1Analysis(): Promise<Q1Analysis> {
  const json = await fetchJson<Q1Analysis>('/api/q1/analysis');
  return {
    enabled: Boolean(json?.enabled),
    generatedAt: json?.generatedAt ?? null,
    currentQ1: Array.isArray(json?.currentQ1) ? json.currentQ1 : [],
    currentQ1Drop: Array.isArray(json?.currentQ1Drop) ? json.currentQ1Drop : [],
    currentQ1JP: Array.isArray(json?.currentQ1JP) ? json.currentQ1JP : undefined,
    currentQ1US: Array.isArray(json?.currentQ1US) ? json.currentQ1US : undefined,
    currentQ1DropJP: Array.isArray(json?.currentQ1DropJP) ? json.currentQ1DropJP : undefined,
    currentQ1DropUS: Array.isArray(json?.currentQ1DropUS) ? json.currentQ1DropUS : undefined,
    history: Array.isArray(json?.history) ? json.history : [],
    watchlist: parseWatchlist((json as any)?.watchlist),
    scanSummary: parseScanSummary(json?.scanSummary),
    thresholds: sanitizeThresholds(json?.thresholds),
  };
}


export async function runQ1Scan(market: 'JP' | 'US' | 'ALL' = 'JP'): Promise<void> {
  const url = new URL('/api/q1/run-scan', window.location.origin);
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ market }),
    credentials: 'same-origin',
  });
  if (!res.ok && res.status !== 202) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 120)}`);
  }
}

export interface Q1TrackerEntry {
  symbol: string;
  name: string;
  market: 'JP' | 'US';
  detectedAt: number;
  tradeDate: string;
  benchmark: string;
  purchasePrice: number | null;
  benchmarkPrice: number | null;
  history: any[];
  metricsAtDetection?: Q1Metrics | null;
  latestBenchmarkPrice?: number | null;
  updatedAt?: number | null;
  returnPct?: number | null;
  benchmarkReturnPct?: number | null;
  alphaPct?: number | null;
  daysHeld?: number | null;
  latest?: {
    price: number | null;
    change: number | null;
    changePct: number | null;
    fPct: number | null;
    vPct: number | null;
    quadrant: string | null;
  } | null;
}

export interface Q1TrackersResponse {
  version: number;
  entries: Q1TrackerEntry[];
}

export async function fetchQ1Trackers(): Promise<Q1TrackersResponse> {
  const json = await fetchJson<Q1TrackersResponse>('/api/q1/trackers');
  return {
    version: typeof json?.version === 'number' ? json.version : Number(json?.version ?? 1) || 1,
    entries: Array.isArray(json?.entries) ? json.entries : [],
  };
}

