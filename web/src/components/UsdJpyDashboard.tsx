import { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, ColorType, CrosshairMode, LineStyle } from 'lightweight-charts';
import type { IChartApi, HistogramData, LineData, SeriesMarker, Time } from 'lightweight-charts';

type MacroResp = {
  policyRate: number | null;
  policyRateText?: string | null;
  policyDate?: string | null;
  policySource?: string | null;
  cpiYoY: number | null; // %
  cpiDate?: string | null;
  cpiSource?: string | null;
  updatedAt: number | null;
  source?: string;
};

type HistoryPoint = {
  date: string;
  actual: number | null;
  theoretical: number | null;
  diffPct: number | null;
};

interface HistoryResponse {
  history: HistoryPoint[];
  meta?: {
    start?: string | null;
    end?: string | null;
    months?: number | null;
    sources?: Record<string, string | null>;
    updatedAt?: number | null;
  } | null;
}

type SourceStatus = 'LIVE' | 'ERROR';

const LONG_TERM_YEARS = 1;
const LONG_TERM_TRADING_DAYS = 252;
const LONG_TERM_LABEL_SHORT = `${LONG_TERM_YEARS}y`;
const LONG_TERM_LABEL_FULL = `${LONG_TERM_YEARS}-year`;

// Trend visualization params (months and flat threshold in z-scores)
const TREND_WINDOW_MONTHS = 6;
const TREND_FLAT_Z = 0.25;

