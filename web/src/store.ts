import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import type {
  AssetItem,
  Timeframe,
  WatchGroup,
  WatchGroupSortDirection,
  WatchGroupSortMode,
  WatchItem,
  WatchItemType,
  WatchSnapshot,
  WatchUIState,
  WatchSortMode,
} from './types';

type PortfolioTotals = { total: number; cash: number; invest: number };

type PortfolioHistoryItem = { key: string; ts: number; note?: string; portfolio: AssetItem[]; hash: string; totals?: PortfolioTotals };

type PortfolioMetricsEntry = { valueJPY: number; changeJPY: number; gainLossPercent?: number };

type WatchItemInput = {
  symbol: string;
  name: string;
  type?: WatchItemType;
  note?: string;
};

type WatchState = {
  watchItems: Record<string, WatchItem>;
  watchGroups: Record<string, WatchGroup>;
  watchUI: WatchUIState;
};

type State = WatchState & {
  portfolio: AssetItem[];
  portfolioHistory: PortfolioHistoryItem[];
  chartTimeframe: Timeframe;
  portfolioMetrics: Record<string, PortfolioMetricsEntry>;
  portfolioTotals: PortfolioTotals;
};

type WatchActions = {
  addItems: (entries: WatchItemInput[], groupIds?: string[]) => string[];
  assignItemsToGroups: (itemIds: string[], groupIds: string[]) => void;
  removeItemsFromGroup: (itemIds: string[], groupId: string) => void;
  deleteItems: (itemIds: string[]) => void;
  updateItemNote: (itemId: string, note: string) => void;
  createGroup: (input: { name: string; color?: string; description?: string }) => WatchGroup;
  updateGroup: (groupId: string, patch: Partial<Pick<WatchGroup, 'name' | 'color' | 'description'>>) => void;
  deleteGroup: (groupId: string) => void;
  reorderGroup: (groupId: string, targetIndex: number) => void;
  reorderGroupItems: (groupId: string, orderedIds: string[]) => void;
  updateGroupSort: (groupId: string, sort: { mode: WatchGroupSortMode; direction: WatchGroupSortDirection }) => void;
  setActiveGroup: (groupId: string) => void;
  setSelectionMode: (on: boolean) => void;
  setSelectedIds: (ids: string[]) => void;
  setPendingAssignGroupIds: (groupIds: string[]) => void;
  setSortMode: (mode: WatchSortMode) => void;
  clearSelection: () => void;
};

type PortfolioActions = {
  addAsset: (asset: Omit<AssetItem, 'id' | 'order'>) => void;
  updateAsset: (id: string, updater: (a: AssetItem) => AssetItem) => void;
  removeAsset: (id: string) => void;
  reorderAsset: (id: string, dir: 'up' | 'down') => void;
  savePortfolioSnapshot: (note?: string) => void;
  restorePortfolioSnapshot: (key: string) => void;
  loadPortfolioBackup: (payload: { portfolio: AssetItem[]; portfolioHistory?: PortfolioHistoryItem[] }) => void;
  setTimeframe: (tf: Timeframe) => void;
  setPortfolioComputed: (metrics: Record<string, PortfolioMetricsEntry>, totals: PortfolioTotals) => void;
};

type Actions = WatchActions & PortfolioActions;

const STORE_VERSION = 2;

const SYSTEM_GROUP_DEFS: Array<{ key: Required<WatchGroup['key']>; name: string; color: string }> = [
  { key: 'all', name: 'ALL', color: '#2563eb' },
  { key: 'holding', name: '保有', color: '#f59e0b' },
  { key: 'candidate', name: '候補', color: '#16a34a' },
  { key: 'index', name: '指数', color: '#9333ea' },
];

const WATCH_SEED: Array<{ symbol: string; name: string; type?: WatchItemType }> = [
  { symbol: 'AAPL', name: 'Apple', type: 'stock' },
  { symbol: 'MSFT', name: 'Microsoft', type: 'stock' },
  { symbol: '7203.T', name: 'トヨタ自動車', type: 'stock' },
];

const DEFAULT_SORT: { mode: WatchGroupSortMode; direction: WatchGroupSortDirection } = { mode: 'addedAt', direction: 'desc' };

const DEFAULT_COLORS = ['#2563eb', '#16a34a', '#9333ea', '#f97316', '#8b5cf6', '#facc15', '#0ea5e9', '#f43f5e'];

