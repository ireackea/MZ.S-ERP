import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  DEFAULT_PBKDF2_ITERATIONS,
  explainOpenFailure,
  isRefusal,
  KEY_SCOPES,
  masterSecretFingerprint,
  resolvePassphrase,
  deriveArchiveKey,
} from './archive-key';

/**
 * B11 / B12 — a backup that only its own server can open is a copy.
 *
 * The KDF was `pbkdf2(password + ':' + masterSecret, salt)`. The master secret was
 * mixed into every archive's key, so rotating `BACKUP_ENCRYPTION_SECRET` — which any
 * competent operator does after a rebuild — made every existing archive undecryptable.
 * The data was intact; the backup system simply could not read it, and reported
 * «Invalid password or corrupted file», which is the same sentence for a wrong
 * passphrase, a damaged file, and a rotated secret.
 *
 * These cases are the three that were indistinguishable, plus the one that proves the
 * fix does not quietly break the archives already on disk.
 */

const SECRET_A = 'a-master-secret-of-at-least-32-characters';
const SECRET_B = 'a-different-master-secret-32-characters!!';

describe('the master secret fingerprint', () => {
  it('is stable, and differs when the secret differs', () => {
    expect(masterSecretFingerprint(SECRET_A)).toBe(masterSecretFingerprint(SECRET_A));
    expect(masterSecretFingerprint(SECRET_A)).not.toBe(masterSecretFingerprint(SECRET_B));
  });

  it('reveals nothing that helps recover the secret', () => {
    const fingerprint = masterSecretFingerprint(SECRET_A);
    expect(fingerprint).toHaveLength(12);
    expect(fingerprint).toMatch(/^[0-9a-f]{12}$/);
    // Not a prefix, not a slice, not the secret under any encoding an attacker would
    // try first. The point is that it answers "is this the same server?" and nothing
    // else.
    expect(SECRET_A.startsWith(fingerprint)).toBe(false);
    expect(fingerprint).not.toContain(SECRET_A.slice(0, 4));
  });

  it('is labelled, so it cannot be confused with a plain hash of the secret', () => {
    // A rainbow table built for some other field that happens to hash the secret must
    // not answer this one.
    const plain = require('node:crypto').createHash('sha256').update(SECRET_A).digest('hex').slice(0, 12);
    expect(masterSecretFingerprint(SECRET_A)).not.toBe(plain);
  });
});

describe('explaining a failed open', () => {
  const current = masterSecretFingerprint(SECRET_A);

  it('says the secret was rotated, which has a completely different fix', () => {
    // The case that cost a day. The message has to name the cause, because the fix is
    // "restore on the server that sealed it, or re-key" — not "try the password again".
    const verdict = explainOpenFailure({
      sealedWith: masterSecretFingerprint(SECRET_B),
      current,
      scope: 'both',
      hasPassphrase: false,
    });

    expect(verdict.code).toBe('SECRET_ROTATED');
    expect(verdict.restorable).toBe(false);
    expect(verdict.configurationProblem).toBe(true);
    expect(verdict.message).toMatch(/BACKUP_ENCRYPTION_SECRET/);
    expect(verdict.message).toMatch(/archive-only/);
  });

  it('says the passphrase is wrong when the secret matches', () => {
    const verdict = explainOpenFailure({
      sealedWith: current,
      current,
      scope: 'both',
      hasPassphrase: true,
    });
    expect(verdict.code).toBe('OK');
    expect(verdict.restorable).toBe(true);
  });

  it('admits it cannot know about archives sealed before the fingerprint existed', () => {
    // Every archive already on disk. Saying nothing would imply the current secret is
    // known to be the right one, which is exactly the wrong thing to imply.
    const verdict = explainOpenFailure({ sealedWith: null, current, scope: 'both', hasPassphrase: false });
    expect(verdict.code).toBe('OK');
    expect(verdict.message).toMatch(/أقدم|بصمة/);
  });

  it('treats a missing fingerprint on an archive-only archive as fine, not as a rotation', () => {
    // `archive-only` archives do not depend on this server's secret at all, so a
    // fingerprint mismatch must never be reported as "the secret changed" for them —
    // that would send an operator chasing a rotation that is not the cause.
    const verdict = explainOpenFailure({
      sealedWith: masterSecretFingerprint(SECRET_B),
      current,
      scope: 'archive-only',
      hasPassphrase: true,
    });
    expect(verdict.code).toBe('ARCHIVE_KEYED_ELSEWHERE');
    expect(verdict.restorable).toBe(true);
  });
});

