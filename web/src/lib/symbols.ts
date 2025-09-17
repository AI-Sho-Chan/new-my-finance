export type SymbolAssetType = 'stock' | 'etf' | 'reit' | 'fund' | 'index' | 'commodity' | 'crypto' | 'fx';
export type SymbolRegion = 'US' | 'JP' | 'GLOBAL';

export interface SymbolDatasetEntry {
  symbol: string;
  name: string;
  exchange: string | null;
  market: string | null;
  region: SymbolRegion;
  assetType: SymbolAssetType;
  code: string | null;
  keywords: string[];
}

export interface SymbolSearchResult extends SymbolDatasetEntry {
  score: number;
}

let datasetPromise: Promise<SymbolDatasetEntry[]> | null = null;

async function loadDataset(): Promise<SymbolDatasetEntry[]> {
  if (!datasetPromise) {
    datasetPromise = (async () => {
      const res = await fetch('/data/symbols.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(`symbols.json fetch failed: ${res.status}`);
      const json = await res.json();
      const entries: SymbolDatasetEntry[] = Array.isArray(json?.entries) ? json.entries : [];
      return entries.map((entry) => ({
        symbol: entry.symbol,
        name: entry.name,
        exchange: entry.exchange ?? null,
        market: entry.market ?? null,
        region: entry.region ?? 'US',
        assetType: entry.assetType ?? 'stock',
        code: entry.code ?? null,
        keywords: Array.isArray(entry.keywords) ? entry.keywords : [],
      }));
    })();
  }
  return datasetPromise;
}

function isAscii(input: string) {
  return /^[\u0000-\u007f]+$/.test(input);
}

function isDigits(input: string) {
  return /^[0-9]+$/.test(input);
}

function computeScore(entry: SymbolDatasetEntry, query: string, options: { ascii: boolean; digits: boolean }) {
  const upper = query.toUpperCase();
  const lower = query.toLowerCase();
  let best = Number.POSITIVE_INFINITY;

  if (entry.symbol === upper) best = Math.min(best, 0);
  if (entry.symbol.startsWith(upper)) best = Math.min(best, 1);

  if (options.digits && entry.code && entry.code.startsWith(query)) {
    best = Math.min(best, 1);
  }

  const keywordMatches = entry.keywords || [];
  if (keywordMatches.some((kw) => kw === lower)) best = Math.min(best, 0.5);
  if (keywordMatches.some((kw) => kw.startsWith(lower))) best = Math.min(best, 2);
  if (keywordMatches.some((kw) => kw.includes(lower))) best = Math.min(best, 3);

  if (!options.ascii) {
    const name = entry.name || '';
    if (name.startsWith(query)) best = Math.min(best, 1);
    else if (name.includes(query)) best = Math.min(best, 2);
  }

  return best;
}

export async function searchSymbols(query: string, limit = 15): Promise<SymbolSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const entries = await loadDataset();
  const ascii = isAscii(trimmed);
  const digits = isDigits(trimmed);
  const results: SymbolSearchResult[] = [];

  entries.forEach((entry) => {
    if (!ascii && entry.region !== 'JP') {
      // Japanese query should target domestic symbols or manual entries explicitly
      const includesJapaneseAlias = entry.keywords?.some((kw) => kw === trimmed);
      if (!includesJapaneseAlias && !entry.name.includes(trimmed)) {
        return;
      }
    }
    const score = computeScore(entry, trimmed, { ascii, digits });
    if (Number.isFinite(score)) {
      results.push({ ...entry, score });
    }
  });

  results.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    if (a.region !== b.region) {
      if (a.region === 'JP') return -1;
      if (b.region === 'JP') return 1;
    }
    return a.symbol.localeCompare(b.symbol);
  });

  return results.slice(0, limit);
}

export async function getSymbolByTicker(symbol: string): Promise<SymbolDatasetEntry | null> {
  const entries = await loadDataset();
  const normalized = symbol.trim().toUpperCase();
  return entries.find((entry) => entry.symbol === normalized) ?? null;
}
