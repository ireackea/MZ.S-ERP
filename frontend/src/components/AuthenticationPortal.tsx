// ENTERPRISE FIX: Arabic Encoding Restoration - Full Components Folder - 2026-03-04
// Arabic text encoding verified and corrected

import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Eye,
  EyeOff,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  User,
} from 'lucide-react';
import {
  authenticate,
  calculatePasswordStrength,
  clearCurrentDeviceAuthLockout,
  changePasswordAfterForcedLogin,
  requestPasswordReset,
  verifyTwoFactor,
} from '../services/authController';
import { login as loginToApi } from '@services/authService';
import { User as AppUser } from '../types';

interface AuthenticationPortalProps {
  users: AppUser[];
  onAuthenticated: (userId: string, redirectTo: string) => void;
}

const AuthenticationPortal: React.FC<AuthenticationPortalProps> = ({ users, onAuthenticated }) => {
  const [locale, setLocale] = useState<'ar' | 'en'>('ar');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [website, setWebsite] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [twoFactorChallengeId, setTwoFactorChallengeId] = useState<string | null>(null);
  const [forcedPasswordUserId, setForcedPasswordUserId] = useState<string | null>(null);
  const [forcedPassword, setForcedPassword] = useState('');
  const [forcedPasswordConfirm, setForcedPasswordConfirm] = useState('');

  const [forgotOpen, setForgotOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetWebsite, setResetWebsite] = useState('');
  const [resetMessage, setResetMessage] = useState('');

  const strength = useMemo(() => calculatePasswordStrength(password), [password]);
  const resetStrength = useMemo(() => calculatePasswordStrength(resetPassword), [resetPassword]);
  const forcedPasswordStrength = useMemo(() => calculatePasswordStrength(forcedPassword), [forcedPassword]);

  const labels = locale === 'ar'
    ? {
        title: 'بوابة الدخول الموحدة',
        subtitle: 'نظام المخازن 4.0 - Enterprise Authentication',
        slogan: 'تحكم آمن. وصول موحد. إدارة ذكية.',
        idLabel: 'البريد الإلكتروني / اسم المستخدم',
        passwordLabel: 'كلمة المرور',
        remember: 'تذكرني',
        login: 'تسجيل الدخول',
        forgot: 'نسيت كلمة المرور؟',
        ssoTitle: 'الدخول الموحد (SSO)',
        secured: 'Secured by FeedFactory IAM',
        resetTitle: 'إعادة تعيين كلمة المرور',
        resetDesc: 'أدخل البريد وكلمة المرور الجديدة',
        close: 'إغلاق',
        resetBtn: 'إعادة التعيين',
      }
    : {
        title: 'Enterprise Sign-In Portal',
        subtitle: 'Warehouse System 4.0 - Enterprise Authentication',
        slogan: 'Secure Control. Unified Access. Smart Operations.',
        idLabel: 'Email / Username',
        passwordLabel: 'Password',
        remember: 'Remember me',
        login: 'Sign In',
        forgot: 'Forgot password?',
        ssoTitle: 'Single Sign-On (SSO)',
        secured: 'Secured by FeedFactory IAM',
        resetTitle: 'Reset Password',
        resetDesc: 'Enter your email and new password',
        close: 'Close',
        resetBtn: 'Reset Password',
      };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMessage('');
    setInfoMessage('');

    try {
      setIsLoading(true);
      // تحقق فقط من السيرفر (backend) عبر loginToApi
      try {
        const payload = await loginToApi(identifier, password);
        // نجاح: استدعِ onAuthenticated مع userId و redirectTo (أو '/').
        onAuthenticated(payload.user.id, '/');
      } catch (error: any) {
        setErrorMessage(error?.response?.data?.message || error?.message || 'Login failed');
        return;
      }
    } catch (error: any) {
      setErrorMessage(error?.response?.data?.message || error?.message || 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyTwoFactor = async () => {
    if (!twoFactorChallengeId) return;

    setErrorMessage('');
    setInfoMessage('');
    setIsLoading(true);

    try {
      const result = await verifyTwoFactor({
        challengeId: twoFactorChallengeId,
        otpCode: twoFactorCode,
        users,
      });

      if (!result.success || !result.userId || !result.redirectTo) {
        setErrorMessage(result.message || 'Verification failed');
        return;
      }

      await loginToApi(identifier, password);
      onAuthenticated(result.userId, result.redirectTo);
    } catch (error: any) {
      setErrorMessage(error?.response?.data?.message || error?.message || 'Verification failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleForcedPasswordChange = async () => {
    if (!forcedPasswordUserId) return;

    setErrorMessage('');
    setInfoMessage('');

    if (forcedPassword !== forcedPasswordConfirm) {
      setErrorMessage(locale === 'ar' ? 'تأكيد كلمة المرور غير مطابق.' : 'Password confirmation does not match.');
      return;
    }

    setIsLoading(true);
    try {
      const result = await changePasswordAfterForcedLogin({
        userId: forcedPasswordUserId,
        newPassword: forcedPassword,
      });

      if (!result.success) {
        setErrorMessage(result.message);
        return;
      }

      setForcedPassword('');
      setForcedPasswordConfirm('');
      setForcedPasswordUserId(null);
      setPassword('');
      setInfoMessage(result.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await requestPasswordReset({
      email: resetEmail,
      newPassword: resetPassword,
      honeypot: resetWebsite,
    });
    setResetMessage(result.message);
    if (result.success) {
      setResetPassword('');
    }
  };

  return (
    <div className="min-h-screen bg-slate-100" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <div className="absolute top-4 left-4 z-20">
        <button
          onClick={() => setLocale((prev) => (prev === 'ar' ? 'en' : 'ar'))}
          className="px-3 py-1.5 rounded-full bg-white/90 shadow-sm border text-xs font-bold text-slate-700 hover:bg-white"
        >
          {locale === 'ar' ? 'EN' : 'AR'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 min-h-screen">
        <div className="relative hidden lg:flex items-center justify-center overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-900" />
          <div
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage:
                "radial-gradient(circle at 20% 20%, #34d399 0, transparent 35%), radial-gradient(circle at 80% 30%, #60a5fa 0, transparent 32%), radial-gradient(circle at 40% 70%, #f59e0b 0, transparent 24%)",
            }}
          />
          <div className="absolute inset-0 bg-black/25" />

          <div className="relative z-10 text-white px-12 max-w-xl">
            <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur px-4 py-2 rounded-full border border-white/20 mb-6">
              <Sparkles size={16} className="text-emerald-300" />
              <span className="text-sm">FeedFactory Pro</span>
            </div>
            <h1 className="text-4xl font-black leading-tight mb-4">{labels.title}</h1>
            <p className="text-lg text-slate-200 mb-3">{labels.subtitle}</p>
            <p className="text-emerald-200 font-medium">{labels.slogan}</p>
          </div>
        </div>

        <div className="flex items-center justify-center p-6 lg:p-12">
          <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl shadow-slate-900/10 border border-slate-100 p-8">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-slate-800">{labels.title}</h2>
              <p className="text-sm text-slate-500 mt-1">{labels.subtitle}</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {!twoFactorChallengeId && !forcedPasswordUserId && (
                <>
              <input
                type="text"
                autoComplete="off"
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
                tabIndex={-1}
                aria-hidden="true"
                className="absolute -left-[9999px] opacity-0 pointer-events-none"
              />

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{labels.idLabel}</label>
                <div className="relative">
                  <Mail size={16} className="absolute top-3.5 text-slate-400" style={{ [locale === 'ar' ? 'right' : 'left']: '12px' } as React.CSSProperties} />
                  <input
                    required
                    type="text"
                    value={identifier}
                    onChange={(event) => setIdentifier(event.target.value)}
                    placeholder={locale === 'ar' ? 'example@company.com' : 'example@company.com'}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-10 py-3 outline-none focus:bg-white focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{labels.passwordLabel}</label>
                <div className="relative">
                  <Lock size={16} className="absolute top-3.5 text-slate-400" style={{ [locale === 'ar' ? 'right' : 'left']: '12px' } as React.CSSProperties} />
                  <input
                    required
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-10 py-3 outline-none focus:bg-white focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute top-2.5 p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
                    style={{ [locale === 'ar' ? 'left' : 'right']: '8px' } as React.CSSProperties}
                    title={showPassword ? 'Hide' : 'Show'}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>

                <div className="mt-2">
                  <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full ${strength.colorClass} transition-all`} style={{ width: `${Math.min(100, strength.score * 20)}%` }} />
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{locale === 'ar' ? `قوة كلمة المرور: ${strength.label}` : `Password strength: ${strength.label}`}</p>
                </div>
              </div>

              <div className="flex items-center justify-between text-sm">
                <label className="inline-flex items-center gap-2 text-slate-600">
                  <input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} className="accent-emerald-600" />
                  {labels.remember}
                </label>
                <button type="button" onClick={() => setForgotOpen(true)} className="text-emerald-700 hover:text-emerald-800 font-semibold">
                  {labels.forgot}
                </button>
              </div>
                </>
              )}

              {twoFactorChallengeId && (
                <div className="space-y-3">
                  <label className="block text-sm font-medium text-slate-700">
                    {locale === 'ar' ? 'رمز التحقق الثنائي (OTP)' : 'Two-Factor OTP Code'}
                  </label>
                  <input
                    required
                    value={twoFactorCode}
                    onChange={(event) => setTwoFactorCode(event.target.value)}
                    placeholder={locale === 'ar' ? 'أدخل الرمز المكون من 6 أرقام' : 'Enter 6-digit code'}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 outline-none focus:bg-white focus:border-emerald-500"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setTwoFactorChallengeId(null);
                        setTwoFactorCode('');
                        setInfoMessage('');
                      }}
                      className="flex-1 rounded-xl border border-slate-200 py-3 text-slate-700 hover:bg-slate-50"
                    >
                      {locale === 'ar' ? 'رجوع' : 'Back'}
                    </button>
                    <button
                      type="button"
                      onClick={handleVerifyTwoFactor}
                      disabled={isLoading}
                      className="flex-1 rounded-xl bg-slate-900 text-white py-3 font-bold hover:bg-slate-800 disabled:opacity-60"
                    >
                      {isLoading ? (locale === 'ar' ? 'جارٍ التحقق...' : 'Verifying...') : (locale === 'ar' ? 'تحقق' : 'Verify')}
                    </button>
                  </div>
                </div>
              )}

              {forcedPasswordUserId && (
                <div className="space-y-3">
                  <label className="block text-sm font-medium text-slate-700">
                    {locale === 'ar' ? 'كلمة المرور الجديدة (إلزامي)' : 'New Password (Required)'}
                  </label>
                  <input
                    required
                    type="password"
                    value={forcedPassword}
                    onChange={(event) => setForcedPassword(event.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 outline-none focus:bg-white focus:border-emerald-500"
                  />
                  <input
                    required
                    type="password"
                    value={forcedPasswordConfirm}
                    onChange={(event) => setForcedPasswordConfirm(event.target.value)}
                    placeholder={locale === 'ar' ? 'تأكيد كلمة المرور الجديدة' : 'Confirm new password'}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 outline-none focus:bg-white focus:border-emerald-500"
                  />
                  <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full ${forcedPasswordStrength.colorClass} transition-all`} style={{ width: `${Math.min(100, forcedPasswordStrength.score * 20)}%` }} />
                  </div>
                  <button
                    type="button"
                    onClick={handleForcedPasswordChange}
                    disabled={isLoading}
                    className="w-full rounded-xl bg-slate-900 text-white py-3 font-bold hover:bg-slate-800 disabled:opacity-60"
                  >
                    {isLoading ? (locale === 'ar' ? 'جارٍ التحديث...' : 'Updating...') : (locale === 'ar' ? 'تحديث كلمة المرور' : 'Update Password')}
                  </button>
                </div>
              )}

              {errorMessage && (
                <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3">
                  <AlertCircle size={16} className="mt-0.5" />
                  <div className="flex-1 space-y-2">
                    <span className="block">{errorMessage}</span>
                    {(errorMessage.includes('تم تعليق المحاولة مؤقتاً') || errorMessage.includes('مقفل مؤقتاً')) && (
                      <button
                        type="button"
                        onClick={() => {
                          clearCurrentDeviceAuthLockout();
                          setErrorMessage('');
                          setInfoMessage(locale === 'ar' ? 'تم فك التعليق لهذا الجهاز. يمكنك المحاولة الآن.' : 'Lockout cleared for this device. You can try again now.');
                        }}
                        className="text-xs font-bold underline decoration-dotted hover:text-red-800"
                      >
                        {locale === 'ar' ? 'فك التعليق الآن' : 'Clear lockout now'}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {infoMessage && !errorMessage && (
                <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                  {infoMessage}
                </div>
              )}

              {!twoFactorChallengeId && !forcedPasswordUserId && (
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full rounded-xl bg-slate-900 text-white py-3 font-bold hover:bg-slate-800 active:scale-[0.99] transition disabled:opacity-60"
                >
                  {isLoading ? (locale === 'ar' ? 'جارٍ التحقق...' : 'Authenticating...') : labels.login}
                </button>
              )}
            </form>

            <div className="mt-6">
              <p className="text-xs font-bold text-slate-500 mb-2">{labels.ssoTitle}</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <button type="button" className="rounded-lg border border-slate-200 bg-slate-50 text-slate-500 text-xs py-2 hover:bg-slate-100" title="Google Workspace (Soon)">Google</button>
                <button type="button" className="rounded-lg border border-slate-200 bg-slate-50 text-slate-500 text-xs py-2 hover:bg-slate-100" title="Azure AD (Soon)">Azure AD</button>
                <button type="button" className="rounded-lg border border-slate-200 bg-slate-50 text-slate-500 text-xs py-2 hover:bg-slate-100" title="Office 365 (Soon)">Office 365</button>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-100 text-xs text-slate-500 flex items-center justify-center gap-1.5">
              <ShieldCheck size={14} className="text-emerald-600" />
              <span>{labels.secured}</span>
            </div>
          </div>
        </div>
      </div>

      {forgotOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-100 p-6" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
            <h3 className="text-xl font-bold text-slate-800 mb-1">{labels.resetTitle}</h3>
            <p className="text-sm text-slate-500 mb-4">{labels.resetDesc}</p>

            <form onSubmit={handleReset} className="space-y-3">
              <input
                type="text"
                autoComplete="off"
                value={resetWebsite}
                onChange={(event) => setResetWebsite(event.target.value)}
                tabIndex={-1}
                aria-hidden="true"
                className="absolute -left-[9999px] opacity-0 pointer-events-none"
              />
              <input
                type="email"
                required
                value={resetEmail}
                onChange={(event) => setResetEmail(event.target.value)}
                placeholder={locale === 'ar' ? 'البريد الإلكتروني' : 'Email'}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 outline-none focus:bg-white focus:border-emerald-500"
              />
              <input
                type="password"
                required
                value={resetPassword}
                onChange={(event) => setResetPassword(event.target.value)}
                placeholder={locale === 'ar' ? 'كلمة المرور الجديدة' : 'New password'}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 outline-none focus:bg-white focus:border-emerald-500"
              />

              <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full ${resetStrength.colorClass} transition-all`} style={{ width: `${Math.min(100, resetStrength.score * 20)}%` }} />
              </div>

              {resetMessage && <p className="text-xs text-slate-600">{resetMessage}</p>}

              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setForgotOpen(false)} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-slate-700 hover:bg-slate-50">{labels.close}</button>
                <button type="submit" className="flex-1 rounded-xl bg-slate-900 text-white py-2.5 hover:bg-slate-800">{labels.resetBtn}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AuthenticationPortal;