export const useStore = create<State & Actions>()(
  persist(
    (set, get) => ({
      ...createInitialState(),

      addItems: (entries, groupIds) => {
        if (!entries.length) return [];
        const addedIds: string[] = [];
        const targetGroupIds = new Set(groupIds?.length ? groupIds : []);
        set((state) => {
          const now = Date.now();
          const items = { ...state.watchItems };
          const groups = cloneGroups(state.watchGroups);
          const allGroup = ensureSystemGroup(groups, 'all');
          allGroup.updatedAt = now;
          const activeGroupId = state.watchUI.activeGroupId;
          if (!targetGroupIds.size && activeGroupId && groups[activeGroupId] && groups[activeGroupId].key !== 'all') {
            targetGroupIds.add(activeGroupId);
          }
          targetGroupIds.add(allGroup.id);

          entries.forEach((entry) => {
            const id = ensureItemForSymbol(items, entry, now);
            addedIds.push(id);
            addItemToGroup(allGroup, id, { atStart: true });
            targetGroupIds.forEach((gid) => {
              const group = groups[gid];
              if (!group || group.key === 'all') return;
              addItemToGroup(group, id, { atStart: true });
              group.updatedAt = now;
            });
          });

          return { watchItems: items, watchGroups: groups };
        });
        return addedIds;
      },

      assignItemsToGroups: (itemIds, groupIds) => {
        if (!itemIds.length || !groupIds.length) return;
        set((state) => {
          const items = { ...state.watchItems };
          const groups = cloneGroups(state.watchGroups);
          const allGroup = ensureSystemGroup(groups, 'all');
          const now = Date.now();

          itemIds.forEach((id) => {
            if (!items[id]) return;
            addItemToGroup(allGroup, id, { atStart: false });
          });
          allGroup.updatedAt = now;

          groupIds.forEach((gid) => {
            const group = groups[gid];
            if (!group || group.key === 'all') return;
            itemIds.forEach((id) => {
              if (!items[id]) return;
              addItemToGroup(group, id, { atStart: false });
            });
            group.updatedAt = now;
          });

          return { watchItems: items, watchGroups: groups };
        });
      },

      removeItemsFromGroup: (itemIds, groupId) => {
        if (!itemIds.length) return;
        set((state) => {
          const groups = cloneGroups(state.watchGroups);
          const group = groups[groupId];
          if (!group || group.key === 'all') return {};
          const setIds = new Set(itemIds);
          group.itemIds = group.itemIds.filter((id) => !setIds.has(id));
          group.updatedAt = Date.now();
          return { watchGroups: groups };
        });
      },

      deleteItems: (itemIds) => {
        if (!itemIds.length) return;
        set((state) => {
          const ids = itemIds.filter((id, index, arr) => arr.indexOf(id) === index);
          if (!ids.length) return {};
          const removeSet = new Set(ids);
          const items = { ...state.watchItems };
          ids.forEach((id) => { delete items[id]; });
          const groups = cloneGroups(state.watchGroups);
          Object.values(groups).forEach((group) => {
            const before = group.itemIds.length;
            group.itemIds = group.itemIds.filter((id) => !removeSet.has(id));
            if (group.itemIds.length !== before) {
              group.updatedAt = Date.now();
            }
          });
          const ui: WatchUIState = {
            ...state.watchUI,
            selectedIds: state.watchUI.selectedIds.filter((id) => !removeSet.has(id)),
          };
          if (ui.activeGroupId && !groups[ui.activeGroupId]) {
            const fallback = Object.values(groups).sort((a, b) => a.order - b.order)[0];
            ui.activeGroupId = fallback ? fallback.id : '';
          }
          return { watchItems: items, watchGroups: groups, watchUI: ui };
        });
      },

      updateItemNote: (itemId, note) => {
        set((state) => {
          const item = state.watchItems[itemId];
          if (!item) return {};
          return {
            watchItems: {
              ...state.watchItems,
              [itemId]: { ...item, note: note?.trim() ? note.trim() : undefined, updatedAt: Date.now() },
            },
          };
        });
      },

      createGroup: (input) => {
        const created: { group: WatchGroup; ui: WatchUIState } = { group: undefined as any, ui: get().watchUI };
        set((state) => {
          const groups = cloneGroups(state.watchGroups);
          const order = Object.values(groups).length;
          const group: WatchGroup = {
            id: `group-${uuidv4()}`,
            name: input.name.trim() || 'Untitled',
            color: input.color?.trim() || pickColor(order),
            order,
            type: 'user',
            itemIds: [],
            sort: DEFAULT_SORT,
            updatedAt: Date.now(),
            description: input.description?.trim() || undefined,
          };
          groups[group.id] = group;
          created.group = group;
          created.ui = { ...state.watchUI, activeGroupId: group.id };
          return { watchGroups: groups, watchUI: created.ui };
        });
        return created.group;
      },

      updateGroup: (groupId, patch) => {
        set((state) => {
          const group = state.watchGroups[groupId];
          if (!group) return {};
          const updates: Partial<WatchGroup> = {};
          if (patch.name != null) updates.name = patch.name.trim() || group.name;
          if (patch.color != null) updates.color = patch.color.trim() || group.color;
          if (patch.description !== undefined) updates.description = patch.description?.trim() || undefined;
          if (!Object.keys(updates).length) return {};
          return {
            watchGroups: {
              ...state.watchGroups,
              [groupId]: { ...group, ...updates, updatedAt: Date.now() },
            },
          };
        });
      },

      deleteGroup: (groupId) => {
        set((state) => {
          const group = state.watchGroups[groupId];
          if (!group || group.type === 'system') return {};
          const groups = { ...state.watchGroups };
          delete groups[groupId];
          const normalized = reindexGroupOrders(groups);
          const allId = getGroupId('all');
          const nextActive = state.watchUI.activeGroupId === groupId ? (normalized[state.watchUI.activeGroupId] ? state.watchUI.activeGroupId : (normalized[allId] ? allId : Object.keys(normalized)[0])) : state.watchUI.activeGroupId;
          return {
            watchGroups: normalized,
            watchUI: { ...state.watchUI, activeGroupId: nextActive },
          };
        });
      },

      reorderGroup: (groupId, targetIndex) => {
        set((state) => {
          const groups = cloneGroups(state.watchGroups);
          const ordered = Object.values(groups).sort((a, b) => a.order - b.order);
          const idx = ordered.findIndex((g) => g.id === groupId);
          if (idx === -1 || targetIndex < 0 || targetIndex >= ordered.length) return {};
          const [moved] = ordered.splice(idx, 1);
          ordered.splice(targetIndex, 0, moved);
          ordered.forEach((g, i) => {
            const ref = groups[g.id];
            if (ref) ref.order = i;
          });
          return { watchGroups: groups };
        });
      },

      reorderGroupItems: (groupId, orderedIds) => {
        set((state) => {
          const group = state.watchGroups[groupId];
          if (!group) return {};
          const valid = orderedIds.filter((id, index, arr) => arr.indexOf(id) === index && group.itemIds.includes(id));
          return {
            watchGroups: {
              ...state.watchGroups,
              [groupId]: { ...group, itemIds: valid, sort: { mode: 'custom', direction: group.sort.direction }, updatedAt: Date.now() },
            },
          };
        });
      },

      updateGroupSort: (groupId, sort) => {
        set((state) => {
          const group = state.watchGroups[groupId];
          if (!group) return {};
          return {
            watchGroups: {
              ...state.watchGroups,
              [groupId]: { ...group, sort, updatedAt: Date.now() },
            },
          };
        });
      },

      setActiveGroup: (groupId) => {
        set((state) => {
          if (!state.watchGroups[groupId]) return {};
          return { watchUI: { ...state.watchUI, activeGroupId: groupId } };
        });
      },

      setSelectionMode: (on) => {
        set((state) => ({
          watchUI: {
            ...state.watchUI,
            selectionMode: on,
            selectedIds: on ? state.watchUI.selectedIds : [],
          },
        }));
      },

      setSelectedIds: (ids) => {
        set((state) => ({ watchUI: { ...state.watchUI, selectedIds: [...new Set(ids)] } }));
      },

      setPendingAssignGroupIds: (groupIds) => {
        set((state) => ({ watchUI: { ...state.watchUI, pendingAssignGroupIds: [...new Set(groupIds)] } }));
      },

      setSortMode: (mode) => {
        set((state) => ({ watchUI: { ...state.watchUI, sortMode: mode } }));
      },

      clearSelection: () => {
        set((state) => ({ watchUI: { ...state.watchUI, selectedIds: [], selectionMode: false } }));
      },

      addAsset: (asset) => set((state) => {
        const next = [...state.portfolio, { ...asset, id: uuidv4(), order: state.portfolio.length } as AssetItem];
        const synced = syncHoldingsWithPortfolio({ watchItems: state.watchItems, watchGroups: state.watchGroups }, next);
        return {
          portfolio: next,
          portfolioHistory: pushSnapshot(state.portfolioHistory, next, 'add'),
          watchItems: synced.watchItems,
          watchGroups: synced.watchGroups,
        };
      }),

      updateAsset: (id, updater) => set((state) => {
        const next = state.portfolio.map((a) => (a.id === id ? updater(a) : a));
        const synced = syncHoldingsWithPortfolio({ watchItems: state.watchItems, watchGroups: state.watchGroups }, next);
        return {
          portfolio: next,
          portfolioHistory: pushSnapshot(state.portfolioHistory, next, 'update'),
          watchItems: synced.watchItems,
          watchGroups: synced.watchGroups,
        };
      }),

      removeAsset: (id) => set((state) => {
        const next = state.portfolio.filter((a) => a.id !== id);
        const synced = syncHoldingsWithPortfolio({ watchItems: state.watchItems, watchGroups: state.watchGroups }, next);
        return {
          portfolio: next,
          portfolioHistory: pushSnapshot(state.portfolioHistory, next, 'remove'),
          watchItems: synced.watchItems,
          watchGroups: synced.watchGroups,
        };
      }),

      reorderAsset: (id, dir) => set((state) => {
        const next = reorderArray(state.portfolio, id, dir);
        const synced = syncHoldingsWithPortfolio({ watchItems: state.watchItems, watchGroups: state.watchGroups }, next);
        return {
          portfolio: next,
          portfolioHistory: pushSnapshot(state.portfolioHistory, next, 'reorder'),
          watchItems: synced.watchItems,
          watchGroups: synced.watchGroups,
        };
      }),

      savePortfolioSnapshot: (note) => set((state) => ({
        portfolioHistory: pushSnapshot(state.portfolioHistory, state.portfolio, note || 'manual'),
      })),

      restorePortfolioSnapshot: (key) => set((state) => {
        const snap = state.portfolioHistory.find((h) => h.key === key);
        if (!snap) return {} as any;
        const cloned = snap.portfolio.map((a, idx) => ({ ...a, id: uuidv4(), order: idx }));
        const synced = syncHoldingsWithPortfolio({ watchItems: state.watchItems, watchGroups: state.watchGroups }, cloned);
        return {
          portfolio: cloned,
          portfolioHistory: pushSnapshot(state.portfolioHistory, cloned, 'restore'),
          watchItems: synced.watchItems,
          watchGroups: synced.watchGroups,
        };
      }),

      loadPortfolioBackup: (payload) => set((state) => {
        const imported = Array.isArray(payload.portfolio) ? payload.portfolio : [];
        const cloned = imported
          .map((a, idx) => ({ ...a, id: uuidv4(), order: typeof a.order === 'number' ? a.order : idx }))
          .sort((a, b) => a.order - b.order)
          .map((a, idx) => ({ ...a, order: idx }));
        const synced = syncHoldingsWithPortfolio({ watchItems: state.watchItems, watchGroups: state.watchGroups }, cloned);
        let history = state.portfolioHistory;
        if (Array.isArray(payload.portfolioHistory)) {
          history = payload.portfolioHistory.map((snap) => {
            const portfolio = Array.isArray(snap.portfolio)
              ? snap.portfolio.map((asset, idx) => ({ ...asset, id: uuidv4(), order: idx }))
              : [];
            const hash = typeof snap.hash === 'string' ? snap.hash : JSON.stringify(portfolio);
            const totals = sanitizeTotals((snap as any)?.totals);
            return {
              ...snap,
              key: snap.key || uuidv4(),
              ts: typeof snap.ts === 'number' ? snap.ts : Date.now(),
              portfolio,
              hash,
              totals: totals ?? undefined,
            };
          });
        } else {
          history = pushSnapshot(state.portfolioHistory, cloned, 'import');
        }
        return {
          portfolio: cloned,
          portfolioHistory: history,
          watchItems: synced.watchItems,
          watchGroups: synced.watchGroups,
        };
      }),

      setTimeframe: (tf) => set({ chartTimeframe: tf }),

      setPortfolioComputed: (metrics, totals) => set((state) => {
        const sameTotals = totalsEqual(state.portfolioTotals, totals);
        const sameMetrics = metricsEqual(state.portfolioMetrics, metrics);
        const history = syncSnapshotTotals(state.portfolioHistory, totals);
        const nextState: Partial<State> = {};
        if (!sameMetrics) nextState.portfolioMetrics = metrics;
        if (!sameTotals) nextState.portfolioTotals = totals;
        if (history !== state.portfolioHistory) nextState.portfolioHistory = history;
        return Object.keys(nextState).length ? nextState : {};
      }),
    }),
    {
      name: 'myfinance-store',
      storage: createJSONStorage(() => localStorage),
      version: STORE_VERSION,
      partialize: (state) => ({
        watchItems: state.watchItems,
        watchGroups: state.watchGroups,
        watchUI: state.watchUI,
        portfolio: state.portfolio,
        portfolioHistory: state.portfolioHistory,
        portfolioMetrics: state.portfolioMetrics,
        portfolioTotals: state.portfolioTotals,
        chartTimeframe: state.chartTimeframe,
      }),
      migrate: (persisted, version) => migrateState(persisted as any, version),
    }
  )
);

