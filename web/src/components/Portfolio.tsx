import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import type { AssetItem } from '../types';
import { fetchMarketQuotes } from '../lib/data';
import PortfolioChart from './PortfolioChart';

type ValuedAsset = AssetItem & { valueJPY: number; changeJPY: number; gainLossPercent?: number };

export default function Portfolio() {
  const portfolio = useStore((s) => [...s.portfolio].sort((a, b) => a.order - b.order));
  const remove = useStore((s) => s.removeAsset);
  const reorder = useStore((s) => s.reorderAsset);

  const symbols = useMemo(() => Array.from(new Set(portfolio.flatMap((a) => (a.type === 'STOCK' || a.type === 'CRYPTO') ? [a.details.symbol] : (a.type === 'CASH' && a.details.currency === 'USD' ? ['USDJPY=X'] : [])))), [portfolio]);
  const [quotes, setQuotes] = useState<any>({});

  useEffect(() => {
    if (!symbols.length) return;
    let mounted = true;
    fetchMarketQuotes(symbols).then((q) => mounted && setQuotes(q));
    return () => { mounted = false; };
  }, [symbols.join(',')]);

  const valued: ValuedAsset[] = useMemo(() => {
    return portfolio.map((a) => {
      if (a.type === 'CASH') {
        const rate = a.details.currency === 'USD' ? (quotes['USDJPY=X']?.price ?? a.details.rateJPY ?? 150) : 1;
        const valueJPY = a.details.currency === 'USD' ? a.details.amount * rate : a.details.amount;
        return { ...a, valueJPY, changeJPY: 0 } as ValuedAsset;
      }
      const quote = quotes[a.details.symbol];
      if (!quote) return { ...a, valueJPY: 0, changeJPY: 0 } as ValuedAsset;
      const current = quote.price * a.details.qty;
      const prev = quote.prevClose * a.details.qty;
      const change = (current - prev) * (quote.currency === 'USD' ? (quotes['USDJPY=X']?.price ?? 150) : 1);
      const valueJPY = current * (quote.currency === 'USD' ? (quotes['USDJPY=X']?.price ?? 150) : 1);
      const cost = a.details.avgPrice * a.details.qty * (quote.currency === 'USD' ? (quotes['USDJPY=X']?.price ?? 150) : 1);
      const gainLossPercent = cost > 0 ? ((valueJPY - cost) / cost) * 100 : undefined;
      return { ...a, valueJPY, changeJPY: change, gainLossPercent } as ValuedAsset;
    });
  }, [JSON.stringify(portfolio), JSON.stringify(quotes)]);

  const totals = useMemo(() => {
    const total = valued.reduce((sum, a) => sum + a.valueJPY, 0);
    const cash = valued.filter((a) => a.type === 'CASH').reduce((s, a) => s + a.valueJPY, 0);
    const invest = total - cash;
    // 参考: トップカードは前日比ではなく「購入時からの騰落率」を個別項目で表示
    // トータルの前日比はダミーのまま据置（UI上は表示しない）
    return { total, cash, invest };
  }, [JSON.stringify(valued)]);

  // Simple aggregate timeseries using random-walk around current totals (for demo/self-contained)
  const timeseries = useMemo(() => {
    const days = 120;
    const now = Date.now();
    const out: { time: number; total: number; cash: number; invest: number }[] = [];
    let t = totals.total * 0.8;
    for (let i = days - 1; i >= 0; i--) {
      const time = Math.floor((now - i * 24 * 3600 * 1000) / 1000);
      t = t * (1 + (Math.random() - 0.48) * 0.01);
      const cash = totals.cash * (1 + (Math.random() - 0.5) * 0.002);
      const invest = t - cash;
      out.push({ time, total: Math.max(0, t), cash: Math.max(0, cash), invest: Math.max(0, invest) });
    }
    return out;
  }, [totals.total, totals.cash]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const update = useStore((s) => s.updateAsset);

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold text-gray-200">資産管理</h2>
      <AddAssetForm />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card"><div className="text-sm text-gray-400">総資産</div><div className="text-2xl font-bold">{Math.round(totals.total).toLocaleString()} 円</div></div>
        <div className="card"><div className="text-sm text-gray-400">現金資産</div><div className="text-2xl font-bold">{Math.round(totals.cash).toLocaleString()} 円</div></div>
        <div className="card"><div className="text-sm text-gray-400">投資資産</div><div className="text-2xl font-bold">{Math.round(totals.invest).toLocaleString()} 円</div></div>
      </div>

      <div className="card">
        <div className="font-semibold mb-2">資産推移</div>
        <PortfolioChart data={timeseries} />
      </div>

      <div className="card">
        <div className="font-semibold mb-2">保有一覧</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500">
              <th className="py-1">種類</th>
              <th>ラベル</th>
              <th>詳細</th>
              <th className="text-right">評価額(円)</th>
              <th className="text-right">騰落率</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {valued.map((a) => (
              <EditableRow
                key={a.id}
                asset={a}
                isEditing={editingId === a.id}
                onEdit={() => setEditingId(a.id)}
                onCancel={() => setEditingId(null)}
                onSave={(next) => { update(a.id, () => next as any); setEditingId(null); }}
                onMoveUp={() => reorder(a.id, 'up')}
                onMoveDown={() => reorder(a.id, 'down')}
                onDelete={() => remove(a.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EditableRow({ asset, isEditing, onEdit, onCancel, onSave, onMoveUp, onMoveDown, onDelete }: {
  asset: ValuedAsset;
  isEditing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (a: AssetItem) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  const [local, setLocal] = useState<AssetItem>(asset);
  useEffect(() => setLocal(asset), [asset.id]);
  if (!isEditing) {
    return (
      <tr className="border-t border-gray-200 dark:border-gray-700">
        <td className="py-1">{asset.type}</td>
        <td>{asset.label}</td>
        <td>
          {asset.type === 'CASH' && `${asset.details.currency} ${asset.details.amount.toLocaleString()}`}
          {asset.type === 'STOCK' && `${asset.details.symbol} x ${asset.details.qty} @ ${asset.details.avgPrice}`}
          {asset.type === 'CRYPTO' && `${asset.details.symbol} x ${asset.details.qty} @ ${asset.details.avgPrice}`}
        </td>
        <td className="text-right">{Math.round((asset as any).valueJPY).toLocaleString()}</td>
        <td className={`text-right ${((asset as any).gainLossPercent ?? 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
          {(asset as any).gainLossPercent != null ? `${(asset as any).gainLossPercent >= 0 ? '+' : ''}${(asset as any).gainLossPercent.toFixed(2)}%` : '—'}
        </td>
        <td className="text-right">
          <button className="px-2 py-1 bg-gray-300 dark:bg-gray-600 rounded mr-2" onClick={onMoveUp}>↑</button>
          <button className="px-2 py-1 bg-gray-300 dark:bg-gray-600 rounded mr-2" onClick={onMoveDown}>↓</button>
          <button className="px-2 py-1 bg-gray-300 dark:bg-gray-600 rounded mr-2" onClick={onEdit}>編集</button>
          <button className="px-2 py-1 bg-red-600 text-white rounded" onClick={onDelete}>削除</button>
        </td>
      </tr>
    );
  }
  return (
    <tr className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
      <td className="py-1">{local.type}</td>
      <td><input className="input w-full" value={local.label} onChange={(e) => setLocal({ ...local, label: e.target.value })} /></td>
      <td>
        {local.type === 'CASH' && (
          <div className="flex gap-2">
            <select className="input" value={local.details.currency} onChange={(e) => setLocal({ ...local, details: { ...(local as any).details, currency: e.target.value } as any })}>
              <option value="JPY">JPY</option>
              <option value="USD">USD</option>
            </select>
            <input type="number" className="input" value={(local as any).details.amount}
                   onChange={(e) => setLocal({ ...local, details: { ...(local as any).details, amount: parseFloat(e.target.value) } as any })} />
          </div>
        )}
        {(local.type === 'STOCK' || local.type === 'CRYPTO') && (
          <div className="flex gap-2">
            <input className="input w-28" value={(local as any).details.symbol}
                   onChange={(e) => setLocal({ ...local, details: { ...(local as any).details, symbol: e.target.value.toUpperCase() } as any })} />
            <input type="number" className="input w-28" value={(local as any).details.avgPrice}
                   onChange={(e) => setLocal({ ...local, details: { ...(local as any).details, avgPrice: parseFloat(e.target.value) } as any })} />
            <input type="number" className="input w-20" value={(local as any).details.qty}
                   onChange={(e) => setLocal({ ...local, details: { ...(local as any).details, qty: parseFloat(e.target.value) } as any })} />
          </div>
        )}
      </td>
      <td className="text-right">—</td>
      <td className="text-right">—</td>
      <td className="text-right">
        <button className="px-2 py-1 bg-gray-300 dark:bg-gray-600 rounded mr-2" onClick={onCancel}>取消</button>
        <button className="px-2 py-1 bg-blue-600 text-white rounded" onClick={() => onSave(local)}>保存</button>
      </td>
    </tr>
  );
}

function AddAssetForm() {
  const add = useStore((s) => s.addAsset);
  const [type, setType] = useState<'CASH' | 'STOCK' | 'CRYPTO'>('CASH');
  const [label, setLabel] = useState('');
  const [currency, setCurrency] = useState<'JPY' | 'USD'>('JPY');
  const [amount, setAmount] = useState<number>(0);
  const [symbol, setSymbol] = useState('');
  const [avgPrice, setAvgPrice] = useState<number>(0);
  const [qty, setQty] = useState<number>(0);

  const onAdd = () => {
    if (!label.trim()) return;
    if (type === 'CASH') {
      add({ type, label: label.trim(), order: 9999, details: { currency, amount } } as any);
    } else {
      if (!symbol.trim()) return;
      add({ type, label: label.trim(), order: 9999, details: { symbol: symbol.trim().toUpperCase(), avgPrice, qty } } as any);
    }
    setLabel(''); setAmount(0); setSymbol(''); setAvgPrice(0); setQty(0);
  };

  return (
    <div className="card">
      <div className="font-semibold mb-2">資産を追加</div>
      <div className="grid grid-cols-1 sm:grid-cols-6 gap-2 items-end">
        <div>
          <label className="block text-xs text-gray-500">種類</label>
          <select className="input" value={type} onChange={(e) => setType(e.target.value as any)}>
            <option value="CASH">CASH</option>
            <option value="STOCK">STOCK</option>
            <option value="CRYPTO">CRYPTO</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs text-gray-500">ラベル</label>
          <input className="input w-full" placeholder="口座名やメモ" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        {type === 'CASH' ? (
          <>
            <div>
              <label className="block text-xs text-gray-500">通貨</label>
              <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value as any)}>
                <option value="JPY">JPY</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500">金額</label>
              <input type="number" className="input" value={amount} onChange={(e) => setAmount(parseFloat(e.target.value))} />
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="block text-xs text-gray-500">シンボル</label>
              <input className="input" placeholder="AAPL, 7203.T等" value={symbol} onChange={(e) => setSymbol(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-gray-500">取得単価</label>
              <input type="number" className="input" value={avgPrice} onChange={(e) => setAvgPrice(parseFloat(e.target.value))} />
            </div>
            <div>
              <label className="block text-xs text-gray-500">数量</label>
              <input type="number" className="input" value={qty} onChange={(e) => setQty(parseFloat(e.target.value))} />
            </div>
          </>
        )}
        <div>
          <button className="button" onClick={onAdd}>追加</button>
        </div>
      </div>
    </div>
  );
}
