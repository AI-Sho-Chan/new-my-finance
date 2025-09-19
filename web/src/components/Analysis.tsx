import { useEffect, useMemo, useState } from 'react';
import { computeSnapshotWithTrails, DEFAULT_PARAMS, type SnapshotItem, type SnapshotTrails, type SnapshotMeta, UNIVERSE, UNIVERSE_US_SECTORS, UNIVERSE_JP_SECTORS, type AssetDef } from '../lib/analysis';
import { useStore } from '../store';
import { collectGroupItemIds } from '../lib/watch-helpers';
import type { WatchItem } from '../types';

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
  const [view, setView] = useState<'GLOBAL' | 'US_SECTOR' | 'JP_SECTOR' | 'ALL_WATCH'>('GLOBAL');

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
      .filter((item): item is WatchItem => Boolean(item))
      .map((item) => ({ symbol: item.symbol, name: item.name }));
  }, [allGroup, watchItemsMap]);
  const mergedWatch = storeWatch.length ? storeWatch : nmyWatch;
  const watchKey = useMemo(() => mergedWatch.map((w) => w.symbol).join(','), [mergedWatch]);

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
    let alive = true;
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
      view==='US_SECTOR' ? UNIVERSE_US_SECTORS :
      view==='JP_SECTOR' ? UNIVERSE_JP_SECTORS :
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
      return () => { alive = false; };
    }

    computeSnapshotWithTrails(DEFAULT_PARAMS, uni, 6)
      .then((r) => { if (alive) { setItems(r.items); setTrails(r.trails); setMeta(r.meta); } })
      .catch((e) => setErr(String(e?.message || e)))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [view, watchKey]);

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
        <Scatter items={items} trails={trails || {}} domain={domain} />
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
        <button className={`px-2 py-1 rounded ${view==='US_SECTOR'?'bg-indigo-600 text-white':'bg-gray-700 text-gray-200'}`} onClick={()=>setView('US_SECTOR')}>US Sectors</button>
        <button className={`px-2 py-1 rounded ${view==='JP_SECTOR'?'bg-indigo-600 text-white':'bg-gray-700 text-gray-200'}`} onClick={()=>setView('JP_SECTOR')}>JP Sectors</button>
        <button className={`px-2 py-1 rounded ${view==='ALL_WATCH'?'bg-indigo-600 text-white':'bg-gray-700 text-gray-200'}`} onClick={()=>setView('ALL_WATCH')}>ALL</button>
      </div>

      {loading && <div className="card">Loading...</div>}
      {err && <div className="card text-red-400">{err}</div>}
      {items && (
        <>
          <div className="card">
            <div className="flex items-center justify-between">
              <div className="font-semibold mb-2">F×V Scatter (x=V, y=F)</div>
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
          {items.map(it => {
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
  const box = (c: string, label: string) => (
    <span className="inline-flex items-center text-xs text-gray-300 mr-2">
      <span className="inline-block w-3 h-3 rounded-sm mr-1" style={{ backgroundColor: c }} />{label}
    </span>
  );
  return (
    <div className="text-xs text-gray-300">
      {box('#22c55e', 'Q1: strong & value')}
      {box('#f59e0b', 'Q2: strong & rich')}
      {box('#3b82f6', 'Q3: weak but value')}
      {box('#ef4444', 'Q4: avoid')}
    </div>
  );
}

function HelpBox({ kind }: { kind: 'scatter' | 'heat' }) {
  if (kind === 'scatter') {
    return (
      <details className="mt-2 text-xs text-gray-300">
        <summary className="cursor-pointer select-none">How to read (F×V scatter)</summary>
        <div className="mt-1 leading-relaxed">
          <p>F: multi-horizon flow (20/63/252d) z-score; V: value (weekly 5y trend deviation) z-score (higher = cheaper).</p>
          <p>Quadrants: Q1 strong & value, Q2 strong & rich, Q3 weak but value, Q4 avoid.</p>
        </div>
      </details>
    );
  }
  return (
    <details className="mt-2 text-xs text-gray-300">
      <summary className="cursor-pointer select-none">How to read (heatmap)</summary>
      <div className="mt-1 leading-relaxed">
        <p>Cells show raw scores; background is percentile among current cross-section.</p>
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