function createInitialState(): State {
  const watch = seedWatchState();
  return {
    watchItems: watch.items,
    watchGroups: watch.groups,
    watchUI: watch.ui,
    portfolio: [
      { id: uuidv4(), type: 'CASH', label: 'みずほ銀行 普通', order: 0, details: { currency: 'JPY', amount: 500000 } },
      { id: uuidv4(), type: 'CASH', label: 'USD現金', order: 1, details: { currency: 'USD', amount: 3000, rateJPY: 160 } },
      { id: uuidv4(), type: 'STOCK', label: 'Apple', order: 2, details: { symbol: 'AAPL', avgPrice: 150, qty: 20 } },
      { id: uuidv4(), type: 'STOCK', label: 'トヨタ', order: 3, details: { symbol: '7203.T', avgPrice: 2000, qty: 50 } },
    ],
    portfolioHistory: [],
    chartTimeframe: 'D',
    portfolioMetrics: {},
    portfolioTotals: { total: 0, cash: 0, invest: 0 },
  };
}

function seedWatchState(): WatchSnapshot {
  const now = Date.now();
  const groups = createSystemGroups(now);
  const allGroup = ensureSystemGroup(groups, 'all');
  const items: Record<string, WatchItem> = {};
  WATCH_SEED.forEach((seed, idx) => {
    const created = createWatchItem(seed.symbol, seed.name, seed.type || 'stock', now - idx * 1000);
    items[created.id] = created;
    addItemToGroup(allGroup, created.id, { atStart: false });
  });
  groups[allGroup.id] = allGroup;
  return {
    items,
    groups,
    ui: {
      activeGroupId: allGroup.id,
      selectionMode: false,
      selectedIds: [],
      pendingAssignGroupIds: [],
      sortMode: 'none',
    },
  };
}

