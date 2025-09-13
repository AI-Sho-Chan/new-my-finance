import { v4 as uuidv4 } from 'uuid';
import { useStore } from '../store';
import type { AssetItem } from '../types';

type LegacyAssets = {
  cash?: Array<{ id?: string; label?: string; currency?: 'JPY' | 'USD'; amount?: number }>; 
  holdings?: Array<{ id?: string; symbol?: string; qty?: number; avgPrice?: number }>;
};

function isFiniteNumber(n: any): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * Import legacy assets saved by older single-file app (localStorage key: 'nmy.assets').
 * Runs once on app start if current portfolio is empty.
 */
export function migrateLegacyAssetsIfAny(): { imported: number } {
  try {
    const state = useStore.getState();
    const hasCurrentStore = !!localStorage.getItem('myfinance-store');
    // If current store already exists, don't auto-import to avoid clobbering user data
    // If not exists (first run), allow import even if defaults are present in memory
    if (hasCurrentStore && state.portfolio && state.portfolio.length > 0) {
      return { imported: 0 };
    }

    const out = readLegacyAssetsFromThisOrigin();
    if (!out || out.length === 0) return { imported: 0 };
    useStore.setState((s) => ({ ...s, portfolio: out }));
    return { imported: out.length };
  } catch (e) {
    console.warn('Legacy assets migration skipped:', e);
    return { imported: 0 };
  }
}

/** Try loading legacy assets from either nmy.assets or latest snapshot in nmy.assets.history */
export function readLegacyAssetsFromThisOrigin(): AssetItem[] | null {
  try {
    const rawHist = localStorage.getItem('nmy.assets.history');
    const raw = localStorage.getItem('nmy.assets');
    let base: LegacyAssets | null = null;
    // prefer latest history entry if present
    if (rawHist) {
      try {
        const hist = JSON.parse(rawHist) as Array<{ key?: string; ts?: number; cash?: any[]; cashJPY?: any; cashUSD?: any; stocksJP?: any; stocksUS?: any; } & LegacyAssets> | null;
        const last = Array.isArray(hist) && hist.length ? hist[hist.length - 1] : null;
        if (last && (Array.isArray(last.cash) || Array.isArray(last.holdings))) {
          base = { cash: last.cash as any[], holdings: last.holdings as any[] };
        }
      } catch {}
    }
    if (!base && raw) {
      const parsed = JSON.parse(raw) as LegacyAssets | null;
      if (parsed && typeof parsed === 'object') base = parsed;
    }
    if (!base) return null;

    const out: AssetItem[] = [];
    let order = 0;
    for (const c of base.cash || []) {
      const currency = (c?.currency === 'USD' ? 'USD' : 'JPY') as 'JPY' | 'USD';
      const amount = isFiniteNumber(c?.amount) ? c!.amount! : 0;
      out.push({ id: uuidv4(), type: 'CASH', label: (c?.label && String(c.label)) || (currency === 'USD' ? 'USD現金' : 'JPY現金'), order: order++, details: { currency, amount } } as AssetItem);
    }
    for (const h of base.holdings || []) {
      const symbol = (h?.symbol && String(h.symbol).toUpperCase()) || '';
      if (!symbol) continue;
      const qty = isFiniteNumber(h?.qty) ? h!.qty! : 0;
      const avgPrice = isFiniteNumber(h?.avgPrice) ? h!.avgPrice! : 0;
      out.push({ id: uuidv4(), type: 'STOCK', label: symbol, order: order++, details: { symbol, avgPrice, qty } } as AssetItem);
    }
    return out;
  } catch (e) {
    console.warn('readLegacyAssetsFromThisOrigin failed', e);
    return null;
  }
}
