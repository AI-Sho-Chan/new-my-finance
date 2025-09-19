import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useStore } from '../store';
import type { AssetItem } from '../types';
import { fetchMarketQuotes } from '../lib/data';
import PortfolioChart from './PortfolioChart';
import SymbolSearch from './SymbolSearch';
import type { SymbolSearchResult } from '../lib/symbols';

type ValuedAsset = AssetItem & {
  valueJPY: number;
  changeJPY: number;
  costJPY: number;
  gainLossPercent?: number;
};

type SortKey = 'order' | 'type' | 'label' | 'valueJPY' | 'gainLoss';
type SortState = { key: SortKey; direction: 'asc' | 'desc' };

const DEFAULT_SORT: SortState = { key: 'order', direction: 'asc' };

const toFiniteNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
};

const formatJPY = (value: number) => (Number.isFinite(value) ? Math.round(value).toLocaleString('ja-JP') : '--');

export default function Portfolio() {
  const portfolio = useStore((s) => [...s.portfolio].sort((a, b) => a.order - b.order));
  const remove = useStore((s) => s.removeAsset);
  const reorder = useStore((s) => s.reorderAsset);
  const update = useStore((s) => s.updateAsset);
  const setPortfolioComputed = useStore((s) => s.setPortfolioComputed);
  const portfolioHistory = useStore((s) => s.portfolioHistory);
  const loadPortfolioBackup = useStore((s) => s.loadPortfolioBackup);

  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const computedSignatureRef = useRef<string | null>(null);
  const [searchSymbols] = useState(() => new Set<string>());

  const symbols = useMemo(() => {
    const list = Array.from(
      new Set(
        portfolio.flatMap((a) =>
          a.type === 'STOCK' || a.type === 'CRYPTO'
            ? [a.details.symbol]
            : a.type === 'CASH' && a.details.currency === 'USD'
              ? ['USDJPY=X']
              : []
        )
      )
    );
    list.forEach((sym) => searchSymbols.add(sym));
    return list;
  }, [portfolio, searchSymbols]);

  const [quotes, setQuotes] = useState<Record<string, any>>({});

  useEffect(() => {
    if (!symbols.length) return;
    let mounted = true;
    fetchMarketQuotes(symbols)
      .then((q) => {
        if (mounted) setQuotes(q);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [symbols.join(',')]);

  const valued: ValuedAsset[] = useMemo(() => {
    const usdRate = quotes['USDJPY=X']?.price;
    return portfolio.map((a) => {
      if (a.type === 'CASH') {
        const amount = toFiniteNumber(a.details.amount);
        const fx = a.details.currency === 'USD' ? toFiniteNumber(usdRate ?? a.details.rateJPY, 150) : 1;
        const valueJPY = amount * fx;
        return {
          ...a,
          valueJPY: Number.isFinite(valueJPY) ? valueJPY : 0,
          changeJPY: 0,
          costJPY: valueJPY,
        } as ValuedAsset;
      }

      const quote = quotes[a.details.symbol];
      if (!quote) {
        return { ...a, valueJPY: 0, changeJPY: 0, costJPY: 0 } as ValuedAsset;
      }

      const fx = quote.currency === 'USD' ? toFiniteNumber(usdRate, 150) : 1;
      const qty = toFiniteNumber(a.details.qty);
      const avgPrice = toFiniteNumber(a.details.avgPrice);
      const price = toFiniteNumber(quote.price);
      const prevClose = toFiniteNumber(quote.prevClose, price);

      const current = price * qty;
      const prev = prevClose * qty;
      const changeJPY = (current - prev) * fx;
      const valueJPY = current * fx;
      const cost = avgPrice * qty * fx;
      const gainLossPercent = cost > 0 ? ((valueJPY - cost) / cost) * 100 : undefined;

      return {
        ...a,
        valueJPY: Number.isFinite(valueJPY) ? valueJPY : 0,
        changeJPY: Number.isFinite(changeJPY) ? changeJPY : 0,
        costJPY: Number.isFinite(cost) ? cost : 0,
        gainLossPercent,
      } as ValuedAsset;
    });
  }, [portfolio, quotes]);

  const totals = useMemo(() => {
    const total = valued.reduce((sum, a) => sum + (Number.isFinite(a.valueJPY) ? a.valueJPY : 0), 0);
    const cash = valued
      .filter((a) => a.type === 'CASH')
      .reduce((sum, a) => sum + (Number.isFinite(a.valueJPY) ? a.valueJPY : 0), 0);
    const invest = total - cash;
    return {
      total: Number.isFinite(total) ? total : 0,
      cash: Number.isFinite(cash) ? cash : 0,
      invest: Number.isFinite(invest) ? invest : 0,
    };
  }, [valued]);

  const timeseries = useMemo(() => {
    const safeTotals = {
      total: Number.isFinite(totals.total) ? totals.total : 0,
      cash: Number.isFinite(totals.cash) ? totals.cash : 0,
    };
    const days = 120;
    const now = Date.now();
    const out: { time: number; total: number; cash: number; invest: number }[] = [];
    let t = safeTotals.total * 0.8;
    if (!Number.isFinite(t)) t = 0;
    for (let i = days - 1; i >= 0; i--) {
      const time = Math.floor((now - i * 24 * 3600 * 1000) / 1000);
      t = t * (1 + (Math.random() - 0.48) * 0.01);
      if (!Number.isFinite(t)) t = 0;
      const cashNoise = safeTotals.cash * (1 + (Math.random() - 0.5) * 0.002);
      const safeCash = Number.isFinite(cashNoise) ? cashNoise : 0;
      const safeTotal = Number.isFinite(t) ? t : 0;
      const safeInvest = Number.isFinite(safeTotal - safeCash) ? safeTotal - safeCash : 0;
      out.push({
        time,
        total: Math.max(0, safeTotal),
        cash: Math.max(0, safeCash),
        invest: Math.max(0, safeInvest),
      });
    }
    return out;
  }, [totals.total, totals.cash]);

  const metricsPayload = useMemo(() => {
    const map: Record<string, { valueJPY: number; changeJPY: number; gainLossPercent?: number }> = {};
    valued.forEach((asset) => {
      if (asset.type !== 'STOCK' && asset.type !== 'CRYPTO') return;
      const key = asset.details.symbol.toUpperCase();
      if (!map[key]) {
        map[key] = { valueJPY: 0, changeJPY: 0 };
      }
      map[key].valueJPY += Number.isFinite(asset.valueJPY) ? asset.valueJPY : 0;
      map[key].changeJPY += Number.isFinite(asset.changeJPY) ? asset.changeJPY : 0;
      map[key].gainLossPercent = map[key].valueJPY > 0 && asset.costJPY > 0
        ? ((map[key].valueJPY - (map[key].valueJPY - map[key].changeJPY)) / (map[key].valueJPY - map[key].changeJPY)) * 100
        : map[key].gainLossPercent;
    });

    Object.entries(map).forEach(([key, entry]) => {
      const baseValue = entry.valueJPY - entry.changeJPY;
      entry.gainLossPercent = baseValue > 0 ? ((entry.valueJPY - baseValue) / baseValue) * 100 : undefined;
    });

    return map;
  }, [valued]);

  useEffect(() => {
    const signature = JSON.stringify({ metrics: metricsPayload, totals });
    if (computedSignatureRef.current === signature) return;
    computedSignatureRef.current = signature;
    setPortfolioComputed(metricsPayload, totals);
  }, [metricsPayload, totals, setPortfolioComputed]);

  const sortedAssets = useMemo(() => {
    const arr = [...valued];
    if (sort.key === 'order') {
      return arr.sort((a, b) => (sort.direction === 'asc' ? a.order - b.order : b.order - a.order));
    }
    const compare = (a: ValuedAsset, b: ValuedAsset) => {
      switch (sort.key) {
        case 'type':
          return a.type.localeCompare(b.type);
        case 'label':
          return (a.label || '').localeCompare(b.label || '');
        case 'valueJPY':
          return a.valueJPY - b.valueJPY;
        case 'gainLoss':
          return (a.gainLossPercent ?? Number.NEGATIVE_INFINITY) - (b.gainLossPercent ?? Number.NEGATIVE_INFINITY);
        default:
          return a.order - b.order;
      }
    };
    const sorted = arr.sort((a, b) => compare(a, b));
    return sort.direction === 'asc' ? sorted : [...sorted].reverse();
  }, [valued, sort]);

  const handleSort = useCallback((key: SortKey) => {
    setSort((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: key === 'label' || key === 'type' ? 'asc' : 'desc' };
    });
  }, []);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const rawPortfolio = useStore((s) => s.portfolio);

  const handleBackupExport = useCallback(() => {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      portfolio: rawPortfolio,
      portfolioHistory,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `portfolio-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [portfolioHistory, rawPortfolio]);

  const handleBackupImport = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string);
        if (!parsed || !Array.isArray(parsed.portfolio)) {
          alert('バックアップファイルが不正です。');
          return;
        }
        loadPortfolioBackup({
          portfolio: parsed.portfolio,
          portfolioHistory: Array.isArray(parsed.portfolioHistory) ? parsed.portfolioHistory : undefined,
        });
        alert('バックアップを読み込みました。');
      } catch (err) {
        console.error('Failed to import backup', err);
        alert('バックアップの読み込みに失敗しました。');
      }
    };
    reader.readAsText(file, 'utf-8');
    event.target.value = '';
  }, [loadPortfolioBackup]);

  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold text-gray-200">資産管理</h2>
      <AddAssetForm />

      <div className="card flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="font-semibold">バックアップ</div>
          <p className="text-xs text-gray-400">
            データはブラウザに保存されていますが、念のためバックアップを取ることをお勧めします。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="button" onClick={handleBackupExport}>バックアップを保存</button>
          <button className="button" onClick={() => fileInputRef.current?.click()}>バックアップから復元</button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={handleBackupImport}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card">
          <div className="text-sm text-gray-400">総資産</div>
          <div className="text-2xl font-bold">{formatJPY(totals.total)} 円</div>
        </div>
        <div className="card">
          <div className="text-sm text-gray-400">現金資産</div>
          <div className="text-2xl font-bold">{formatJPY(totals.cash)} 円</div>
        </div>
        <div className="card">
          <div className="text-sm text-gray-400">投資資産</div>
          <div className="text-2xl font-bold">{formatJPY(totals.invest)} 円</div>
        </div>
      </div>

      <div className="card">
        <div className="font-semibold mb-2">資産推移</div>
        <PortfolioChart data={timeseries} />
      </div>

      <div className="card">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold">保有一覧</div>
          <div className="text-xs text-gray-400">
            カラムをクリックすると昇順 / 降順に切り替わります。
          </div>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500">
              <th className="py-1">
                <SortButton label="種類" active={sort.key === 'type'} direction={sort.direction} onClick={() => handleSort('type')} />
              </th>
              <th>
                <SortButton label="ラベル" active={sort.key === 'label'} direction={sort.direction} onClick={() => handleSort('label')} />
              </th>
              <th>詳細</th>
              <th className="text-right">
                <SortButton
                  label="評価額(円)"
                  active={sort.key === 'valueJPY'}
                  direction={sort.direction}
                  onClick={() => handleSort('valueJPY')}
                />
              </th>
              <th className="text-right">
                <SortButton
                  label="騰落率"
                  active={sort.key === 'gainLoss'}
                  direction={sort.direction}
                  onClick={() => handleSort('gainLoss')}
                />
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sortedAssets.map((asset) => (
              <EditableRow
                key={asset.id}
                asset={asset}
                isEditing={editingId === asset.id}
                allowReorder={sort.key === 'order'}
                onEdit={() => setEditingId(asset.id)}
                onCancel={() => setEditingId(null)}
                onSave={(next) => {
                  update(asset.id, () => next as any);
                  setEditingId(null);
                }}
                onMoveUp={() => reorder(asset.id, 'up')}
                onMoveDown={() => reorder(asset.id, 'down')}
                onDelete={() => remove(asset.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SortButton({ label, active, direction, onClick }: { label: string; active: boolean; direction: 'asc' | 'desc'; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`flex items-center gap-1 text-xs ${active ? 'text-indigo-300' : 'text-gray-400 hover:text-gray-300'}`}>
      {label}
      {active && <span>{direction === 'asc' ? '▲' : '▼'}</span>}
    </button>
  );
}

function EditableRow({
  asset,
  isEditing,
  allowReorder,
  onEdit,
  onCancel,
  onSave,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  asset: ValuedAsset;
  isEditing: boolean;
  allowReorder: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (a: AssetItem) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  const [local, setLocal] = useState<AssetItem>(asset);
  useEffect(() => setLocal(asset), [asset.id, asset]);

  if (!isEditing) {
    return (
      <tr className="border-t border-gray-200 dark:border-gray-700">
        <td className="py-1">{asset.type}</td>
        <td>{asset.label}</td>
        <td>
          {asset.type === 'CASH' && `${asset.details.currency} ${asset.details.amount.toLocaleString()}`}
          {(asset.type === 'STOCK' || asset.type === 'CRYPTO') && `${asset.details.symbol} x ${asset.details.qty} @ ${asset.details.avgPrice}`}
        </td>
        <td className="text-right">{formatJPY(asset.valueJPY)}</td>
        <td className={`text-right ${((asset.gainLossPercent ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400')}`}>
          {asset.gainLossPercent != null ? `${asset.gainLossPercent >= 0 ? '+' : ''}${asset.gainLossPercent.toFixed(2)}%` : '—'}
        </td>
        <td className="text-right space-x-2">
          {allowReorder && (
            <>
              <button className="rounded bg-gray-700 px-2 py-1 text-xs text-gray-200 hover:bg-gray-600" onClick={onMoveUp}>▲</button>
              <button className="rounded bg-gray-700 px-2 py-1 text-xs text-gray-200 hover:bg-gray-600" onClick={onMoveDown}>▼</button>
            </>
          )}
          <button className="rounded bg-gray-700 px-2 py-1 text-xs text-gray-200 hover:bg-gray-600" onClick={onEdit}>編集</button>
          <button className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-500" onClick={onDelete}>削除</button>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
      <td className="py-1">{local.type}</td>
      <td>
        <input className="input w-full" value={local.label} onChange={(e) => setLocal({ ...local, label: e.target.value })} />
      </td>
      <td>
        {local.type === 'CASH' && (
          <div className="flex gap-2">
            <select
              className="input"
              value={local.details.currency}
              onChange={(e) => setLocal({ ...local, details: { ...(local as any).details, currency: e.target.value } as any })}
            >
              <option value="JPY">JPY</option>
              <option value="USD">USD</option>
            </select>
            <input
              type="number"
              className="input"
              value={(local as any).details.amount}
              onChange={(e) => setLocal({ ...local, details: { ...(local as any).details, amount: parseFloat(e.target.value) } as any })}
            />
          </div>
        )}
        {(local.type === 'STOCK' || local.type === 'CRYPTO') && (
          <div className="flex gap-2">
            <input
              className="input w-28"
              value={(local as any).details.symbol}
              onChange={(e) => setLocal({ ...local, details: { ...(local as any).details, symbol: e.target.value.toUpperCase() } as any })}
            />
            <input
              type="number"
              className="input w-28"
              value={(local as any).details.avgPrice}
              onChange={(e) => setLocal({ ...local, details: { ...(local as any).details, avgPrice: parseFloat(e.target.value) } as any })}
            />
            <input
              type="number"
              className="input w-20"
              value={(local as any).details.qty}
              onChange={(e) => setLocal({ ...local, details: { ...(local as any).details, qty: parseFloat(e.target.value) } as any })}
            />
          </div>
        )}
      </td>
      <td className="text-right">—</td>
      <td className="text-right">—</td>
      <td className="text-right space-x-2">
        <button className="rounded bg-gray-700 px-2 py-1 text-xs text-gray-200 hover:bg-gray-600" onClick={onCancel}>取消</button>
        <button className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-500" onClick={() => onSave(local)}>保存</button>
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
  const [selectedSymbol, setSelectedSymbol] = useState<SymbolSearchResult | null>(null);
  const canSubmit = type === 'CASH' ? Boolean(label.trim() && Number.isFinite(amount)) : Boolean(label.trim() && symbol.trim());

  useEffect(() => {
    if (type !== 'CASH') return;
    setSelectedSymbol(null);
    setSymbol('');
  }, [type]);

  const handleSelect = (entry: SymbolSearchResult) => {
    setSelectedSymbol(entry);
    setSymbol(entry.symbol.toUpperCase());
    if (!label.trim()) setLabel(entry.name || entry.symbol);
  };

  const onAdd = () => {
    if (!label.trim()) return;
    if (type === 'CASH') {
      const safeAmount = Number.isFinite(amount) ? amount : 0;
      add({ type, label: label.trim(), order: 9999, details: { currency, amount: safeAmount } } as any);
    } else {
      const trimmedSymbol = symbol.trim().toUpperCase();
      if (!trimmedSymbol) return;
      const safeAvg = Number.isFinite(avgPrice) ? avgPrice : 0;
      const safeQty = Number.isFinite(qty) ? qty : 0;
      add({ type, label: label.trim(), order: 9999, details: { symbol: trimmedSymbol, avgPrice: safeAvg, qty: safeQty } } as any);
    }
    setLabel('');
    setAmount(0);
    setSymbol('');
    setAvgPrice(0);
    setQty(0);
    setSelectedSymbol(null);
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
            <div className="sm:col-span-3 flex flex-col gap-2">
              <label className="block text-xs text-gray-500">シンボル</label>
              <SymbolSearch onSelect={handleSelect} className="w-full" />
              {selectedSymbol ? (
                <div className="flex items-center justify-between rounded-md border border-gray-700 bg-gray-800/70 px-3 py-2 text-sm text-gray-200">
                  <div>
                    <div className="font-semibold">{selectedSymbol.symbol}</div>
                    {selectedSymbol.name && <div className="text-xs text-gray-400">{selectedSymbol.name}</div>}
                  </div>
                  <button
                    type="button"
                    className="text-xs text-indigo-300 hover:text-indigo-100"
                    onClick={() => {
                      setSelectedSymbol(null);
                      setSymbol('');
                    }}
                  >
                    クリア
                  </button>
                </div>
              ) : (
                <p className="text-xs text-gray-500">検索結果から銘柄を選択してください。</p>
              )}
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
          <button className="button" onClick={onAdd} disabled={!canSubmit}>追加</button>
        </div>
      </div>
    </div>
  );
}


