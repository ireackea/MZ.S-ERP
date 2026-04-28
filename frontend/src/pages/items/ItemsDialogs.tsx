import React, { type FormEvent } from 'react';
import { FileSpreadsheet, Upload, X } from 'lucide-react';
import {
  type BulkEditorForm,
  type ImportPreviewRow,
  type ItemEditorForm,
  type PendingActionState,
} from './shared';

type ItemsDialogsProps = {
  formOpen: boolean;
  form: ItemEditorForm;
  setForm: React.Dispatch<React.SetStateAction<ItemEditorForm>>;
  onSubmit: (event: FormEvent) => void;
  onCloseForm: () => void;
  availableCategories: string[];
  availableUnits: string[];
  bulkOpen: boolean;
  bulk: BulkEditorForm;
  setBulk: React.Dispatch<React.SetStateAction<BulkEditorForm>>;
  onApplyBulk: () => void;
  onCloseBulk: () => void;
  selectedCount: number;
  importOpen: boolean;
  importPreview: ImportPreviewRow[];
  isImporting: boolean;
  onCloseImport: () => void;
  onConfirmImport: () => void;
  uploadOpen: boolean;
  uploadItemName: string;
  uploadType: 'image' | 'file';
  setUploadType: React.Dispatch<React.SetStateAction<'image' | 'file'>>;
  isUploading: boolean;
  onCloseUpload: () => void;
  onFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  pendingAction: PendingActionState | null;
  onCancelPendingAction: () => void;
  onConfirmPendingAction: () => void;
};

