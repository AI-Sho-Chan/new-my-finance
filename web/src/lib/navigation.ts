import { createContext } from 'react';

export type TabKey = 'dashboard' | 'portfolio' | 'analysis' | 'settings';

export const NavigationContext = createContext<{ setTab: (tab: TabKey) => void } | null>(null);
