import { useEffect, useRef } from 'react';
import { createChart, ColorType } from 'lightweight-charts';

type SeriesPoint = { time: number; total: number; cash: number; invest: number };

const LEGEND_ITEMS = [
  { key: 'total', label: '総資産', color: '#3b82f6' },
  { key: 'cash', label: '現金資産', color: '#22c55e' },
  { key: 'invest', label: '投資資産', color: '#f59e0b' },
];

export default function PortfolioChart({ data }: { data: SeriesPoint[] }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const container = ref.current;
    container.innerHTML = '';

    const formatJPY = (value: number) => {
      const safe = Number.isFinite(value) ? Math.round(value) : 0;
      return safe.toLocaleString('ja-JP');
    };

    const textColor = getComputedStyle(document.body).color || '#d1d5db';
    const chart = createChart(container, {
      width: container.clientWidth,
      height: 260,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor,
      },
      rightPriceScale: { borderColor: '#666', textColor },
      timeScale: { borderColor: '#666' },
      localization: { priceFormatter: (value: number) => `${formatJPY(value)} 円`, locale: 'ja-JP' },
    });

    const priceFormat = {
      type: 'price' as const,
      precision: 0,
      minMove: 1,
    };

    const total = chart.addLineSeries({ color: '#3b82f6', lineWidth: 2, priceFormat });
    const cash = chart.addLineSeries({ color: '#22c55e', lineWidth: 1, priceFormat });
    const invest = chart.addLineSeries({ color: '#f59e0b', lineWidth: 1, priceFormat });

    const fallbackPoint = { time: Math.floor(Date.now() / 1000), total: 0, cash: 0, invest: 0 };
    const baseData = data.length ? data : [fallbackPoint];
    const seriesData = baseData.map((d) => ({
      time: d.time,
      total: Number.isFinite(d.total) ? d.total : 0,
      cash: Number.isFinite(d.cash) ? d.cash : 0,
      invest: Number.isFinite(d.invest) ? d.invest : 0,
    }));

    total.setData(seriesData.map((d) => ({ time: d.time, value: d.total })));
    cash.setData(seriesData.map((d) => ({ time: d.time, value: d.cash })));
    invest.setData(seriesData.map((d) => ({ time: d.time, value: d.invest })));

    const ro = new ResizeObserver(() => chart.applyOptions({ width: container.clientWidth }));
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [JSON.stringify(data)]);

  return (
    <div className="relative">
      <div className="absolute right-4 top-3 z-10 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-300">
        {LEGEND_ITEMS.map((item) => (
          <div key={item.key} className="flex items-center gap-2">
            <span
              className="inline-flex h-2 w-2 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            <span>{item.label}</span>
          </div>
        ))}
      </div>
      <div ref={ref} className="w-full h-[260px]" />
    </div>
  );
}



