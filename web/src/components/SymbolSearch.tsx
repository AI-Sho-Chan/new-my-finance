import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { searchSymbols, type SymbolSearchResult } from '../lib/symbols';

interface SymbolSearchProps {
  onSelect: (entry: SymbolSearchResult) => void;
  placeholder?: string;
  className?: string;
}

const MAX_RESULTS = 20;

export default function SymbolSearch({ onSelect, placeholder = '銘柄コード・名称で検索', className }: SymbolSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SymbolSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const blurTimer = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let ignore = false;
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setOpen(false);
      setLoading(false);
      return () => {
        ignore = true;
      };
    }
    setLoading(true);
    setOpen(true);
    searchSymbols(trimmed, MAX_RESULTS)
      .then((matches) => {
        if (!ignore) {
          setResults(matches);
          setHighlightIndex(0);
        }
      })
      .catch((err) => {
        if (!ignore) {
          console.error('symbol search failed', err);
          setResults([]);
        }
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [query]);

  const handleSelect = (entry: SymbolSearchResult) => {
    onSelect(entry);
    setQuery('');
    setResults([]);
    setOpen(false);
    setHighlightIndex(0);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  };

  const handleFocus = () => {
    if (blurTimer.current) {
      clearTimeout(blurTimer.current);
      blurTimer.current = null;
    }
    if (results.length) setOpen(true);
  };

  const handleBlur = () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    blurTimer.current = setTimeout(() => {
      setOpen(false);
    }, 150);
  };

  const handleKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (event) => {
    if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      setOpen(true);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightIndex((prev) => Math.min(prev + 1, Math.max(results.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightIndex((prev) => Math.max(prev - 1, 0));
    } else if (event.key === 'Enter') {
      if (open && results[highlightIndex]) {
        event.preventDefault();
        handleSelect(results[highlightIndex]);
      } else if (results.length === 1) {
        event.preventDefault();
        handleSelect(results[0]);
      }
    } else if (event.key === 'Escape') {
      setOpen(false);
      setResults([]);
    }
  };

  const dropdownVisible = open && (loading || results.length > 0);

  return (
    <div className={clsx('relative w-full', className)}>
      <input
        ref={inputRef}
        value={query}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full rounded-md bg-gray-950 border border-gray-700 px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        autoComplete="off"
        spellCheck={false}
      />
      {dropdownVisible && (
        <div className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-md border border-gray-700 bg-gray-900/95 shadow-xl">
          {loading && <div className="px-3 py-2 text-xs text-gray-400">検索中...</div>}
          {!loading && results.length === 0 && (
            <div className="px-3 py-2 text-xs text-gray-500">該当する銘柄が見つかりません。</div>
          )}
          {!loading && results.map((entry, index) => {
            const active = index === highlightIndex;
            return (
              <div
                key={`${entry.symbol}-${entry.region}`}
                className={clsx(
                  'px-3 py-2 cursor-pointer transition-colors',
                  active ? 'bg-indigo-600 text-white' : 'hover:bg-gray-800'
                )}
                onMouseDown={(event) => {
                  event.preventDefault();
                  handleSelect(entry);
                }}
                onMouseEnter={() => setHighlightIndex(index)}
              >
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold">{entry.symbol}</span>
                  <span className="text-xs text-gray-300">
                    {entry.exchange || entry.market || entry.region}
                  </span>
                </div>
                <div className={clsx('text-xs', active ? 'text-indigo-100' : 'text-gray-400')}>
                  {entry.name}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
