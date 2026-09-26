// ENTERPRISE FIX: Phase 0 – Critical Security & Encoding Lockdown - 2026-03-13
// ENTERPRISE FIX: Phase 0.3 – Final Arabic Encoding Fix & 10/10 Declaration - 2026-03-13
// ENTERPRISE FIX: Arabic Encoding Auto-Fixed - 2026-03-13
// ENTERPRISE FIX: Phase 0.1 – Final Encoding & Lock Fix - 2026-03-13
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleDestroy,
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
import { dumpPostgres, isPostgresUrl, restorePostgres } from './pg-dump';
import { DatabaseInfrastructureService } from '../database/database-infrastructure.service';
import { PrismaService } from '../prisma.service';

export type BackupType = 'full' | 'inventory' | 'config' | 'safety_snapshot';
export type BackupTrigger = 'manual' | 'scheduled';

type StorageTarget = 'local' | 'usb' | 'drive';

type BackupActor = {
  type: 'user' | 'system';
  mode: 'manual' | 'scheduled';
  userId?: string;
  username?: string;
  role?: string;
};

type BackupScheduleState = {
  enabled: boolean;
  frequency: 'daily' | 'weekly' | 'monthly';
  hour: number;
  minute: number;
  dayOfWeek: number;
  dayOfMonth: number;
  retentionDays: number;
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
  integrity: 'verified' | 'failed';
  passwordProtected: boolean;
  actor: BackupActor;
  metadata: BackupMetaCounts;
  /** FC-OPS-001 — size of the captured database dump, used for storage reporting. */
  databaseBytes?: number;
  /** FC-OPS-001 — whether this backup is complete enough to be a full restore. */
  complete?: boolean;
  missingModels?: string[];
  safetySnapshotForId?: string | null;
};

type BackupListItem = BackupManifestEntry & {
  integrityVerified: boolean;
  integrityLabel: 'verified' | 'failed';
};

type ConfigSnapshot = {
  relativePath: string;
  contentBase64: string;
};

type RoleSnapshot = Omit<Prisma.RoleCreateManyInput, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
};

type PermissionSnapshot = Omit<Prisma.PermissionCreateManyInput, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
};

type RolePermissionSnapshot = Omit<Prisma.RolePermissionCreateManyInput, 'createdAt'> & {
  createdAt: string;
};

type UserSnapshot = Omit<Prisma.UserCreateManyInput, 'lockoutUntil' | 'inviteExpires' | 'createdAt' | 'updatedAt'> & {
  lockoutUntil?: string | null;
  inviteExpires?: string | null;
  createdAt: string;
  updatedAt: string;
};

