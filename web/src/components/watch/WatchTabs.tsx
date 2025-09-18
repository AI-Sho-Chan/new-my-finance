import { useMemo, useState } from 'react';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { WatchGroup } from '../../types';

type Tab = Pick<WatchGroup, 'id' | 'name' | 'color' | 'type' | 'key'>;

type Props = {
  tabs: Tab[];
  activeId: string;
  onSelect: (groupId: string) => void;
  onReorder: (groupId: string, targetIndex: number) => void;
  onAdd: () => void;
  onEdit: (groupId: string) => void;
  onDelete: (groupId: string) => void;
};

export default function WatchTabs({ tabs, activeId, onSelect, onReorder, onAdd, onEdit, onDelete }: Props) {
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const ids = useMemo(() => tabs.map((t) => t.id), [tabs]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    onReorder(String(active.id), newIndex);
  };

  return (
    <div className="mb-4 flex items-center gap-2 overflow-x-auto pb-1">
      <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
          {tabs.map((tab) => (
            <SortableTab
              key={tab.id}
              tab={tab}
              active={tab.id === activeId}
              onSelect={() => onSelect(tab.id)}
              onOpenMenu={(open) => setMenuFor(open ? tab.id : null)}
              menuOpen={menuFor === tab.id}
              onEdit={() => {
                setMenuFor(null);
                onEdit(tab.id);
              }}
              onDelete={() => {
                setMenuFor(null);
                onDelete(tab.id);
              }}
            />
          ))}
        </SortableContext>
      </DndContext>
      <button
        onClick={onAdd}
        className="flex-shrink-0 rounded-md bg-gray-700 px-3 py-2 text-sm font-semibold text-gray-200 transition hover:bg-gray-600"
      >
        {"\u65b0\u898f\u30b0\u30eb\u30fc\u30d7"}
      </button>
    </div>
  );
}

type SortableTabProps = {
  tab: Tab;
  active: boolean;
  onSelect: () => void;
  onOpenMenu: (open: boolean) => void;
  menuOpen: boolean;
  onEdit: () => void;
  onDelete: () => void;
};

function SortableTab({ tab, active, onSelect, onOpenMenu, menuOpen, onEdit, onDelete }: SortableTabProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: tab.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  } as const;

  const canDelete = tab.type === 'user';

  return (
    <div ref={setNodeRef} style={style} className="relative flex items-center gap-1">
      <button
        type="button"
        className={`flex items-center gap-2 rounded-md border px-3 py-2 ${active ? 'bg-gray-100 text-gray-900 border-transparent shadow' : 'bg-gray-800 text-gray-200 border-gray-700 hover:bg-gray-700'}`}
        onClick={onSelect}
      >
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: tab.color }} />
          <span className="text-sm font-semibold whitespace-nowrap">{tab.name}</span>
        </span>
        <span
          className="ml-2 text-xs text-gray-400"
          onClick={(e) => {
            e.stopPropagation();
            onOpenMenu(!menuOpen);
          }}
        >
          ⋯
        </span>
      </button>
      <span
        ref={setActivatorNodeRef}
        className="cursor-grab select-none text-gray-500 hover:text-gray-300"
        {...attributes}
        {...listeners}
      >
        ⋮
      </span>
      {menuOpen && (
        <div
          className="absolute top-full left-0 z-30 mt-1 w-36 rounded-md border border-gray-600 bg-gray-800 shadow-lg"
          onMouseLeave={() => onOpenMenu(false)}
        >
          <button className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700" onClick={(e) => { e.preventDefault(); onEdit(); }}>{"\u7de8\u96c6"}</button>
          {canDelete ? (
            <button className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-gray-700" onClick={(e) => { e.preventDefault(); onDelete(); }}>{"\u524a\u9664"}</button>
          ) : (
            <div className="border-t border-gray-700 px-3 py-2 text-xs text-gray-500">{"\u56fa\u5b9a\u30bf\u30d6"}</div>
          )}
        </div>
      )}
    </div>
  );
}
