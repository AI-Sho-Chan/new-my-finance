import { fetchTopix33History, buildTopix33Overrides, type Topix33Overrides } from '../lib/topix33';
import { fetchUSIndustriesHistory, buildUSIndustryOverrides, type USIndustryOverrides } from '../lib/usIndustries';
import { fetchQ1Analysis, fetchQ1Status, type Q1Analysis, type Q1Metrics, type Q1ScanSummaryEntry, type Q1Status, type Q1StatusEntry, type Q1WatchlistEntry, buildQ1WatchlistMembers } from '../lib/q1';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MouseEvent } from 'react';
import { computeSnapshotWithTrails, DEFAULT_PARAMS, type SnapshotItem, type SnapshotTrails, type SnapshotMeta, UNIVERSE, type AssetDef, normalizeQuadrantThresholds, type QuadrantThresholds } from '../lib/analysis';
import { useStore } from '../store';
import { collectGroupItemIds } from '../lib/watch-helpers';
import type { WatchItem, WatchItemType } from '../types';

function colorForQuad(q: SnapshotItem['quadrant']) {
  switch (q) {
    case 'Q1': return '#22c55e';
    case 'Q2': return '#f59e0b';
    case 'Q3': return '#3b82f6';
    case 'Q4': return '#ef4444';
    default: return '#9ca3af';
  }
}

function heatColor(pctl: number | null) {
  if (pctl == null) return '#6b7280';
  const t = pctl/100;
  const r = Math.round(239*(1-t) + 34*t);
  const g = Math.round(68*(1-t) + 197*t);
  const b = Math.round(68*(1-t) + 94*t);
  return `rgb(${r},${g},${b})`;
}

const SCAN_LABELS: Record<string, string> = {
  JP: '日本株',
  US: '米国大型株',
  GLOBAL: 'Global Core',
  US_SECTORS: 'US Industries',
  JP_SECTORS: 'Japan Index',
  ALL: '全銘柄',
};

