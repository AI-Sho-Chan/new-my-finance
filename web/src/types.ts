export type TickerSymbol = string;

export type Timeframe = 'D' | 'W' | 'M';

export type Trend = 'up' | 'down' | 'flat';

export interface MarketQuote {
  symbol: TickerSymbol;
  name: string;
  price: number;
  prevClose: number;
  change: number; // price - prevClose
  changePct: number; // (change/prevClose)*100
  currency: 'JPY' | 'USD';
  updatedAt?: number;
  per?: number;
  pbr?: number;
  dividendYieldPct?: number;
  marketCap?: number;
  yoyRevenuePct?: number;
  yoyOperatingIncomePct?: number;
  trend?: Trend;
}

export interface Candle {
  time: number; // epoch seconds
  open: number;
  high: number;
  low: number;
  close: number;
  value?: number; // volume
}

export type AssetType = 'CASH' | 'STOCK' | 'CRYPTO';

export interface CashDetails {
  currency: 'JPY' | 'USD';
  amount: number;
  rateJPY?: number; // for USD -> JPY conversion
}

export interface StockDetails {
  symbol: TickerSymbol;
  avgPrice: number;
  qty: number;
}

export interface CryptoDetails {
  symbol: TickerSymbol;
  avgPrice: number;
  qty: number;
}

export interface AssetItemBase {
  id: string;
  type: AssetType;
  label: string; // bank name or any label
  order: number;
}

export type AssetItem =
  | (AssetItemBase & { type: 'CASH'; details: CashDetails })
  | (AssetItemBase & { type: 'STOCK'; details: StockDetails })
  | (AssetItemBase & { type: 'CRYPTO'; details: CryptoDetails });

export type WatchItemType = 'stock' | 'index';

export interface WatchItem {
  id: string;
  symbol: TickerSymbol;
  name: string;
  type: WatchItemType;
  addedAt: number;
  updatedAt: number;
  note?: string;
}

export type WatchGroupSortMode = 'addedAt' | 'symbol' | 'price' | 'custom';
export type WatchGroupSortDirection = 'asc' | 'desc';

export type WatchSortMode = 'none' | 'changeAsc' | 'changeDesc' | 'gainLossDesc' | 'trendUpFirst' | 'trendDownFirst';

export interface WatchGroup {
  id: string;
  key?: 'all' | 'holding' | 'candidate' | 'index';
  name: string;
  color: string;
  order: number;
  type: 'system' | 'user';
  itemIds: string[];
  sort: { mode: WatchGroupSortMode; direction: WatchGroupSortDirection };
  updatedAt: number;
  description?: string;
}

export interface WatchUIState {
  activeGroupId: string;
  selectionMode: boolean;
  selectedIds: string[];
  pendingAssignGroupIds: string[];
  sortMode: WatchSortMode;
}

export interface WatchSnapshot {
  items: Record<string, WatchItem>;
  groups: Record<string, WatchGroup>;
  ui: WatchUIState;
}

