import WatchlistManager from './WatchlistManager';

export default function Settings() {
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold text-gray-200">設定</h2>
      <div className="card">
        <div className="font-semibold mb-2">アラート設定</div>
        <div className="flex justify-between items-center">
          <p>S&P 500 VIXが40を超えたら通知</p>
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
      <WatchlistManager />
    </div>
  );
}
