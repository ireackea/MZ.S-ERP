import { createHash, pbkdf2Sync } from 'node:crypto';

/**
 * B11 / B12 — what an archive's key is derived from, and whether this server can
 * still open it.
 *
 * ## The failure
 *
 * `deriveAesKey` was `pbkdf2(password + ':' + masterSecret, salt)`. The master secret
 * was mixed into every archive's key, which means the archives are bound to *this
 * server's current configuration* rather than to their own password.
 *
 * So: rebuild the server, rotate `BACKUP_ENCRYPTION_SECRET` as any competent operator
 * would, and every existing archive becomes undecryptable. The data is intact. The
 * backup system cannot read it, and it cannot tell you so — the failure surfaces as
 * «Unable to decrypt backup. Invalid password or corrupted file», which is the same
 * message for a wrong password, a truncated file, and a rotated secret.
 *
 * A backup that only its own server can open is not a backup; it is a copy. This
 * module makes the scope of each archive explicit and, more importantly, makes the
 * difference *detectable* — a fingerprint of the secret, stored in the envelope, so a
 * failed open can say which of the three things happened.
 *
 * ## The scopes
 *
 * - **`both`** — what this system has always written. The key needs the archive
 *   password (or the master secret) *and* the master secret. Stronger against someone
 *   who has the file but not the server, and unusable after a rotation. Kept as the
 *   default because changing the scope of existing archives silently would be worse
 *   than the problem: an archive that stops being readable is a data-loss event
 *   wearing a security improvement's clothes.
 * - **`archive-only`** — the key needs the passphrase and nothing else from this
 *   server. Survives a rebuild and a rotation. The passphrase is supplied by the
 *   operator and stored nowhere.
 *
 * The choice is per archive and is recorded, so a restore knows which one it is
 * holding rather than discovering it by failing.
 *
 * ## What this module does not do
 *
 * It does not weaken `both`, and it does not silently migrate anything. An archive
 * sealed under `both` stays under `both` forever; making it portable means creating a
 * new one, which the operator does deliberately and sees happen.
 */

export type KeyScope = 'both' | 'archive-only';

export const KEY_SCOPES: readonly KeyScope[] = ['both', 'archive-only'];

export type DeriveInput = {
  /** The archive's own passphrase, when it has one. */
  password?: string | null;
  /** This server's master secret. Omitted for `archive-only`. */
  masterSecret?: string | null;
  scope?: KeyScope;
  salt: Buffer;
  iterations?: number;
};

export type PassphraseRefusal = { ok: false; code: string; message: string };

/**
 * A type guard rather than `if (!resolved.ok)`.
 *
 * This package compiles with `"strict": false`, and without `strictNullChecks`
 * TypeScript does not narrow a union on a boolean-literal discriminant, so the
 * refusal branch's fields stay inaccessible. A named guard states the intent and works
 * regardless of the compiler settings the package happens to run under.
 */
export const isRefusal = (
  result: { ok: true; secret: string } | PassphraseRefusal,
): result is PassphraseRefusal => result.ok === false;
export const DEFAULT_PBKDF2_ITERATIONS = 210_000;

/**
 * The passphrase an archive must be opened with, per scope.
 *
 * Returned as a discriminated result rather than thrown, because the caller needs to
 * tell three different failures apart: no passphrase given, wrong passphrase, and
 * right passphrase on the wrong server.
 */
export function resolvePassphrase(input: {
  password?: string | null;
  masterSecret?: string | null;
  scope?: KeyScope;
}): { ok: true; secret: string } | { ok: false; code: string; message: string } {
  const scope: KeyScope = input.scope ?? 'both';
  const password = String(input.password || '').trim();

  if (scope === 'archive-only') {
    // The whole point of the scope: nothing from this server is mixed in, so a
    // passphrase is mandatory. Falling back to the master secret here would silently
    // produce an archive that is *not* portable, and the operator would believe it is.
    if (!password) {
      return {
        ok: false,
        code: 'RESTORE_PASSPHRASE_REQUIRED',
        message:
          'هذه النسخة مختومة بكلمة مرور خاصة بها ولا تعتمد على مفتاح هذا الخادم. '
          + 'أدخل كلمة المرور الخاصة بنسخة الاستعادة.',
      };
    }
    return { ok: true, secret: password };
  }

  const master = String(input.masterSecret || '').trim();
  if (!master) {
    return {
      ok: false,
      code: 'RESTORE_NO_MASTER_SECRET',
      message: 'مفتاح تشفير الخادم غير مضبوط (BACKUP_ENCRYPTION_SECRET).',
    };
  }
  return { ok: true, secret: password || master };
}

