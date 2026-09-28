// ENTERPRISE FIX: Phase 2 – التناسق والإعدادات العامة - 2026-03-13
import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { usePermissions } from '@hooks/usePermissions';

interface ThemeAndLocalizationProps {
}

/**
 * Gate 5.3 — the language control was a working-looking feature that changed
 * nothing.
 *
 * `i18n.changeLanguage('en')` was called and the dropdown read `i18n.language`
 * from a mutable module singleton during render, with no `useTranslation`
 * subscription and no re-render, so even the control snapped back. Behind that the
 * premise did not hold: `useTranslation` appears in zero files under
 * `frontend/src`, and the two translation files hold 79 and 45 bytes. Every string
 * in the interface is hardcoded Arabic, and nothing sets
 * `document.documentElement.dir` or `lang`, so even a working switch would have
 * left the RTL layout untouched. The page advertised "تبديل اللغة الفعالة داخل
 * التطبيق".
 *
 * So the control is removed rather than patched. A language switch needs
 * translations to switch between, a subscription for components to re-render, and
 * a direction switch for an RTL interface. That is a project, and shipping half of
 * it is worse than shipping none of it, because the one thing a user does with a
 * language control is switch language.
 *
 * What is left is honest: the interface is Arabic-only today, and the page says
 * so rather than offering a control that does nothing.
 */
const ThemeAndLocalization: React.FC<ThemeAndLocalizationProps> = ({ }) => {
  const { hasPermission } = usePermissions();

  if (!hasPermission('theme.view')) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">
        <div className="mb-2 flex items-center gap-2 font-bold">
          <ShieldAlert size={18} />
          لا تملك صلاحية عرض إعدادات الواجهة
        </div>
        <div>تحتاج إلى الصلاحية <code>theme.view</code>.</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-2xl font-black text-slate-900">إعدادات الواجهة</h2>
        <p className="mt-2 text-sm text-slate-500">المظهر ولغة العرض.</p>
      </div>

      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <div className="font-bold">تبديل اللغة غير مُفعَّل</div>
        <div className="mt-1">
          واجهة النظام عربية بالكامل حاليًا، ولا تتوفّر ملفات ترجمة لل لغات أخرى. كان هنا اختيار للغة
          لا يغيّر شيئًا مرئيًا، وقد أُزيل بدل تركه يبدو كأنه ميزة.
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-600">
        تم تعطيل تبديل الثيمات الديناميكي، لذلك يبقى المظهر الكلاسيكي المؤسسي هو الافتراضي الحالي.
      </div>
    </div>
  );
};

export default ThemeAndLocalization;
