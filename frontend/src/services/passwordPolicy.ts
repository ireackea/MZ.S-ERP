import { IsString, MinLength } from 'class-validator';

/**
 * FC-SEC-010 — the list of rules the UI renders next to the password field, so
 * the person setting a password is told what it must satisfy instead of
 * discovering it one rejected attempt at a time.
 */
export const PASSWORD_RULE_LABELS: readonly string[] = [
  '٨ أحرف على الأقل',
  'حرف كبير (A-Z)',
  'حرف صغير (a-z)',
  'رقم (0-9)',
  'رمز خاص (!@#$…)',
];

export const PASSWORD_MIN_LENGTH = 8;

export type PasswordRuleKey = 'minLength' | 'upper' | 'lower' | 'digit' | 'special';

export const PASSWORD_RULES: readonly { key: PasswordRuleKey; label: string; test: (v: string) => boolean }[] = [
  { key: 'minLength', label: PASSWORD_RULE_LABELS[0], test: (v) => v.length >= PASSWORD_MIN_LENGTH },
  { key: 'upper', label: PASSWORD_RULE_LABELS[1], test: (v) => /[A-Z]/.test(v) },
  { key: 'lower', label: PASSWORD_RULE_LABELS[2], test: (v) => /[a-z]/.test(v) },
  { key: 'digit', label: PASSWORD_RULE_LABELS[3], test: (v) => /\d/.test(v) },
  { key: 'special', label: PASSWORD_RULE_LABELS[4], test: (v) => /[^A-Za-z0-9]/.test(v) },
];

export const passwordRuleResults = (value: string) =>
  PASSWORD_RULES.map((rule) => ({ ...rule, ok: rule.test(value) }));

/** True only when every rule passes. Mirrors common/password-policy.ts. */
export const isPasswordPolicyCompliant = (value: string): boolean =>
  PASSWORD_RULES.every((rule) => rule.test(value));

export type ChangePasswordPayload = {
  currentPassword: string;
  newPassword: string;
};
