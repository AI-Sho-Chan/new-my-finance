import { useState } from 'react';
import { useStore } from '../store';

export default function WatchlistManager() {
  const watchlist = useStore((s) => [...s.watchlist].sort((a, b) => a.order - b.order));
  const add = useStore((s) => s.addWatch);
  const remove = useStore((s) => s.removeWatch);
  const reorder = useStore((s) => s.reorderWatch);
  const [symbol, setSymbol] = useState('');
  const [name, setName] = useState('');

  const onAdd = () => {
    if (!symbol.trim()) return;
    add(symbol.trim().toUpperCase(), name.trim() || symbol.trim().toUpperCase());
    setSymbol('');
    setName('');
  };

  return (
    <div className="card">
      <div className="font-semibold mb-2">ウォッチリスト管理</div>
      <div className="flex gap-2 mb-3">
        <input placeholder="シンボル(AAPL, 7203.Tなど)" className="input flex-1" value={symbol} onChange={(e) => setSymbol(e.target.value)} />
        <input placeholder="名称(任意)" className="input flex-1" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="button" onClick={onAdd}>追加</button>
      </div>
      <ul className="space-y-2">
        {watchlist.map((w) => (
          <li key={w.id} className="flex items-center justify-between bg-gray-700 rounded px-2 py-1">
            <div className="truncate">{w.symbol} — {w.name}</div>
            <div className="flex items-center gap-2">
              <button className="px-2 py-1 bg-gray-600 rounded" onClick={() => reorder(w.id, 'up')}>↑</button>
              <button className="px-2 py-1 bg-gray-600 rounded" onClick={() => reorder(w.id, 'down')}>↓</button>
              <button className="px-2 py-1 bg-red-600 text-white rounded" onClick={() => remove(w.id)}>削除</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
