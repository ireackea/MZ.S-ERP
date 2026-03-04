import { useCallback, useState } from 'react';
import { AlertCircle, CheckCircle2, Copy, Check } from 'lucide-react';

type ToastType = 'success' | 'error';

export const useToast = () => {
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [copied, setCopied] = useState(false);

  const showToast = useCallback((message: string, type: ToastType) => {
    setCopied(false);
    setToast({ message, type });
    setTimeout(() => setToast(null), 2500);
  }, []);

  const handleCopy = useCallback(async () => {
    if (!toast?.message) return;
    try {
      await navigator.clipboard.writeText(toast.message);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }, [toast?.message]);

  const ToastComponent = () => {
    if (!toast) return null;
    const bg = toast.type === 'success' ? 'bg-emerald-600' : 'bg-red-600';
    const Icon = toast.type === 'success' ? CheckCircle2 : AlertCircle;
    return (
      <div className={`fixed bottom-4 right-4 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 ${bg} z-50`}>
        <Icon size={18} />
        <span className="text-sm max-w-[280px] break-words">{toast.message}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="mr-1 rounded-md bg-white/20 hover:bg-white/30 p-1.5 transition"
          title={copied ? 'تم النسخ' : 'نسخ المحتوى'}
          aria-label={copied ? 'تم النسخ' : 'نسخ المحتوى'}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
    );
  };

  return { showToast, ToastComponent };
};
