import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';

export type ReportSourceType = 'url' | 'google-doc' | 'file' | 'note';

export type ReportLink = {
  id: string;
  type: ReportSourceType;
  url: string;
  title?: string;
  description?: string;
};

export type StockReport = {
  id: string;
  title: string;
  summary: string;
  createdAt: string;
  updatedAt?: string;
  tickers: string[];
  tags: string[];
  links: ReportLink[];
  notes?: string;
  isFavorite?: boolean;
};

type ReportsState = {
  reports: StockReport[];
  lastSelectedId: string | null;
};

type ReportsActions = {
  addReport: (input: Omit<StockReport, 'id' | 'createdAt' | 'updatedAt'>) => StockReport;
  updateReport: (id: string, updater: (report: StockReport) => StockReport) => void;
  removeReport: (id: string) => void;
  toggleFavorite: (id: string) => void;
  setLastSelected: (id: string | null) => void;
};

const SEED_REPORTS: StockReport[] = [
  {
    id: uuidv4(),
    title: '生成AIマーケット概況 (2025-10-10)',
    summary:
      '生成AIで作成した最新の米国大型株レポート。AAPL、MSFT、GOOGL など主要テック銘柄の評価と、生成AI関連サプライチェーンの収益見通しをまとめています。',
    createdAt: new Date().toISOString(),
    tickers: ['AAPL', 'MSFT', 'GOOGL'],
    tags: ['生成AI', '米国株', '決算レビュー'],
    links: [
      {
        id: uuidv4(),
        type: 'url',
        url: 'https://example.com/reports/ai-overview-2025-10-10',
        title: 'AI Overview 2025-10-10',
      },
    ],
    notes: 'ChatGPT-4o、Claude を併用して生成。',
    isFavorite: true,
  },
  {
    id: uuidv4(),
    title: 'トヨタ決算サマリー (FY2025 Q2)',
    summary:
      '生成AIで作成したトヨタ自動車の決算要約。国内需要とEV戦略、為替感応度、2026年までのEPS見通しを整理。',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString(),
    tickers: ['7203.T'],
    tags: ['日本株', '決算サマリー'],
    links: [
      {
        id: uuidv4(),
        type: 'google-doc',
        url: 'https://docs.google.com/document/d/placeholder',
        title: 'Toyota FY2025 Q2 Summary',
      },
    ],
    notes: 'Google Docs 共有リンク。アクセス権限に注意。',
  },
];

const ensureId = (report: StockReport): StockReport => ({
  ...report,
  id: report.id || uuidv4(),
});

export const useReportsStore = create<ReportsState & ReportsActions>()(
  persist(
    (set, get) => ({
      reports: SEED_REPORTS.map(ensureId),
      lastSelectedId: SEED_REPORTS[0]?.id ?? null,
      addReport: (input) => {
        const now = new Date().toISOString();
        const report: StockReport = {
          ...input,
          id: uuidv4(),
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({ reports: [report, ...state.reports], lastSelectedId: report.id }));
        return report;
      },
      updateReport: (id, updater) => {
        set((state) => ({
          reports: state.reports.map((report) =>
            report.id === id ? { ...updater(report), updatedAt: new Date().toISOString() } : report
          ),
        }));
      },
      removeReport: (id) => {
        set((state) => ({
          reports: state.reports.filter((r) => r.id !== id),
          lastSelectedId: state.lastSelectedId === id ? state.reports.find((r) => r.id !== id)?.id ?? null : state.lastSelectedId,
        }));
      },
      toggleFavorite: (id) => {
        set((state) => ({
          reports: state.reports.map((report) =>
            report.id === id ? { ...report, isFavorite: !report.isFavorite } : report
          ),
        }));
      },
      setLastSelected: (id) => set({ lastSelectedId: id }),
    }),
    {
      name: 'reports-store',
      storage: createJSONStorage(() => localStorage),
      partialize: ({ reports, lastSelectedId }) => ({ reports, lastSelectedId }),
    }
  )
);
