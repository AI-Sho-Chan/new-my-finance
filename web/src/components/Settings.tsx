import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { readLegacyAssetsFromThisOrigin } from '../lib/legacy';
import WatchlistManager from './WatchlistManager';

export default function Settings() {
  const portfolioLen = useStore((s) => s.portfolio.length);
  const history = useStore((s) => s.portfolioHistory);
  const saveSnap = useStore((s) => s.savePortfolioSnapshot);
  const restoreSnap = useStore((s) => s.restorePortfolioSnapshot);
  const setState = useStore.setState;
  const [importText, setImportText] = useState('');
  const recent = useMemo(() => [...history].sort((a, b) => a.ts - b.ts).slice(-10), [history]);

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold text-gray-200">設定</h2>

      <div className="card">
        <div className="font-semibold mb-2">アラート設定</div>
        <div className="flex justify-between items-center">
          <p>VIXが一定を超えたら通知（ダミー）</p>
          <label className="switch">
            <input type="checkbox" defaultChecked />
            <span className="slider round"></span>
          </label>
        </div>
        <style>{`
          .switch { position: relative; display: inline-block; width: 60px; height: 34px; }
          .switch input { opacity: 0; width: 0; height: 0; }
          .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #ccc; transition: .4s; }
          .slider:before { position: absolute; content: ""; height: 26px; width: 26px; left: 4px; bottom: 4px; background-color: white; transition: .4s; }
          input:checked + .slider { background-color: #4f46e5; }
          input:checked + .slider:before { transform: translateX(26px); }
          .slider.round { border-radius: 34px; }
          .slider.round:before { border-radius: 50%; }
        `}</style>
      </div>

      <div className="card">
        <div className="font-semibold mb-2">データ管理</div>
        <div className="text-sm text-gray-300 mb-2">
          現在の保有件数: {portfolioLen} / スナップショット数: {history.length}
        </div>
        <div className="flex gap-2 mb-3 flex-wrap">
          <button className="button" onClick={() => saveSnap('manual')}>
            手動スナップショット作成
          </button>
          <button
            className="px-3 py-2 bg-gray-600 rounded text-white"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  JSON.stringify(useStore.getState().portfolio, null, 2)
                );
                alert('コピーしました');
              } catch {
                alert('コピー失敗');
              }
            }}
          >
            エクスポート（JSONをコピー）
          </button>
          <button
            className="px-3 py-2 bg-gray-600 rounded text-white"
            onClick={() => {
              const legacy = readLegacyAssetsFromThisOrigin();
              if (!legacy || legacy.length === 0) {
                alert('このオリジンにレガシーデータは見つかりませんでした');
                return;
              }
              setState((s) => ({ ...s, portfolio: legacy }));
              useStore.getState().savePortfolioSnapshot('legacy-import');
              alert(`取り込み完了 ${legacy.length} 件`);
            }}
          >
            レガシーから取り込み（このオリジン）
          </button>
        </div>
        <div className="space-y-2">
          <label className="block text-xs text-gray-400">JSONインポート（貼り付け）</label>
          <textarea
            className="w-full h-24 input"
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder='[{"type":"CASH",...}, ...]'
          />
          <div>
            <button
              className="button"
              onClick={() => {
                try {
                  const arr = JSON.parse(importText);
                  if (!Array.isArray(arr)) throw new Error('Array expected');
                  setState((s) => ({ ...s, portfolio: arr }));
                  useStore.getState().savePortfolioSnapshot('import');
                  alert('インポート完了');
                } catch (e: any) {
                  alert('インポート失敗 ' + (e?.message || e));
                }
              }}
            >
              取り込む
            </button>
          </div>
        </div>
        <div className="mt-4">
          <div className="font-semibold mb-1">最近のスナップショット</div>
          <ul className="space-y-1 text-sm">
            {recent.map((s) => (
              <li
                key={s.key}
                className="flex items-center justify-between bg-gray-700 rounded px-2 py-1"
              >
                <span>
                  {new Date(s.ts).toLocaleString()}{' '}
                  <span className="text-gray-300">({s.note || '-'})</span>
                </span>
                <button
                  className="px-2 py-1 bg-blue-600 rounded text-white"
                  onClick={() => restoreSnap(s.key)}
                >
                  復元
                </button>
              </li>
            ))}
            {recent.length === 0 && (
              <li className="text-gray-400">スナップショットはまだありません</li>
            )}
          </ul>
        </div>
      </div>

      <div className="card">
        <div className="font-semibold mb-2">外出先からUIを確認したい場合</div>
        <ol className="list-decimal list-inside space-y-1 text-sm text-gray-300">
          <li>
            <code>cloudflared-windows-amd64.exe</code> をプロジェクトの <code>tools</code>{' '}
            フォルダに配置します（<code>cloudflared_quick_tunnel.ps1</code> と同じ場所）。
          </li>
          <li>
            初回のみ PowerShell で <code>launch_tunnel.bat -Login</code> を実行し、ブラウザで Cloudflare の認証を完了させます。
          </li>
          <li>
            以後は <code>tools\launch_tunnel.bat</code> をダブルクリックするだけで一時URL（
            <code>https://*.trycloudflare.com</code>）が表示されます。PowerShell を閉じるとトンネルは終了し、URLも無効になります。
          </li>
        </ol>
        <p className="text-xs text-gray-400 mt-2">
          ※ ブラウザから直接ファイルを実行することはできないため、エクスプローラーでファイルを開いて実行してください。
        </p>
      </div>

      <WatchlistManager />
    </div>
  );
}
