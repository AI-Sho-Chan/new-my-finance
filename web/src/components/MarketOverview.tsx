import { useEffect, useMemo, useState } from 'react';
import type { MarketQuote, TickerSymbol } from '../types';
import { fetchMarketQuotes } from '../lib/data';
import StockCard from './StockCard';
import StockChartModal from './StockChartModal';

export default function MarketOverview() {
  const symbols = useMemo<TickerSymbol[]>(() => ['^VIX', '^GSPC', '^IXIC', '^N225', 'JPY=X'], []);
  const [quotes, setQuotes] = useState<Record<string, MarketQuote> | null>(null);
  const [modal, setModal] = useState<{ symbol: string } | null>(null);

  useEffect(() => {
    let mounted = true;
    fetchMarketQuotes(symbols)
      .then((q) => { if (mounted) setQuotes(q); })
      .catch((e) => console.warn('overview quotes failed', e));
    return () => { mounted = false; };
  }, [symbols.join(',')]);

  if (!quotes) return null;

  const order: { symbol: string; name?: string }[] = [
    { symbol: '^VIX', name: 'VIX' },
    { symbol: '^GSPC', name: 'S&P 500' },
    { symbol: '^IXIC', name: 'NASDAQ' },
    { symbol: '^N225', name: '日経平均' },
    { symbol: 'JPY=X', name: 'USD/JPY' },
  ];

  return (
    <div className="mb-6">
      <h3 className="text-lg font-semibold text-gray-200 mb-2">マーケット概況</h3>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 md:gap-3">
        {order.map(({ symbol, name }) => (
          quotes[symbol] ? (
            <StockCard key={symbol} quote={{ ...quotes[symbol], name: name || quotes[symbol].name }} onClick={() => setModal({ symbol })} />
          ) : null
        ))}
      </div>
      {modal && <StockChartModal symbol={modal.symbol} open={true} onClose={() => setModal(null)} />}
    </div>
  );
}