/**
 * The derived key.
 *
 * `archive-only` feeds the passphrase alone into PBKDF2. `both` keeps the historical
 * `password:master` form byte-for-byte, so every archive already on disk still opens:
 * changing the KDF input of existing archives would make them unreadable, which is a
 * data-loss event disguised as a refactor.
 */
export function deriveArchiveKey(input: DeriveInput): Buffer {
  const scope: KeyScope = input.scope ?? 'both';
  const resolved = resolvePassphrase({
    password: input.password,
    masterSecret: input.masterSecret,
    scope,
  });
  if (isRefusal(resolved)) {
    throw new Error(`${resolved.code}: ${resolved.message}`);
  }
  const iterations = input.iterations ?? DEFAULT_PBKDF2_ITERATIONS;

  return scope === 'archive-only'
    ? pbkdf2Sync(resolved.secret, input.salt, iterations, 32, 'sha256')
    : pbkdf2Sync(`${resolved.secret}:${String(input.masterSecret || '').trim()}`, input.salt, iterations, 32, 'sha256');
}

/**
 * A fingerprint of the master secret, stored in the envelope.
 *
 * Twelve hex characters of SHA-256 over the secret and a fixed label. It reveals
 * nothing useful about the secret — it cannot be brute-forced back to it without the
 * secret, and it is not the secret — and it answers the only question that matters
 * when an archive will not open: *is this the server that made it?*
 *
 * The label is mixed in so this value can never be confused with a hash of the secret
 * computed elsewhere for a different purpose, and so a rainbow table built for one
 * field does not answer this one.
 */
export function masterSecretFingerprint(masterSecret: string | null | undefined): string {
  return createHash('sha256')
    .update(`ffbkp:v1:master-secret-fingerprint:${String(masterSecret || '').trim()}`)
    .digest('hex')
    .slice(0, 12);
}

export type RestoreReadiness = {
  restorable: boolean;
  code: 'OK' | 'SECRET_ROTATED' | 'ARCHIVE_KEYED_ELSEWHERE' | 'NO_ARCHIVES' | 'NO_MASTER_SECRET';
  message: string;
  /** True when the failure is a configuration problem rather than a damaged archive. */
  configurationProblem: boolean;
};

/**
 * Why an archive did not open — and, more usefully, why it *will* not.
 *
 * The old path answered «Invalid password or corrupted file» for a wrong password, a
 * corrupt file and a rotated secret alike. An operator who rotated the secret could
 * spend a day re-typing passphrases before learning the real cause. This is the
 * function that lets the caller say which one it was.
 */
export function explainOpenFailure(input: {
  /** The fingerprint recorded when the archive was sealed. Absent for old archives. */
  sealedWith?: string | null;
  /** This server's current fingerprint. */
  current: string;
  scope?: KeyScope;
  hasPassphrase: boolean;
}): RestoreReadiness {
  const scope: KeyScope = input.scope ?? 'both';

  // A pre-B11 archive carries no fingerprint, so nothing can be said about it. Say
  // that rather than implying the current secret is known to be the right one.
  if (!input.sealedWith) {
    return {
      restorable: input.hasPassphrase || true,
      code: 'OK',
      message:
        'هذه النسخة أقدم من تسجيل بصمة المفتاح، فلا يمكن الجزم بمفتاح الخادم الذي ختمها. '
        + 'إن فشلت محاولتها فالسبب على الأرجح تغيير مفتاح الخادم.',
      configurationProblem: false,
    };
  }

  if (input.sealedWith === input.current) {
    return {
      restorable: true,
      code: 'OK',
      message: 'مفتاح هذا الخادم هو نفسه الذي ختم هذه النسخة.',
      configurationProblem: false,
    };
  }

  if (scope === 'archive-only') {
    return {
      restorable: input.hasPassphrase,
      code: 'ARCHIVE_KEYED_ELSEWHERE',
      message:
        'هذه النسخة لا تعتمد على مفتاح هذا الخادم — وهذا مقصود. '
        + (input.hasPassphrase
          ? 'أدخل كلمة المرور الخاصة بها.'
          : 'لكنك لم تُدخل كلمة المرور الخاصة بها، فلا يمكن فتحها.'),
      configurationProblem: !input.hasPassphrase,
    };
  }

  return {
    restorable: false,
    code: 'SECRET_ROTATED',
    message:
      'هذه النسخة خُتمت بمفتاح خادم آخر: تغيّرت BACKUP_ENCRYPTION_SECRET بعد أخذها. '
      + 'البيانات سليمة داخل الملف لكنها لا تُفتح على هذا الخادم. '
      + 'استعد على الخادم الذي ختمها، أو أنشئ نسخة جديدة مختومة بكلمة مرور خاصة (archive-only) لتكون قابلة للاسترجاع.',
    configurationProblem: true,
  };
}
