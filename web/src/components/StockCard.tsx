import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import clsx from 'clsx';
import type { MarketQuote, WatchGroup, WatchItem, Trend } from '../types';
import { TrendingDown, TrendingUp } from './icons';
import GroupTag from './watch/GroupTag';

const TREND_LABEL: Record<Trend, string> = {
  up: 'トレンド上昇',
  down: 'トレンド下降',
  flat: 'トレンド横ばい',
};

const TREND_CLASS: Record<Trend, string> = {
  up: 'text-emerald-400',
  down: 'text-rose-400',
  flat: 'text-gray-400',
};

function formatUpdatedAt(ts?: number | null) {
  if (!ts) return null;
  return new Date(ts).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

type Props = {
  item: WatchItem;
  quote?: MarketQuote;
  groups: WatchGroup[];
  selectionMode?: boolean;
  selected?: boolean;
  metricsUrl?: string;
  portfolioGainLoss?: number;
  onToggleSelect?: () => void;
  onOpen?: () => void;
  onUpdateNote?: (note: string) => void;
  onDelete?: () => void;
  onRemoveTag?: (groupId: string) => void;
};

export default function StockCard({
  item,
  quote,
  groups,
  selectionMode = false,
  selected = false,
  metricsUrl,
  portfolioGainLoss,
  onToggleSelect,
  onOpen,
  onUpdateNote,
  onDelete,
  onRemoveTag,
}: Props) {
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState(item.note || '');

  useEffect(() => {
    if (!editingNote) setNoteDraft(item.note || '');
  }, [item.note, editingNote]);

  const displayGroups = useMemo(() => groups.filter((g) => g.key !== 'all'), [groups]);
  const showNoteSection = Boolean(onUpdateNote) || Boolean(item.note);

  const changePct = typeof quote?.changePct === 'number' ? quote.changePct : null;
  const changeSign = changePct != null ? (changePct >= 0 ? '+' : '') : '';
  const changeDisplay = changePct != null ? `${changeSign}${changePct.toFixed(2)}%` : '--';
  const trend: Trend = quote?.trend ?? 'flat';
  const trendClass = TREND_CLASS[trend];
  const trendLabel = TREND_LABEL[trend];
  const updatedLabel = formatUpdatedAt(quote?.updatedAt ?? item.updatedAt ?? null);

  const handleOpen = () => {
    if (selectionMode) {
      onToggleSelect?.();
    } else {
      onOpen?.();
    }
  };

  const cardStyle = clsx(
    'relative flex h-full flex-col gap-3 rounded-lg bg-gray-800 p-3 shadow-lg transition-transform duration-200',
    selectionMode ? 'cursor-pointer' : 'cursor-pointer hover:scale-[1.02] hover:shadow-xl',
  );

  const handleSaveNote = () => {
    onUpdateNote?.(noteDraft.trim());
    setEditingNote(false);
  };

  const handleDelete = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onDelete?.();
  };

  const handleRemoveTag = (groupId: string) => {
    onRemoveTag?.(groupId);
  };

  return (
    <div className={cardStyle} onClick={handleOpen}>
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-2">
          {selectionMode && (
            <input
              type="checkbox"
              checked={selected}
              onChange={(e) => {
                e.stopPropagation();
                onToggleSelect?.();
              }}
              onClick={(e) => e.stopPropagation()}
              className="mt-0.5 h-4 w-4"
            />
          )}
          <div>
            <h3 className="max-w-[160px] truncate text-sm font-bold text-gray-100" title={item.name}>
              {item.name}
            </h3>
            <p className="flex items-center gap-2 text-[11px] text-indigo-200/80">
              <span className="font-mono tracking-wide">{quote?.symbol || item.symbol}</span>
              {updatedLabel && <span className="text-[10px] text-indigo-200/70">更新 {updatedLabel}</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!selectionMode && (
            <button
              type="button"
              onClick={handleDelete}
              className="rounded-md bg-transparent px-2 py-1 text-xs text-gray-400 transition hover:bg-red-500/10 hover:text-red-300"
              title="このカードを削除"
            >
              削除
            </button>
          )}
          <div className={clsx('flex min-h-[1.5rem] items-center text-lg', trendClass)} title={trendLabel}>
            {trend === 'up' && <TrendingUp />}
            {trend === 'down' && <TrendingDown />}
            {trend === 'flat' && <span className="text-base text-gray-400">-</span>}
          </div>
        </div>
      </div>

      <div className="select-none">
        <span
          className={clsx(
            'text-2xl font-bold',
            changePct != null ? (changePct >= 0 ? 'text-emerald-400' : 'text-rose-400') : 'text-gray-400'
          )}
        >
          {changeDisplay}
        </span>
      </div>

      {portfolioGainLoss != null && (
        <div className="-mt-1 text-xs text-gray-400">
          <span className={clsx(portfolioGainLoss >= 0 ? 'text-emerald-300' : 'text-rose-300', 'font-semibold')}>
            {portfolioGainLoss >= 0 ? '+' : ''}{portfolioGainLoss.toFixed(2)}%
          </span>
          <span className="ml-1">保有損益</span>
        </div>
      )}

      {displayGroups.length > 0 && (
        <div className="flex flex-wrap gap-1 text-xs" onClick={(e) => e.stopPropagation()}>
          {displayGroups.map((group) => (
            <GroupTag
              key={group.id}
              label={group.name}
              color={group.color}
              compact
              variant="muted"
              removable={Boolean(onRemoveTag && group.key !== 'all')}
              onRemove={() => handleRemoveTag(group.id)}
            />
          ))}
        </div>
      )}

      {metricsUrl && (
        <div className="flex justify-end">
          <a
            href={metricsUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 rounded-md border border-indigo-500/60 bg-indigo-500/10 px-3 py-1 text-xs font-semibold text-indigo-200 hover:bg-indigo-500/20"
          >
            指標
          </a>
        </div>
      )}

      {showNoteSection && (
        <div className="mt-auto" onClick={(e) => e.stopPropagation()}>
          {onUpdateNote ? (
            editingNote ? (
              <div className="rounded-md border border-gray-700 bg-gray-900/80 p-2">
                <textarea
                  className="w-full bg-transparent text-xs text-gray-100 focus:outline-none"
                  rows={3}
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                />
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    className="rounded-md bg-gray-700 px-2 py-1 text-xs text-gray-200 hover:bg-gray-600"
                    onClick={() => {
                      setEditingNote(false);
                      setNoteDraft(item.note || '');
                    }}
                  >
                    キャンセル
                  </button>
                  <button
                    className="rounded-md bg-indigo-600 px-2 py-1 text-xs text-white hover:bg-indigo-500"
                    onClick={handleSaveNote}
                  >
                    保存
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-gray-700/60 bg-gray-900/40 p-2 text-xs text-gray-300">
                <div className="flex items-center justify-between">
                  <span>{item.note || 'メモはありません。'}</span>
                  <button
                    className="rounded bg-gray-700 px-2 py-1 text-[11px] text-gray-200 hover:bg-gray-600"
                    onClick={() => setEditingNote(true)}
                  >
                    編集
                  </button>
                </div>
              </div>
            )
          ) : (
            <div className="rounded-md border border-gray-700 bg-gray-900/60 p-2 text-xs text-gray-300">{item.note}</div>
          )}
        </div>
      )}
    </div>
  );
}
