import { useEffect, useMemo, useState } from 'react';
import { computeSnapshotWithTrails, DEFAULT_PARAMS, type SnapshotItem, type SnapshotTrails, type SnapshotMeta, UNIVERSE, UNIVERSE_US_SECTORS, UNIVERSE_JP_SECTORS, type AssetDef } from '../lib/analysis';
import { useStore } from '../store';

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
  const [view, setView] = useState<'GLOBAL' | 'US_SECTOR' | 'JP_SECTOR' | 'US_STOCKS' | 'JP_STOCKS'>('GLOBAL');

  useEffect(() => {
    let alive = true;
    setLoading(true); setErr(null);
    const wl = (useStore.getState().watchlist || []) as any[];
    const watchUS: AssetDef[] = wl.filter(w=>!String(w.symbol).endsWith('.T')).map(w=>({ id:w.symbol, name:w.name||w.symbol, cls:'EQ', symbol:String(w.symbol), currency:'USD' }));
    const watchJP: AssetDef[] = wl.filter(w=> String(w.symbol).endsWith('.T')).map(w=>({ id:w.symbol, name:w.name||w.symbol, cls:'EQ', symbol:String(w.symbol), currency:'JPY', priceToUSD:'JPY' }));
    const uni: AssetDef[] = (
      view==='GLOBAL' ? UNIVERSE :
      view==='US_SECTOR' ? UNIVERSE_US_SECTORS :
      view==='JP_SECTOR' ? UNIVERSE_JP_SECTORS :
      view==='US_STOCKS' ? watchUS : watchJP
    );
    computeSnapshotWithTrails(DEFAULT_PARAMS, uni, 6)
      .then((r) => { if (alive) { setItems(r.items); setTrails(r.trails); setMeta(r.meta); } })
      .catch((e) => setErr(String(e?.message||e)))
      .finally(()=> alive && setLoading(false));
    return () => { alive = false; };
  }, [view]);

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
      {!bare && <h2 className="text-2xl font-semibold text-gray-200">相対力ダッシュボード</h2>}
      {/* View Selector */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-gray-400">ビュー:</span>
        <button className={`px-2 py-1 rounded ${view==='GLOBAL'?'bg-indigo-600 text-white':'bg-gray-700 text-gray-200'}`} onClick={()=>setView('GLOBAL')}>グローバル</button>
        <button className={`px-2 py-1 rounded ${view==='US_SECTOR'?'bg-indigo-600 text-white':'bg-gray-700 text-gray-200'}`} onClick={()=>setView('US_SECTOR')}>米国セクター</button>
        <button className={`px-2 py-1 rounded ${view==='JP_SECTOR'?'bg-indigo-600 text-white':'bg-gray-700 text-gray-200'}`} onClick={()=>setView('JP_SECTOR')}>日本セクター</button>
        <span className="mx-2 text-gray-600">|</span>
        <button className={`px-2 py-1 rounded ${view==='US_STOCKS'?'bg-indigo-600 text-white':'bg-gray-700 text-gray-200'}`} onClick={()=>setView('US_STOCKS')}>米国株（ウォッチ）</button>
        <button className={`px-2 py-1 rounded ${view==='JP_STOCKS'?'bg-indigo-600 text-white':'bg-gray-700 text-gray-200'}`} onClick={()=>setView('JP_STOCKS')}>日本株（ウォッチ）</button>
      </div>

      {loading && <div className="card">計算中...</div>}
      {err && <div className="card text-red-400">{err}</div>}
      {items && (
        <>
          <div className="card">
            <div className="flex items-center justify-between">
              <div className="font-semibold mb-2">F×V 散布図（x=V, y=F）</div>
              <LegendQuadrant />
            </div>
            <Scatter items={items} trails={trails || {}} xDomain={domain.v} yDomain={domain.f} />
            <QList items={items} />
            <HelpBox kind="scatter" />
          </div>

          <div className="card">
            <div className="font-semibold mb-2">ヒートマップ（パーセンタイル）</div>
            <Heatmap items={items} />
            <HelpBox kind="heat" />
          </div>
          {meta && (
            <div className="card text-xs text-gray-300">
              <div className="font-semibold mb-2">N/A の理由（推定）</div>
              <ul className="list-disc pl-5">
                {items.filter(it => it.F==null || it.V==null).map(it => {
                  const m = (meta as any)[it.id] || { dLen: 0, wLen: 0 };
                  const reasons: string[] = [];
                  if (it.F==null) reasons.push(`F: 期間不足（必要~252営業日）/データ欠損（D=${m.dLen}）`);
                  if (it.V==null) reasons.push(`V: 期間不足（必要~40週）/データ欠損（W=${m.wLen}）`);
                  return <li key={it.id}><span className="font-semibold mr-1">{it.name}</span><span className="text-gray-400">{reasons.join(' / ')}</span></li>;
                })}
                {items.every(it=> it.F!=null && it.V!=null) && <li>すべて算出済み</li>}
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
        {/* axis labels */}
        <text x={w/2} y={h-6} fill="#9ca3af" fontSize="11" textAnchor="middle">V（割安度：+割安 / −割高）</text>
        <text x={12} y={h/2} fill="#9ca3af" fontSize="11" textAnchor="middle" transform={`rotate(-90 12 ${h/2})`}>F（フロー/勢い）</text>
        {/* quadrant captions */}
        <text x={w-pad-4} y={pad+12} fill="#22c55e" fontSize="11" textAnchor="end">Q1: 勢い×割安</text>
        <text x={pad+4} y={pad+12} fill="#f59e0b" fontSize="11">Q2: 勢いのみ</text>
        <text x={w-pad-4} y={h-pad-6} fill="#3b82f6" fontSize="11" textAnchor="end">Q3: 割安だが弱い</text>
        <text x={pad+4} y={h-pad-6} fill="#ef4444" fontSize="11">Q4: 回避候補</text>
        {items.map((it) => {
          const x = it.V ?? NaN; const y = it.F ?? NaN;
          if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
          const cx = xscale(x), cy = yscale(y);
          return (
            <g key={it.id}>
              {markerForClass(it.cls as any, cx, cy, 7, colorForQuad(it.quadrant))}
              <title>{`${it.name} [${it.cls}]\nF=${it.F?.toFixed(2)} V=${it.V?.toFixed(2)} A=${it.A?.toFixed(2)} (${it.quadrant})`}</title>
            </g>
          );
        })}
        {/* trails for Q1/Q4 items over the past 6 months */}
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
        {/* Labels for Q1 & Q4 with simple collision avoidance */}
        {placeLabels(items.filter(it => it.quadrant==='Q1' || it.quadrant==='Q4'), xscale, yscale).map((lb,i)=>(
          <g key={`lbl-${i}`}>
            <line x1={lb.x} y1={lb.y} x2={lb.lx} y2={lb.ly} stroke="#94a3b8" strokeWidth="1" />
            <rect x={lb.lx-2} y={lb.ly-10} width={lb.w+4} height={12} rx={2} fill="#0f172a" stroke="#475569" />
            <text x={lb.lx} y={lb.ly} fill="#e5e7eb" fontSize="10">{lb.text}</text>
          </g>
        ))}
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
          <th className="px-2 py-1">資産</th>
          {cols.map(c => <th key={c} className="px-2 py-1 text-center">{c}</th>)}
          <th className="px-2 py-1 text-center">四象限</th>
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
      {box('#22c55e', 'Q1: 勢い×割安')}
      {box('#f59e0b', 'Q2: 勢いのみ')}
      {box('#3b82f6', 'Q3: 割安だが弱い')}
      {box('#ef4444', 'Q4: 回避候補')}
    </div>
  );
}

function HelpBox({ kind }: { kind: 'scatter' | 'heat' }) {
  if (kind === 'scatter') {
    return (
      <details className="mt-2 text-xs text-gray-300">
        <summary className="cursor-pointer select-none">図の見方（F×V散布図）</summary>
        <div className="mt-1 leading-relaxed">
          <p>縦軸Fはフロー/勢い（20/63/252日のリスク調整モメンタムを重み付け合成）。横軸Vは割安度（5年トレンドからの乖離zの反転）。</p>
          <p>四象限の意味: Q1=勢い×割安（強気候補）、Q2=勢いのみ、Q3=割安だが弱い（逆張り候補）、Q4=回避候補。</p>
          <p>形状で資産クラスを区別: ●株式、■債券、▲コモ、◆通貨、★暗号資産、⬡REIT。</p>
          <p>投資家への示唆: Q1の点を優先候補として監視、Q2は短期順張り、Q3は反発待ち、Q4は避ける/縮小。</p>
        </div>
      </details>
    );
  }
  return (
    <details className="mt-2 text-xs text-gray-300">
      <summary className="cursor-pointer select-none">図の見方（ヒートマップ）</summary>
      <div className="mt-1 leading-relaxed">
        <p>F=勢い（上ほど強い）、V=割安度（上ほど割安）、A=総合=λF+(1−λ)V（既定λ=0.6）。</p>
        <p>色は横断パーセンタイル：緑=上位（良好）、赤=下位（弱い）、灰=データ不足(N/A)。</p>
        <p>投資家への示唆: FとVがともに高い銘柄（行）が相対的に魅力的。Aは総合順位として活用。</p>
      </div>
    </details>
  );
}

function markerForClass(cls: string, cx: number, cy: number, r: number, fill: string) {
  switch (cls) {
    case 'BOND':
      return <rect x={cx - r} y={cy - r} width={2*r} height={2*r} fill={fill} rx={2} opacity={0.9} />;
    case 'CMD': // triangle up
      return <polygon points={`${cx},${cy - r} ${cx - r},${cy + r} ${cx + r},${cy + r}`} fill={fill} opacity={0.9} />;
    case 'FX': // diamond
      return <polygon points={`${cx},${cy - r} ${cx - r},${cy} ${cx},${cy + r} ${cx + r},${cy}`} fill={fill} opacity={0.9} />;
    case 'CRYPTO': // star (simple)
      const p = starPath(cx, cy, r, r/2, 5); return <path d={p} fill={fill} opacity={0.9} />;
    case 'REIT': // hexagon
      return <polygon points={hexPoints(cx, cy, r).join(' ')} fill={fill} opacity={0.9} />;
    default: // EQ circle
      return <circle cx={cx} cy={cy} r={r} fill={fill} opacity={0.9} />;
  }
}

function starPath(cx: number, cy: number, R: number, r: number, spikes: number) {
  let rot = Math.PI / 2 * 3; let x = cx; let y = cy; const step = Math.PI / spikes; let path = '';
  path += `M ${cx} ${cy - R}`;
  for (let i=0;i<spikes;i++){
    x = cx + Math.cos(rot) * R; y = cy + Math.sin(rot) * R; path += ` L ${x} ${y}`; rot += step;
    x = cx + Math.cos(rot) * r; y = cy + Math.sin(rot) * r; path += ` L ${x} ${y}`; rot += step;
  }
  path += ' Z';
  return path;
}

function hexPoints(cx: number, cy: number, r: number) {
  const pts: string[] = [];
  for (let i=0;i<6;i++){
    const a = Math.PI/3 * i - Math.PI/6; // flat top
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    pts.push(`${x},${y}`);
  }
  return pts;
}

function placeLabels(items: SnapshotItem[], xs: (v:number)=>number, ys: (v:number)=>number) {
  const boxes: {x:number;y:number;w:number;h:number}[] = [];
  const out: { x:number; y:number; lx:number; ly:number; w:number; text:string }[] = [];
  const pos = [
    {dx: 10, dy:-10}, {dx: 10, dy:10}, {dx:-10, dy:-10}, {dx:-10, dy:10},
    {dx: 12, dy:0}, {dx:-12, dy:0}, {dx:0, dy:-12}, {dx:0, dy:12},
  ];
  for (const it of items) {
    if (it.V==null || it.F==null) continue;
    const x = xs(it.V), y = ys(it.F);
    const text = it.name;
    const w = Math.min(160, Math.max(40, text.length * 6)); const h = 10;
    let placed:null|{lx:number;ly:number} = null;
    for (const p of pos) {
      const lx = x + p.dx; const ly = y + p.dy;
      const b = { x: lx, y: ly-9, w, h: 11 };
      const coll = boxes.some(bb => !(b.x + b.w < bb.x || bb.x + bb.w < b.x || b.y + b.h < bb.y || bb.y + bb.h < b.y));
      if (!coll) { placed = { lx, ly }; boxes.push(b); break; }
    }
    if (!placed) { placed = { lx: x + 10, ly: y + 10 }; boxes.push({ x: placed.lx, y: placed.ly-9, w, h: 11 }); }
    out.push({ x, y, lx: placed.lx, ly: placed.ly, w, text });
  }
  return out;
}

function QList({ items }: { items: SnapshotItem[] }) {
  const q1 = items.filter(i => i.quadrant === 'Q1');
  const q4 = items.filter(i => i.quadrant === 'Q4');
  const Chip = ({ label }: { label: string }) => (
    <span className="px-2 py-0.5 text-xs bg-gray-700 rounded mr-1 mb-1 inline-block">{label}</span>
  );
  return (
    <div className="mt-2 text-xs text-gray-300">
      <div className="mb-1">
        <span className="text-green-400 font-semibold mr-2">Q1:</span>
        {q1.length ? q1.map(i => <Chip key={i.id} label={i.name} />) : <span className="text-gray-500">なし</span>}
      </div>
      <div>
        <span className="text-red-400 font-semibold mr-2">Q4:</span>
        {q4.length ? q4.map(i => <Chip key={i.id} label={i.name} />) : <span className="text-gray-500">なし</span>}
      </div>
    </div>
  );
}
