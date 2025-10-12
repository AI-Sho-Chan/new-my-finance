import { useMemo, useState } from 'react';
import { useReportsStore, type StockReport, type ReportSourceType } from '../lib/reports-store';
import { v4 as uuidv4 } from 'uuid';

type ModalState = {
  open: boolean;
};

const SOURCE_OPTIONS: { value: ReportSourceType; label: string }[] = [
  { value: 'url', label: 'Web URL' },
  { value: 'google-doc', label: 'Google Docs' },
  { value: 'file', label: 'File Link' },
  { value: 'note', label: 'Internal Note' },
];

export default function Reports() {
  const reports = useReportsStore((s) => s.reports);
  const lastSelectedId = useReportsStore((s) => s.lastSelectedId);
  const setLastSelected = useReportsStore((s) => s.setLastSelected);
  const toggleFavorite = useReportsStore((s) => s.toggleFavorite);
  const removeReport = useReportsStore((s) => s.removeReport);

  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [modal, setModal] = useState<ModalState>({ open: false });

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const tag = tagFilter.trim().toLowerCase();
    return reports.filter((report) => {
      if (tag && !report.tags.some((t) => t.toLowerCase().includes(tag))) return false;
      if (query) {
        const body = `${report.title} ${report.summary} ${report.notes ?? ''} ${report.tickers.join(' ')} ${report.tags.join(' ')}`.toLowerCase();
        if (!body.includes(query)) return false;
      }
      return true;
    });
  }, [reports, search, tagFilter]);

  const selected = useMemo(() => {
    if (!filtered.length) return null;
    const fallback = filtered[0];
    const pick = filtered.find((report) => report.id === lastSelectedId);
    return pick || fallback;
  }, [filtered, lastSelectedId]);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-100">Stock Reports</h1>
          <p className="text-sm text-gray-400">AI 生成や外部レポートを安全に保管し、ワンクリックでアクセス。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="タイトル・概要・銘柄で検索"
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
            onClick={() => setModal({ open: true })}
            className="inline-flex h-10 items-center rounded-md bg-indigo-600 px-4 text-sm font-semibold text-white shadow hover:bg-indigo-500"
          >
            レポートを追加
          </button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-400">レポート一覧 ({filtered.length})</h2>
          <div className="space-y-2 overflow-y-auto rounded-lg border border-gray-700 bg-gray-900/70 p-2 max-h-[540px]">
            {filtered.length === 0 && (
              <p className="rounded-md border border-dashed border-gray-700 bg-gray-900/60 p-4 text-sm text-gray-400">
                条件に一致するレポートがありません。
              </p>
            )}
            {filtered.map((report) => {
              const isActive = selected?.id === report.id;
              return (
                <button
                  key={report.id}
                  type="button"
                  onClick={() => setLastSelected(report.id)}
                  className={`w-full rounded-md border px-3 py-3 text-left transition ${
                    isActive ? 'border-indigo-400 bg-indigo-500/20 text-indigo-100' : 'border-gray-700 bg-gray-900/80 text-gray-200 hover:border-gray-500'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold line-clamp-2">{report.title}</h3>
                      <p className="mt-1 text-xs text-gray-400">{new Date(report.createdAt).toLocaleString('ja-JP')}</p>
                    </div>
                    {report.isFavorite && <span className="text-xs text-amber-300">★</span>}
                  </div>
                  {report.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {report.tags.map((tag) => (
                        <span key={tag} className="rounded-full bg-gray-800/80 px-2 py-0.5 text-[11px] text-gray-300">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-400">レポート詳細</h2>
          {selected ? (
            <article className="space-y-4 rounded-lg border border-gray-700 bg-gray-900/80 p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-xl font-semibold text-gray-100">{selected.title}</h3>
                  <p className="text-xs text-gray-400">作成日 {new Date(selected.createdAt).toLocaleString('ja-JP')}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleFavorite(selected.id)}
                    className={`rounded-md px-3 py-1 text-xs font-semibold ${selected.isFavorite ? 'bg-amber-400/20 text-amber-300 border border-amber-400/40' : 'bg-gray-800 text-gray-300 border border-gray-600 hover:bg-gray-700'}`}
                  >
                    {selected.isFavorite ? 'お気に入り解除' : 'お気に入り'}
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

              <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-200">{selected.summary || '概要未入力'}</p>

              <div className="grid gap-2 text-sm text-gray-300 sm:grid-cols-2">
                <div>
                  <span className="text-xs uppercase tracking-wide text-gray-500">関連銘柄</span>
                  <p>{selected.tickers.length ? selected.tickers.join(', ') : '未設定'}</p>
                </div>
                <div>
                  <span className="text-xs uppercase tracking-wide text-gray-500">タグ</span>
                  <p>{selected.tags.length ? selected.tags.join(', ') : '未設定'}</p>
                </div>
              </div>

              {selected.links.length > 0 && (
                <div className="space-y-2">
                  <span className="text-xs uppercase tracking-wide text-gray-500">リンク</span>
                  <ul className="space-y-1 text-sm">
                    {selected.links.map((link) => (
                      <li key={link.id} className="flex items-center justify-between gap-2 rounded-md bg-gray-800/60 px-3 py-2">
                        <div>
                          <p className="font-semibold text-gray-200">{link.title || link.url}</p>
                          <p className="text-xs text-gray-500">{link.type}</p>
                        </div>
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-semibold text-indigo-300 hover:text-indigo-100"
                        >
                          開く →
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {selected.notes && (
                <div>
                  <span className="text-xs uppercase tracking-wide text-gray-500">メモ</span>
                  <p className="text-sm text-gray-300 whitespace-pre-wrap">{selected.notes}</p>
                </div>
              )}
            </article>
          ) : (
            <div className="rounded-lg border border-dashed border-gray-700 bg-gray-900/60 p-8 text-center text-sm text-gray-400">
              レポートを選択してください。
            </div>
          )}
        </section>
      </div>

      {modal.open && <AddReportModal onClose={() => setModal({ open: false })} />}
    </div>
  );
}

function AddReportModal({ onClose }: { onClose: () => void }) {
  const addReport = useReportsStore((s) => s.addReport);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [tickers, setTickers] = useState('');
  const [tags, setTags] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [linkType, setLinkType] = useState<ReportSourceType>('url');
  const [notes, setNotes] = useState('');

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim()) return;
    const normalizedTickers = tickers
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);
    const normalizedTags = tags
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const links = linkUrl.trim()
      ? [
          {
            id: uuidv4(),
            type: linkType,
            url: linkUrl.trim(),
            title: linkTitle.trim() || undefined,
          } as const,
        ]
      : [];
    addReport({
      title: title.trim(),
      summary: summary.trim(),
      tickers: normalizedTickers,
      tags: normalizedTags,
      links,
      notes: notes.trim() || undefined,
      isFavorite: false,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-2xl space-y-4 rounded-lg border border-gray-700 bg-gray-900 p-6 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-100">レポートを追加</h2>
          <button type="button" onClick={onClose} className="text-sm text-gray-400 hover:text-gray-200">
            ✕
          </button>
        </div>

        <label className="block space-y-1 text-sm">
          <span className="text-gray-400">タイトル</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100 focus:border-indigo-500 focus:outline-none"
            placeholder="例: AI業界 2025年展望"
            required
          />
        </label>

        <label className="block space-y-1 text-sm">
          <span className="text-gray-400">概要</span>
          <textarea
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            rows={4}
            className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100 focus:border-indigo-500 focus:outline-none"
            placeholder="レポートの要約を入力"
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1 text-sm">
            <span className="text-gray-400">銘柄コード</span>
            <input
              value={tickers}
              onChange={(event) => setTickers(event.target.value)}
              className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100 focus:border-indigo-500 focus:outline-none"
              placeholder="AAPL, MSFT, 7203.T"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-gray-400">タグ</span>
            <input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100 focus:border-indigo-500 focus:outline-none"
              placeholder="生成AI, 決算, 日本株"
            />
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
          <label className="block space-y-1 text-sm">
            <span className="text-gray-400">リンク種別</span>
            <select
              value={linkType}
              onChange={(event) => setLinkType(event.target.value as ReportSourceType)}
              className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100 focus:border-indigo-500 focus:outline-none"
            >
              {SOURCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-2">
            <label className="space-y-1 text-sm">
              <span className="text-gray-400">リンク URL</span>
              <input
                value={linkUrl}
                onChange={(event) => setLinkUrl(event.target.value)}
                className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100 focus:border-indigo-500 focus:outline-none"
                placeholder="https://"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-gray-400">リンクタイトル</span>
              <input
                value={linkTitle}
                onChange={(event) => setLinkTitle(event.target.value)}
                className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100 focus:border-indigo-500 focus:outline-none"
                placeholder="例: Google Docs"
              />
            </label>
          </div>
        </div>

        <label className="block space-y-1 text-sm">
          <span className="text-gray-400">メモ</span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100 focus:border-indigo-500 focus:outline-none"
            placeholder="社内コメントや生成AIプロンプトなど"
          />
        </label>

        <div className="flex justify-end gap-2 text-sm">
          <button type="button" onClick={onClose} className="rounded-md border border-gray-700 px-3 py-2 text-gray-200 hover:bg-gray-800">
            キャンセル
          </button>
          <button type="submit" className="rounded-md bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-500">
            保存
          </button>
        </div>
      </form>
    </div>
  );
}
