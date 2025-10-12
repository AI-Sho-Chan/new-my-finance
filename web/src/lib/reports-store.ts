import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

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

type CreateReportInput = {
  title: string;
  summary: string;
  tickers: string[];
  tags: string[];
  links: ReportLink[];
  notes?: string;
  isFavorite?: boolean;
};

type ReportsState = {
  reports: StockReport[];
  lastSelectedId: string | null;
  isLoading: boolean;
  hasHydrated: boolean;
  error: string | null;
};

type ReportsActions = {
  loadReports: () => Promise<void>;
  addReport: (input: CreateReportInput) => Promise<StockReport>;
  removeReport: (id: string) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
  setLastSelected: (id: string | null) => void;
  clearError: () => void;
};

const DEFAULT_BACKEND_URL =
  typeof window !== 'undefined' && window?.location?.origin
    ? window.location.origin
    : 'http://127.0.0.1:8000';

const rawBackendUrl =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_BACKEND_URL) || DEFAULT_BACKEND_URL;

const API_BASE = String(rawBackendUrl).replace(/\/+$/, '');

type ApiReportResponse = { report: StockReport };
type ApiReportsResponse = { reports: StockReport[] };

async function fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = new URL(path, API_BASE);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(url.toString(), { ...init, headers });
  let data: any = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const message =
      typeof data?.message === 'string'
        ? data.message
        : typeof data?.error === 'string'
        ? data.error
        : `Request failed (${response.status})`;
    const error = new Error(message);
    (error as any).status = response.status;
    (error as any).details = data;
    throw error;
  }
  return data as T;
}

function serializeLinks(links: ReportLink[]): ReportLink[] {
  return links
    .filter((link) => link && typeof link.url === 'string' && link.url.trim())
    .map((link) => {
      const url = link.url.trim();
      const title = link.title?.trim();
      const description = link.description?.trim();
      const out: ReportLink = {
        id: link.id,
        type: link.type,
        url,
      };
      if (title) out.title = title;
      if (description) out.description = description;
      return out;
    });
}

export const useReportsStore = create<ReportsState & ReportsActions>()(
  persist(
    (set, get) => ({
      reports: [],
      lastSelectedId: null,
      isLoading: false,
      hasHydrated: false,
      error: null,
      async loadReports() {
        set({ isLoading: true, error: null });
        try {
          const data = await fetchJson<ApiReportsResponse>('/api/reports');
          const reports = Array.isArray(data?.reports) ? data.reports : [];
          set((state) => {
            const current = state.lastSelectedId;
            const selected = reports.find((report) => report.id === current)
              ? current
              : reports[0]?.id ?? null;
            return {
              reports,
              lastSelectedId: selected,
              isLoading: false,
              hasHydrated: true,
              error: null,
            };
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to load reports';
          set({ isLoading: false, hasHydrated: true, error: message });
        }
      },
      async addReport(input) {
        set({ error: null });
        const payload = {
          title: input.title,
          summary: input.summary,
          tickers: input.tickers,
          tags: input.tags,
          links: serializeLinks(input.links),
          notes: typeof input.notes === 'string' && input.notes.trim() ? input.notes.trim() : undefined,
          isFavorite: Boolean(input.isFavorite),
        };
        try {
          const data = await fetchJson<ApiReportResponse>('/api/reports', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          const report = data?.report;
          if (!report) {
            throw new Error('Invalid response from server');
          }
          set((state) => {
            const deduped = state.reports.filter((item) => item.id !== report.id);
            return {
              reports: [report, ...deduped],
              lastSelectedId: report.id,
            };
          });
          return report;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to add report';
          set({ error: message });
          throw error instanceof Error ? error : new Error(message);
        }
      },
      async removeReport(id) {
        if (!id) return;
        try {
          await fetchJson(`/api/reports/${encodeURIComponent(id)}`, { method: 'DELETE' });
          set((state) => {
            const next = state.reports.filter((report) => report.id !== id);
            const nextSelected =
              state.lastSelectedId === id ? next[0]?.id ?? null : state.lastSelectedId;
            return { reports: next, lastSelectedId: nextSelected };
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to delete report';
          set({ error: message });
        }
      },
      async toggleFavorite(id) {
        if (!id) return;
        const current = get().reports.find((report) => report.id === id);
        if (!current) return;
        const nextFlag = !current.isFavorite;
        set((state) => ({
          reports: state.reports.map((report) =>
            report.id === id ? { ...report, isFavorite: nextFlag } : report
          ),
        }));
        try {
          const data = await fetchJson<ApiReportResponse>(`/api/reports/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: JSON.stringify({ isFavorite: nextFlag }),
          });
          const report = data?.report;
          if (report) {
            set((state) => ({
              reports: state.reports.map((item) => (item.id === id ? report : item)),
            }));
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to update favorite flag';
          set((state) => ({
            reports: state.reports.map((item) => (item.id === id ? current : item)),
            error: message,
          }));
        }
      },
      setLastSelected(id) {
        set({ lastSelectedId: id });
      },
      clearError() {
        set({ error: null });
      },
    }),
    {
      name: 'reports-store',
      storage: createJSONStorage(() => localStorage),
      partialize: ({ reports, lastSelectedId }) => ({ reports, lastSelectedId }),
    }
  )
);
