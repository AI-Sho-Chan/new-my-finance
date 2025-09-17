import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { ColorType, createChart, type IChartApi, type ISeriesApi } from 'lightweight-charts';

interface SeriesPoint {
  time: number;
  value: number;
}

interface FgiState {
  now: number | null;
  previousClose: number | null;
  history: SeriesPoint[];
}

const LABELS = [
  { max: 25, label: '極度の恐怖', color: 'text-rose-400' },
  { max: 45, label: '恐怖', color: 'text-orange-400' },
  { max: 55, label: '中立', color: 'text-gray-300' },
  { max: 75, label: '貪欲', color: 'text-emerald-300' },
  { max: Infinity, label: '極度の貪欲', color: 'text-emerald-400' },
];

const FETCH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const FGI_BASE_RANGE: [number, number] = [20, 80];

function toSeries(points: any): SeriesPoint[] {
  if (!Array.isArray(points)) return [];
  return points
    .map((entry) => {
      const rawTime = Number(entry?.t ?? entry?.time ?? entry?.timestamp ?? entry?.x ?? 0);
      const rawValue = Number(entry?.v ?? entry?.value ?? entry?.score ?? entry?.y ?? entry?.close);
      if (!Number.isFinite(rawTime) || !Number.isFinite(rawValue)) return null;
      const time = rawTime > 1e10 ? Math.floor(rawTime / 1000) : Math.floor(rawTime);
      return { time, value: rawValue };
    })
    .filter((p): p is SeriesPoint => Boolean(p))
    .sort((a, b) => a.time - b.time);
}