function migrateState(state: any, version: number): State {
  const base = createInitialState();
  if (!state) return base;
  const next: any = {
    ...base,
    ...state,
  };

  if (!state?.portfolioMetrics) next.portfolioMetrics = base.portfolioMetrics;
  if (!state?.portfolioTotals) next.portfolioTotals = base.portfolioTotals;

  if (!state.watchItems || !state.watchGroups) {
    const legacyList: any[] = Array.isArray(state.watchlist) ? state.watchlist : [];
    const migrated = migrateLegacyWatchlist(legacyList);
    next.watchItems = migrated.items;
    next.watchGroups = migrated.groups;
    next.watchUI = migrated.ui;
  } else {
    next.watchItems = normalizeItems(state.watchItems);
    next.watchGroups = normalizeGroups(state.watchGroups);
    next.watchUI = normalizeUI(state.watchUI, next.watchGroups);
  }

  ensureSystemGroupsPresence(next.watchGroups);
  next.watchGroups = reindexGroupOrders(next.watchGroups);
  next.watchUI = normalizeUI(next.watchUI, next.watchGroups);

  delete next.watchlist;

  const synced = syncHoldingsWithPortfolio({ watchItems: next.watchItems, watchGroups: next.watchGroups }, next.portfolio);
  next.watchItems = synced.watchItems;
  next.watchGroups = synced.watchGroups;

  return next;
}

