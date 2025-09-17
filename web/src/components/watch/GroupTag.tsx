type Props = {
  label: string;
  color: string;
  onClick?: () => void;
  compact?: boolean;
};

export default function GroupTag({ label, color, onClick, compact }: Props) {
  const className = compact ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5';
  const interactive = Boolean(onClick);
  return (
    <span
      onClick={onClick}
      className={`inline-flex items-center rounded-full bg-opacity-20 border border-opacity-30 border-white/10 text-white mr-1 mb-1 ${className} ${interactive ? 'cursor-pointer hover:opacity-100' : 'cursor-default'}`}
      style={{ backgroundColor: color, opacity: 0.85 }}
    >
      {label}
    </span>
  );
}