export default function UsdJpyDashboard() {

  const [rate, setRate] = useState<number | null>(null);
  const [rateStatus, setRateStatus] = useState<SourceStatus>('ERROR');
  const [rateUpdatedAt, setRateUpdatedAt] = useState<number | null>(null);

  const [usMacro, setUsMacro] = useState<MacroResp | null>(null);
  const [usStatus, setUsStatus] = useState<SourceStatus>('ERROR');

  const [jpMacro, setJpMacro] = useState<MacroResp | null>(null);
  const [jpStatus, setJpStatus] = useState<SourceStatus>('ERROR');

  const [lastAnalysisAt, setLastAnalysisAt] = useState<number | null>(null);

  const [history, setHistory] = useState<HistoryPoint[] | null>(null);
  const [historyMeta, setHistoryMeta] = useState<HistoryResponse['meta']>(null);
  const [historyStatus, setHistoryStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const fast = useMemo(() => {
    try { return ['1','true','yes'].includes((new URLSearchParams(window.location.search).get('fast')||'').toLowerCase()); } catch { return false; }
  }, []);
  const UPDATE_INTERVAL = fast ? 15_000 : 60 * 60_000;

  const prevOkRef = useRef<{ rate?: number; us?: MacroResp; jp?: MacroResp }>({});

  const isFiniteNumber = (value: number | null | undefined): value is number =>
    typeof value === 'number' && Number.isFinite(value);

  const analysis = useMemo(() => {
    if (rate == null || !Number.isFinite(rate)) return null;
    const usReal = (usMacro?.policyRate ?? null) != null && (usMacro?.cpiYoY ?? null) != null ? (usMacro!.policyRate! - usMacro!.cpiYoY!) : null;
    const jpReal = (jpMacro?.policyRate ?? null) != null && (jpMacro?.cpiYoY ?? null) != null ? (jpMacro!.policyRate! - jpMacro!.cpiYoY!) : null;
    if (usReal == null || jpReal == null) return null;
    const diff = usReal - jpReal; // % points
    const theoretical = 120 + 15 * diff;
    const sigma = 8.5;
    const upper = theoretical + sigma;
    const lower = theoretical - sigma;
    let action: 'buy' | 'sell' | 'wait' = 'wait';
    let valuation: string;
    if (rate > upper) { action = 'sell'; valuation = `Overvalued (upper band: ${upper.toFixed(2)})`; }
    else if (rate < lower) { action = 'buy'; valuation = `Undervalued (lower band: ${lower.toFixed(2)})`; }
    else { action = 'wait'; valuation = 'Within theoretical band'; }

    // Short/Medium/Long projections (MVP)
    // Mean reversion to theoretical with half-life = 10 days
    const halfLife = 10; // trading days
    const k = Math.log(2) / halfLife;
    const proj = (hDays: number) => theoretical + (rate - theoretical) * Math.exp(-k * hDays);
    const short10d = proj(10);
    const medium6m = theoretical; // simple MVP
    const longTerm = proj(LONG_TERM_TRADING_DAYS);

    return { rate, diff, theoretical, valuation, action, short10d, medium6m, longTerm };
  }, [rate, usMacro, jpMacro]);

  const correlation = useMemo(() => {
    if (!history || history.length < 2) return null;
    const pairs = history.filter((point) =>
      isFiniteNumber(point.actual ?? null) && isFiniteNumber(point.theoretical ?? null)
    );
    if (pairs.length < 2) return null;
    const actuals = pairs.map((p) => p.actual!);
    const theoreticals = pairs.map((p) => p.theoretical!);
    const meanActual = actuals.reduce((acc, val) => acc + val, 0) / actuals.length;
    const meanTheo = theoreticals.reduce((acc, val) => acc + val, 0) / theoreticals.length;
    let cov = 0;
    let varActual = 0;
    let varTheo = 0;
    for (let i = 0; i < pairs.length; i += 1) {
      const da = actuals[i] - meanActual;
      const dt = theoreticals[i] - meanTheo;
      cov += da * dt;
      varActual += da * da;
      varTheo += dt * dt;
    }
    if (varActual === 0 || varTheo === 0) return null;
    return cov / Math.sqrt(varActual * varTheo);
  }, [history]);

  // Compute theoretical trend classification series (Up/Flat/Down)
  const trendInfo = useMemo(() => {
    if (!history || history.length === 0) return null as null | {
      windowMonths: number;
      thr: number | null;
      series: { date: string; cls: -1 | 0 | 1 }[];
      lastClass: -1 | 0 | 1 | null;
    };

    const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
    const theoSeries = sorted
      .filter((p) => typeof p.theoretical === 'number' && Number.isFinite(p.theoretical as number))
      .map((p) => ({ date: p.date, value: p.theoretical as number }));

    if (theoSeries.length < TREND_WINDOW_MONTHS + 2) {
      return { windowMonths: TREND_WINDOW_MONTHS, thr: null, series: [], lastClass: null };
    }

    // Differences over the window
    const diffs: number[] = [];
    for (let i = TREND_WINDOW_MONTHS; i < theoSeries.length; i += 1) {
      diffs.push(theoSeries[i].value - theoSeries[i - TREND_WINDOW_MONTHS].value);
    }
    const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    const variance = diffs.reduce((a, d) => a + (d - mean) * (d - mean), 0) / diffs.length;
    const sigma = Math.sqrt(variance);
    const thr = sigma * TREND_FLAT_Z;

    const series: { date: string; cls: -1 | 0 | 1 }[] = [];
    for (let i = 0; i < theoSeries.length; i += 1) {
      if (i < TREND_WINDOW_MONTHS) continue;
      const delta = theoSeries[i].value - theoSeries[i - TREND_WINDOW_MONTHS].value;
      let cls: -1 | 0 | 1 = 0;
      if (Math.abs(delta) > thr) cls = delta > 0 ? 1 : -1;
      series.push({ date: theoSeries[i].date, cls });
    }
    const lastClass = series.length ? series[series.length - 1].cls : null;
    return { windowMonths: TREND_WINDOW_MONTHS, thr, series, lastClass };
  }, [history]);

  useEffect(() => {
    let cancelled = false;
    const fetchAll = async () => {
      try {
        // USDJPY (Yahoo quote via backend)
        try {
          const r = await fetch('/api/quote?symbols=USDJPY=X');
          const json = await r.json();
          const q = json['USDJPY=X'] || Object.values(json)[0];
          const val = Number(q?.price ?? q?.regularMarketPrice ?? null);
          if (Number.isFinite(val)) {
            if (!cancelled) { setRate(val); setRateStatus('LIVE'); setRateUpdatedAt(Date.now()); prevOkRef.current.rate = val; }
          } else {
            throw new Error('invalid quote');
          }
        } catch {
          // fallback to previous
          if (prevOkRef.current.rate != null && !cancelled) { setRate(prevOkRef.current.rate!); setRateStatus('ERROR'); }
        }

        // US macro
        try {
          const r = await fetch('/api/macro/us');
          if (r.ok) {
            const json: MacroResp = await r.json();
            if (!cancelled) { setUsMacro(json); setUsStatus('LIVE'); prevOkRef.current.us = json; }
          } else { throw new Error('macro/us non-200'); }
        } catch {
          const fallback: MacroResp = { policyRate: 5.25, policySource: 'fallback', policyDate: null, cpiYoY: 3.0, cpiSource: 'fallback', cpiDate: null, updatedAt: Date.now(), source: 'fallback' };
          if (!cancelled) { setUsMacro(prevOkRef.current.us ?? fallback); setUsStatus('ERROR'); }
        }

        // JP macro
        try {
          const r = await fetch('/api/macro/jp');
          if (r.ok) {
            const json: MacroResp = await r.json();
            if (!cancelled) { setJpMacro(json); setJpStatus('LIVE'); prevOkRef.current.jp = json; }
          } else { throw new Error('macro/jp non-200'); }
        } catch {
          const fallback: MacroResp = { policyRate: 0.1, policySource: 'fallback', policyDate: null, cpiYoY: 2.8, cpiSource: 'fallback', cpiDate: null, updatedAt: Date.now(), source: 'fallback' };
          if (!cancelled) { setJpMacro(prevOkRef.current.jp ?? fallback); setJpStatus('ERROR'); }
        }

        if (!cancelled) setLastAnalysisAt(Date.now());
      } catch {}
    };

    fetchAll();
    const id = window.setInterval(fetchAll, UPDATE_INTERVAL);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [UPDATE_INTERVAL]);

  useEffect(() => {
    let cancelled = false;
    const loadHistory = async () => {
      try {
        setHistoryStatus('loading');
        const res = await fetch('/api/usdjpy/history');
        if (!res.ok) throw new Error('history non-200');
        const json: HistoryResponse = await res.json();
        if (cancelled) return;
        setHistory(Array.isArray(json.history) ? json.history : []);
        setHistoryMeta(json.meta ?? null);
        setHistoryStatus('ready');
      } catch {
        if (!cancelled) {
          setHistory(null);
          setHistoryMeta(null);
          setHistoryStatus('error');
        }
      }
    };
    loadHistory();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (historyStatus !== 'ready') return;
    const container = chartContainerRef.current;
    if (!container) return;
    if (!history || history.length === 0) return;

    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect();
      resizeObserverRef.current = null;
    }
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(container, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#0f172a' }, textColor: '#e2e8f0' },
      rightPriceScale: { borderVisible: false },
      leftPriceScale: { visible: true, borderColor: '#1f2937', scaleMargins: { top: 0.8, bottom: 0 } },
      timeScale: { borderColor: '#1f2937', rightOffset: 2 },
      crosshair: { mode: CrosshairMode.Normal },
    });
    chartRef.current = chart;

    const sortedHistory = [...history].sort((a, b) => a.date.localeCompare(b.date));

    const actualSeries = chart.addLineSeries({
      color: '#38bdf8',
      lineWidth: 2,
      priceScaleId: 'right',
    });
    const actualData: LineData[] = sortedHistory
      .filter((point) => isFiniteNumber(point.actual))
      .map((point) => ({ time: toTime(point.date), value: round2(point.actual!) }));
    actualSeries.setData(actualData);

    const theoreticalSeries = chart.addLineSeries({
      color: '#f97316',
      lineWidth: 2,
      priceScaleId: 'right',
    });

    const theoreticalMap = new Map<string, number>();
    sortedHistory.forEach((point) => {
      if (isFiniteNumber(point.theoretical)) {
        theoreticalMap.set(point.date, round2(point.theoretical!));
      }
    });

    const now = new Date();
    const nowDate = formatISODate(now);

    if (analysis) {
      if (isFiniteNumber(analysis.theoretical)) theoreticalMap.set(nowDate, round2(analysis.theoretical));
      if (isFiniteNumber(analysis.short10d)) theoreticalMap.set(formatISODate(addDays(now, 14)), round2(analysis.short10d));
      if (isFiniteNumber(analysis.medium6m)) theoreticalMap.set(formatISODate(addMonths(now, 6)), round2(analysis.medium6m));
    }

    const theoreticalData: LineData[] = Array.from(theoreticalMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ time: toTime(date), value }));
    theoreticalSeries.setData(theoreticalData);

    // Replace diff% histogram with model trend classification (Up/Flat/Down)
    const trendSeries = chart.addHistogramSeries({
      priceScaleId: 'left',
      base: 0,
      priceFormat: { type: 'price', precision: 0, minMove: 1 },
      scaleMargins: { top: 0.9, bottom: 0 },
    });
    const trendData: HistogramData[] = (trendInfo?.series || []).map((entry) => ({
      time: toTime(entry.date),
      value: entry.cls, // +1/-1/0
      color: entry.cls > 0 ? '#22c55faa' : entry.cls < 0 ? '#ef4444aa' : '#9ca3afaa',
    }));
    trendSeries.setData(trendData);

    const forecastSeries = chart.addLineSeries({
      color: '#a855f7',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceScaleId: 'right',
    });

    const forecastData: LineData[] = [];
    if (analysis?.longTerm && isFiniteNumber(analysis.longTerm)) {
      const longDate = formatISODate(addYears(now, LONG_TERM_YEARS));
      let baseDate = nowDate;
      let baseValue = theoreticalMap.get(baseDate) ?? null;
      if (!isFiniteNumber(baseValue) && theoreticalData.length > 0) {
        const lastPoint = theoreticalData[theoreticalData.length - 1];
        const lastTime = typeof lastPoint.time === 'string' ? lastPoint.time : baseDate;
        baseDate = lastTime;
        baseValue = lastPoint.value;
      }
      if (isFiniteNumber(baseValue)) {
        forecastData.push({ time: toTime(baseDate), value: round2(baseValue) });
        forecastData.push({ time: toTime(longDate), value: round2(analysis.longTerm) });
      }
    }
    forecastSeries.setData(forecastData);

    const markers: SeriesMarker<Time>[] = [];
    if (analysis) {
      if (isFiniteNumber(analysis.short10d)) {
        markers.push({
          time: toTime(formatISODate(addDays(now, 14))),
          position: 'aboveBar',
          color: '#f97316',
          shape: 'arrowUp',
          text: 'Short-term (10d)',
        });
      }
      if (isFiniteNumber(analysis.medium6m)) {
        markers.push({
          time: toTime(formatISODate(addMonths(now, 6))),
          position: 'aboveBar',
          color: '#f97316',
          shape: 'arrowUp',
          text: 'Medium-term (6m)',
        });
      }
      if (analysis.longTerm && isFiniteNumber(analysis.longTerm)) {
        markers.push({
          time: toTime(formatISODate(addYears(now, LONG_TERM_YEARS))),
          position: 'aboveBar',
          color: '#a855f7',
          shape: 'arrowDown',
          text: `Long-term (${LONG_TERM_LABEL_SHORT})`,
        });
      }
    }
    theoreticalSeries.setMarkers(markers);

    chart.timeScale().fitContent();

    const resizeObserver = new ResizeObserver(() => {
      chart.timeScale().fitContent();
    });
    resizeObserver.observe(container);
    resizeObserverRef.current = resizeObserver;

    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      chart.remove();
      chartRef.current = null;
    };
  }, [historyStatus, history, analysis, trendInfo]);

  const allLive = rateStatus === 'LIVE' && usStatus === 'LIVE' && jpStatus === 'LIVE';

  const fmtTime = (ts: number | null) => (ts ? new Date(ts).toLocaleTimeString('ja-JP') : '--:--:--');
  const fmtPct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '--' : `${v.toFixed(2)} %`);
  const fmt = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '---.--' : v.toFixed(2));
  const fmtCorr = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '--' : v.toFixed(3));
  const fmtDate = (iso: string | null | undefined) => {
    if (!iso) return '--';
    try {
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return iso;
      return date.toLocaleDateString('ja-JP');
    } catch {
      return iso;
    }
  };
  const fmtSourceLabel = (src: string | null | undefined) => (src && src.trim().length > 0 ? src : 'N/A');
  const badgeClass = (status: SourceStatus) => (status === 'LIVE' ? 'bg-green-900 text-green-300' : 'bg-yellow-900 text-yellow-300');
  const badgeText = (status: SourceStatus, macro?: MacroResp | null) => {
    if (status === 'LIVE') return macro?.source ? `LIVE (${macro.source})` : 'LIVE';
    return macro?.source === 'fallback' ? 'Fallback' : 'Check required';
  };
  const trendClassLabel = (c: -1 | 0 | 1 | null | undefined) => (c == null ? '--' : c > 0 ? 'Uptrend' : c < 0 ? 'Downtrend' : 'Flat');
  const trendClassColor = (c: -1 | 0 | 1 | null | undefined) => (c == null ? 'text-gray-400' : c > 0 ? 'text-green-400' : c < 0 ? 'text-red-400' : 'text-gray-400');
  const formatISODate = (date: Date) => date.toISOString().slice(0, 10);
  const addDays = (date: Date, days: number) => { const d = new Date(date); d.setDate(d.getDate() + days); return d; };
  const addMonths = (date: Date, months: number) => { const d = new Date(date); d.setMonth(d.getMonth() + months); return d; };
  const addYears = (date: Date, years: number) => { const d = new Date(date); d.setFullYear(d.getFullYear() + years); return d; };
  const toTime = (date: string): Time => date as unknown as Time;
  const round2 = (value: number) => Math.round(value * 100) / 100;


  return (
    <div className="container mx-auto p-4 md:p-6 max-w-6xl">
      <header className="mb-6 text-center">
        <h1 className="text-3xl md:text-4xl font-bold text-white">USDJPY Macro Dashboard</h1>
        <div id="status-bar" className={`mt-2 inline-flex items-center text-sm font-medium px-3 py-1 rounded-full ${allLive ? 'bg-green-900 text-green-300' : 'bg-yellow-900 text-yellow-300'}`}>
          <span id="status-indicator" className={`w-2 h-2 mr-2 rounded-full ${allLive ? 'bg-green-400' : 'bg-yellow-400'}`}></span>
          <span id="status-text">{allLive ? 'All sources healthy' : 'Check data sources'}</span>
        </div>
      </header>

      {/* Data Source Status */}
      <section className="mb-6">
        <h2 className="text-xl font-semibold mb-3 text-gray-300">Data Source Status</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="card bg-gray-800 border border-gray-700 rounded-xl p-3">
            <p className="text-sm text-gray-400">USD/JPY spot</p>
            <p className={`font-bold text-lg ${rateStatus==='LIVE'?'text-green-400': 'text-yellow-400'}`}>{rateStatus==='LIVE'?'LIVE':'Fallback/Check'}</p>
            <p className="text-xs text-gray-500">{fmtTime(rateUpdatedAt)}</p>
          </div>
          <div className="card bg-gray-800 border border-gray-700 rounded-xl p-3">
            <p className="text-sm text-gray-400">US macro feed</p>
            <p className={`font-bold text-lg ${usStatus==='LIVE'?'text-green-400': 'text-yellow-400'}`}>{usStatus==='LIVE'?'LIVE':'Fallback/Check'}</p>
            <p className="text-xs text-gray-500">{fmtTime(usMacro?.updatedAt ?? null)}</p>
          </div>
          <div className="card bg-gray-800 border border-gray-700 rounded-xl p-3">
            <p className="text-sm text-gray-400">Japan macro feed</p>
            <p className={`font-bold text-lg ${jpStatus==='LIVE'?'text-green-400': 'text-yellow-400'}`}>{jpStatus==='LIVE'?'LIVE':'Fallback/Check'}</p>
            <p className="text-xs text-gray-500">{fmtTime(jpMacro?.updatedAt ?? null)}</p>
          </div>
          <div className="card bg-gray-800 border border-gray-700 rounded-xl p-3">
            <p className="text-sm text-gray-400">Last analysis</p>
            <p className="font-bold text-lg text-white">{fmtTime(lastAnalysisAt)}</p>
            <p className="text-xs text-gray-500">Auto-refresh summary</p>
          </div>
        </div>
      </section>

      {/* Macro Inputs from FRED */}
      <section className="mb-6">
        <h2 className="text-xl font-semibold mb-3 text-gray-300">Macro Inputs</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="card bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-200">United States</h3>
              <span className={`text-xs font-semibold px-2 py-1 rounded-full ${badgeClass(usStatus)}`}>{badgeText(usStatus, usMacro)}</span>
            </div>
            <dl className="space-y-2 text-sm text-gray-300">
              <div className="flex justify-between">
                <dt className="text-gray-400">Policy rate</dt>
                <dd className="font-mono text-base text-white">{usMacro?.policyRateText ?? fmtPct(usMacro?.policyRate ?? null)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-400">Inflation (YoY)</dt>
                <dd className="font-mono text-base text-white">{fmtPct(usMacro?.cpiYoY ?? null)}</dd>
              </div>
            </dl>
            <div className="text-xs text-gray-500 space-y-1">
              <p>Policy rate source: {fmtSourceLabel(usMacro?.policySource)}</p>
              <p>Inflation source: {fmtSourceLabel(usMacro?.cpiSource)}</p>
              <p>Policy rate date: {fmtDate(usMacro?.policyDate ?? null)}</p>
              <p>Inflation date: {fmtDate(usMacro?.cpiDate ?? null)}</p>
            </div>
          </div>
          <div className="card bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-200">Japan</h3>
              <span className={`text-xs font-semibold px-2 py-1 rounded-full ${badgeClass(jpStatus)}`}>{badgeText(jpStatus, jpMacro)}</span>
            </div>
            <dl className="space-y-2 text-sm text-gray-300">
              <div className="flex justify-between">
                <dt className="text-gray-400">Policy rate</dt>
                <dd className="font-mono text-base text-white">{jpMacro?.policyRateText ?? fmtPct(jpMacro?.policyRate ?? null)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-400">Inflation (YoY)</dt>
                <dd className="font-mono text-base text-white">{fmtPct(jpMacro?.cpiYoY ?? null)}</dd>
              </div>
            </dl>
            <div className="text-xs text-gray-500 space-y-1">
              <p>Policy rate source: {fmtSourceLabel(jpMacro?.policySource)}</p>
              <p>Inflation source: {fmtSourceLabel(jpMacro?.cpiSource)}</p>
              <p>Policy rate date: {fmtDate(jpMacro?.policyDate ?? null)}</p>
              <p>Inflation date: {fmtDate(jpMacro?.cpiDate ?? null)}</p>
            </div>
          </div>
        </div>
      </section>

      {/* USDJPY Macro Chart */}
      <section className="card bg-gray-800 border border-gray-700 rounded-xl p-5 mb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-3">
          <h2 className="text-xl font-semibold text-gray-300">USDJPY Fair Value Model</h2>
          {historyMeta?.start && historyMeta?.end ? (
            <span className="text-xs text-gray-500">{historyMeta.start} ??{historyMeta.end}</span>
          ) : null}
        </div>
        {historyStatus === 'loading' || historyStatus === 'idle' ? (
          <div className="h-80 flex items-center justify-center text-gray-400 text-sm">Loading history...</div>
        ) : historyStatus === 'error' ? (
          <div className="h-80 flex items-center justify-center text-red-400 text-sm">Failed to load history</div>
        ) : (
          <div ref={chartContainerRef} className="w-full h-[320px] md:h-[420px]" />
        )}
        <p className="text-xs text-gray-500 mt-3">???? ????????/ ???? ?????????/ ?? ?????/ ?????? ??????????</p>
      </section>

      {/* Core Analysis & Action Plan */}
      <section className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card bg-gray-800 border border-gray-700 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-4 text-gray-300">???????</h2>
          <div className="space-y-4">
            <div className="flex justify-between items-baseline">
              <span className="text-gray-400">Spot rate (USD/JPY):</span>
              <span id="current-rate-value" className="font-mono text-2xl font-bold text-white">{fmt(rate)}</span>
            </div>
            <hr className="border-gray-600" />
            <div className="flex justify-between items-baseline">
              <span className="text-gray-400">Real rate spread:</span>
              <span id="diff-value" className="font-mono text-2xl font-bold text-white">{fmtPct(analysis?.diff ?? null)}</span>
            </div>
            <hr className="border-gray-600" />
            <div className="flex justify-between items-baseline">
              <span className="text-gray-400">Theoretical value (model):</span>
              <span id="theoretical-rate-value" className="font-mono text-2xl font-bold text-indigo-400">{fmt(analysis?.theoretical ?? null)}</span>
            </div>
            <div className="flex justify-between items-baseline">
              <span className="text-gray-400">Correlation (actual vs model):</span>
              <span className="font-mono text-xl text-gray-100">{fmtCorr(correlation)}</span>
            </div>
            <div className="flex justify-between items-baseline">
              <span className="text-gray-400">Model trend ({TREND_WINDOW_MONTHS}m):</span>
              <span className={`font-mono text-xl ${trendClassColor(trendInfo?.lastClass)}`}>{trendClassLabel(trendInfo?.lastClass)}</span>
            </div>
            <div className="text-center pt-2">
              <p id="valuation-text" className="text-lg font-semibold text-gray-300">{analysis?.valuation ?? 'Calculating...'}</p>
            </div>

            {/* Projections */}
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div className="rounded border border-gray-700 p-3 bg-gray-800/60">
                <div className="text-gray-400">10-day projection</div>
                <div className="font-mono text-xl text-gray-100">{fmt(analysis?.short10d)}</div>
              </div>
              <div className="rounded border border-gray-700 p-3 bg-gray-800/60">
                <div className="text-gray-400">6-month projection</div>
                <div className="font-mono text-xl text-gray-100">{fmt(analysis?.medium6m)}</div>
              </div>
              <div className="rounded border border-gray-700 p-3 bg-gray-800/60">
                <div className="text-gray-400">{`${LONG_TERM_LABEL_FULL} projection`}</div>
                <div className="font-mono text-xl text-gray-100">{fmt(analysis?.longTerm ?? null)}</div>
              </div>
            </div>
          </div>
        </div>
        <div id="action-card" className={`card bg-gray-800 border border-gray-700 rounded-xl p-6 flex flex-col justify-center items-center border-l-4 ${analysis?.action==='sell'?'border-red-500': analysis?.action==='buy'?'border-green-500':'border-blue-500'}`}>
          <div id="action-icon" className="text-6xl mb-2">{analysis?.action==='sell'?'SELL': analysis?.action==='buy'?'BUY':'HOLD'}</div>
          <h2 id="action-title" className="text-2xl font-bold text-white">{analysis?.action==='sell'?'Sell signal': analysis?.action==='buy'?'Buy signal':'Neutral'}</h2>
          <p id="action-details" className="text-center text-gray-400 mt-1">
            {analysis?.action==='sell'?'Spot trades above the upper band; consider trimming exposure.': analysis?.action==='buy'?'Spot trades below the lower band; consider adding exposure.':'Spot is within the neutral band; patience is recommended.'}
          </p>
        </div>
      </section>

      {/* Live Mode Guide */}
      <section className="mt-8">
        <details className="card bg-gray-800 border border-gray-700 rounded-xl p-4">
          <summary className="cursor-pointer font-bold text-lg text-gray-200">Live Mode Guide</summary>
          <div className="mt-4 pt-4 border-t border-gray-600 text-gray-400 space-y-3 text-sm">
            <p>We load data server-side to avoid CORS issues. USD/JPY uses Yahoo Finance, policy rates use FRED, and inflation uses e-Stat (fallback chain: World Bank then FRED).</p>
            <p>We plan to extend proxies for FRED/e-Stat/BoJ and periodically refresh coefficients.</p>
            <p>Refresh cadence: defaults to 60 minutes. Append <code>?fast=1</code> to update every 15 minutes.</p>
          </div>
        </details>
      </section>
    </div>
  );
}
