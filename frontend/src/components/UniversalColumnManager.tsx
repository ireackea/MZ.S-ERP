// ENTERPRISE FIX: Arabic Encoding Restoration - Full Components Folder - 2026-03-04
// Arabic text encoding verified and corrected

import React, { useMemo, useState } from 'react';
import { GripVertical, Pin, PinOff, RotateCcw } from 'lucide-react';
import { GridColumnPreference } from '../types';

interface UniversalColumnManagerProps {
  columns: GridColumnPreference[];
  onChange: (columns: GridColumnPreference[]) => void;
  onReset: () => void;
  mode?: 'user' | 'system';
  disabled?: boolean;
}

const UniversalColumnManager: React.FC<UniversalColumnManagerProps> = ({ columns, onChange, onReset, mode = 'user', disabled = false }) => {
  const [draggingKey, setDraggingKey] = useState<string | null>(null);

  const orderedColumns = useMemo(
    () => [...columns].sort((a, b) => a.order - b.order),
    [columns]
  );

  const persistOrder = (next: GridColumnPreference[]) => {
    onChange(next.map((col, index) => ({ ...col, order: index })));
  };

  const handleDragStart = (columnKey: string) => {
    if (disabled) return;
    const target = orderedColumns.find((col) => col.key === columnKey);
    if (!target) return;
    if (mode === 'user' && target.locked) return;
    setDraggingKey(columnKey);
  };

  const handleDrop = (targetKey: string) => {
    if (disabled || !draggingKey || draggingKey === targetKey) {
      setDraggingKey(null);
      return;
    }

    const current = [...orderedColumns];
    const fromIndex = current.findIndex(col => col.key === draggingKey);
    const toIndex = current.findIndex(col => col.key === targetKey);
    if (fromIndex < 0 || toIndex < 0) {
      setDraggingKey(null);
      return;
    }

    const sourceCol = current[fromIndex];
    const targetCol = current[toIndex];
    if ((mode === 'user' && (sourceCol?.locked || targetCol?.locked))) {
      setDraggingKey(null);
      return;
    }

    const [moved] = current.splice(fromIndex, 1);
    current.splice(toIndex, 0, moved);
    persistOrder(current);
    setDraggingKey(null);
  };

  const updateColumn = (columnKey: string, patch: Partial<GridColumnPreference>) => {
    if (disabled) return;
    const current = orderedColumns.find((col) => col.key === columnKey);
    if (!current) return;
    if (mode === 'user' && current.locked && (typeof patch.visible !== 'undefined' || typeof patch.order !== 'undefined')) {
      return;
    }

    onChange(
      orderedColumns.map(col => (col.key === columnKey ? { ...col, ...patch } : col))
        .map((col, index) => ({ ...col, order: index }))
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-slate-500">اسحب البطاقات لتغيير الترتيب، ويمكنك الإخفاء أو التثبيت وتعديل العرض.</p>
        <button
          onClick={onReset}
          disabled={disabled}
          className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-lg flex items-center gap-2"
        >
          <RotateCcw size={14} /> إعادة تعيين
        </button>
      </div>

      <div className="space-y-2">
        {orderedColumns.map((column) => (
          <div
            key={column.key}
            draggable={!disabled && !(mode === 'user' && !!column.locked)}
            onDragStart={() => handleDragStart(column.key)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => handleDrop(column.key)}
            className={`bg-white border rounded-xl p-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3 ${draggingKey === column.key ? 'border-emerald-400 shadow' : 'border-slate-200'}`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <button className={`text-slate-400 ${disabled || (mode === 'user' && column.locked) ? 'cursor-not-allowed opacity-40' : 'cursor-grab'}`} title="سحب لإعادة الترتيب" disabled={disabled || (mode === 'user' && !!column.locked)}>
                <GripVertical size={16} />
              </button>
              <div className="min-w-0">
                <div className="font-bold text-slate-800 truncate">{column.label}</div>
                <div className="text-xs text-slate-400">{column.key}</div>
              </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={column.visible}
                  onChange={(event) => updateColumn(column.key, { visible: event.target.checked })}
                  disabled={disabled || (mode === 'user' && !!column.locked)}
                  className="accent-emerald-600"
                />
                إظهار
              </label>

              {mode === 'system' && (
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={!!column.locked}
                    onChange={(event) => updateColumn(column.key, { locked: event.target.checked, visible: event.target.checked ? true : column.visible })}
                    disabled={disabled}
                    className="accent-emerald-600"
                  />
                  قفل
                </label>
              )}

              <button
                onClick={() => updateColumn(column.key, { frozen: !column.frozen })}
                disabled={disabled}
                className={`px-2 py-1 rounded-lg text-xs border ${column.frozen ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-700'}`}
                title="تثبيت على اليسار"
              >
                {column.frozen ? <Pin size={14} /> : <PinOff size={14} />}
              </button>

              <label className="text-xs text-slate-600 flex items-center gap-2">
                العرض (px)
                <input
                  type="number"
                  min={80}
                  step={10}
                  value={column.width}
                  onChange={(event) => updateColumn(column.key, { width: Math.max(80, Number(event.target.value) || 80) })}
                  disabled={disabled}
                  className="w-24 p-1.5 border border-slate-300 rounded-lg text-sm"
                />
              </label>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default UniversalColumnManager;
