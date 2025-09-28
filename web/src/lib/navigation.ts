import { createContext } from 'react';

export type TabKey = 'dashboard' | 'portfolio' | 'analysis' | 'usdjpy' | 'settings';

export const NavigationContext = createContext<{ setTab: (tab: TabKey) => void } | null>(null);
