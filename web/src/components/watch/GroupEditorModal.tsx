import { useEffect, useMemo, useState } from 'react';

type Props = {
  open: boolean;
  mode: 'create' | 'edit';
  initialName?: string;
  initialColor?: string;
  initialDescription?: string;
  onClose: () => void;
  onSubmit: (input: { name: string; color: string; description?: string }) => void;
};

const COLOR_PRESETS = ['#2563eb', '#16a34a', '#9333ea', '#f97316', '#facc15', '#0ea5e9', '#f43f5e', '#14b8a6', '#f472b6'];

export default function GroupEditorModal({ open, mode, initialName, initialColor, initialDescription, onClose, onSubmit }: Props) {
  const [name, setName] = useState(initialName || '');
  const [color, setColor] = useState(initialColor || COLOR_PRESETS[0]);
  const [description, setDescription] = useState(initialDescription || '');

  useEffect(() => {
    if (!open) return;
    setName(initialName || '');
    setColor(initialColor || COLOR_PRESETS[0]);
    setDescription(initialDescription || '');
  }, [open, initialName, initialColor, initialDescription]);

  const title = useMemo(() => (mode === 'create' ? '新しいグループを追加' : 'グループを編集'), [mode]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-gray-800 border border-gray-700 rounded-lg shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-gray-100 mb-4">{title}</h3>
        <div className="space-y-4">
          <label className="block text-sm text-gray-300">
            グループ名
            <input
              className="mt-1 w-full rounded-md bg-gray-900 border border-gray-700 px-3 py-2 text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: テック株"
            />
          </label>
          <div>
            <p className="text-sm text-gray-300 mb-2">カラー</p>
            <div className="flex flex-wrap gap-2">
              {COLOR_PRESETS.map((preset) => (
                <button
                  key={preset}
                  className={`w-8 h-8 rounded-full border-2 ${color === preset ? 'border-white' : 'border-transparent'}`}
                  style={{ backgroundColor: preset }}
                  onClick={() => setColor(preset)}
                />
              ))}
              <label className="flex items-center gap-2 text-xs text-gray-400">
                <span>カスタム</span>
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-10 h-8 border-0 bg-transparent" />
              </label>
            </div>
          </div>
          <label className="block text-sm text-gray-300">
            説明 (任意)
            <textarea
              className="mt-1 w-full rounded-md bg-gray-900 border border-gray-700 px-3 py-2 text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button className="px-4 py-2 rounded-md text-sm bg-gray-700 text-gray-200 hover:bg-gray-600" onClick={onClose}>キャンセル</button>
          <button
            className="px-4 py-2 rounded-md text-sm bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-gray-600 disabled:text-gray-400"
            onClick={() => {
              const cleanName = name.trim();
              if (!cleanName) return;
              onSubmit({ name: cleanName, color: color || COLOR_PRESETS[0], description: description.trim() || undefined });
            }}
            disabled={!name.trim()}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