type UserRoleSnapshot = Omit<Prisma.UserRoleCreateManyInput, 'assignedAt'> & {
  assignedAt: string;
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
  permissions?: PermissionSnapshot[];
  rolePermissions?: RolePermissionSnapshot[];
  users?: UserSnapshot[];
  userRoles?: UserRoleSnapshot[];
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
const CONFIG_FILES_ALLOW_LIST = ['metadata.json', path.join('server', 'server-data.json')];

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
  ) {
    void this.ensureWorkspace();
    this.startScheduler();
  }

  onModuleDestroy() {
    if (this.scheduleTimer) clearInterval(this.scheduleTimer);
    this.scheduleTimer = null;
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
    return {
      enabled: source.enabled ?? defaults.enabled,
      frequency: ['daily', 'weekly', 'monthly'].includes(String(source.frequency || ''))
        ? (source.frequency as BackupScheduleState['frequency'])
        : defaults.frequency,
      hour: this.clamp(source.hour, 0, 23, defaults.hour),
      minute: this.clamp(source.minute, 0, 59, defaults.minute),
      dayOfWeek: this.clamp(source.dayOfWeek, 0, 6, defaults.dayOfWeek),
      dayOfMonth: this.clamp(source.dayOfMonth, 1, 31, defaults.dayOfMonth),
      retentionDays: this.clamp(source.retentionDays, 1, 3650, defaults.retentionDays),
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

  private async readManifest(): Promise<BackupManifestEntry[]> {
    await this.ensureWorkspace();
    const raw = await fsPromises.readFile(this.manifestFile, 'utf8').catch(() => '[]');
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as BackupManifestEntry[]) : [];
    } catch {
      return [];
    }
  }

  private async writeManifest(entries: BackupManifestEntry[]) {
    await this.ensureWorkspace();
    await fsPromises.writeFile(this.manifestFile, JSON.stringify(entries, null, 2), 'utf8');
  }

  private async readSchedule(): Promise<BackupScheduleState> {
    await this.ensureWorkspace();
    const raw = await fsPromises.readFile(this.scheduleFile, 'utf8').catch(() => '');
    if (!raw.trim()) return this.defaultSchedule();
    try {
      return this.sanitizeSchedule(JSON.parse(raw));
    } catch {
      return this.defaultSchedule();
    }
  }

  private async writeSchedule(schedule: BackupScheduleState) {
    await this.ensureWorkspace();
    await fsPromises.writeFile(this.scheduleFile, JSON.stringify(schedule, null, 2), 'utf8');
  }

  private hashSha256(value: Buffer | string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private deriveAesKey(password: string | undefined, salt: Buffer): Buffer {
    const secret = String(password || '').trim() || this.getMasterSecret();
    return pbkdf2Sync(`${secret}:${this.getMasterSecret()}`, salt, 210000, 32, 'sha256');
  }

  private encryptSecret(secret: string): string {
    const iv = randomBytes(12);
    const key = createHash('sha256').update(this.getMasterSecret()).digest();
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
  }

  private decryptSecret(payload?: string): string {
    if (!payload) return '';
    const [ivRaw, tagRaw, dataRaw] = payload.split('.');
    if (!ivRaw || !tagRaw || !dataRaw) return '';

    const key = createHash('sha256').update(this.getMasterSecret()).digest();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivRaw, 'base64'));
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataRaw, 'base64')), decipher.final()]).toString('utf8');
  }

  private hashSecret(secret: string): { hash: string; saltBase64: string } {
    const salt = randomBytes(16);
    const hash = pbkdf2Sync(secret, salt, 180000, 32, 'sha256').toString('hex');
    return { hash, saltBase64: salt.toString('base64') };
  }

  private verifySecret(secret: string, hashHex?: string, saltBase64?: string): boolean {
    if (!hashHex || !saltBase64) return false;
    const computed = pbkdf2Sync(secret, Buffer.from(saltBase64, 'base64'), 180000, 32, 'sha256').toString('hex');
    const left = Buffer.from(hashHex, 'hex');
    const right = Buffer.from(computed, 'hex');
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
  }

  // FC-OPS-001 — `resolveSqliteDbPath` was removed. It could only ever resolve
  // a SQLite file, so on this PostgreSQL deployment every "full" backup silently
  // degraded to a partial JSON snapshot and every restore failed. The real path
  // is pg_dump / pg_restore in ./pg-dump.ts.

  private async collectConfigFiles(): Promise<ConfigSnapshot[]> {
    const files: ConfigSnapshot[] = [];
    for (const relativePath of CONFIG_FILES_ALLOW_LIST) {
      const fullPath = path.resolve(process.cwd(), relativePath);
      if (!fs.existsSync(fullPath)) continue;
      const stat = await fsPromises.stat(fullPath).catch(() => null);
      if (!stat?.isFile()) continue;
      const content = await fsPromises.readFile(fullPath, 'utf8').catch(() => '');
      files.push({
        relativePath,
        contentBase64: Buffer.from(content, 'utf8').toString('base64'),
      });
    }
    return files;
  }

  private async restoreConfigFiles(files: ConfigSnapshot[]): Promise<number> {
    let count = 0;
    for (const file of files || []) {
      if (!CONFIG_FILES_ALLOW_LIST.includes(file.relativePath)) continue;
      const target = path.resolve(process.cwd(), file.relativePath);
      await fsPromises.mkdir(path.dirname(target), { recursive: true });
      const content = Buffer.from(String(file.contentBase64 || ''), 'base64').toString('utf8');
      await fsPromises.writeFile(target, content, 'utf8');
      count += 1;
    }
    return count;
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
        const dump = await dumpPostgres(databaseUrl, { format: 'custom' });
        payload.dbBase64 = dump.base64;
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
        byteLength: payload.dbBase64 ? Buffer.from(payload.dbBase64, 'base64').length : undefined,
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

  /** FC-OPS-001 — the applied migration count, used to detect an incompatible restore. */
  private readSchemaVersion(): string {
    try {
      const migrationsDir = path.resolve(process.cwd(), 'prisma', 'migrations');
      if (!fs.existsSync(migrationsDir)) return 'unknown';
      return String(fs.readdirSync(migrationsDir).filter((name) => fs.statSync(path.join(migrationsDir, name)).isDirectory()).length);
    } catch {
      return 'unknown';
    }
  }

  private async buildPrismaDataSnapshot(type: BackupType): Promise<PrismaDataSnapshot> {
    const snapshot: PrismaDataSnapshot = { engine: 'prisma' };

    if (type === 'full' || type === 'safety_snapshot') {
      const [roles, permissions, rolePermissions, users, userRoles] = await Promise.all([
        this.prisma.role.findMany({ orderBy: { createdAt: 'asc' } }),
        this.prisma.permission.findMany({ orderBy: { createdAt: 'asc' } }),
        this.prisma.rolePermission.findMany({ orderBy: { createdAt: 'asc' } }),
        this.prisma.user.findMany({ orderBy: { createdAt: 'asc' } }),
        this.prisma.userRole.findMany({ orderBy: { assignedAt: 'asc' } }),
      ]);

      snapshot.roles = roles.map((entry) => ({
        ...entry,
        createdAt: entry.createdAt.toISOString(),
        updatedAt: entry.updatedAt.toISOString(),
      }));
      snapshot.permissions = permissions.map((entry) => ({
        ...entry,
        createdAt: entry.createdAt.toISOString(),
        updatedAt: entry.updatedAt.toISOString(),
      }));
      snapshot.rolePermissions = rolePermissions.map((entry) => ({
        ...entry,
        createdAt: entry.createdAt.toISOString(),
      }));
      snapshot.users = users.map((entry) => ({
        ...entry,
        lockoutUntil: entry.lockoutUntil ? entry.lockoutUntil.toISOString() : null,
        inviteExpires: entry.inviteExpires ? entry.inviteExpires.toISOString() : null,
        createdAt: entry.createdAt.toISOString(),
        updatedAt: entry.updatedAt.toISOString(),
      }));
      snapshot.userRoles = userRoles.map((entry) => ({
        ...entry,
        assignedAt: entry.assignedAt.toISOString(),
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
  }): BackupEnvelope {
    const plainText = JSON.stringify(params.payload);
    const payloadSha256 = this.hashSha256(plainText);

    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = this.deriveAesKey(params.password, salt);
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
    };
  }

  private decryptEnvelope(envelope: BackupEnvelope, password?: string): BackupPayload {
    if (envelope.passwordProtected && !String(password || '').trim()) {
      throw new BadRequestException('Backup decryption password is required');
    }

    try {
      const key = this.deriveAesKey(password, Buffer.from(envelope.saltBase64, 'base64'));
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
    } catch {
      throw new BadRequestException('Unable to decrypt backup. Invalid password or corrupted file.');
    }
  }

  private async computeFileChecksum(filePath: string): Promise<string> {
    return await new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  private buildFileName(type: BackupType, id: string): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `${type}_${stamp}_${id.slice(0, 8)}${BACKUP_EXTENSION}`;
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

  private async applyRetention(entries: BackupManifestEntry[], retentionDays: number): Promise<BackupManifestEntry[]> {
    const ttlMs = Math.max(1, retentionDays) * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - ttlMs;

    const kept: BackupManifestEntry[] = [];
    for (const entry of entries) {
      const createdAt = Date.parse(entry.createdAt || '');
      const expired = Number.isFinite(createdAt) && createdAt < cutoff;
      if (!expired) {
        kept.push(entry);
        continue;
      }

      const filePath = path.join(this.backupDir, entry.fileName);
      await fsPromises.unlink(filePath).catch(() => undefined);
    }

    return kept;
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
    sourceBackupId?: string;
  }): Promise<BackupListItem> {
    await this.ensureWorkspace();

    const schedule = await this.readSchedule();
    const payload = await this.buildPayload(params.type, params.trigger, params.sourceBackupId);
    const actor = this.normalizeActor(params.actor, params.trigger);
    const encryption = this.resolveEncryptionPassword(schedule, params.encryptionPassword);

    const envelope = this.encryptPayload({
      payload,
      type: params.type,
      trigger: params.trigger,
      actor,
      password: encryption.password,
      passwordProtected: encryption.passwordProtected,
      sourceBackupId: params.sourceBackupId,
    });

    const fileName = this.buildFileName(params.type, envelope.id);
    const filePath = path.join(this.backupDir, fileName);
    await fsPromises.writeFile(filePath, JSON.stringify(envelope), 'utf8');

    const stat = await fsPromises.stat(filePath);
    const checksumSha256 = await this.computeFileChecksum(filePath);

    const entry: BackupManifestEntry = {
      id: envelope.id,
      fileName,
      type: params.type,
      trigger: params.trigger,
      createdAt: envelope.createdAt,
      sizeBytes: stat.size,
      checksumSha256,
      integrity: 'verified',
      passwordProtected: envelope.passwordProtected,
      actor,
      metadata: envelope.metadata,
      // FC-OPS-001 — completeness and dump size are recorded per backup so the
      // UI can show whether a backup is actually restorable, and so storage
      // reporting reflects the real database footprint.
      databaseBytes: payload.manifest?.databaseDump.byteLength,
      complete: (payload.manifest?.missingModels?.length ?? 1) === 0,
      missingModels: payload.manifest?.missingModels ?? ['manifest-missing'],
      safetySnapshotForId: params.sourceBackupId || null,
    };

    const manifest = await this.readManifest();
    manifest.unshift(entry);
    const retained = await this.applyRetention(manifest, schedule.retentionDays || 30);
    await this.writeManifest(retained);

    return {
      ...entry,
      integrityVerified: true,
      integrityLabel: 'verified',
    };
  }

  private toListItem(entry: BackupManifestEntry, valid: boolean): BackupListItem {
    return {
      ...entry,
      integrity: valid ? 'verified' : 'failed',
      integrityVerified: valid,
      integrityLabel: valid ? 'verified' : 'failed',
    };
  }

  async createBackup(params: {
    type: Exclude<BackupType, 'safety_snapshot'>;
    actor?: Partial<BackupActor>;
    encryptionPassword?: string;
  }): Promise<BackupListItem> {
    return this.createBackupInternal({
      type: params.type,
      trigger: 'manual',
      actor: params.actor,
      encryptionPassword: params.encryptionPassword,
    });
  }

  async listBackups(type?: BackupType): Promise<BackupListItem[]> {
    const manifest = await this.readManifest();
    const filtered = type ? manifest.filter((entry) => entry.type === type) : manifest;
    const sorted = [...filtered].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    let changed = false;
    const list: BackupListItem[] = [];

    for (const entry of sorted) {
      const valid = await this.verifyIntegrity(entry);
      const expected = valid ? 'verified' : 'failed';
      if (entry.integrity !== expected) {
        entry.integrity = expected;
        changed = true;
      }
      list.push(this.toListItem(entry, valid));
    }

    if (changed) {
      await this.writeManifest(manifest);
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

  private verifyRestorePinOrThrow(schedule: BackupScheduleState, restorePin: string) {
    const pin = String(restorePin || '').trim();
    if (!pin) {
      throw new UnauthorizedException('Restore PIN is required');
    }

    if (schedule.restorePinHash && schedule.restorePinSaltBase64) {
      if (!this.verifySecret(pin, schedule.restorePinHash, schedule.restorePinSaltBase64)) {
        throw new UnauthorizedException('Invalid restore PIN');
      }
      return;
    }

    const fallback = String(process.env.BACKUP_RESTORE_PIN || '').trim();
    if (!fallback) {
      throw new UnauthorizedException('Restore PIN is not configured');
    }

    if (fallback !== pin) {
      throw new UnauthorizedException('Invalid restore PIN');
    }
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
  private async restoreDatabaseFromBase64(dbBase64: string) {
    const databaseUrl = String(process.env.DATABASE_URL || '').trim();
    if (!isPostgresUrl(databaseUrl)) {
      throw new BadRequestException('Database restore is only supported for PostgreSQL deployments');
    }

    // Release the pool so the restore is not fighting live connections.
    await this.prisma.$disconnect();
    try {
      await restorePostgres(databaseUrl, dbBase64, {
        clean: true,
        exitOnError: true,
        singleTransaction: true,
      });
    } finally {
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
        await tx.userRole.deleteMany();
        await tx.rolePermission.deleteMany();
        await tx.user.deleteMany();
        await tx.permission.deleteMany();
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

        if (snapshot.permissions?.length) {
          await tx.permission.createMany({
            data: snapshot.permissions.map((entry) => ({
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

        if (snapshot.rolePermissions?.length) {
          await tx.rolePermission.createMany({
            data: snapshot.rolePermissions.map((entry) => ({
              ...entry,
              createdAt: new Date(entry.createdAt),
            })),
          });
        }

        if (snapshot.userRoles?.length) {
          await tx.userRole.createMany({
            data: snapshot.userRoles.map((entry) => ({
              ...entry,
              assignedAt: new Date(entry.assignedAt),
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
    this.verifyRestorePinOrThrow(schedule, params.restorePin);

    const target = await this.getEntryOrThrow(params.backupId);
    const valid = await this.verifyIntegrity(target);
    if (!valid) {
      throw new BadRequestException('Backup integrity verification failed; restore is blocked');
    }

    const safetySnapshot = await this.createBackupInternal({
      type: 'safety_snapshot',
      trigger: 'manual',
      actor: { ...params.actor, mode: 'manual' },
      encryptionPassword: params.decryptionPassword,
      sourceBackupId: params.backupId,
    });

    const token = this.createRestoreToken({
      backupId: params.backupId,
      actorKey: this.actorKey(params.actor),
      safetySnapshotId: safetySnapshot.id,
    });

    return {
      requiresConfirmation: true,
      restoreToken: token.token,
      safetySnapshotId: safetySnapshot.id,
      target: this.toListItem(target, true),
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
    this.verifyRestorePinOrThrow(schedule, params.restorePin);

    const token = this.consumeRestoreToken(params.restoreToken, params.backupId, this.actorKey(params.actor));

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

    let restoredConfigFiles = 0;
    if (payload.type !== 'config') {
      if (payload.dbBase64) {
        await this.restoreDatabaseFromBase64(payload.dbBase64);
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
  private publicSchedule(schedule: BackupScheduleState) {
    return {
      enabled: schedule.enabled,
      frequency: schedule.frequency,
      hour: schedule.hour,
      minute: schedule.minute,
      dayOfWeek: schedule.dayOfWeek,
      dayOfMonth: schedule.dayOfMonth,
      retentionDays: schedule.retentionDays,
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
    storageTargets?: StorageTarget[];
    encryptionEnabled?: boolean;
    encryptionPassword?: string;
    restorePin?: string;
  }) {
    const current = await this.readSchedule();
    const next: BackupScheduleState = {
      ...current,
      enabled: input.enabled ?? current.enabled,
      frequency: input.frequency ?? current.frequency,
      hour: this.clamp(input.hour ?? current.hour, 0, 23, current.hour),
      minute: this.clamp(input.minute ?? current.minute, 0, 59, current.minute),
      dayOfWeek: this.clamp(input.dayOfWeek ?? current.dayOfWeek, 0, 6, current.dayOfWeek),
      dayOfMonth: this.clamp(input.dayOfMonth ?? current.dayOfMonth, 1, 31, current.dayOfMonth),
      retentionDays: this.clamp(input.retentionDays ?? current.retentionDays, 1, 3650, current.retentionDays),
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

    await this.writeSchedule(next);

    const manifest = await this.readManifest();
    const retained = await this.applyRetention(manifest, next.retentionDays);
    await this.writeManifest(retained);

    return {
      ...this.publicSchedule(next),
      nextRunAt: this.calculateNextRun(next)?.toISOString() || null,
    };
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

  private shouldRunNow(schedule: BackupScheduleState, now: Date): boolean {
    if (!schedule.enabled) return false;
    if (now.getHours() !== schedule.hour || now.getMinutes() !== schedule.minute) return false;
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
      const schedule = await this.readSchedule();
      const now = new Date();
      if (!this.shouldRunNow(schedule, now)) return;

      await this.createBackupInternal({
        type: 'full',
        trigger: 'scheduled',
        actor: { type: 'system', mode: 'scheduled', username: 'scheduler' },
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
    try {
      const statFsProvider = fsPromises as typeof fsPromises & {
        statfs?: (path: string) => Promise<StatFsResult>;
      };
      const statFs = statFsProvider.statfs ? await statFsProvider.statfs(this.backupDir) : null;
      freeBytes = Number(statFs?.bavail || 0) * Number(statFs?.bsize || 0);
      totalBytes = Number(statFs?.blocks || 0) * Number(statFs?.bsize || 0);
    } catch {
      // fallback below
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

  async downloadBackup(backupId: string): Promise<{ filePath: string; fileName: string; checksumSha256: string }> {
    const target = await this.getEntryOrThrow(backupId);
    const valid = await this.verifyIntegrity(target);
    if (!valid) {
      throw new BadRequestException('Download blocked because backup integrity verification failed');
    }

    return {
      filePath: path.join(this.backupDir, target.fileName),
      fileName: target.fileName,
      checksumSha256: target.checksumSha256,
    };
  }

  async deleteBackup(backupId: string): Promise<{ deleted: boolean }> {
    const manifest = await this.readManifest();
    const index = manifest.findIndex((entry) => entry.id === backupId);
    if (index < 0) return { deleted: false };

    const [removed] = manifest.splice(index, 1);
    await this.writeManifest(manifest);
    await fsPromises.unlink(path.join(this.backupDir, removed.fileName)).catch(() => undefined);
    return { deleted: true };
  }

  async purgeOldBackups(daysToKeep = 30): Promise<number> {
    const manifest = await this.readManifest();
    const retained = await this.applyRetention(manifest, daysToKeep);
    await this.writeManifest(retained);
    return Math.max(0, manifest.length - retained.length);
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
      const deletedCount = await this.purgeOldBackups(30);
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