function migrateLegacyWatchlist(list: any[]): WatchSnapshot {
  const now = Date.now();
  const groups = createSystemGroups(now);
  const allGroup = ensureSystemGroup(groups, 'all');
  const items: Record<string, WatchItem> = {};
  list.forEach((entry, idx) => {
    const symbol = normalizeSymbol(entry?.symbol || '');
    if (!symbol) return;
    const name = String(entry?.name || symbol);
    const item = createWatchItem(symbol, name, 'stock', now - idx * 1000);
    items[item.id] = item;
    addItemToGroup(allGroup, item.id, { atStart: false });
  });
  groups[allGroup.id] = allGroup;
  return {
    items,
    groups,
    ui: {
      activeGroupId: allGroup.id,
      selectionMode: false,
      selectedIds: [],
      pendingAssignGroupIds: [],
      sortMode: 'none',
    },
  };
}

function createSystemGroups(ts: number): Record<string, WatchGroup> {
  const groups: Record<string, WatchGroup> = {};
  SYSTEM_GROUP_DEFS.forEach((def, idx) => {
    groups[getGroupId(def.key)] = {
      id: getGroupId(def.key),
      key: def.key,
      name: def.name,
      color: def.color,
      order: idx,
      type: 'system',
      itemIds: [],
      sort: DEFAULT_SORT,
      updatedAt: ts,
    };
  });
  return groups;
}

