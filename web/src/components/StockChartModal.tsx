import { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, ColorType, LineStyle, type ISeriesApi } from 'lightweight-charts';
import type { Candle, Timeframe } from '../types';
import { bollingerBands, fetchHistoricalCandles, movingAverage } from '../lib/data';

type Props = {
  symbol: string;
  open: boolean;
  onClose: () => void;
};

export default function StockChartModal({ symbol, open, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>('D');
  const [data, setData] = useState<Candle[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let mounted = true;
    setLoading(true);
    fetchHistoricalCandles(symbol, timeframe).then((candles) => {
      if (!mounted) return;
      setData(candles);
      setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, [symbol, timeframe, open]);

  useEffect(() => {
    if (!open) return;
    if (!containerRef.current) return;
    if (!data) return;

    // Ensure clean mount per open/data change
    const container = containerRef.current;
    container.innerHTML = '';

    const chart = createChart(container, {
      width: container.clientWidth,
      height: 420,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: getComputedStyle(document.body).color },
      grid: { horzLines: { color: '#313131' }, vertLines: { color: '#313131' } },
      timeScale: { timeVisible: timeframe === 'D', secondsVisible: false, borderColor: '#666' },
      rightPriceScale: { borderColor: '#666' },
      crosshair: { mode: 1 },
    });

    const candleSeries = chart.addCandlestickSeries({ upColor: '#0ea5e9', downColor: '#ef4444', wickUpColor: '#0ea5e9', wickDownColor: '#ef4444' });
    candleSeries.setData(data);

    // 50/200 MA
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

    // Bollinger Bands
    const bb = bollingerBands(data, 20, 2);
    if (bb.length) {
      const upper = chart.addLineSeries({ color: 'rgba(148,163,184,0.8)', lineStyle: LineStyle.Dashed });
      const lower = chart.addLineSeries({ color: 'rgba(148,163,184,0.8)', lineStyle: LineStyle.Dashed });
      upper.setData(bb.map((x) => ({ time: x.time, value: x.upper })));
      lower.setData(bb.map((x) => ({ time: x.time, value: x.lower })));
    }

    // Volume (separate overlay)
    const vol = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: '' });
    vol.setData(data.map((x) => ({ time: x.time, value: x.value ?? 0, color: (x.close >= x.open ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.5)') })));

    const handleResize = () => {
      chart.applyOptions({ width: container.clientWidth });
    };
    const ro = new ResizeObserver(handleResize);
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [data, timeframe, open]);

  const tfButtons: { key: Timeframe; label: string }[] = useMemo(() => [
    { key: 'D', label: '日足' },
    { key: 'W', label: '週足' },
    { key: 'M', label: '月足' },
  ], []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-gray-800 rounded-lg shadow-xl w-11/12 max-w-4xl h-3/4 p-4 flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-xl font-bold">{symbol} チャート</h2>
          <div className="flex items-center">
            <div className="bg-gray-700 rounded-md p-1 flex space-x-1 mr-4">
              {tfButtons.map((t) => (
                <button key={t.key} onClick={() => setTimeframe(t.key)}
                  className={`px-3 py-1 text-sm font-semibold rounded ${timeframe === t.key ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`}>
                  {t.label}
                </button>
              ))}
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl font-bold">×</button>
          </div>
        </div>
        <div className="w-full flex-grow relative" ref={containerRef}>
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-800 bg-opacity-80 z-10">
              <span className="mr-2">⏳</span><span className="text-gray-300">チャートデータ読み込み中...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
