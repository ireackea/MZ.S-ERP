// ENTERPRISE FIX: Phase 7 - Advanced System Reset Module with Multi-Layer Security - 2026-04-29
// Multi-stage workflow: Warning → Scope → Reason → Challenge → Confirmation → Execute → Progress
// Two-factor verification: password re-authentication + one-time challenge code (5 min TTL)
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Database,
  FileWarning,
  KeyRound,
  Layers,
  Loader2,
  RefreshCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { usePermissions } from '@hooks/usePermissions';
import { useSession } from '@hooks/useSession';
import { hasGrantedPermission } from '@services/permissionAliases';
import { resolveRoleFallbackPermissions } from '@services/rolePermissionFallbacks';
import { toast } from '@services/toastService';
import {
  systemResetService,
  type SystemResetScope,
  type ResetChallengeResponse,
} from '@services/systemResetService';
import type { User } from '../../../types';

type StageKey = 'gate' | 'scope' | 'reason' | 'challenge' | 'confirm' | 'progress' | 'done';

type ScopeOption = {
  id: SystemResetScope;
  title: string;
  subtitle: string;
  bullets: string[];
  severity: 'extreme' | 'high' | 'medium' | 'low';
  Icon: React.ComponentType<{ size?: number; className?: string }>;
};

type SystemResetProps = {
  currentUser?: Pick<User, 'username' | 'role' | 'permissions'>;
};

const SCOPE_OPTIONS: ScopeOption[] = [
  {
    id: 'full',
    title: 'إعادة ضبط كاملة (Factory Reset)',
    subtitle: 'مسح كل شيء عدا أول حساب SuperAdmin',
    bullets: [
      'حذف جميع الأصناف والحركات والأرصدة والتركيبات',
      'حذف جميع المستخدمين الآخرين والصلاحيات والأدوار',
      'حذف جميع سجلات التدقيق والجلسات النشطة',
      'يُحتفظ فقط بحساب SuperAdmin الأول لمنع فقدان الوصول',
    ],
    severity: 'extreme',
    Icon: ShieldAlert,
  },
  {
    id: 'data',
    title: 'مسح البيانات مع الاحتفاظ بالإعدادات',
    subtitle: 'يحافظ على المستخدمين والأدوار والصلاحيات وإعدادات الشركة',
    bullets: [
      'حذف الأصناف والحركات والأرصدة والتركيبات',
      'حذف سجلات التدقيق والجلسات النشطة',
      'الاحتفاظ بكامل المستخدمين والأدوار والصلاحيات',
    ],
    severity: 'high',
    Icon: Database,
  },
  {
    id: 'inventory',
    title: 'مسح بيانات المخزون فقط',
    subtitle: 'الأصناف + الحركات + الأرصدة الافتتاحية',
    bullets: [
      'حذف الأصناف والحركات والأرصدة الافتتاحية',
      'حذف التركيبات وقواعد التفريغ المرتبطة',
      'الإبقاء على كل شيء آخر (مستخدمون، صلاحيات، سجلات تدقيق)',
    ],
    severity: 'medium',
    Icon: Layers,
  },
  {
    id: 'audit',
    title: 'مسح سجلات التدقيق فقط',
    subtitle: 'إجراء آمن نسبيًا — لا يمس البيانات التشغيلية',
    bullets: [
      'حذف جميع سجلات التدقيق (AuditLog)',
      'لا يؤثر على الأصناف أو الحركات أو المستخدمين',
      'يُستخدم عادة قبل عمليات التدقيق الدورية',
    ],
    severity: 'low',
    Icon: FileWarning,
  },
];

const SEVERITY_STYLES: Record<ScopeOption['severity'], { card: string; chip: string; label: string }> = {
  extreme: {
    card: 'border-red-500/60 bg-gradient-to-br from-red-50 to-rose-50 hover:border-red-500 dark:from-red-950/40 dark:to-rose-950/40 dark:border-red-500/40',
    chip: 'bg-red-600 text-white',
    label: 'خطر بالغ',
  },
  high: {
    card: 'border-orange-400/60 bg-gradient-to-br from-orange-50 to-amber-50 hover:border-orange-500 dark:from-orange-950/30 dark:to-amber-950/30',
    chip: 'bg-orange-600 text-white',
    label: 'خطر مرتفع',
  },
  medium: {
    card: 'border-amber-300/60 bg-gradient-to-br from-amber-50 to-yellow-50 hover:border-amber-500 dark:from-amber-950/30 dark:to-yellow-950/30',
    chip: 'bg-amber-500 text-white',
    label: 'خطر متوسط',
  },
  low: {
    card: 'border-sky-300/60 bg-gradient-to-br from-sky-50 to-indigo-50 hover:border-sky-500 dark:from-sky-950/30 dark:to-indigo-950/30',
    chip: 'bg-sky-600 text-white',
    label: 'خطر منخفض',
  },
};