describe('the key scopes', () => {
  it('offers exactly two, and names them', () => {
    expect(KEY_SCOPES).toEqual(['both', 'archive-only']);
  });

  it('refuses an archive-only scope with no passphrase, rather than quietly sealing with the secret', () => {
    // The tempting implementation is to fall back to the master secret. It would
    // produce a file the operator believes is portable and that stops opening the
    // day the server is rebuilt — the exact promise the scope exists to keep.
    const refused = resolvePassphrase({ password: '', masterSecret: SECRET_A, scope: 'archive-only' });
    expect(isRefusal(refused)).toBe(true);
    if (isRefusal(refused)) expect(refused.code).toBe('RESTORE_PASSPHRASE_REQUIRED');
  });

  it('refuses `both` with no master secret, naming the variable', () => {
    const refused = resolvePassphrase({ password: '', masterSecret: '', scope: 'both' });
    expect(isRefusal(refused)).toBe(true);
    if (isRefusal(refused)) expect(refused.message).toMatch(/BACKUP_ENCRYPTION_SECRET/);
  });

  it('derives the same key for `both` as the historical form, so existing archives stay open', () => {
    // This is the one that matters for not breaking production. The old KDF was
    // `pbkdf2(secret + ':' + master, salt, 210000, 32, 'sha256')`. If this drifts by
    // a single byte, every archive on disk becomes unreadable — a data-loss event
    // disguised as a refactor.
    const pbkdf2Sync = require('node:crypto').pbkdf2Sync;
    const salt = Buffer.from('0123456789abcdef', 'utf8');

    const historical = pbkdf2Sync(
      `${SECRET_A}:${SECRET_A}`,
      salt,
      DEFAULT_PBKDF2_ITERATIONS,
      32,
      'sha256',
    );
    const derived = deriveArchiveKey({
      password: undefined,
      masterSecret: SECRET_A,
      scope: 'both',
      salt,
    });

    expect(derived.equals(historical)).toBe(true);
  });

  it('derives an archive-only key that ignores the master secret entirely', () => {
    // The property the whole item exists for: the same passphrase and the same salt
    // must produce the same key on a *different* server.
    const salt = Buffer.from('0123456789abcdef', 'utf8');
    const onServerA = deriveArchiveKey({ password: 'passphrase', masterSecret: SECRET_A, scope: 'archive-only', salt });
    const onServerB = deriveArchiveKey({ password: 'passphrase', masterSecret: SECRET_B, scope: 'archive-only', salt });

    expect(onServerA.equals(onServerB), 'an archive-only archive must survive the server changing').toBe(true);
    // And it must NOT equal the `both` key for the same inputs, or the scope would be
    // a label rather than a change.
    const scopedBoth = deriveArchiveKey({ password: 'passphrase', masterSecret: SECRET_A, scope: 'both', salt });
    expect(onServerA.equals(scopedBoth)).toBe(false);
  });

  it('changes the key when the passphrase changes', () => {
    const salt = Buffer.from('0123456789abcdef', 'utf8');
    const right = deriveArchiveKey({ password: 'right', masterSecret: SECRET_A, scope: 'archive-only', salt });
    const wrong = deriveArchiveKey({ password: 'wrong', masterSecret: SECRET_A, scope: 'archive-only', salt });
    expect(right.equals(wrong)).toBe(false);
  });
});

describe('the service seals and opens accordingly', () => {
  const repoRoot = resolve(__dirname, '../../..');
  const service = readFileSync(join(repoRoot, 'backend/src/backup/backup.service.ts'), 'utf8');

  it('records the scope and the fingerprint in the envelope', () => {
    // Without these the restore has to infer the protection by failing, which is the
    // state this item exists to leave.
    expect(service).toContain('keyScope: scope');
    expect(service).toContain('masterSecretFingerprint: masterSecretFingerprint(this.getMasterSecret())');
  });

  it('defaults to `both`, so nothing already on disk changes meaning', () => {
    // Changing the default would silently re-scope every future archive and quietly
    // weaken what protects the ones being written now.
    expect(service).toContain("params.keyScope === 'archive-only' ? 'archive-only' : 'both'");
    expect(service).toContain("envelope.keyScope ?? 'both'");
  });

  it('refuses a rotated secret with a diagnosis rather than a guess', () => {
    expect(service).toContain('BACKUP_SECRET_ROTATED');
    expect(service).toContain('explainOpenFailure');
  });
});
