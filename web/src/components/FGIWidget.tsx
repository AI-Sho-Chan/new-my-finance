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

function normalizeSeries(series: SeriesPoint[]): SeriesPoint[] {
  if (!series.length) return series;
  let min = Infinity;
  let max = -Infinity;
  for (const p of series) {
    if (p.value < min) min = p.value;
    if (p.value > max) max = p.value;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return series.map((p) => ({ time: p.time, value: 50 }));
  }
  return series.map((p) => ({ time: p.time, value: ((p.value - min) / (max - min)) * 100 }));
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
  const [vixSeries, setVixSeries] = useState<SeriesPoint[]>([]);
  const [spLatest, setSpLatest] = useState<{ current: number | null; previous: number | null }>({ current: null, previous: null });
  const [vixLatest, setVixLatest] = useState<{ current: number | null; previous: number | null }>({ current: null, previous: null });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const fgiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const spSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const vixSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
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

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/yf/history?symbol=${encodeURIComponent('^VIX')}&interval=1d&range=1y`, { cache: 'no-store' });
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
        setVixSeries(points);
        setVixLatest(latestPair(points));
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

  const normalizedSp = useMemo(() => normalizeSeries(spSeries), [spSeries]);
  const normalizedVix = useMemo(() => normalizeSeries(vixSeries), [vixSeries]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof window === 'undefined') return;

    if (!chartRef.current) {
      const chart = createChart(container, {
        width: container.clientWidth,
        height: 260,
        layout: { background: { type: ColorType.Solid, color: '#111827' }, textColor: '#e5e7eb' },
        grid: { horzLines: { color: '#1f2937' }, vertLines: { color: '#1f2937' } },
        timeScale: { borderColor: '#374151', timeVisible: false, secondsVisible: false },
        rightPriceScale: { borderColor: '#374151', visible: true, autoScale: true },
      });
      chartRef.current = chart;
      fgiSeriesRef.current = chart.addLineSeries({ color: '#38bdf8', lineWidth: 2, priceScaleId: 'right' });
      spSeriesRef.current = chart.addLineSeries({ color: '#a78bfa', lineWidth: 1.5, priceScaleId: 'right' });
      vixSeriesRef.current = chart.addLineSeries({ color: '#f97316', lineWidth: 1.5, priceScaleId: 'right' });
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
      chart.timeScale().fitContent();
    }
    if (chart && spSeriesRef.current) {
      spSeriesRef.current.setData(normalizedSp);
    }
    if (chart && vixSeriesRef.current) {
      vixSeriesRef.current.setData(normalizedVix);
    }
  }, [chartData, normalizedSp, normalizedVix]);

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
    vixSeriesRef.current = null;
  }, []);

  const score = state.now;
  const prev = state.previousClose;
  const delta = score != null && prev != null ? score - prev : null;
  const scoreClamped = score != null ? clamp(score, 0, 100) : null;
  const currentLabel = LABELS.find((entry) => scoreClamped != null && scoreClamped <= entry.max) ?? LABELS[LABELS.length - 1];

  const gaugeAngle = scoreClamped != null ? scoreClamped * 2.4 - 120 : -120;
  const pointerLength = 48;
  const pointerBase = polarToCartesian(100, 110, 12, gaugeAngle + 180);
  const pointerTip = polarToCartesian(100, 110, pointerLength, gaugeAngle);

  const spChange = spLatest.current != null && spLatest.previous != null ? spLatest.current - spLatest.previous : null;
  const vixChange = vixLatest.current != null && vixLatest.previous != null ? vixLatest.current - vixLatest.previous : null;

  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-4">
      <h3 className="text-lg font-semibold text-gray-100 mb-4">Fear &amp; Greed インデックス</h3>
      <div className="grid gap-6 lg:grid-cols-[280px,1fr] items-center">
        <div className="flex justify-center">
          <svg viewBox="0 0 200 120" className="w-full max-w-xs">
            <defs>
              <linearGradient id="fgiGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#f87171" />
                <stop offset="50%" stopColor="#facc15" />
                <stop offset="100%" stopColor="#34d399" />
              </linearGradient>
            </defs>
            <path d={describeArc(100, 110, 90, -120, 120)} stroke="url(#fgiGradient)" strokeWidth={18} fill="none" strokeLinecap="round" />
            <circle cx="100" cy="110" r="8" fill="#1f2937" stroke="#38bdf8" strokeWidth={3} />
            <line x1={pointerBase.x} y1={pointerBase.y} x2={pointerTip.x} y2={pointerTip.y} stroke="#38bdf8" strokeWidth={5} strokeLinecap="round" />
            <text x="100" y="60" textAnchor="middle" className="fill-gray-100" style={{ fontSize: 28, fontWeight: 700 }}>
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
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border border-gray-700 bg-gray-800/80 p-3">
              <p className="text-xs text-gray-400">S&amp;P 500</p>
              <p className="text-lg font-semibold text-gray-100">{spLatest.current != null ? spLatest.current.toFixed(2) : '--'}</p>
              <p className={clsx('text-xs', spChange != null ? (spChange >= 0 ? 'text-emerald-400' : 'text-rose-400') : 'text-gray-400')}>
                {spChange != null ? `${spChange >= 0 ? '+' : ''}${spChange.toFixed(2)}` : '変化データなし'}
              </p>
            </div>
            <div className="rounded-lg border border-gray-700 bg-gray-800/80 p-3">
              <p className="text-xs text-gray-400">VIX</p>
              <p className="text-lg font-semibold text-gray-100">{vixLatest.current != null ? vixLatest.current.toFixed(2) : '--'}</p>
              <p className={clsx('text-xs', vixChange != null ? (vixChange >= 0 ? 'text-rose-400' : 'text-emerald-400') : 'text-gray-400')}>
                {vixChange != null ? `${vixChange >= 0 ? '+' : ''}${vixChange.toFixed(2)}` : '変化データなし'}
              </p>
            </div>
          </div>
          <div className="relative h-52">
            <div ref={containerRef} className="absolute inset-0" />
          </div>
        </div>
      </div>
    </div>
  );
}
