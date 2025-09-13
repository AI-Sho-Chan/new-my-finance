import { useEffect, useMemo, useState } from 'react';
import { fetchHistoricalCandles, fetchMarketQuotes, inferTrend, fetchFundamentals } from '../lib/data';
import { useStore } from '../store';
import type { MarketQuote } from '../types';
import StockCard from './StockCard';
import Loader from './Loader';
import StockChartModal from './StockChartModal';
import MarketOverview from './MarketOverview';

export default function Dashboard() {
  const watchlist = useStore((s) => [...s.watchlist].sort((a, b) => a.order - b.order));
  const [quotes, setQuotes] = useState<Record<string, MarketQuote> | null>(null);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<{ symbol: string } | null>(null);

  const symbols = useMemo(() => watchlist.map((w) => w.symbol), [watchlist]);

  useEffect(() => {
    if (!symbols.length) return;
    let mounted = true;
    setLoading(true);
    fetchMarketQuotes(symbols)
      .then(async (q) => {
        for (const sym of symbols) {
          const [candles, fund] = await Promise.all([
            fetchHistoricalCandles(sym, 'D'),
            fetchFundamentals(sym).catch(() => ({ yoyRevenuePct: null, yoyOperatingIncomePct: null })),
          ]);
          q[sym].trend = inferTrend(candles);
          q[sym].yoyRevenuePct = fund.yoyRevenuePct ?? undefined;
          q[sym].yoyOperatingIncomePct = fund.yoyOperatingIncomePct ?? undefined;
        }
        if (mounted) setQuotes(q);
      })
      .catch((err) => {
        console.error('Failed to load market quotes', err);
      })
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [symbols.join(',')]);

  if (loading || !quotes) return (
    <div>
      <h2 className="text-2xl font-semibold mb-4 text-gray-200">ダッシュボード</h2>
      <div className="flex justify-center items-center h-64"><Loader /><span className="ml-3 text-gray-400">市場データを取得中...</span></div>
    </div>
  );

  return (
    <div>
      <h2 className="text-2xl font-semibold mb-4 text-gray-200">ダッシュボード</h2>
      <MarketOverview />
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 md:gap-4">
        {watchlist.map((w) => (
          <StockCard key={w.id} quote={quotes[w.symbol]} onClick={() => setModal({ symbol: w.symbol })} />
        ))}
      </div>
      {modal && <StockChartModal symbol={modal.symbol} open={true} onClose={() => setModal(null)} />}
    </div>
  );
}

