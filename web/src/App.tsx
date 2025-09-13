import { useEffect, useMemo, useState } from 'react';
import Dashboard from './components/Dashboard';
import Portfolio from './components/Portfolio';
import Analysis from './components/Analysis';
import Settings from './components/Settings';
import { HomeIcon, PieChartIcon, SettingsIcon } from './components/icons';
import NavBar from './components/NavBar';
import { migrateLegacyAssetsIfAny } from './lib/legacy';
import { useStore } from './store';

type TabKey = 'dashboard' | 'portfolio' | 'analysis' | 'settings';

export default function App() {
  const initialTab = useMemo<TabKey>(() => {
    if (typeof window !== 'undefined') {
      const h = window.location.hash.replace('#','');
      if (h === 'dashboard' || h === 'portfolio' || h === 'analysis' || h === 'settings') return h as TabKey;
    }
    return 'dashboard';
  }, []);
  const [tab, setTab] = useState<TabKey>(initialTab);
  const saveSnap = useStore((s) => s.savePortfolioSnapshot);
  useEffect(() => {
    // Attempt to restore legacy-saved assets if present and portfolio is empty
    try { migrateLegacyAssetsIfAny(); } catch {}
    // Ensure at least one snapshot per day
    try {
      const hist = useStore.getState().portfolioHistory || [];
      const today0 = new Date(); today0.setHours(0,0,0,0);
      const hasToday = hist.some(h => { const d = new Date(h.ts); d.setHours(0,0,0,0); return d.getTime() === today0.getTime(); });
      if (!hasToday) saveSnap('daily');
    } catch {}
  }, []);
  useEffect(() => {
    try { if (typeof window !== 'undefined') window.location.hash = '#' + tab; } catch {}
  }, [tab]);
  return (
    <div className="min-h-screen">
      <div className="container mx-auto px-4 pb-20">
        <Header />
        <main>
          {tab === 'dashboard' && <Dashboard />}
          {tab === 'portfolio' && <Portfolio />}
          {tab === 'analysis' && <Analysis />}
          {tab === 'settings' && <Settings />}
        </main>
      </div>
      <NavBar activeTab={tab as any} setActiveTab={setTab as any} />
    </div>
  );
}

function Header() {
  return (
    <header className="py-6">
      <h1 className="text-3xl font-bold text-gray-100">資産マネージャー</h1>
      <p className="text-md text-gray-400">あなたの資産と相場を、ひと目で把握。</p>
    </header>
  );
}

function BottomNav({ activeTab, setActiveTab }: { activeTab: TabKey; setActiveTab: (t: TabKey) => void }) {
  const items: { id: TabKey; label: string; icon: JSX.Element }[] = [
    { id: 'dashboard', label: 'ダッシュボード', icon: <HomeIcon /> },
    { id: 'portfolio', label: '資産管理', icon: <PieChartIcon /> },
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
