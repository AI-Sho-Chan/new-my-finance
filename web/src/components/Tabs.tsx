type Tab = { key: string; label: string };

export default function Tabs({ tabs, active, onChange }: { tabs: Tab[]; active: string; onChange: (key: string) => void }) {
  return (
    <div className="flex gap-2 mb-4">
      {tabs.map((t) => (
        <button
          key={t.key}
          className={`px-4 py-2 rounded-md ${active === t.key ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700'}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

