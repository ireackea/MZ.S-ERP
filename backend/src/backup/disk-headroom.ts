/**
 * B16 — refuse to write an archive that does not fit, before writing it.
 *
 * ## The two failures
 *
 * **1. The partial file.** The archive was written straight to its final path. A disk
 * that fills part-way through leaves a truncated `.ffbkp` sitting exactly where a
 * complete one belongs, with no manifest row. Nothing lists it, nothing prunes it,
 * and the next operator who sees the directory has to work out by hand whether that
 * file is a backup. `ENOSPC` mid-`writeFile` is not an exotic event; it is what a
 * disk does.
 *
 * **2. The backup that breaks the database.** This is the one that matters. There is
 * no check of any kind, so a backup scheduled at 02:00 on a server with one archive's
 * worth of headroom will happily take that headroom. Postgres then cannot extend a
 * WAL segment, cannot write, and the database the backup was protecting is down —
 * and the backup that did it is the most recent one, so the tool that was supposed to
 * make recovery possible is what removed the option.
 *
 * A backup system that can fill the disk is a liability with a green badge.
 *
 * ## Why the estimate is not the dump size
 *
 * The dump is base64-encoded once into `dbBase64`, and that JSON is then base64-encoded
 * again into `payloadBase64`. Each encoding costs a third: `16/9` ≈ 1.78× in total.
 * So a 1 GB dump produces a ~1.78 GB archive. A check that compared free space to the
 * dump size would approve a write that then fails with `ENOSPC` — passing the check and
 * still producing the partial file, which is the worst of both.
 *
 * ## Why there is a floor and not just "enough for the file"
 *
 * Enough room for the archive still leaves the disk at zero. Postgres needs room to
 * write; the container runtime needs room to start. So the requirement is the archive
 * *plus* a floor, and the message carries both numbers, because "insufficient disk
 * space" is not something an operator can act on and "1.4 GB free, 1.9 GB needed" is.
 */

/** Base64 costs a third. Applied twice: the dump, then the JSON holding it. */
export const BASE64_COST = 4 / 3;
export const ENCODED_COST = (BASE64_COST * BASE64_COST); // ≈ 1.778

/**
 * Slack on top of the estimate. The encoded size of a dump is not perfectly
 * predictable — compression, index ordering and `pg_dump` version all move it — and a
 * check that is exactly right is a check that fails occasionally.
 */
export const ESTIMATE_MARGIN = 1.15;

/**
 * Room left over after the archive, regardless of how big the archive is.
 *
 * 256 MiB, or 3% of the volume, whichever is larger. Not generous: it is the point at
 * which refusing is cheaper than continuing.
 */
export const MIN_FREE_AFTER = 256 * 1024 * 1024;

export type HeadroomCode =
  | 'OK'
  /** Free space is unknown, so the check could not be made. */
  | 'SPACE_UNKNOWN'
  /** Free space would drop below the floor. This is the disk-kills-the-DB case. */
  | 'BACKUP_DISK_LOW'
  /** The archive itself does not fit. */
  | 'BACKUP_DISK_FULL';

export type HeadroomVerdict = {
  code: HeadroomCode;
  ok: boolean;
  /** What the archive is expected to need on disk, after margin. */
  requiredBytes: number;
  /** The floor that must survive the write. */
  floorBytes: number;
  freeBytes: number;
  /** What would be left if the write went ahead. Negative means it does not fit. */
  projectedFreeBytes: number;
  message: string;
};

const mib = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;

export type ArchiveEstimateInput = {
  /** Raw `pg_dump` bytes, before any encoding. */
  databaseBytes?: number;
  /** Serialised Prisma snapshot, before encoding. */
  dataSnapshotBytes?: number;
  /** Captured config files, before encoding. */
  configBytes?: number;
  /** Size of the most recent archive of the same type, as a sanity cross-check. */
  previousArchiveBytes?: number;
};

/**
 * What this archive will occupy on disk.
 *
 * Prefers the measured previous archive over the computed estimate when both exist,
 * because a measurement beats a formula: if last night's full backup was 2.1 GB, this
 * one will be about 2.1 GB, whatever the arithmetic says. The computed value still
 * participates as the floor, so an implausibly small previous archive (a fresh empty
 * database after a restore) cannot talk the check into approving a small write.
 */
export function estimateArchiveBytes(input: ArchiveEstimateInput): number {
  const encoded =
    (Math.max(Number(input.databaseBytes || 0), 0) +
      Math.max(Number(input.dataSnapshotBytes || 0), 0) +
      Math.max(Number(input.configBytes || 0), 0)) *
    ENCODED_COST;

  const previous = Math.max(Number(input.previousArchiveBytes || 0), 0);
  const basis = Math.max(encoded, previous > 0 ? previous : 0);
  return Math.ceil(basis * ESTIMATE_MARGIN);
}

export type HeadroomInput = {
  /** Free bytes on the volume, or `null`/`0` when `statfs` could not answer. */
  freeBytes: number | null | undefined;
  requiredBytes: number;
  /** Total volume size, used only to scale the floor. */
  totalBytes?: number;
};

/**
 * The decision, as a pure function so it can be argued about and tested without a disk.
 */
export function judgeHeadroom(input: HeadroomInput): HeadroomVerdict {
  const required = Math.max(Math.ceil(Number(input.requiredBytes || 0)), 0);
  const floor = Math.max(MIN_FREE_AFTER, Math.ceil(Number(input.totalBytes || 0) * 0.03), 0);
  const free = Number(input.freeBytes || 0);

  const base = {
    requiredBytes: required,
    floorBytes: floor,
    freeBytes: free,
    projectedFreeBytes: free - required,
  };

  if (!(free > 0)) {
    return {
      ...base,
      code: 'SPACE_UNKNOWN',
      // Not a refusal. A platform that cannot report free space is not a platform
      // where refusing is correct — it is a platform where the atomic write in
      // `writeArchiveAtomically` is what protects the archive.
      ok: true,
      message:
        'تعذّر قراءة المساحة الحرة على هذا المجلد. ستصبح الكتابة ذرّية ' +
        'مؤقتاً، لكن لا يمكن ضمان اكتمالها. تحقق من مساحة القرص يدوياً.',
    };
  }

  const projected = free - required;

  if (projected < 0) {
    return {
      ...base,
      code: 'BACKUP_DISK_FULL',
      ok: false,
      message:
        `لا توجد مساحة كافية للنسخة: نحتاج ${mib(required)} والمتاح ${mib(free)}. ` +
        'لم يُكتب أي ملف — لم تمتلئ القرص ولم يتعطّل.',
    };
  }

  if (projected < floor) {
    return {
      ...base,
      code: 'BACKUP_DISK_LOW',
      ok: false,
      message:
        `رفض إنشاء النسخة: ستترك ${mib(projected)} فقط بعد الكتابة، ` +
        `والمطلوب إبقاء ${mib(floor)} على الأقل. ` +
        'امتلاء القرص يوقف قاعدة البيانات نفسها، والنسخة التي تأخذ المساحة الأخيرة ' +
        'هي التي تمنع عنها الاستعادة.',
    };
  }

  return {
    ...base,
    code: 'OK',
    ok: true,
    message: `المساحة كافية: ${mib(required)} مطلوبة، ${mib(projected)} ستتبقى.`,
  };
}