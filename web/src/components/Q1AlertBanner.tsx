import type { Q1Event, Q1Metrics } from '../lib/q1';

function formatNumber(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return 'n/a';
  return value.toFixed(digits);
}

function formatPercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return 'n/a';
  return `${value}%`;
}

function formatTimestamp(ts: number) {
  if (!ts || !Number.isFinite(ts)) return 'n/a';
  try {
    return new Date(ts).toLocaleString('ja-JP', { hour12: false });
  } catch {
    return new Date(ts).toISOString();
  }
}

type Props = {
  event: Q1Event;
  onDismiss: (ts: number) => void;
};

export default function Q1AlertBanner({ event, onDismiss }: Props) {
  const isEnter = event.type === 'ENTER';
  const title = isEnter ? 'Q1入り検知' : 'Q1落ち検知';
  const tone = isEnter
    ? 'border-emerald-500/50 bg-emerald-600/10 text-emerald-100'
    : 'border-rose-500/50 bg-rose-600/10 text-rose-100';
  const accent = isEnter ? 'text-emerald-300' : 'text-rose-300';
  const metrics = (event.metrics ?? {}) as Q1Metrics;

  return (
    <div className={`flex flex-wrap items-start justify-between gap-4 border px-4 py-3 rounded-md shadow ${tone}`}>
      <div className="flex-1 min-w-[220px]">
        <div className={`text-sm font-semibold ${accent}`}>{title}</div>
        <div className="text-base font-bold text-white">
          {event.symbol}
          <span className="ml-2 text-sm text-gray-200 font-medium">{event.name}</span>
        </div>
        <div className="mt-1 text-xs text-gray-200 space-x-3">
          <span>市場: {event.market}</span>
          <span>検知: {formatTimestamp(event.ts)}</span>
          {event.tradeDate ? <span>取引日: {event.tradeDate}</span> : null}
        </div>
        <div className="mt-1 text-xs text-gray-300 space-x-3">
          <span>Flow: {formatNumber(metrics.F)}</span>
          <span>Value: {formatNumber(metrics.V)}</span>
          <span>A: {formatNumber(metrics.A)}</span>
          <span>Flow%: {formatPercent(metrics.flowPercentile)}</span>
          <span>Value%: {formatPercent(metrics.valuePercentile)}</span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {metrics.lastPrice != null ? (
          <div className="text-xs text-gray-200">
            現在価格: <span className="font-semibold text-white">{formatNumber(metrics.lastPrice, 2)}</span>
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => onDismiss(event.ts)}
          className="rounded-md border border-white/40 px-3 py-1 text-xs font-semibold text-white hover:bg-white/10"
        >
          閉じる
        </button>
      </div>
    </div>
  );
}
