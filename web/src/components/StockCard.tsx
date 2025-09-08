import { useMemo } from 'react';
import type { MarketQuote } from '../types';
import { TrendingDown, TrendingUp } from './icons';

export default function StockCard({ quote, onClick }: { quote: MarketQuote; onClick?: () => void }) {
  const isPositive = (quote.changePct || 0) >= 0;
  const changePercentAbs = Math.abs(quote.changePct || 0);
  const isVolatile = changePercentAbs >= 5;

  const cardStyle = `
    bg-gray-800 rounded-lg p-3 shadow-lg transform hover:scale-105 transition-transform duration-300 cursor-pointer
    flex flex-col justify-between h-full aspect-[4/5]
    ${isVolatile ? 'ring-2 ring-yellow-400 shadow-yellow-400/20' : ''}
  `;

  const formatGrowth = (v?: number | null) => {
    if (v === undefined || v === null) return '-';
    const sign = v >= 0 ? '+' : '';
    return `${sign}${v.toFixed(1)}%`;
  };

  return (
    <div className={cardStyle} onClick={onClick}>
      <div className="flex justify-between items-start">
        <div className="w-4/5">
          <h3 className="text-sm font-bold text-gray-100 truncate">{quote.name}</h3>
          <p className="text-xs text-gray-400">{quote.symbol}</p>
        </div>
        <div className={`text-lg flex items-center ${quote.trend === 'up' ? 'text-green-400' : quote.trend === 'down' ? 'text-red-400' : 'text-gray-400'}`}>
          {quote.trend === 'up' ? <TrendingUp /> : <TrendingDown />}
        </div>
      </div>

      <div className="flex-grow flex items-center justify-center my-1">
        <div className={`text-3xl md:text-4xl font-bold ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
          {isPositive ? '+' : '-'}{changePercentAbs.toFixed(1)}%
        </div>
      </div>

      <div className="text-xs text-gray-400 pt-2 border-t border-gray-700 space-y-1">
        <div className="flex justify-between"><span className="font-semibold">PER</span> <span className="text-gray-200 font-medium">{quote.per ?? '-'}</span></div>
        <div className="flex justify-between"><span className="font-semibold">PBR</span> <span className="text-gray-200 font-medium">{quote.pbr ?? '-'}</span></div>
        <div className="flex justify-between"><span className="font-semibold">配当利回り</span> <span className="text-gray-200 font-medium">{quote.dividendYieldPct != null ? `${quote.dividendYieldPct}%` : '-'}</span></div>
        <div className="flex justify-between"><span className="font-semibold truncate" title="売上の前年同期比(YoY)">売上YoY</span> <span className={`font-semibold ${(quote.yoyRevenuePct ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatGrowth(quote.yoyRevenuePct)}</span></div>
        <div className="flex justify-between"><span className="font-semibold truncate" title="営業利益の前年同期比(YoY)">営利YoY</span> <span className={`font-semibold ${(quote.yoyOperatingIncomePct ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatGrowth(quote.yoyOperatingIncomePct)}</span></div>
      </div>
    </div>
  );
}
