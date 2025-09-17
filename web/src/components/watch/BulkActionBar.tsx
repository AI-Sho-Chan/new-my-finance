import type { ReactNode } from 'react';

type Props = {
  selectedCount: number;
  activeGroupName: string;
  onAddToGroups: () => void;
  onRemoveFromActive: () => void;
  onClear: () => void;
  removeDisabled?: boolean;
  extra?: ReactNode;
};

export default function BulkActionBar({ selectedCount, activeGroupName, onAddToGroups, onRemoveFromActive, onClear, removeDisabled, extra }: Props) {
  if (!selectedCount) return null;

  return (
    <div className="sticky top-16 z-20 mb-4 rounded-md bg-indigo-900/40 border border-indigo-500/60 backdrop-blur px-4 py-3 flex items-center justify-between">
      <div>
        <p className="text-sm text-indigo-100 font-semibold">{selectedCount}件を選択中</p>
        <p className="text-xs text-indigo-200/80">追加・削除の一括操作を実行できます</p>
      </div>
      <div className="flex items-center gap-2">
        <button className="px-3 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-500" onClick={onAddToGroups}>タブへ追加</button>
        <button
          className="px-3 py-2 text-sm rounded-md bg-gray-700 text-gray-200 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={onRemoveFromActive}
          disabled={removeDisabled}
        >
          「{activeGroupName}」から外す
        </button>
        <button className="px-2 py-2 text-xs rounded-md text-indigo-200 hover:text-white" onClick={onClear}>選択解除</button>
        {extra}
      </div>
    </div>
  );
}
