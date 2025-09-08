import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import type { AssetItem, Timeframe, WatchItem } from './types';

type State = {
  watchlist: WatchItem[];
  portfolio: AssetItem[];
  chartTimeframe: Timeframe;
};

type Actions = {
  addWatch: (symbol: string, name: string) => void;
  removeWatch: (id: string) => void;
  reorderWatch: (id: string, dir: 'up' | 'down') => void;

  addAsset: (asset: Omit<AssetItem, 'id' | 'order'>) => void;
  updateAsset: (id: string, updater: (a: AssetItem) => AssetItem) => void;
  removeAsset: (id: string) => void;
  reorderAsset: (id: string, dir: 'up' | 'down') => void;

  setTimeframe: (tf: Timeframe) => void;
};

export const useStore = create<State & Actions>()(
  persist(
    (set, get) => ({
      watchlist: [
        { id: uuidv4(), symbol: 'AAPL', name: 'Apple', order: 0 },
        { id: uuidv4(), symbol: 'MSFT', name: 'Microsoft', order: 1 },
        { id: uuidv4(), symbol: '7203.T', name: 'トヨタ自動車', order: 2 },
      ],
      portfolio: [
        { id: uuidv4(), type: 'CASH', label: 'みずほ銀行 普通', order: 0, details: { currency: 'JPY', amount: 500000 } },
        { id: uuidv4(), type: 'CASH', label: 'USD現金', order: 1, details: { currency: 'USD', amount: 3000, rateJPY: 160 } },
        { id: uuidv4(), type: 'STOCK', label: 'Apple', order: 2, details: { symbol: 'AAPL', avgPrice: 150, qty: 20 } },
        { id: uuidv4(), type: 'STOCK', label: 'トヨタ', order: 3, details: { symbol: '7203.T', avgPrice: 2000, qty: 50 } },
      ],
      chartTimeframe: 'D',

      addWatch: (symbol, name) => set((s) => {
        const order = s.watchlist.length;
        return { watchlist: [...s.watchlist, { id: uuidv4(), symbol, name, order }] };
      }),
      removeWatch: (id) => set((s) => ({ watchlist: s.watchlist.filter((w) => w.id !== id) })),
      reorderWatch: (id, dir) => set((s) => ({
        watchlist: reorderArray(s.watchlist, id, dir),
      })),

      addAsset: (asset) => set((s) => ({ portfolio: [...s.portfolio, { ...asset, id: uuidv4(), order: s.portfolio.length }] })),
      updateAsset: (id, updater) => set((s) => ({ portfolio: s.portfolio.map((a) => (a.id === id ? updater(a) : a)) })),
      removeAsset: (id) => set((s) => ({ portfolio: s.portfolio.filter((a) => a.id !== id) })),
      reorderAsset: (id, dir) => set((s) => ({ portfolio: reorderArray(s.portfolio, id, dir) })),

      setTimeframe: (tf) => set({ chartTimeframe: tf }),
    }),
    {
      name: 'myfinance-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ watchlist: s.watchlist, portfolio: s.portfolio, chartTimeframe: s.chartTimeframe }),
    }
  )
);

function reorderArray<T extends { id: string; order: number }>(arr: T[], id: string, dir: 'up' | 'down'): T[] {
  const list = [...arr].sort((a, b) => a.order - b.order);
  const idx = list.findIndex((x) => x.id === id);
  if (idx < 0) return list;
  const swapWith = dir === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= list.length) return list;
  const tmp = list[idx].order;
  list[idx].order = list[swapWith].order;
  list[swapWith].order = tmp;
  return list.sort((a, b) => a.order - b.order);
}

