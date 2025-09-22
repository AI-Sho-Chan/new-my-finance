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
  recentEvents: Q1Event[];
  emailConfigured?: boolean;
  snapshotGeneratedAt?: number | null;
  universeSize?: number;
  lastFullScanAt?: number | null;
  lastPriorityRefreshAt?: number | null;
};

export type Q1Analysis = {
  enabled: boolean;
  generatedAt: number | null;
  currentQ1: Q1StatusEntry[];
  currentQ1Drop: Q1StatusEntry[];
  history: Q1Event[];
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
    recentEvents: Array.isArray(json?.recentEvents) ? json.recentEvents : [],
    emailConfigured: json?.emailConfigured ?? false,
    snapshotGeneratedAt: json?.snapshotGeneratedAt ?? undefined,
    universeSize: json?.universeSize ?? undefined,
    lastFullScanAt: json?.lastFullScanAt ?? undefined,
    lastPriorityRefreshAt: json?.lastPriorityRefreshAt ?? undefined,
  };
}

export async function fetchQ1Analysis(): Promise<Q1Analysis> {
  const json = await fetchJson<Q1Analysis>('/api/q1/analysis');
  return {
    enabled: Boolean(json?.enabled),
    generatedAt: json?.generatedAt ?? null,
    currentQ1: Array.isArray(json?.currentQ1) ? json.currentQ1 : [],
    currentQ1Drop: Array.isArray(json?.currentQ1Drop) ? json.currentQ1Drop : [],
    history: Array.isArray(json?.history) ? json.history : [],
  };
}

