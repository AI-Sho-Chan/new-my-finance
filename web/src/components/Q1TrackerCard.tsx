
import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import Loader from './Loader';
import { fetchQ1Trackers, type Q1TrackerEntry } from '../lib/q1';

const SORT_OPTIONS = [
  { value: 'alphaDesc', label: 'アルファ(降順)' },
  { value: 'returnDesc', label: '騰落率(降順)' },
  { value: 'returnAsc', label: '騰落率(昇順)' },
  { value: 'daysDesc', label: '経過日数(降順)' },
  { value: 'newest', label: '新着順' },
];

type SortKey = (typeof SORT_OPTIONS)[number]['value'];

type MarketFilter = 'ALL' | 'JP' | 'US';

function formatNumber(value: number | null | undefined, fractionDigits = 2): string {
  if (value == null || Number.isNaN(value)) return '-';
  return value.toLocaleString('ja-JP', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits });
}

function formatPercent(value: number | null | undefined, fractionDigits = 2): string {
  if (value == null || Number.isNaN(value)) return '-';
  return `${value >= 0 ? '+' : ''}${formatNumber(value, fractionDigits)}%`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleDateString('ja-JP');
  } catch {
    return value;
  }
}

export default function Q1TrackerCard() {
  const [entries, setEntries] = useState<Q1TrackerEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [market, setMarket] = useState<MarketFilter>('ALL');
  const [sortKey, setSortKey] = useState<SortKey>('alphaDesc');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchQ1Trackers();
        if (!cancelled) {
          setEntries(Array.isArray(data.entries) ? data.entries : []);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load Q1 trackers', err);
          setError('Q1トラッカーの取得に失敗しました');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const list = market === 'ALL' ? entries : entries.filter((entry) => entry.market === market);
    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sortKey) {
        case 'alphaDesc':
          return (b.alphaPct ?? Number.NEGATIVE_INFINITY) - (a.alphaPct ?? Number.NEGATIVE_INFINITY);
        case 'returnDesc':
          return (b.returnPct ?? Number.NEGATIVE_INFINITY) - (a.returnPct ?? Number.NEGATIVE_INFINITY);
        case 'returnAsc':
          return (a.returnPct ?? Number.POSITIVE_INFINITY) - (b.returnPct ?? Number.POSITIVE_INFINITY);
        case 'daysDesc':
          return (b.daysHeld ?? -1) - (a.daysHeld ?? -1);
        case 'newest':
          return (b.detectedAt ?? 0) - (a.detectedAt ?? 0);
        default:
          return 0;
      }
    });
    return sorted;
  }, [entries, market, sortKey]);

  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-4">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-gray-100">Q1 トラッカー</h2>
          <p className="text-xs text-gray-500">初回Q1判定銘柄の進捗とベンチマーク比較。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={market}
            onChange={(e) => setMarket(e.target.value as MarketFilter)}
            className="px-3 py-2 text-sm rounded-md border border-gray-700 bg-gray-800 text-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="ALL">全市場</option>
            <option value="JP">日本株</option>
            <option value="US">米国株</option>
          </select>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="px-3 py-2 text-sm rounded-md border border-gray-700 bg-gray-800 text-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32 text-sm text-gray-400">
          <Loader />
          <span className="ml-3">計算中...</span>
        </div>
      ) : error ? (
        <div className="mt-4 rounded border border-red-500/40 bg-red-500/10 text-red-200 px-4 py-2 text-sm">{error}</div>
      ) : !filtered.length ? (
        <div className="mt-4 text-sm text-gray-400">現在追跡中の銘柄はありません。</div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-xs text-gray-200">
            <thead>
              <tr className="bg-gray-800 text-gray-300">
                <th className="px-3 py-2 text-left">銘柄</th>
                <th className="px-3 py-2 text-right">購入価格</th>
                <th className="px-3 py-2 text-right">現在価格</th>
                <th className="px-3 py-2 text-right">騰落率</th>
                <th className="px-3 py-2 text-right">ベンチマーク</th>
                <th className="px-3 py-2 text-right">ベンチ騰落</th>
                <th className="px-3 py-2 text-right">アルファ</th>
                <th className="px-3 py-2 text-right">経過日数</th>
                <th className="px-3 py-2 text-right">購入日</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <tr key={entry.symbol} className="border-b border-gray-800/80">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="font-semibold text-gray-100">{entry.symbol}</div>
                    <div className="text-gray-400">{entry.name}</div>
                  </td>
                  <td className="px-3 py-2 text-right">{formatNumber(entry.purchasePrice)}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(entry.latest?.price ?? null)}</td>
                  <td className={clsx('px-3 py-2 text-right', entry.returnPct != null && entry.returnPct < 0 ? 'text-rose-300' : 'text-green-300')}>
                    {formatPercent(entry.returnPct)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div>{entry.benchmark}</div>
                    <div className="text-gray-500 text-[11px]">初期: {formatNumber(entry.benchmarkPrice)}</div>
                  </td>
                  <td className="px-3 py-2 text-right">{formatPercent(entry.benchmarkReturnPct)}</td>
                  <td className="px-3 py-2 text-right text-indigo-300">{formatPercent(entry.alphaPct)}</td>
                  <td className="px-3 py-2 text-right">{entry.daysHeld != null ? entry.daysHeld : '-'}</td>
                  <td className="px-3 py-2 text-right">{formatDate(entry.tradeDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
