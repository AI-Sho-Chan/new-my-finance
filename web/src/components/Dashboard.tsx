import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, rectSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import clsx from 'clsx';
import { fetchHistoricalCandles, fetchMarketQuotes, inferTrend, fetchFundamentals } from '../lib/data';
import { useStore } from '../store';
import type { MarketQuote, WatchGroup, WatchItem, WatchSortMode } from '../types';
import { sortGroupItemIds, collectGroupItemIds, buildItemGroupMap, metricsLinkFor } from '../lib/watch-helpers';
import WatchTabs from './watch/WatchTabs';
import GroupEditorModal from './watch/GroupEditorModal';
import GroupSelectorDialog from './watch/GroupSelectorDialog';
import BulkActionBar from './watch/BulkActionBar';
import GroupTag from './watch/GroupTag';
import StockCard from './StockCard';
import Loader from './Loader';
import StockChartModal from './StockChartModal';
import MarketOverview from './MarketOverview';
import FGIWidget from './FGIWidget';

type EditorState = { open: boolean; mode: 'create' | 'edit'; groupId?: string };
type SelectorTarget = 'search' | 'bulk';

export default function Dashboard() {
  const watchItems = useStore((s) => s.watchItems);
  const watchGroups = useStore((s) => s.watchGroups);
  const watchUI = useStore((s) => s.watchUI);
  const addItems = useStore((s) => s.addItems);
  const assignItemsToGroups = useStore((s) => s.assignItemsToGroups);
  const removeItemsFromGroup = useStore((s) => s.removeItemsFromGroup);
  const setActiveGroup = useStore((s) => s.setActiveGroup);
  const reorderGroup = useStore((s) => s.reorderGroup);
  const reorderGroupItems = useStore((s) => s.reorderGroupItems);
  const createGroup = useStore((s) => s.createGroup);
  const updateGroup = useStore((s) => s.updateGroup);
  const deleteGroup = useStore((s) => s.deleteGroup);
  const setSelectionMode = useStore((s) => s.setSelectionMode);
  const setSelectedIds = useStore((s) => s.setSelectedIds);
  const clearSelection = useStore((s) => s.clearSelection);
  const updateItemNote = useStore((s) => s.updateItemNote);
  const setPendingAssignGroupIds = useStore((s) => s.setPendingAssignGroupIds);
  const setSortMode = useStore((s) => s.setSortMode);

  const orderedGroups = useMemo(() => Object.values(watchGroups).sort((a, b) => a.order - b.order), [watchGroups]);
  const activeGroup = useMemo(() => orderedGroups.find((g) => g.id === watchUI.activeGroupId) || orderedGroups[0], [orderedGroups, watchUI.activeGroupId]);
  const sortMode = watchUI.sortMode;

  useEffect(() => {
    if (!activeGroup && orderedGroups.length) {
      setActiveGroup(orderedGroups[0].id);
    }
  }, [activeGroup, orderedGroups, setActiveGroup]);

  const [modal, setModal] = useState<{ symbol: string } | null>(null);
  const [quotes, setQuotes] = useState<Record<string, MarketQuote>>({});
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [quotesError, setQuotesError] = useState<string | null>(null);
  const [symbolInput, setSymbolInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [editor, setEditor] = useState<EditorState>({ open: false, mode: 'create' });
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [selectorTarget, setSelectorTarget] = useState<SelectorTarget>('search');

  const sortOptions: { value: WatchSortMode; label: string }[] = [
    { value: 'none', label: '手動順' },
    { value: 'changeDesc', label: '上昇率(降順)' },
    { value: 'changeAsc', label: '上昇率(昇順)' },
    { value: 'trendUpFirst', label: '上昇トレンド優先' },
    { value: 'trendDownFirst', label: '下降トレンド優先' },
  ];

  const activeSymbols = useMemo(() => {
    if (!activeGroup) return [];
    const ids = collectGroupItemIds(activeGroup, watchItems);
    const unique = new Set<string>();
    ids.forEach((id) => {
      const sym = watchItems[id]?.symbol;
      if (sym) unique.add(sym);
    });
    return Array.from(unique);
  }, [activeGroup, watchItems]);

  useEffect(() => {
    if (!activeSymbols.length) {
      setQuotesLoading(false);
      setQuotesError(null);
      return;
    }
    let mounted = true;
    setQuotesLoading(true);
    setQuotesError(null);
    fetchMarketQuotes(activeSymbols)
      .then(async (q) => {
        for (const sym of activeSymbols) {
          if (!q[sym]) continue;
          const [candles, fund] = await Promise.all([
            fetchHistoricalCandles(sym, 'D'),
            fetchFundamentals(sym).catch(() => ({ yoyRevenuePct: null, yoyOperatingIncomePct: null })),
          ]);
          q[sym].trend = inferTrend(candles);
          q[sym].yoyRevenuePct = fund.yoyRevenuePct ?? undefined;
          q[sym].yoyOperatingIncomePct = fund.yoyOperatingIncomePct ?? undefined;
        }
        if (mounted) setQuotes((prev) => ({ ...prev, ...q }));
      })
      .catch((err) => {
        console.error('Failed to load market quotes', err);
        if (mounted) setQuotesError('価格データの取得に失敗しました');
      })
      .finally(() => {
        if (mounted) setQuotesLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [activeSymbols.join(',')]);

  const quotesMap = quotes;
  const activeItemIds = useMemo(() => (activeGroup ? sortGroupItemIds(activeGroup, watchItems, quotesMap) : []), [activeGroup, watchItems, quotesMap]);
  const activeItems = useMemo(() => activeItemIds.map((id) => watchItems[id]).filter(Boolean) as WatchItem[], [activeItemIds, watchItems]);
  const displayItems = useMemo(() => {
    if (!activeItems.length) return [] as WatchItem[];
    if (sortMode === 'none') return activeItems;
    const changeValue = (item: WatchItem): number | null => {
      const v = quotesMap[item.symbol]?.changePct;
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    };
    const asc = (a: WatchItem, b: WatchItem) => {
      const av = changeValue(a);
      const bv = changeValue(b);
      const na = av ?? Number.POSITIVE_INFINITY;
      const nb = bv ?? Number.POSITIVE_INFINITY;
      return na - nb;
    };
    const desc = (a: WatchItem, b: WatchItem) => {
      const av = changeValue(a);
      const bv = changeValue(b);
      const na = av ?? Number.NEGATIVE_INFINITY;
      const nb = bv ?? Number.NEGATIVE_INFINITY;
      return nb - na;
    };
    if (sortMode === 'changeAsc') {
      return [...activeItems].sort(asc);
    }
    if (sortMode === 'changeDesc') {
      return [...activeItems].sort(desc);
    }
    if (sortMode === 'trendUpFirst') {
      const ups = activeItems.filter((item) => quotesMap[item.symbol]?.trend === 'up').sort(asc);
      const rest = activeItems.filter((item) => quotesMap[item.symbol]?.trend !== 'up');
      return [...ups, ...rest];
    }
    if (sortMode === 'trendDownFirst') {
      const downs = activeItems.filter((item) => quotesMap[item.symbol]?.trend === 'down').sort(desc);
      const rest = activeItems.filter((item) => quotesMap[item.symbol]?.trend !== 'down');
      return [...downs, ...rest];
    }
    return activeItems;
  }, [activeItems, sortMode, quotesMap]);
  const displayedIds = useMemo(() => displayItems.map((item) => item.id), [displayItems]);
  const itemGroupMap = useMemo(() => buildItemGroupMap(orderedGroups), [orderedGroups]);
  const selectedSet = useMemo(() => new Set(watchUI.selectedIds), [watchUI.selectedIds]);
  const pendingGroupIds = watchUI.pendingAssignGroupIds;
  const pendingGroups = useMemo(() => orderedGroups.filter((g) => pendingGroupIds.includes(g.id)), [orderedGroups, pendingGroupIds]);

  const allGroup = orderedGroups.find((g) => g.key === 'all');
  const activeGroupName = activeGroup?.name || 'ALL';
  const selectionActive = watchUI.selectionMode;

  const handleAddSymbol = () => {
    const symbol = symbolInput.trim().toUpperCase();
    if (!symbol) return;
    const name = nameInput.trim() || symbol;
    try {
      addItems([{ symbol, name }], pendingGroupIds.length ? pendingGroupIds : undefined);
      setSymbolInput('');
      setNameInput('');
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteGroup = (groupId: string) => {
    const group = watchGroups[groupId];
    if (!group || group.type === 'system') return;
    if (window.confirm(`${group.name} を削除しますか？銘柄はALLからは消えません。`)) {
      deleteGroup(groupId);
    }
  };

  const toggleSelection = (itemId: string) => {
    if (!watchUI.selectionMode) return;
    setSelectedIds(
      selectedSet.has(itemId)
        ? watchUI.selectedIds.filter((id) => id !== itemId)
        : [...watchUI.selectedIds, itemId]
    );
  };

  const handleDragEnd = (event: DragEndEvent) => {
    if (!activeGroup || sortMode !== 'none') return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = displayedIds.indexOf(String(active.id));
    const newIndex = displayedIds.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(activeItemIds, oldIndex, newIndex);
    reorderGroupItems(activeGroup.id, reordered);
  };

  const handleCardClick = (itemId: string, symbol: string) => {
    if (watchUI.selectionMode) {
      toggleSelection(itemId);
      return;
    }
    setModal({ symbol });
  };

  const executeBulkRemove = () => {
    if (!activeGroup || !watchUI.selectedIds.length) return;
    if (activeGroup.key === 'all') return;
    removeItemsFromGroup(watchUI.selectedIds, activeGroup.id);
    clearSelection();
  };

  const openGroupSelector = (target: SelectorTarget) => {
    setSelectorTarget(target);
    setSelectorOpen(true);
  };

  const onSelectorConfirm = (ids: string[]) => {
    const unique = ids.length ? ids : (allGroup ? [allGroup.id] : []);
    if (selectorTarget === 'search') {
      setPendingAssignGroupIds(unique);
    } else if (selectorTarget === 'bulk' && watchUI.selectedIds.length) {
      assignItemsToGroups(watchUI.selectedIds, unique);
      clearSelection();
      setSelectionMode(false);
    }
    setSelectorOpen(false);
  };

  return (
    <div>
      <div className="mb-4 space-y-2">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <h2 className="text-2xl font-semibold text-gray-100">ウォッチリスト</h2>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-gray-400">並び替え</label>
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as WatchSortMode)}
              className="px-3 py-2 text-sm rounded-md border border-gray-700 bg-gray-800 text-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {sortOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <button
              className={`px-3 py-2 text-sm rounded-md border ${selectionActive ? 'bg-indigo-600 text-white border-transparent' : 'bg-gray-800 text-gray-200 border-gray-700 hover:bg-gray-700'}`}
              onClick={() => {
                if (selectionActive) {
                  clearSelection();
                  setSelectionMode(false);
                } else {
                  setSelectionMode(true);
                }
              }}
            >
              {selectionActive ? '選択モード終了' : '選択モード'}
            </button>
            <button
              className="px-3 py-2 text-sm rounded-md bg-gray-700 text-gray-200 hover:bg-gray-600"
              onClick={() => setEditor({ open: true, mode: 'create' })}
            >
              新しいタブ
            </button>
          </div>
        </div>
        {sortMode !== 'none' && (<p className="text-xs text-amber-300">並び替えモード中はドラッグによる順番変更が無効になります。</p>)}
      </div>

      <FGIWidget />

      <WatchTabs
        tabs={orderedGroups.map(({ id, name, color, type, key }) => ({ id, name, color, type, key }))}
        activeId={activeGroup?.id || ''}
        onSelect={setActiveGroup}
        onReorder={reorderGroup}
        onAdd={() => setEditor({ open: true, mode: 'create' })}
        onEdit={(groupId) => setEditor({ open: true, mode: 'edit', groupId })}
        onDelete={handleDeleteGroup}
      />

      <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-4 mb-6">
        <h3 className="text-sm font-semibold text-gray-200 mb-3">銘柄を追加</h3>
        <div className="flex flex-col md:flex-row gap-3">
          <input
            className="flex-1 rounded-md bg-gray-950 border border-gray-700 px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="シンボル (AAPL, 7203.T など)"
            value={symbolInput}
            onChange={(e) => setSymbolInput(e.target.value)}
          />
          <input
            className="flex-1 rounded-md bg-gray-950 border border-gray-700 px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="名称 (任意)"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
          />
          <div className="flex gap-2">
            <button className="px-3 py-2 rounded-md text-sm bg-gray-800 text-gray-200 hover:bg-gray-700" onClick={() => openGroupSelector('search')}>タブを選択</button>
            <button className="px-4 py-2 rounded-md text-sm bg-indigo-600 text-white hover:bg-indigo-500" onClick={handleAddSymbol}>追加</button>
          </div>
        </div>
        <div className="mt-3 text-xs text-gray-400 flex items-center flex-wrap gap-2">
          <span>登録先:</span>
          {pendingGroups.length ? (
            pendingGroups.map((g) => <GroupTag key={g.id} label={g.name} color={g.color} />)
          ) : allGroup ? (
            <GroupTag label={allGroup.name} color={allGroup.color} />
          ) : null}
        </div>
      </div>

      <MarketOverview />

      <BulkActionBar
        selectedCount={watchUI.selectedIds.length}
        activeGroupName={activeGroupName}
        onAddToGroups={() => openGroupSelector('bulk')}
        onRemoveFromActive={executeBulkRemove}
        onClear={() => {
          clearSelection();
          setSelectionMode(false);
        }}
        removeDisabled={!watchUI.selectedIds.length || !activeGroup || activeGroup.key === 'all'}
      />

      {quotesError && <div className="mb-4 rounded-md border border-red-500/50 bg-red-500/10 text-red-200 px-4 py-2 text-sm">{quotesError}</div>}

      {quotesLoading && !activeItems.length ? (
        <div className="flex justify-center items-center h-48"><Loader /><span className="ml-3 text-gray-400 text-sm">市場データを取得中...</span></div>
      ) : !activeItems.length ? (
        <div className="text-center text-sm text-gray-400 border border-dashed border-gray-700 rounded-lg py-16">
          <p className="font-semibold text-gray-300 mb-2">タブに銘柄がありません</p>
          <p className="text-gray-500">検索から追加するか、ALLタブで一括操作ができます。</p>
        </div>
      ) : (
        <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={activeItemIds} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-4">
              {activeItems.map((item) => (
                <SortableWatchCard
                  key={item.id}
                  item={item}
                  quote={quotesMap[item.symbol]}
                  groups={itemGroupMap[item.id] || []}
                  selectionMode={selectionActive}
                  selected={selectedSet.has(item.id)}
                  onToggleSelect={() => toggleSelection(item.id)}
                  onOpen={() => handleCardClick(item.id, item.symbol)}
                  onUpdateNote={(note) => updateItemNote(item.id, note)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {modal && <StockChartModal symbol={modal.symbol} open={true} onClose={() => setModal(null)} />}
      <GroupEditorModal
        open={editor.open}
        mode={editor.mode}
        initialName={editor.mode === 'edit' ? watchGroups[editor.groupId || '']?.name : undefined}
        initialColor={editor.mode === 'edit' ? watchGroups[editor.groupId || '']?.color : undefined}
        initialDescription={editor.mode === 'edit' ? watchGroups[editor.groupId || '']?.description : undefined}
        onClose={() => setEditor({ open: false, mode: 'create' })}
        onSubmit={(value) => {
          if (editor.mode === 'create') {
            createGroup(value);
          } else if (editor.groupId) {
            updateGroup(editor.groupId, value);
          }
          setEditor({ open: false, mode: 'create' });
        }}
      />
      <GroupSelectorDialog
        open={selectorOpen}
        groups={orderedGroups.map(({ id, name, color, key, type }) => ({ id, name, color, key, type }))}
        initialSelected={pendingGroupIds.length ? pendingGroupIds : (allGroup ? [allGroup.id] : [])}
        onConfirm={onSelectorConfirm}
        onClose={() => setSelectorOpen(false)}
      />
    </div>
  );
}

type SortableWatchCardProps = {
  item: WatchItem;
  quote?: MarketQuote;
  groups: WatchGroup[];
  selectionMode: boolean;
  selected: boolean;
  dragDisabled?: boolean;
  rank?: number;
  metricsUrl?: string;
  onToggleSelect: () => void;
  onOpen: () => void;
  onUpdateNote: (note: string) => void;
};

function SortableWatchCard({ item, quote, groups, selectionMode, selected, dragDisabled, rank, metricsUrl, onToggleSelect, onOpen, onUpdateNote }: SortableWatchCardProps) {
  const { setNodeRef, listeners, attributes, transform, transition, isDragging } = useSortable({ id: item.id, disabled: selectionMode || dragDisabled });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={clsx('relative', selected && 'ring-2 ring-indigo-400 rounded-xl', isDragging && 'opacity-70')}
      {...listeners}
      {...attributes}
    >
      <StockCard
        item={item}
        quote={quote}
        groups={groups}
        selectionMode={selectionMode}
        selected={selected}
        rank={rank}
        metricsUrl={metricsUrl}
        onToggleSelect={onToggleSelect}
        onOpen={onOpen}
        onUpdateNote={onUpdateNote}
      />
    </div>
  );
}
