import { useEffect, useMemo, useRef, useState } from 'react';
import { ColorType, LineStyle, createChart, type IChartApi, type IPriceLine, type ISeriesApi } from 'lightweight-charts';

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
  { max: 75, label: '強欲', color: 'text-emerald-300' },
  { max: Infinity, label: '極度の強欲', color: 'text-emerald-400' },
];

const FETCH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const GAUGE_CENTER = 40;
const GAUGE_RADIUS = 34;
const GAUGE_PATH = `M ${GAUGE_CENTER - GAUGE_RADIUS} ${GAUGE_CENTER} A ${GAUGE_RADIUS} ${GAUGE_RADIUS} 0 0 1 ${GAUGE_CENTER + GAUGE_RADIUS} ${GAUGE_CENTER}`;
const GAUGE_CIRCUMFERENCE = Math.PI * GAUGE_RADIUS;
const PRICE_LEVELS = Array.from({ length: 11 }, (_, idx) => idx * 10);

function toSeries(points: unknown): SeriesPoint[] {
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function createGuideLines(series: ISeriesApi<'Line'>): IPriceLine[] {
  return PRICE_LEVELS.map((level) =>
    series.createPriceLine({
      price: level,
      color: 'rgba(148, 163, 184, 0.18)',
      lineWidth: level % 20 === 0 ? 2 : 1,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: true,
      title: '',
    }),
  );
}

export default function FGIWidget() {
  const [state, setState] = useState<FgiState>({ now: null, previousClose: null, history: [] });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const guideLinesRef = useRef<IPriceLine[]>([]);
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
        height: 320,
        layout: { background: { type: ColorType.Solid, color: '#111827' }, textColor: '#e5e7eb' },
        grid: { horzLines: { color: '#1f2937' }, vertLines: { color: '#1f2937' } },
        timeScale: { borderColor: '#374151', timeVisible: false, secondsVisible: false },
        rightPriceScale: { borderColor: '#374151', visible: true, scaleMargins: { top: 0.04, bottom: 0.04 }, alignLabels: true, ticksVisible: true },
        leftPriceScale: { borderColor: '#374151', visible: false },
      });
      chartRef.current = chart;

      const lineSeries = chart.addLineSeries({
        color: '#38bdf8',
        lineWidth: 2,
        priceScaleId: 'right',
        priceFormat: { type: 'custom', minMove: 1, formatter: (price) => `${Math.round(price)}` },
      });
      lineSeries.applyOptions({
        autoscaleInfoProvider: () => ({
          priceRange: { minValue: 0, maxValue: 100 },
        }),
      });
      seriesRef.current = lineSeries;
      guideLinesRef.current = createGuideLines(lineSeries);

      resizeRef.current = new ResizeObserver(([entry]) => {
        if (entry?.contentRect?.width && chartRef.current) {
          chartRef.current.applyOptions({ width: entry.contentRect.width });
        }
      });
      resizeRef.current.observe(container);
    }

    if (seriesRef.current) {
      seriesRef.current.setData(chartData);
    }
    chartRef.current?.timeScale().fitContent();
  }, [chartData]);

  useEffect(() => () => {
    resizeRef.current?.disconnect();
    if (seriesRef.current) {
      guideLinesRef.current.forEach((line) => {
        seriesRef.current?.removePriceLine(line);
      });
    }
    guideLinesRef.current = [];
    chartRef.current?.remove();
    chartRef.current = null;
    seriesRef.current = null;
  }, []);

  const score = state.now;
  const prev = state.previousClose;
  const delta = score != null && prev != null ? score - prev : null;
  const scoreClamped = score != null ? clamp(score, 0, 100) : null;
  const currentLabel = LABELS.find((entry) => scoreClamped != null && scoreClamped <= entry.max) ?? LABELS[LABELS.length - 1];
  const deltaClass = delta == null ? 'text-gray-500' : delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-rose-400' : 'text-gray-500';

  const progress = scoreClamped ?? 0;
  const dashOffset = GAUGE_CIRCUMFERENCE * (1 - progress / 100);

  return (
    <div className='rounded-lg border border-gray-800 bg-gray-900/60 p-4'>
      <h3 className='mb-4 text-lg font-semibold text-gray-100'>Fear &amp; Greed インデックス</h3>
      <div className='grid items-center gap-6 lg:grid-cols-[200px,1fr]'>
        <div className='relative flex justify-center'>
          <div className='relative h-32 w-32'>
            <svg viewBox='0 0 80 50' className='absolute inset-0 h-20 w-full'>
              <defs>
                <linearGradient id='fgiGaugeGradient' x1='0%' y1='0%' x2='100%' y2='0%'>
                  <stop offset='0%' stopColor='#f87171' />
                  <stop offset='50%' stopColor='#facc15' />
                  <stop offset='100%' stopColor='#34d399' />
                </linearGradient>
              </defs>
              <path d={GAUGE_PATH} stroke='#1f2937' strokeWidth={8} fill='none' strokeLinecap='round' />
              <path
                d={GAUGE_PATH}
                stroke='url(#fgiGaugeGradient)'
                strokeWidth={8}
                fill='none'
                strokeLinecap='round'
                style={{ strokeDasharray: GAUGE_CIRCUMFERENCE, strokeDashoffset: dashOffset }}
              />
            </svg>
            <div className='absolute inset-0 flex flex-col items-center justify-center pt-6'>
              <div className={`text-3xl font-bold ${currentLabel.color}`}>
                {scoreClamped != null ? Math.round(scoreClamped) : '--'}
              </div>
              <div className='text-xs text-gray-400'>{scoreClamped != null ? currentLabel.label : '未取得'}</div>
              <div className={`text-xs ${deltaClass}`}>
                {delta != null ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} vs 前日` : '前日比データなし'}
              </div>
            </div>
          </div>
        </div>
        <div className='space-y-3 text-sm text-gray-400'>
          <p>Fear &amp; Greed (CNN) を1時間ごとに取得し、指数の直近推移のみを表示しています。</p>
          <div className='relative h-64'>
            <div ref={containerRef} className='absolute inset-0' />
          </div>
        </div>
      </div>
    </div>
  );
}
