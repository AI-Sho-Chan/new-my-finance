
import { useMemo, useState } from 'react';
import { useStore } from '../store';
import GroupEditorModal from './watch/GroupEditorModal';

type EditorState = { open: boolean; groupId?: string };

export default function WatchlistManager() {
  const groups = useStore((s) => s.watchGroups);
  const items = useStore((s) => s.watchItems);
  const updateGroup = useStore((s) => s.updateGroup);
  const deleteGroup = useStore((s) => s.deleteGroup);

  const ordered = useMemo(() => Object.values(groups).sort((a, b) => a.order - b.order), [groups]);
  const [editor, setEditor] = useState<EditorState>({ open: false });

  const target = editor.groupId ? groups[editor.groupId] : undefined;

  const describeType = (group: typeof ordered[number]) => {
    if (group.type === 'system') {
      if (group.key === 'all') return 'ALL（固定）';
      if (group.key === 'holding') return '保有（自動）';
      return 'システム';
    }
    return 'ユーザー';
  };

  const handleDelete = (groupId: string) => {
    const group = groups[groupId];
    if (!group || group.type === 'system') return;
    const ok = window.confirm(`「${group.name}」タブを削除しますか？タブだけが対象で、銘柄カードは残ります。`);
    if (!ok) return;
    deleteGroup(groupId);
  };

  return (
    <div className="card">
      <div className="font-semibold mb-2">ウォッチリスト タブ管理</div>
      <table className="w-full text-sm text-gray-200">
        <thead>
          <tr className="text-gray-400 border-b border-gray-700">
            <th className="py-2 text-left">タブ名</th>
            <th className="py-2 text-left">種別</th>
            <th className="py-2 text-right">銘柄数</th>
            <th className="py-2 text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((group) => {
            const count = group.itemIds.filter((id) => Boolean(items[id])).length;
            const isSystem = group.type === 'system';
            return (
              <tr key={group.id} className="border-b border-gray-800">
                <td className="py-2 flex items-center gap-2">
                  <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: group.color }} />
                  <span>{group.name}</span>
                </td>
                <td className="py-2 text-gray-400">{describeType(group)}</td>
                <td className="py-2 text-right">{count}</td>
                <td className="py-2">
                  <div className="flex justify-end gap-2">
                    <button
                      className="px-2 py-1 rounded border border-gray-600 text-xs text-gray-200 hover:bg-gray-700 disabled:opacity-40 disabled:hover:bg-transparent"
                      onClick={() => setEditor({ open: true, groupId: group.id })}
                      disabled={isSystem}
                    >
                      編集
                    </button>
                    <button
                      className="px-2 py-1 rounded border border-red-500 text-xs text-red-400 hover:bg-red-500/20 disabled:opacity-40 disabled:hover:bg-transparent"
                      onClick={() => handleDelete(group.id)}
                      disabled={isSystem}
                    >
                      削除
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
          {!ordered.length && (
            <tr>
              <td colSpan={4} className="py-4 text-center text-gray-500">タブはまだありません。</td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-gray-400">タブの追加や並び替えはダッシュボード側のウォッチリストから行えます。</p>
      <GroupEditorModal
        open={editor.open && !!target}
        mode="edit"
        initialName={target?.name}
        initialColor={target?.color}
        initialDescription={target?.description}
        onClose={() => setEditor({ open: false })}
        onSubmit={(value) => {
          if (!editor.groupId) return;
          updateGroup(editor.groupId, value);
          setEditor({ open: false });
        }}
      />
    </div>
  );
}
