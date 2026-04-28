import React from 'react';
import { Save, Shield, Unlock } from 'lucide-react';

const ROLE_COLOR_OPTIONS = ['#64748b', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef'];

type UnifiedIamRoleModalProps = {
  open: boolean;
  roleName: string;
  roleColor: string;
  onRoleNameChange: (value: string) => void;
  onRoleColorChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
};

const UnifiedIamRoleModal: React.FC<UnifiedIamRoleModalProps> = ({
  open,
  roleName,
  roleColor,
  onRoleNameChange,
  onRoleColorChange,
  onClose,
  onSave,
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Shield className="w-5 h-5 text-emerald-600" />
            إنشاء دور صلاحيات جديد
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <Unlock className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">اسم الدور</label>
            <input
              value={roleName}
              onChange={(e) => onRoleNameChange(e.target.value)}
              placeholder="مثال: مشرف مبيعات"
              className="w-full rounded-xl border border-slate-200 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">لون الشارة</label>
            <div className="flex gap-2">
              {ROLE_COLOR_OPTIONS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => onRoleColorChange(color)}
                  className={`w-8 h-8 rounded-full border-2 ${roleColor === color ? 'border-slate-800 scale-110 shadow-md' : 'border-transparent'}`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2 rounded-xl text-slate-600 font-bold hover:bg-slate-200 transition"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={onSave}
            className="px-6 py-2 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 shadow-md flex items-center gap-2"
          >
            <Save className="w-4 h-4" /> حفظ الدور
          </button>
        </div>
      </div>
    </div>
  );
};

export default UnifiedIamRoleModal;