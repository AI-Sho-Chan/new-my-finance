import { useEffect, useMemo, useState } from 'react';
import Dashboard from './components/Dashboard';
import Portfolio from './components/Portfolio';
import Analysis from './components/Analysis';
import Settings from './components/Settings';
import NavBar from './components/NavBar';
import { NavigationContext, TabKey } from './lib/navigation';
import { migrateLegacyAssetsIfAny } from './lib/legacy';
import { useStore } from './store';

export default function App() {
  const initialTab = useMemo<TabKey>(() => {
    try {
      if (typeof window !== 'undefined') {
        const h = (window.location.hash || '').replace('#', '');
        const q = new URLSearchParams(window.location.search);
        const viaHash = h?.toLowerCase();
        const viaQuery = (q.get('tab') || '').toLowerCase();
        const pick = (s: string | null | undefined) =>
          s === 'dashboard' || s === 'portfolio' || s === 'analysis' || s === 'settings'
            ? (s as TabKey)
            : null;
        return pick(viaHash) || pick(viaQuery) || 'dashboard';
      }
    } catch {}
    return 'dashboard';
  }, []);

  const [tab, setTab] = useState<TabKey>(initialTab);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handle = () => {
      try {
        const hash = (window.location.hash || '').replace('#', '').toLowerCase();
        if (hash === 'dashboard' || hash === 'portfolio' || hash === 'analysis' || hash === 'settings') {
          setTab((prev) => (prev === hash ? prev : (hash as TabKey)));
        }
      } catch {}
    };
    window.addEventListener('hashchange', handle);
    return () => window.removeEventListener('hashchange', handle);
  }, []);

  const isEmbed = useMemo(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      const e = (q.get('embed') || '').toLowerCase();
      const inIframe = window.self !== window.top;
      return inIframe || e === '1' || e === 'true' || e === 'analysis' || e === 'bare';
    } catch {
      return false;
    }
  }, []);
  const isBare = isEmbed && tab === 'analysis';

  const saveSnap = useStore((s) => s.savePortfolioSnapshot);

  useEffect(() => {
    try {
      migrateLegacyAssetsIfAny();
    } catch {}
    try {
      const hist = useStore.getState().portfolioHistory || [];
      const today0 = new Date();
      today0.setHours(0, 0, 0, 0);
      const hasToday = hist.some((h) => {
        const d = new Date(h.ts);
        d.setHours(0, 0, 0, 0);
        return d.getTime() === today0.getTime();
      });
      if (!hasToday) saveSnap('daily');
    } catch {}
    try {
      const h = (window.location.hash || '').replace('#', '').toLowerCase();
      const q = new URLSearchParams(window.location.search);
      const via = (h || q.get('tab') || '').toLowerCase();
      if (via === 'analysis' || via === 'dashboard' || via === 'portfolio' || via === 'settings') {
        setTab(via as TabKey);
      }
    } catch {}
  }, []);


  useEffect(() => {
    try {
      if (typeof window !== 'undefined') window.location.hash = `#${tab}`;
    } catch {}
  }, [tab]);

  useEffect(() => {
    if (!isBare) return;
    try {
      const ResizeObserverCtor = (window as any).ResizeObserver;
      if (!ResizeObserverCtor) return;
      const ro = new ResizeObserverCtor(() => {
        const h = document.body.scrollHeight || document.documentElement.scrollHeight || 0;
        window.parent?.postMessage({ type: 'analysisSize', height: h }, window.location.origin);
      });
      ro.observe(document.body);
      const tick = () => {
        const h = document.body.scrollHeight || document.documentElement.scrollHeight || 0;
        window.parent?.postMessage({ type: 'analysisSize', height: h }, window.location.origin);
      };
      const id = window.setInterval(tick, 500);
      tick();
      return () => {
        ro.disconnect();
        window.clearInterval(id);
      };
    } catch {}
  }, [isBare]);

  if (isBare) {
    return (
      <div className="px-2 py-2">
        <Analysis bare />
      </div>
    );
  }

  return (
    <NavigationContext.Provider value={{ setTab }}>
      <div className="min-h-screen">
        <NavBar activeTab={tab} setActiveTab={(next) => setTab(next)} />
        <div className="container mx-auto px-4 pt-4 pb-8">
          <Header />
          <main>
            {tab === 'dashboard' && <Dashboard />}
            {tab === 'portfolio' && <Portfolio />}
            {tab === 'analysis' && <Analysis />}
            {tab === 'settings' && <Settings />}
          </main>
        </div>
      </div>
    </NavigationContext.Provider>
  );
}

function Header() {
  return (
    <header className="py-6">
      <h1 className="text-3xl font-bold text-gray-100">資産マネージャー</h1>
      <p className="text-md text-gray-400">あなたの資産と相場を、ひと目で把握</p>
    </header>
  );
}