const ItemsDialogs: React.FC<ItemsDialogsProps> = ({
  formOpen,
  form,
  setForm,
  onSubmit,
  onCloseForm,
  availableCategories,
  availableUnits,
  bulkOpen,
  bulk,
  setBulk,
  onApplyBulk,
  onCloseBulk,
  selectedCount,
  importOpen,
  importPreview,
  isImporting,
  onCloseImport,
  onConfirmImport,
  uploadOpen,
  uploadItemName,
  uploadType,
  setUploadType,
  isUploading,
  onCloseUpload,
  onFileUpload,
  pendingAction,
  onCancelPendingAction,
  onConfirmPendingAction,
}) => {
  return (
    <>
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={onSubmit} className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
            <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-6 py-5">
              <div>
                <h2 className="text-xl font-bold text-slate-900">{form.id ? 'تعديل بيانات الصنف' : 'إضافة صنف جديد'}</h2>
                <p className="text-sm text-slate-500">حافظ على توافق الحقول مع العقد الحية للنظام: الكود، الباركود، الوصف، الحدود، والأرصدة.</p>
              </div>
              <button type="button" onClick={onCloseForm} className="rounded-full border border-slate-300 p-2 text-slate-500"><X size={18} /></button>
            </div>
            <div className="space-y-6 p-6">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <h3 className="mb-4 text-lg font-semibold text-slate-900">البيانات الأساسية</h3>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <input placeholder="اسم الصنف" required value={form.name} onChange={(event) => setForm((state) => ({ ...state, name: event.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                  <input placeholder="الكود" value={form.code} onChange={(event) => setForm((state) => ({ ...state, code: event.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                  <input placeholder="الباركود" value={form.barcode} onChange={(event) => setForm((state) => ({ ...state, barcode: event.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                  <input placeholder="الاسم الإنجليزي / الوصف" value={form.englishName} onChange={(event) => setForm((state) => ({ ...state, englishName: event.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                  <input required list="item-categories" placeholder="التصنيف" value={form.category} onChange={(event) => setForm((state) => ({ ...state, category: event.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                  <input required list="item-units" placeholder="الوحدة" value={form.unit} onChange={(event) => setForm((state) => ({ ...state, unit: event.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <h3 className="mb-4 text-lg font-semibold text-slate-900">ضبط المخزون والحدود</h3>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <input type="number" placeholder="الحد الأدنى" value={form.minLimit} onChange={(event) => setForm((state) => ({ ...state, minLimit: event.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                  <input type="number" placeholder="الحد الأعلى" value={form.maxLimit} onChange={(event) => setForm((state) => ({ ...state, maxLimit: event.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                  <input type="number" placeholder="حد إعادة الطلب" value={form.orderLimit} onChange={(event) => setForm((state) => ({ ...state, orderLimit: event.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                  <input type="number" placeholder="الكمية الحالية" value={form.currentStock} onChange={(event) => setForm((state) => ({ ...state, currentStock: event.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                </div>
              </div>
              <datalist id="item-categories">{availableCategories.map((entry) => <option key={entry} value={entry} />)}</datalist>
              <datalist id="item-units">{availableUnits.map((entry) => <option key={entry} value={entry} />)}</datalist>
            </div>
            <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-200 bg-white px-6 py-4">
              <button type="button" onClick={onCloseForm} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">إلغاء</button>
              <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">حفظ</button>
            </div>
          </form>
        </div>
      )}

      {bulkOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5"><div><h3 className="text-xl font-bold text-slate-900">تعديل جماعي</h3><p className="text-sm text-slate-500">سيتم تطبيق القيم التالية على {selectedCount} صنف محدد.</p></div><button type="button" onClick={onCloseBulk} className="rounded-full border border-slate-300 p-2 text-slate-500"><X size={18} /></button></div>
            <div className="grid grid-cols-1 gap-4 p-6 md:grid-cols-2">
              <input list="bulk-categories" placeholder="تصنيف جديد (اختياري)" value={bulk.category} onChange={(event) => setBulk((state) => ({ ...state, category: event.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
              <input list="bulk-units" placeholder="وحدة جديدة (اختياري)" value={bulk.unit} onChange={(event) => setBulk((state) => ({ ...state, unit: event.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
              <input type="number" placeholder="حد أدنى جديد" value={bulk.minLimit} onChange={(event) => setBulk((state) => ({ ...state, minLimit: event.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
              <input type="number" placeholder="حد أعلى جديد" value={bulk.maxLimit} onChange={(event) => setBulk((state) => ({ ...state, maxLimit: event.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
              <input type="number" placeholder="حد إعادة طلب جديد" value={bulk.orderLimit} onChange={(event) => setBulk((state) => ({ ...state, orderLimit: event.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2" />
            </div>
            <datalist id="bulk-categories">{availableCategories.map((entry) => <option key={entry} value={entry} />)}</datalist>
            <datalist id="bulk-units">{availableUnits.map((entry) => <option key={entry} value={entry} />)}</datalist>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4"><button type="button" onClick={onCloseBulk} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">إلغاء</button><button type="button" onClick={onApplyBulk} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">تطبيق</button></div>
          </div>
        </div>
      )}

      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[85vh] w-full max-w-5xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5"><div><h3 className="text-xl font-bold text-slate-900">معاينة الاستيراد</h3><p className="text-sm text-slate-500">عدد الأصناف في الملف: {importPreview.length}</p></div><button type="button" onClick={onCloseImport} className="rounded-full border border-slate-300 p-2 text-slate-500"><X size={18} /></button></div>
            <div className="overflow-x-auto p-6">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100 text-slate-700"><tr><th className="px-3 py-2 text-right">الاسم</th><th className="px-3 py-2 text-right">الكود</th><th className="px-3 py-2 text-right">الباركود</th><th className="px-3 py-2 text-right">الوصف</th><th className="px-3 py-2 text-right">التصنيف</th><th className="px-3 py-2 text-right">الوحدة</th><th className="px-3 py-2 text-right">الكمية</th></tr></thead>
                <tbody>{importPreview.slice(0, 25).map((item, index) => <tr key={`${item.name}-${index}`} className="border-t border-slate-200"><td className="px-3 py-2">{item.name}</td><td className="px-3 py-2">{item.code || '-'}</td><td className="px-3 py-2">{item.barcode || '-'}</td><td className="px-3 py-2">{item.description || '-'}</td><td className="px-3 py-2">{item.category || '-'}</td><td className="px-3 py-2">{item.unit || '-'}</td><td className="px-3 py-2">{item.currentStock || 0}</td></tr>)}</tbody>
              </table>
              {importPreview.length > 25 && <p className="mt-3 text-sm text-slate-500">... و {importPreview.length - 25} صنف إضافي.</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4"><button type="button" onClick={onCloseImport} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">إلغاء</button><button type="button" onClick={onConfirmImport} disabled={isImporting} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{isImporting ? 'جاري الاستيراد...' : 'تأكيد الاستيراد'}</button></div>
          </div>
        </div>
      )}

      {uploadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5"><div><h3 className="text-xl font-bold text-slate-900">رفع مرفق</h3><p className="text-sm text-slate-500">{uploadItemName}</p></div><button type="button" onClick={onCloseUpload} className="rounded-full border border-slate-300 p-2 text-slate-500"><X size={18} /></button></div>
            <div className="space-y-4 p-6">
              <div className="flex gap-2"><button type="button" onClick={() => setUploadType('image')} className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium ${uploadType === 'image' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-300 text-slate-700'}`}>صورة</button><button type="button" onClick={() => setUploadType('file')} className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium ${uploadType === 'file' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-300 text-slate-700'}`}>ملف</button></div>
              <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 p-8 text-center hover:bg-slate-50"><Upload className="mb-3 text-slate-400" size={28} /><span className="text-sm font-medium text-slate-700">اختر الملف المطلوب رفعه</span><span className="mt-1 text-xs text-slate-500">{uploadType === 'image' ? 'PNG / JPG / GIF حتى 5MB' : 'أي ملف حتى 10MB'}</span><input type="file" accept={uploadType === 'image' ? 'image/*' : '*/*'} onChange={onFileUpload} disabled={isUploading} className="hidden" /></label>
              {isUploading && <div className="text-center text-sm text-slate-500">جاري الرفع...</div>}
            </div>
          </div>
        </div>
      )}

      {pendingAction && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-6 py-5"><h3 className="text-xl font-bold text-slate-900">{pendingAction.title}</h3><p className="mt-2 text-sm text-slate-500">{pendingAction.description}</p></div>
            <div className="flex justify-end gap-2 px-6 py-4"><button type="button" onClick={onCancelPendingAction} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">إلغاء</button><button type="button" onClick={onConfirmPendingAction} className={`rounded-xl px-4 py-2 text-sm font-semibold text-white ${pendingAction.confirmClassName}`}>{pendingAction.confirmLabel}</button></div>
          </div>
        </div>
      )}
    </>
  );
};

export default ItemsDialogs;