function ensureSystemGroupsPresence(groups: Record<string, WatchGroup>) {
  const ts = Date.now();
  SYSTEM_GROUP_DEFS.forEach((def) => {
    const id = getGroupId(def.key);
    const existing = groups[id];
    if (!existing) {
      groups[id] = {
        id,
        key: def.key,
        name: def.name,
        color: def.color,
        order: Object.values(groups).length,
        type: 'system',
        itemIds: [],
        sort: DEFAULT_SORT,
        updatedAt: ts,
      };
    } else {
      groups[id] = {
        ...existing,
        id,
        key: def.key,
        name: existing.name || def.name,
        color: existing.color || def.color,
        type: 'system',
        sort: existing.sort || DEFAULT_SORT,
      };
    }
  });
}

function ensureSystemGroup(groups: Record<string, WatchGroup>, key: Required<WatchGroup['key']>): WatchGroup {
  const id = getGroupId(key);
  const existing = groups[id];
  if (existing) return existing;
  const group: WatchGroup = {
    id,
    key,
    name: SYSTEM_GROUP_DEFS.find((g) => g.key === key)?.name || key.toUpperCase(),
    color: SYSTEM_GROUP_DEFS.find((g) => g.key === key)?.color || pickColor(Object.keys(groups).length),
    order: Object.values(groups).length,
    type: 'system',
    itemIds: [],
    sort: DEFAULT_SORT,
    updatedAt: Date.now(),
  };
  groups[id] = group;
  return group;
}

function cloneGroups(groups: Record<string, WatchGroup>): Record<string, WatchGroup> {
  const out: Record<string, WatchGroup> = {};
  Object.entries(groups).forEach(([id, g]) => {
    out[id] = { ...g, itemIds: [...g.itemIds] };
  });
  return out;
}

function addItemToGroup(group: WatchGroup, itemId: string, opts: { atStart?: boolean } = {}) {
  const existingIndex = group.itemIds.indexOf(itemId);
  if (existingIndex >= 0) group.itemIds.splice(existingIndex, 1);
  if (opts.atStart) group.itemIds.unshift(itemId);
  else group.itemIds.push(itemId);
}

function ensureItemForSymbol(items: Record<string, WatchItem>, entry: WatchItemInput, ts: number): string {
  const symbol = normalizeSymbol(entry.symbol);
  if (!symbol) throw new Error('symbol is required');
  const existingId = Object.keys(items).find((id) => items[id].symbol === symbol);
  if (existingId) {
    const existing = items[existingId];
    items[existingId] = {
      ...existing,
      name: entry.name?.trim() || existing.name,
      note: entry.note?.trim() || existing.note,
      updatedAt: ts,
    };
    return existingId;
  }
  const item = createWatchItem(symbol, entry.name?.trim() || symbol, entry.type || inferItemType(symbol), ts, entry.note);
  items[item.id] = item;
  return item.id;
}

function createWatchItem(symbol: string, name: string, type: WatchItemType, ts: number, note?: string): WatchItem {
  return {
    id: `item-${uuidv4()}`,
    symbol,
    name,
    type,
    addedAt: ts,
    updatedAt: ts,
    note: note?.trim() || undefined,
  };
}

function inferItemType(symbol: string): WatchItemType {
  return symbol.endsWith('.T') ? 'stock' : 'stock';
}

