import { fetchTopix33History, buildTopix33Overrides, type Topix33Overrides } from '../lib/topix33';
import { fetchUSIndustriesHistory, buildUSIndustryOverrides, type USIndustryOverrides } from '../lib/usIndustries';
import { fetchQ1Analysis, fetchQ1Status, type Q1Analysis, type Q1Event, type Q1Metrics, type Q1Status, type Q1StatusEntry } from '../lib/q1';
import { useCallback, useEffect, useMemo, useState } from 'react';
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

export default function Analysis({ bare = false }: { bare?: boolean }) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<SnapshotItem[] | null>(null);
  const [trails, setTrails] = useState<SnapshotTrails | null>(null);
  const [meta, setMeta] = useState<SnapshotMeta | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<'GLOBAL' | 'US_INDUSTRY' | 'JP_SECTOR' | 'ALL_WATCH' | 'Q1_JP' | 'Q1_US'>('GLOBAL');
  const [topixData, setTopixData] = useState<Topix33Overrides | null>(null);
  const [topixLoadErr, setTopixLoadErr] = useState<string | null>(null);
  const [usIndustryData, setUsIndustryData] = useState<USIndustryOverrides | null>(null);
  const [q1Data, setQ1Data] = useState<Q1Analysis | null>(null);
  const [q1Status, setQ1Status] = useState<Q1Status | null>(null);
  const [usIndustryLoadErr, setUsIndustryLoadErr] = useState<string | null>(null);
  const quadrantThresholds = useMemo(() => normalizeQuadrantThresholds((q1Status?.thresholds ?? q1Data?.thresholds) as Partial<QuadrantThresholds> | undefined), [q1Status?.thresholds, q1Data?.thresholds]);
  const quadrantThresholdKey = useMemo(() => JSON.stringify(quadrantThresholds), [quadrantThresholds]);

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

  const applyStatusToSystemGroups = useCallback((status: Q1Status | null | undefined) => {
    if (!status) return;
    const buildMembers = (entries: Q1StatusEntry[] | undefined) =>
      (entries ?? []).map((entry) => ({
        symbol: entry.symbol,
        name: entry.name,
        type: (entry.symbol?.startsWith('^') ? 'index' : 'stock') as WatchItemType,
      }));
    const allCurrent = status.currentQ1 ?? [];
    const currentJPStatus = status.currentQ1JP ?? allCurrent.filter((entry) => entry.market === 'JP');
    const currentUSStatus = status.currentQ1US ?? allCurrent.filter((entry) => entry.market === 'US');
    syncSystemGroupMembers({ key: 'q1_jp', members: buildMembers(currentJPStatus) });
    syncSystemGroupMembers({ key: 'q1_us', members: buildMembers(currentUSStatus) });
  }, [syncSystemGroupMembers]);

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
        if (statusRes) {
          setQ1Status(statusRes);
          applyStatusToSystemGroups(statusRes);
        }
        const allCurrent = statusRes?.currentQ1 ?? [];
        let source: Q1StatusEntry[] = [];
        if (view === 'Q1_JP') {
          source = statusRes?.currentQ1JP ?? allCurrent.filter((entry) => entry.market === 'JP');
        } else {
          source = statusRes?.currentQ1US ?? allCurrent.filter((entry) => entry.market === 'US');
        }
        const itemsFromApi = q1EntriesToSnapshot(source, quadrantThresholds).filter((item) => item.quadrant === 'Q1');
        setItems(itemsFromApi);
        if (!itemsFromApi.length) {
          setErr(view === 'Q1_JP' ? 'No current Q1 constituents for Japan (strict thresholds).' : 'No current Q1 constituents for the US (strict thresholds).');
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
  }, [view, applyStatusToSystemGroups]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const status = await fetchQ1Status();
        if (cancelled) return;
        setQ1Status(status);
        applyStatusToSystemGroups(status);
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
  }, [applyStatusToSystemGroups]);

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
        <Scatter items={items} trails={trails || {}} xDomain={domain.v} yDomain={domain.f} />
        {/* Heatmap (F/V/A) */}
        <Heatmap items={items} />
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
            <Scatter items={items} trails={trails || {}} xDomain={domain.v} yDomain={domain.f} />
            <QList items={items} />
            <HelpBox kind="scatter" />
          </div>

          <div className="card">
            <div className="font-semibold mb-2">Heatmap (percentile)</div>
            <Heatmap items={items} />
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
          {(view === 'Q1_JP' || view === 'Q1_US') && q1Data?.history?.length ? (
            <div className="card">
              <div className="font-semibold mb-2">Q1 Watchlist ({view === 'Q1_JP' ? 'JP' : 'US'})</div>
              <Q1HistoryTable events={q1Data.history} market={view === 'Q1_JP' ? 'JP' : 'US'} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function Scatter({ items, trails, xDomain, yDomain }: { items: SnapshotItem[]; trails: Record<string, { t:number; F:number|null; V:number|null }[]>; xDomain: [number,number]; yDomain: [number,number]; }) {
  const w = 640, h = 400, pad = 30;
  const [xmin,xmax] = xDomain; const [ymin,ymax] = yDomain;
  const xscale = (v: number) => pad + (w-2*pad) * ((v - xmin) / Math.max(1e-9, (xmax - xmin)));
  const yscale = (v: number) => h - pad - (h-2*pad) * ((v - ymin) / Math.max(1e-9, (ymax - ymin)));
  return (
    <div className="relative w-full">
      <svg width={w} height={h} className="bg-gray-900 rounded border border-gray-700">
        <line x1={xscale(0)} y1={pad} x2={xscale(0)} y2={h-pad} stroke="#6b7280" strokeWidth="1" />
        <line x1={pad} y1={yscale(0)} x2={w-pad} y2={yscale(0)} stroke="#6b7280" strokeWidth="1" />
        <text x={w/2} y={h-6} fill="#9ca3af" fontSize="11" textAnchor="middle">V axis</text>
        <text x={12} y={h/2} fill="#9ca3af" fontSize="11" textAnchor="middle" transform={`rotate(-90 12 ${h/2})`}>F axis</text>
        {items.map((it) => {
          const x = it.V ?? NaN; const y = it.F ?? NaN;
          if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
          const cx = xscale(x), cy = yscale(y);
          return (
            <g key={it.id}>
              <circle cx={cx} cy={cy} r={6} fill={colorForQuad(it.quadrant)} opacity={0.9} />
              <title>{`${it.name} [${it.cls}]F=${it.F?.toFixed(2)} V=${it.V?.toFixed(2)} A=${it.A?.toFixed(2)} (${it.quadrant})`}</title>
            </g>
          );
        })}
        {items.filter(it => it.quadrant==='Q1' || it.quadrant==='Q4').map((it)=>{
          const pts = (trails[it.id]||[]).filter(p=>p.F!=null && p.V!=null);
          if (pts.length < 2) return null;
          const d = pts.map((p,i)=> (i===0? 'M':'L') + xscale(p.V as number) + ' ' + yscale(p.F as number)).join(' ');
          const stroke = it.quadrant==='Q1'? '#22c55e' : '#ef4444';
          return (
            <g key={'trail-'+it.id}>
              <path d={d} stroke={stroke} strokeOpacity={0.6} strokeWidth={1.5} fill="none" />
              {pts.map((p,i)=> <circle key={i} cx={xscale(p.V as number)} cy={yscale(p.F as number)} r={2} fill={stroke} fillOpacity={0.8} />)}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Heatmap({ items }: { items: SnapshotItem[] }) {
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
    let i = 0; while (i < sorted.length && sorted[i] < v) i++;
    return Math.round((i/(sorted.length-1)) * 100);
  };
  return (
    <div className="overflow-auto">
      <table className="w-full text-sm">
        <thead className="text-gray-400"><tr className="text-left">
          <th className="px-2 py-1">Asset</th>
          {cols.map(c => <th key={c} className="px-2 py-1 text-center">{c}</th>)}
          <th className="px-2 py-1 text-center">Quad</th>
        </tr></thead>
        <tbody>
          {sortedItems.map(it => {
            const ap = aPctl(it.A ?? null);
            return (
              <tr key={it.id} className="border-t border-gray-700">
                <td className="px-2 py-1">{it.name}</td>
                <td className="px-2 py-1 text-center"><Cell val={it.F} pctl={it.f_pctl} /></td>
                <td className="px-2 py-1 text-center"><Cell val={it.V} pctl={it.v_pctl} /></td>
                <td className="px-2 py-1 text-center"><Cell val={it.A ?? null} pctl={ap} /></td>
                <td className="px-2 py-1 text-center"><span className="px-2 py-0.5 rounded text-white" style={{ backgroundColor: colorForQuad(it.quadrant) }}>{it.quadrant}</span></td>
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



function QList({ items }: { items: SnapshotItem[] }) {
  const q1 = items.filter(i=>i.quadrant==='Q1');
  const q4 = items.filter(i=>i.quadrant==='Q4');
  const Chip = ({label}:{label:string}) => <span className="px-2 py-0.5 text-xs bg-gray-700 rounded mr-1 mb-1 inline-block">{label}</span>;
  return (
    <div className="mt-2 text-xs text-gray-300">
      <div className="mb-1"><span className="text-green-400 font-semibold mr-2">Q1:</span>{q1.length? q1.map(i=> <Chip key={i.id} label={i.name} />): <span className="text-gray-500">none</span>}</div>
      <div><span className="text-red-400 font-semibold mr-2">Q4:</span>{q4.length? q4.map(i=> <Chip key={i.id} label={i.name} />): <span className="text-gray-500">none</span>}</div>
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

function formatEventTimestamp(ts: number | null | undefined): string {
  if (!ts || !Number.isFinite(ts)) return 'n/a';
  try {
    return new Date(ts).toLocaleString('ja-JP', { hour12: false });
  } catch {
    return new Date(ts).toISOString();
  }
}

function eventLabel(type: Q1Event['type']): string {
  if (type === 'ENTER') return 'Entered Q1';
  if (type === 'DROP') return 'Dropped from Q1';
  return type;
}

function Q1HistoryTable({ events, market }: { events: Q1Event[]; market: 'JP' | 'US' }) {
  const filtered = events.filter((evt) => evt.market === market);
  if (!filtered.length) {
    return <div className="text-xs text-gray-400">No matching history.</div>;
  }
  const rows = filtered.slice(0, 40);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-xs text-gray-200">
        <thead className="text-gray-400 border-b border-gray-700">
          <tr>
            <th className="py-2 pr-3 text-left">Event</th>
            <th className="py-2 pr-3 text-left">Symbol</th>
            <th className="py-2 pr-3 text-left">Symbol</th>
            <th className="py-2 pr-3 text-left">Flow / Value</th>
            <th className="py-2 pr-3 text-left">?w?W</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((evt) => {
            const metrics = (evt.metrics ?? {}) as Q1Metrics;
            const key = `${evt.symbol}-${evt.ts}-${evt.type}`;
            return (
              <tr key={key} className="border-b border-gray-800/60">
                <td className="py-2 pr-3 text-gray-100">{eventLabel(evt.type)}</td>
                <td className="py-2 pr-3">
                  <div className="font-semibold text-white">{evt.symbol}</div>
                  <div className="text-[11px] text-gray-400">{evt.name}</div>
                </td>
                <td className="py-2 pr-3 text-gray-300">{formatEventTimestamp(evt.ts)}</td>
                <td className="py-2 pr-3 text-gray-300">
                  F: {metrics.F != null ? metrics.F.toFixed(2) : 'n/a'} / V: {metrics.V != null ? metrics.V.toFixed(2) : 'n/a'}
                </td>
                <td className="py-2 pr-3 text-gray-400">Flow% {metrics.flowPercentile ?? "n/a"} / Value% {metrics.valuePercentile ?? "n/a"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

