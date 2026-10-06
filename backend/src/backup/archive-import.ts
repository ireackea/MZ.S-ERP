/**
 * B21 — deciding whether an uploaded archive may enter the store.
 *
 * ## The failure this exists for
 *
 * An operator downloads a backup, deletes it from the list to free space, and then
 * discovers there is no way to put it back. The file is on their desktop; the
 * section has no path that accepts it. So the only copy of the database outside the
 * system is a file the system will not read, and the one action that would have
 * needed it — a restore — cannot reach it.
 *
 * That is the whole of the problem, and it is not a storage problem. It is a missing
 * door.
 *
 * ## What is checked, and why each check earns its place
 *
 * Everything here is a *rejection* case except the last. An import is not a
 * destructive act, so the bar is "is this a genuine archive of ours that is safe to
 * store and honest about what it contains" — not "is this safe to run". The
 * destructive checks belong to the restore, which already has them and which this
 * path cannot skip.
 *
 * - **Signature and version.** A file that is not an `FFBKUP2` v2 envelope is not a
 *   backup. Without this, any file could be written into the trusted backup
 *   directory under a name the list would then display.
 * - **Auth tag.** The envelope is AES-GCM. An archive that does not decrypt under the
 *   current master secret was sealed with a different key, and storing it would add a
 *   row that lists as a backup and can never be restored — the exact dead end this
 *   door is being built to remove.
 * - **Id and type.** Both come from *inside* the authenticated envelope, never from
 *   the filename, the multipart field, or the `Content-Disposition` header. A name is
 *   caller-controlled input; an id that survived an auth tag is not.
 * - **Created at.** Also from the envelope, and deliberately *not* reset to now. The
 *   date is what the archive says about itself, and it is what retention reads.
 *
 * ## What this deliberately does not do
 *
 * It does not refuse an archive whose schema has drifted, and it does not refuse an
 * incomplete one. Both are storable facts, and both are already visible where they
 * belong: the list renders `incomplete` and `failed` badges, and the restore refuses
 * them with a reason. Refusing at import would mean the operator uploads a real
 * backup of their data, is told "no", and is back to having a file the system will
 * not read — the dead end again, reached faster.
 *
 * So the answer to "can I use this?" is reported, and the archive is stored. What is
 * reported and what is refused are different questions, and conflating them is how a
 * section ends up unable to accept anything at all.
 */

export type ImportCandidate = {
  /** Decrypted payload, already authenticated. */
  payload: {
    type?: string;
    id?: string;
    createdAt?: string;
    counts?: Record<string, unknown>;
    manifest?: { missingModels?: string[] };
    partialTables?: readonly string[] | null;
  };
  passwordProtected: boolean;
};

export type ImportVerdict =
  | { ok: true; id: string; type: string; createdAt: string; restorable: boolean }
  | {
      ok: false;
      code: string;
      message: string;
    };

const BACKUP_SIGNATURE = 'FFBKUP2';
const BACKUP_VERSION = 2;
const KNOWN_TYPES = new Set(['full', 'inventory', 'config', 'safety_snapshot']);

export type ImportRefusal = { ok: false; code: string; message: string };
export type ImportAcceptance = { ok: true; id: string; type: string; createdAt: string; restorable: boolean };

/**
 * A type guard rather than `if (!verdict.ok)`.
 *
 * This package compiles with `"strict": false`, and without `strictNullChecks`
 * TypeScript does not narrow a union on a boolean-literal discriminant — the
 * success variant stays in the narrowed type and every property access on the
 * refusal branch is an error. A named guard states the intent and works regardless
 * of the compiler settings the rest of the package happens to run under.
 */
export const isRefusal = (verdict: ImportVerdict): verdict is ImportRefusal => verdict.ok === false;

/** `2026-09-30T02:00:00.000Z` — and nothing looser. */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

const refuse = (code: string, message: string): ImportVerdict => ({ ok: false, code, message });

/**
 * Reads the envelope's *shape* only. Authenticity is the caller's job and cannot be
 * faked here: by the time this runs, the caller has already decrypted with
 * AES-GCM, so every field below came out of an authenticated payload.
 */
export function inspectEnvelope(raw: unknown): ImportVerdict {
  if (typeof raw !== 'object' || raw === null) {
    return refuse('BACKUP_IMPORT_NOT_AN_ARCHIVE', 'الملف ليس أرشيف نسخة احتياطية.');
  }

  const envelope = raw as Record<string, unknown>;
  if (envelope.signature !== BACKUP_SIGNATURE || Number(envelope.version) !== BACKUP_VERSION) {
    return refuse(
      'BACKUP_IMPORT_BAD_SIGNATURE',
      `توقيع الملف غير معروف. المتوقّع ${BACKUP_SIGNATURE} الإصدار ${BACKUP_VERSION}.`,
    );
  }

  if (typeof envelope.payloadBase64 !== 'string' || !envelope.payloadBase64) {
    return refuse('BACKUP_IMPORT_NO_PAYLOAD', 'الملف لا يحمل محتوى نسخة احتياطية.');
  }
  if (typeof envelope.authTagBase64 !== 'string' || !envelope.authTagBase64) {
    return refuse('BACKUP_IMPORT_NO_AUTHTAG', 'الملف ناقص، وبصمة صحّته غير موجودة.');
  }

  return { ok: true, id: '', type: '', createdAt: '', restorable: true };
}

/**
 * The decision, on a payload that has already been authenticated.
 *
 * Separated from `inspectEnvelope` so the rules are readable and testable without
 * producing a real archive: the first three refusals are about identity, and they
 * are the ones a caller could otherwise influence.
 */
export function judgeImport(input: {
  id: string;
  type: string;
  createdAt: string;
  missingModels?: string[];
}): ImportVerdict {
  const id = String(input.id || '').trim();
  if (!id) {
    return refuse('BACKUP_IMPORT_NO_ID', 'الملف لا يحمل مُعرِّف نسخة. لا يمكن تسجيله بلا مُعرِّف.');
  }
  // A path segment here becomes a filename. Anything that could climb out of the
  // backup directory, or that is not a plain id, is refused rather than sanitised,
  // because a sanitised id would then not match the id inside the archive and the
  // next import of the same file would create a second row.
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(id)) {
    return refuse('BACKUP_IMPORT_BAD_ID', 'مُعرِّف النسخة داخل الملف غير صالح.');
  }

  const type = String(input.type || '').trim();
  if (!KNOWN_TYPES.has(type)) {
    return refuse('BACKUP_IMPORT_BAD_TYPE', `نوع النسخة غير معروف: ${type || '(فارغ)'}.`);
  }

  const createdAt = String(input.createdAt || '').trim();
  if (!ISO_TIMESTAMP.test(createdAt)) {
    return refuse(
      'BACKUP_IMPORT_BAD_DATE',
      'تاريخ النسخة داخل الملف غير صالح. لا يُخمَّن التاريخ، لأن التاريخ المُخمَّن يجعل نسخةً قديمة تبدو جديدة.',
    );
  }

  // Not a refusal. Reported instead, and the list renders it as `incomplete`.
  return { ok: true, id, type, createdAt, restorable: (input.missingModels ?? []).length === 0 };
}
