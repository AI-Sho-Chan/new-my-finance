import type { MouseEvent } from 'react';

type Props = {
  label: string;
  color: string;
  onClick?: () => void;
  onRemove?: () => void;
  compact?: boolean;
  removable?: boolean;
  variant?: 'default' | 'muted';
};

export default function GroupTag({ label, color, onClick, onRemove, compact, removable, variant = 'default' }: Props) {
  const sizeClass = compact ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5';
  const interactive = Boolean(onClick);
  const handleRemove = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onRemove?.();
  };

  if (variant === 'muted') {
    return (
      <span
        onClick={onClick}
        className={`inline-flex items-center gap-1 rounded-full border border-gray-700 bg-gray-900/60 ${sizeClass} ${interactive ? 'cursor-pointer hover:border-gray-500' : 'cursor-default'}`}
      >
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-gray-300">{label}</span>
        {removable && (
          <button
            type="button"
            onClick={handleRemove}
            className="ml-1 rounded-full bg-black/20 px-1 text-[10px] leading-none text-gray-300 hover:bg-black/40 hover:text-gray-100"
            aria-label={`${label}タグを削除`}
          >
            ×
          </button>
        )}
      </span>
    );
  }

  return (
    <span
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border border-white/10 bg-opacity-20 text-white ${sizeClass} ${interactive ? 'cursor-pointer hover:opacity-100' : 'cursor-default'}`}
      style={{ backgroundColor: color, opacity: 0.85 }}
    >
      {label}
      {removable && (
        <button
          type="button"
          onClick={handleRemove}
          className="ml-1 rounded-full bg-black/30 px-1 text-[10px] leading-none text-white/80 hover:bg-black/50 hover:text-white"
          aria-label={`${label}タグを削除`}
        >
          ×
        </button>
      )}
    </span>
  );
}