export default function Analysis({ bare = false }: { bare?: boolean }) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<SnapshotItem[] | null>(null);
  const [trails, setTrails] = useState<SnapshotTrails | null>(null);
  const [meta, setMeta] = useState<SnapshotMeta | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<'GLOBAL' | 'US_INDUSTRY' | 'JP_SECTOR' | 'ALL_WATCH' | 'Q1_JP' | 'Q1_US'>('GLOBAL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [topixData, setTopixData] = useState<Topix33Overrides | null>(null);
  const [topixLoadErr, setTopixLoadErr] = useState<string | null>(null);
  const [usIndustryData, setUsIndustryData] = useState<USIndustryOverrides | null>(null);
  const [q1Data, setQ1Data] = useState<Q1Analysis | null>(null);
  const [q1Status, setQ1Status] = useState<Q1Status | null>(null);
  const [usIndustryLoadErr, setUsIndustryLoadErr] = useState<string | null>(null);
  const quadrantThresholds = useMemo(() => normalizeQuadrantThresholds((q1Status?.thresholds ?? q1Data?.thresholds) as Partial<QuadrantThresholds> | undefined), [q1Status?.thresholds, q1Data?.thresholds]);
  const quadrantThresholdKey = useMemo(() => JSON.stringify(quadrantThresholds), [quadrantThresholds]);
  const scanSummary = q1Status?.scanSummary ?? undefined;
  const scanSummaryRows = useMemo(() => {
    if (!scanSummary) return [] as { key: string; label: string; entry: Q1ScanSummaryEntry }[];
    const order = ['JP', 'US', 'GLOBAL', 'US_SECTORS', 'JP_SECTORS', 'ALL'];
    return order
      .map((key) => {
        const entry = scanSummary[key];
        if (!entry) return null;
        return { key, label: SCAN_LABELS[key] ?? key, entry };
      })
      .filter((row): row is { key: string; label: string; entry: Q1ScanSummaryEntry } => row != null);
  }, [scanSummary]);
  const formatScanTime = useCallback((value: number | null | undefined) => {
    if (typeof value !== 'number' || Number.isNaN(value)) return '--';
    return new Date(value).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }, []);

  // Read watchlist from NMY localStorage, fallback to Zustand
  const readNMYWatch = () => {
    try {
      const raw = localStorage.getItem('nmy.watch.items');
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) return arr.map((w: any) => ({ symbol: String(w.symbol||''), name: String(w.name||w.symbol||'') }));
    } catch {}
    return [] as { symbol: string; name: string }[];
  };
  const watchItemsMap = useStore((s) => s.watchItems);
  const watchGroupsMap = useStore((s) => s.watchGroups);
  const syncSystemGroupMembers = useStore((s) => s.syncSystemGroupMembers);
  const [nmyWatch, setNmyWatch] = useState<{ symbol: string; name: string }[]>(() => readNMYWatch());
  const allGroup = useMemo(() => {
    const groups = Object.values(watchGroupsMap);
    if (!groups.length) return null;
    const sorted = [...groups].sort((a, b) => a.order - b.order);
    return sorted.find((g) => g.key === 'all') || sorted[0];
  }, [watchGroupsMap]);
  const storeWatch = useMemo(() => {
    if (!allGroup) return [] as { symbol: string; name: string }[];
    const ids = collectGroupItemIds(allGroup, watchItemsMap);
    return ids
      .map((id) => watchItemsMap[id])
      .filter((item): item is WatchItem => Boolean(item) && item.source !== 'system')
      .map((item) => ({ symbol: item.symbol, name: item.name }));
  }, [allGroup, watchItemsMap]);
  const mergedWatch = storeWatch.length ? storeWatch : nmyWatch;
  const watchKey = useMemo(() => mergedWatch.map((w) => w.symbol).join(','), [mergedWatch]);

  const applyQ1DataToSystemGroups = useCallback((status: Q1Status | null | undefined, analysis: Q1Analysis | null | undefined) => {
    if (!status && !analysis) return;
    const watchEntries = analysis?.watchlist ?? [];
    const jpWatchMembers = buildQ1WatchlistMembers(watchEntries, 'JP');
    const usWatchMembers = buildQ1WatchlistMembers(watchEntries, 'US');
    const buildMembersFromStatus = (entries: Q1StatusEntry[] | undefined) =>
      (entries ?? []).map((entry) => ({
        symbol: entry.symbol,
        name: entry.name,
        type: (entry.symbol?.startsWith('^') ? 'index' : 'stock') as WatchItemType,
      }));
    const allCurrent = status?.currentQ1 ?? [];
    const currentJPStatus = status?.currentQ1JP ?? allCurrent.filter((entry) => entry.market === 'JP');
    const currentUSStatus = status?.currentQ1US ?? allCurrent.filter((entry) => entry.market === 'US');
    const jpMembers = jpWatchMembers.length ? jpWatchMembers : buildMembersFromStatus(currentJPStatus);
    const usMembers = usWatchMembers.length ? usWatchMembers : buildMembersFromStatus(currentUSStatus);
    syncSystemGroupMembers({ key: 'q1_jp', members: jpMembers });
    syncSystemGroupMembers({ key: 'q1_us', members: usMembers });
  }, [syncSystemGroupMembers]);

  useEffect(() => {
    setSelectedId(null);
  }, [view]);

  useEffect(() => {
    if (!selectedId) return;
    if (!items?.some((item) => item.id === selectedId)) {
      setSelectedId(null);
    }
  }, [items, selectedId]);

  useEffect(() => {
    const q1Views = new Set(['Q1_JP', 'Q1_US']);
    if (!q1Views.has(view)) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    setItems(null);
    setTrails(null);
    setMeta(null);

    const load = async () => {
      try {
        const [analysisRes, statusRes] = await Promise.all([fetchQ1Analysis(), fetchQ1Status()]);
        if (cancelled) return;
        setQ1Data(analysisRes);
        setQ1Status(statusRes ?? null);
        applyQ1DataToSystemGroups(statusRes ?? null, analysisRes ?? null);
        const thresholdsSource = (statusRes?.thresholds ?? analysisRes?.thresholds) as Partial<QuadrantThresholds> | undefined;
        const thresholds = normalizeQuadrantThresholds(thresholdsSource);
        const market = view === 'Q1_JP' ? 'JP' : 'US';
        const snapshotItems = q1WatchlistToSnapshot(analysisRes?.watchlist ?? [], market, thresholds);
        setItems(snapshotItems);
        setTrails(null);
        setMeta(null);
        if (!snapshotItems.length) {
          setErr(view === 'Q1_JP' ? '日本のQ1ウォッチリストはまだ空です。' : '米国のQ1ウォッチリストはまだ空です。');
        } else {
          setErr(null);
        }
      } catch (error) {
        if (cancelled) return;
        setItems([]);
        setTrails(null);
        setMeta(null);
        setErr(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [view, applyQ1DataToSystemGroups]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const status = await fetchQ1Status();
        if (cancelled) return;
        setQ1Status(status);
        applyQ1DataToSystemGroups(status, q1Data);
      } catch {
        // swallow network errors; status polling will retry
      }
    };
    load();
    const id = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [applyQ1DataToSystemGroups, q1Data]);

  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      try {
        if (!ev || !ev.data) return;
        if (window.location.origin && ev.origin && ev.origin !== window.location.origin) return;
        if (ev.data.type === 'nmy.watch.update' && Array.isArray(ev.data.items)) {
          const arr = ev.data.items.map((w: any) => ({ symbol: String(w.symbol||''), name: String(w.name||w.symbol||'') }));
          setNmyWatch(arr);
        }
      } catch {}
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === 'nmy.watch.items') setNmyWatch(readNMYWatch()); };
    window.addEventListener('storage', onStorage);
    const iv = window.setInterval(() => setNmyWatch(readNMYWatch()), 1500);
    return () => { window.removeEventListener('storage', onStorage); window.clearInterval(iv); };
  }, []);

  useEffect(() => {
    if (view === 'Q1_JP' || view === 'Q1_US') return;
    let cancelled = false;
    fetchTopix33History()
      .then((history) => buildTopix33Overrides(history))
      .then((result) => {
        if (cancelled) return;
        setTopixData(result);
        setTopixLoadErr(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setTopixData(null);
        setTopixLoadErr(error instanceof Error ? error.message : String(error));
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchUSIndustriesHistory()
      .then((history) => buildUSIndustryOverrides(history))
      .then((result) => {
        if (cancelled) return;
        setUsIndustryData(result);
        setUsIndustryLoadErr(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setUsIndustryData(null);
        setUsIndustryLoadErr(error instanceof Error ? error.message : String(error));
      });
    return () => { cancelled = true; };
  }, []);

  const topixAssets = useMemo(() => topixData?.assets ?? [], [topixData]);
  const topixOverridesMap = useMemo(() => topixData?.overrides ?? null, [topixData]);
  const topixStats = useMemo(() => {
    if (!topixData) return null;
    const overrides = topixData.overrides ?? {};
    const entries = Object.values(overrides);
    if (!entries.length) return null;
    let withHistory = 0;
    let longCount = 0;
    let start: string | null = null;
    let end: string | null = null;
    entries.forEach(({ daily }) => {
      if (!daily.length) return;
      withHistory += 1;
      if (daily.length >= 252) longCount += 1;
      const first = daily[0];
      const last = daily[daily.length - 1];
      const firstDate = new Date(first.time * 1000).toISOString().slice(0, 10);
      const lastDate = new Date(last.time * 1000).toISOString().slice(0, 10);
      if (!start || firstDate < start) start = firstDate;
      if (!end || lastDate > end) end = lastDate;
    });
    return { total: entries.length, withHistory, longCount, start, end };
  }, [topixData]);

  const usIndustryAssets = useMemo(() => usIndustryData?.assets ?? [], [usIndustryData]);
  const usIndustryOverridesMap = useMemo(() => usIndustryData?.overrides ?? null, [usIndustryData]);
  const usIndustryStats = useMemo(() => usIndustryData?.metadata ?? null, [usIndustryData]);

  useEffect(() => {
    let alive = true;

    const run = async () => {
      if (view === 'Q1_JP' || view === 'Q1_US') {
        return;
      }
      if (view === 'JP_SECTOR' && !topixOverridesMap) {
        setItems(null);
        setTrails(null);
        setMeta(null);
        if (topixLoadErr) {
          setErr(topixLoadErr);
          setLoading(false);
        } else {
          setErr(null);
          setLoading(true);
        }
        return;
      }
      if (view === 'US_INDUSTRY' && !usIndustryOverridesMap) {
        setItems(null);
        setTrails(null);
        setMeta(null);
        if (usIndustryLoadErr) {
          setErr(usIndustryLoadErr);
          setLoading(false);
        } else {
          setErr(null);
          setLoading(true);
        }
        return;
      }

      setLoading(true);
      setErr(null);

      const toAssetDef = (w: { symbol: string; name: string }): AssetDef => {
        const symbol = String(w.symbol);
        const name = w.name || symbol;
        if (symbol.endsWith('.T')) {
          return { id: symbol, name, cls: 'EQ', symbol, currency: 'JPY', priceToUSD: 'JPY' };
        }
        if (symbol.includes('-USD')) {
          return { id: symbol, name, cls: 'CRYPTO', symbol, currency: 'USD' };
        }
        if (symbol.endsWith('=X')) {
          if (symbol.endsWith('JPY=X')) {
            return { id: symbol, name, cls: 'FX', symbol, currency: 'JPY', priceToUSD: 'JPY' };
          }
          return { id: symbol, name, cls: 'FX', symbol, currency: 'USD' };
        }
        if (symbol.startsWith('^')) {
          return { id: symbol, name, cls: 'INDEX', symbol, currency: 'USD' };
        }
        return { id: symbol, name, cls: 'EQ', symbol, currency: 'USD' };
      };

      const watchAll: AssetDef[] = mergedWatch.map(toAssetDef);
      const uni: AssetDef[] = (
        view==='GLOBAL' ? UNIVERSE :
        view==='US_INDUSTRY' ? usIndustryAssets :
        view==='JP_SECTOR' ? topixAssets :
        watchAll
      );

      if (view === 'ALL_WATCH' && watchAll.length === 0) {
        if (alive) {
          setItems([]);
          setTrails(null);
          setMeta(null);
          setErr('Watchlist ALL group is empty.');
          setLoading(false);
        }
        return;
      }

      try {
        const overridesArg =
          view === 'JP_SECTOR' ? topixOverridesMap ?? undefined :
          view === 'US_INDUSTRY' ? usIndustryOverridesMap ?? undefined :
          undefined;
        const result = await computeSnapshotWithTrails(
          DEFAULT_PARAMS,
          uni,
          6,
          overridesArg ? { overrides: overridesArg } : undefined
        );
        if (!alive) return;
        setItems(result.items);
        setTrails(result.trails);
        setMeta(result.meta);
        setErr(null);
      } catch (error) {
        if (!alive) return;
        setItems(null);
        setTrails(null);
        setMeta(null);
        setErr(error instanceof Error ? error.message : String(error));
      } finally {
        if (alive) setLoading(false);
      }
    };

    run();

    return () => { alive = false; };
  }, [view, watchKey, topixAssets, topixOverridesMap, topixLoadErr, usIndustryAssets, usIndustryOverridesMap, usIndustryLoadErr, quadrantThresholdKey]);

  const domain = useMemo(() => {
    if (!items) return { f:[-3,3] as [number,number], v:[-3,3] as [number,number] };
    const fVals = items.map(i => i.F ?? 0).filter(Number.isFinite);
    const vVals = items.map(i => i.V ?? 0).filter(Number.isFinite);
    const fmin = Math.min(...fVals, -3), fmax = Math.max(...fVals, 3);
    const vmin = Math.min(...vVals, -3), vmax = Math.max(...vVals, 3);
    return { f:[fmin,fmax] as [number,number], v:[vmin,vmax] as [number,number] };
  }, [JSON.stringify(items)]);

  // Bare mode: only Scatter + Heatmap (for iframe embed)
  if (bare) {
    if (loading || !items) return <div className="text-gray-400 text-sm">Loading...</div>;
    return (
      <div className="space-y-4">
        <LegendQuadrant />
        {/* Scatter (F x V) */}
        <Scatter
          items={items}
          trails={trails || {}}
          xDomain={domain.v}
          yDomain={domain.f}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        {/* Heatmap (F/V/A) */}
        <Heatmap items={items} selectedId={selectedId} onSelect={setSelectedId} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center flex-wrap gap-2 text-sm">
        <span className="text-gray-400">View:</span>
        <button className={`px-2 py-1 rounded ${view==='GLOBAL'?'bg-indigo-600 text-white':'bg-gray-700 text-gray-200'}`} onClick={()=>setView('GLOBAL')}>Global</button>
        <button className={`px-2 py-1 rounded ${view==='US_INDUSTRY'?'bg-indigo-600 text-white':'bg-gray-700 text-gray-200'}`} onClick={()=>setView('US_INDUSTRY')}>US Industries</button>
        <button className={`px-2 py-1 rounded ${view==='JP_SECTOR'?'bg-indigo-600 text-white':'bg-gray-700 text-gray-200'}`} onClick={()=>setView('JP_SECTOR')}>Japan Index</button>
        <button className={`px-2 py-1 rounded ${view==='ALL_WATCH'?'bg-indigo-600 text-white':'bg-gray-700 text-gray-200'}`} onClick={()=>setView('ALL_WATCH')}>ALL</button>
        <button className={`px-2 py-1 rounded ${view==='Q1_JP'?'bg-indigo-600 text-white':'bg-gray-700 text-gray-200'}`} onClick={()=>setView('Q1_JP')}>Q1 JP</button>
        <button className={`px-2 py-1 rounded ${view==='Q1_US'?'bg-indigo-600 text-white':'bg-gray-700 text-gray-200'}`} onClick={()=>setView('Q1_US')}>Q1 US</button>
      </div>

      {scanSummaryRows.length > 0 && (
        <div className="grid w-full gap-3 rounded-lg border border-gray-800 bg-gray-900/60 p-3 md:grid-cols-2 xl:grid-cols-3">
          {scanSummaryRows.map(({ key, label, entry }) => (
            <div
              key={key}
              className="rounded border border-gray-800/60 bg-gray-900/80 p-3 text-xs text-gray-300"
            >
              <div className="flex items-center justify-between text-sm text-gray-100">
                <span className="font-semibold">{label}</span>
                <span className="text-xs text-gray-400">{entry.tradeDate ?? '--'}</span>
              </div>
              <div className="mt-1 text-[11px] text-gray-400">最終実行: <span className="text-gray-100">{formatScanTime(entry.lastScanAt)}</span></div>
              <div className="mt-1 text-[11px] text-gray-400">Q1検出: <span className="text-gray-100">{entry.q1Count}</span> / {entry.total}</div>
            </div>
          ))}
        </div>
      )}

      {view === 'JP_SECTOR' && (
        <div className="text-xs text-gray-400">
          {topixStats ? (
            <span>
              TOPIX-33 coverage: {topixStats.withHistory}/{topixStats.total} sectors ({topixStats.longCount} with at least 252 daily bars) | history window: {topixStats.start ?? 'n/a'} to {topixStats.end ?? 'n/a'}
            </span>
          ) : topixLoadErr ? (
            'Failed to load TOPIX-33 dataset.'
          ) : (
            'Loading TOPIX-33 dataset...'
          )}
        </div>
      )}
      {view === 'US_INDUSTRY' && (
        <div className="text-xs text-gray-400">
          {usIndustryStats ? (
            <span>
              US industry coverage: {usIndustryStats.withHistory}/{usIndustryStats.total} composites ({usIndustryStats.longCount} with {'>='} 750 daily bars) | history window: {usIndustryStats.start ?? 'n/a'} to {usIndustryStats.end ?? 'n/a'}
            </span>
          ) : usIndustryLoadErr ? (
            'Failed to load US industry dataset.'
          ) : (
            'Loading US industry dataset...'
          )}
        </div>
      )}
      {view === 'Q1_JP' && (
        <div className="text-xs text-gray-400">JP Q1: {q1Status?.currentQ1JP?.length ?? 0}</div>
      )}
      {view === 'Q1_US' && (
        <div className="text-xs text-gray-400">US Q1: {q1Status?.currentQ1US?.length ?? 0}</div>
      )}
      {loading && <div className="card">Loading...</div>}
      {err && <div className="card text-red-400">{err}</div>}
      {items && (
        <>
          <div className="card">
            <div className="flex items-center justify-between">
              <div className="font-semibold mb-2">F vs V Scatter (x=V, y=F)</div>
              <LegendQuadrant />
            </div>
            <Scatter
              items={items}
              trails={trails || {}}
              xDomain={domain.v}
              yDomain={domain.f}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
            <QList
              items={items}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
            <HelpBox kind="scatter" />
          </div>

          <div className="card">
            <div className="font-semibold mb-2">Heatmap (percentile)</div>
            <Heatmap items={items} selectedId={selectedId} onSelect={setSelectedId} />
            <HelpBox kind="heat" />
          </div>
          {meta && (
            <div className="card text-xs text-gray-300">
              <div className="font-semibold mb-2">N/A reasons (estimate)</div>
              <ul className="list-disc pl-5">
                {items.filter(it => it.F==null || it.V==null).map(it => {
                  const m = (meta as any)[it.id] || { dLen: 0, wLen: 0 };
                  const reasons: string[] = [];
                  if (it.F==null) reasons.push(`F: not enough days (~252) / missing (D=${m.dLen})`);
                  if (it.V==null) reasons.push(`V: not enough weeks (~40) / missing (W=${m.wLen})`);
                  return <li key={it.id}><span className="font-semibold mr-1">{it.name}</span><span className="text-gray-400">{reasons.join(' / ')}</span></li>;
                })}
                {items.every(it=> it.F!=null && it.V!=null) && <li>all computed</li>}
              </ul>
            </div>
          )}
          {(view === 'Q1_JP' || view === 'Q1_US') && q1Data?.watchlist?.length ? (
            <div className="card">
              <div className="font-semibold mb-2">Q1 Watchlist ({view === 'Q1_JP' ? 'JP' : 'US'})</div>
              <Q1WatchlistTable entries={q1Data?.watchlist ?? []} market={view === 'Q1_JP' ? 'JP' : 'US'} selectedId={selectedId} onSelect={setSelectedId} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function Scatter({ items, trails, xDomain, yDomain, selectedId, onSelect }: { items: SnapshotItem[]; trails: Record<string, { t:number; F:number|null; V:number|null }[]>; xDomain: [number,number]; yDomain: [number,number]; selectedId?: string | null; onSelect?: (id: string | null) => void; }) {
  const w = 640, h = 400, pad = 30;
  const [xmin,xmax] = xDomain; const [ymin,ymax] = yDomain;
  const xscale = (v: number) => pad + (w-2*pad) * ((v - xmin) / Math.max(1e-9, (xmax - xmin)));
  const yscale = (v: number) => h - pad - (h-2*pad) * ((v - ymin) / Math.max(1e-9, (ymax - ymin)));
  const handleBackgroundClick = (event: MouseEvent<SVGSVGElement>) => {
    if (event.target === event.currentTarget) {
      onSelect?.(null);
    }
  };
  return (
    <div className="relative w-full">
      <svg width={w} height={h} className="bg-gray-900 rounded border border-gray-700" onClick={handleBackgroundClick}>
        <line x1={xscale(0)} y1={pad} x2={xscale(0)} y2={h-pad} stroke="#6b7280" strokeWidth="1" />
        <line x1={pad} y1={yscale(0)} x2={w-pad} y2={yscale(0)} stroke="#6b7280" strokeWidth="1" />
        <text x={w/2} y={h-6} fill="#9ca3af" fontSize="11" textAnchor="middle">V axis</text>
        <text x={12} y={h/2} fill="#9ca3af" fontSize="11" textAnchor="middle" transform={`rotate(-90 12 ${h/2})`}>F axis</text>
        {items.map((it) => {
          const x = it.V ?? NaN; const y = it.F ?? NaN;
          if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
          const cx = xscale(x), cy = yscale(y);
          const isSelected = selectedId === it.id;
          const fillColor = colorForQuad(it.quadrant);
          return (
            <g
              key={it.id}
              className="cursor-pointer transition-[opacity] duration-150"
              onClick={(event) => {
                event.stopPropagation();
                onSelect?.(isSelected ? null : it.id);
              }}
            >
              <circle
                cx={cx}
                cy={cy}
                r={isSelected ? 9 : 6}
                fill={fillColor}
                opacity={isSelected ? 1 : 0.85}
                stroke={isSelected ? '#facc15' : '#1f2937'}
                strokeWidth={isSelected ? 2 : 0}
              />
              {isSelected && (
                <text
                  x={cx}
                  y={cy - 12}
                  fill="#facc15"
                  fontSize="10"
                  textAnchor="middle"
                  style={{ pointerEvents: 'none' }}
                >
                  {it.name}
                </text>
              )}
              <title>{`${it.name} [${it.cls}]F=${it.F?.toFixed(2)} V=${it.V?.toFixed(2)} A=${it.A?.toFixed(2)} (${it.quadrant})`}</title>
            </g>
          );
        })}
        {items.filter(it => it.quadrant==='Q1' || it.quadrant==='Q4').map((it)=>{
          const pts = (trails[it.id]||[]).filter(p=>p.F!=null && p.V!=null);
          if (pts.length < 2) return null;
          const d = pts.map((p,i)=> (i===0? 'M':'L') + xscale(p.V as number) + ' ' + yscale(p.F as number)).join(' ');
          const baseStroke = it.quadrant==='Q1'? '#22c55e' : '#ef4444';
          const isSelected = selectedId === it.id;
          const stroke = isSelected ? '#facc15' : baseStroke;
          const strokeOpacity = isSelected ? 0.9 : 0.6;
          const strokeWidth = isSelected ? 2.4 : 1.5;
          return (
            <g key={'trail-'+it.id} style={{ pointerEvents: 'none' }}>
              <path d={d} stroke={stroke} strokeOpacity={strokeOpacity} strokeWidth={strokeWidth} fill="none" />
              {pts.map((p,i)=> <circle key={i} cx={xscale(p.V as number)} cy={yscale(p.F as number)} r={isSelected ? 2.6 : 2} fill={stroke} fillOpacity={isSelected ? 0.9 : 0.8} />)}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Heatmap({ items, selectedId, onSelect }: { items: SnapshotItem[]; selectedId?: string | null; onSelect?: (id: string | null) => void; }) {
  const cols = ['F','V','A'] as const;
  const quadrantOrder: Record<string, number> = { Q1: 0, Q2: 1, Q3: 2, Q4: 3 };
  const sortedItems = [...items].sort((a, b) => {
    const oa = quadrantOrder[a.quadrant] ?? 99;
    const ob = quadrantOrder[b.quadrant] ?? 99;
    if (oa !== ob) return oa - ob;
    const nameA = a.name || a.id;
    const nameB = b.name || b.id;
    return nameA.localeCompare(nameB);
  });
  const aVals = items.map(i => i.A).filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  const aPctl = (v: number | null) => {
    if (v == null || !Number.isFinite(v)) return null;
    const sorted = [...aVals].sort((a,b)=>a-b);
    if (!sorted.length) return null;
    let i = 0;
    while (i < sorted.length && sorted[i] < v) i++;
    return Math.round((i/(sorted.length-1)) * 100);
  };
  return (
    <div className="overflow-auto">
      <table className="w-full text-sm">
        <thead className="text-gray-400">
          <tr className="text-left">
            <th className="px-2 py-1">Asset</th>
            {cols.map((c) => <th key={c} className="px-2 py-1 text-center">{c}</th>)}
            <th className="px-2 py-1 text-center">Quad</th>
          </tr>
        </thead>
        <tbody>
          {sortedItems.map((it) => {
            const ap = aPctl(it.A ?? null);
            const isSelected = selectedId === it.id;
            const rowClass = `border-t border-gray-700 hover:bg-gray-800/50 transition-colors cursor-pointer${isSelected ? ' bg-gray-800/80' : ''}`;
            return (
              <tr
                key={it.id}
                className={rowClass}
                style={isSelected ? { outline: '1px solid rgba(250,204,21,0.45)', outlineOffset: 0 } : undefined}
                onClick={() => onSelect?.(isSelected ? null : it.id)}
                aria-selected={isSelected}
              >
                <td className="px-2 py-1 text-sm text-gray-100">{it.name}</td>
                <td className="px-2 py-1 text-center"><Cell val={it.F} pctl={it.f_pctl} /></td>
                <td className="px-2 py-1 text-center"><Cell val={it.V} pctl={it.v_pctl} /></td>
                <td className="px-2 py-1 text-center"><Cell val={it.A ?? null} pctl={ap} /></td>
                <td className="px-2 py-1 text-center">
                  <span className="px-2 py-0.5 rounded text-white" style={{ backgroundColor: colorForQuad(it.quadrant) }}>
                    {it.quadrant}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}


function Cell({ val, pctl }: { val: number | null; pctl: number | null }) {
  const bg = heatColor(pctl);
  return (
    <div className="inline-block min-w-[72px] rounded text-gray-900" style={{ backgroundColor: bg }}>
      <span className="px-2 py-0.5 inline-block text-white font-semibold">{val==null? 'N/A' : val.toFixed(2)}</span>
    </div>
  );
}

function LegendQuadrant() {
  const entry = (color: string, title: string, desc: string) => (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 inline-block h-3 w-3 flex-none rounded-sm" style={{ backgroundColor: color }} />
      <div className="text-xs text-gray-300">
        <span className="font-semibold text-gray-100">{title}</span>
        <span className="ml-1 text-gray-400">{desc}</span>
      </div>
    </div>
  );
  return (
    <div className="text-xs text-gray-300 space-y-1">
      {entry('#22c55e', 'Q1: Flow Up / Value Up', 'Broad accumulation with strong positive flow momentum and improving value.')}
      {entry('#f59e0b', 'Q2: Flow Up / Value Down', 'Flow remains strong while value momentum fades; monitor for reversals.')}
      {entry('#3b82f6', 'Q3: Flow Down / Value Up', 'Value factors improving while flow is weak; often early recovery candidates.')}
      {entry('#ef4444', 'Q4: Flow Down / Value Down', 'Distribution phase with weak flow and deteriorating value profile.')}
      <p className="text-[11px] text-gray-500">If either percentile is unavailable the asset falls back to NA.</p>
    </div>
  );
}



function HelpBox({ kind }: { kind: 'scatter' | 'heat' }) {
  if (kind === 'scatter') {
    return (
      <details className="mt-2 text-xs text-gray-300">
        <summary className="cursor-pointer select-none">Details: Scatter (F vs V)</summary>
        <div className="mt-1 leading-relaxed space-y-2">
          <div>
            <p className="font-semibold text-gray-200">F / V / A overview</p>
            <ul className="list-disc pl-5 space-y-1 text-gray-300">
              <li><span className="font-semibold text-gray-100">F (Flow)</span>: Standardised momentum of relative performance across 20/63/252 sessions.</li>
              <li><span className="font-semibold text-gray-100">V (Value)</span>: OLS trend of medium-term relative performance with deviation back to trend.</li>
              <li><span className="font-semibold text-gray-100">A (Acceleration)</span>: Blends short and medium-term flow changes to highlight slope inflections.</li>
            </ul>
          </div>
          <div>
            <p className="font-semibold text-gray-200">Quadrant interpretation</p>
            <ul className="list-disc pl-5 space-y-1 text-gray-300">
              <li><span className="font-semibold text-green-300">Q1</span>: Strong flow and value. Breakouts or well-supported uptrends.</li>
              <li><span className="font-semibold text-amber-300">Q2</span>: Flow strong, value weak. Overbought candidates for tight risk management.</li>
              <li><span className="font-semibold text-sky-300">Q3</span>: Flow weak, value strong. Mean-reversion or accumulation setups.</li>
              <li><span className="font-semibold text-rose-300">Q4</span>: Flow and value weak. Avoid unless contrarian with clear catalysts.</li>
            </ul>
          </div>
        </div>
      </details>
    );
  }
  return (
    <details className="mt-2 text-xs text-gray-300">
      <summary className="cursor-pointer select-none">Details: Heatmap</summary>
      <div className="mt-1 leading-relaxed">
        <p>Heatmap cells rank each factor (F / V / A) across the selected universe. Darker colours indicate stronger percentiles. Missing data defaults to NA.</p>
      </div>
    </details>
  );
}



function QList({ items, selectedId, onSelect }: { items: SnapshotItem[]; selectedId?: string | null; onSelect?: (id: string | null) => void }) {
  const q1 = items.filter(i=>i.quadrant==='Q1');
  const q4 = items.filter(i=>i.quadrant==='Q4');
  const renderChip = (item: SnapshotItem) => {
    const active = selectedId === item.id;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => onSelect?.(active ? null : item.id)}
        className={`px-2 py-0.5 text-xs rounded mr-1 mb-1 transition-colors ${active ? 'bg-emerald-500 text-gray-900 font-semibold' : 'bg-gray-700 text-gray-200 hover:bg-gray-600'}`}
      >
        {item.name}
      </button>
    );
  };
  return (
    <div className="mt-2 text-xs text-gray-300">
      <div className="mb-1"><span className="text-green-400 font-semibold mr-2">Q1:</span>{q1.length? q1.map(renderChip): <span className="text-gray-500">none</span>}</div>
      <div><span className="text-red-400 font-semibold mr-2">Q4:</span>{q4.length? q4.map(renderChip): <span className="text-gray-500">none</span>}</div>
    </div>
  );
}


function q1EntriesToSnapshot(entries: Q1StatusEntry[], thresholds: QuadrantThresholds): SnapshotItem[] {
  const items = entries.map((entry) => {
    const metrics = (entry.metrics ?? {}) as Q1Metrics;
    const {
      F: f = null,
      V: v = null,
      A: aScore = null,
      flowPercentile: flowPct = null,
      valuePercentile: valuePct = null,
      lastPrice = null,
      rp = null,
    } = metrics;
    let quadrant: SnapshotItem['quadrant'] = 'NA';
    if (flowPct != null && valuePct != null) {
      if (flowPct >= 80 && valuePct >= 60) quadrant = 'Q1';
      else if (flowPct >= 80 && valuePct < 40) quadrant = 'Q2';
      else if (flowPct < 20 && valuePct >= 60) quadrant = 'Q3';
      else if (flowPct < 20 && valuePct < 40) quadrant = 'Q4';
      else quadrant = 'NA';
    }
    return {
      id: entry.symbol,
      name: entry.name,
      cls: entry.market,
      currency: entry.market === 'JP' ? 'JPY' : 'USD',
      last_price: lastPrice,
      rp,
      F: f,
      V: v,
      A: aScore,
      f_pctl: flowPct,
      v_pctl: valuePct,
      a_rank: null,
      quadrant,
    } as SnapshotItem;
  });
  const ranked = items
    .map((item, index) => ({ index, score: item.A ?? Number.NEGATIVE_INFINITY }))
    .sort((a, b) => b.score - a.score);
  ranked.forEach(({ index, score }, rank) => {
    if (Number.isFinite(score)) items[index].a_rank = rank + 1;
  });
  return items;
}

function deriveQuadrantFromMetrics(flowPct: number | null, valuePct: number | null, thresholds: QuadrantThresholds, fallback: string | null | undefined): SnapshotItem['quadrant'] {
  if (flowPct != null && valuePct != null) {
    if (flowPct >= thresholds.fPctMin && valuePct >= thresholds.vPctMin) return 'Q1';
    if (flowPct >= thresholds.fPctMin && valuePct < thresholds.vPctMin) return 'Q2';
    if (flowPct < thresholds.fPctLow && valuePct >= thresholds.vPctMin) return 'Q3';
    if (flowPct < thresholds.fPctLow && valuePct < thresholds.vPctLow) return 'Q4';
    return 'NA';
  }
  const norm = typeof fallback === 'string' ? fallback.toUpperCase() : null;
  if (norm && ['Q1', 'Q2', 'Q3', 'Q4'].includes(norm)) return norm as SnapshotItem['quadrant'];
  return 'NA';
}

function q1WatchlistToSnapshot(entries: Q1WatchlistEntry[], market: 'JP' | 'US', thresholds: QuadrantThresholds): SnapshotItem[] {
  const filtered = entries.filter((entry) => entry.market === market);
  filtered.sort((a, b) => {
    if (a.isBenchmark && !b.isBenchmark) return -1;
    if (!a.isBenchmark && b.isBenchmark) return 1;
    const aKey = a.firstEnterTradeDate || a.purchaseDate || '';
    const bKey = b.firstEnterTradeDate || b.purchaseDate || '';
    if (aKey === bKey) return a.symbol.localeCompare(b.symbol);
    return aKey > bKey ? -1 : 1;
  });
  const baseCurrency = market === 'JP' ? 'JPY' : 'USD';
  return filtered.map((entry) => {
    const metrics = entry.metrics ?? null;
    const flowPct = entry.flowPercentile ?? metrics?.flowPercentile ?? null;
    const valuePct = entry.valuePercentile ?? metrics?.valuePercentile ?? null;
    const F = entry.F ?? metrics?.F ?? null;
    const V = entry.V ?? metrics?.V ?? null;
    const A = entry.A ?? metrics?.A ?? null;
    const quadrant = deriveQuadrantFromMetrics(flowPct, valuePct, thresholds, entry.quadrant ?? null);
    const lastPrice = entry.lastPrice ?? metrics?.lastPrice ?? entry.currentPrice ?? entry.purchasePrice ?? null;
    const rp = entry.rp ?? metrics?.rp ?? null;
    const id = entry.id || `${entry.symbol}-${entry.purchaseDate || entry.firstEnterTradeDate || 'watch'}`;
    const name = entry.name || entry.symbol;
    const cls = entry.cls || 'EQ';
    const currency = entry.currency || baseCurrency;
    return {
      id,
      name,
      cls,
      currency,
      last_price: lastPrice ?? null,
      rp,
      F,
      V,
      A,
      f_pctl: flowPct ?? null,
      v_pctl: valuePct ?? null,
      a_rank: null,
      quadrant,
    };
  });
}




function formatDate(value: string | null | undefined): string {
  if (!value) return 'n/a';
  try {
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return value;
    return dt.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch {
    return value;
  }
}

function formatDays(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return 'n/a';
  return String(Math.max(0, Math.floor(value)));
}

function formatPrice(value: number | null | undefined, currency: string | null | undefined): string {
  if (value == null || Number.isNaN(value)) return 'n/a';
  const code = (currency || '').toUpperCase();
  if (code === 'JPY') {
    try {
      return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 }).format(value);
    } catch {
      return `${Math.round(value).toLocaleString()} 円`;
    }
  }
  const fallback = code && code.length === 3 ? code : 'USD';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: fallback, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} ${fallback}`;
  }
}

function formatGain(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return 'n/a';
  const sign = value > 0 ? '+' : '';
  return sign + value.toFixed(2) + '%';
}


function Q1WatchlistTable({ entries, market, selectedId, onSelect }: { entries: Q1WatchlistEntry[]; market: 'JP' | 'US'; selectedId?: string | null; onSelect?: (id: string | null) => void; }) {
  const filtered = entries.filter((entry) => entry.market === market);
  if (!filtered.length) {
    return <div className="text-xs text-gray-400">No tracked entries.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-xs text-gray-200">
        <thead className="text-gray-400 border-b border-gray-700">
          <tr>
            <th className="py-2 pr-3 text-left">Event</th>
            <th className="py-2 pr-3 text-left">Symbol</th>
            <th className="py-2 pr-3 text-left">Days Elapsed</th>
            <th className="py-2 pr-3 text-left">Purchase Price</th>
            <th className="py-2 pr-3 text-left">Gain (%)</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((row) => {
            const rowKey = row.id || `${row.symbol}-${row.purchaseDate || row.firstEnterTradeDate || 'na'}`;
            const purchaseMeta: string[] = [];
            if (row.purchaseDate) purchaseMeta.push(formatDate(row.purchaseDate));
            if (row.purchasePriceSource) purchaseMeta.push(row.purchasePriceSource);
            const gainClass =
              row.gainPct == null ? 'text-gray-300' : row.gainPct < 0 ? 'text-red-400' : 'text-emerald-400';
            const effectiveCurrentPrice = row.currentPrice ?? row.lastPrice ?? null;
            const isSelected = selectedId === rowKey;
            const baseRowClass = 'border-b border-gray-800/60 transition-colors ';
            const rowClass = baseRowClass + (isSelected ? 'bg-gray-800/80' : 'hover:bg-gray-800/40');
            return (
              <tr
                key={rowKey}
                className={rowClass}
                style={isSelected ? { outline: '1px solid rgba(250,204,21,0.45)', outlineOffset: 0 } : undefined}
                onClick={() => onSelect?.(isSelected ? null : rowKey)}
                aria-selected={isSelected}
              >
                <td className="py-2 pr-3 text-gray-100">
                  <div>{row.eventLabel}</div>
                  {row.lastEventTradeDate && (
                    <div className="text-[11px] text-gray-500">{formatDate(row.lastEventTradeDate)}</div>
                  )}
                </td>
                <td className="py-2 pr-3">
                  <div className="font-semibold text-white">
                    {row.symbol}
                    {row.isBenchmark && (
                      <span className="ml-1 rounded bg-gray-700 px-1 py-[1px] text-[10px] text-gray-200">Benchmark</span>
                    )}
                  </div>
                  <div className="text-[11px] text-gray-400">{row.name}</div>
                  {purchaseMeta.length > 0 && (
                    <div className="text-[11px] text-gray-500">Purchased {purchaseMeta.join(' • ')}</div>
                  )}
                  {effectiveCurrentPrice != null && (
                    <div className="text-[11px] text-gray-500">
                      Current {formatPrice(effectiveCurrentPrice, row.currency)}
                    </div>
                  )}
                </td>
                <td className="py-2 pr-3 text-gray-200">{formatDays(row.daysElapsed)}</td>
                <td className="py-2 pr-3 text-gray-200">{formatPrice(row.purchasePrice, row.currency)}</td>
                <td className={`py-2 pr-3 ${gainClass}`}>{formatGain(row.gainPct)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}


