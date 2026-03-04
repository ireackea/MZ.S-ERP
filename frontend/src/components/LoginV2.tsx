// ENTERPRISE FIX: Arabic Encoding Restoration - Full Components Folder - 2026-03-04
// Arabic text encoding verified and corrected

// ENTERPRISE FIX: Phase 2 - Login Error Display Fixed + Device Fingerprint + UX Polish - 2026-03-03
import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { login } from '../services/authService';
import { getDeviceFingerprint } from '../services/deviceFingerprint';
import { Lock, User, AlertCircle, Loader2, Eye, EyeOff } from 'lucide-react';

interface LoginError {
  status: number;
  message: string;
}

const LoginV2: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<LoginError | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();
  const targetPath = (location.state as any)?.from?.pathname || '/';

  // ✅ الحل المثالي: يمسح الخطأ فقط عند بدء الكتابة بعد الخطأ
  useEffect(() => {
    if (error && (username.trim() || password.trim())) {
      setError(null);
    }
  }, [username, password]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;

    setIsLoading(true);
    setError(null);

    try {
      const fingerprint = await getDeviceFingerprint();
      const response = await login(username.trim(), password, fingerprint);

      if (response?.token) {
        navigate(targetPath, { replace: true });
      }
    } catch (err: any) {
      console.error('[Login Engine] failure:', err);

      const status = err.response?.status || 500;
      const message =
        err.response?.data?.message ||
        (status === 401 ? 'اسم المستخدم أو كلمة المرور غير صحيحة.' : 'حدث خطأ أثناء تسجيل الدخول.');

      setError({ status, message });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4" dir="rtl">
      <div className="max-w-md w-full bg-slate-900 p-10 rounded-3xl shadow-2xl border border-slate-800">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="mx-auto mb-6 h-16 w-16 bg-emerald-600/10 rounded-2xl flex items-center justify-center">
            <Lock className="h-9 w-9 text-emerald-500" />
          </div>
          <h1 className="text-3xl font-bold text-white">تسجيل الدخول</h1>
          <p className="mt-2 text-slate-400">FeedFactory Enterprise Pro</p>
        </div>

        {/* Error Display */}
        <div className="min-h-[52px] mb-4">
          {error && (
            <div className="flex items-start gap-3 bg-red-900/30 border border-red-500/50 rounded-2xl p-4 animate-in slide-in-from-top">
              <AlertCircle className="mt-0.5 h-5 w-5 text-red-400 flex-shrink-0" />
              <span className="text-red-200 text-[15px] leading-relaxed">{error.message}</span>
            </div>
          )}
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          <div className="space-y-5">
            <div className="relative">
              <User className="absolute right-4 top-4 h-5 w-5 text-slate-500" />
              <input
                type="text"
                required
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-2xl py-3.5 pr-11 pl-4 text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 outline-none transition"
                placeholder="اسم المستخدم أو البريد الإلكتروني"
                disabled={isLoading}
              />
            </div>

            <div className="relative">
              <Lock className="absolute right-4 top-4 h-5 w-5 text-slate-500" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-2xl py-3.5 pr-11 pl-4 text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 outline-none transition"
                placeholder="كلمة المرور"
                disabled={isLoading}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute left-4 top-4 text-slate-400 hover:text-slate-300"
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading || !username || !password}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-bold py-4 rounded-2xl transition flex items-center justify-center gap-3 text-lg"
          >
            {isLoading ? <Loader2 className="animate-spin h-6 w-6" /> : 'تسجيل الدخول'}
          </button>
        </form>

        <div className="mt-8 text-center text-xs text-slate-500">
          جميع محاولات الدخول تُسجل لأغراض الأمان والتدقيق
        </div>
      </div>
    </div>
  );
};

export default LoginV2;