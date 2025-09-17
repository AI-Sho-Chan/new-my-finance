import { useEffect, useMemo, useState } from 'react';
import type { MarketQuote, TickerSymbol } from '../types';
import { fetchMarketQuotes } from '../lib/data';
import StockChartModal from './StockChartModal';
import clsx from 'clsx';

const ITEMS: { symbol: TickerSymbol; name: string }[] = [
  { symbol: '^VIX', name: 'VIX' },
  { symbol: '^GSPC', name: 'S&P 500' },
  { symbol: '^IXIC', name: 'NASDAQ' },
  { symbol: '^N225', name: '日経平均' },
  { symbol: 'JPY=X', name: 'USD/JPY' },
  { symbol: 'GC=F', name: 'Gold' },
  { symbol: 'BTC-USD', name: 'Bitcoin' },
];

function formatChange(changePct: number | undefined) {
  if (typeof changePct !== 'number' || !Number.isFinite(changePct)) return '--';
  const sign = changePct >= 0 ? '+' : '';
  return `${sign}${changePct.toFixed(2)}%`;
}

function formatPrice(price: number | undefined, currency: MarketQuote['currency'] | undefined) {
  if (typeof price !== 'number' || !Number.isFinite(price)) return '--';
  if (!currency) return price.toFixed(2);
  if (currency === 'JPY') {
    return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 2 }).format(price);
  }
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(price);
}

export default function MarketOverview() {
  const symbols = useMemo<TickerSymbol[]>(() => ITEMS.map((item) => item.symbol), []);
  const [quotes, setQuotes] = useState<Record<string, MarketQuote> | null>(null);
  const [modal, setModal] = useState<{ symbol: string } | null>(null);

  useEffect(() => {
    let mounted = true;
    fetchMarketQuotes(symbols)
      .then((q) => {
        if (mounted) setQuotes(q);
      })
      .catch((e) => console.warn('overview quotes failed', e));
    return () => {
      mounted = false;
    };
  }, [symbols.join(',')]);

  if (!quotes) return null;

  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-4">
      <h3 className="text-lg font-semibold text-gray-100 mb-3">マーケット概況</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {ITEMS.map(({ symbol, name }) => {
          const quote = quotes[symbol];
          if (!quote) {
            return (
              <div key={symbol} className="rounded-lg border border-gray-800 bg-gray-900/80 p-3">
                <p className="text-xs text-gray-500">{name}</p>
                <p className="mt-2 text-lg font-semibold text-gray-400">--</p>
                <p className="text-xs text-gray-600">データなし</p>
              </div>
            );
          }
          const changePct = quote.changePct;
          const changeText = formatChange(changePct);
          const priceText = formatPrice(quote.price, quote.currency);
          const changeClass = typeof changePct === 'number' ? (changePct >= 0 ? 'text-emerald-400' : 'text-rose-400') : 'text-gray-400';
          return (
            <button
              key={symbol}
              type="button"
              onClick={() => setModal({ symbol })}
              className="rounded-lg border border-gray-800 bg-gray-900/80 p-3 text-left hover:border-indigo-500/60 hover:bg-gray-800/90 transition-colors"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500">{symbol}</p>
                <span className={clsx('text-sm font-semibold', changeClass)}>{changeText}</span>
              </div>
              <p className="mt-1 text-lg font-semibold text-gray-100">{name}</p>
              <p className="text-xs text-gray-400">{priceText}</p>
            </button>
          );
        })}
      </div>
      {modal && <StockChartModal symbol={modal.symbol} open={true} onClose={() => setModal(null)} />}
    </div>
  );
}
