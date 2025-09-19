import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import type { MarketQuote, TickerSymbol, Trend } from '../types';
import { fetchHistoricalCandles, fetchMarketQuotes, inferTrend } from '../lib/data';
import StockChartModal from './StockChartModal';
import { TrendingDown, TrendingUp } from './icons';

const ITEMS: Array<{ symbol: TickerSymbol; name: string }> = [
  { symbol: '^VIX', name: 'VIX' },
  { symbol: '^GSPC', name: 'S&P 500' },
  { symbol: '^IXIC', name: 'NASDAQ' },
  { symbol: '^N225', name: '日経平均' },
  { symbol: 'JPY=X', name: 'USD/JPY' },
  { symbol: 'GC=F', name: 'Gold' },
  { symbol: 'BTC-USD', name: 'Bitcoin' },
];

const TREND_CLASS: Record<Trend, string> = {
  up: 'text-emerald-400',
  down: 'text-rose-400',
  flat: 'text-gray-400',
};

const TREND_LABEL: Record<Trend, string> = {
  up: '上昇トレンド',
  down: '下降トレンド',
  flat: 'トレンド不明',
};

function formatChange(changePct: number | undefined) {
  if (typeof changePct !== 'number' || !Number.isFinite(changePct)) return '--';
  const sign = changePct >= 0 ? '+' : '';
  return `${sign}${changePct.toFixed(2)}%`;
}

function formatPrice(price: number | undefined, currency: MarketQuote['currency'] | undefined) {
  if (typeof price !== 'number' || !Number.isFinite(price)) return '--';
  if (!currency) return price.toFixed(2);
  if (currency === 'JPY') {
    return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 }).format(price);
  }
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(price);
}

function formatUpdatedAt(ts?: number | null) {
  if (!ts) return '--:--';
  return new Date(ts).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

export default function MarketOverview() {
  const symbols = useMemo<TickerSymbol[]>(() => ITEMS.map((item) => item.symbol), []);
  const [quotes, setQuotes] = useState<Record<string, MarketQuote>>({});
  const [modal, setModal] = useState<{ symbol: string } | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const response = await fetchMarketQuotes(symbols);
        if (!mounted) return;
        const fetchTime = Date.now();
        const enriched: Record<string, MarketQuote> = {};
        Object.entries(response || {}).forEach(([sym, quote]) => {
          if (!quote) return;
          enriched[sym] = { ...quote, updatedAt: quote.updatedAt ?? fetchTime };
        });
        setQuotes(enriched);
        setLastUpdated(new Date(fetchTime).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }));

        const trendEntries = await Promise.all(
          Object.keys(enriched).map(async (sym) => {
            try {
              const candles = await fetchHistoricalCandles(sym, 'D');
              return [sym, inferTrend(candles)] as const;
            } catch {
              return [sym, 'flat'] as const;
            }
          }),
        );

        if (!mounted) return;
        setQuotes((prev) => {
          const next = { ...prev };
          trendEntries.forEach(([sym, trend]) => {
            if (next[sym]) next[sym] = { ...next[sym], trend };
          });
          return next;
        });
      } catch (e) {
        console.warn('overview quotes failed', e);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [symbols]);

  const hasQuotes = Object.keys(quotes).length > 0;
  if (!hasQuotes) return null;

  return (
    <div className='rounded-lg border border-gray-800 bg-gray-900/60 p-4'>
      <div className='flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between'>
        <h3 className='text-lg font-semibold text-gray-100'>マーケット概況</h3>
        <span className='text-xs font-medium text-gray-300'>最終更新: {lastUpdated ?? '--:--'}</span>
      </div>
      <div className='mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3'>
        {ITEMS.map(({ symbol, name }) => {
          const quote = quotes[symbol];
          if (!quote) {
            return (
              <div key={symbol} className='flex h-full flex-col gap-3 overflow-hidden rounded-lg border border-gray-800 bg-gray-900/80 p-3'>
                <div className='flex items-center justify-between text-[11px] text-gray-500'>
                  <span>{symbol}</span>
                  <span className='rounded-full bg-gray-800/70 px-2 py-0.5 text-[10px] text-gray-400'>--:--</span>
                </div>
                <p className='text-sm text-gray-300'>{name}</p>
                <p className='text-2xl font-bold text-gray-500'>--</p>
                <p className='text-xs text-gray-600'>データなし</p>
              </div>
            );
          }
          const changePct = quote.changePct;
          const changeText = formatChange(changePct);
          const priceText = formatPrice(quote.price, quote.currency);
          const displayPrice = symbol === '^VIX'
            ? (typeof quote.price === 'number' && Number.isFinite(quote.price) ? quote.price.toFixed(2) : '--')
            : priceText;
          const changeClass = typeof changePct === 'number'
            ? (changePct >= 0 ? 'text-emerald-400' : 'text-rose-400')
            : 'text-gray-400';
          const trend: Trend = quote.trend ?? 'flat';
          const trendClass = TREND_CLASS[trend];
          const trendLabel = TREND_LABEL[trend];
          const updatedLabel = formatUpdatedAt(quote.updatedAt ?? null);
          return (
            <button
              key={symbol}
              type='button'
              onClick={() => setModal({ symbol })}
              className='flex h-full flex-col gap-3 rounded-lg border border-gray-800 bg-gray-900/80 p-3 text-left transition-colors hover:border-indigo-500/60 hover:bg-gray-800/90'
            >
              <div className='flex items-start justify-between gap-2'>
                <span className='text-[11px] text-gray-400'>{symbol}</span>
                <div className='flex items-center gap-2'>
                  <span className='rounded-full bg-gray-800/70 px-2 py-0.5 text-[10px] font-semibold text-gray-200'>
                    {updatedLabel}
                  </span>
                  <span
                    className={clsx('text-xl', trendClass)}
                    aria-label={trendLabel}
                    title={trendLabel}
                  >
                    {trend === 'up' && <TrendingUp />}
                    {trend === 'down' && <TrendingDown />}
                    {trend === 'flat' && <span className='text-base text-gray-500'>―</span>}
                  </span>
                </div>
              </div>
              <p className='text-sm text-gray-200'>{name}</p>
              <div className='mt-auto space-y-1'>
                <p className={clsx('text-2xl font-bold', changeClass)}>{changeText}</p>
                <p className='text-xs text-gray-400'>{displayPrice}</p>
              </div>
            </button>
          );
        })}
      </div>
      {modal && <StockChartModal symbol={modal.symbol} open={true} onClose={() => setModal(null)} />}
    </div>
  );
}

