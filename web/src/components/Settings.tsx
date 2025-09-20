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
  const recent = useMemo(() => [...history].sort((a,b)=>a.ts-b.ts).slice(-10), [history]);
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold text-gray-200">險ｭ螳・/h2>

      <div className="card">
        <div className="font-semibold mb-2">繧｢繝ｩ繝ｼ繝郁ｨｭ螳・/div>
        <div className="flex justify-between items-center">
          <p>VIX縺御ｸ螳壹ｒ雜・∴縺溘ｉ騾夂衍・医ム繝溘・・・/p>
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
        <div className="font-semibold mb-2">繝・・繧ｿ邂｡逅・/div>
        <div className="text-sm text-gray-300 mb-2">迴ｾ蝨ｨ縺ｮ菫晄怏莉ｶ謨ｰ: {portfolioLen} / 繧ｹ繝翫ャ繝励す繝ｧ繝・ヨ: {history.length}</div>
        <div className="flex gap-2 mb-3 flex-wrap">
          <button className="button" onClick={() => saveSnap('manual')}>謇句虚繧ｹ繝翫ャ繝励す繝ｧ繝・ヨ菴懈・</button>
          <button className="px-3 py-2 bg-gray-600 rounded text-white" onClick={async() => {
            try { await navigator.clipboard.writeText(JSON.stringify(useStore.getState().portfolio, null, 2)); alert('繧ｳ繝斐・縺励∪縺励◆'); } catch { alert('繧ｳ繝斐・螟ｱ謨・); }
          }}>繧ｨ繧ｯ繧ｹ繝昴・繝・JSON繧偵さ繝斐・)</button>
          <button className="px-3 py-2 bg-gray-600 rounded text-white" onClick={() => {
            const legacy = readLegacyAssetsFromThisOrigin();
            if (!legacy || legacy.length === 0) { alert('縺薙・繧ｪ繝ｪ繧ｸ繝ｳ縺ｫ繝ｬ繧ｬ繧ｷ繝ｼ繝・・繧ｿ縺ｯ隕九▽縺九ｊ縺ｾ縺帙ｓ縺ｧ縺励◆'); return; }
            setState((s)=>({ ...s, portfolio: legacy }));
            useStore.getState().savePortfolioSnapshot('legacy-import');
            alert(`蜿悶ｊ霎ｼ縺ｿ螳御ｺ・ ${legacy.length} 莉ｶ`);
          }}>繝ｬ繧ｬ繧ｷ繝ｼ縺九ｉ蜿悶ｊ霎ｼ縺ｿ(縺薙・繧ｪ繝ｪ繧ｸ繝ｳ)</button>
        </div>
        <div className="space-y-2">
          <label className="block text-xs text-gray-400">JSON繧､繝ｳ繝昴・繝茨ｼ郁ｲｼ繧贋ｻ倥￠・・/label>
          <textarea className="w-full h-24 input" value={importText} onChange={(e)=>setImportText(e.target.value)} placeholder='[{"type":"CASH",...}, ...]'></textarea>
          <div>
            <button className="button" onClick={() => {
              try {
                const arr = JSON.parse(importText);
                if (!Array.isArray(arr)) throw new Error('Array expected');
                setState((s)=>({ ...s, portfolio: arr }));
                useStore.getState().savePortfolioSnapshot('import');
                alert('繧､繝ｳ繝昴・繝亥ｮ御ｺ・);
              } catch(e:any) { alert('繧､繝ｳ繝昴・繝亥､ｱ謨・ ' + (e?.message||e)); }
            }}>蜿悶ｊ霎ｼ繧</button>
          </div>
        </div>
        <div className="mt-4">
          <div className="font-semibold mb-1">譛霑代・繧ｹ繝翫ャ繝励す繝ｧ繝・ヨ</div>
          <ul className="space-y-1 text-sm">
            {recent.map(s => (
              <li key={s.key} className="flex items-center justify-between bg-gray-700 rounded px-2 py-1">
                <span>{new Date(s.ts).toLocaleString()} <span className="text-gray-300">({s.note||'-'})</span></span>
                <button className="px-2 py-1 bg-blue-600 rounded text-white" onClick={() => restoreSnap(s.key)}>蠕ｩ蜈・/button>
              </li>
            ))}
            {recent.length === 0 && <li className="text-gray-400">繧ｹ繝翫ャ繝励す繝ｧ繝・ヨ縺ｯ縺ｾ縺縺ゅｊ縺ｾ縺帙ｓ</li>}
          </ul>
        </div>
      </div>

      <div className=\"card\">
        <div className=\"font-semibold mb-2\">外出先からUIを確認したい場合</div>
        <ol className=\"list-decimal list-inside space-y-1 text-sm text-gray-300\">
          <li><code>cloudflared-windows-amd64.exe</code> をプロジェクトの <code>tools</code> フォルダに配置します（<code>cloudflared_quick_tunnel.ps1</code> と同じ場所）。</li>
          <li>初回のみ PowerShell で <code>launch_tunnel.bat -Login</code> を実行し、ブラウザで Cloudflare 認証を完了させます。</li>
          <li>以後は <code>tools\\launch_tunnel.bat</code> をダブルクリックするだけで一時URL（<code>https://*.trycloudflare.com</code>）が表示されます。PowerShell を閉じるとトンネルは終了し、URLは無効になります。</li>
        </ol>
        <p className=\"text-xs text-gray-400 mt-2\">※ セキュリティ上、ブラウザから直接ファイルを実行することはできないため、エクスプローラーでファイルを開いて実行してください。</p>
      </div>
      <WatchlistManager />
    </div>
  );
}


