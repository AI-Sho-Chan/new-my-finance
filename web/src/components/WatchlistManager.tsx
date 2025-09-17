import { useMemo } from 'react';
import { useStore } from '../store';

export default function WatchlistManager() {
  const groups = useStore((s) => s.watchGroups);
  const items = useStore((s) => s.watchItems);
  const ordered = useMemo(() => Object.values(groups).sort((a, b) => a.order - b.order), [groups]);

  return (
    <div className="card">
      <div className="font-semibold mb-2">ウォッチリストタブ概要</div>
      <table className="w-full text-sm text-gray-200">
        <thead>
          <tr className="text-gray-400 border-b border-gray-700">
            <th className="py-2 text-left">タブ名</th>
            <th className="py-2 text-left">種別</th>
            <th className="py-2 text-right">銘柄数</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((group) => {
            const count = group.itemIds.filter((id) => Boolean(items[id])).length;
            return (
              <tr key={group.id} className="border-b border-gray-800">
                <td className="py-2 flex items-center gap-2">
                  <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: group.color }} />
                  <span>{group.name}</span>
                </td>
                <td className="py-2 text-gray-400">{group.type === 'system' ? (group.key === 'all' ? 'ALL(固定)' : group.key === 'holding' ? '保有(自動)' : 'システム') : 'ユーザー'}</td>
                <td className="py-2 text-right">{count}</td>
              </tr>
            );
          })}
          {!ordered.length && (
            <tr>
              <td colSpan={3} className="py-4 text-center text-gray-500">タブが見つかりません。</td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-gray-400">タブの追加・編集・並び替えはダッシュボード上部のタブバーから行えます。</p>
    </div>
  );
}
