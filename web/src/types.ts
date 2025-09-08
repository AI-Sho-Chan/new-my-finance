export type TickerSymbol = string;

export type Timeframe = 'D' | 'W' | 'M';

export interface MarketQuote {
  symbol: TickerSymbol;
  name: string;
  price: number;
  prevClose: number;
  change: number; // price - prevClose
  changePct: number; // (change/prevClose)*100
  currency: 'JPY' | 'USD';
  per?: number;
  pbr?: number;
  dividendYieldPct?: number;
  marketCap?: number;
  yoyRevenuePct?: number;
  yoyOperatingIncomePct?: number;
  trend?: 'up' | 'down' | 'flat';
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

export interface WatchItem {
  id: string;
  symbol: TickerSymbol;
  name: string;
  order: number;
}

