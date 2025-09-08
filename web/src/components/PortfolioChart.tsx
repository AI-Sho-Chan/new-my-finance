import { useEffect, useRef } from 'react';
import { createChart, ColorType } from 'lightweight-charts';

export default function PortfolioChart({ data }: { data: { time: number; total: number; cash: number; invest: number }[] }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const container = ref.current;
    container.innerHTML = '';
    const chart = createChart(container, {
      width: container.clientWidth,
      height: 260,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: getComputedStyle(document.body).color },
      rightPriceScale: { borderColor: '#666' },
      timeScale: { borderColor: '#666' },
    });
    const total = chart.addLineSeries({ color: '#3b82f6', lineWidth: 2 });
    const cash = chart.addLineSeries({ color: '#22c55e', lineWidth: 1 });
    const invest = chart.addLineSeries({ color: '#f59e0b', lineWidth: 1 });
    total.setData(data.map((d) => ({ time: d.time, value: d.total })));
    cash.setData(data.map((d) => ({ time: d.time, value: d.cash })));
    invest.setData(data.map((d) => ({ time: d.time, value: d.invest })));
    const ro = new ResizeObserver(() => chart.applyOptions({ width: container.clientWidth }));
    ro.observe(container);
    return () => { ro.disconnect(); chart.remove(); };
  }, [JSON.stringify(data)]);

  return <div ref={ref} className="w-full h-[260px]" />;
}

