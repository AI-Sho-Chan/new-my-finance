import type { MouseEvent } from 'react';

type Props = {
  label: string;
  color: string;
  onClick?: () => void;
  onRemove?: () => void;
  compact?: boolean;
  removable?: boolean;
};

export default function GroupTag({ label, color, onClick, onRemove, compact, removable }: Props) {
  const className = compact ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5';
  const interactive = Boolean(onClick);
  const handleRemove = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onRemove?.();
  };

  return (
    <span
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border border-white/10 border-opacity-30 bg-opacity-20 text-white ${className} ${interactive ? 'cursor-pointer hover:opacity-100' : 'cursor-default'} mr-1 mb-1`}
      style={{ backgroundColor: color, opacity: 0.85 }}
    >
      {label}
      {removable && (
        <button
          type="button"
          onClick={handleRemove}
          className="ml-1 rounded-full bg-black/30 px-1 text-[10px] leading-none text-white/80 hover:bg-black/50 hover:text-white"
          aria-label={`${label}を外す`}
        >
          ×
        </button>
      )}
    </span>
  );
}
