import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { ColorType, createChart, type IChartApi, type ISeriesApi } from 'lightweight-charts';

interface FgiHistoryPoint {
  time: number;
  value: number;
}

interface FgiState {
  now: number | null;
  previousClose: number | null;
  history: FgiHistoryPoint[];
}

const LABELS = [
  { max: 25, label: '極度の恐怖', color: 'text-rose-400' },
  { max: 45, label: '恐怖', color: 'text-orange-400' },
  { max: 55, label: '中立', color: 'text-gray-300' },
  { max: 75, label: '貪欲', color: 'text-emerald-300' },
  { max: Infinity, label: '極度の貪欲', color: 'text-emerald-400' },
];

function normalizeFgiHistory(raw: any): FgiHistoryPoint[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const t = Number(entry?.t ?? entry?.time ?? entry?.timestamp ?? 0);
      const v = Number(entry?.v ?? entry?.value ?? entry?.score ?? entry?.y ?? entry?.close);
      if (!Number.isFinite(t) || !Number.isFinite(v)) return null;
      const time = t > 1e10 ? Math.floor(t / 1000) : Math.floor(t);
      return { time, value: v };
    })
    .filter((p): p is FgiHistoryPoint => Boolean(p))
    .sort((a, b) => a.time - b.time);
}

export default function FGIWidget() {
  const [state, setState] = useState<FgiState>({ now: null, previousClose: null, history: [] });
  const [spData, setSpData] = useState<FgiHistoryPoint[]>([]);
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
        let history = normalizeFgiHistory(json?.history);
        if (!history.length) {
          try {
            const fallback = await fetch(`/data/fgi/history.json?ts=${Date.now()}`, { cache: 'no-store' });
            if (fallback.ok) {
              const data = await fallback.json();
              if (!cancelled) history = normalizeFgiHistory(Array.isArray(data?.history) ? data.history : data);
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
    const id = window.setInterval(fetchFgi, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/yf/history?symbol=${encodeURIComponent('^GSPC')}&interval=1d&range=1y`, {
          cache: 'no-store',
        });
        if (!res.ok || !alive) return;
        const json = await res.json();
        if (!alive) return;
        const result = json?.chart?.result?.[0];
        const ts: number[] = Array.isArray(result?.timestamp) ? result.timestamp : [];
        const closes: number[] = Array.isArray(result?.indicators?.quote?.[0]?.close) ? result.indicators.quote[0].close : [];
        const points: FgiHistoryPoint[] = [];
        for (let i = 0; i < ts.length; i += 1) {
          const value = closes[i];
          if (Number.isFinite(ts[i]) && Number.isFinite(value)) {
            points.push({ time: Math.floor(ts[i]), value });
          }
        }
        setSpData(points);
      } catch {
        /* noop */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const chartData = useMemo(() => {
    const base = state.history;
    const now = state.now;
    if (base.length === 0) return [] as FgiHistoryPoint[];
    if (now == null || !Number.isFinite(now)) return base;
    const lastTime = base[base.length - 1]?.time ?? Math.floor(Date.now() / 1000);
    const nextTime = Math.max(lastTime + 60, Math.floor(Date.now() / 1000));
    return [...base, { time: nextTime, value: now }];
  }, [state.history, state.now]);

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
        rightPriceScale: { borderColor: '#374151' },
      });
      chartRef.current = chart;
      fgiSeriesRef.current = chart.addLineSeries({ color: '#38bdf8', lineWidth: 2 });
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
      if (chartData.length) {
        chart.timeScale().fitContent();
      }
    }

    if (chart && chartData.length === 0 && fgiSeriesRef.current) {
      fgiSeriesRef.current.setData([]);
    }

    if (chart && spData.length) {
      if (!spSeriesRef.current) {
        spSeriesRef.current = chart.addLineSeries({ color: '#a78bfa', lineWidth: 1.5, priceScaleId: 'left' });
        chart.applyOptions({
          leftPriceScale: { visible: true, borderColor: '#374151' },
          rightPriceScale: { visible: true, borderColor: '#374151' },
        });
      }
      spSeriesRef.current.setData(spData);
    }

    return () => {
      // No cleanup on every update
    };
  }, [chartData, spData]);

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

  const currentLabel = LABELS.find((entry) => state.now != null && state.now <= entry.max) ?? LABELS[LABELS.length - 1];
  const score = state.now;
  const prev = state.previousClose;
  const delta = score != null && prev != null ? score - prev : null;
  const prog = Math.max(0, Math.min(100, score ?? 0));
  const R = 34;
  const C = 2 * Math.PI * R;
  const dashOffset = C * (1 - prog / 100);

  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-4">
      <h3 className="text-lg font-semibold text-gray-100 mb-4">Fear &amp; Greed インデックス</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
        <div className="flex items-center justify-center">
          <div className="relative w-28 h-28">
            <svg viewBox="0 0 80 80" className="w-28 h-28">
              <circle cx="40" cy="40" r="34" fill="none" stroke="#1f2937" strokeWidth="8" />
              <circle
                cx="40"
                cy="40"
                r="34"
                fill="none"
                stroke="#38bdf8"
                strokeWidth="8"
                strokeDasharray={C}
                strokeDashoffset={dashOffset}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold text-gray-100">{score != null ? Math.round(score) : '--'}</span>
              <span className={clsx('text-xs font-semibold', score != null ? currentLabel.color : 'text-gray-400')}>
                {score != null ? currentLabel.label : '未取得'}
              </span>
            </div>
          </div>
        </div>
        <div className="space-y-2 text-sm text-gray-300">
          <div>
            <span className="text-gray-400">現在値:</span>
            <span className="ml-2 font-semibold text-gray-100">{score != null ? score.toFixed(1) : '--'}</span>
          </div>
          <div>
            <span className="text-gray-400">前日比:</span>
            <span className={clsx('ml-2 font-semibold', delta != null ? (delta >= 0 ? 'text-emerald-300' : 'text-rose-300') : 'text-gray-400')}>
              {delta != null ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}` : '--'}
            </span>
          </div>
          <div>
            <p className="text-xs text-gray-500 leading-relaxed">
              CNN Fear &amp; Greed Index を 5 分おきに取得し、S&amp;P500 (1年/日足) を重ねてトレンドを確認できます。
            </p>
          </div>
        </div>
        <div className="relative h-60 md:h-full">
          <div ref={containerRef} className="w-full h-full" />
        </div>
      </div>
    </div>
  );
}
