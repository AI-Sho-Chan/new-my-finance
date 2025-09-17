import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import type { MarketQuote, WatchGroup, WatchItem, Trend } from '../types';
import { TrendingDown, TrendingUp } from './icons';
import GroupTag from './watch/GroupTag';

const TREND_LABEL: Record<Trend, string> = {
  up: '上昇トレンド',
  down: '下降トレンド',
  flat: 'トレンドなし',
};

const TREND_CLASS: Record<Trend, string> = {
  up: 'text-emerald-400',
  down: 'text-rose-400',
  flat: 'text-gray-400',
};

type Props = {
  item: WatchItem;
  quote?: MarketQuote;
  groups: WatchGroup[];
  selectionMode?: boolean;
  selected?: boolean;
  rank?: number;
  metricsUrl?: string;
  onToggleSelect?: () => void;
  onOpen?: () => void;
  onUpdateNote?: (note: string) => void;
};

export default function StockCard({
  item,
  quote,
  groups,
  selectionMode = false,
  selected = false,
  rank,
  metricsUrl,
  onToggleSelect,
  onOpen,
  onUpdateNote,
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

  const handleOpen = () => {
    if (selectionMode) {
      onToggleSelect?.();
    } else {
      onOpen?.();
    }
  };

  const cardStyle = clsx(
    'relative bg-gray-800 rounded-lg p-3 shadow-lg transition-transform duration-200 flex flex-col gap-3 h-full',
    selectionMode ? 'cursor-pointer' : 'cursor-pointer hover:scale-[1.02] hover:shadow-xl',
  );

  const handleSaveNote = () => {
    onUpdateNote?.(noteDraft.trim());
    setEditingNote(false);
  };

  return (
    <div className={cardStyle} onClick={handleOpen}>
      {typeof rank === 'number' && (
        <div className="absolute top-2 left-2 bg-indigo-600 text-xs text-white font-semibold rounded-full px-2 py-0.5">
          #{rank}
        </div>
      )}
      <div className="flex justify-between items-start">
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
            <h3 className="text-sm font-bold text-gray-100 truncate max-w-[160px]" title={item.name}>
              {item.name}
            </h3>
            <p className="text-xs text-gray-400">{quote?.symbol || item.symbol}</p>
          </div>
        </div>
        <div className={clsx('text-lg flex items-center min-h-[1.5rem]', trendClass)} title={trendLabel}>
          {trend === 'up' && <TrendingUp />}
          {trend === 'down' && <TrendingDown />}
          {trend === 'flat' && <span className="text-base text-gray-400">—</span>}
        </div>
      </div>

      {displayGroups.length > 0 && (
        <div className="flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
          {displayGroups.map((group) => (
            <GroupTag key={group.id} label={group.name} color={group.color} compact />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 select-none">
        <div className="flex items-baseline justify-between">
          <span className={clsx('text-2xl font-bold', changePct != null ? (changePct >= 0 ? 'text-emerald-400' : 'text-rose-400') : 'text-gray-400')}>
            {changeDisplay}
          </span>
          <span className={clsx('text-xs font-semibold', trendClass)}>{trendLabel}</span>
        </div>
      </div>

      {metricsUrl && (
        <div className="flex justify-end">
          <a
            href={metricsUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 rounded-md border border-indigo-500/60 bg-indigo-500/10 px-3 py-1 text-xs font-semibold text-indigo-200 hover:bg-indigo-500/20"
          >
            指標 ↗
          </a>
        </div>
      )}

      {showNoteSection && (
        <div className="mt-auto" onClick={(e) => e.stopPropagation()}>
          {onUpdateNote ? (
            editingNote ? (
              <div className="bg-gray-900/80 rounded-md border border-gray-700 p-2">
                <textarea
                  className="w-full bg-transparent text-xs text-gray-100 focus:outline-none"
                  rows={3}
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                />
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    className="px-2 py-1 text-xs bg-gray-700 rounded-md text-gray-200 hover:bg-gray-600"
                    onClick={() => {
                      setEditingNote(false);
                      setNoteDraft(item.note || '');
                    }}
                  >
                    キャンセル
                  </button>
                  <button
                    className="px-2 py-1 text-xs bg-indigo-600 text-white rounded-md hover:bg-indigo-500"
                    onClick={handleSaveNote}
                  >
                    保存
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="w-full text-left text-xs text-gray-300 bg-gray-900/60 border border-gray-800 rounded-md px-2 py-2 hover:border-gray-600"
                onClick={() => setEditingNote(true)}
              >
                {item.note ? (
                  <span className="whitespace-pre-wrap break-words">{item.note}</span>
                ) : (
                  <span className="text-gray-500">＋ メモを追加</span>
                )}
              </button>
            )
          ) : item.note ? (
            <div className="w-full text-xs text-gray-300 bg-gray-900/60 border border-gray-800 rounded-md px-2 py-2 whitespace-pre-wrap break-words">
              {item.note}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