function latestPair(series: SeriesPoint[]): { current: number | null; previous: number | null } {
  if (!series.length) return { current: null, previous: null };
  const curr = series[series.length - 1]?.value ?? null;
  const prev = series.length > 1 ? series[series.length - 2]?.value ?? null : null;
  return { current: Number.isFinite(curr) ? curr : null, previous: Number.isFinite(prev) ? prev : null };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function degreesToRadians(angle: number) {
  return (angle * Math.PI) / 180;
}

function polarToCartesian(cx: number, cy: number, radius: number, angleDeg: number) {
  const angle = degreesToRadians(angleDeg);
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
}

function describeArc(cx: number, cy: number, radius: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
}

export default function FGIWidget() {
  const [state, setState] = useState<FgiState>({ now: null, previousClose: null, history: [] });
  const [spSeries, setSpSeries] = useState<SeriesPoint[]>([]);
  const [spLatest, setSpLatest] = useState<{ current: number | null; previous: number | null }>({ current: null, previous: null });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const fgiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const spSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const resizeRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchFgi = async () => {
      try {
        const res = await fetch(`/api/fgi?ts=${Date.now()}`, { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error('fgi http ' + res.status);
        const json = await res.json();
        if (cancelled) return;
        let history = toSeries(json?.history);
        if (!history.length) {
          try {
            const fallback = await fetch(`/data/fgi/history.json?ts=${Date.now()}`, { cache: 'no-store' });
            if (fallback.ok) {
              const data = await fallback.json();
              history = toSeries(Array.isArray(data?.history) ? data.history : data);
            }
          } catch {
            /* noop */
          }
        }
        const now = typeof json?.now === 'number' ? json.now : null;
        const previousClose = typeof json?.previousClose === 'number' ? json.previousClose : null;
        setState({ now, previousClose, history });
      } catch {
        /* noop */
      }
    };
    fetchFgi();
    const id = window.setInterval(fetchFgi, FETCH_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/yf/history?symbol=${encodeURIComponent('^GSPC')}&interval=1d&range=1y`, { cache: 'no-store' });
        if (!res.ok || !alive) return;
        const json = await res.json();
        if (!alive) return;
        const result = json?.chart?.result?.[0];
        const timestamps: number[] = Array.isArray(result?.timestamp) ? result.timestamp : [];
        const closes: number[] = Array.isArray(result?.indicators?.quote?.[0]?.close) ? result.indicators.quote[0].close : [];
        const points: SeriesPoint[] = [];
        for (let i = 0; i < timestamps.length; i += 1) {
          const value = closes[i];
          if (Number.isFinite(timestamps[i]) && Number.isFinite(value)) {
            points.push({ time: Math.floor(timestamps[i]), value });
          }
        }
        setSpSeries(points);
        setSpLatest(latestPair(points));
      } catch {
        if (!alive) return;
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const chartData = useMemo(() => {
    if (!state.history.length) return [] as SeriesPoint[];
    if (state.now == null || !Number.isFinite(state.now)) return state.history;
    const lastTime = state.history[state.history.length - 1]?.time ?? Math.floor(Date.now() / 1000);
    const nextTime = Math.max(lastTime + 60, Math.floor(Date.now() / 1000));
    return [...state.history, { time: nextTime, value: state.now }];
  }, [state.history, state.now]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof window === 'undefined') return;

    if (!chartRef.current) {
      const chart = createChart(container, {
        width: container.clientWidth,
        height: 340,
        layout: { background: { type: ColorType.Solid, color: '#111827' }, textColor: '#e5e7eb' },
        grid: { horzLines: { color: '#1f2937' }, vertLines: { color: '#1f2937' } },
        timeScale: { borderColor: '#374151', timeVisible: false, secondsVisible: false },
        rightPriceScale: { borderColor: '#374151', visible: true },
        leftPriceScale: { borderColor: '#374151', visible: false },
      });
      chartRef.current = chart;
      fgiSeriesRef.current = chart.addLineSeries({ color: '#38bdf8', lineWidth: 2, priceScaleId: 'right' });
      spSeriesRef.current = chart.addLineSeries({ color: '#a78bfa', lineWidth: 1.5, priceScaleId: 'right' });
      resizeRef.current = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry || !chartRef.current) return;
        chartRef.current.applyOptions({ width: entry.contentRect.width });
      });
      resizeRef.current.observe(container);
    }

    const chart = chartRef.current;
    if (chart && fgiSeriesRef.current) {
      fgiSeriesRef.current.setData(chartData);
      const min = chartData.reduce((m, p) => Math.min(m, p.value), Infinity);
      const max = chartData.reduce((m, p) => Math.max(m, p.value), -Infinity);
      const rangeMin = Math.min(FGI_BASE_RANGE[0], min);
      const rangeMax = Math.max(FGI_BASE_RANGE[1], max);
      chart.priceScale('right')?.applyOptions({ minimum: rangeMin, maximum: rangeMax });
      chart.timeScale().fitContent();
    }
    if (chart && spSeriesRef.current) {
      spSeriesRef.current.setData(spSeries);
    }
  }, [chartData, spSeries]);

  useEffect(() => () => {
    if (resizeRef.current && containerRef.current) {
      resizeRef.current.disconnect();
    }
    if (chartRef.current) {
      chartRef.current.remove();
    }
    chartRef.current = null;
    fgiSeriesRef.current = null;
    spSeriesRef.current = null;
  }, []);

  const score = state.now;
  const prev = state.previousClose;
  const delta = score != null && prev != null ? score - prev : null;
  const scoreClamped = score != null ? clamp(score, 0, 100) : null;
  const currentLabel = LABELS.find((entry) => scoreClamped != null && scoreClamped <= entry.max) ?? LABELS[LABELS.length - 1];

  const gaugeAngle = scoreClamped != null ? (scoreClamped * 1.8) : 0;
  const pointerLength = 42;
  const pointerBase = polarToCartesian(100, 115, 10, gaugeAngle + 180);
  const pointerTip = polarToCartesian(100, 115, pointerLength, gaugeAngle);

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-4">
      <h3 className="text-lg font-semibold text-gray-100 mb-4">Fear &amp; Greed インデックス</h3>
      <div className="grid gap-6 lg:grid-cols-[200px,1fr] items-center">
        <div className="flex justify-center">
          <svg viewBox="0 0 200 135" className="w-full max-w-[200px]">
            <defs>
              <linearGradient id="fgiGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#f87171" />
                <stop offset="50%" stopColor="#facc15" />
                <stop offset="100%" stopColor="#34d399" />
              </linearGradient>
            </defs>
            <path d={describeArc(100, 120, 75, 0, 180)} stroke="url(#fgiGradient)" strokeWidth={14} fill="none" strokeLinecap="round" />
            <circle cx="100" cy="120" r="6" fill="#1f2937" stroke="#38bdf8" strokeWidth={3} />
            <line x1={pointerBase.x} y1={pointerBase.y} x2={pointerTip.x} y2={pointerTip.y} stroke="#38bdf8" strokeWidth={4} strokeLinecap="round" />
            <text x="100" y="62" textAnchor="middle" className="fill-gray-100" style={{ fontSize: 24, fontWeight: 700 }}>
              {scoreClamped != null ? Math.round(scoreClamped) : '--'}
            </text>
            <text x="100" y="82" textAnchor="middle" className="fill-gray-300" style={{ fontSize: 12, fontWeight: 600 }}>
              {scoreClamped != null ? currentLabel.label : '未取得'}
            </text>
            <text x="100" y="100" textAnchor="middle" className="fill-gray-400" style={{ fontSize: 11 }}>
              {delta != null ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} vs 前日` : '前日比データなし'}
            </text>
          </svg>
        </div>
        <div className="space-y-3 text-sm text-gray-400">
          <p>Fear &amp; Greed (CNN) を1時間ごとに取得し、S&amp;P500 と比較しています。</p>
          {spLatest.current != null && (
            <p className="text-xs text-gray-500">
              最新 S&amp;P500: <span className="text-gray-200 font-semibold">{spLatest.current.toFixed(2)}</span>
            </p>
          )}
          <div className="relative h-72">
            <div ref={containerRef} className="absolute inset-0" />
          </div>
        </div>
      </div>
    </div>
  );
}
