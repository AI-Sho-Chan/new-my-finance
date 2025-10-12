import { FormEvent, useEffect, useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
  useReportsStore,
  type StockReport,
  type ReportLink,
  type ReportSourceType,
} from '../lib/reports-store';

type ModalState = {
  open: boolean;
  draft?: Partial<StockReport>;
};

type LinkDraft = {
  id: string;
  type: ReportSourceType;
  url: string;
  title: string;
};

const SOURCE_LABEL: Record<ReportSourceType, string> = {
  url: 'Web URL',
  'google-doc': 'Google Docs',
  file: 'File Link',
  note: 'Internal Note',
};

const normalizeCommaSeparated = (value: string, uppercase = false) =>
  value
    .split(',')
    .map((part) => (uppercase ? part.trim().toUpperCase() : part.trim()))
    .filter(Boolean);

export default function Reports() {
  const reports = useReportsStore((s) => s.reports);
  const lastSelectedId = useReportsStore((s) => s.lastSelectedId);
  const setLastSelected = useReportsStore((s) => s.setLastSelected);
  const toggleFavorite = useReportsStore((s) => s.toggleFavorite);
  const removeReport = useReportsStore((s) => s.removeReport);

  const loadReports = useReportsStore((s) => s.loadReports);
  const isLoading = useReportsStore((s) => s.isLoading);
  const hasHydrated = useReportsStore((s) => s.hasHydrated);
  const error = useReportsStore((s) => s.error);
  const clearError = useReportsStore((s) => s.clearError);

  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [modal, setModal] = useState<ModalState>({ open: false });

  useEffect(() => {
    if (!hasHydrated) {
      void loadReports();
    }
  }, [hasHydrated, loadReports]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const tag = tagFilter.trim().toLowerCase();
    return reports.filter((report) => {
      if (tag && !report.tags.some((t) => t.toLowerCase().includes(tag))) return false;
      if (query) {
        const bucket = [
          report.title,
          report.summary,
          report.notes ?? '',
          report.tickers.join(' '),
          report.tags.join(' '),
        ]
          .join(' ')
          .toLowerCase();
        if (!bucket.includes(query)) return false;
      }
      return true;
    });
  }, [reports, search, tagFilter]);

  const selected = useMemo(() => {
    if (!filtered.length) return null;
    const byId = filtered.find((report) => report.id === lastSelectedId);
    return byId ?? filtered[0];
  }, [filtered, lastSelectedId]);


  const showInitialLoading = isLoading && !hasHydrated && reports.length === 0;
  const showNoResults = !isLoading && filtered.length === 0;

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-md border border-red-500/60 bg-red-500/10 px-4 py-2 text-sm text-red-200">
          <div className="flex items-start justify-between gap-2">
            <span>{error}</span>
            <button
              type="button"
              onClick={clearError}
              className="text-xs text-red-100 underline-offset-2 hover:text-white"
            >
              閉じる
            </button>
          </div>
        </div>
      )}

      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-100">Stock Reports</h1>
          <p className="text-sm text-gray-400">
            最新AIリサーチで作成したレポートを保存し、ワンクリックでアクセス。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="タイトル・サマリー・本文で検索"
            className="h-10 w-56 rounded-md border border-gray-700 bg-gray-900 px-3 text-sm text-gray-100 placeholder:text-gray-500 focus:border-indigo-500 focus:outline-none"
          />
          <input
            value={tagFilter}
            onChange={(event) => setTagFilter(event.target.value)}
            placeholder="タグで絞り込み"
            className="h-10 w-40 rounded-md border border-gray-700 bg-gray-900 px-3 text-sm text-gray-100 placeholder:text-gray-500 focus:border-indigo-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => {
              clearError();
              setModal({ open: true });
            }}
            className="inline-flex h-10 items-center rounded-md bg-indigo-600 px-4 text-sm font-semibold text-white shadow hover:bg-indigo-500"
          >
            レポートを追加
          </button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-400">レポート一覧 ({filtered.length})</h2>
          <div className="max-h-[520px] space-y-2 overflow-y-auto rounded-lg border border-gray-700 bg-gray-900/70 p-2">
            {showInitialLoading ? (
              <p className="rounded-md border border-dashed border-gray-700 bg-gray-900/60 p-4 text-sm text-gray-400">
                読み込み中です…
              </p>
            ) : showNoResults ? (
              <p className="rounded-md border border-dashed border-gray-700 bg-gray-900/60 p-4 text-sm text-gray-400">
                条件に合うレポートがありません。
              </p>
            ) : (
              filtered.map((report) => {
                const isActive = selected?.id === report.id;
                return (
                  <button
                    key={report.id}
                    type="button"
                    onClick={() => setLastSelected(report.id)}
                    className={`w-full rounded-md border px-3 py-3 text-left transition ${
                      isActive
                        ? 'border-indigo-400 bg-indigo-500/20 text-indigo-100'
                        : 'border-gray-700 bg-gray-900/80 text-gray-200 hover:border-gray-500'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-semibold line-clamp-2">{report.title}</h3>
                        <p className="mt-1 text-xs text-gray-400">
                          {new Date(report.createdAt).toLocaleString('ja-JP')}
                        </p>
                      </div>
                      {report.isFavorite && <span className="text-xs text-amber-300">★</span>}
                    </div>
                    {report.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {report.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-gray-800/80 px-2 py-0.5 text-[11px] text-gray-300"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-400">レポート詳細</h2>
          {selected ? (
            <article className="space-y-4 rounded-lg border border-gray-700 bg-gray-900/80 p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-xl font-semibold text-gray-100">{selected.title}</h3>
                  <p className="text-xs text-gray-400">
                    作成日 {new Date(selected.createdAt).toLocaleString('ja-JP')}
                    {selected.updatedAt
                      ? ` / 更新日 ${new Date(selected.updatedAt).toLocaleString('ja-JP')}`
                      : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleFavorite(selected.id)}
                    className={`rounded-md px-3 py-1 text-xs font-semibold ${
                      selected.isFavorite
                        ? 'border border-amber-400/40 bg-amber-400/20 text-amber-300'
                        : 'border border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700'
                    }`}
                  >
                    {selected.isFavorite ? 'お気に入りを解除' : 'お気に入り登録'}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeReport(selected.id)}
                    className="rounded-md border border-red-500/60 bg-red-500/10 px-3 py-1 text-xs text-red-200 hover:bg-red-500/20"
                  >
                    削除
                  </button>
                </div>
              </div>

              {selected.summary && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-300">サマリー</h4>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-gray-200">{selected.summary}</p>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <InfoBlock
                  label="ティッカー"
                  value={selected.tickers.length ? selected.tickers.join(', ') : '-'}
                />
                <InfoBlock
                  label="タグ"
                  value={selected.tags.length ? selected.tags.map((tag) => `#${tag}`).join(' ') : '-'}
                />
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-gray-300">リンク</h4>
                <ul className="space-y-2">
                  {selected.links.map((link) => (
                    <li
                      key={link.id}
                      className="flex items-start justify-between gap-2 rounded-md border border-gray-700 bg-gray-800/70 px-3 py-2"
                    >
                      <div>
                        <p className="font-semibold text-gray-100">{link.title || link.url}</p>
                        <p className="text-xs text-gray-500">{SOURCE_LABEL[link.type]}</p>
                      </div>
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-semibold text-indigo-300 hover:text-indigo-100"
                      >
                        開く ▸
                      </a>
                    </li>
                  ))}
                </ul>
              </div>

              {selected.notes && (
                <div>
                  <span className="text-xs uppercase tracking-wide text-gray-500">メモ</span>
                  <p className="whitespace-pre-wrap text-sm text-gray-300">{selected.notes}</p>
                </div>
              )}
            </article>
          ) : (
            <div className="rounded-lg border border-dashed border-gray-700 bg-gray-900/60 p-12 text-center text-sm text-gray-400">
              レポートを選択すると詳細が表示されます。
            </div>
          )}
        </section>
      </div>

      {modal.open && (
        <AddReportModal
          onClose={() => {
            clearError();
            setModal({ open: false });
          }}
        />
      )}
    </div>
  );
}

function InfoBlock({ label, value }: InfoBlockProps) {
  return (
    <div>
      <span className="text-xs uppercase tracking-wide text-gray-500">{label}</span>
      <p>{value}</p>
    </div>
  );
}

function AddReportModal({ onClose }: { onClose: () => void }) {
  const addReport = useReportsStore((s) => s.addReport);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [tickers, setTickers] = useState('');
  const [tags, setTags] = useState('');
  const [links, setLinks] = useState<LinkDraft[]>([createEmptyLinkDraft()]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('タイトルを入力してください。');
      return;
    }

    const cleanedLinks: ReportLink[] = links
      .filter((link) => link.url.trim())
      .map((link) => ({
        id: link.id,
        type: link.type,
        url: link.url.trim(),
        title: link.title.trim() || undefined,
      }));

    if (!cleanedLinks.length) {
      setError('リンクを1件以上入力してください。');
      return;
    }

    setIsSubmitting(true);
    try {
      await addReport({
        title: title.trim(),
        summary: summary.trim(),
        tickers: normalizeCommaSeparated(tickers, true),
        tags: normalizeCommaSeparated(tags, false),
        links: cleanedLinks,
        notes: notes.trim() || undefined,
        isFavorite: false,
      });
      onClose();
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'レポートの登録に失敗しました。';
      setError(message);
      setIsSubmitting(false);
    }
  };

  const updateLink = (id: string, patch: Partial<LinkDraft>) => {
    setLinks((prev) => prev.map((link) => (link.id === id ? { ...link, ...patch } : link)));
  };

  const removeLink = (id: string) => {
    setLinks((prev) => (prev.length <= 1 ? prev : prev.filter((link) => link.id !== id)));
  };

  const addLinkRow = () => {
    setLinks((prev) => [...prev, createEmptyLinkDraft()]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-3xl space-y-5 rounded-lg border border-gray-700 bg-gray-900 p-6 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-100">レポートを追加</h2>
          <button type="button" onClick={onClose} className="text-sm text-gray-400 hover:text-gray-200">
            ×
          </button>
        </div>
        {error && (
          <div className="rounded-md border border-red-500/60 bg-red-500/10 px-4 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <label className="block space-y-1 text-sm">
          <span className="text-gray-400">タイトル</span>
          <input
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              if (error) setError(null);
            }}
            className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100 focus:border-indigo-500 focus:outline-none"
            placeholder="例: 最新AI市場レポート"
            required
          />
        </label>

        <label className="block space-y-1 text-sm">
          <span className="text-gray-400">サマリー</span>
          <textarea
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            rows={4}
            className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100 focus:border-indigo-500 focus:outline-none"
            placeholder="レポートの概要を入力"
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1 text-sm">
            <span className="text-gray-400">ティッカー (カンマ区切り)</span>
            <input
              value={tickers}
              onChange={(event) => setTickers(event.target.value)}
              className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100 focus:border-indigo-500 focus:outline-none"
              placeholder="AAPL, MSFT, 7203.T"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-gray-400">タグ (カンマ区切り)</span>
            <input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100 focus:border-indigo-500 focus:outline-none"
              placeholder="生成AI, 自動車, 日本株"
            />
          </label>
        </div>

        <div className="space-y-3">
          <span className="block text-sm font-semibold text-gray-300">リンク</span>
          {links.map((link, index) => (
            <div
              key={link.id}
              className="grid gap-3 rounded-md border border-gray-700 bg-gray-800/60 p-3 sm:grid-cols-[160px_1fr_120px]"
            >
              <select
                value={link.type}
                onChange={(event) => updateLink(link.id, { type: event.target.value as ReportSourceType })}
                className="rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-indigo-500 focus:outline-none"
              >
                {Object.entries(SOURCE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                value={link.url}
                onChange={(event) => updateLink(link.id, { url: event.target.value })}
                placeholder="https://"
                className="rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-indigo-500 focus:outline-none"
                required
              />
              <div className="flex gap-2">
                <input
                  value={link.title}
                  onChange={(event) => updateLink(link.id, { title: event.target.value })}
                  placeholder="リンクタイトル"
                  className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-indigo-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => removeLink(link.id)}
                  className="rounded-md border border-red-500/50 px-3 py-2 text-xs text-red-300 hover:bg-red-500/10"
                  disabled={links.length <= 1}
                >
                  削除
                </button>
              </div>
              {index === links.length - 1 && (
                <div className="sm:col-span-3">
                  <button
                    type="button"
                    onClick={addLinkRow}
                    className="rounded-md border border-gray-600 px-3 py-1 text-xs text-gray-300 hover:bg-gray-700"
                  >
                    リンクを追加
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <label className="block space-y-1 text-sm">
          <span className="text-gray-400">メモ</span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100 focus:border-indigo-500 focus:outline-none"
            placeholder="補足コメントや要点"
          />
        </label>

        <div className="flex justify-end gap-2 text-sm">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-700 px-3 py-2 text-gray-200 hover:bg-gray-800"
            disabled={isSubmitting}
          >
            キャンセル
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
    </div>
  );
}

function createEmptyLinkDraft(): LinkDraft {
  return {
    id: uuidv4(),
    type: 'url',
    url: '',
    title: '',
  };
}













