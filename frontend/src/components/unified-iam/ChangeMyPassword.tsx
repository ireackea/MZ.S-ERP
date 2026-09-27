import React, { useState } from 'react';
import { KeyRound, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { changeMyPassword } from '@services/passwordService';
import { passwordRuleResults, isPasswordPolicyCompliant, PASSWORD_MIN_LENGTH } from '@services/passwordPolicy';
import { getErrorMessage } from './shared';

/**
 * FC-SEC-010 — self-service password change.
 *
 * Before this the system offered no way to change a password at all: not for
 * the owner, not by an administrator, and no recovery path. On a shared
 * warehouse terminal that is an operational dead end, and it is why the
 * superadmin password stayed pinned to the value in .env.
 *
 * The rules are shown live rather than reported as a rejection, because the
 * policy is enforced server-side in `common/password-policy.ts` and this file
 * mirrors it for immediate feedback — it is not the enforcement point.
 */
const ChangeMyPassword: React.FC = () => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const rules = passwordRuleResults(newPassword);
  const compliant = isPasswordPolicyCompliant(newPassword);
  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;
  const canSubmit = currentPassword.length > 0 && compliant && !mismatch
    && confirmPassword.length > 0 && !busy;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      await changeMyPassword({ currentPassword, newPassword });
      setDone(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('تم تغيير كلمة المرور — سُجّل خروجك من كل الأجهزة، سجّل الدخول من جديد');
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'فشل تغيير كلمة المرور'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white/95 p-5">
      <h4 className="flex items-center gap-2 text-base font-bold text-slate-800 mb-1">
        <KeyRound className="w-5 h-5 text-emerald-600" />
        كلمة المرور الخاصة بي
      </h4>
      <p className="text-xs text-slate-500 mb-4">
        عند التغيير تُنهى كل جلساتك على كل الأجهزة، ولن تتمكن من المتابعة إلا بعد الدخول بالكلمة الجديدة.
      </p>

      {done ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          تم تغيير كلمة المرور. سجّل خروجك الآن ثم ادخل بالكلمة الجديدة.
        </div>
      ) : (
        <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="كلمة المرور الحالية *"
            autoComplete="current-password"
            required
            className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder={`كلمة المرور الجديدة (${PASSWORD_MIN_LENGTH}+ أحرف) *`}
            autoComplete="new-password"
            required
            className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="تأكيد كلمة المرور *"
            autoComplete="new-password"
            required
            className={`rounded-xl border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
              mismatch ? 'border-red-400 bg-red-50' : 'border-slate-200'
            }`}
          />

          <div className="md:col-span-3 flex flex-wrap items-center gap-3">
            <ul className="flex flex-wrap gap-2 text-[11px]">
              {rules.map((rule) => (
                <li
                  key={rule.key}
                  className={`flex items-center gap-1 rounded-full px-2 py-1 ${
                    rule.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {rule.ok ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                  {rule.label}
                </li>
              ))}
              {mismatch && (
                <li className="flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 text-red-700">
                  <X className="w-3 h-3" />
                  التأكيد لا يطابق
                </li>
              )}
            </ul>
            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 transition disabled:opacity-40"
            >
              {busy ? 'جاري التغيير...' : 'تغيير كلمة المرور'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export default ChangeMyPassword;
