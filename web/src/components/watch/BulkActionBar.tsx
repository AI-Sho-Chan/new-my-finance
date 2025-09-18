import type { ReactNode } from 'react';

type Props = {
  selectedCount: number;
  onAssign: () => void;
  onDelete: () => void;
  onClear: () => void;
  assignDisabled?: boolean;
  deleteDisabled?: boolean;
  extra?: ReactNode;
};

export default function BulkActionBar({ selectedCount, onAssign, onDelete, onClear, assignDisabled, deleteDisabled, extra }: Props) {
  if (!selectedCount) return null;

  return (
    <div className="sticky top-16 z-20 mb-4 flex items-center justify-between rounded-md border border-indigo-500/60 bg-indigo-900/40 px-4 py-3 backdrop-blur">
      <div>
        <p className="text-sm font-semibold text-indigo-100">{selectedCount} 件を選択中</p>
        <p className="text-xs text-indigo-200/80">タグ付けや削除をまとめて実行できます</p>
      </div>
      <div className="flex items-center gap-2">
        <button
          className="rounded-md bg-indigo-600 px-3 py-2 text-sm text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={onAssign}
          disabled={assignDisabled}
        >
          タグ追加
        </button>
        <button
          className="rounded-md bg-red-600 px-3 py-2 text-sm text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={onDelete}
          disabled={deleteDisabled}
        >
          選択銘柄を削除
        </button>
        <button className="px-2 py-2 text-xs text-indigo-200 hover:text-white" onClick={onClear}>選択解除</button>
        {extra}
      </div>
    </div>
  );
}
