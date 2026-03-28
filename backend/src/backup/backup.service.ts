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
import { v4 as uuidv4 } from 'uuid';
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

type BackupPayload = {
  type: BackupType;
  trigger: BackupTrigger;
  createdAt: string;
  sourceBackupId?: string;
  dbBase64?: string;
  configFiles: ConfigSnapshot[];
  schedule?: BackupScheduleState;
  counts: BackupMetaCounts;
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

  constructor(private readonly prisma: PrismaService) {
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

  private sanitizeSchedule(input: any): BackupScheduleState {
    const defaults = this.defaultSchedule();
    return {
      enabled: input?.enabled ?? defaults.enabled,
      frequency: ['daily', 'weekly', 'monthly'].includes(input?.frequency) ? input.frequency : defaults.frequency,
      hour: this.clamp(input?.hour, 0, 23, defaults.hour),
      minute: this.clamp(input?.minute, 0, 59, defaults.minute),
      dayOfWeek: this.clamp(input?.dayOfWeek, 0, 6, defaults.dayOfWeek),
      dayOfMonth: this.clamp(input?.dayOfMonth, 1, 31, defaults.dayOfMonth),
      retentionDays: this.clamp(input?.retentionDays, 1, 3650, defaults.retentionDays),
      storageTargets: this.normalizeStorageTargets(input?.storageTargets),
      encryptionEnabled: Boolean(input?.encryptionEnabled ?? defaults.encryptionEnabled),
      encryptedPassword: typeof input?.encryptedPassword === 'string' ? input.encryptedPassword : undefined,
      passwordHash: typeof input?.passwordHash === 'string' ? input.passwordHash : undefined,
      passwordSaltBase64: typeof input?.passwordSaltBase64 === 'string' ? input.passwordSaltBase64 : undefined,
      restorePinHash: typeof input?.restorePinHash === 'string' ? input.restorePinHash : undefined,
      restorePinSaltBase64: typeof input?.restorePinSaltBase64 === 'string' ? input.restorePinSaltBase64 : undefined,
      lastRunAt: typeof input?.lastRunAt === 'string' ? input.lastRunAt : undefined,
      lastRunKey: typeof input?.lastRunKey === 'string' ? input.lastRunKey : undefined,
      updatedAt: typeof input?.updatedAt === 'string' ? input.updatedAt : new Date().toISOString(),
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

  private resolveSqliteDbPath(): string | null {
    const rawUrl = String(process.env.DATABASE_URL || '').trim();
    if (rawUrl.startsWith('file:')) {
      const dbPath = rawUrl.slice(5);
      if (!dbPath) return null;
      return path.isAbsolute(dbPath) ? dbPath : path.resolve(process.cwd(), dbPath);
    }

    const fallback = path.resolve(process.cwd(), 'prisma', 'dev.db');
    return fs.existsSync(fallback) ? fallback : null;
  }

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
      const dbPath = this.resolveSqliteDbPath();
      if (!dbPath || !fs.existsSync(dbPath)) {
        throw new BadRequestException('SQLite database file was not found');
      }
      const dbBytes = await fsPromises.readFile(dbPath);
      payload.dbBase64 = dbBytes.toString('base64');
    }

    if (type === 'full' || type === 'config' || type === 'safety_snapshot') {
      payload.configFiles = await this.collectConfigFiles();
      payload.counts.configFiles = payload.configFiles.length;
      payload.schedule = await this.readSchedule();
    }

    return payload;
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

  private async restoreDatabaseFromBase64(dbBase64: string) {
    const dbPath = this.resolveSqliteDbPath();
    if (!dbPath) {
      throw new BadRequestException('SQLite database path is missing');
    }

    const tempPath = `${dbPath}.restore.tmp`;
    const bytes = Buffer.from(dbBase64, 'base64');
    await fsPromises.writeFile(tempPath, bytes);

    await this.prisma.$disconnect();
    try {
      await fsPromises.copyFile(tempPath, dbPath);
    } finally {
      await fsPromises.unlink(tempPath).catch(() => undefined);
      await this.prisma.$connect();
    }
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

    let restoredConfigFiles = 0;
    if (payload.type !== 'config' && payload.dbBase64) {
      await this.restoreDatabaseFromBase64(payload.dbBase64);
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

    const dbPath = this.resolveSqliteDbPath();
    const dbBytes = dbPath && fs.existsSync(dbPath) ? (await fsPromises.stat(dbPath)).size : 0;

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
      const statFs: any = await (fsPromises as any).statfs(this.backupDir);
      freeBytes = Number(statFs?.bavail || 0) * Number(statFs?.bsize || 0);
      totalBytes = Number(statFs?.blocks || 0) * Number(statFs?.bsize || 0);
    } catch {
      // fallback below
    }

    const usedByApp = dbBytes + configBytes + backupsBytes;
    if (totalBytes <= 0) {
      totalBytes = usedByApp + Math.max(usedByApp, 1);
      freeBytes = Math.max(totalBytes - usedByApp, 0);
    }

    const donutBase = dbBytes + configBytes + freeBytes;
    const safe = donutBase > 0 ? donutBase : 1;

    return {
      generatedAt: new Date().toISOString(),
      databaseBytes: dbBytes,
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
          label: '7"7"7"#⬑"7⬩7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7" 7"7"7"7"7"7"7"#⬑"#9 7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"#⬑"7"7"7"7"7"7"7"7"7"',
          color: '#2563eb',
          valueBytes: dbBytes,
          percentage: Number(((dbBytes / safe) * 100).toFixed(2)),
        },
        {
          key: 'config',
          label: '7"7"7"7"7"7"7"#⬑"#9 7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"',
          color: '#f59e0b',
          valueBytes: configBytes,
          percentage: Number(((configBytes / safe) * 100).toFixed(2)),
        },
        {
          key: 'free',
          label: '7"7"7"7"7"7"7"#⬑"#9 7"7"7"#⬑"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7" 7"7"7"7"7"7"7"#⬑"#9 7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"#7:7"7"7"7"',
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

  async createIncrementalBackup(_changes: any): Promise<string> {
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
