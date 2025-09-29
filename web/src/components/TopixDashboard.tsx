import { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, ColorType, Time } from 'lightweight-charts';

type TopixHistoryPoint = {
  date: string;
  actual: number | null;
  theoretical: number | null;
  diff: number | null;
  trend?: string | null;
  trendClass?: number | null;
  trendScore?: number | null;
  indicators?: Record<string, number | null | undefined> | null;
  missingIndicators?: string[] | null;
};

type TopixHistoryResponse = {
  history: TopixHistoryPoint[];
  meta?: {
    updatedAt?: number | null;
    rows?: number | null;
    weights?: Record<string, number> | null;
    trend?: Record<string, unknown> | null;
    sources?: Record<string, unknown> | null;
  } | null;
};

type TopixLatestResponse = {
  data?: TopixHistoryPoint | null;
  indicators?: Record<string, number | null | undefined> | null;
  updatedAt?: number | null;
  config?: {
    weights?: Record<string, number> | null;
    trend?: Record<string, unknown> | null;
  } | null;
};

const REFRESH_INTERVAL_MS = 60 * 60_000;

const histogramColor = (cls: number | null | undefined) => {
  if (cls == null) return '#94a3b8aa';
  if (cls > 0) return '#22c55faa';
  if (cls < 0) return '#ef4444aa';
  return '#94a3b8aa';
};

const trendLabel = (cls: number | null | undefined) => {
  if (cls == null) return '不明';
  if (cls > 0) return '上昇トレンド';
  if (cls < 0) return '下降トレンド';
  return '横ばい';
};

const trendTextClass = (cls: number | null | undefined) => {
  if (cls == null) return 'text-slate-300';
  if (cls > 0) return 'text-emerald-400';
  if (cls < 0) return 'text-rose-400';
  return 'text-slate-300';
};

const formatNumber = (value: number | null | undefined, digits = 2) => {
  if (value == null || Number.isNaN(value)) return '---';
  return value.toFixed(digits);
};