function normalizeItems(items: any): Record<string, WatchItem> {
  const out: Record<string, WatchItem> = {};
  Object.entries(items || {}).forEach(([id, raw]) => {
    const symbol = normalizeSymbol((raw as any)?.symbol || '');
    if (!symbol) return;
    const ts = typeof (raw as any)?.addedAt === 'number' ? (raw as any).addedAt : Date.now();
    out[id] = {
      id,
      symbol,
      name: String((raw as any)?.name || symbol),
      type: ((raw as any)?.type === 'index' ? 'index' : 'stock') as WatchItemType,
      addedAt: ts,
      updatedAt: typeof (raw as any)?.updatedAt === 'number' ? (raw as any).updatedAt : ts,
      note: typeof (raw as any)?.note === 'string' ? ((raw as any).note || undefined) : undefined,
    };
  });
  return out;
}

function normalizeGroups(groups: any): Record<string, WatchGroup> {
  const out: Record<string, WatchGroup> = {};
  Object.entries(groups || {}).forEach(([id, raw]) => {
    const key = (raw as any)?.key;
    const sort = (raw as any)?.sort || {};
    out[id] = {
      id,
      key: key === 'all' || key === 'holding' || key === 'candidate' || key === 'index' ? key : undefined,
      name: String((raw as any)?.name || 'Unnamed'),
      color: String((raw as any)?.color || pickColor(Object.keys(out).length)),
      order: typeof (raw as any)?.order === 'number' ? (raw as any).order : Object.keys(out).length,
      type: (raw as any)?.type === 'user' ? 'user' : 'system',
      itemIds: Array.isArray((raw as any)?.itemIds) ? Array.from(new Set((raw as any).itemIds.map(String))) : [],
      sort: {
        mode: sort.mode === 'symbol' || sort.mode === 'price' || sort.mode === 'custom' ? sort.mode : 'addedAt',
        direction: sort.direction === 'asc' ? 'asc' : 'desc',
      },
      updatedAt: typeof (raw as any)?.updatedAt === 'number' ? (raw as any).updatedAt : Date.now(),
      description: typeof (raw as any)?.description === 'string' ? ((raw as any).description || undefined) : undefined,
    };
  });
  return out;
}

function normalizeUI(ui: any, groups: Record<string, WatchGroup>): WatchUIState {
  const allId = getGroupId('all');
  const active = ui?.activeGroupId && groups[ui.activeGroupId] ? ui.activeGroupId : (groups[allId] ? allId : Object.keys(groups)[0]);
  const sort = ui?.sortMode;
  const sortMode: WatchSortMode = sort === 'changeAsc' || sort === 'changeDesc' || sort === 'trendUpFirst' || sort === 'trendDownFirst' ? sort : 'none';
  return {
    activeGroupId: active,
    selectionMode: Boolean(ui?.selectionMode),
    selectedIds: Array.isArray(ui?.selectedIds) ? Array.from(new Set(ui.selectedIds.map(String))) : [],
    pendingAssignGroupIds: Array.isArray(ui?.pendingAssignGroupIds) ? Array.from(new Set(ui.pendingAssignGroupIds.map(String))) : [],
    sortMode,
  };
}

function getGroupId(key: Required<WatchGroup['key']>): string {
  return `group-${key}`;
}

function pickColor(idx: number): string {
  return DEFAULT_COLORS[idx % DEFAULT_COLORS.length];
}

function normalizeSymbol(symbol: string): string {
  return String(symbol || '').trim().toUpperCase();
}

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

function reindexGroupOrders(groups: Record<string, WatchGroup>): Record<string, WatchGroup> {
  const ordered = Object.values(groups).sort((a, b) => a.order - b.order);
  const result: Record<string, WatchGroup> = {};
  ordered.forEach((g, idx) => {
    result[g.id] = { ...g, order: idx };
  });
  return result;
}

function pushSnapshot(
  history: PortfolioHistoryItem[],
  portfolio: AssetItem[],
  meta?: string | { note?: string; totals?: PortfolioTotals }
): PortfolioHistoryItem[] {
  try {
    const MAX = 365;
    const ser = JSON.stringify(portfolio);
    const last = history[history.length - 1];
    const note = typeof meta === 'string' ? meta : meta?.note;
    const totals = typeof meta === 'object' && meta ? sanitizeTotals(meta.totals) : undefined;
    if (last && last.hash === ser) {
      if (totals && (!last.totals || !totalsEqual(last.totals, totals))) {
        const updated = [...history];
        updated[updated.length - 1] = { ...last, totals };
        return updated;
      }
      return history;
    }
    const ts = Date.now();
    const key = `${ts}-${Math.random().toString(36).slice(2, 8)}`;
    const entry: PortfolioHistoryItem = { key, ts, note, portfolio: JSON.parse(ser), hash: ser };
    if (totals) entry.totals = totals;
    const next = [...history, entry];
    return next.length > MAX ? next.slice(next.length - MAX) : next;
  } catch {
    return history;
  }
}

