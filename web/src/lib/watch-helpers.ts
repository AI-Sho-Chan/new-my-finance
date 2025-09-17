import type { MarketQuote, WatchGroup, WatchItem } from '../types';

type QuotesMap = Record<string, MarketQuote | undefined>;

export function collectGroupItemIds(group: WatchGroup, items: Record<string, WatchItem>): string[] {
  const known = group.itemIds.filter((id) => Boolean(items[id]));
  if (group.key === 'all') {
    const missing = Object.keys(items).filter((id) => !known.includes(id));
    return [...known, ...missing];
  }
  return known;
}

export function sortGroupItemIds(group: WatchGroup, items: Record<string, WatchItem>, quotes: QuotesMap): string[] {
  const ids = collectGroupItemIds(group, items);
  const direction = group.sort.direction === 'asc' ? 1 : -1;

  switch (group.sort.mode) {
    case 'symbol':
      return [...ids].sort((a, b) => compareText(items[a]?.symbol, items[b]?.symbol) * direction);
    case 'price':
      return [...ids].sort((a, b) => compareNumber(quotes[items[a]?.symbol]?.price, quotes[items[b]?.symbol]?.price) * direction);
    case 'custom':
      return ids;
    case 'addedAt':
    default:
      return [...ids].sort((a, b) => compareNumber(items[a]?.addedAt, items[b]?.addedAt) * direction);
  }
}

export function buildItemGroupMap(groups: WatchGroup[]): Record<string, WatchGroup[]> {
  const map: Record<string, WatchGroup[]> = {};
  groups.forEach((group) => {
    group.itemIds.forEach((id) => {
      if (!map[id]) map[id] = [];
      map[id].push(group);
    });
  });
  return map;
}

function compareText(a?: string, b?: string): number {
  const aa = (a || '').toUpperCase();
  const bb = (b || '').toUpperCase();
  if (aa === bb) return 0;
  return aa > bb ? 1 : -1;
}

function compareNumber(a?: number, b?: number): number {
  const aa = typeof a === 'number' && Number.isFinite(a) ? a : -Infinity;
  const bb = typeof b === 'number' && Number.isFinite(b) ? b : -Infinity;
  if (aa === bb) return 0;
  return aa > bb ? 1 : -1;
}

export function metricsLinkFor(symbol: string): string {
  if (/\.T$/i.test(symbol)) {
    return `https://kabutan.jp/stock/?code=${symbol.replace(/\.T$/i, )}`;
  }
  return 'https://finance.yahoo.com/quote/' + encodeURIComponent(symbol);
}

