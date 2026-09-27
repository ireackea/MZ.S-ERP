/**
 * FC-SEC-004 — the single password policy.
 *
 * The policy existed only inside `AuthService.validatePasswordPolicy` and was
 * applied to the `ADMIN_PASSWORD` env value alone. Every user created through
 * the IAM screen, and every invited user, went through `bcrypt.hash` with no
 * policy check at all, so `12345678` was a valid password for a real account.
 *
 * This module is the one place the rules live, so the bootstrap admin, the IAM
 * create-user form, the invitation flow and the admin reset can never drift.
 */

export const PASSWORD_MIN_LENGTH = 8;

/** Every rule, in the order they are reported to the user. */
export const PASSWORD_RULES: readonly { key: string; label: string; test: (v: string) => boolean }[] = [
  { key: 'minLength', label: `٨ أحرف على الأقل`, test: (v) => v.length >= PASSWORD_MIN_LENGTH },
  { key: 'upper', label: 'حرف كبير (A-Z)', test: (v) => /[A-Z]/.test(v) },
  { key: 'lower', label: 'حرف صغير (a-z)', test: (v) => /[a-z]/.test(v) },
  { key: 'digit', label: 'رقم (0-9)', test: (v) => /\d/.test(v) },
  { key: 'special', label: 'رمز خاص (!@#$…)', test: (v) => /[^A-Za-z0-9]/.test(v) },
];

/**
 * Historical admin passwords that must never be accepted again, even though
 * they satisfy every structural rule above.
 */
export const LEGACY_WEAK_ADMIN_PASSWORDS: ReadonlySet<string> = new Set([
  'admin123',
  'admin123!',
  'admin',
  'password',
  '12345678',
  'admin@123',
]);

/** The rules a candidate password fails, as display-ready labels. */
export const passwordPolicyFailures = (password: string): string[] => {
  const candidate = String(password ?? '');
  return PASSWORD_RULES.filter((rule) => !rule.test(candidate)).map((rule) => rule.label);
};

export const isWeakLegacyPassword = (password: string): boolean =>
  LEGACY_WEAK_ADMIN_PASSWORDS.has(String(password ?? '').toLowerCase());

/** True only when the password satisfies every rule and is not a known-weak value. */
export const isPasswordPolicyCompliant = (password: string): boolean => {
  const candidate = String(password ?? '');
  if (passwordPolicyFailures(candidate).length) return false;
  return !isWeakLegacyPassword(candidate);
};

/** Single sentence explaining what is missing, for a 400 response. */
export const passwordPolicyMessage = (password: string): string => {
  const failures = passwordPolicyFailures(password);
  if (!failures.length && isWeakLegacyPassword(password)) {
    return 'كلمة المرور مستخدمة سابقاً وممنوعة. اختر كلمة مختلفة.';
  }
  if (!failures.length) return 'كلمة المرور لا تستوفي سياسة كلمات المرور.';
  return `كلمة المرور لا تستوفي السياسة. مطلوب: ${failures.join(' · ')}`;
};