const PROGRESS_STEPS = [
  { id: 'backup', label: 'إنشاء نسخة احتياطية احترازية' },
  { id: 'verify', label: 'التحقق من الرموز والصلاحيات' },
  { id: 'execute', label: 'تنفيذ التصفير داخل معاملة ذرية' },
  { id: 'audit', label: 'تسجيل العملية في سجل التدقيق' },
  { id: 'finalize', label: 'تسجيل الخروج وإعادة التوجيه' },
];

const stageOrder: StageKey[] = ['gate', 'scope', 'reason', 'challenge', 'confirm', 'progress', 'done'];
const RESET_PERMISSION = 'admin.reset_system';

const normalizePermissions = (permissions: unknown): string[] => {
  if (!Array.isArray(permissions)) return [];
  return [...new Set(permissions.filter((entry): entry is string => typeof entry === 'string'))];
};

const formatRemaining = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60).toString().padStart(2, '0');
  const s = (total % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

const SystemReset: React.FC<SystemResetProps> = ({ currentUser }) => {
  const { hasPermission, permissions } = usePermissions();
  const { data: session } = useSession();

  const effectiveRole = String(currentUser?.role || session?.user?.role || '').trim();
  const currentUserPermissions = normalizePermissions(currentUser?.permissions);
  const sessionUserPermissions = normalizePermissions(session?.user?.permissions);
  const roleFallback = currentUserPermissions.length > 0 || sessionUserPermissions.length > 0
    ? []
    : resolveRoleFallbackPermissions(effectiveRole);
  const effectivePermissions = [...new Set([...permissions, ...currentUserPermissions, ...sessionUserPermissions, ...roleFallback])];  const isSuperAdmin = effectiveRole.toLowerCase() === 'superadmin';
  const canViewReset = hasPermission(RESET_PERMISSION) || hasGrantedPermission(effectivePermissions, RESET_PERMISSION);
  const canExecuteReset = canViewReset && isSuperAdmin;

  const [stage, setStage] = useState<StageKey>('gate');
  const [scope, setScope] = useState<SystemResetScope | null>(null);
  const [reason, setReason] = useState('');
  const [createBackup, setCreateBackup] = useState(true);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmationCode, setConfirmationCode] = useState('');
  const [challenge, setChallenge] = useState<ResetChallengeResponse | null>(null);
  const [challengeInput, setChallengeInput] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [requestingChallenge, setRequestingChallenge] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [progressIndex, setProgressIndex] = useState(0);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const tickRef = useRef<number | null>(null);

  // ---- challenge expiry ticker ----
  useEffect(() => {
    if (!challenge) return;
    const tick = () => setNow(Date.now());
    tick();
    tickRef.current = window.setInterval(tick, 1000) as unknown as number;
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
    };
  }, [challenge]);

  const challengeRemainingMs = useMemo(() => {
    if (!challenge?.expiresAt) return 0;
    return new Date(challenge.expiresAt).getTime() - now;
  }, [challenge, now]);

  const challengeExpired = challenge !== null && challengeRemainingMs <= 0;

  // ---- gates ----
  if (!canViewReset) {
    return (
      <div className="rounded-3xl border border-red-200 bg-red-50 p-8 text-red-700 shadow-sm dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
        <div className="mb-3 flex items-center gap-3 text-lg font-black">
          <ShieldAlert size={22} /> لا تملك صلاحية عرض إعادة ضبط النظام
        </div>
        <div className="text-sm leading-7">
          هذه الميزة متاحة فقط لمن يملك الصلاحية <code className="rounded bg-white/70 px-1.5 py-0.5 dark:bg-black/40">{RESET_PERMISSION}</code>.
        </div>
      </div>
    );
  }

  // ---- handlers ----
  const goTo = (next: StageKey) => setStage(next);
  const goNext = () => {
    const i = stageOrder.indexOf(stage);
    if (i >= 0 && i < stageOrder.length - 1) setStage(stageOrder[i + 1]);
  };
  const goPrev = () => {
    const i = stageOrder.indexOf(stage);
    if (i > 0) setStage(stageOrder[i - 1]);
  };

  const requestChallenge = async () => {
    if (!scope) return;
    setRequestingChallenge(true);
    try {
      const issued = await systemResetService.requestChallenge(scope);
      setChallenge(issued);
      setChallengeInput('');
      toast.success('تم إنشاء رمز التحقق المؤقت — يُعرض هنا لمرة واحدة فقط.');
      goTo('challenge');
    } catch (err: any) {
      toast.error(err?.message || 'تعذر إنشاء رمز التحقق المؤقت.');
    } finally {
      setRequestingChallenge(false);
    }
  };

  const executeReset = async () => {
    if (!scope || !challenge) return;
    setSubmitting(true);
    setStage('progress');
    setProgressIndex(0);
    setResultMessage(null);

    // Visual progress simulation while the network call runs.
    const advance = () => setProgressIndex((idx) => Math.min(idx + 1, PROGRESS_STEPS.length - 1));
    const interval = window.setInterval(advance, 700);

    try {
      const response = await systemResetService.executeReset({
        confirmationCode,
        challengeId: challenge.challengeId,
        challengeCode: challengeInput || challenge.challengeCode,
        scope,
        reason,
        createBackup,
      });
      window.clearInterval(interval);
      setProgressIndex(PROGRESS_STEPS.length - 1);
      setResultMessage(response.message);
      setStage('done');
      toast.success(response.message);

      // Logout + redirect with a small delay so user can read the success state.
      window.setTimeout(() => {
        systemResetService.clearLocalStateAndRedirect(response.message);
      }, 2200);
    } catch (err: any) {
      window.clearInterval(interval);
      const message = err?.message || 'تعذر تنفيذ إعادة الضبط.';
      setResultMessage(message);
      toast.error(message);
      setStage('confirm');
    } finally {
      setSubmitting(false);
    }
  };

  // ---- render helpers ----
  const renderStageHeader = () => (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/60 bg-gradient-to-l from-rose-50 to-white p-5 dark:border-slate-700/60 dark:from-rose-950/30 dark:to-slate-900">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-500 to-red-600 text-white shadow-lg shadow-rose-500/30">
          <RefreshCcw size={22} />
        </div>
        <div>
          <div className="text-lg font-black text-slate-900 dark:text-slate-100">إعادة ضبط النظام</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            حماية ثنائية الطبقات — رمز ثابت + رمز مؤقت + سبب موثّق
          </div>
        </div>
      </div>
      <ol className="flex items-center gap-1.5 text-[11px] font-bold">
        {stageOrder.slice(1, 6).map((key, idx) => {
          const labels: Record<string, string> = {
            scope: 'النطاق',
            reason: 'السبب',
            challenge: 'الرمز المؤقت',
            confirm: 'التأكيد',
            progress: 'التنفيذ',
          };
          const i = stageOrder.indexOf(stage);
          const myI = stageOrder.indexOf(key);
          const active = myI === i;
          const done = myI < i;
          return (
            <li
              key={key}
              className={`flex items-center gap-1 rounded-full px-2.5 py-1 transition ${
                active
                  ? 'bg-rose-600 text-white shadow'
                  : done
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200'
                  : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
              }`}
            >
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/30 text-[10px] font-black">
                {idx + 1}
              </span>
              {labels[key]}
            </li>
          );
        })}
      </ol>
    </div>
  );

  const renderGate = () => (
    <motion.div key="gate" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-5 p-6">
      <div className="overflow-hidden rounded-2xl border border-red-300/70 bg-gradient-to-l from-red-50 via-rose-50 to-orange-50 p-5 dark:border-red-700/60 dark:from-red-950/40 dark:via-rose-950/40 dark:to-orange-950/30">
        <div className="flex items-start gap-3">
          <AlertTriangle size={28} className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
          <div>
            <div className="text-lg font-black text-red-700 dark:text-red-300">تحذير شديد الخطورة</div>
            <p className="mt-2 text-sm leading-7 text-red-900/90 dark:text-red-100/90">
              هذا الإجراء يُسبب فقدانًا دائمًا للبيانات. لا يمكن التراجع عنه إلا من نسخة احتياطية. يجب أن يتوفر لديك:
            </p>
            <ul className="mt-2 space-y-1.5 text-sm text-red-900/90 dark:text-red-100/90">
              <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-red-600" /> الصلاحية <code>admin.reset_system</code></li>
              <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-red-600" /> دور <strong>SuperAdmin</strong></li>
              <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-red-600" /> إعادة إدخال كلمة مرور حسابك (يتحقق منها الخادم)</li>
              <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-red-600" /> القدرة على إعادة تكوين النظام بعد التصفير</li>
            </ul>
          </div>
        </div>
      </div>

      {!canExecuteReset && (
        <div className="rounded-2xl border border-amber-300/70 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200">
          <ShieldAlert className="me-1 inline" size={16} /> لديك صلاحية <code>{RESET_PERMISSION}</code>، لكن التنفيذ محصور بدور <strong>SuperAdmin</strong> فقط.
        </div>
      )}

      <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-rose-300 dark:border-slate-700 dark:bg-slate-900">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="mt-0.5 h-5 w-5 accent-rose-600"
        />
        <div className="text-sm leading-7 text-slate-700 dark:text-slate-200">
          أقرّ بأنني فهمت العواقب الكاملة لإعادة ضبط النظام، وأنني أملك نسخة احتياطية مستقلة، وأتحمّل المسؤولية الكاملة عن هذا الإجراء.
        </div>
      </label>

      <div className="flex justify-end">
        <button
          onClick={() => goTo('scope')}
          disabled={!acknowledged || !canExecuteReset}
          className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-l from-rose-600 to-red-600 px-6 py-3 text-sm font-black text-white shadow-lg shadow-rose-500/30 transition hover:from-rose-700 hover:to-red-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          متابعة <ArrowLeft size={16} />
        </button>
      </div>
    </motion.div>
  );

  const renderScope = () => (
    <motion.div key="scope" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-4 p-6">
      <div className="text-base font-black text-slate-900 dark:text-slate-100">اختر نطاق إعادة الضبط</div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {SCOPE_OPTIONS.map((opt) => {
          const styles = SEVERITY_STYLES[opt.severity];
          const active = scope === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setScope(opt.id)}
              className={`relative overflow-hidden rounded-2xl border-2 p-4 text-start transition ${
                styles.card
              } ${active ? 'ring-4 ring-rose-400/40' : ''}`}
            >
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/80 text-slate-700 shadow dark:bg-slate-900/60 dark:text-slate-200">
                  <opt.Icon size={20} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black text-slate-900 dark:text-slate-100">{opt.title}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${styles.chip}`}>{styles.label}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">{opt.subtitle}</div>
                  <ul className="mt-3 space-y-1 text-[11px] text-slate-700 dark:text-slate-300">
                    {opt.bullets.map((b) => (
                      <li key={b} className="flex items-start gap-1.5">
                        <Trash2 size={11} className="mt-0.5 text-rose-500" /> {b}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-700/60 dark:bg-emerald-950/30">
        <input
          type="checkbox"
          checked={createBackup}
          onChange={(e) => setCreateBackup(e.target.checked)}
          className="h-5 w-5 accent-emerald-600"
        />
        <div className="flex-1 text-sm">
          <div className="font-black text-emerald-800 dark:text-emerald-200">إنشاء نسخة احتياطية كاملة قبل التصفير</div>
          <div className="text-xs text-emerald-700/90 dark:text-emerald-300/90">
            موصى به بشدة — تُحفظ في مجلد <code>backups/</code> ويمكن استعادتها لاحقًا من تبويب "النسخ الاحتياطي".
          </div>
        </div>
        <Sparkles size={18} className="text-emerald-600" />
      </label>

      <div className="flex items-center justify-between">
        <button onClick={goPrev} className="inline-flex items-center gap-1.5 rounded-2xl bg-slate-100 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200">
          <ArrowRight size={16} /> رجوع
        </button>
        <button
          onClick={() => goTo('reason')}
          disabled={!scope}
          className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-l from-rose-600 to-red-600 px-6 py-3 text-sm font-black text-white shadow-lg shadow-rose-500/30 disabled:opacity-50"
        >
          متابعة <ArrowLeft size={16} />
        </button>
      </div>
    </motion.div>
  );

  const renderReason = () => (
    <motion.div key="reason" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-4 p-6">
      <div className="text-base font-black text-slate-900 dark:text-slate-100">سبب إعادة الضبط</div>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        هذا الحقل إلزامي وسيُحفظ نصًا كاملًا في سجل التدقيق مع IP والـ User Agent.
      </p>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value.slice(0, 500))}
        rows={5}
        placeholder="مثال: إعادة تأهيل بيئة الاختبار قبل بدء العام المالي 2026 بقرار من الإدارة بتاريخ ..."
        className="w-full rounded-2xl border border-slate-300 bg-white p-4 text-sm leading-7 text-slate-800 shadow-inner focus:border-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-400/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      />
      <div className="flex items-center justify-between text-xs">
        <span className={reason.trim().length < 10 ? 'text-rose-600' : 'text-emerald-600'}>
          {reason.trim().length < 10 ? `يحتاج ${10 - reason.trim().length} حرفًا إضافية` : 'سبب صالح ✓'}
        </span>
        <span className="text-slate-400">{reason.length}/500</span>
      </div>
      <div className="flex items-center justify-between">
        <button onClick={goPrev} className="inline-flex items-center gap-1.5 rounded-2xl bg-slate-100 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200">
          <ArrowRight size={16} /> رجوع
        </button>
        <button
          onClick={requestChallenge}
          disabled={reason.trim().length < 10 || requestingChallenge}
          className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-l from-rose-600 to-red-600 px-6 py-3 text-sm font-black text-white shadow-lg shadow-rose-500/30 disabled:opacity-50"
        >
          {requestingChallenge ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
          طلب رمز تحقق مؤقت
        </button>
      </div>
    </motion.div>
  );

  const renderChallenge = () => (
    <motion.div key="challenge" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-4 p-6">
      <div className="rounded-2xl border border-amber-300/70 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100">
        <div className="flex items-center gap-2 font-black"><KeyRound size={16} /> رمز التحقق المؤقت (يُعرض مرة واحدة فقط)</div>
        <p className="mt-1 text-xs">
          انقل هذا الرمز إلى الحقل أدناه فورًا. سينتهي تلقائيًا خلال {challenge?.ttlSeconds ?? 300} ثانية ولن يُعرض ثانية.
        </p>
      </div>

      <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-rose-300 bg-gradient-to-br from-rose-50 to-white p-6 dark:border-rose-700/60 dark:from-rose-950/30 dark:to-slate-900">
        <div className="text-xs font-bold uppercase tracking-widest text-rose-600">CHALLENGE CODE</div>
        <div className="select-all rounded-2xl bg-slate-900 px-6 py-3 font-mono text-3xl font-black tracking-[0.3em] text-emerald-300 shadow-inner">
          {challenge?.challengeCode || '--------'}
        </div>
        <div className="flex items-center gap-2 text-sm font-bold text-slate-600 dark:text-slate-300">
          <Clock3 size={14} />
          {challengeExpired ? <span className="text-rose-600">انتهت الصلاحية</span> : `يتبقى: ${formatRemaining(challengeRemainingMs)}`}
        </div>
      </div>

      <label className="block space-y-2 text-sm font-bold text-slate-700 dark:text-slate-200">
        <span>أدخل رمز التحقق هنا للتأكيد</span>
        <input
          value={challengeInput}
          onChange={(e) => setChallengeInput(e.target.value.toUpperCase().slice(0, 16))}
          placeholder="ABCDEFGH"
          autoComplete="off"
          className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-center font-mono text-xl tracking-[0.3em] focus:border-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-400/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
      </label>

      <div className="flex items-center justify-between">
        <button
          onClick={() => {
            setChallenge(null);
            setChallengeInput('');
            goPrev();
          }}
          className="inline-flex items-center gap-1.5 rounded-2xl bg-slate-100 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200"
        >
          <ArrowRight size={16} /> رجوع
        </button>
        <button
          onClick={() => goTo('confirm')}
          disabled={!challenge || challengeExpired || challengeInput.trim().toUpperCase() !== challenge?.challengeCode}
          className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-l from-rose-600 to-red-600 px-6 py-3 text-sm font-black text-white shadow-lg shadow-rose-500/30 disabled:opacity-50"
        >
          متابعة <ArrowLeft size={16} />
        </button>
      </div>
    </motion.div>
  );

  const renderConfirm = () => (
    <motion.div key="confirm" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-4 p-6">
      <div className="rounded-2xl border border-red-400 bg-gradient-to-l from-red-50 to-rose-50 p-5 dark:border-red-700/60 dark:from-red-950/40 dark:to-rose-950/40">
        <div className="flex items-center gap-2 text-sm font-black text-red-700 dark:text-red-300">
          <ShieldAlert size={16} /> آخر تأكيد قبل التنفيذ
        </div>
        <ul className="mt-3 space-y-1.5 text-xs text-red-900/90 dark:text-red-100/90">
          <li>النطاق: <strong>{SCOPE_OPTIONS.find((o) => o.id === scope)?.title}</strong></li>
          <li>نسخة احتياطية مسبقة: <strong>{createBackup ? 'مفعّلة' : 'معطّلة'}</strong></li>
          <li>السبب: <em className="italic">{reason}</em></li>
          <li>المنفّذ: <strong>{currentUser?.username || session?.user?.username || '—'}</strong> (دور: {effectiveRole || '—'})</li>
        </ul>
      </div>

      <label className="block space-y-2 text-sm font-bold text-slate-700 dark:text-slate-200">
        <span className="flex items-center gap-1.5"><KeyRound size={14} /> كلمة مرور حسابك لتأكيد الهوية</span>
        <input
          type="password"
          value={confirmationCode}
          onChange={(e) => setConfirmationCode(e.target.value)}
          placeholder="أعد إدخال كلمة مرور SuperAdmin — لا يوجد رمز ثابت"
          autoComplete="current-password"
          className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 font-mono text-sm focus:border-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-400/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
      </label>

      {resultMessage && stage === 'confirm' && (
        <div className="rounded-2xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-700/60 dark:bg-rose-950/40 dark:text-rose-200">
          {resultMessage}
        </div>
      )}

      <div className="flex items-center justify-between">
        <button onClick={goPrev} disabled={submitting} className="inline-flex items-center gap-1.5 rounded-2xl bg-slate-100 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-200">
          <ArrowRight size={16} /> رجوع
        </button>
        <button
          onClick={executeReset}
          disabled={
            submitting ||
            confirmationCode.trim().length < 8 ||
            !challenge ||
            challengeExpired ||
            !canExecuteReset
          }
          className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-l from-red-600 to-rose-700 px-6 py-3 text-sm font-black text-white shadow-lg shadow-rose-500/40 disabled:opacity-50"
        >
          {submitting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
          تنفيذ إعادة الضبط الآن
        </button>
      </div>
    </motion.div>
  );

  const renderProgress = () => (
    <motion.div key="progress" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5 p-8">
      <div className="text-center text-base font-black text-slate-900 dark:text-slate-100">جاري تنفيذ إعادة الضبط...</div>
      <div className="mx-auto w-full max-w-md rounded-2xl bg-slate-100 p-1 dark:bg-slate-800">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${((progressIndex + 1) / PROGRESS_STEPS.length) * 100}%` }}
          transition={{ duration: 0.6, ease: 'easeInOut' }}
          className="h-2 rounded-2xl bg-gradient-to-l from-rose-500 to-red-600"
        />
      </div>
      <ol className="mx-auto max-w-md space-y-2">
        {PROGRESS_STEPS.map((step, i) => {
          const done = i < progressIndex;
          const active = i === progressIndex;
          return (
            <li
              key={step.id}
              className={`flex items-center gap-3 rounded-2xl border px-4 py-2.5 text-sm transition ${
                done
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-700/60 dark:bg-emerald-950/30 dark:text-emerald-200'
                  : active
                  ? 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-700/60 dark:bg-rose-950/30 dark:text-rose-200'
                  : 'border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400'
              }`}
            >
              {done ? <CheckCircle2 size={16} /> : active ? <Loader2 size={16} className="animate-spin" /> : <span className="h-2 w-2 rounded-full bg-current opacity-40" />}
              {step.label}
            </li>
          );
        })}
      </ol>
    </motion.div>
  );

  const renderDone = () => (
    <motion.div key="done" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-4 p-10 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/40">
        <ShieldCheck size={32} />
      </div>
      <div className="text-xl font-black text-emerald-700 dark:text-emerald-300">تمت العملية بنجاح</div>
      <div className="mx-auto max-w-md text-sm text-slate-600 dark:text-slate-300">{resultMessage}</div>
      <div className="text-xs text-slate-400">سيتم تسجيل الخروج وإعادة التوجيه إلى صفحة الدخول خلال لحظات...</div>
    </motion.div>
  );

  return (
    <div dir="rtl" className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      {renderStageHeader()}
      <AnimatePresence mode="wait">
        {stage === 'gate' && renderGate()}
        {stage === 'scope' && renderScope()}
        {stage === 'reason' && renderReason()}
        {stage === 'challenge' && renderChallenge()}
        {stage === 'confirm' && renderConfirm()}
        {stage === 'progress' && renderProgress()}
        {stage === 'done' && renderDone()}
      </AnimatePresence>
    </div>
  );
};

export default SystemReset;
