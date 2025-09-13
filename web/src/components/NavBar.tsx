import { HomeIcon, PieChartIcon, SettingsIcon } from './icons';

type TabKey = 'dashboard' | 'portfolio' | 'analysis' | 'settings';

export default function NavBar({ activeTab, setActiveTab }: { activeTab: TabKey; setActiveTab: (t: TabKey) => void }) {
  const items: { id: TabKey; label: string; icon: JSX.Element }[] = [
    { id: 'dashboard', label: 'ダッシュボード', icon: <HomeIcon /> },
    { id: 'portfolio', label: '資産', icon: <PieChartIcon /> },
    { id: 'analysis', label: '分析', icon: <PieChartIcon /> },
    { id: 'settings', label: '設定', icon: <SettingsIcon /> },
  ];
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-gray-800 border-t border-gray-700 shadow-lg">
      <div className="flex justify-around max-w-lg mx-auto">
        {items.map((i) => (
          <button
            key={i.id}
            onClick={() => setActiveTab(i.id)}
            className={`flex flex-col items-center justify-center w-full pt-2 pb-1 ${activeTab === i.id ? 'text-indigo-400' : 'text-gray-400'}`}
          >
            {i.icon}
            <span className="text-xs">{i.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

