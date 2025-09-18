import { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, ColorType, LineStyle } from 'lightweight-charts';
import type { Candle, Timeframe } from '../types';
import { bollingerBands, fetchHistoricalCandles, movingAverage } from '../lib/data';

type Props = {
  symbol: string;
  open: boolean;
  onClose: () => void;
};

export default function StockChartModal({ symbol, open, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>('D');
  const [data, setData] = useState<Candle[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let mounted = true;
    setLoading(true);
    fetchHistoricalCandles(symbol, timeframe)
      .then((candles) => {
        if (!mounted) return;
        setData(candles);
      })
      .catch((err) => {
        console.warn('stock chart load failed', err);
        if (mounted) setData([]);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [symbol, timeframe, open]);

  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (!container || !data?.length) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(container, {
      width: container.clientWidth,
      height: 420,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: getComputedStyle(document.body).color },
      grid: { horzLines: { color: '#313131' }, vertLines: { color: '#313131' } },
      timeScale: { timeVisible: timeframe === 'D', secondsVisible: false, borderColor: '#666' },
      rightPriceScale: { borderColor: '#666' },
      crosshair: { mode: 1 },
    });
    chartRef.current = chart;

    const candleSeries = chart.addCandlestickSeries({ upColor: '#0ea5e9', downColor: '#ef4444', wickUpColor: '#0ea5e9', wickDownColor: '#ef4444' });
    candleSeries.setData(data);

    const ma50 = movingAverage(data, 50);
    const ma200 = movingAverage(data, 200);
    if (ma50.length) {
      const s50 = chart.addLineSeries({ color: '#22c55e', lineWidth: 2 });
      s50.setData(ma50);
    }
    if (ma200.length) {
      const s200 = chart.addLineSeries({ color: '#eab308', lineWidth: 2, lineStyle: LineStyle.Dotted });
      s200.setData(ma200);
    }

    const bb = bollingerBands(data, 20, 2);
    if (bb.length) {
      const upper = chart.addLineSeries({ color: 'rgba(148,163,184,0.8)', lineStyle: LineStyle.Dashed });
      const lower = chart.addLineSeries({ color: 'rgba(148,163,184,0.8)', lineStyle: LineStyle.Dashed });
      upper.setData(bb.map((x) => ({ time: x.time, value: x.upper })));
      lower.setData(bb.map((x) => ({ time: x.time, value: x.lower })));
    }

    const volumeSeries = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: '' });
    volumeSeries.setData(
      data.map((x) => ({
        time: x.time,
        value: x.value ?? 0,
        color: x.close >= x.open ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.5)',
      })),
    );

    chart.timeScale().fitContent();

    const handleResize = () => {
      chart.applyOptions({ width: container.clientWidth });
    };
    const ro = new ResizeObserver(handleResize);
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [data, timeframe, open]);

  const tfButtons: { key: Timeframe; label: string }[] = useMemo(
    () => [
      { key: 'D', label: '日足' },
      { key: 'W', label: '週足' },
      { key: 'M', label: '月足' },
    ],
    [],
  );

  if (!open) return null;

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/70' onClick={onClose}>
      <div className='flex h-3/4 w-11/12 max-w-4xl flex-col rounded-lg bg-gray-800 p-4 shadow-xl' onClick={(e) => e.stopPropagation()}>
        <div className='mb-2 flex items-center justify-between'>
          <h2 className='text-xl font-bold text-gray-100'>{symbol} チャート</h2>
          <div className='flex items-center gap-3'>
            <div className='flex items-center gap-1 rounded-md bg-gray-700 p-1'>
              {tfButtons.map((t) => (
                <button
                  key={t.key}
                  type='button'
                  onClick={() => setTimeframe(t.key)}
                  className={`px-3 py-1 text-sm font-semibold rounded ${timeframe === t.key ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <button type='button' onClick={onClose} className='text-2xl font-bold text-gray-400 transition-colors hover:text-white' aria-label='閉じる'>
              ×
            </button>
          </div>
        </div>
        <div className='relative flex-1' ref={containerRef}>
          {loading && (
            <div className='absolute inset-0 z-10 flex items-center justify-center bg-gray-800/80 backdrop-blur-sm'>
              <span className='mr-2 text-lg'>⏳</span>
              <span className='text-sm text-gray-300'>チャートデータ読み込み中...</span>
            </div>
          )}
          {!loading && (!data || data.length === 0) && (
            <div className='absolute inset-0 z-10 flex items-center justify-center text-sm text-gray-400'>
              データを取得できませんでした
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