const formatDiff = (value: number | null | undefined, digits = 2) => {
  if (value == null || Number.isNaN(value)) return '---';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}`;
};

const formatDate = (iso: string | null | undefined) => {
  if (!iso) return '---';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
    return d.toLocaleDateString('ja-JP');
  } catch {
    return iso;
  }
};

const formatTime = (ts: number | null | undefined) => {
  if (!ts) return '---';
  try {
    return new Date(ts).toLocaleString('ja-JP', { hour12: false });
  } catch {
    return String(ts);
  }
};

const formatCorrelation = (value: number | null | undefined) => {
  if (value == null || Number.isNaN(value)) return '---';
  return value.toFixed(3);
};

export default function TopixDashboard() {
  const [history, setHistory] = useState<TopixHistoryPoint[]>([]);
  const [historyMeta, setHistoryMeta] = useState<TopixHistoryResponse['meta']>(null);
  const [historyStatus, setHistoryStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [latest, setLatest] = useState<TopixLatestResponse | null>(null);
  const [latestStatus, setLatestStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [logs, setLogs] = useState<string[]>([]);
  const [logsStatus, setLogsStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [actionState, setActionState] = useState<'idle' | 'posting'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const fetchHistory = async () => {
    setHistoryStatus('loading');
    try {
      const res = await fetch('/api/topix/history');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: TopixHistoryResponse = await res.json();
      setHistory(Array.isArray(json.history) ? json.history : []);
      setHistoryMeta(json.meta ?? null);
      setHistoryStatus('ready');
      setErrorMessage(null);
    } catch (error) {
      console.error('topix history fetch failed:', error);
      setHistoryStatus('error');
      setErrorMessage('TOPIXデータの取得に失敗しました。しばらくしてから再度お試しください。');
    }
  };

  const fetchLatest = async () => {
    setLatestStatus('loading');
    try {
      const res = await fetch('/api/topix/latest');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: TopixLatestResponse = await res.json();
      setLatest(json ?? null);
      setLatestStatus('ready');
    } catch (error) {
      console.error('topix latest fetch failed:', error);
      setLatestStatus('error');
    }
  };

  const fetchLogs = async () => {
    setLogsStatus('loading');
    try {
      const res = await fetch('/api/topix/logs?tail=120');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setLogs(Array.isArray(json?.lines) ? json.lines : []);
      setLogsStatus('ready');
    } catch (error) {
      console.error('topix logs fetch failed:', error);
      setLogsStatus('error');
    }
  };

  useEffect(() => {
    fetchHistory();
    fetchLatest();
    fetchLogs();
    const timer = window.setInterval(() => {
      fetchHistory();
      fetchLatest();
    }, REFRESH_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container || historyStatus !== 'ready') return () => {};

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#0f172a' },
        textColor: '#e2e8f0',
      },
      rightPriceScale: { borderVisible: false },
      leftPriceScale: {
        visible: true,
        borderColor: '#1f2937',
        scaleMargins: { top: 0.7, bottom: 0 },
      },
      timeScale: { borderColor: '#1f2937', rightOffset: 2 },
      crosshair: { mode: 1 },
    });
    chartRef.current = chart;

    const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));

    const actualSeries = chart.addLineSeries({
      color: '#38bdf8',
      lineWidth: 2,
      priceScaleId: 'right',
    });
    actualSeries.setData(
      sorted
        .filter((row) => typeof row.actual === 'number' && Number.isFinite(row.actual as number))
        .map((row) => ({ time: row.date as Time, value: Number(row.actual) })),
    );

    const theoreticalSeries = chart.addLineSeries({
      color: '#f97316',
      lineWidth: 2,
      priceScaleId: 'right',
    });
    theoreticalSeries.setData(
      sorted
        .filter((row) => typeof row.theoretical === 'number' && Number.isFinite(row.theoretical as number))
        .map((row) => ({ time: row.date as Time, value: Number(row.theoretical) })),
    );

    const trendSeries = chart.addHistogramSeries({
      priceScaleId: 'left',
      base: 0,
      priceFormat: { type: 'price', precision: 0, minMove: 1 },
      scaleMargins: { top: 0.9, bottom: 0 },
    });
    trendSeries.setData(
      sorted.map((row) => ({
        time: row.date as Time,
        value: Number(row.trendClass ?? 0),
        color: histogramColor(row.trendClass ?? 0),
      })),
    );

    chart.timeScale().fitContent();

    const observer = new ResizeObserver(() => {
      chart.timeScale().fitContent();
    });
    observer.observe(container);
    resizeObserverRef.current = observer;

    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [history, historyStatus]);

  const handleRecalc = async () => {
    setActionState('posting');
    try {
      const res = await fetch('/api/topix/recalc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchHistory();
      await fetchLatest();
      await fetchLogs();
    } catch (error) {
      console.error('topix recalc failed:', error);
      setErrorMessage('再計算に失敗しました。もう一度お試しください。');
    } finally {
      setActionState('idle');
    }
  };

  const latestPoint = useMemo(() => latest?.data ?? null, [latest]);
  const updatedAtText = useMemo(() => {
    const ts = historyMeta?.updatedAt ?? latest?.updatedAt ?? null;
    return formatTime(typeof ts === 'number' ? ts : null);
  }, [historyMeta, latest]);

  const indicatorEntries = useMemo(() => {
    const src = latest?.indicators;
    if (!src) return [] as { key: string; value: number | null | undefined }[];
    return Object.entries(src)
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [latest]);

  const latestMissingIndicators = useMemo(() => {
    const candidate = latestPoint?.missingIndicators ?? [];
    return Array.isArray(candidate) ? candidate.filter((name) => !!name) : [];
  }, [latestPoint]);

  const correlation = useMemo(() => {
    const pairs = history
      .map((row) => {
        if (row.actual == null || row.theoretical == null) return null;
        if (!Number.isFinite(row.actual) || !Number.isFinite(row.theoretical)) return null;
        return { actual: row.actual as number, theoretical: row.theoretical as number };
      })
      .filter((row): row is { actual: number; theoretical: number } => row !== null);
    if (pairs.length < 2) return null;
    const actuals = pairs.map((p) => p.actual);
    const theoreticals = pairs.map((p) => p.theoretical);
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

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <header className="text-center space-y-2">
        <h1 className="text-3xl md:text-4xl font-bold text-white">TOPIX モデルダッシュボード</h1>
        {updatedAtText !== '---' && (
          <p className="text-sm text-slate-400">最終更新: {updatedAtText}</p>
        )}
        {errorMessage && <p className="text-sm text-rose-400">{errorMessage}</p>}
      </header>

      <section className="card bg-slate-800 border border-slate-700 rounded-xl p-6 shadow">
        <h2 className="text-xl font-semibold text-slate-100 mb-4">最新サマリー</h2>
        {latestStatus === 'error' && (
          <p className="mb-3 text-xs text-amber-300">最新データの取得に失敗したため、直近の履歴で表示しています。</p>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm text-slate-200">
          <div className="rounded-lg bg-slate-900/70 border border-slate-700 p-4">
            <p className="text-slate-400 text-xs uppercase tracking-wide">対象日</p>
            <p className="mt-1 text-lg font-mono">{formatDate(latestPoint?.date)}</p>
          </div>
          <div className="rounded-lg bg-slate-900/70 border border-slate-700 p-4">
            <p className="text-slate-400 text-xs uppercase tracking-wide">実測値</p>
            <p className="mt-1 text-lg font-mono text-white">{formatNumber(latestPoint?.actual)}</p>
          </div>
          <div className="rounded-lg bg-slate-900/70 border border-slate-700 p-4">
            <p className="text-slate-400 text-xs uppercase tracking-wide">理論値</p>
            <p className="mt-1 text-lg font-mono text-indigo-300">{formatNumber(latestPoint?.theoretical)}</p>
          </div>
          <div className="rounded-lg bg-slate-900/70 border border-slate-700 p-4">
            <p className="text-slate-400 text-xs uppercase tracking-wide">乖離 (実測?理論)</p>
            <p className="mt-1 text-lg font-mono">{formatDiff(latestPoint?.diff)}</p>
          </div>
          <div className="rounded-lg bg-slate-900/70 border border-slate-700 p-4 sm:col-span-2 lg:col-span-1">
            <p className="text-slate-400 text-xs uppercase tracking-wide">トレンド判定</p>
            <p className={`mt-1 text-lg font-semibold ${trendTextClass(latestPoint?.trendClass ?? null)}`}>
              {trendLabel(latestPoint?.trendClass ?? null)}
            </p>
            {latestPoint?.trendScore != null && (
              <p className="text-xs text-slate-400">スコア: {formatDiff(latestPoint.trendScore, 3)}</p>
            )}
          </div>
          <div className="rounded-lg bg-slate-900/70 border border-slate-700 p-4 sm:col-span-2 lg:col-span-1">
            <p className="text-slate-400 text-xs uppercase tracking-wide">相関係数 (実測×理論)</p>
            <p className="mt-1 text-lg font-mono">{formatCorrelation(correlation)}</p>
          </div>
          <div className="rounded-lg bg-slate-900/70 border border-slate-700 p-4 sm:col-span-2 lg:col-span-1">
            <p className="text-slate-400 text-xs uppercase tracking-wide">データ件数</p>
            <p className="mt-1 text-lg font-mono">{history.length}</p>
          </div>
        </div>
        {latestMissingIndicators.length > 0 && (
          <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
            <p className="font-semibold text-amber-300">不足している指標:</p>
            <p className="mt-1">{latestMissingIndicators.join(', ')}</p>
            <p className="mt-1 text-xs text-amber-200/80">
              上記の指標データが取得できていないため、最新月の理論値が算出されていません。データソースや設定を確認してください。
            </p>
          </div>
        )}
      </section>

      <section className="card bg-slate-800 border border-slate-700 rounded-xl p-6 shadow">
        <h2 className="text-xl font-semibold text-slate-100 mb-4">TOPIX 実測値・理論値 & トレンド</h2>
        {historyStatus === 'loading' || historyStatus === 'idle' ? (
          <div className="h-80 flex items-center justify-center text-slate-400 text-sm">読み込み中...</div>
        ) : historyStatus === 'error' ? (
          <div className="h-80 flex items-center justify-center text-rose-400 text-sm">データの取得に失敗しました。</div>
        ) : (
          <div ref={chartContainerRef} className="w-full h-[320px] md:h-[420px]" />
        )}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="card bg-slate-800 border border-slate-700 rounded-xl p-6 shadow space-y-4">
          <h3 className="text-lg font-semibold text-slate-100">モデル設定</h3>
          <div>
            <p className="text-xs text-slate-400 mb-1">回帰係数</p>
            <pre className="bg-slate-900/70 border border-slate-700 rounded-lg p-3 text-xs text-slate-200 whitespace-pre-wrap overflow-auto">
              {historyMeta?.weights ? JSON.stringify(historyMeta.weights, null, 2) : 'N/A'}
            </pre>
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-1">トレンド判定パラメータ</p>
            <pre className="bg-slate-900/70 border border-slate-700 rounded-lg p-3 text-xs text-slate-200 whitespace-pre-wrap overflow-auto">
              {historyMeta?.trend ? JSON.stringify(historyMeta.trend, null, 2) : 'N/A'}
            </pre>
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-1">使用データソース</p>
            <pre className="bg-slate-900/70 border border-slate-700 rounded-lg p-3 text-xs text-slate-200 whitespace-pre-wrap overflow-auto">
              {historyMeta?.sources ? JSON.stringify(historyMeta.sources, null, 2) : 'N/A'}
            </pre>
          </div>
        </div>

        <div className="card bg-slate-800 border border-slate-700 rounded-xl p-6 shadow space-y-4">
          <h3 className="text-lg font-semibold text-slate-100">運用ツール</h3>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleRecalc}
              disabled={actionState === 'posting'}
              className="inline-flex items-center justify-center rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 px-4 py-2 text-sm font-medium text-white transition"
            >
              {actionState === 'posting' ? '再計算中...' : 'データを再計算'}
            </button>
            <button
              type="button"
              onClick={() => { fetchHistory(); fetchLatest(); }}
              className="inline-flex items-center justify-center rounded-md border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700"
            >
              最新データを取得
            </button>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-400 uppercase tracking-wide">最新ログ</span>
              <button
                type="button"
                onClick={fetchLogs}
                className="text-xs text-indigo-300 hover:text-indigo-200 transition"
              >
                更新
              </button>
            </div>
            <div className="bg-slate-900/70 border border-slate-700 rounded-lg p-3 h-48 overflow-auto font-mono text-xs text-slate-200">
              {logsStatus === 'loading'
                ? '読み込み中...'
                : logsStatus === 'error'
                  ? 'ログを取得できませんでした。'
                  : logs.length > 0
                    ? logs.join('\n')
                    : 'ログがまだありません。'}
            </div>
          </div>

          {indicatorEntries.length > 0 && (
            <div>
              <p className="text-xs text-slate-400 mb-1">最新指標</p>
              <div className="grid sm:grid-cols-2 gap-2 text-xs text-slate-200">
                {indicatorEntries.map((entry) => (
                  <div key={entry.key} className="rounded bg-slate-900/70 border border-slate-700 px-3 py-2 flex justify-between">
                    <span className="uppercase tracking-wide text-slate-400">{entry.key}</span>
                    <span className="font-mono">{formatNumber(typeof entry.value === 'number' ? entry.value : null)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