function metricsEqual(a: Record<string, PortfolioMetricsEntry>, b: Record<string, PortfolioMetricsEntry>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    const va = a[key];
    const vb = b[key];
    if (!vb) return false;
    if (Math.round(va.valueJPY) !== Math.round(vb.valueJPY)) return false;
    if (Math.round(va.changeJPY) !== Math.round(vb.changeJPY)) return false;
    const ga = va.gainLossPercent ?? null;
    const gb = vb.gainLossPercent ?? null;
    if (ga == null && gb == null) continue;
    if (ga == null || gb == null) return false;
    if (Math.round(ga * 100) !== Math.round(gb * 100)) return false;
  }
  return true;
}

function syncHoldingsWithPortfolio(state: { watchItems: Record<string, WatchItem>; watchGroups: Record<string, WatchGroup> }, portfolio: AssetItem[]): { watchItems: Record<string, WatchItem>; watchGroups: Record<string, WatchGroup> } {
  const items = { ...state.watchItems };
  const groups = cloneGroups(state.watchGroups);
  const allGroup = ensureSystemGroup(groups, 'all');
  const holdingGroup = ensureSystemGroup(groups, 'holding');
  const symbols = new Map<string, { label: string; type: WatchItemType }>();

  portfolio.forEach((asset) => {
    if (asset.type !== 'STOCK' && asset.type !== 'CRYPTO') return;
    const symbol = normalizeSymbol((asset.details as any)?.symbol || '');
    if (!symbol) return;
    const label = asset.label || symbol;
    symbols.set(symbol, { label, type: 'stock' });
  });

  const existingBySymbol = new Map<string, string>();
  Object.values(items).forEach((item) => {
    existingBySymbol.set(item.symbol, item.id);
  });

  const holdingIds = new Set<string>();
  const now = Date.now();
  symbols.forEach((info, symbol) => {
    let itemId = existingBySymbol.get(symbol);
    if (!itemId) {
      const item = createWatchItem(symbol, info.label, info.type, now);
      items[item.id] = item;
      itemId = item.id;
      existingBySymbol.set(symbol, itemId);
    } else {
      const current = items[itemId];
      items[itemId] = {
        ...current,
        name: current.name || info.label,
        type: info.type,
        updatedAt: now,
      };
    }
    holdingIds.add(itemId);
    addItemToGroup(allGroup, itemId, { atStart: true });
  });

  holdingGroup.itemIds = holdingGroup.itemIds.filter((id) => holdingIds.has(id));
  holdingIds.forEach((id) => addItemToGroup(holdingGroup, id, { atStart: true }));
  holdingGroup.updatedAt = now;
  allGroup.updatedAt = now;
  groups[allGroup.id] = allGroup;
  groups[holdingGroup.id] = holdingGroup;

  return { watchItems: items, watchGroups: groups };
}

function syncSnapshotTotals(history: PortfolioHistoryItem[], totals: PortfolioTotals): PortfolioHistoryItem[] {
  if (!history.length) return history;
  const sanitized = sanitizeTotals(totals);
  if (!sanitized) return history;
  const last = history[history.length - 1];
  if (!isSameDay(last.ts, Date.now())) return history;
  if (last.totals && totalsEqual(last.totals, sanitized)) return history;
  const updated = [...history];
  updated[updated.length - 1] = { ...last, totals: sanitized };
  return updated;
}

function sanitizeTotals(raw?: Partial<PortfolioTotals> | null): PortfolioTotals | undefined {
  if (!raw) return undefined;
  const total = toNumberOrNull(raw.total);
  if (total == null) return undefined;
  const cashRaw = toNumberOrNull(raw.cash);
  const investRaw = toNumberOrNull(raw.invest);
  const cash = cashRaw ?? (investRaw != null ? total - investRaw : 0);
  const invest = investRaw ?? (total - cash);
  return { total, cash, invest };
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function totalsEqual(a: PortfolioTotals, b: PortfolioTotals): boolean {
  return (
    Math.round(a.total) === Math.round(b.total) &&
    Math.round(a.cash) === Math.round(b.cash) &&
    Math.round(a.invest) === Math.round(b.invest)
  );
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function isSameDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b);
}
