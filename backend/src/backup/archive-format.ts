/**
 * B15-2 — one authority for which archive formats exist and which of them this build
 * can act on.
 *
 * ## Why this file exists
 *
 * The signature and the version were declared twice. `backup.service.ts` had
 * `const BACKUP_SIGNATURE = 'FFBKUP2'` and a `BackupEnvelope` type whose `version` was
 * the literal `2`; `archive-import.ts` had its own copy of both, plus its own check.
 * Two declarations of a format are two answers to "what is this file", and they already
 * answered differently in one direction: the service compared `parsed.version !== 2`
 * while the importer compared `Number(envelope.version) !== BACKUP_VERSION`, so a
 * string `"2"` passed one and failed the other.
 *
 * Adding a third format to two files is how an archive ends up readable by the panel and
 * not by the restore path. So the constants, the readable set and the switch live here,
 * and everyone else imports them.
 *
 * ## Readable is not the same as writable
 *
 * `READABLE_ARCHIVE_VERSIONS` is deliberately narrower than the set of versions that
 * exist. A build may be able to *write* v3 while it cannot yet *restore* v3 — S1 of
 * B15-2 is exactly that state — and the difference has to be visible in code rather
 * than discovered by an operator holding an archive the tool wrote and cannot open.
 */

/** v2: the JSON envelope with one base64 payload. Every archive on disk today. */
export const BACKUP_SIGNATURE_V2 = 'FFBKUP2';
export const ARCHIVE_VERSION_V2 = 2;

/** v3: the streaming container in `./archive-container`. */
export const ARCHIVE_VERSION_V3 = 3;

export const BACKUP_EXTENSION = '.ffbkp';

/**
 * The versions this build can restore, read, verify and import.
 *
 * v3 joins this list in S2, when `pg_restore` is fed a member stream instead of a
 * string. Until then a v3 archive is written only if an operator asks for it by name,
 * and every path that needs its contents refuses with a message that says why.
 */
export const READABLE_ARCHIVE_VERSIONS: readonly number[] = [ARCHIVE_VERSION_V2];

/** v2, unless someone asks for v3 by name. */
export const DEFAULT_WRITABLE_ARCHIVE_VERSION = ARCHIVE_VERSION_V2;

export type WritableArchiveVersion = typeof ARCHIVE_VERSION_V2 | typeof ARCHIVE_VERSION_V3;

const isKnownVersion = (value: unknown): value is WritableArchiveVersion =>
  Number(value) === ARCHIVE_VERSION_V2 || Number(value) === ARCHIVE_VERSION_V3;

export const isReadableArchiveVersion = (value: unknown): boolean =>
  isKnownVersion(value) && READABLE_ARCHIVE_VERSIONS.includes(Number(value));

/**
 * The version new archives should be written in.
 *
 * An unrecognised value is not silently ignored. `BACKUP_ARCHIVE_VERSION=3` misspelled
 * as `v3` must not quietly keep writing v2 for a year while somebody believes the
 * change shipped; it is read as the default and reported by `describeArchiveVersions`,
 * which the health endpoint shows.
 */
export const configuredWritableVersion = (raw: string | undefined = process.env.BACKUP_ARCHIVE_VERSION): WritableArchiveVersion => {
  if (raw === undefined || String(raw).trim() === '') return DEFAULT_WRITABLE_ARCHIVE_VERSION;
  const trimmed = String(raw).trim();
  if (!isKnownVersion(trimmed)) return DEFAULT_WRITABLE_ARCHIVE_VERSION;
  return Number(trimmed) as WritableArchiveVersion;
};

/** True when the configured value was present but not a version this build knows. */
export const configuredVersionIsUnrecognised = (raw: string | undefined = process.env.BACKUP_ARCHIVE_VERSION): boolean => {
  if (raw === undefined || String(raw).trim() === '') return false;
  return !isKnownVersion(String(raw).trim());
};

/**
 * The refusal, in one place, for "this file is newer than this build".
 *
 * It is a message and not a `JSON.parse` failure. A v3 container read as JSON is a
 * parse error about a file that is perfectly valid, and an operator reading "unexpected
 * token" cannot tell whether their archive is damaged or their software is old.
 */
export const archiveFormatMessage = (found: number | string | null | undefined): string => {
  const readable = READABLE_ARCHIVE_VERSIONS.join(', ');
  const foundText = found === null || found === undefined || found === '' ? 'غير معروف' : String(found);
  return (
    `صيغة الأرشيف ${foundText} لا يستطيع هذا الإصدار قراءتها. ` +
    `الإصدارات المقروءة في هذا البناء: ${readable}. ` +
    'حدّث الخادم الذي أنشأ النسخة، أو استعد على إصدار يقرأها. الأرشيف نفسه لم يتلف.'
  );
};

export const describeArchiveVersions = () => ({
  configured: configuredWritableVersion(),
  readable: [...READABLE_ARCHIVE_VERSIONS],
  defaultWritable: DEFAULT_WRITABLE_ARCHIVE_VERSION,
  configuredValueRecognised: !configuredVersionIsUnrecognised(),
});
