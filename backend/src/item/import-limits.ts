/**
 * FC-ITEM-IMPORT — one source for the import's limits.
 *
 * The row cap existed in three places with no shared origin: the DTO's
 * `@ArrayMaxSize(15000)`, the service's own `MAX_BULK_IMPORT_ROWS` comparison, and
 * the prose in this repository's remediation notes. The DTO runs first, so the
 * service's Arabic explanation of the limit was unreachable: an operator sending
 * 15,001 rows got a class-validator array instead of a sentence that says what the
 * limit is and how to split the file.
 *
 * These are configuration rather than constants because they are part of one
 * budget, and the budget spans four systems that each have their own number:
 *
 *   MAX_BULK_IMPORT_ROWS   this file
 *   JSON_BODY_LIMIT        main.ts, .env.example
 *   client_max_body_size   both nginx configs
 *   MAX_BULK_IMPORT_BATCH_SIZE   the service, for transaction sizing
 *
 * A 15,000-row Arabic import measures about 4 MB. Raising any one of them without
 * the others is how an import that the documentation promises turns into a 413
 * from nginx with an HTML page in the toast. Keeping them in one module with a
 * comment naming the others is the cheapest way to make that visible.
 *
 * Parsed rather than trusted: a typo in the environment must not turn into
 * `NaN` rows or an unbounded batch.
 */

const readInt = (name: string, fallback: number, min: number, max: number): number => {
  const raw = String(process.env[name] ?? '').trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
};

/** Hard ceiling on rows in one import. Matches `@ArrayMaxSize` on the DTO. */
export const MAX_BULK_IMPORT_ROWS = readInt('MAX_BULK_IMPORT_ROWS', 15_000, 1, 200_000);

/**
 * Rows per transaction inside the import.
 *
 * Not a performance knob. The batch is the unit of atomicity, so a smaller batch
 * means a failure costs fewer good rows and a larger one means fewer round trips.
 * 250 is where a 15,000-row file stays a minute-scale operation while a single
 * failed batch still costs at most 250 rows.
 */
export const BULK_IMPORT_BATCH_SIZE = readInt('BULK_IMPORT_BATCH_SIZE', 250, 1, 5_000);
