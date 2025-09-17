import { useEffect, useMemo, useState } from 'react';
import type { WatchGroup } from '../../types';

type Props = {
  open: boolean;
  groups: Array<Pick<WatchGroup, 'id' | 'name' | 'color' | 'key' | 'type'>>;
  initialSelected?: string[];
  onConfirm: (groupIds: string[]) => void;
  onClose: () => void;
};

export default function GroupSelectorDialog({ open, groups, initialSelected, onConfirm, onClose }: Props) {
  const [selected, setSelected] = useState<string[]>(initialSelected || []);
  const allId = useMemo(() => groups.find((g) => g.key === 'all')?.id, [groups]);

  useEffect(() => {
    if (!open) return;
    setSelected(initialSelected || (allId ? [allId] : []));
  }, [open, initialSelected, allId]);

  if (!open) return null;

  const toggle = (id: string) => {
    if (id === allId) return;
    setSelected((prev) => {
      const set = new Set(prev);
      if (set.has(id)) set.delete(id); else set.add(id);
      if (allId) set.add(allId);
      return Array.from(set);
    });
  };

  const isChecked = (id: string) => selected.includes(id);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-gray-800 border border-gray-700 rounded-lg shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-gray-100 mb-4">登録するグループを選択</h3>
        <div className="max-h-64 overflow-y-auto space-y-2">
          {groups.map((group) => {
            const disabled = group.key === 'all';
            return (
              <label key={group.id} className={`flex items-center justify-between px-3 py-2 rounded-md ${disabled ? 'bg-gray-900 border border-gray-700 opacity-80' : 'bg-gray-900/60 hover:bg-gray-900 border border-gray-700'}`}>
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={isChecked(group.id)}
                    disabled={disabled}
                    onChange={() => toggle(group.id)}
                    className="h-4 w-4"
                  />
                  <span className="text-sm text-gray-100 font-semibold">{group.name}</span>
                </div>
                <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: group.color }} />
              </label>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-gray-400">ALLタブは常に含まれます。複数選択で一括登録できます。</p>
        <div className="mt-6 flex justify-end gap-2">
          <button className="px-4 py-2 rounded-md text-sm bg-gray-700 text-gray-200 hover:bg-gray-600" onClick={onClose}>キャンセル</button>
          <button
            className="px-4 py-2 rounded-md text-sm bg-indigo-600 text-white hover:bg-indigo-500"
            onClick={() => {
              const unique = Array.from(new Set(selected.concat(allId ? [allId] : [])));
              onConfirm(unique);
            }}
          >
            適用
          </button>
        </div>
      </div>
    </div>
  );
}
