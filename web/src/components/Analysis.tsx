import { useEffect, useMemo, useState } from 'react';
import { computeSnapshot, DEFAULT_PARAMS, type SnapshotItem } from '../lib/analysis';

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

export default function Analysis() {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<SnapshotItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setErr(null);
    computeSnapshot(DEFAULT_PARAMS).then((r) => { if (alive) setItems(r.items); }).catch((e) => setErr(String(e?.message||e))).finally(()=> alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  const domain = useMemo(() => {
    if (!items) return { f:[-3,3] as [number,number], v:[-3,3] as [number,number] };
    const fVals = items.map(i => i.F ?? 0).filter(Number.isFinite);
    const vVals = items.map(i => i.V ?? 0).filter(Number.isFinite);
    const fmin = Math.min(...fVals, -3), fmax = Math.max(...fVals, 3);
    const vmin = Math.min(...vVals, -3), vmax = Math.max(...vVals, 3);
    return { f:[fmin,fmax] as [number,number], v:[vmin,vmax] as [number,number] };
  }, [JSON.stringify(items)]);

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold text-gray-200">相対力ダッシュボード</h2>

      {loading && <div className="card">計算中...</div>}
      {err && <div className="card text-red-400">{err}</div>}
      {items && (
        <>
          <div className="card">
            <div className="font-semibold mb-2">F×V 散布図（x=V, y=F）</div>
            <Scatter items={items} xDomain={domain.v} yDomain={domain.f} />
            <div className="text-xs text-gray-400 mt-1">色: 四象限 Q1=緑, Q2=橙, Q3=青, Q4=赤, N/A=灰</div>
          </div>

          <div className="card">
            <div className="font-semibold mb-2">ヒートマップ（パーセンタイル）</div>
            <Heatmap items={items} />
          </div>
        </>
      )}
    </div>
  );
}

function Scatter({ items, xDomain, yDomain }: { items: SnapshotItem[]; xDomain: [number,number]; yDomain: [number,number]; }) {
  const w = 640, h = 400, pad = 30;
  const [xmin,xmax] = xDomain; const [ymin,ymax] = yDomain;
  const xscale = (v: number) => pad + (w-2*pad) * ((v - xmin) / Math.max(1e-9, (xmax - xmin)));
  const yscale = (v: number) => h - pad - (h-2*pad) * ((v - ymin) / Math.max(1e-9, (ymax - ymin)));
  return (
    <div className="relative w-full overflow-auto">
      <svg width={w} height={h} className="bg-gray-900 rounded border border-gray-700">
        <line x1={xscale(0)} y1={pad} x2={xscale(0)} y2={h-pad} stroke="#6b7280" strokeWidth="1" />
        <line x1={pad} y1={yscale(0)} x2={w-pad} y2={yscale(0)} stroke="#6b7280" strokeWidth="1" />
        {items.map((it) => {
          const x = it.V ?? NaN; const y = it.F ?? NaN;
          if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
          return (
            <g key={it.id}>
              <circle cx={xscale(x)} cy={yscale(y)} r={6} fill={colorForQuad(it.quadrant)} opacity={0.85} />
              <title>{`${it.name}\nF=${it.F?.toFixed(2)} V=${it.V?.toFixed(2)} A=${it.A?.toFixed(2)} (${it.quadrant})`}</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Heatmap({ items }: { items: SnapshotItem[] }) {
  const cols = ['F','V','A'] as const;
  return (
    <div className="overflow-auto">
      <table className="w-full text-sm">
        <thead className="text-gray-400"><tr className="text-left">
          <th className="px-2 py-1">資産</th>
          {cols.map(c => <th key={c} className="px-2 py-1 text-center">{c}</th>)}
          <th className="px-2 py-1 text-center">四象限</th>
        </tr></thead>
        <tbody>
          {items.map(it => (
            <tr key={it.id} className="border-t border-gray-700">
              <td className="px-2 py-1">{it.name}</td>
              <td className="px-2 py-1 text-center"><Cell val={it.F} pctl={it.f_pctl} /></td>
              <td className="px-2 py-1 text-center"><Cell val={it.V} pctl={it.v_pctl} /></td>
              <td className="px-2 py-1 text-center"><span className="px-2 py-0.5 rounded text-white" style={{ backgroundColor: colorForQuad(it.quadrant) }}>{it.quadrant}</span></td>
            </tr>
          ))}
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

