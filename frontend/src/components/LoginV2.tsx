// ENTERPRISE FIX: Phase 0 - Stabilization & UTF-8 Lockdown - 2026-03-05
import React, { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, Loader2, Lock, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { login, resetLoginAttempts, type AuthLoginResponse } from '@services/authService';

type LoginUser = {
  id?: string;
  username?: string;
  name?: string;
  role?: string;
};

interface LoginV2Props {
  users?: LoginUser[];
  onAuthenticated?: (user: AuthLoginResponse['user'], redirectTo: string) => void;
}

const ROLE_REDIRECT_MAP: Record<string, string> = {
  admin: '/',
  SuperAdmin: '/',
  general_supervisor: '/users',
  special_supervisor: '/users',
  manager: '/operations',
  operator: '/operations',
  storekeeper: '/items',
  production_manager: '/items',
  dispatch_officer: '/orders',
  dispatch_manager: '/orders',
  customer: '/orders',
  default: '/dashboard',
};

const ERROR_MESSAGES: Record<number, string> = {
  400: 'اسم المستخدم أو كلمة المرور غير صحيحة. يرجى التحقق من البيانات.',
  401: 'اسم المستخدم أو كلمة المرور غير صحيحة.',
  403: 'ليس لديك صلاحية للوصول إلى هذا النظام.',
  429: 'Too many requests. يرجى الانتظار قليلًا ثم إعادة المحاولة.',
  422: 'تعذر التحقق من بيانات تسجيل الدخول. يرجى المحاولة مرة أخرى.',
  500: 'حدث خطأ غير متوقع في الخادم. يرجى المحاولة لاحقًا.',
};

const resolveRedirectPath = (role?: string) => {
  if (!role) return ROLE_REDIRECT_MAP.default;
  return ROLE_REDIRECT_MAP[role] || ROLE_REDIRECT_MAP[role.toLowerCase()] || ROLE_REDIRECT_MAP.default;
};

const resolveErrorMessage = (error: unknown) => {
  const status = (error as any)?.response?.status as number | undefined;
  const serverMessage = (error as any)?.response?.data?.message as string | undefined;
  return ERROR_MESSAGES[status || 0] || serverMessage || 'تعذر تسجيل الدخول. يرجى المحاولة مرة أخرى.';
};

const resolveErrorStatus = (error: unknown) => {
  const status = (error as any)?.response?.status as number | undefined;
  return typeof status === 'number' ? status : null;
};

const LoginV2: React.FC<LoginV2Props> = ({ users = [], onAuthenticated }) => {
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isResettingAttempts, setIsResettingAttempts] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<{ username?: string; password?: string }>({});

  useEffect(() => {
    if (!error && !validationErrors.username && !validationErrors.password) return;
    if (!username.trim() && !password) return;
    setError(null);
    setErrorStatus(null);
    setNotice(null);
    setValidationErrors({});
  }, [username, password]);

  const demoUsers = useMemo(() => {
    const seen = new Set<string>();
    return users
      .filter((user) => user.username)
      .filter((user) => {
        const key = String(user.role || user.username);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 4);
  }, [users]);

  const validateForm = () => {
    const nextErrors: { username?: string; password?: string } = {};

    if (!username.trim()) {
      nextErrors.username = 'اسم المستخدم أو البريد الإلكتروني مطلوب.';
    }

    if (!password) {
      nextErrors.password = 'كلمة المرور مطلوبة.';
    }

    setValidationErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const submitLogin = async () => {
    setError(null);
    setErrorStatus(null);
    setNotice(null);

    if (!validateForm()) {
      return;
    }

    setIsLoading(true);

    try {
      const result = await login(username.trim(), password);
      const redirectPath = resolveRedirectPath(result.user?.role);

      if (rememberMe) {
        localStorage.setItem('feed_factory_last_login_username', username.trim());
      } else {
        localStorage.removeItem('feed_factory_last_login_username');
      }

      onAuthenticated?.(result.user, redirectPath);
      navigate(redirectPath, { replace: true });
    } catch (loginError) {
      setErrorStatus(resolveErrorStatus(loginError));
      setError(resolveErrorMessage(loginError));
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    await submitLogin();
  };

  const handleRetryLogin = async () => {
    await submitLogin();
  };

  const handleResetAttempts = async () => {
    const normalizedUsername = username.trim();
    if (!normalizedUsername) {
      setValidationErrors((prev) => ({ ...prev, username: 'اسم المستخدم أو البريد الإلكتروني مطلوب.' }));
      return;
    }

    setIsResettingAttempts(true);
    try {
      const result = await resetLoginAttempts(normalizedUsername);
      setError(null);
      setErrorStatus(null);
      setNotice(result.message || 'تمت إعادة ضبط المحاولات. يمكنك تسجيل الدخول من جديد.');
    } catch (resetError) {
      setErrorStatus(resolveErrorStatus(resetError));
      setError(resolveErrorMessage(resetError));
    } finally {
      setIsResettingAttempts(false);
    }
  };

  const handleDemoLogin = (user: LoginUser) => {
    setUsername(String(user.username || ''));
    setPassword('password123');
    setError(null);
    setValidationErrors({});
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 px-4 py-10" dir="rtl">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-[32px] border border-white/10 bg-slate-950/75 shadow-2xl backdrop-blur md:grid-cols-[1.1fr_0.9fr]">
          <div className="relative hidden overflow-hidden border-l border-white/10 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.35),_transparent_45%),radial-gradient(circle_at_bottom_right,_rgba(14,165,233,0.25),_transparent_40%),linear-gradient(180deg,_rgba(15,23,42,0.94),_rgba(2,6,23,0.96))] p-10 md:block">
            <div className="relative z-10 space-y-6">
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30">
                <Lock className="h-8 w-8" />
              </div>
              <div className="space-y-3">
                <p className="text-sm font-semibold tracking-[0.3em] text-emerald-300/70">MZ.S-ERP</p>
                <h1 className="text-4xl font-black leading-tight text-white">نظام إدارة المخازن Enterprise</h1>
                <p className="max-w-md text-base leading-8 text-slate-300">
                  بوابة تشغيل موحدة لإدارة الأصناف والحركات والجرد والتركيبات مع صلاحيات دقيقة وسجل تشغيل واضح.
                </p>
              </div>
              <div className="grid gap-3 text-sm text-slate-200">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  متابعة المخزون والحركات اليومية من واجهة واحدة.
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  تسجيل الدخول يحدد التوجيه حسب الدور والصلاحيات تلقائيًا.
                </div>
              </div>
            </div>
          </div>

          <div className="p-6 sm:p-8 md:p-10">
            <div className="mx-auto max-w-md">
              <div className="mb-8 space-y-2">
                <p className="text-sm font-semibold text-emerald-300">تسجيل الدخول</p>
                <h2 className="text-3xl font-black text-white">مرحبًا بعودتك</h2>
                <p className="text-sm leading-7 text-slate-400">
                  استخدم بيانات حسابك للوصول إلى النظام والمتابعة من آخر نقطة عمل.
                </p>
              </div>

              <form className="space-y-5" onSubmit={handleLogin}>
                {notice && (
                  <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm leading-7 text-emerald-100">
                    {notice}
                  </div>
                )}

                {error && (
                  <div className="space-y-3 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm leading-7 text-red-100">
                    <div>{error}</div>
                    {errorStatus === 429 && (
                      <div className="flex flex-wrap gap-2">
                        {username.trim() && password && (
                          <button
                            type="button"
                            onClick={handleRetryLogin}
                            disabled={isLoading || isResettingAttempts}
                            className="inline-flex items-center justify-center rounded-xl border border-red-300/40 bg-white/10 px-4 py-2 text-sm font-bold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            إعادة المحاولة
                          </button>
                        )}
                        {username.trim() && (
                          <button
                            type="button"
                            onClick={handleResetAttempts}
                            disabled={isLoading || isResettingAttempts}
                            className="inline-flex items-center justify-center rounded-xl border border-amber-300/40 bg-amber-500/10 px-4 py-2 text-sm font-bold text-amber-50 transition hover:bg-amber-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isResettingAttempts ? 'جارٍ إعادة الضبط...' : 'إعادة ضبط المحاولات'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-slate-200" htmlFor="login-username">
                    اسم المستخدم أو البريد الإلكتروني
                  </label>
                  <div className="relative">
                    <User className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
                    <input
                      id="login-username"
                      type="text"
                      autoComplete="username"
                      dir="ltr"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      placeholder="example@company.com"
                      disabled={isLoading}
                      className="w-full rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 pr-12 text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                    />
                  </div>
                  {validationErrors.username && (
                    <p className="text-xs font-medium text-red-300">{validationErrors.username}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-slate-200" htmlFor="login-password">
                    كلمة المرور
                  </label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      dir="ltr"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="********"
                      disabled={isLoading}
                      className="w-full rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 pr-12 pl-14 text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                    />
                    <button
                      type="button"
                      aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                      className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-white"
                      onClick={() => setShowPassword((value) => !value)}
                    >
                      {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                  {validationErrors.password && (
                    <p className="text-xs font-medium text-red-300">{validationErrors.password}</p>
                  )}
                </div>

                <label className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-sm text-slate-300">
                  <span>تذكرني</span>
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(event) => setRememberMe(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-emerald-500 focus:ring-emerald-500"
                  />
                </label>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="flex w-full items-center justify-center gap-3 rounded-2xl bg-emerald-600 px-4 py-3.5 text-base font-bold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-700"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      جارٍ تسجيل الدخول...
                    </>
                  ) : (
                    'تسجيل الدخول'
                  )}
                </button>
              </form>

              {demoUsers.length > 0 && (
                <div className="mt-8 space-y-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                  <p className="text-sm font-semibold text-slate-200">تعبئة سريعة للحسابات التجريبية</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {demoUsers.map((user) => (
                      <button
                        key={`${user.username}-${user.role}`}
                        type="button"
                        onClick={() => handleDemoLogin(user)}
                        className="rounded-xl border border-slate-700 px-3 py-2 text-right text-sm text-slate-200 transition hover:border-emerald-500 hover:bg-emerald-500/10"
                      >
                        <span className="block font-semibold">{user.name || user.username}</span>
                        <span className="block text-xs text-slate-400">{user.role || 'user'}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginV2;
