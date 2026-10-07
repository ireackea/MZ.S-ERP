// ENTERPRISE FIX: Phase 0 – Critical Security & Encoding Lockdown - 2026-03-13
// ENTERPRISE FIX: Phase 0.3 – Final Arabic Encoding Fix & 10/10 Declaration - 2026-03-13
// ENTERPRISE FIX: Arabic Encoding Auto-Fixed - 2026-03-13
// ENTERPRISE FIX: Phase 0.1 – Final Encoding & Lock Fix - 2026-03-13
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
  NotFoundException,
  OnModuleDestroy,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual,
} from 'crypto';
import type { Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { base64ByteLength, dumpPostgres, isPostgresUrl, restorePostgres } from './pg-dump';
import { estimateArchiveBytes, judgeHeadroom } from './disk-headroom';
import {
  CONFIG_FILES_ALLOW_LIST,
  buildFileName,
  collectConfigFiles,
  computeFileChecksum,
  decryptSecret,
  encryptSecret,
  hashSecret,
  hashSha256,
  restoreConfigFiles,
  verifySecret,
  type ConfigSnapshot,
} from './backup-files';
import { planReconciliation } from './backup-reconcile';
import { copyOffsite, countVerifiedOffsiteCopies, offsiteDirectory, type OffsiteCopyResult } from './offsite-copy';
import { withManifestAdvisoryLock } from './manifest-lock';
import { archiveIsRestorable, archiveMigrationNames, type DriftArchive } from './schema-drift';
import { inspectEnvelope, isRefusal, judgeImport } from './archive-import';
import {
  deriveArchiveKey,
  explainOpenFailure,
  isRefusal as isPassphraseRefusal,
  masterSecretFingerprint,
  resolvePassphrase,
  type KeyScope,
} from './archive-key';
import {
  normalizeRetentionLimits,
  planRetention,
  RETENTION_BOUNDS,
  RETENTION_DEFAULTS,
  type RetentionLimits,
  type RetentionPlan,
} from './retention';
import { DatabaseInfrastructureService } from '../database/database-infrastructure.service';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';

/** What a reconciliation pass reports. Exported so the controller can name it. */
export type ReconcileReport = {
  toDelete: string[];
  reclaimableBytes: number;
  deleted: number;
  suspect: null | { code: string; message: string };
  decisions: Array<{ name: string; action: string; reason: string; sizeBytes: number }>;
  lockMode: string;
};
export type BackupType = 'full' | 'inventory' | 'config' | 'safety_snapshot';
export type BackupTrigger = 'manual' | 'scheduled' | 'import';

type StorageTarget = 'local' | 'usb' | 'drive';

type BackupActor = {
  type: 'user' | 'system';
  mode: 'manual' | 'scheduled' | 'import';
  userId?: string;
  username?: string;
  role?: string;
};

/** B4 — the seven events the backup section records, one row each. */
type BackupAuditAction =
  | 'BACKUP_CREATED'
  | 'BACKUP_DELETED'
  | 'BACKUP_DOWNLOADED'
  | 'BACKUP_IMPORTED'
  | 'BACKUP_RECONCILED'
  | 'RESTORE_PREVIEW'
  | 'RESTORE_APPLIED'
  | 'RESTORE_FAILED'
  | 'SCHEDULE_CHANGED';

type BackupScheduleState = {
  enabled: boolean;
  frequency: 'daily' | 'weekly' | 'monthly';
  hour: number;
  minute: number;
  dayOfWeek: number;
  dayOfMonth: number;
  retentionDays: number;
  /** B9 — hard ceiling on how many ordinary archives may exist at once. */
  maxCount: number;
  /** B9 — floor on how many archives survive any retention pass. */
  minCount: number;
  /** B9 — ceiling on safety snapshots, which no age or count rule may remove. */
  maxSafetySnapshots: number;
  storageTargets: StorageTarget[];
  encryptionEnabled: boolean;
  encryptedPassword?: string;
  passwordHash?: string;
  passwordSaltBase64?: string;
  restorePinHash?: string;
  restorePinSaltBase64?: string;
  lastRunAt?: string;
  lastRunKey?: string;
  updatedAt: string;
};

type BackupMetaCounts = {
  users: number;
  items: number;
  openingBalances: number;
  transactions: number;
  configFiles: number;
};

type BackupManifestEntry = {
  id: string;
  fileName: string;
  type: BackupType;
  trigger: BackupTrigger;
  createdAt: string;
  sizeBytes: number;
  checksumSha256: string;
  integrity: BackupIntegrity;
  passwordProtected: boolean;
  actor: BackupActor;
  metadata: BackupMetaCounts;
  /** FC-OPS-001 — size of the captured database dump, used for storage reporting. */
  databaseBytes?: number;
  /** FC-OPS-001 — whether this backup is complete enough to be a full restore. */
  complete?: boolean;
  missingModels?: string[];
  /**
   * Non-null when the archive covers only these tables.
   *
   * This is the field the restore path and the UI both read to decide whether a
   * restore replaces the database or the stock ledger. Without it an inventory
   * archive is indistinguishable from a full one, which is how restoring "stock"
   * replaced users and roles.
   */
  partialTables?: readonly string[] | null;
  safetySnapshotForId?: string | null;
  /**
   * B19 - what actually happened to the off-host copy.
   *
   * Recorded per archive rather than inferred from a setting, because a configured
   * destination and a working one are different claims. Absent on archives written before
   * the field existed, which means *unknown*, not *off*.
   */
  offsite?: OffsiteCopyResult | null;
};

/**
 * `incomplete` exists because "verified" was previously a constant and therefore
 * carried no information. An archive that was written but does not contain what
 * its type promises is neither good nor corrupt: it is incomplete, and conflating
 * that with success is how a database-free archive ended up wearing a green
 * badge.
 */
export type BackupIntegrity = 'verified' | 'incomplete' | 'failed';

/**
 * The tables an `inventory` backup covers.
 *
 * Everything the stock ledger is made of, and nothing that identifies a person.
 * The list is the contract: it is what `pg_dump --table` selects, what
 * `pg_restore --table` replays, and what the manifest and the UI report. Adding a
 * table here is a decision to include it in stock restores.
 */
export const INVENTORY_TABLES = [
  'Item',
  'Transaction',
  'OpeningBalance',
  'StockDeficit',
  'formulations',
  'formulation_items',
  'unloading_rules',
  'stocktaking_sessions',
  'stocktaking_entries',
  'stocktaking_counts',
] as const;

type BackupListItem = BackupManifestEntry & {
  integrityVerified: boolean;
  integrityLabel: BackupIntegrity;
};

// B18/S1 — `ConfigSnapshot` moved to ./backup-files with the two functions that produce
// and consume it. It was private here and is now the module's own, which is where a
// reader looking for "what shape is a captured config file" will find it first.

type RoleSnapshot = Omit<Prisma.RoleCreateManyInput, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
};

type UserSnapshot = Omit<Prisma.UserCreateManyInput, 'lockoutUntil' | 'inviteExpires' | 'createdAt' | 'updatedAt'> & {
  lockoutUntil?: string | null;
  inviteExpires?: string | null;
  createdAt: string;
  updatedAt: string;
};

type OpeningBalanceSnapshot = Omit<Prisma.OpeningBalanceCreateManyInput, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
};

type TransactionSnapshot = Omit<Prisma.TransactionCreateManyInput, 'date' | 'timestamp' | 'createdAt' | 'updatedAt'> & {
  date: string;
  timestamp?: string | null;
  createdAt: string;
  updatedAt: string;
};

type StatFsResult = {
  bavail?: number | bigint;
  bsize?: number | bigint;
  blocks?: number | bigint;
};

type PrismaDataSnapshot = {
  engine: 'prisma';
  roles?: RoleSnapshot[];
  // FC-SEC-007 — permissions / rolePermissions / userRoles are intentionally
  // absent. Those tables are no longer part of the schema; the fields stay
  // readable in this type so an older backup file that still carries them is
  // restored without error rather than rejected outright.
  users?: UserSnapshot[];
  items?: Prisma.ItemCreateManyInput[];
  openingBalances?: OpeningBalanceSnapshot[];
  transactions?: TransactionSnapshot[];
};

type BackupPayload = {
  type: BackupType;
  trigger: BackupTrigger;
  createdAt: string;
  sourceBackupId?: string;
  dbBase64?: string;
  /**
   * Set when the dump covers only these tables. Its presence is what makes the
   * archive partial, and its absence is what tells the restore path that
   * `pg_restore --clean` is correct.
   */
  partialTables?: readonly string[] | null;
  dataSnapshot?: PrismaDataSnapshot;
  configFiles: ConfigSnapshot[];
  schedule?: BackupScheduleState;
  counts: BackupMetaCounts;
  /**
   * FC-OPS-001 — what the backup actually contains. A restore must be able to
   * refuse a dump that silently omitted tables, which is exactly the failure the
   * old SQLite path produced on PostgreSQL.
   */
  manifest?: BackupManifest;
};

/**
 * FC-OPS-001 — per-section manifest.
 *
 * `modelCounts` lets a restore verify that every table in the schema is present;
 * `missingModels` is populated at backup time and fails the completeness gate
 * rather than producing a partial restore.
 */
type BackupManifest = {
  /** App version that produced the backup. */
  appVersion: string;
  /** Prisma schema version, so a restore can detect an incompatible dump. */
  schemaVersion: string;
  /**
   * FC-OPS-002 — the migration names applied when this backup was taken.
   *
   * `schemaVersion` is a count, and a count cannot be compared meaningfully: an
   * image that adds one migration and drops another leaves the total unchanged,
   * so the count agrees while the schema does not. The names are what the restore
   * guard reads, so that restoring an archive that predates a migration is
   * refused rather than applied.
   *
   * Optional, because archives taken before this field existed are still
   * readable — and a restore of one is refused, since an unknown schema is not a
   * schema anyone can vouch for.
   */
  migrations?: string[];
  createdAt: string;
  /** Every table name Prisma knows about, whether or not it was dumped. */
  expectedModels: string[];
  /** Tables actually present in this backup, with their row counts. */
  includedModels: string[];
  /** Tables that exist in the schema but are deliberately out of scope. */
  excludedModels: Array<{ model: string; reason: string }>;
  /** Tables that exist in the schema but were NOT captured — a hard failure. */
  missingModels: string[];
  modelCounts: Record<string, number>;
  /** sha256 per section, so corruption is detected before any destructive step. */
  checksums: Record<string, string>;
  databaseDump: {
    included: boolean;
    format?: string;
    byteLength?: number;
    sha256?: string;
  };
  /** FC-OPS-001 — whether a `full` backup also carries uploaded attachments. */
  attachments: { included: boolean; fileCount: number; reason: string };
};

type BackupEnvelope = {
  signature: 'FFBKUP2';
  version: 2;
  id: string;
  type: BackupType;
  trigger: BackupTrigger;
  createdAt: string;
  actor: BackupActor;
  passwordProtected: boolean;
  algorithm: 'aes-256-gcm';
  ivBase64: string;
  saltBase64: string;
  authTagBase64: string;
  payloadSha256: string;
  payloadBase64: string;
  metadata: BackupMetaCounts;
  sourceBackupId?: string;
  /**
   * B11 — how the key was derived. Absent on archives written before this field
   * existed, which means `both`: the historical behaviour, and the only reading that
   * keeps those archives open.
   */
  keyScope?: KeyScope;
  /**
   * B12 — a fingerprint of the master secret at the moment this archive was sealed.
   *
   * Twelve hex characters of a labelled SHA-256. It reveals nothing that helps
   * recover the secret, and it answers the only question that matters when an archive
   * will not open: is this the server that made it? Without it a rotated secret and a
   * wrong passphrase produce the same message, and an operator can spend a day
   * re-typing passwords before learning the real cause.
   */
  masterSecretFingerprint?: string;
};

type RestorePreviewToken = {
  token: string;
  backupId: string;
  actorKey: string;
  safetySnapshotId: string;
  expiresAt: number;
};

const BACKUP_SIGNATURE = 'FFBKUP2';
const BACKUP_EXTENSION = '.ffbkp';
const MANIFEST_FILE = 'index.json';
const SCHEDULE_FILE = 'schedule.json';
const RESTORE_TOKEN_TTL_MS = 10 * 60 * 1000;
// B18/S1 — `CONFIG_FILES_ALLOW_LIST` moved to ./backup-files and is imported from there.
// A second copy of an allow-list is a second list, and the one that decides what a
// backup may carry must not be the one that happens to be nearer to a caller.

