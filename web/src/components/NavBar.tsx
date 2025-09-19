import { HomeIcon, PieChartIcon, SettingsIcon } from './icons';
import type { TabKey } from '../lib/navigation';

export default function NavBar({ activeTab, setActiveTab }: { activeTab: TabKey; setActiveTab: (t: TabKey) => void }) {
  const items: { id: TabKey; label: string; icon: JSX.Element }[] = [
    { id: 'dashboard', label: 'ダッシュボード', icon: <HomeIcon /> },
    { id: 'portfolio', label: '資産', icon: <PieChartIcon /> },
    { id: 'analysis', label: '分析', icon: <PieChartIcon /> },
    { id: 'settings', label: '設定', icon: <SettingsIcon /> },
  ];
  return (
    <nav className="sticky top-0 left-0 right-0 z-50 bg-gray-800/95 backdrop-blur border-b border-gray-700 shadow">
      <div className="flex justify-around max-w-4xl mx-auto">
        {items.map((i) => (
          <button
            key={i.id}
            type="button"
            onClick={() => setActiveTab(i.id)}
            className={`flex items-center gap-2 px-4 py-3 ${activeTab === i.id ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-gray-300'}`}
          >
            {i.icon}
            <span className="text-sm font-medium">{i.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