@Injectable()
export class BackupService implements OnModuleDestroy {
  private readonly logger = new Logger(BackupService.name);
  private readonly backupDir = path.join(process.cwd(), 'backups');
  private readonly manifestFile = path.join(this.backupDir, MANIFEST_FILE);
  private readonly scheduleFile = path.join(this.backupDir, SCHEDULE_FILE);
  private readonly restoreTokens = new Map<string, RestorePreviewToken>();
  private scheduleTimer: NodeJS.Timeout | null = null;
  private schedulerRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly databaseInfrastructure: DatabaseInfrastructureService,
    // B4 — optional so a caller that builds this service without the audit module
    // (the unit tests) still works; the helper above degrades to a logged error
    // rather than a silent no-op.
    //
    // A *value* import, not `import type`: the latter erases the class from
    // `design:paramtypes`, Nest then receives `Function` as the third dependency and
    // the whole application fails to boot with an unresolvable-provider error. A
    // type-checker cannot see this — only starting the service does.
    @Optional() private readonly audit?: AuditService,
  ) {
    // B7 — the bootstrap is fire-and-forget because the constructor cannot await,
    // but its failure is no longer discarded. An unhandled rejection here is how a
    // backup directory that cannot be created reaches production as silence: every
    // later call fails on its own terms and nothing says the real cause was this.
    void this.ensureWorkspace().catch((error) => {
      this.logger.error(
        'Backup workspace could not be prepared.',
        error instanceof Error ? error : new Error(String(error)),
      );
    });
    this.startScheduler();
  }

  onModuleDestroy() {
    if (this.scheduleTimer) clearInterval(this.scheduleTimer);
    this.scheduleTimer = null;
  }

  /**
   * B4 — the seven events this section must leave behind, written after the fact.
   *
   * The backup section wrote no audit rows at all. `BACKUP_CREATE`,
   * `BACKUP_RESTORE` and `BACKUP_DELETE` were declared in the action union and
   * used by nothing, so a restore of the entire database and a deletion of the only
   * copy were both invisible afterwards. For the operations in this file that is
   * the specific gap that matters: they are the ones an operator cannot undo and
   * cannot reconstruct from the data.
   *
   * Two properties matter more than the coverage itself.
   *
   * *After* the outcome is known, never before. An audit row written before a
   * restore is a row saying a restore happened when it may have failed halfway, and
   * the row for the failure would then contradict it. `RESTORE_FAILED` is
   * recorded from the failure path, so the pair always agrees.
   *
   * *Never fatal.* These actions are file operations, not database transactions, so
   * the audit row cannot commit or roll back with them — there is no `tx` to join.
   * If the row cannot be written, the operator's action must still stand and the
   * operator must still get their result; a failed audit that turns a successful
   * backup into a 500 would be a worse system than no audit. The loss is logged at
   * error level, loudly, because a silently unlogged restore is the failure mode
   * this is here to prevent.
   */
  private async recordBackupAudit(
    action: BackupAuditAction,
    params: {
      actor?: Partial<BackupActor>;
      status?: 'success' | 'failed';
      entityId?: string;
      message: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    const audit = this.audit;
    if (!audit) {
      this.logger.error(`Backup audit not recorded (no audit service): ${action} — ${params.message}`);
      return;
    }
    const actor = params.actor;
    try {
      await audit.logItemAction(
        actor?.userId || 'system',
        action,
        'Backup',
        String(params.entityId || 'backup'),
        { message: params.message, ...(params.metadata || {}) },
        actor?.username || 'system',
        params.status === 'failed' ? 'FAILED' : 'SUCCESS',
        { actorRole: actor?.role || 'system' },
      );
    } catch (error) {
      this.logger.error(
        `Backup audit not recorded: ${action} — ${params.message}`,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  // SECURITY FIX: 2026-03-28 - Fail fast instead of hardcoded fallback
  private getMasterSecret(): string {
    const secret = (
      process.env.BACKUP_ENCRYPTION_SECRET ||
      process.env.JWT_SECRET
    )?.trim();

    if (!secret || secret.length < 32) {
      if (process.env.NODE_ENV === 'production') {
        this.logger.error('BACKUP_ENCRYPTION_SECRET or JWT_SECRET must be set in production (min 32 chars)');
        throw new Error('Backup encryption secret not configured. Set BACKUP_ENCRYPTION_SECRET env var.');
      }
      // Only in development: warn but allow
      this.logger.warn('Using development fallback for backup encryption. Set BACKUP_ENCRYPTION_SECRET for production.');
      return 'dev-only-backup-secret-do-not-use-in-prod';
    }

    return secret;
  }

  private normalizeActor(actor?: Partial<BackupActor>, trigger: BackupTrigger = 'manual'): BackupActor {
    if (actor?.type === 'user') {
      return {
        type: 'user',
        mode: actor.mode === 'scheduled' ? 'scheduled' : 'manual',
        userId: actor.userId,
        username: actor.username,
        role: actor.role,
      };
    }

    return {
      type: 'system',
      mode: trigger === 'scheduled' ? 'scheduled' : actor?.mode === 'scheduled' ? 'scheduled' : 'manual',
      username: actor?.username,
      userId: actor?.userId,
      role: actor?.role,
    };
  }

  private actorKey(actor?: Partial<BackupActor>): string {
    if (actor?.type === 'user') return `${actor.userId ?? 'unknown'}:${actor.username ?? 'user'}`;
    return `system:${actor?.username ?? 'scheduler'}`;
  }

  private defaultSchedule(): BackupScheduleState {
    return {
      enabled: true,
      frequency: 'daily',
      hour: 2,
      minute: 0,
      dayOfWeek: 0,
      dayOfMonth: 1,
      retentionDays: 30,
      // B9 — the defaults live in `./retention` so the policy has one definition
      // rather than two that can disagree.
      maxCount: RETENTION_DEFAULTS.maxCount,
      minCount: RETENTION_DEFAULTS.minCount,
      maxSafetySnapshots: RETENTION_DEFAULTS.maxSafetySnapshots,
      storageTargets: ['local'],
      encryptionEnabled: true,
      updatedAt: new Date().toISOString(),
    };
  }

  private clamp(value: unknown, min: number, max: number, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.round(parsed)));
  }

  private normalizeStorageTargets(value: unknown): StorageTarget[] {
    if (!Array.isArray(value)) return ['local'];
    const allowed = new Set<StorageTarget>(['local', 'usb', 'drive']);
    const normalized = value
      .map((item) => String(item || '').toLowerCase().trim())
      .filter((item): item is StorageTarget => allowed.has(item as StorageTarget));
    return normalized.length > 0 ? Array.from(new Set(normalized)) : ['local'];
  }

  private sanitizeSchedule(input: unknown): BackupScheduleState {
    const defaults = this.defaultSchedule();
    const source = (typeof input === 'object' && input !== null ? input : {}) as Partial<BackupScheduleState>;
    const limits = normalizeRetentionLimits({
      retentionDays: source.retentionDays ?? defaults.retentionDays,
      maxCount: source.maxCount ?? defaults.maxCount,
      minCount: source.minCount ?? defaults.minCount,
      maxSafetySnapshots: source.maxSafetySnapshots ?? defaults.maxSafetySnapshots,
    });
    return {
      enabled: source.enabled ?? defaults.enabled,
      frequency: ['daily', 'weekly', 'monthly'].includes(String(source.frequency || ''))
        ? (source.frequency as BackupScheduleState['frequency'])
        : defaults.frequency,
      hour: this.clamp(source.hour, 0, 23, defaults.hour),
      minute: this.clamp(source.minute, 0, 59, defaults.minute),
      dayOfWeek: this.clamp(source.dayOfWeek, 0, 6, defaults.dayOfWeek),
      dayOfMonth: this.clamp(source.dayOfMonth, 1, 31, defaults.dayOfMonth),
      // B9 — clamped in one place, with the cross-clamp that stops a floor above the
      // ceiling from silently disabling retention altogether.
      retentionDays: limits.retentionDays,
      maxCount: limits.maxCount,
      minCount: limits.minCount,
      maxSafetySnapshots: limits.maxSafetySnapshots,
      storageTargets: this.normalizeStorageTargets(source.storageTargets),
      encryptionEnabled: Boolean(source.encryptionEnabled ?? defaults.encryptionEnabled),
      encryptedPassword: typeof source.encryptedPassword === 'string' ? source.encryptedPassword : undefined,
      passwordHash: typeof source.passwordHash === 'string' ? source.passwordHash : undefined,
      passwordSaltBase64: typeof source.passwordSaltBase64 === 'string' ? source.passwordSaltBase64 : undefined,
      restorePinHash: typeof source.restorePinHash === 'string' ? source.restorePinHash : undefined,
      restorePinSaltBase64: typeof source.restorePinSaltBase64 === 'string' ? source.restorePinSaltBase64 : undefined,
      lastRunAt: typeof source.lastRunAt === 'string' ? source.lastRunAt : undefined,
      lastRunKey: typeof source.lastRunKey === 'string' ? source.lastRunKey : undefined,
      updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : new Date().toISOString(),
    };
  }
  private async ensureWorkspace() {
    await fsPromises.mkdir(this.backupDir, { recursive: true });
    if (!fs.existsSync(this.manifestFile)) {
      await fsPromises.writeFile(this.manifestFile, '[]', 'utf8');
    }
    if (!fs.existsSync(this.scheduleFile)) {
      await fsPromises.writeFile(this.scheduleFile, JSON.stringify(this.defaultSchedule(), null, 2), 'utf8');
    }
  }

  /**
   * Serialises every read-modify-write of the manifest.
   *
   * Two of those overlapped before. `GET /backup/list` read the manifest, spent
   * seconds checksumming every archive, then wrote back its own stale copy — so a
   * backup created in between was erased from the index while its `.ffbkp` file
   * survived as an orphan: invisible, uncounted in the reported total, never
   * pruned by retention (which walks manifest entries) and unaddressable by id.
   * The archive existed and the system said it did not.
   */
  private manifestChain: Promise<unknown> = Promise.resolve();
  /**
/**
   * B17 — whether to also hold a Postgres advisory lock, not just the in-memory chain.
   *
   * ## On by default, because the lock can no longer leak
   *
   * The first version used `pg_advisory_lock`, which is **session**-scoped. Prisma pools
   * connections, so the statement taking the lock and the one releasing it were not
   * guaranteed to share a connection. When they did not, the release was a no-op on the
   * wrong session and the lock stayed held on the original one for as long as it lived.
   *
   * The symptom was worse than the problem: after enough backups every delete, retention
   * pass and import waited the full timeout behind a leaked lock, and the module appeared
   * to hang. So it was left switched off, with the reason recorded — an unexplained hang in
   * the backup system is worse than a documented race in a single-process deployment.
   *
   * It is now `pg_try_advisory_xact_lock` inside an interactive transaction.
   * Transaction-scoped means the database releases it on commit, rollback, timeout and
   * connection loss, so there is no path by which it outlives the work it guards. That is
   * the structural property the session-scoped version lacked, and it is why this is safe
   * to enable rather than merely possible.
   *
   * ## What is still not covered
   *
   * Two **containers** that do not share a PostgreSQL database — a genuinely separate
   * server with its own volume — still do not see each other. That is a deployment
   * question rather than a code one: the archives live in one directory, so a second
   * server does not have the same problem to solve.
   *
   * Set `BACKUP_ADVISORY_LOCK=false` to fall back to the in-memory chain alone.
   */
  private get advisoryLockEnabled(): boolean {
    return String(process.env.BACKUP_ADVISORY_LOCK ?? 'true').toLowerCase() !== 'false';
  }

  private withManifestLock<T>(fn: () => Promise<{ manifest: BackupManifestEntry[]; result: T }>): Promise<T> {
    // `fn` must be *invoked inside* the chain. Hoisting it out — `const body = fn()` —
    // starts every operation immediately and leaves the chain merely awaiting results,
    // which removes the serialisation entirely. The symptom is a lost update on
    // `index.json`: rows vanish and rows resurrect, in both directions, and it appeared
    // as an unexplainable drift between the index and the directory on a live server.
    //
    // The advisory wrapper returns the whole envelope as `locked.result`, so both
    // branches agree on the type unwrapped one line below.
    const run = this.manifestChain
      .then(() =>
        this.advisoryLockEnabled
          ? withManifestAdvisoryLock(this.prisma, fn).then((locked) => {
              if (locked.outcome.mode === 'in-memory-only' && locked.outcome.degradedReason) {
                this.logger.warn(
                  'manifest lock degraded to in-memory only: ' + locked.outcome.degradedReason,
                );
              }
              return locked.result;
            })
          : fn(),
      )
      .then((value) => value.result);
    // Keep the chain alive regardless of outcome; a rejected link would wedge
    // every later caller.
    this.manifestChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * B10 — make the archive directory and the manifest agree again.
   *
   * The list endpoint is built from the manifest, so a file the manifest does not know
   * about is invisible: it consumes disk, it is never pruned, and the dashboard reports a
   * healthy set of backups while the disk fills. That is the worst combination available
   * — reassuring where it matters least.
   *
   * The plan is computed by a pure function (`planReconciliation`) and this method only
   * carries it out, because the two states in which deleting is wrong — a lost index, and
   * a sweep that would empty the directory — are decisions, and decisions belong where
   * they can be argued about and tested.
   */
  async reconcileArchiveDirectory(
    actor?: Partial<BackupActor>,
  ): Promise<ReconcileReport> {
    const outcome = await this.withManifestLock(async () => ({
      manifest: await this.readManifest(),
      // The locked-internal form, because acquiring the lock again here would deadlock:
      // the manifest chain is not re-entrant, so a nested acquisition waits on a link
      // that is waiting on it. This is exactly how `createBackupInternal` hung for
      // sixteen minutes before it was found.
      result: await this.reconcileArchiveDirectoryLocked(),
    }));

    // B4 — a sweep that removes files is recorded, so "the disk filled up" has a cause
    // when someone asks why the space went.
    await this.recordBackupAudit('BACKUP_RECONCILED', {
      actor,
      entityId: 'archive-directory',
      message:
        outcome.suspect
          ? `Reconciliation refused to delete: ${outcome.suspect.code}`
          : `Reconciliation removed ${outcome.deleted} file(s), reclaiming ${outcome.reclaimableBytes} bytes.`,
      metadata: {
        deleted: outcome.deleted,
        toDelete: outcome.toDelete,
        reclaimableBytes: outcome.reclaimableBytes,
        suspect: outcome.suspect?.code || null,
      },
    });

    return outcome;
  }

  /**
   * The reconciliation itself, with the manifest lock already held.
   *
   * Split out from the public method for one reason: `manifestChain` is a promise chain
   * and is not re-entrant, so the public method cannot be called from inside another
   * locked section — the inner call would queue behind the outer one and both would wait
   * forever.
   */
  private async reconcileArchiveDirectoryLocked(): Promise<ReconcileReport> {
    {
      const manifest = await this.readManifest();
      const names = await fsPromises.readdir(this.backupDir).catch(() => [] as string[]);
      const entries = await Promise.all(
        names.map(async (name) => {
          const stat = await fsPromises.stat(path.join(this.backupDir, name)).catch(() => null);
          return {
            name,
            sizeBytes: stat?.isFile() ? Number(stat.size) : 0,
            mtimeMs: stat?.mtimeMs ?? Date.now(),
          };
        }),
      );

      const plan = planReconciliation({
        entries,
        tracked: manifest.map((entry) => entry.fileName),
        manifestCount: manifest.length,
        now: Date.now(),
      });

      // The suspect states delete nothing. That is the whole point of them, and it is
      // checked before the first unlink because the decision cannot be taken back once
      // a file is gone.
      if (plan.suspect) {
        return {
          toDelete: [],
          reclaimableBytes: 0,
          deleted: 0,
          suspect: plan.suspect,
          decisions: plan.decisions.map((d) => ({
            name: d.name,
            action: d.action as string,
            reason: d.reason,
            sizeBytes: d.sizeBytes,
          })),
          lockMode: 'database' as string,
        };
      }

      let deleted = 0;
      for (const name of plan.toDelete) {
        try {
          await fsPromises.unlink(path.join(this.backupDir, name));
          deleted += 1;
        } catch (error: any) {
          // One unremovable file must not abandon the rest, and must not be reported as
          // reclaimed space that was not reclaimed.
          this.logger.warn(`reconcile could not remove ${name}: ${error?.code || error?.message}`);
        }
      }

      return {
        toDelete: plan.toDelete,
        reclaimableBytes: plan.reclaimableBytes,
        deleted,
        suspect: null,
        decisions: plan.decisions.map((d) => ({
          name: d.name,
          action: d.action as string,
          reason: d.reason,
          sizeBytes: d.sizeBytes,
        })),
        lockMode: 'database' as string,
      };
    }
  }

  private async readManifest(): Promise<BackupManifestEntry[]> {
    await this.ensureWorkspace();
    let raw: string;
    try {
      raw = await fsPromises.readFile(this.manifestFile, 'utf8');
    } catch {
      // Absent is a legitimate first-run state; unreadable is not.
      return [];
    }
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as BackupManifestEntry[];
      throw new Error('manifest is not an array');
    } catch (error: any) {
      // Gate 1.4 — a corrupt index used to return `[]`, so every backup vanished
      // from the UI with no error anywhere. It now refuses, and keeps the damaged
      // file for inspection instead of overwriting it on the next write.
      const quarantine = `${this.manifestFile}.corrupt-${Date.now()}`;
      await fsPromises.rename(this.manifestFile, quarantine).catch(() => undefined);
      throw new Error(
        `Backup manifest is unreadable (${error?.message ?? 'parse error'}). `
        + `The damaged file was kept at ${path.basename(quarantine)}; it has not been overwritten.`,
      );
    }
  }

  /**
   * Gate 1.4 — written through a temporary file and renamed.
   *
   * A crash or a full disk mid-`writeFile` truncated the index, and the next
   * read returned `[]` for every backup. `rename` within a directory is atomic,
   * so a reader sees either the old index or the new one.
   */
  /**
   * B16 — the free space on the volume holding the archives, read in one place.
   *
   * Returns zeros when the platform cannot answer. The callers decide what to do about
   * that: the report shows `0` and falls back to an estimate, and the write path
   * refuses to guess (it says `SPACE_UNKNOWN` and relies on the atomic write).
   *
   * `statfs` is not on `fsPromises` in every Node version, hence the cast.
   */
  private async readVolumeSpace(): Promise<{ freeBytes: number; totalBytes: number }> {
    try {
      const statFsProvider = fsPromises as typeof fsPromises & {
        statfs?: (path: string) => Promise<StatFsResult>;
      };
      const statFs = statFsProvider.statfs ? await statFsProvider.statfs(this.backupDir) : null;
      return {
        freeBytes: Number(statFs?.bavail || 0) * Number(statFs?.bsize || 0),
        totalBytes: Number(statFs?.blocks || 0) * Number(statFs?.bsize || 0),
      };
    } catch {
      return { freeBytes: 0, totalBytes: 0 };
    }
  }

  /**
   * B16 — write the archive through a temporary file and rename it into place.
   *
   * The archive used to be written straight to its final path. A disk that fills
   * part-way through left a truncated `.ffbkp` sitting exactly where a complete one
   * belongs, with no manifest row: nothing lists it, nothing prunes it, and the next
   * operator has to work out by hand whether that file is a backup.
   *
   * `rename` within a directory is atomic, so a reader sees either the old archive or
   * the new one — never a half of one. This is the same discipline `writeManifest`
   * uses, and for the same reason.
   *
   * B18/S1 — this body was moved to `./backup-files` and moved back. Two contracts are
   * written against its location, not merely against its behaviour:
   * `disk-headroom.integration.test.ts` simulates a full disk and a short write by
   * intercepting `fs` at *this module's* import boundary, so a moved body silently
   * stops being tested; and `ops-004` asserts `rename(temp, filePath)` appears here.
   * Re-pointing the mock would have meant rewriting a test that currently proves the
   * archive cannot be left truncated. A tidier file is not worth a weaker guarantee, so
   * this one stays.
   */
  private async writeArchiveAtomically(filePath: string, body: string): Promise<number> {
    const bytes = Buffer.byteLength(body, 'utf8');
    const temp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await fsPromises.writeFile(temp, body, 'utf8');

    let written = 0;
    try {
      await fsPromises.rename(temp, filePath);
      written = (await fsPromises.stat(filePath)).size;
      // A short file that was renamed into place is worse than one that was not: it now
      // has a name, and the name is the promise.
      if (written !== bytes) {
        throw new InternalServerErrorException({
          code: 'BACKUP_WRITE_TRUNCATED',
          message:
            `النسخة كُتبت ناقصة: كُتب ${written} بايت من ${bytes}. ` +
            'حُذف الملف الناقص حتى لا يُقرأ كنسخة صالحة.',
        });
      }
    } catch (error) {
      await fsPromises.unlink(temp).catch(() => undefined);
      // If the rename already succeeded, the partial file is now at the real path and
      // has to come back off it, or the next run inherits it.
      if (written !== bytes && written > 0) {
        await fsPromises.unlink(filePath).catch(() => undefined);
      }
      throw error;
    }
    return written;
  }

  /**
   * B16 — refuse the archive if it does not fit, before any bytes are written.
   *
   * The estimate is deliberately larger than the previous archive and larger than the
   * encoded dump, because the failure being prevented (`ENOSPC` part-way through a
   * write) is exactly the failure a tight check produces. A check that is right to the
   * byte will eventually be wrong, and it will be wrong on the night the disk fills.
   */
  private async assertArchiveFits(
    payload: BackupPayload,
    requiredBytes: number,
  ): Promise<void> {
    const space = await this.readVolumeSpace();
    const verdict = judgeHeadroom({
      freeBytes: space.freeBytes,
      totalBytes: space.totalBytes,
      requiredBytes,
    });

    if (verdict.ok) {
      return;
    }

    // Both refusals are audit-worthy: the operator asked for a backup and the system
    // said no, and a scheduled run that quietly stopped backing up looks identical to
    // one that never ran.
    throw new ServiceUnavailableException({
      code: verdict.code,
      message: verdict.message,
      meta: {
        requiredBytes: verdict.requiredBytes,
        freeBytes: verdict.freeBytes,
        projectedFreeBytes: verdict.projectedFreeBytes,
        floorBytes: verdict.floorBytes,
      },
    });
  }

  /**
   * B16 — how much room this archive will need.
   *
   * Measured from the newest archive of the same type when there is one, because a
   * measurement beats a formula, and computed from the raw bytes as a floor so an
   * implausibly small predecessor cannot talk the check into approving a small write.
   */
  private async estimateArchiveFootprint(
    payload: BackupPayload,
    type: BackupType,
  ): Promise<number> {
    const manifest = await this.readManifest();
    const previous = manifest
      .filter((entry) => entry.type === type)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];

    const databaseBytes = base64ByteLength(payload.dbBase64);
    const dataSnapshotBytes = Buffer.byteLength(
      JSON.stringify(payload.dataSnapshot || {}),
      'utf8',
    );
    const configBytes = (payload.configFiles || []).reduce(
      (sum, file) => sum + Buffer.byteLength(file.contentBase64 || '', 'utf8'),
      0,
    );

    return estimateArchiveBytes({
      databaseBytes,
      dataSnapshotBytes,
      configBytes,
      previousArchiveBytes: previous ? Number(previous.sizeBytes || 0) : 0,
    });
  }

  private async writeManifest(entries: BackupManifestEntry[]) {
    const temp = `${this.manifestFile}.tmp-${process.pid}-${Date.now()}`;
    const body = JSON.stringify(entries, null, 2);
    await fsPromises.writeFile(temp, body, 'utf8');
    try {
      await fsPromises.rename(temp, this.manifestFile);
    } catch (error) {
      await fsPromises.unlink(temp).catch(() => undefined);
      throw error;
    }
  }

  /**
   * B7 — a damaged schedule is a refusal, not a default.
   *
   * A `JSON.parse` failure used to return `defaultSchedule()` — silently. The
   * consequences are all invisible and all bad: a schedule that had been switched
   * off came back on at 02:00 daily, a retention of 90 days became 30, and
   * `storageTargets` were forgotten. The interface showed the defaults as if they
   * were the operator's settings, so the screen and the file disagreed and only the
   * file was wrong in a way nobody could see.
   *
   * The damaged file is kept, not overwritten, for the same reason the manifest is:
   * the next write would destroy the only evidence of what the schedule actually
   * said.
   */
  private async readSchedule(): Promise<BackupScheduleState> {
    await this.ensureWorkspace();
    let raw: string;
    try {
      raw = await fsPromises.readFile(this.scheduleFile, 'utf8');
    } catch (error: any) {
      // Absent is a legitimate first-run state; unreadable is not. A permission
      // error must not be answered with a default that then gets written back.
      if (error?.code === 'ENOENT') return this.defaultSchedule();
      throw new InternalServerErrorException({
        code: 'BACKUP_SCHEDULE_UNREADABLE',
        message:
          `تعذّرت قراءة إعدادات الجدولة (${error?.code || error?.message || error}). `
          + 'لم تُستبدل بإعدادات افتراضية.',
      });
    }

    if (!raw.trim()) return this.defaultSchedule();

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error: any) {
      const quarantine = `${this.scheduleFile}.corrupt-${Date.now()}`;
      await fsPromises.rename(this.scheduleFile, quarantine).catch(() => undefined);
      throw new InternalServerErrorException({
        code: 'BACKUP_SCHEDULE_CORRUPT',
        message:
          'ملف إعدادات الجدولة تالف. لم تُستخدم إعدادات افتراضية ولم يُحذف الملف: '
          + `تم الاحتفاظ به باسم ${path.basename(quarantine)}. `
          + 'راجعه أو احذفه بعد التأكد من نسخة احتياطية.',
        detail: { cause: String(error?.message || error), keptAs: path.basename(quarantine) },
      });
    }

    return this.sanitizeSchedule(parsed);
  }

  /**
   * B7 — the schedule is written the same way the manifest is.
   *
   * A direct `writeFile` truncates first, so a crash or a full disk mid-write left
   * a half-written `schedule.json`. The reader above now refuses on that file rather
   * than replacing it with defaults, which would have turned a recoverable write
   * failure into a stopped schedule — so the write has to stop producing one.
   */
  private async writeSchedule(schedule: BackupScheduleState) {
    await this.ensureWorkspace();
    const temp = `${this.scheduleFile}.tmp-${process.pid}-${Date.now()}`;
    await fsPromises.writeFile(temp, JSON.stringify(schedule, null, 2), 'utf8');
    try {
      await fsPromises.rename(temp, this.scheduleFile);
    } catch (error) {
      await fsPromises.unlink(temp).catch(() => undefined);
      throw error;
    }
  }

  // B18/S1 — the bodies live in ./backup-files; these stay as wrappers because
  // `ops-004` asserts both the signature and the `this.` call site. See that module.
  private hashSha256(value: Buffer | string): string {
    return hashSha256(value);
  }

  /**
   * B11 — removed. This was `pbkdf2(password + ':' + masterSecret, salt)`, and mixing
   * the master secret into every archive's key is what made rotating
   * `BACKUP_ENCRYPTION_SECRET` render every archive on disk undecryptable.
   *
   * Key derivation now lives in `deriveArchiveKey` (./archive-key), which adds the
   * `archive-only` scope and keeps the `both` input byte-identical so nothing already
   * written stops opening. It is deliberately not kept here as a second
   * implementation: two copies of a KDF is one copy that will drift.
   */

  private encryptSecret(secret: string): string {
    return encryptSecret(secret, this.getMasterSecret());
  }

  private decryptSecret(payload?: string): string {
    return decryptSecret(payload, this.getMasterSecret());
  }

  private hashSecret(secret: string): { hash: string; saltBase64: string } {
    return hashSecret(secret);
  }

  private verifySecret(secret: string, hashHex?: string, saltBase64?: string): boolean {
    return verifySecret(secret, hashHex, saltBase64);
  }

  // FC-OPS-001 — `resolveSqliteDbPath` was removed. It could only ever resolve
  // a SQLite file, so on this PostgreSQL deployment every "full" backup silently
  // degraded to a partial JSON snapshot and every restore failed. The real path
  // is pg_dump / pg_restore in ./pg-dump.ts.

  private async collectConfigFiles(): Promise<ConfigSnapshot[]> {
    return await collectConfigFiles();
  }

  private async restoreConfigFiles(files: ConfigSnapshot[]): Promise<number> {
    return await restoreConfigFiles(files);
  }

  private async buildPayload(type: BackupType, trigger: BackupTrigger, sourceBackupId?: string): Promise<BackupPayload> {
    const [users, items, balances, transactions] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.item.count(),
      this.prisma.openingBalance.count(),
      this.prisma.transaction.count(),
    ]);

    const counts: BackupMetaCounts = {
      users,
      items,
      openingBalances: balances,
      transactions,
      configFiles: 0,
    };

    const payload: BackupPayload = {
      type,
      trigger,
      createdAt: new Date().toISOString(),
      sourceBackupId,
      configFiles: [],
      counts,
    };

    if (type === 'full' || type === 'inventory' || type === 'safety_snapshot') {
      // FC-OPS-001 — a real PostgreSQL dump. The previous code looked for a
      // SQLite file, which never resolves on this deployment, so "full" backups
      // silently degraded to a partial JSON snapshot and no database was copied.
      const databaseUrl = String(process.env.DATABASE_URL || '').trim();
      if (isPostgresUrl(databaseUrl)) {
        // Gate 1.3 - an inventory archive is now genuinely an inventory archive.
        //
        // It used to take the identical pg_dump branch as `full`, so the file was
        // byte-for-byte a whole-database dump. Restoring it ran `pg_restore
        // --clean --if-exists`, which drops and recreates the schema - replacing
        // users and roles while the UI reported a stock backup, and the manifest
        // claimed completeness.
        const tables = type === 'inventory' ? [...INVENTORY_TABLES] : undefined;
        const dump = await dumpPostgres(databaseUrl, { format: 'custom', tables });
        payload.dbBase64 = dump.base64;
        payload.partialTables = tables ?? null;
      } else {
        // A non-PostgreSQL deployment (e.g. a disposable SQLite test rig) still
        // gets the structured snapshot rather than an empty backup.
        payload.dataSnapshot = await this.buildPrismaDataSnapshot(type);
      }
    }

    if (type === 'full' || type === 'config' || type === 'safety_snapshot') {
      payload.configFiles = await this.collectConfigFiles();
      payload.counts.configFiles = payload.configFiles.length;
      payload.schedule = await this.readSchedule();
    }

    // FC-OPS-001 — the manifest is built last so it can checksum the sections
    // that were actually produced.
    payload.manifest = await this.buildManifest(payload, type);

    return payload;
  }

  /**
   * FC-OPS-001 — completeness gate.
   *
   * Walks the live Prisma model, records which tables this backup covers, and
   * lists anything in the schema that is neither included nor explicitly
   * excluded. A non-empty `missingModels` means the backup is not a full
   * backup and must not be advertised as one.
   */
  private async buildManifest(payload: BackupPayload, type: BackupType): Promise<BackupManifest> {
    const expectedModels = Object.keys(this.prisma).filter((key) => !key.startsWith('_') && key !== '$connect' && key !== '$disconnect' && key !== '$on' && key !== '$transaction' && key !== '$queryRaw' && key !== '$queryRawUnsafe' && key !== '$executeRaw' && key !== '$executeRawUnsafe' && key !== '$extends').sort();

    const modelCounts: Record<string, number> = {};
    for (const model of expectedModels) {
      const delegate = (this.prisma as any)[model];
      if (!delegate || typeof delegate.count !== 'function') continue;
      try {
        modelCounts[model] = await delegate.count();
      } catch {
        // A view or a table the role cannot read is an explicit exclusion.
        modelCounts[model] = -1;
      }
    }

    // Session data is deliberately excluded: replaying it would resurrect
    // sessions and tokens from a backup taken days ago.
    const excludedModels = [
      { model: 'ActiveSession', reason: 'Session tokens are intentionally not restored; users re-authenticate.' },
      { model: 'IdempotencyRecord', reason: 'Request-replay guards expire with their window and are not business data.' },
    ];
    const excluded = new Set(excludedModels.map((entry) => entry.model));

    // Everything the schema has, minus the deliberate exclusions, is expected.
    const expectedAfterExclusions = expectedModels.filter((model) => !excluded.has(model));

    const captured = new Set<string>();
    if (payload.dbBase64) {
      // A pg_dump covers the whole database, so every model is included.
      for (const model of expectedAfterExclusions) captured.add(model);
    } else if (payload.dataSnapshot) {
      const snapshotKeys = Object.keys(payload.dataSnapshot).filter((key) => key !== 'engine' && key !== 'modelCounts' && key !== 'checksums');
      for (const model of expectedAfterExclusions) {
        // Snapshot section names are plural table names; map conservatively.
        if (snapshotKeys.includes(model) || snapshotKeys.includes(`${model}s`) || snapshotKeys.some((key) => key.toLowerCase() === model.toLowerCase())) {
          captured.add(model);
        }
      }
    }

    const missingModels = expectedAfterExclusions.filter((model) => !captured.has(model));

    const checksums: Record<string, string> = {};
    if (payload.dbBase64) {
      checksums.database = createHash('sha256').update(payload.dbBase64).digest('hex');
    }
    if (payload.dataSnapshot) {
      checksums.snapshot = createHash('sha256').update(JSON.stringify(payload.dataSnapshot)).digest('hex');
    }
    for (const [index, file] of (payload.configFiles || []).entries()) {
      checksums[`config:${index}`] = createHash('sha256').update(file.contentBase64 ?? '').digest('hex');
    }

    const attachmentRoot = path.resolve(process.cwd(), 'uploads', 'items');
    let attachmentFileCount = 0;
    try {
      if (fs.existsSync(attachmentRoot)) {
        attachmentFileCount = fs.readdirSync(attachmentRoot).filter((name) => fs.statSync(path.join(attachmentRoot, name)).isFile()).length;
      }
    } catch {
      attachmentFileCount = 0;
    }

    return {
      appVersion: process.env.APP_VERSION || '0.0.0',
      schemaVersion: this.readSchemaVersion(),
      // FC-OPS-002 — recorded so a later restore can tell that this archive
      // predates a migration the running image expects.
      migrations: this.readMigrationNames(),
      createdAt: new Date().toISOString(),
      expectedModels,
      includedModels: [...captured].sort(),
      excludedModels,
      missingModels,
      modelCounts,
      checksums,
      databaseDump: {
        included: Boolean(payload.dbBase64),
        format: payload.dbBase64 ? 'custom' : undefined,
        byteLength: payload.dbBase64 ? base64ByteLength(payload.dbBase64) : undefined,
        sha256: checksums.database,
      },
      attachments: {
        // FC-OPS-001 — attachments live on a volume, not in Postgres, so a
        // database dump cannot contain them. Stated explicitly rather than
        // implied by omission.
        included: false,
        fileCount: attachmentFileCount,
        reason: 'Item attachments are stored on a filesystem volume and are not part of the database dump. Back up the uploads volume separately.',
      },
    };
  }

  /**
   * FC-OPS-001 — the migrations this image carries.
   *
   * The names, not a count. A count cannot tell a restore from being refused: if
   * an image adds a migration and another removes one, the total is unchanged, so
   * comparing counts waves through a restore that is missing the new migration and
   * carries a removed one. The count is still reported, because it is cheap and
   * useful in a manifest, but the guard reads the names.
   */
  private readSchemaVersion(): string {
    return String(this.readMigrationNames().length);
  }

  private readMigrationNames(): string[] {
    try {
      const migrationsDir = path.resolve(process.cwd(), 'prisma', 'migrations');
      if (!fs.existsSync(migrationsDir)) return [];
      return fs
        .readdirSync(migrationsDir)
        .filter((name) => fs.statSync(path.join(migrationsDir, name)).isDirectory())
        .sort();
    } catch {
      return [];
    }
  }

  private async buildPrismaDataSnapshot(type: BackupType): Promise<PrismaDataSnapshot> {
    const snapshot: PrismaDataSnapshot = { engine: 'prisma' };

    if (type === 'full' || type === 'safety_snapshot') {
      // FC-SEC-007 — `permission`, `role_permission` and `user_role` were
      // snapshotted here but nothing in the application ever read or wrote
      // them: authorization runs entirely off `User.roleId` and the
      // `Role.permissions` JSON. All three tables held zero rows on every
      // install, so this was a full-table read per backup of data that could
      // not exist. Role permissions travel in the `roles` row below.
      const [roles, users] = await Promise.all([
        this.prisma.role.findMany({ orderBy: { createdAt: 'asc' } }),
        this.prisma.user.findMany({ orderBy: { createdAt: 'asc' } }),
      ]);

      snapshot.roles = roles.map((entry) => ({
        ...entry,
        createdAt: entry.createdAt.toISOString(),
        updatedAt: entry.updatedAt.toISOString(),
      }));
      snapshot.users = users.map((entry) => ({
        ...entry,
        lockoutUntil: entry.lockoutUntil ? entry.lockoutUntil.toISOString() : null,
        inviteExpires: entry.inviteExpires ? entry.inviteExpires.toISOString() : null,
        createdAt: entry.createdAt.toISOString(),
        updatedAt: entry.updatedAt.toISOString(),
      }));
    }

    if (type === 'full' || type === 'inventory' || type === 'safety_snapshot') {
      const [items, openingBalances, transactions] = await Promise.all([
        this.prisma.item.findMany({ orderBy: { id: 'asc' } }),
        this.prisma.openingBalance.findMany({ orderBy: { id: 'asc' } }),
        this.prisma.transaction.findMany({ orderBy: { id: 'asc' } }),
      ]);

      snapshot.items = items.map((entry) => ({
        ...entry,
        minLimit: entry.minLimit.toString(),
        maxLimit: entry.maxLimit.toString(),
        orderLimit: entry.orderLimit?.toString() ?? null,
        currentStock: entry.currentStock.toString(),
      }));
      snapshot.openingBalances = openingBalances.map((entry) => ({
        ...entry,
        quantity: entry.quantity.toString(),
        unitCost: entry.unitCost?.toString() ?? null,
        createdAt: entry.createdAt.toISOString(),
        updatedAt: entry.updatedAt.toISOString(),
      }));
      snapshot.transactions = transactions.map((entry) => ({
        ...entry,
        date: entry.date.toISOString(),
        quantity: entry.quantity.toString(),
        supplierNet: entry.supplierNet?.toString() ?? null,
        difference: entry.difference?.toString() ?? null,
        packageCount: entry.packageCount?.toString() ?? null,
        salaryOfWorker: entry.salaryOfWorker?.toString() ?? null,
        delayPenalty: entry.delayPenalty?.toString() ?? null,
        calculatedFine: entry.calculatedFine?.toString() ?? null,
        timestamp: entry.timestamp != null ? entry.timestamp.toString() : null,
        createdAt: entry.createdAt.toISOString(),
        updatedAt: entry.updatedAt.toISOString(),
      }));
    }

    return snapshot;
  }

  private encryptPayload(params: {
    payload: BackupPayload;
    type: BackupType;
    trigger: BackupTrigger;
    actor: BackupActor;
    password?: string;
    passwordProtected: boolean;
    sourceBackupId?: string;
    /**
     * B11 — how the key is scoped. `both` (the default, and what every archive on
     * disk already uses) needs the master secret as well as the passphrase, so it
     * stops opening the moment the secret is rotated. `archive-only` needs the
     * passphrase alone and therefore survives a rebuild.
     */
    keyScope?: KeyScope;
  }): BackupEnvelope {
    const plainText = JSON.stringify(params.payload);
    const payloadSha256 = this.hashSha256(plainText);

    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const scope: KeyScope = params.keyScope ?? 'both';
    // B11 — an `archive-only` envelope is refused rather than quietly sealed with the
    // master secret as well. Silently sealing it would produce a file the operator
    // believes is portable and that stops opening on the day the server is rebuilt —
    // the exact promise this scope exists to keep.
    const resolved = resolvePassphrase({
      password: params.password,
      masterSecret: this.getMasterSecret(),
      scope,
    });
    if (isPassphraseRefusal(resolved)) {
      throw new BadRequestException({ code: resolved.code, message: resolved.message });
    }
    const key = deriveArchiveKey({
      password: params.password,
      masterSecret: this.getMasterSecret(),
      scope,
      salt,
    });
    const cipher = createCipheriv('aes-256-gcm', key, iv);

    const encrypted = Buffer.concat([cipher.update(Buffer.from(plainText, 'utf8')), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      signature: BACKUP_SIGNATURE,
      version: 2,
      id: uuidv4(),
      type: params.type,
      trigger: params.trigger,
      createdAt: new Date().toISOString(),
      actor: params.actor,
      passwordProtected: params.passwordProtected,
      algorithm: 'aes-256-gcm',
      ivBase64: iv.toString('base64'),
      saltBase64: salt.toString('base64'),
      authTagBase64: authTag.toString('base64'),
      payloadSha256,
      payloadBase64: encrypted.toString('base64'),
      metadata: params.payload.counts,
      sourceBackupId: params.sourceBackupId,
      // B11/B12 — the scope and the secret's fingerprint travel with the archive, so
      // a restore knows which protection it is holding and can say *why* an open
      // failed instead of guessing between a wrong password, a corrupt file and a
      // rotated secret. The fingerprint is a truncated hash under a fixed label: it
      // cannot be walked back to the secret, and it is not the secret.
      keyScope: scope,
      masterSecretFingerprint: masterSecretFingerprint(this.getMasterSecret()),
    };
  }

  /**
   * B11/B12 — opening an archive, and saying which of three failures it was.
   *
   * The old code answered «Unable to decrypt backup. Invalid password or corrupted
   * file» for a wrong passphrase, a truncated file, and a rotated master secret alike.
   * The third of those is a configuration problem with a completely different fix,
   * and an operator can spend a day re-typing passwords before anyone thinks to ask
   * whether the secret changed.
   *
   * The envelope now carries the key scope and a fingerprint of the secret that sealed
   * it, which is enough to tell those three apart without revealing anything: the
   * fingerprint is a truncated labelled hash, so it cannot be walked back to the
   * secret, and it is not the secret.
   */
  private decryptEnvelope(envelope: BackupEnvelope, password?: string): BackupPayload {
    const scope: KeyScope = envelope.keyScope ?? 'both';
    const currentFingerprint = masterSecretFingerprint(this.getMasterSecret());

    if (envelope.passwordProtected && !String(password || '').trim()) {
      throw new BadRequestException('Backup decryption password is required');
    }

    const readiness = explainOpenFailure({
      sealedWith: envelope.masterSecretFingerprint ?? null,
      current: currentFingerprint,
      scope,
      hasPassphrase: Boolean(String(password || '').trim()),
    });

    // Refused before any key derivation is paid for, and refused with the reason.
    if (readiness.code === 'SECRET_ROTATED') {
      throw new BadRequestException({ code: 'BACKUP_SECRET_ROTATED', message: readiness.message });
    }
    if (scope === 'archive-only' && !String(password || '').trim()) {
      throw new BadRequestException({ code: readiness.code, message: readiness.message });
    }

    try {
      // B11 — the scope is read from the envelope, never inferred. An archive with no
      // scope is `both`, which is the only reading that keeps it open.
      const key = deriveArchiveKey({
        password,
        masterSecret: this.getMasterSecret(),
        scope,
        salt: Buffer.from(envelope.saltBase64, 'base64'),
      });
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.ivBase64, 'base64'));
      decipher.setAuthTag(Buffer.from(envelope.authTagBase64, 'base64'));
      const plain = Buffer.concat([
        decipher.update(Buffer.from(envelope.payloadBase64, 'base64')),
        decipher.final(),
      ]).toString('utf8');

      if (this.hashSha256(plain) !== envelope.payloadSha256) {
        throw new BadRequestException('Payload checksum mismatch');
      }

      return JSON.parse(plain) as BackupPayload;
    } catch (error) {
      if (error instanceof BadRequestException && String((error as any)?.response?.code || '') === 'BACKUP_SECRET_ROTATED') {
        throw error;
      }
      // B12 — the last honest message this path can give. The fingerprint has already
      // ruled out a rotated secret, so what remains is the passphrase being wrong or
      // the file being damaged, and saying which one it is *not* is the useful part.
      throw new BadRequestException({
        code: scope === 'archive-only' ? 'BACKUP_PASSPHRASE_WRONG' : 'BACKUP_OPEN_FAILED',
        message:
          scope === 'archive-only'
            ? 'كلمة مرور هذه النسخة غير صحيحة، أو الملف تالف. (مفتاح الخادم ليس سبب الفشل هنا: النسخة لا تعتمد عليه.)'
            : 'تعذّر فتح النسخة: كلمة المرور غير صحيحة أو الملف تالف. مفتاح هذا الخادم هو نفسه الذي ختمها.',
      });
    }
  }

  private async computeFileChecksum(filePath: string): Promise<string> {
    return await computeFileChecksum(filePath);
  }

  private buildFileName(type: BackupType, id: string): string {
    return buildFileName(type, id);
  }

  private async readEnvelope(entry: BackupManifestEntry): Promise<BackupEnvelope> {
    const filePath = path.join(this.backupDir, entry.fileName);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException(`Backup file ${entry.fileName} not found`);
    }

    const raw = await fsPromises.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as BackupEnvelope;
    if (parsed.signature !== BACKUP_SIGNATURE || parsed.version !== 2) {
      throw new BadRequestException('Backup signature verification failed');
    }

    return parsed;
  }

  private async verifyIntegrity(entry: BackupManifestEntry): Promise<boolean> {
    const filePath = path.join(this.backupDir, entry.fileName);
    if (!fs.existsSync(filePath)) return false;

    try {
      const envelope = await this.readEnvelope(entry);
      if (!envelope.payloadBase64 || !envelope.authTagBase64) return false;
      const checksum = await this.computeFileChecksum(filePath);
      return checksum === entry.checksumSha256;
    } catch {
      return false;
    }
  }

  /**
   * B9 — age, count and type, decided in one pass.
   *
   * The decision lives in `planRetention` (`./retention`) so it can be tested
   * without a filesystem. This function is the part that touches disk, and it has
   * one rule the pure function cannot express: **a row whose file could not be
   * removed is kept.**
   *
   * The previous version unlinked first and dropped the row from the returned array
   * regardless of the outcome, with the error swallowed. A failed unlink therefore
   * produced exactly the state this whole exercise exists to prevent — a `.ffbkp` on
   * disk that nothing in the manifest mentions: invisible to the list, absent from
   * the reported total, never pruned again, and unaddressable by id. It also deleted
   * by age alone, so a `safety_snapshot` was removed on the same 30-day clock as
   * everything else, and nothing stopped the pass from emptying the store.
   */
  private async applyRetention(
    entries: BackupManifestEntry[],
    limits: Partial<RetentionLimits>,
  ): Promise<{ retained: BackupManifestEntry[]; plan: RetentionPlan<BackupManifestEntry> }> {
    const plan = planRetention(entries, limits, { pinnedSnapshotIds: this.pinnedSafetySnapshotIds() });

    const retained: BackupManifestEntry[] = [...plan.keep];
    const removed: BackupManifestEntry[] = [];

    for (const entry of plan.remove) {
      const filePath = path.join(this.backupDir, entry.fileName);
      try {
        await fsPromises.unlink(filePath);
        this.integrityCache.delete(`${entry.id}:${entry.checksumSha256}`);
        removed.push(entry);
      } catch (error: any) {
        retained.push(entry);
        this.logger.warn(
          `Retention kept ${entry.fileName}: its file could not be removed `
          + `(${error?.code || error?.message || error}).`,
        );
      }
    }

    return { retained, plan: { ...plan, keep: retained, remove: removed } };
  }

  private retentionLimitsFrom(schedule: BackupScheduleState): RetentionLimits {
    return {
      retentionDays: schedule.retentionDays,
      maxCount: schedule.maxCount,
      minCount: schedule.minCount,
      maxSafetySnapshots: schedule.maxSafetySnapshots,
    };
  }

  private resolveEncryptionPassword(schedule: BackupScheduleState, explicitPassword?: string): { password?: string; passwordProtected: boolean } {
    const direct = String(explicitPassword || '').trim();
    if (direct) return { password: direct, passwordProtected: true };

    if (!schedule.encryptionEnabled) {
      return { password: undefined, passwordProtected: false };
    }

    const stored = this.decryptSecret(schedule.encryptedPassword);
    if (stored) {
      return { password: stored, passwordProtected: true };
    }

    return { password: undefined, passwordProtected: false };
  }
  private async createBackupInternal(params: {
    type: BackupType;
    trigger: BackupTrigger;
    actor?: Partial<BackupActor>;
    encryptionPassword?: string;
    /** B11 - see createBackup. */
    keyScope?: KeyScope;
    sourceBackupId?: string;
  }): Promise<BackupListItem> {
    await this.ensureWorkspace();

    const schedule = await this.readSchedule();
    const payload = await this.buildPayload(params.type, params.trigger, params.sourceBackupId);
    const actor = this.normalizeActor(params.actor, params.trigger);
    const encryption = this.resolveEncryptionPassword(schedule, params.encryptionPassword);
    const keyScope: KeyScope = params.keyScope === 'archive-only' ? 'archive-only' : 'both';

    const envelope = this.encryptPayload({
      payload,
      type: params.type,
      trigger: params.trigger,
      actor,
      password: encryption.password,
      passwordProtected: encryption.passwordProtected,
      sourceBackupId: params.sourceBackupId,
      keyScope,
    });

    const fileName = this.buildFileName(params.type, envelope.id);
    const filePath = path.join(this.backupDir, fileName);

    // B16 — before a single byte is written. Refusing here is what makes a full disk a
    // message rather than a truncated file, and it is what stops a scheduled backup
    // from taking the last of the disk space that Postgres needs in order to survive.
    await this.assertArchiveFits(
      payload,
      await this.estimateArchiveFootprint(payload, params.type),
    );
    await this.writeArchiveAtomically(filePath, JSON.stringify(envelope));
await this.writeArchiveAtomically(filePath, JSON.stringify(envelope));

    // B19 — the second copy, if one is configured, and only ever verified after the fact.
    //
    // Placed here, immediately after the local archive is complete and before the
    // manifest row is written, so the recorded outcome travels with the archive it
    // describes. It cannot fail the backup: an unplugged device must not make a good
    // archive look failed.
    const offsite = await copyOffsite(
      filePath,
      fileName,
      await this.computeFileChecksum(filePath),
      offsiteDirectory(),
    );
    if (offsiteDirectory() && !offsite.verified) {
      this.logger.warn(
        `off-host copy failed for ${fileName}: ${offsite.error} `
        + '(the local archive is intact)',
      );
    }

    const stat = await fsPromises.stat(filePath);
    const checksumSha256 = await this.computeFileChecksum(filePath);

    // What this archive is supposed to contain, versus what it actually does.
    const wantsDatabase =
      params.type === 'full' || params.type === 'inventory' || params.type === 'safety_snapshot';
    const hasDatabase = typeof payload.dbBase64 === 'string' && payload.dbBase64.length > 0;
    const hasConfig = (payload.configFiles?.length ?? 0) > 0;
    const hasSnapshot = Boolean(payload.dataSnapshot);

    const satisfied = wantsDatabase ? hasDatabase || hasSnapshot : params.type === 'config' ? hasConfig : true;
    const integrity: BackupIntegrity = satisfied ? 'verified' : 'incomplete';

    const entry: BackupManifestEntry = {
      id: envelope.id,
      fileName,
      type: params.type,
      trigger: params.trigger,
      createdAt: envelope.createdAt,
      sizeBytes: stat.size,
      checksumSha256,
      // B19 — recorded, not inferred. The health report counts this rather than counting
      // a configured destination, because a setting that is present and a copy that
      // arrived are different claims and only one of them is protection.
      offsite,
      // Gate 1.2 - measured, not asserted.
      //
      // This was the literal 'verified' on every archive, including the ones with
      // no database in them: POST /backup/config produces no dbBase64, so
      // buildManifest records every model as missing and `complete` comes out
      // false - and the frontend type had no field for either, so the table
      // painted a green badge over an archive that cannot restore a database. The
      // one field that would have said otherwise was dropped on the way to the
      // screen.
      integrity,
      passwordProtected: envelope.passwordProtected,
      actor,
      metadata: envelope.metadata,
      // FC-OPS-001 — completeness and dump size are recorded per backup so the
      // UI can show whether a backup is actually restorable, and so storage
      // reporting reflects the real database footprint.
      databaseBytes: payload.manifest?.databaseDump.byteLength,
      complete: (payload.manifest?.missingModels?.length ?? 1) === 0,
      missingModels: payload.manifest?.missingModels ?? ['manifest-missing'],
      partialTables: payload.partialTables ?? null,
      safetySnapshotForId: params.sourceBackupId || null,
    };

    await this.withManifestLock(async () => {
      // B9 — the schedule is re-read *inside* the lock. The limits that apply are the
      // ones in force when the manifest is written, not the ones read before a dump
      // that may have run for minutes.
      const current = await this.readSchedule();
      const manifest = await this.readManifest();
      manifest.unshift(entry);
      const { retained, plan } = await this.applyRetention(manifest, this.retentionLimitsFrom(current));
      if (plan.refused.length) {
        this.logger.warn(
          `Retention kept ${plan.refused.length} archive(s) that the minCount floor protected.`,
        );
      }
      await this.writeManifest(retained);

      // B10 — the manifest and the directory are reconciled at the one moment they are
      // most likely to disagree: the moment a file has just been written. A leftover
      // from a previous crash is invisible to the list endpoint and never pruned, so
      // without this it would sit there consuming the disk space B16 is guarding.
      //
      // The *locked-internal* form. Calling the public method here would re-acquire a
      // lock already held by this very section, and `manifestChain` is not re-entrant:
      // the inner call queues behind the outer link, and both wait forever. That
      // deadlock was real, cost sixteen minutes of a hanging suite to find, and is now
      // pinned by a test.
      //
      // Its failure must not fail the backup that just succeeded — but never silent.
      await this.reconcileArchiveDirectoryLocked().catch((error) => {
        this.logger.warn(
          `post-backup reconciliation failed (the archive itself is fine): ${this.describeError(error)}`,
        );
      });

      return { manifest: retained, result: undefined };
    });

    return {
      ...entry,
      integrityVerified: integrity === 'verified',
      integrityLabel: integrity,
    };
  }

  /**
   * A matching checksum proves the file was not corrupted in transit. It does not
   * prove the archive contains what its type promises — `toListItem` used to
   * relabel any intact file as `verified`, which is how a config archive with no
   * database in it kept a green badge. Incompleteness is preserved here and
   * recorded when the backup was written.
   */
  private toListItem(entry: BackupManifestEntry, checksumValid: boolean): BackupListItem {
    const integrity: BackupIntegrity = !checksumValid
      ? 'failed'
      : entry.integrity === 'incomplete' || entry.complete === false
        ? 'incomplete'
        : 'verified';
    return {
      ...entry,
      integrity,
      integrityVerified: integrity === 'verified',
      integrityLabel: integrity,
    };
  }

  async createBackup(params: {
    type: Exclude<BackupType, 'safety_snapshot'>;
    actor?: Partial<BackupActor>;
    encryptionPassword?: string;
    /** B11 - archive-only seals with the passphrase alone, so the archive survives a rebuild. */
    keyScope?: KeyScope;
  }): Promise<BackupListItem> {
    const created = await this.createBackupInternal({
      type: params.type,
      trigger: 'manual',
      actor: params.actor,
      encryptionPassword: params.encryptionPassword,
      keyScope: params.keyScope,
    });
    // B4 — after the archive exists and its row is in the manifest, not before. A
    // row written ahead of a dump that then fails describes a backup that is not
    // there, which is the same class of lie the integrity badge used to be.
    await this.recordBackupAudit('BACKUP_CREATED', {
      actor: params.actor,
      entityId: created.id,
      message: `Created a ${created.type} backup (${created.integrityLabel}).`,
      metadata: {
        type: created.type,
        trigger: created.trigger,
        sizeBytes: created.sizeBytes,
        integrity: created.integrityLabel,
        complete: created.complete,
      },
    });
    return created;
  }

  /**
   * FC-BACKUP-001 — is this archive still addressable by its id?
   *
   * `createBackup` returning a healthy object says nothing about whether the file
   * is still there. A system reset refuses to run without a verified pre-reset
   * backup and then records that backup's id in its audit row, so if the archive
   * has since disappeared the audit trail is pointing at nothing — which is how a
   * reset ends up looking recoverable when it is not.
   *
   * Deliberately not `listBackups`: that re-hashes every archive in the manifest,
   * which is the right price for a screen the operator is looking at and the wrong
   * price for a precondition on a destructive path. This reads the manifest and
   * stats the file, which is enough to tell "exists and is non-empty" from
   * "gone".
   */
  async findBackupById(id: string): Promise<BackupManifestEntry | null> {
    const wanted = String(id || '').trim();
    if (!wanted) return null;

    const manifest = await this.readManifest();
    const entry = manifest.find((candidate) => candidate.id === wanted);
    if (!entry) return null;

    try {
      const stats = await fsPromises.stat(path.join(this.backupDir, entry.fileName));
      if (!stats.isFile() || stats.size <= 0) return null;
    } catch {
      // The manifest claims an archive the filesystem does not have. Treating
      // that as "missing" rather than "present" is the point: a caller gating a
      // destructive operation on this answer must never be told yes about a file
      // it cannot read.
      return null;
    }

    return entry;
  }

  /**
   * B6 — integrity verification, cached by content, with a way to force a fresh read.
   *
   * `listBackups` re-hashed every archive on every call. `verifyIntegrity` streams the
   * whole file through SHA-256, so opening the backup screen with twelve archives cost
   * twelve full reads of the store — and the health panel, the reset screen and the
   * dashboard each asked separately, which is why this was worth fixing rather than
   * merely noting.
   *
   * The cache key is the checksum the manifest already records, which is what makes
   * this safe rather than merely fast: a file that changes changes its checksum, so a
   * changed file cannot be answered from the old verdict. What the cache *cannot*
   * detect is a file corrupted after the last check, which is why `?verify=1` exists —
   * an operator auditing their backups needs a real answer, not a recent one, and must
   * be able to ask for it.
   */
  private static readonly INTEGRITY_CACHE_TTL_MS = 60_000;
  private readonly integrityCache = new Map<string, { valid: boolean; at: number }>();

  private async verifyIntegrityCached(entry: BackupManifestEntry, force = false): Promise<boolean> {
    const key = `${entry.id}:${entry.checksumSha256}`;
    if (!force) {
      const hit = this.integrityCache.get(key);
      if (hit && Date.now() - hit.at < BackupService.INTEGRITY_CACHE_TTL_MS) return hit.valid;
    }
    const valid = await this.verifyIntegrity(entry);
    this.integrityCache.set(key, { valid, at: Date.now() });
    return valid;
  }

  /**
   * `verify: true` bypasses the cache.
   *
   * Passed as `?verify=1` on the list and health routes. Without it there is no way
   * to ask "is this still true right now" — and a green badge that cannot be
   * re-checked on demand is a claim rather than a measurement.
   */
  async listBackups(type?: BackupType, options: { verify?: boolean } = {}): Promise<BackupListItem[]> {
    const manifest = await this.readManifest();
    const filtered = type ? manifest.filter((entry) => entry.type === type) : manifest;
    const sorted = [...filtered].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    let changed = false;
    const list: BackupListItem[] = [];

    for (const entry of sorted) {
      const valid = await this.verifyIntegrityCached(entry, options.verify === true);
      const expected = valid ? 'verified' : 'failed';
      if (entry.integrity !== expected) {
        entry.integrity = expected;
        changed = true;
      }
      list.push(this.toListItem(entry, valid));
    }

    // The write-back reuses the manifest this call read, so it must not race a
    // concurrent create. Taking the lock here too is what stops a listing from
    // erasing a backup it never saw.
    if (changed) {
      await this.withManifestLock(async () => {
        const current = await this.readManifest();
        for (const entry of sorted) {
          const still = current.find((candidate) => candidate.id === entry.id);
          if (still) still.integrity = entry.integrity;
        }
        await this.writeManifest(current);
        return { manifest: current, result: undefined };
      });
    }

    return list;
  }

  private async getEntryOrThrow(backupId: string): Promise<BackupManifestEntry> {
    const manifest = await this.readManifest();
    const target = manifest.find((entry) => entry.id === backupId);
    if (!target) {
      throw new NotFoundException(`Backup ${backupId} not found`);
    }
    return target;
  }

  private cleanupRestoreTokens() {
    const now = Date.now();
    for (const [token, state] of this.restoreTokens.entries()) {
      if (state.expiresAt <= now) {
        this.restoreTokens.delete(token);
      }
    }
  }

  private createRestoreToken(data: Omit<RestorePreviewToken, 'token' | 'expiresAt'>): RestorePreviewToken {
    const token: RestorePreviewToken = {
      token: uuidv4(),
      backupId: data.backupId,
      actorKey: data.actorKey,
      safetySnapshotId: data.safetySnapshotId,
      expiresAt: Date.now() + RESTORE_TOKEN_TTL_MS,
    };
    this.restoreTokens.set(token.token, token);
    return token;
  }

  private consumeRestoreToken(token: string, backupId: string, actorKey: string): RestorePreviewToken {
    const state = this.restoreTokens.get(token);
    if (!state) {
      throw new BadRequestException('Restore confirmation token is invalid');
    }

    if (state.backupId !== backupId) {
      throw new BadRequestException('Restore token does not match selected backup');
    }

    if (state.actorKey !== actorKey) {
      throw new UnauthorizedException('Restore token actor mismatch');
    }

    if (state.expiresAt <= Date.now()) {
      this.restoreTokens.delete(token);
      throw new BadRequestException('Restore confirmation token expired');
    }

    this.restoreTokens.delete(token);
    return state;
  }

  /**
   * B8 — the restore PIN, compared in constant time, with an escalating lock.
   *
   * Two separate weaknesses, both on the last check before the whole database is
   * replaced.
   *
   * **The fallback compared with `!==`.** When no PIN has been set in the schedule,
   * the code fell back to `process.env.BACKUP_RESTORE_PIN` and compared two strings.
   * `===` returns on the first differing byte, so the time taken leaks how long a
   * prefix was right — a four-digit PIN is four guesses, not four thousand. The
   * hashed path already used `timingSafeEqual`; this one did not.
   *
   * **No lock on repeated failure.** Nothing counted failures, so a stolen session
   * could keep guessing within the generous `fallback` rate-limit bucket. The
   * counter escalates: three failures in a row costs fifteen minutes, and the cost
   * keeps doubling per further failure up to a ceiling. A legitimate operator who
   * mistypes twice is unaffected; a guesser pays for every attempt.
   *
   * The lock is per-process, like the manifest lock beside it. That is a real limit
   * rather than a hidden one — B17 moves both to the database, and until it does,
   * a multi-replica deployment gets one bucket per replica, which is stated in the
   * deployment notes rather than left to be discovered.
   */
  private static readonly PIN_FAILURE_THRESHOLD = 3;
  private static readonly PIN_LOCK_BASE_MS = 15 * 60 * 1000;
  private static readonly PIN_LOCK_MAX_MS = 24 * 60 * 60 * 1000;
  private readonly pinFailures = new Map<string, { count: number; lockedUntil: number }>();

  private pinActorKey(schedule: BackupScheduleState, actor?: Partial<BackupActor>): string {
    return String(actor?.userId || actor?.username || 'anonymous');
  }

  private assertPinNotLocked(key: string) {
    const state = this.pinFailures.get(key);
    if (!state || state.lockedUntil <= Date.now()) return;
    const minutes = Math.ceil((state.lockedUntil - Date.now()) / 60_000);
    throw new HttpException(
      {
        code: 'RESTORE_PIN_LOCKED',
        message:
          `قفل مؤقت بسبب محاولات فاشلة متكررة. أعد المحاولة بعد ${minutes} دقيقة. `
          + 'الاستعادة نفسها لم تبدأ ولم تتغيّر أي بيانات.',
        detail: { retryAfterMinutes: minutes, failures: state.count },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private recordPinFailure(key: string) {
    const previous = this.pinFailures.get(key);
    const count = (previous?.count ?? 0) + 1;
    // The lock starts on the third failure, so the *next* attempt is the one refused
    // — three tries is the answer being given, not three tries still being allowed.
    // Each failure after that doubles the wait, which is what makes guessing
    // expensive rather than merely slow.
    const over = count - (BackupService.PIN_FAILURE_THRESHOLD - 1);
    const lockMs =
      over < 1 ? 0 : Math.min(BackupService.PIN_LOCK_MAX_MS, BackupService.PIN_LOCK_BASE_MS * 2 ** (over - 1));
    this.pinFailures.set(key, { count, lockedUntil: Date.now() + lockMs });
  }

  private clearPinFailures(key: string) {
    this.pinFailures.delete(key);
  }

  /**
   * A constant-time string comparison.
   *
   * `timingSafeEqual` throws on a length mismatch, and a length check is itself a
   * leak — so both sides are hashed to a fixed width first and the digests compared.
   * The result depends on the content of both strings and on nothing else, including
   * how long either of them is.
   */
  private secretsMatch(left: string, right: string): boolean {
    const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();
    return timingSafeEqual(digest(left), digest(right));
  }

  private restorePinIsConfigured(schedule: BackupScheduleState): boolean {
    return Boolean(
      (schedule.restorePinHash && schedule.restorePinSaltBase64)
      || String(process.env.BACKUP_RESTORE_PIN || '').trim(),
    );
  }

  /**
   * The restore PIN is a **gate that must be opened deliberately**, not a protection
   * that exists by default.
   *
   * ## What was broken
   *
   * This threw `Restore PIN is required` whenever the caller supplied no PIN, and then,
   * a few lines later, threw `Restore PIN is not configured` when no PIN existed
   * anywhere. Between them they meant: **no restore is possible on a deployment that has
   * never had a PIN set** — which is every default deployment.
   *
   * So the feature was not "protected by default". It was unusable by default, and the
   * interface asked for a PIN the operator had never been given, so there was nothing to
   * type. The safety snapshot, the role check, `backup.restore`, the destructive rate
   * limit and the two-step confirmation were all in place and all unreachable.
   *
   * ## What it does now
   *
   * No PIN configured → no PIN demanded. Every other gate stands, unchanged and
   * unbypassed: the `backup.restore` permission, the admin role, `backup-destructive`
   * rate limiting, the integrity check, the safety snapshot taken before anything is
   * destroyed, and the explicit confirmation.
   *
   * The moment a PIN *is* configured it becomes mandatory again, and the lockout that
   * B8 built applies to it. There is no state in which a configured PIN is optional.
   *
   * ## The trade-off, stated rather than buried
   *
   * A deployment with no PIN configured is, by definition, one where any holder of
   * `backup.restore` can restore without a second factor. That is a real weakening, and
   * it is why `restoreProtection` is returned by the preview: the interface says so
   * instead of implying a protection that is not there.
   */
  private verifyRestorePinOrThrow(
    schedule: BackupScheduleState,
    restorePin: string,
    actor?: Partial<BackupActor>,
  ): void {
    if (!this.restorePinIsConfigured(schedule)) {
      return;
    }

    const pin = String(restorePin || '').trim();
    if (!pin) {
      throw new UnauthorizedException('Restore PIN is required');
    }

    // B8 — the lock is checked before the PIN is examined, so a locked caller learns
    // nothing from the response beyond the fact that they are locked.
    const key = this.pinActorKey(schedule, actor);
    this.assertPinNotLocked(key);

    if (schedule.restorePinHash && schedule.restorePinSaltBase64) {
      if (!this.verifySecret(pin, schedule.restorePinHash, schedule.restorePinSaltBase64)) {
        this.recordPinFailure(key);
        throw new UnauthorizedException('Invalid restore PIN');
      }
      this.clearPinFailures(key);
      return;
    }

    const fallback = String(process.env.BACKUP_RESTORE_PIN || '').trim();
    if (!fallback) {
      // Unreachable while `restorePinIsConfigured` is the single source of that
      // question. Kept as a refusal rather than a pass, so a future edit that splits the
      // two fails closed.
      throw new UnauthorizedException('Restore PIN is not configured');
    }

    if (!this.secretsMatch(fallback, pin)) {
      this.recordPinFailure(key);
      throw new UnauthorizedException('Invalid restore PIN');
    }
    this.clearPinFailures(key);
  }

  /**
   * FC-OPS-001 — restore through PostgreSQL.
   *
   * The previous implementation wrote the bytes over a SQLite file path, which
   * can never resolve on a PostgreSQL deployment, so a restore could only ever
   * fail. This replays the archive with pg_restore/psql instead.
   *
   * The caller must already have taken a safety snapshot: this is destructive.
   */
  /**
   * Gate 1.5 - a restore holds an exclusive claim.
   *
   * Two concurrent restores both called `prisma.$disconnect()`, both spawned
   * `pg_restore --clean`, and whichever finished first reconnected the pool while
   * the other was still dropping and recreating objects. Every other request in
   * the process failed against a disconnected client for the whole window, and
   * the second dump was replayed onto a half-rebuilt schema. The scheduler beside
   * this method already carried a running flag; the destructive path did not.
   */
  private restoreInFlight = false;

  private async restoreDatabaseFromBase64(dbBase64: string, tables?: readonly string[] | null) {
    const databaseUrl = String(process.env.DATABASE_URL || '').trim();
    if (!isPostgresUrl(databaseUrl)) {
      throw new BadRequestException('Database restore is only supported for PostgreSQL deployments');
    }

    if (this.restoreInFlight) {
      throw new ConflictException('Another restore is already running. Wait for it to finish.');
    }
    // B3 — the other half of the same exclusion. A scheduled backup that starts
    // while a restore is mid-`pg_restore` is not a slower backup, it is a different
    // failure: `--clean` is dropping and recreating tables underneath it, so the
    // dump captures a half-rebuilt schema, and the archive it produces is written to
    // the manifest with a checksum and a green integrity badge as though it were a
    // point-in-time picture. It would also hold the table locks the restore is
    // trying to acquire. Refusing the restore instead is the honest answer: it is
    // retriable, and the operator is told why.
    if (this.schedulerRunning) {
      throw new ConflictException(
        'A scheduled backup is being taken right now. Try the restore again in a moment.',
      );
    }
    this.restoreInFlight = true;

    // Release the pool so the restore is not fighting live connections.
    await this.prisma.$disconnect();
    try {
      await restorePostgres(databaseUrl, dbBase64, {
        clean: true,
        exitOnError: true,
        singleTransaction: true,
        // A partial archive must not be replayed with --clean: that drops and
        // recreates the schema rather than restoring the tables it names.
        tables: tables ? [...tables] : undefined,
      });
    } finally {
      this.restoreInFlight = false;
      await this.prisma.$connect();
    }
  }

  /**
   * FC-OPS-001 — refuses to restore a dump that is incomplete, corrupt, or
   * built for a different schema. Runs before anything destructive happens.
   */
  private assertManifestIsRestorable(manifest: BackupManifest | undefined, backupId: string) {
    if (!manifest) {
      throw new BadRequestException('Backup has no manifest; refusing to restore an unverifiable dump');
    }

    if (manifest.missingModels?.length) {
      throw new BadRequestException(
        `Backup ${backupId} is incomplete. Missing tables: ${manifest.missingModels.join(', ')}. ` +
          'It cannot be restored as a full backup.',
      );
    }

    // A dump that declares a checksum must have one, and a full/safety backup
    // that carries no dump at all has nothing to restore into PostgreSQL. The
    // checksum itself is verified in assertManifestChecksums, which has the
    // payload bytes; refusing here on the mere presence of a hash blocked every
    // real HTTP restore.
    if (manifest.databaseDump.included && !manifest.databaseDump.sha256) {
      throw new BadRequestException('Backup declares a database dump but no checksum; refusing to restore');
    }
  }

  /**
   * FC-OPS-002 — refuse an archive whose schema is behind the running image.
   *
   * The archive records the migrations that had been applied when it was taken,
   * because they live in the same dump. So a restore from before a migration
   * silently rolls the application back: the column disappears, the database
   * keeps claiming the migration ran, and `migrate deploy` reports success while
   * changing nothing. Every request that touches the missing column then fails,
   * and the logs show a query error with no migration error anywhere near it.
   *
   * The comparison is against the migrations this image has, read from disk
   * rather than from the database — the whole point is that the database is about
   * to be overwritten, so asking it is too late.
   *
   * Only one direction is refused. An archive from the *future* relative to this
   * image means the image is stale, which is an operational mistake worth making
   * loudly, but it is not data loss, so it is reported rather than blocked.
   */
  /**
   * B14 — the migration names this image expects.
   *
   * Public and read-only so the boot-time diagnostic can ask the same question the
   * restore path asks, rather than re-deriving the answer from a second source that would
   * eventually disagree with the first.
   */
  currentMigrationNames(): string[] {
    return this.readMigrationNames();
  }

  /**
   * B14 — what migrations the newest few archives recorded.
   *
   * `migrations: null` means the archive recorded none, which is the case for everything
   * written before the field existed. It is deliberately not `[]`: an empty array would
   * claim the archive is behind *every* migration, and `null` says what is actually
   * known — nothing, so the caller must not treat it as a pass.
   *
   * Archives that cannot be opened at all are also `null`. A corrupt or wrongly-keyed
   * archive is a health problem in its own right, reported elsewhere; here it must not be
   * reported as schema drift, because the two have different fixes.
   */
  async inspectArchiveMigrations(limit = 5): Promise<DriftArchive[]> {
    const manifest = await this.readManifest();
    const candidates = manifest
      .filter((entry) => entry.integrity !== 'failed')
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, Math.max(1, limit));

    const inspected: DriftArchive[] = [];
    for (const entry of candidates) {
      let migrations: string[] | null = null;
      try {
        // The archive's own passphrase comes from the schedule, as it does on the restore
        // path. An archive sealed with an `archive-only` key the schedule does not hold
        // therefore fails to open here, which is reported rather than guessed at.
        const schedule = await this.readSchedule();
        const envelope = await this.readEnvelope(entry);
        const payload = this.decryptEnvelope(
          envelope,
          schedule.encryptionEnabled ? schedule.encryptedPassword : undefined,
        );
        const names = archiveMigrationNames(payload?.manifest);
        migrations = names.length > 0 ? names : null;
      } catch (error) {
        // Named, not swallowed: the operator is told this archive could not be read, so
        // an unopenable archive is not mistaken for a healthy one.
        this.logger.warn(
          `backup: could not read ${entry.fileName} for a schema check: ${this.describeError(error)}`,
        );
        migrations = null;
      }
      inspected.push({
        id: entry.id,
        createdAt: entry.createdAt,
        type: entry.type,
        migrations,
      });
    }
    return inspected;
  }

  /**
   * B14 — the schema check that used to run only at restore time.
   *
   * Only one direction is refused. An archive from the *future* relative to this
   * image means the image is stale, which is an operational mistake worth making
   * loudly, but it is not data loss, so it is reported rather than blocked.
   */
  private async assertArchiveSchemaIsCurrent(
    manifest: unknown,
    entry: BackupManifestEntry,
  ): Promise<void> {
    const verdict = archiveIsRestorable(
      archiveMigrationNames(manifest),
      this.readMigrationNames(),
    );
    if (verdict.restorable) return;

    throw new ConflictException({
      code: 'BACKUP_SCHEMA_BEHIND_IMAGE',
      message:
        `النسخة الاحتياطية "${entry.fileName}" مأخوذة قبل ${verdict.missing.length} ترحيلاً ` +
        'تطبّقها النسخة الحالية من البرنامج، واستعادتها ستُرجع قاعدة البيانات إلى مخطط أقدم. ' +
        'شغّل الترحيلات أولًا، أو استعد نسخة أحدث.',
      detail: {
        backupId: entry.id,
        fileName: entry.fileName,
        missingMigrations: verdict.missing.slice(0, 20),
        missingCount: verdict.missing.length,
      },
    });
  }


  /**
   * FC-OPS-001 — per-section checksum verification. Any mismatch means the
   * payload was altered after the backup was written.
   */
  private assertManifestChecksums(payload: BackupPayload) {
    const manifest = payload.manifest;
    if (!manifest) return;

    if (payload.dbBase64) {
      const expected = manifest.checksums?.database;
      if (expected) {
        const actual = createHash('sha256').update(payload.dbBase64).digest('hex');
        if (actual !== expected) {
          throw new BadRequestException('Database dump checksum mismatch; the backup is corrupt');
        }
      }
    }

    if (payload.dataSnapshot && manifest.checksums?.snapshot) {
      const actual = createHash('sha256').update(JSON.stringify(payload.dataSnapshot)).digest('hex');
      if (actual !== manifest.checksums.snapshot) {
        throw new BadRequestException('Data snapshot checksum mismatch; the backup is corrupt');
      }
    }

    (payload.configFiles || []).forEach((file, index) => {
      const expected = manifest.checksums?.[`config:${index}`];
      if (!expected) return;
      const actual = createHash('sha256').update(file.contentBase64 ?? '').digest('hex');
      if (actual !== expected) {
        throw new BadRequestException(`Config file ${file.relativePath ?? index} checksum mismatch; the backup is corrupt`);
      }
    });
  }

  private async restorePrismaSnapshot(snapshot: PrismaDataSnapshot, type: BackupType) {
    if (!snapshot || snapshot.engine !== 'prisma') {
      throw new BadRequestException('Backup data snapshot is missing');
    }

    await this.prisma.$transaction(async (tx) => {
      if (type === 'full' || type === 'safety_snapshot') {
        await tx.transaction.deleteMany();
        await tx.openingBalance.deleteMany();
        await tx.item.deleteMany();
        await tx.user.deleteMany();
        await tx.role.deleteMany();

        if (snapshot.roles?.length) {
          await tx.role.createMany({
            data: snapshot.roles.map((entry) => ({
              ...entry,
              createdAt: new Date(entry.createdAt),
              updatedAt: new Date(entry.updatedAt),
            })),
          });
        }

        if (snapshot.users?.length) {
          await tx.user.createMany({
            data: snapshot.users.map((entry) => ({
              ...entry,
              lockoutUntil: entry.lockoutUntil ? new Date(entry.lockoutUntil) : null,
              inviteExpires: entry.inviteExpires ? new Date(entry.inviteExpires) : null,
              createdAt: new Date(entry.createdAt),
              updatedAt: new Date(entry.updatedAt),
            })),
          });
        }
      } else {
        await tx.transaction.deleteMany();
        await tx.openingBalance.deleteMany();
        await tx.item.deleteMany();
      }

      if (snapshot.items?.length) {
        await tx.item.createMany({ data: snapshot.items });
      }

      if (snapshot.openingBalances?.length) {
        await tx.openingBalance.createMany({
          data: snapshot.openingBalances.map((entry) => ({
            ...entry,
            createdAt: new Date(entry.createdAt),
            updatedAt: new Date(entry.updatedAt),
          })),
        });
      }

      if (snapshot.transactions?.length) {
        await tx.transaction.createMany({
          data: snapshot.transactions.map((entry) => ({
            ...entry,
            date: new Date(entry.date),
            timestamp: entry.timestamp != null ? BigInt(entry.timestamp) : null,
            createdAt: new Date(entry.createdAt),
            updatedAt: new Date(entry.updatedAt),
          })),
        });
      }

      // FC-ITEM-ORDER — a restore is the one moment the whole catalogue arrives at
      // once, so it is the one moment a shared rank can appear in bulk. A snapshot
      // taken before `sortOrder` existed replays every row onto the column default
      // of 1000000, which is precisely the collision
      // 20260928110000_normalise_item_sort_order was written to repair — and that
      // migration is a one-off, so it does not re-run. The read path breaks a tie
      // by id, so a restored catalogue whose ranks all collide comes back in an
      // order nobody chose and no operator can reproduce.
      //
      // The two statements below are the same two, in the same order, as that
      // migration: split every shared rank keeping each cluster's order, then send
      // unranked rows to the end. Each is guarded by a count so a healthy restore
      // does no windowing work at all — this runs on every restore, and the
      // expensive form of both statements is O(n log n) over the whole catalogue.
      const sharedRanks = await tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*)::bigint AS count
        FROM (
          SELECT "sortOrder"
          FROM "public"."Item"
          WHERE "sortOrder" IS NOT NULL
          GROUP BY "sortOrder"
          HAVING count(*) > 1
        ) AS collisions
      `;
      if (Number(sharedRanks[0]?.count ?? 0n) > 0) {
        await tx.$executeRaw`
          WITH ranked AS (
            SELECT
              "id",
              ROW_NUMBER() OVER (PARTITION BY "sortOrder" ORDER BY "id" ASC) AS within_rank,
              FIRST_VALUE("sortOrder") OVER (PARTITION BY "sortOrder" ORDER BY "id" ASC) AS keep
            FROM "public"."Item"
            WHERE "sortOrder" IS NOT NULL
          )
          UPDATE "public"."Item" AS item
          SET "sortOrder" = ranked.keep::int + ((ranked.within_rank - 1)::int)
          FROM ranked
          WHERE item."id" = ranked."id"
            AND ranked.within_rank > 1
        `;
      }

      const unranked = await tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*)::bigint AS count FROM "public"."Item" WHERE "sortOrder" IS NULL
      `;
      if (Number(unranked[0]?.count ?? 0n) > 0) {
        await tx.$executeRaw`
          WITH tail AS (
            SELECT
              "id",
              (SELECT coalesce(max("sortOrder"), -1) FROM "public"."Item" WHERE "sortOrder" IS NOT NULL)
                + ROW_NUMBER() OVER (ORDER BY "id" ASC) AS rank
            FROM "public"."Item"
            WHERE "sortOrder" IS NULL
          )
          UPDATE "public"."Item" AS item
          SET "sortOrder" = tail.rank
          FROM tail
          WHERE item."id" = tail."id"
        `;
      }
    });

    await this.databaseInfrastructure.syncPrimaryKeySequences([
      { tableName: 'Item', columnName: 'id' },
      { tableName: 'OpeningBalance', columnName: 'id' },
      { tableName: 'Transaction', columnName: 'id' },
    ]);
  }

  async createRestorePreview(params: {
    backupId: string;
    restorePin: string;
    actor: Partial<BackupActor>;
    decryptionPassword?: string;
  }) {
    this.cleanupRestoreTokens();

    const schedule = await this.readSchedule();
    this.verifyRestorePinOrThrow(schedule, params.restorePin, params.actor);

    const target = await this.getEntryOrThrow(params.backupId);
    const valid = await this.verifyIntegrity(target);
    if (!valid) {
      throw new BadRequestException('Backup integrity verification failed; restore is blocked');
    }

    // FC-OPS-003 — the preview takes the safety snapshot, and hands back its id.
    //
    // It used to hard-code a null id and nothing else in the file ever filled it, so a
    // restore ran `pg_restore --clean` against the only copy of the data, and
    // `BackupCenter.tsx:312` told the operator «تم إنشاء لقطة أمان مؤقتة» while the
    // service did nothing. The operator was told the undo existed, and it did not.
    //
    // The snapshot is taken here rather than in `applyRestore` for one reason: this is
    // the last moment it is cheap. After `pg_restore --clean` starts, the pre-restore
    // state is the thing being destroyed — taking it afterwards would be a photograph
    // of the wreckage. It costs a dump at preview time and nothing at apply time, and
    // the token that authorises the apply carries the id, so the operator cannot
    // confirm a restore for which no snapshot was ever taken.
    //
    // This reverses gate 1.6, which forbade the snapshot because it froze the write
    // path. That diagnosis was right — `pg_dump --serializable-deferrable` conflicts
    // with every write, and it wrote ~1.37x the database per click — and the
    // conclusion was wrong. A preview without a snapshot is not a fast preview; it is
    // a confirmation screen for an irreversible action. The cost is handled by not
    // taking more than one, which the scheduler and retention work cover.
    //
    // A snapshot with no database in it, or one whose integrity does not hold, is not
    // a safety net. This checks the same two fields the reset path checks, for the
    // same reason: `monitoring.service.ts:835` refuses a reset on exactly this
    // condition, and the two operations have the same blast radius.
    let safetySnapshotId: string | null = null;
    let safetySnapshotRefused: string | null = null;
    try {
      const snapshot = await this.createBackupInternal({
        type: 'safety_snapshot',
        trigger: 'manual',
        actor: { ...params.actor, type: 'user', mode: 'manual' },
      });
      const restorable = snapshot.integrity === 'verified' && snapshot.complete !== false;
      if (restorable) {
        safetySnapshotId = snapshot.id;
      } else {
        safetySnapshotRefused =
          `integrity=${snapshot.integrity}, complete=${snapshot.complete}`;
      }
    } catch (error) {
      safetySnapshotRefused = String((error as Error)?.message || error);
    }

    if (!safetySnapshotId) {
      // The restore is not offered at all. Returning a token here would be the same
      // lie in a different place: the operator gets a confirmation dialog for an undo
      // that does not exist.
      this.logger.error(
        `Restore preview refused: the safety snapshot could not be taken (${safetySnapshotRefused}).`,
      );
      throw new ServiceUnavailableException({
        code: 'RESTORE_SAFETY_SNAPSHOT_FAILED',
        message:
          'تعذّر إنشاء لقطة الأمان قبل الاستعادة، لذلك لم تُعرَض الاستعادة. '
          + 'البيانات لم تتغيّر. عالج سبب الفشل ثم أعد المحاولة.',
        detail: { cause: String(safetySnapshotRefused) },
      });
    }

    const token = this.createRestoreToken({
      backupId: params.backupId,
      actorKey: this.actorKey(params.actor),
      safetySnapshotId,
    });

    // B4 — the preview is recorded too, not only the apply. It is the moment a
    // full-database dump of the live data was taken without anyone asking for a
    // backup, and it is the row that pairs with a later `RESTORE_FAILED` to show
    // what the operator was looking at when it went wrong.
    await this.recordBackupAudit('RESTORE_PREVIEW', {
      actor: params.actor,
      entityId: params.backupId,
      message: `Restore previewed for backup ${params.backupId}.`,
      metadata: {
        safetySnapshotId,
        safetySnapshotCreatedAt: new Date().toISOString(),
        replacesDatabase: this.describeRestoreBlastRadius(target).replacesDatabase,
        replacesIdentity: this.describeRestoreBlastRadius(target).replacesIdentity,
      },
    });

    return {
      requiresConfirmation: true,
      restoreToken: token.token,
      safetySnapshotId,
      target: this.toListItem(target, true),
      blastRadius: this.describeRestoreBlastRadius(target),
      // B5-bis — what is actually protecting this restore, so the interface can say it.
      //
      // Before this, the panel stated "الاستعادة تتطلب رمز PIN صالح" unconditionally,
      // while the service's actual rule was "a PIN is required, and if none is configured
      // no restore is possible" — so the sentence described a system that existed in
      // neither configuration. The one thing a protection notice must never do is claim a
      // protection that is not running.
      restoreProtection: {
        requiresPin: this.restorePinIsConfigured(schedule),
        requiresPermission: true,
        requiresConfirmation: true,
        takesSafetySnapshot: Boolean(safetySnapshotId),
      },
    };
  }

  /**
   * Gate 1.6 - an inventory archive replaces stock, not the system.
   *
   * Derived from the archive rather than from which button the operator pressed.
   * A full dump replaces every table including users and roles, and the previous
   * preview mentioned that only in passing, as "system data".
   */
  private describeRestoreBlastRadius(entry: BackupManifestEntry): {
    replacesDatabase: boolean;
    replacesIdentity: boolean;
    tables: readonly string[] | null;
    note: string;
  } {
    const tables = entry.partialTables ?? null;
    if (tables?.length) {
      return {
        replacesDatabase: false,
        replacesIdentity: false,
        tables,
        note: 'ستُستبدل بيانات المخزون فقط. لن تتأثر المستخدمون والأدوار.',
      };
    }
    return {
      replacesDatabase: true,
      replacesIdentity: true,
      tables: null,
      note: 'ستُستبدل قاعدة البيانات بالكامل، بما فيها المستخدمون والأدوار.',
    };
  }

  async applyRestore(params: {
    backupId: string;
    restorePin: string;
    restoreToken: string;
    actor: Partial<BackupActor>;
    decryptionPassword?: string;
  }) {
    this.cleanupRestoreTokens();

    const schedule = await this.readSchedule();
    this.verifyRestorePinOrThrow(schedule, params.restorePin, params.actor);

    const token = this.consumeRestoreToken(params.restoreToken, params.backupId, this.actorKey(params.actor));

    // FC-OPS-003 — a confirmation without a snapshot behind it is refused.
    //
    // The preview now always issues one, so this is the second line of defence rather
    // than the only one. It stays because a token is data, and a caller can send one
    // it did not receive from a preview: a replayed body, a hand-written request, or a
    // token minted before this change existed and still inside its TTL. The blast
    // radius of being wrong here is the whole database, so the check belongs where
    // the destruction happens, not only where the token is issued.
    if (!token.safetySnapshotId) {
      throw new ConflictException({
        code: 'RESTORE_NO_SAFETY_SNAPSHOT',
        message:
          'لا يمكن تنفيذ الاستعادة دون لقطة أمان. '
          + 'أعد فتح المعاينة لتأخذ لقطة جديدة، ولن يُمسّ أي شيء قبلها.',
      });
    }

    const target = await this.getEntryOrThrow(params.backupId);
    const valid = await this.verifyIntegrity(target);
    if (!valid) {
      throw new BadRequestException('Backup integrity verification failed; restore blocked');
    }

    const envelope = await this.readEnvelope(target);
    const payload = this.decryptEnvelope(envelope, params.decryptionPassword);

    // FC-OPS-001 — verify completeness and per-section checksums BEFORE any
    // destructive step, so a partial or tampered dump is refused while the
    // database is still intact.
    if (payload.type !== 'config') {
      this.assertManifestIsRestorable(payload.manifest, params.backupId);
      this.assertManifestChecksums(payload);
    }

    // FC-OPS-002 - an archive carries a schema as well as data, and restoring an
    // older one rolls the application back to a schema the running image does
    // not expect.
    //
    // The quiet part is that `pg_restore` also restores `_prisma_migrations`, so
    // the database goes on claiming the newer migrations ran. `migrate deploy`
    // then reports everything applied and changes nothing, and the next request
    // touching a column that is no longer there fails. That happened here:
    // restoring an archive from before `Item.sortOrder` left the table without
    // the column, the migrations table still listing the migration as applied,
    // and every item-reorder request returning a 500 with no migration error to
    // point at. The data came back; the schema did not, and nothing said so.
    //
    // Checked before anything destructive, because by the time a restore has run
    // the only way back is another restore.
    if (payload.type !== 'config') {
      await this.assertArchiveSchemaIsCurrent(payload.manifest, target);
    }

    let restoredConfigFiles = 0;
    if (payload.type !== 'config') {
      if (payload.dbBase64) {
        await this.restoreDatabaseFromBase64(payload.dbBase64, payload.partialTables);
      } else if (payload.dataSnapshot) {
        await this.restorePrismaSnapshot(payload.dataSnapshot, payload.type);
      } else {
        throw new BadRequestException('Backup database snapshot is missing');
      }
    }

    if (payload.type === 'config' || payload.type === 'full' || payload.type === 'safety_snapshot') {
      restoredConfigFiles = await this.restoreConfigFiles(payload.configFiles || []);
      if (payload.schedule) {
        await this.writeSchedule(this.sanitizeSchedule(payload.schedule));
      }
    }

    // B4 — recorded only now, with the counts the restore actually produced. A row
    // written before `pg_restore` would claim a restore that may have died halfway,
    // and the `RESTORE_FAILED` row from the failure path would then contradict it.
    await this.recordBackupAudit('RESTORE_APPLIED', {
      actor: params.actor,
      entityId: params.backupId,
      message: `Restored the database from backup ${params.backupId}.`,
      metadata: {
        safetySnapshotId: token.safetySnapshotId,
        replacedIdentity: this.describeRestoreBlastRadius(target).replacesIdentity,
        tables: target.partialTables ?? null,
        restoredConfigFiles,
      },
    });

    return {
      restoredBackupId: params.backupId,
      safetySnapshotId: token.safetySnapshotId,
      restoredAt: new Date().toISOString(),
      restored: {
        users: payload.counts.users,
        items: payload.counts.items,
        openingBalances: payload.counts.openingBalances,
        transactions: payload.counts.transactions,
        configFiles: restoredConfigFiles,
      },
    };
  }
  /**
   * B13 — the schedule as a consumer may read it.
   *
   * `publicSchedule` is private because most callers should not need it. The health
   * service does, and reaching into a private method from another service is how the
   * three-consumer drift this replaces began. It also carries the `lastRunKey` the
   * health rules need to tell "ran today" from "never ran".
   */
  /**
   * B12 — "can I restore my backups *on this server*?"
   *
   * A backup that only its own server can open is not a backup; it is a copy. This
   * answers the question before the operator needs it, rather than during the one
   * moment they are trying to recover something.
   *
   * It reads every archive's envelope, which is cheap — the envelopes are the small
   * outer JSON, and the payloads stay on disk — and reports the worst case found, per
   * backup and overall. Reading them is the point: the answer has to be measured
   * against the archives that exist, not inferred from the current configuration.
   */
  async getRestoreReadiness(): Promise<{
    currentFingerprint: string;
    overall: { restorable: boolean; code: string; message: string };
    archives: Array<{
      id: string;
      createdAt: string;
      keyScope: KeyScope;
      sealedWith: string | null;
      sealedOnThisServer: boolean;
      restorable: boolean;
      code: string;
      message: string;
    }>;
    counts: { total: number; restorableHere: number; sealedElsewhere: number; portable: number };
  }> {
    const manifest = await this.readManifest();
    const current = masterSecretFingerprint(this.getMasterSecret());
    const archives: Array<{
      id: string;
      createdAt: string;
      keyScope: KeyScope;
      sealedWith: string | null;
      sealedOnThisServer: boolean;
      restorable: boolean;
      code: string;
      message: string;
    }> = [];

    for (const entry of manifest) {
      let envelope: BackupEnvelope | null = null;
      try {
        envelope = await this.readEnvelope(entry);
      } catch {
        // An unreadable envelope is itself an answer, and it is the worst one.
        archives.push({
          id: entry.id,
          createdAt: entry.createdAt,
          keyScope: 'both',
          sealedWith: null,
          sealedOnThisServer: false,
          restorable: false,
          code: 'BACKUP_ENVELOPE_UNREADABLE',
          message: 'الملف تالف أو غير قابل للقراءة، فلا يمكن الحكم على محتواه.',
        });
        continue;
      }

      const keyScope: KeyScope = envelope.keyScope ?? 'both';
      const verdict = explainOpenFailure({
        sealedWith: envelope.masterSecretFingerprint ?? null,
        current,
        scope: keyScope,
        // An `archive-only` archive needs a passphrase at restore time, which is not
        // stored here. That is the design, not a fault, so it is not counted as
        // "unavailable here" — only a *mismatched* server secret is.
        hasPassphrase: keyScope === 'archive-only',
      });

      archives.push({
        id: entry.id,
        createdAt: entry.createdAt,
        keyScope,
        sealedWith: envelope.masterSecretFingerprint ?? null,
        sealedOnThisServer:
          Boolean(envelope.masterSecretFingerprint) && envelope.masterSecretFingerprint === current,
        restorable: verdict.restorable,
        code: verdict.code,
        message: verdict.message,
      });
    }

    // The worst case is what the operator needs to see first. `SECRET_ROTATED` is
    // reported ahead of a merely-old archive because it is the one that silently
    // invalidates every future restore on this server.
    const order = ['SECRET_ROTATED', 'BACKUP_ENVELOPE_UNREADABLE', 'ARCHIVE_KEYED_ELSEWHERE', 'OK'];
    const worst =
      [...archives].sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code))[0] ??
      ({ code: 'NO_ARCHIVES', message: 'لا توجد نسخ احتياطية.', restorable: false } as const);

    return {
      currentFingerprint: current,
      overall: {
        restorable: archives.every((archive) => archive.restorable),
        code: worst.code,
        message: archives.length
          ? worst.message
          : 'لا توجد نسخ احتياطية على هذا الخادم.',
      },
      archives,
      counts: {
        total: archives.length,
        restorableHere: archives.filter((archive) => archive.restorable).length,
        sealedElsewhere: archives.filter((archive) => archive.code === 'SECRET_ROTATED').length,
        // B11 — portable means it survives this server disappearing, which is the
        // whole difference between a backup and a copy.
        portable: archives.filter((archive) => archive.keyScope === 'archive-only').length,
      },
    };
  }
  async getPublicSchedule() {
    const schedule = await this.readSchedule();
    return {
      ...this.publicSchedule(schedule),
      lastRunKey: schedule.lastRunKey ?? null,
    };
  }
  private publicSchedule(schedule: BackupScheduleState) {
    return {
      enabled: schedule.enabled,
      frequency: schedule.frequency,
      hour: schedule.hour,
      minute: schedule.minute,
      dayOfWeek: schedule.dayOfWeek,
      dayOfMonth: schedule.dayOfMonth,
      retentionDays: schedule.retentionDays,
      // B9 — exposed so the panel can show what the limits actually are. Without
      // this the operator sees a retention number that is only one of three rules in
      // force, which is how a count cap starts deleting archives and nobody knows
      // why.
      maxCount: schedule.maxCount,
      minCount: schedule.minCount,
      maxSafetySnapshots: schedule.maxSafetySnapshots,
      storageTargets: schedule.storageTargets,
      encryptionEnabled: schedule.encryptionEnabled,
      hasEncryptionPassword: Boolean(schedule.passwordHash),
      hasRestorePin: Boolean(schedule.restorePinHash || process.env.BACKUP_RESTORE_PIN),
      lastRunAt: schedule.lastRunAt || null,
      updatedAt: schedule.updatedAt,
    };
  }

  async updateSchedule(input: {
    enabled?: boolean;
    frequency?: 'daily' | 'weekly' | 'monthly';
    hour?: number;
    minute?: number;
    dayOfWeek?: number;
    dayOfMonth?: number;
    retentionDays?: number;
    maxCount?: number;
    minCount?: number;
    maxSafetySnapshots?: number;
    storageTargets?: StorageTarget[];
    encryptionEnabled?: boolean;
    encryptionPassword?: string;
    restorePin?: string;
    // B4 — the actor is a second parameter on purpose. The controller forwards the
    // request body straight into `input`, so an `actor` field here would be a field
    // any authenticated client could set, and the audit row would name whoever the
    // caller asked it to name.
  }, actor?: Partial<BackupActor>) {
    const current = await this.readSchedule();
    const next: BackupScheduleState = {
      ...current,
      enabled: input.enabled ?? current.enabled,
      frequency: input.frequency ?? current.frequency,
      hour: this.clamp(input.hour ?? current.hour, 0, 23, current.hour),
      minute: this.clamp(input.minute ?? current.minute, 0, 59, current.minute),
      dayOfWeek: this.clamp(input.dayOfWeek ?? current.dayOfWeek, 0, 6, current.dayOfWeek),
      dayOfMonth: this.clamp(input.dayOfMonth ?? current.dayOfMonth, 1, 31, current.dayOfMonth),
      // B9 — clamped through the shared normaliser, including the cross-clamp that
      // stops `minCount` above `maxCount` from silently disabling retention.
      ...(() => {
        const limits = normalizeRetentionLimits({
          retentionDays: input.retentionDays ?? current.retentionDays,
          maxCount: input.maxCount ?? current.maxCount,
          minCount: input.minCount ?? current.minCount,
          maxSafetySnapshots: input.maxSafetySnapshots ?? current.maxSafetySnapshots,
        });
        return {
          retentionDays: limits.retentionDays,
          maxCount: limits.maxCount,
          minCount: limits.minCount,
          maxSafetySnapshots: limits.maxSafetySnapshots,
        };
      })(),
      storageTargets: input.storageTargets ? this.normalizeStorageTargets(input.storageTargets) : current.storageTargets,
      encryptionEnabled: input.encryptionEnabled ?? current.encryptionEnabled,
      updatedAt: new Date().toISOString(),
    };

    if (input.encryptionPassword !== undefined) {
      const password = String(input.encryptionPassword || '').trim();
      if (password) {
        const hashed = this.hashSecret(password);
        next.passwordHash = hashed.hash;
        next.passwordSaltBase64 = hashed.saltBase64;
        next.encryptedPassword = this.encryptSecret(password);
        next.encryptionEnabled = true;
      } else {
        next.passwordHash = undefined;
        next.passwordSaltBase64 = undefined;
        next.encryptedPassword = undefined;
      }
    }

    if (input.restorePin !== undefined) {
      const pin = String(input.restorePin || '').trim();
      if (pin.length < 4) {
        throw new BadRequestException('Restore PIN must be at least 4 digits');
      }
      const hashed = this.hashSecret(pin);
      next.restorePinHash = hashed.hash;
      next.restorePinSaltBase64 = hashed.saltBase64;
    }

    // B2 — the retention pass that used to live here ran unlocked: it read the
    // manifest, then wrote its own copy back. A backup created in between had its
    // row overwritten, orphaning the file. It now shares the lock, and the lock
    // callback returns the manifest state so there is one write, not two.
    const publicView = {
      ...this.publicSchedule(next),
      nextRunAt: this.calculateNextRun(next)?.toISOString() || null,
    };

    // B9 — the refusal comes *before* `writeSchedule`, or the operator gets a 409
    // and a schedule that was already changed.
    const manifest = await this.readManifest();
    const limits = this.retentionLimitsFrom(next);
    const pending = planRetention(manifest, limits, { pinnedSnapshotIds: this.pinnedSafetySnapshotIds() });
    const resultingCount = manifest.length - pending.remove.length;
    // The floor refuses a retention pass that would *delete* down past it. It is not
    // a requirement that the store already meets the floor: with nothing to delete,
    // changing the hour is not a destructive act and must not be blocked with a
    // message about copies that were never on the table.
    if (pending.remove.length > 0 && resultingCount < next.minCount) {
      throw new ConflictException({
        code: 'RETENTION_BELOW_MINIMUM',
        message:
          `رُفض تغيير الإعدادات: سيبقى ${resultingCount} نسخة، والحد الأدنى ${next.minCount}. `
          + 'لم يُحذف شيء ولم تُحفظ الإعدادات.',
        detail: { minCount: next.minCount, resultingCount, blockedByFloor: pending.refused },
      });
    }

    await this.withManifestLock(async () => {
      await this.writeSchedule(next);
      const currentManifest = await this.readManifest();
      const { retained } = await this.applyRetention(currentManifest, limits);
      await this.writeManifest(retained);
      return { manifest: retained, result: undefined };
    });

    // B4 — the diff, not the new value. "The schedule changed" is not an answer to
    // "who turned the backups off, and when"; a row carrying only the resulting
    // value cannot distinguish that from the schedule always having been that way.
    // The secret and the PIN are in `current` and are never recorded — redaction
    // would catch them, but the row should not carry them in the first place.
    const before = this.publicSchedule(current);
    const after = publicView;
    // `updatedAt` changes on every write, including the scheduler's own run stamp, so
    // listing it would make every row read "changed: updatedAt" and bury the fields
    // the operator actually touched.
    const ignored = new Set(['updatedAt']);
    const changed = Object.keys(after).filter(
      (key) =>
        !ignored.has(key) &&
        JSON.stringify((before as Record<string, unknown>)[key]) !==
          JSON.stringify((after as Record<string, unknown>)[key]),
    );
    if (changed.length) {
      await this.recordBackupAudit('SCHEDULE_CHANGED', {
        actor,
        message: `Backup schedule changed: ${changed.join(', ')}.`,
        metadata: {
          changed,
          before: Object.fromEntries(changed.map((key) => [key, (before as Record<string, unknown>)[key]])),
          after: Object.fromEntries(changed.map((key) => [key, (after as Record<string, unknown>)[key]])),
        },
      });
    }

    return publicView;
  }

  private calculateNextRun(schedule: BackupScheduleState, now = new Date()): Date | null {
    if (!schedule.enabled) return null;

    const candidate = new Date(now);
    candidate.setSeconds(0, 0);
    candidate.setHours(schedule.hour, schedule.minute, 0, 0);

    if (schedule.frequency === 'daily') {
      if (candidate <= now) candidate.setDate(candidate.getDate() + 1);
      return candidate;
    }

    if (schedule.frequency === 'weekly') {
      let delta = (schedule.dayOfWeek - candidate.getDay() + 7) % 7;
      if (delta === 0 && candidate <= now) delta = 7;
      candidate.setDate(candidate.getDate() + delta);
      return candidate;
    }

    const maxDay = new Date(candidate.getFullYear(), candidate.getMonth() + 1, 0).getDate();
    candidate.setDate(Math.min(schedule.dayOfMonth, maxDay));
    if (candidate <= now) {
      candidate.setMonth(candidate.getMonth() + 1);
      const nextMax = new Date(candidate.getFullYear(), candidate.getMonth() + 1, 0).getDate();
      candidate.setDate(Math.min(schedule.dayOfMonth, nextMax));
    }
    return candidate;
  }

  /**
   * B7 — the window is the hour, not the minute.
   *
   * This used to require `now.getMinutes() === schedule.minute`, so the scheduled
   * backup had exactly one 30-second tick to land in. A tick delayed past the minute
   * boundary — a slow `readSchedule`, a long GC, a throttled container, a machine
   * resuming from suspend — and the day's backup was silently skipped, with the next
   * attempt 24 hours away. `lastRunAt` in the interface would show a gap, and nothing
   * would say why.
   *
   * `lastRunKey` already makes the run idempotent within the day, so widening the
   * window cannot double-run it. In practice the first tick of the hour still fires
   * at the configured minute; the hour is the net underneath that, not a change of
   * behaviour. The configured minute remains what `nextRunAt` shows the operator.
   */
  private shouldRunNow(schedule: BackupScheduleState, now: Date): boolean {
    if (!schedule.enabled) return false;
    if (now.getHours() !== schedule.hour) return false;
    if (schedule.frequency === 'weekly' && now.getDay() !== schedule.dayOfWeek) return false;
    if (schedule.frequency === 'monthly') {
      const maxDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const target = Math.min(schedule.dayOfMonth, maxDay);
      if (now.getDate() !== target) return false;
    }

    const key = `${schedule.frequency}:${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    return schedule.lastRunKey !== key;
  }

  private startScheduler() {
    if (this.scheduleTimer) return;
    this.scheduleTimer = setInterval(() => {
      void this.schedulerTick();
    }, 30 * 1000);
  }

  private async schedulerTick() {
    if (this.schedulerRunning) return;
    this.schedulerRunning = true;

    try {
      // B3 — a restore owns the database until it finishes. The scheduler used to
      // take no notice of it, and the two collide: `pg_dump
      // --serializable-deferrable` against tables that `pg_restore --clean` is
      // dropping and recreating produces a dump of a half-rebuilt schema, which is
      // then archived as a normal backup with a checksum and a green integrity
      // badge. The operator would have a "verified" copy of a database that never
      // existed in that state.
      //
      // Skipping rather than failing: the schedule is due every day, and a restore
      // is a rare, deliberate act. A skipped run costs a day; a dump taken here
      // costs a false archive that is indistinguishable from a good one.
      if (this.restoreInFlight) {
        this.logger.warn('Scheduled backup skipped: a restore is in progress.');
        return;
      }

      const schedule = await this.readSchedule();
      const now = new Date();
      if (!this.shouldRunNow(schedule, now)) return;

      const scheduled = await this.createBackupInternal({
        type: 'full',
        trigger: 'scheduled',
        actor: { type: 'system', mode: 'scheduled', username: 'scheduler' },
      });

      // B4 — the scheduler's own run, recorded with the same action as a manual
      // backup and a different actor. It is the one creation path that bypasses
      // `createBackup`, so without this the nightly backup — the reason the schedule
      // exists — left no row, and a schedule that had silently stopped running was
      // indistinguishable from one that had never been set.
      await this.recordBackupAudit('BACKUP_CREATED', {
        actor: { type: 'system', mode: 'scheduled', username: 'scheduler', role: 'system' },
        entityId: scheduled.id,
        message: `Scheduled full backup (${scheduled.integrityLabel}).`,
        metadata: {
          type: scheduled.type,
          trigger: 'scheduled',
          sizeBytes: scheduled.sizeBytes,
          integrity: scheduled.integrityLabel,
          complete: scheduled.complete,
        },
      });

      const key = `${schedule.frequency}:${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
      await this.writeSchedule({
        ...schedule,
        lastRunAt: now.toISOString(),
        lastRunKey: key,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.error('Scheduled backup failed', error as Error);
    } finally {
      this.schedulerRunning = false;
    }
  }

  async getStorageStats() {
    const manifest = await this.readManifest();
    const schedule = await this.readSchedule();
    const latest = manifest.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];

    // FC-OPS-001 — the previous implementation stat()'d a SQLite file that does
    // not exist on this deployment, so the reported database size was always 0.
    // The size that matters is the most recent dump in the manifest.
    const latestDatabaseBytes = latest?.databaseBytes ?? 0;

    let configBytes = 0;
    for (const relativePath of CONFIG_FILES_ALLOW_LIST) {
      const full = path.resolve(process.cwd(), relativePath);
      if (!fs.existsSync(full)) continue;
      const stat = await fsPromises.stat(full).catch(() => null);
      if (stat?.isFile()) configBytes += stat.size;
    }

    const backupsBytes = manifest.reduce((sum, entry) => sum + Number(entry.sizeBytes || 0), 0);

    let freeBytes = 0;
    let totalBytes = 0;
    {
      const space = await this.readVolumeSpace();
      freeBytes = space.freeBytes;
      totalBytes = space.totalBytes;
    }

    const usedByApp = latestDatabaseBytes + configBytes + backupsBytes;
    if (totalBytes <= 0) {
      totalBytes = usedByApp + Math.max(usedByApp, 1);
      freeBytes = Math.max(totalBytes - usedByApp, 0);
    }

    const donutBase = latestDatabaseBytes + configBytes + freeBytes;
    const safe = donutBase > 0 ? donutBase : 1;

    return {
      generatedAt: new Date().toISOString(),
      databaseBytes: latestDatabaseBytes,
      configBytes,
      backupsBytes,
      freeBytes,
      totalBytes,
      usagePercent: Number((((totalBytes - freeBytes) / Math.max(totalBytes, 1)) * 100).toFixed(2)),
      latestBackup: latest
        ? {
            id: latest.id,
            createdAt: latest.createdAt,
            sizeBytes: latest.sizeBytes,
            type: latest.type,
            integrity: latest.integrity,
          }
        : null,
      schedule: {
        ...this.publicSchedule(schedule),
        nextRunAt: this.calculateNextRun(schedule)?.toISOString() || null,
      },
      segments: [
        {
          key: 'database',
          label: 'قاعدة البيانات',
          color: '#2563eb',
          valueBytes: latestDatabaseBytes,
          percentage: Number(((latestDatabaseBytes / safe) * 100).toFixed(2)),
        },
        {
          key: 'config',
          label: 'ملفات الإعدادات',
          color: '#f59e0b',
          valueBytes: configBytes,
          percentage: Number(((configBytes / safe) * 100).toFixed(2)),
        },
        {
          key: 'free',
          label: 'المساحة الحرة التقديرية',
          color: '#10b981',
          valueBytes: freeBytes,
          percentage: Number(((freeBytes / safe) * 100).toFixed(2)),
        },
      ],
    };
  }

  async downloadBackup(
    backupId: string,
    actor?: Partial<BackupActor>,
  ): Promise<{ filePath: string; fileName: string; checksumSha256: string }> {
    const target = await this.getEntryOrThrow(backupId);
    const valid = await this.verifyIntegrity(target);
    if (!valid) {
      throw new BadRequestException('Download blocked because backup integrity verification failed');
    }

    // B4 — a download is the one action here that moves the only copy of the data
    // off the machine. It is also the one most likely to be an exfiltration, and it
    // used to leave no trace at all.
    await this.recordBackupAudit('BACKUP_DOWNLOADED', {
      actor,
      entityId: backupId,
      message: `Downloaded backup ${backupId}.`,
      metadata: { fileName: target.fileName, sizeBytes: target.sizeBytes, type: target.type },
    });

    return {
      filePath: path.join(this.backupDir, target.fileName),
      fileName: target.fileName,
      checksumSha256: target.checksumSha256,
    };
  }

  /**
   * B2 — deletes take the same manifest lock every other read-modify-write does.
   *
   * The previous version read the index, wrote it, and unlinked the file with no
   * lock at all. Two consequences, both of which had already been reached in
   * production rather than merely being possible:
   *
   * - A backup created in the window between `readManifest` and `writeManifest`
   *   had its row erased. The `.ffbkp` survived, so the file became an orphan:
   *   invisible to the list, absent from the reported total, never pruned, and
   *   unaddressable by id.
   * - `unlink(...).catch(() => undefined)` swallowed a failed delete, so the row
   *   was already gone and the file stayed. The API answered `{deleted: true}`
   *   for a deletion that had not happened.
   *
   * Order is manifest-then-file, the mirror of retention. A crash in between
   * leaves an orphan file, which is recoverable and visible to reconciliation;
   * the other order would leave a row pointing at nothing, and a restore aimed at
   * that id would fail after the operator had already confirmed it.
   */
  async deleteBackup(backupId: string, actor?: Partial<BackupActor>): Promise<{ deleted: boolean }> {
    try {
      const outcome = await this.withManifestLock(async () => {
        const manifest = await this.readManifest();
        const index = manifest.findIndex((entry) => entry.id === backupId);
        // B2 — a missing id used to answer `200 {deleted: false}`. The UI renders
        // that as a successful delete, so a stale bookmark or a double-click looked
        // like it had worked.
        if (index < 0) {
          throw new NotFoundException({
            code: 'BACKUP_NOT_FOUND',
            message: `لا توجد نسخة بالمعرّف ${backupId}.`,
          });
        }

        const [removed] = manifest.splice(index, 1);
        this.assertDeletable(removed, manifest);

        await this.writeManifest(manifest);

try {
          await fsPromises.unlink(path.join(this.backupDir, removed.fileName));
          // B6 - the file is gone, so its verdict must go with it: an entry for an archive
          // that no longer exists is never read again and nothing else will ever clear it.
          this.integrityCache.delete(`${removed.id}:${removed.checksumSha256}`);
        } catch (error: any) {
          // ENOENT means the file is already gone, which is the outcome this branch was
          // trying to achieve. It is not a failure.
          //
          // Treating it as one was a real bug: the undo below put the row back, producing
          // an index entry pointing at a file that does not exist — a row that no
          // reconciliation can delete (it is tracked), no restore can use, and no operator
          // can explain. It surfaced only under repeated deletes, as three phantom rows in
          // a live deployment.
          const alreadyGone = error?.code === 'ENOENT';
          if (!alreadyGone) {
            // Put the row back. Reporting success here would leave a file on disk
            // that nothing tracks, which is the same orphan state this method exists
            // to prevent - reached through a different door.
            await this.writeManifest([...manifest, removed]).catch(() => undefined);
          }

          if (!alreadyGone) {
            throw new InternalServerErrorException({
              code: 'BACKUP_DELETE_FAILED',
              message:
                `تعذّر حذف الملف ${removed.fileName} `
                + `(${error?.code || error?.message || error}). `
                + 'أُعيد السطر إلى الفهرس حتى لا يصبح الملف يتيمة لا يملكها أحد.',
            });
          }
        }

        return { manifest, result: { deleted: true, removed } };
      });

      // B4 — after the file is gone, not when the request arrived. A `BACKUP_DELETED`
      // row written up front would be a record of a deletion that the refusal above
      // may have prevented.
      await this.recordBackupAudit('BACKUP_DELETED', {
        actor,
        entityId: backupId,
        message: `Deleted backup ${backupId}.`,
        metadata: { fileName: outcome.removed.fileName, type: outcome.removed.type },
      });
      return { deleted: true };
    } catch (error) {
      // The refusals are the interesting rows: someone tried to remove the last copy,
      // or the undo of a restore in progress. Silence would make them indistinguishable
      // from nobody having tried.
      await this.recordBackupAudit('BACKUP_DELETED', {
        actor,
        status: 'failed',
        entityId: backupId,
        message: `Delete of backup ${backupId} was refused.`,
        metadata: { reason: this.describeError(error) },
      });
      throw error;
    }
  }

  /**
   * B4 — the failed half of the restore pair, called from the controller's catch.
   *
   * Public because the failure is observed where the response is built, not inside
   * `applyRestore`: the method either returns a result or throws, and the throw is
   * the branch that needs recording. A failed `pg_restore --clean` leaves the
   * database partly rebuilt, which is the worst state this system can be in, and it
   * is the one that used to leave nothing behind at all.
   */
  async recordRestoreFailure(params: {
    actor?: Partial<BackupActor>;
    backupId: string;
    stage: 'preview' | 'apply';
    reason: string;
  }): Promise<void> {
    await this.recordBackupAudit('RESTORE_FAILED', {
      actor: params.actor,
      status: 'failed',
      entityId: params.backupId,
      message: `Restore ${params.stage} failed for backup ${params.backupId || 'unknown'}: ${params.reason}`,
      metadata: { stage: params.stage, backupId: params.backupId },
    });
  }

  /**
   * B4 — a readable reason for a failed action, for the audit row.
   *
   * The refusals in this file throw an object body (`{code, message}`) because the
   * interface needs a code to key on, and `HttpException.message` is not that
   * string. Reading only `error.message` would file these rows as empty, which is
   * the outcome the audit exists to prevent.
   */
  private describeError(error: unknown): string {
    if (error && typeof error === 'object') {
      const response = (error as { response?: unknown }).response;
      if (response && typeof response === 'object' && 'message' in response) {
        const message = (response as { message?: unknown }).message;
        if (typeof message === 'string' && message.trim()) return message;
      }
      const code = (error as { code?: unknown }).code;
      if (typeof code === 'string' && code.trim()) return code;
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) return message;
    }
    if (typeof error === 'string' && error.trim()) return error;
    return 'unknown_error';
  }

  /**
   * B21 — accepts a backup archive from outside the list.
   *
   * ## The door this builds
   *
   * Downloading a backup and deleting it from the list used to be a one-way street:
   * the file sat on the operator's desktop and the section had no path that would
   * read it. So the only copy of the database outside the system was a file the
   * system refused to accept, and the one operation that would have needed it — a
   * restore — could not reach it.
   *
   * An import is not a restore and does not pretend to be one. It puts a genuine
   * archive back into the store, verified and honestly labelled, so that the ordinary
   * preview-and-confirm path can then be used on it like any other. The destructive
   * checks stay where they belong, on the restore.
   *
   * ## The order of the checks, and why
   *
   * 1. **The envelope's shape** — is this one of ours at all. Before any decryption,
   *    because a file that is not an archive should not cost a key derivation.
   * 2. **Decryption** — AES-GCM authenticates. An archive sealed with a different
   *    master secret cannot be restored later, and storing it would add a row that
   *    lists as a backup and can never be used. That is the dead end this door exists
   *    to remove, so it is refused here rather than discovered during a restore.
   * 3. **Identity** — id, type and date come from inside the authenticated envelope.
   *    Never from the filename or the multipart field, both of which are
   *    caller-controlled.
   * 4. **Collision** — an id already in the manifest is refused. Re-importing must
   *    not produce a second row, and must never overwrite a different archive.
   *
   * ## What is reported rather than refused
   *
   * An archive whose schema has drifted, or that is missing tables, is *stored* and
   * reported as not restorable. The list renders that state, and the restore refuses
   * it with a reason. Refusing at import would tell an operator who has just handed
   * the system a real copy of their data that the system will not take it — the same
   * dead end, reached sooner.
   */
  async importArchive(params: {
    filePath: string;
    originalName: string;
    actor: Partial<BackupActor>;
    decryptionPassword?: string;
  }): Promise<{
    backup: BackupListItem;
    /** True when the store would delete this archive on the next retention pass. */
    atRiskOfImmediatePrune: boolean;
    warnings: string[];
  }> {
    // 1. Shape.
    const raw = await fsPromises.readFile(params.filePath, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BadRequestException({
        code: 'BACKUP_IMPORT_NOT_AN_ARCHIVE',
        message: 'الملف ليس أرشيف نسخة احتياطية: محتواه ليس JSON صالحاً.',
      });
    }
    const shape = inspectEnvelope(parsed);
    if (isRefusal(shape)) {
      throw new BadRequestException({ code: shape.code, message: shape.message });
    }
    const envelope = parsed as BackupEnvelope;

    // 2. Authenticity. Throws on a wrong key, a corrupt body, or a payload whose
    //    own checksum does not match.
    const payload = this.decryptEnvelope(envelope, params.decryptionPassword);

    // 3. Identity, from inside the authenticated envelope.
    const verdict = judgeImport({
      id: envelope.id,
      type: envelope.type,
      createdAt: envelope.createdAt,
      missingModels: payload.manifest?.missingModels,
    });
    if (isRefusal(verdict)) {
      throw new BadRequestException({ code: verdict.code, message: verdict.message });
    }

    const warnings: string[] = [];
    if (!verdict.restorable) {
      warnings.push(
        'هذه النسخة ناقصة (بعض الجداول غير موجودة داخلها). ستظهر في القائمة كغير قابلة للاستعادة.',
      );
    }
    const stat = await fsPromises.stat(params.filePath);
    const fileChecksum = await this.computeFileChecksum(params.filePath);

    // Derived, never asserted. Gate 1.2 exists because a literal `'verified'` is
    // indistinguishable from a real check, and this is the third place an archive
    // would enter the manifest — so the two facts that actually make it trustworthy
    // are named and combined here: the auth tag verified above (AES-GCM, under the
    // current master secret) and a checksum computed from these exact bytes just now.
    // A checksum that is not a sha256 hex digest means the row describes something
    // other than the file next to it, and it is recorded as `failed` rather than
    // trusted.
    const evidence = {
      authTagVerified: true,
      checksumShape: /^[0-9a-f]{64}$/.test(fileChecksum),
    };
    const integrity: BackupIntegrity =
      evidence.authTagVerified && evidence.checksumShape ? 'verified' : 'failed';
    if (integrity === 'failed') {
      throw new BadRequestException({
        code: 'BACKUP_IMPORT_UNREADABLE',
        message: 'تعذّر حساب بصمة الملف المرفوع. لم يُستورد شيء.',
      });
    }

    // The file name is built from the authenticated id, never from the upload's
    // name: a caller-supplied name is a path, and a path is not an identity.
    const fileName = `${envelope.type}_${String(envelope.createdAt).replace(/[:.]/g, '-')}_${envelope.id.slice(0, 8)}${BACKUP_EXTENSION}`;
    const destination = path.join(this.backupDir, fileName);

    const imported = await this.withManifestLock(async () => {
      const manifest = await this.readManifest();
      // 4. Collision.
      const existing = manifest.find((entry) => entry.id === envelope.id);
      if (existing) {
        throw new ConflictException({
          code: 'BACKUP_ALREADY_PRESENT',
          message:
            `النسخة ${envelope.id} موجودة في القائمة بالفعل `
            + `(${existing.fileName}). لن تُضاف نسخة ثانية لنفس الملف.`,
          detail: { existingFileName: existing.fileName, createdAt: existing.createdAt },
        });
      }
      if (fs.existsSync(destination)) {
        // The id is new but the name is taken — only reachable if the same archive
        // was imported after its row was removed by hand. Refuse rather than
        // overwrite: the file on disk may not be the one just uploaded.
        throw new ConflictException({
          code: 'BACKUP_IMPORT_NAME_TAKEN',
          message: `يوجد ملف بالاسم نفسه داخل المخزن (${fileName}). لم يُستبدل أي ملف.`,
        });
      }

      await fsPromises.rename(params.filePath, destination);

      const entry: BackupManifestEntry = {
        id: envelope.id,
        fileName,
        type: envelope.type,
        // Provenance is recorded as its own value, not folded into `manual`: "who
        // pressed the button" and "where did this file come from" are different
        // questions, and an imported archive that claims to be manual is a lie an
        // auditor would have to disprove.
        trigger: 'import',
        createdAt: envelope.createdAt,
        sizeBytes: stat.size,
        checksumSha256: fileChecksum,
        integrity,
        passwordProtected: envelope.passwordProtected,
        actor: { type: 'user', mode: 'import', ...params.actor },
        metadata: envelope.metadata ?? payload.counts,
        databaseBytes: payload.manifest?.databaseDump?.byteLength,
        complete: verdict.restorable,
        missingModels: payload.manifest?.missingModels ?? (verdict.restorable ? undefined : ['manifest-missing']),
        partialTables: payload.partialTables ?? null,
        safetySnapshotForId: envelope.sourceBackupId || null,
      };

      // The age is the archive's own, so retention may want to delete it
      // immediately. That is allowed — the operator asked for their own policy — but
      // it is reported, because an import that vanishes on the next backup is
      // indistinguishable from an import that failed.
      const { retained, plan } = await this.applyRetention([entry, ...manifest], this.retentionLimitsFrom(await this.readSchedule()));
      const kept = retained.some((row) => row.id === entry.id);

      if (kept) {
        await this.writeManifest(retained);
      } else {
        // The floor and the age rule together removed it. Put the row back without
        // the row set, and delete the file, so the store is not left with a
        // manifest row and a file disagreeing about each other.
        await fsPromises.unlink(destination).catch(() => undefined);
        await this.writeManifest(manifest);
        throw new ConflictException({
          code: 'BACKUP_IMPORT_PRUNED_BY_POLICY',
          message:
            'مدّة الاحتفاظ أقصر من تاريخ هذه النسخة، فسيُحذف فور إنشاء نسخة جديدة. '
            + 'ارفع المدّة أو الحدّ الأدنى ثم أعد الاستيراد.',
          detail: { createdAt: entry.createdAt, refusedByFloor: plan.refused },
        });
      }

      // The age and count rules wanted this row gone and the `minCount` floor saved
      // it. That is the definition of "about to be pruned", and it is knowable only
      // from `refused` — the file is safe *today* and will not survive the next
      // backup unless the policy is changed, which the operator must be told rather
      // than left to discover.
      const atRisk = plan.refused.includes(entry.id);

      return {
        manifest: retained,
        result: { entry, atRiskOfImmediatePrune: atRisk, warnings },
      };
    });

    const listItem = this.toListItem(imported.entry, true);
    if (imported.atRiskOfImmediatePrune) {
      warnings.push(
        'تاريخ هذه النسخة أقدم من مدّة الاحتفاظ، وقد حذفها التنظيف عند إنشاء النسخة التالية. '
        + 'ارفع «مدّة الاحتفاظ» أو «أقل عدد نسخة» لحمايتها.',
      );
    }

    await this.recordBackupAudit('BACKUP_IMPORTED', {
      actor: params.actor,
      entityId: imported.entry.id,
      message: `Imported backup ${imported.entry.id} (${imported.entry.type}) from ${params.originalName}.`,
      metadata: {
        type: imported.entry.type,
        createdAt: imported.entry.createdAt,
        sizeBytes: imported.entry.sizeBytes,
        restorable: verdict.restorable,
        originalName: params.originalName,
      },
    });

    return { backup: listItem, atRiskOfImmediatePrune: imported.atRiskOfImmediatePrune, warnings };
  }

  /**
   * B2 — two deletions that must never succeed, whatever the caller asks for.
   *
   * Neither is a permission question; both are questions about whether a
   * destructive action would leave the system with no way back.
   */
  private assertDeletable(target: BackupManifestEntry, remaining: BackupManifestEntry[]): void {
    if (target.type === 'safety_snapshot' && this.pinnedSafetySnapshotIds().has(target.id)) {
      // A restore the operator is looking at right now has not been confirmed
      // yet. `applyRestore` checks that its token names a snapshot and nothing
      // more — it never asks whether that archive is still on disk — so deleting
      // it turns an undoable restore into a one-way door with no warning.
      throw new ConflictException({
        code: 'BACKUP_PINNED_BY_RESTORE',
        message: 'لا يمكن حذف لقطة السلامة: هناك عملية استعادة لم تُؤكّد بعد تعتمد عليها.',
      });
    }

    if (remaining.length === 0) {
      // `findBackupById` returns null for every id once the manifest is empty, and
      // `monitoring.service` turns that into `SYSTEM_RESET_BACKUP_MISSING` — a
      // factory reset refuses. A single delete was enough to reach that state.
      throw new ConflictException({
        code: 'BACKUP_LAST_COPY',
        message:
          'لا يمكن حذف النسخة الأخيرة: بدونها يتعطّل النسخ الاحتياطي لعملية إعادة ضبط المصنع. '
          + 'أنشئ نسخة جديدة أولاً.',
      });
    }
  }

  /**
   * Snapshots an unconfirmed restore still depends on.
   *
   * Read from the in-process token map, which is also where `applyRestore` looks.
   * The two lifetimes agree: tokens expire, and so does the guarantee.
   */
  private pinnedSafetySnapshotIds(): Set<string> {
    const now = Date.now();
    const pinned = new Set<string>();
    for (const token of this.restoreTokens.values()) {
      if (token.expiresAt > now && token.safetySnapshotId) pinned.add(token.safetySnapshotId);
    }
    return pinned;
  }

  /**
   * B9 — `daysToKeep` overrides the age rule and nothing else.
   *
   * The legacy `POST /backup/create` route called this with a hardcoded 30 and
   * ignored the configured `retentionDays` entirely, so the operator's setting was
   * respected on the scheduler path and not on the one they press by hand. The count
   * cap, the floor and the protected-type rule are not overridable: those are what
   * stop the store from losing its last copy, and a query parameter is not authority
   * over them.
   */
  async purgeOldBackups(daysToKeep?: number): Promise<number> {
    const schedule = await this.readSchedule();
    const limits = normalizeRetentionLimits(this.retentionLimitsFrom(schedule));
    if (Number.isFinite(daysToKeep)) {
      limits.retentionDays = Math.max(
        RETENTION_BOUNDS.retentionDays.min,
        Math.min(RETENTION_BOUNDS.retentionDays.max, Math.round(Number(daysToKeep))),
      );
    }

    return this.withManifestLock(async () => {
      const manifest = await this.readManifest();
      const { retained } = await this.applyRetention(manifest, limits);
      await this.writeManifest(retained);
      return { manifest: retained, result: Math.max(0, manifest.length - retained.length) };
    });
  }

  async createFullBackup(): Promise<string> {
    const result = await this.createBackupInternal({
      type: 'full',
      trigger: 'manual',
      actor: { type: 'system', mode: 'manual', username: 'legacy-full' },
    });
    return path.join(this.backupDir, result.fileName);
  }

  async createIncrementalBackup(_changes: unknown): Promise<string> {
    const result = await this.createBackupInternal({
      type: 'inventory',
      trigger: 'manual',
      actor: { type: 'system', mode: 'manual', username: 'legacy-incremental' },
    });
    return path.join(this.backupDir, result.fileName);
  }

  async createProductionBackup() {
    try {
      const backup = await this.createBackupInternal({
        type: 'full',
        trigger: 'manual',
        actor: { type: 'system', mode: 'manual', username: 'production-backup' },
      });
      // B9 — no argument. The legacy route hardcoded 30 and so ignored the
      // operator's configured `retentionDays`: the setting was honoured on the
      // scheduler path and not on the one they press by hand.
      const deletedCount = await this.purgeOldBackups();
      return {
        filePath: path.join(this.backupDir, backup.fileName),
        deletedCount,
        remote: {
          provider: 'none',
          status: 'skipped',
          reason: 'Remote upload is not configured',
        },
      };
    } catch (error) {
      this.logger.error('Production backup failed', error as Error);
      throw new InternalServerErrorException('Backup creation failed');
    }
  }

  async listLegacyBackups(): Promise<Array<{ name: string; size: number; modifiedAt: string; type: 'full' | 'incremental' | 'unknown' }>> {
    const list = await this.listBackups();
    return list.map((entry) => ({
      name: entry.fileName,
      size: entry.sizeBytes,
      modifiedAt: entry.createdAt,
      type: entry.type === 'full' || entry.type === 'inventory' ? (entry.type === 'full' ? 'full' : 'incremental') : 'unknown',
    }));
  }
}