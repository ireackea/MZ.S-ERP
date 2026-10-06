import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomBytes } from 'node:crypto';
import * as fsPromises from 'node:fs/promises';
import * as path from 'node:path';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RbacGuard } from '../auth/rbac.guard';
import { BackupGuard } from './backup.guard';
import { BackupService, BackupType } from './backup.service';
import { BackupStateService } from './backup-state.service';

type BackupRequestUser = {
  id?: string | number;
  username?: string;
  name?: string;
  role?: string;
};

type BackupRequestActor = {
  type?: 'user' | 'system';
  mode?: 'manual' | 'scheduled';
  userId?: string | number;
  username?: string;
  role?: string;
};

type BackupHttpRequest = Request & {
  user?: BackupRequestUser;
  backupActor?: BackupRequestActor;
};

type BackupCreateBody = {
  encryptionPassword?: string;
};

type RestoreBackupBody = {
  confirmRestore?: boolean;
  backupId?: string;
  restorePin?: string;
  restoreToken?: string;
  decryptionPassword?: string;
};

type ApiErrorLike = {
  message?: unknown;
  status?: unknown;
};

/**
 * B21 — the ceiling on an uploaded archive.
 *
 * An archive is the whole database as base64, so a 512 MB dump arrives as a ~680 MB
 * file. The cap is above that on purpose: the alternative is an operator who cannot
 * re-import their own backup, which is the failure this whole item exists to fix.
 * It is a real limit rather than an open door, and it is the same order as the dump
 * ceiling in `pg-dump.ts` so the two cannot disagree about what an archive may be.
 */
const BACKUP_IMPORT_MAX_BYTES = 768 * 1024 * 1024;

/**
 * Where multer writes. Inside the backup directory, so the service can rename the
 * file into place without crossing a filesystem, and under a name no archive can
 * ever take: `buildFileName` and the import path both end in a real `.ffbkp` name
 * built from the authenticated id, so a file in here is by construction not yet an
 * archive.
 */
let incomingDirPromise: Promise<string> | null = null;

/**
 * The staging directory, created once and awaited.
 *
 * Memoised so concurrent uploads do not each issue a `mkdir`, and — the reason it is
 * a promise at all — so the caller can wait for the directory to exist. Returning the
 * path and creating it in the background hands multer a path that may not be there
 * yet: it opens the write stream immediately, so the first upload after a fresh deploy
 * fails with an ENOENT that points at the filesystem rather than at the file.
 */
const ensureIncomingDir = (): Promise<string> => {
  if (!incomingDirPromise) {
    const dir = path.join(process.cwd(), 'backups', 'incoming');
    incomingDirPromise = fsPromises.mkdir(dir, { recursive: true }).then(() => dir);
  }
  return incomingDirPromise;
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object' && error && 'message' in error) {
    const candidate = (error as ApiErrorLike).message;
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
  }
  return 'unknown_error';
};

const getErrorStatus = (error: unknown, fallback: number): number => {
  if (typeof error === 'object' && error && 'status' in error) {
    const candidate = Number((error as ApiErrorLike).status);
    if (Number.isInteger(candidate) && candidate > 0) return candidate;
  }
  return fallback;
};

@UseGuards(BackupGuard, RbacGuard)
@Controller()
export class BackupController {
  constructor(
    private readonly backupService: BackupService,
    // B13 — the health answer, from the one place that owns it. The controller does not
    // assemble it from the manifest: three screens each doing that is how they drift.
    private readonly backupState: BackupStateService,
  ) {}

  private actorFromRequest(request: Request): {
    type: 'user' | 'system';
    mode: 'manual' | 'scheduled';
    userId?: string;
    username?: string;
    role?: string;
  } {
    const typedRequest = request as BackupHttpRequest;
    const user = typedRequest.user;
    if (user && (user.id || user.username)) {
      return {
        type: 'user' as const,
        mode: 'manual' as const,
        userId: user.id ? String(user.id) : undefined,
        username: String(user.username || user.name || 'user'),
        role: String(user.role || 'user'),
      };
    }

    const backupActor = typedRequest.backupActor;
    if (backupActor && (backupActor.userId || backupActor.username)) {
      return {
        type: backupActor.type === 'user' ? ('user' as const) : ('system' as const),
        mode: backupActor.mode === 'scheduled' ? ('scheduled' as const) : ('manual' as const),
        userId: backupActor.userId ? String(backupActor.userId) : undefined,
        username: backupActor.username,
        role: backupActor.role,
      };
    }

    return {
      type: 'system' as const,
      mode: 'manual' as const,
      username: 'system',
      role: 'system',
    };
  }

  private resolveListType(value?: string): BackupType | undefined {
    if (!value) return undefined;
    const normalized = String(value).trim().toLowerCase();
    if (normalized === 'full' || normalized === 'inventory' || normalized === 'config' || normalized === 'safety_snapshot') {
      return normalized as BackupType;
    }
    return undefined;
  }

  @Permissions('backup.create')
  @Post('backup/full')
  async createFullSystemBackup(@Body() body: BackupCreateBody, @Req() req: Request, @Res() res: Response) {
    try {
      const data = await this.backupService.createBackup({
        type: 'full',
        actor: this.actorFromRequest(req),
        encryptionPassword: body?.encryptionPassword,
      });
      return res.status(HttpStatus.OK).json({ success: true, data });
    } catch (error: unknown) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to create full backup',
        error: getErrorMessage(error),
      });
    }
  }

  @Permissions('backup.create')
  @Post('backup/inventory')
  async createInventoryBackup(@Body() body: BackupCreateBody, @Req() req: Request, @Res() res: Response) {
    try {
      const data = await this.backupService.createBackup({
        type: 'inventory',
        actor: this.actorFromRequest(req),
        encryptionPassword: body?.encryptionPassword,
      });
      return res.status(HttpStatus.OK).json({ success: true, data });
    } catch (error: unknown) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to create inventory backup',
        error: getErrorMessage(error),
      });
    }
  }

  @Permissions('backup.create')
  @Post('backup/config')
  async createConfigBackup(@Body() body: BackupCreateBody, @Req() req: Request, @Res() res: Response) {
    try {
      const data = await this.backupService.createBackup({
        type: 'config',
        actor: this.actorFromRequest(req),
        encryptionPassword: body?.encryptionPassword,
      });
      return res.status(HttpStatus.OK).json({ success: true, data });
    } catch (error: unknown) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to create config backup',
        error: getErrorMessage(error),
      });
    }
  }

  /**
   * B5 — the answer, in one place.
   *
   * `?verify=1` forces a real re-read rather than a recent one. An operator auditing
   * their backups needs a measurement, and a badge that can only report what was
   * true a minute ago is a claim.
   */
  /**
   * B12 — "can I restore my backups on this server?", asked before it is needed.
   */
  @Permissions('backup.view')
  @Get('backup/restore-readiness')
  async getRestoreReadiness(@Res() res: Response) {
    try {
      const data = await this.backupService.getRestoreReadiness();
      return res.status(HttpStatus.OK).json({ success: true, data });
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      const status = getErrorStatus(error, HttpStatus.INTERNAL_SERVER_ERROR);
      return res.status(status).json({ success: false, message, error: message });
    }
  }
  @Permissions('backup.view')
  @Get('backup/health')
  async getBackupHealth(@Query('verify') verify: string | undefined, @Res() res: Response) {
    try {
      const health = await this.backupState.getHealth({
        verify: String(verify || '') === '1',
        refresh: String(verify || '') === '1',
      });
      return res.status(HttpStatus.OK).json({ success: true, data: health });
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      const status = getErrorStatus(error, HttpStatus.INTERNAL_SERVER_ERROR);
      return res.status(status).json({ success: false, message, error: message });
    }
  }
  /**
   * B10 — reconcile the archive directory against the manifest.
   *
   * `backup.view` is deliberately not enough: this removes files and reclaims disk.
   * `backup.delete` is the permission that already means "remove archives", and a sweep
   * that takes several gigabytes belongs to the same authority as deleting one.
   */
  @Permissions('backup.delete')
  @Post('backup/reconcile')
  async reconcileArchiveDirectory(@Req() req: Request, @Res() res: Response) {
    try {
      const report = await this.backupService.reconcileArchiveDirectory(
        this.actorFromRequest(req),
      );
      return res.status(HttpStatus.OK).json({ success: true, data: report });
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      const status = getErrorStatus(error, HttpStatus.INTERNAL_SERVER_ERROR);
      return res.status(status).json({ success: false, message, error: message });
    }
  }
  @Permissions('backup.view')
  @Get('backup/list')
  async listBackups(
    @Query('type') type: string | undefined,
    @Query('verify') verify: string | undefined,
    @Res() res: Response,
  ) {
    try {
      // B6 - verify=1 re-reads every archive instead of answering from the cache.
      // Without it there is no way to ask whether this is still true, and a green
      // badge that can only be re-checked on a timer is a claim, not a measurement.
      const data = await this.backupService.listBackups(this.resolveListType(type), {
        verify: String(verify || '') === '1',
      });
      return res.status(HttpStatus.OK).json({ success: true, data });
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      const status = getErrorStatus(error, HttpStatus.INTERNAL_SERVER_ERROR);
      return res.status(status).json({ success: false, message, error: message });
    }
  }

  @Permissions('backup.restore')
  @UseGuards(JwtAuthGuard)
  @Post('backup/restore')
  async restoreBackup(@Body() body: RestoreBackupBody, @Req() req: Request, @Res() res: Response) {
    const actor = this.actorFromRequest(req);
    try {
      if (actor.type !== 'user') {
        return res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          message: 'JWT user is required for restore',
        });
      }

      if (body?.confirmRestore) {
        const data = await this.backupService.applyRestore({
          backupId: String(body?.backupId || ''),
          restorePin: String(body?.restorePin || ''),
          restoreToken: String(body?.restoreToken || ''),
          actor,
          decryptionPassword: body?.decryptionPassword,
        });
        return res.status(HttpStatus.OK).json({ success: true, stage: 'applied', data });
      }

      const data = await this.backupService.createRestorePreview({
        backupId: String(body?.backupId || ''),
        restorePin: String(body?.restorePin || ''),
        actor,
        decryptionPassword: body?.decryptionPassword,
      });
      return res.status(HttpStatus.OK).json({ success: true, stage: 'preview', data });
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      const status = getErrorStatus(error, HttpStatus.BAD_REQUEST);
      // B4 — the failed half of the pair.
      //
      // A restore that dies partway through `pg_restore --clean` is the worst state
      // this system can be in, and it is exactly the one that used to leave no
      // trace: `RESTORE_APPLIED` is only written on success, so without this row
      // there is no record of the attempt at all. The stage is recorded because a
      // failed preview and a failed apply are different events — one took a safety
      // snapshot, the other destroyed the database.
      await this.backupService.recordRestoreFailure({
        actor,
        backupId: String(body?.backupId || ''),
        stage: body?.confirmRestore ? 'apply' : 'preview',
        reason: message,
      });
      return res.status(status).json({ success: false, message, error: message });
    }
  }

  @Permissions('backup.schedule')
  @Post('backup/schedule')
  async updateBackupSchedule(@Body() body: Record<string, unknown>, @Req() req: Request, @Res() res: Response) {
    try {
      const data = await this.backupService.updateSchedule(body || {}, this.actorFromRequest(req));
      return res.status(HttpStatus.OK).json({ success: true, data });
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      const status = getErrorStatus(error, HttpStatus.BAD_REQUEST);
      return res.status(status).json({ success: false, message, error: message });
    }
  }

  @Permissions('backup.view')
  @Get('backup/storage-stats')
  async getStorageStats(@Res() res: Response) {
    try {
      const data = await this.backupService.getStorageStats();
      return res.status(HttpStatus.OK).json({ success: true, data });
    } catch (error: unknown) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to read storage stats',
        error: getErrorMessage(error),
      });
    }
  }

  @Permissions('backup.download')
  @Get('backup/download/:id')
  async downloadBackup(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    try {
      const file = await this.backupService.downloadBackup(id, this.actorFromRequest(req));
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
      res.setHeader('X-Backup-Checksum', file.checksumSha256);
      return res.sendFile(file.filePath);
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      const status = getErrorStatus(error, HttpStatus.BAD_REQUEST);
      return res.status(status).json({ success: false, message, error: message });
    }
  }

  /**
   * B21 — the door back in.
   *
   * Downloading a backup and deleting it from the list used to leave the operator
   * holding a file the section would not read: no path accepted an archive from
   * outside, so the only copy of the data outside the system was unreachable and the
   * restore could not use it. This accepts one.
   *
   * On disk, not in memory. An archive carries the whole database as base64 — a
   * 500 MB dump becomes a ~680 MB file — and buffering that per request is the
   * failure B15 exists to remove. Multer writes it to the backup directory's own
   * `incoming/` folder, the service renames it into place only after every check
   * passes, and `onModuleDestroy` is not involved: nothing partially validated is
   * ever named as an archive.
   */
  @Permissions('backup.import')
  @Post('backup/import')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, callback) => {
          // Created here, awaited, and only then handed to multer. Calling back first
          // and creating it in the background is a race: multer opens the write stream the
          // moment it is given a directory, so the first upload after a fresh deploy lands
          // on a directory that does not exist yet and fails with an ENOENT that has
          // nothing to do with the file the operator chose.
          ensureIncomingDir()
            .then((dir) => callback(null, dir))
            .catch((error) => callback(error as Error, ''));
        },
        filename: (_req, file, callback) => {
          // A caller-supplied name is never used as a path. The suffix is checked so
          // that an operator who picks the wrong file is told, rather than a `.exe`
          // being written into the backup directory and read by the reconciler.
          if (!/\.ffbkp$/i.test(String(file?.originalname || ''))) {
            callback(new BadRequestException('الملف يجب أن يكون بامتداد ‎.ffbkp‎.'), '');
            return;
          }
          callback(null, `incoming-${Date.now()}-${randomBytes(6).toString('hex')}.ffbkp`);
        },
      }),
      limits: { fileSize: BACKUP_IMPORT_MAX_BYTES, files: 1 },
    }),
  )
  async importBackup(
    // `any` rather than `Express.Multer.File`, matching the existing upload routes:
    // the multer types are not installed in this workspace, and a cast here is
    // cheaper than pretending a type exists.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @UploadedFile() file: any,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const originalName = String(file?.originalname || 'archive.ffbkp');
    if (!file) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'لم يُرفَق ملف. اختر ملف نسخة احتياطية ‎.ffbkp‎ ثم أعد المحاولة.',
        code: 'BACKUP_IMPORT_NO_FILE',
      });
    }

    try {
      const data = await this.backupService.importArchive({
        filePath: file.path,
        originalName,
        actor: this.actorFromRequest(req),
        decryptionPassword: body?.decryptionPassword ? String(body.decryptionPassword) : undefined,
      });
      return res.status(HttpStatus.CREATED).json({ success: true, data });
    } catch (error: unknown) {
      // Every refusal leaves a file in `incoming/`. Left alone it accumulates, and a
      // folder of half-imported archives is indistinguishable from a store that
      // works.
      await fsPromises.unlink(file.path).catch(() => undefined);
      const message = getErrorMessage(error);
      const status = getErrorStatus(error, HttpStatus.BAD_REQUEST);
      return res.status(status).json({ success: false, message, error: message });
    }
  }

  @Permissions('backup.delete')
  @Delete('backup/:id')
  async deleteBackup(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    try {
      const data = await this.backupService.deleteBackup(id, this.actorFromRequest(req));
      return res.status(HttpStatus.OK).json({ success: true, data });
    } catch (error: unknown) {
      // B2 — this catch flattened every failure into a 500, so the refusals the
      // service now makes (last copy, pinned snapshot, unknown id) would all have
      // reached the operator as "Failed to delete backup". The distinction is the
      // entire point of refusing.
      const message = getErrorMessage(error);
      const status = getErrorStatus(error, HttpStatus.INTERNAL_SERVER_ERROR);
      return res.status(status).json({ success: false, message, error: message });
    }
  }

  // Legacy routes kept for backward compatibility.
  @Permissions('backup.create')
  @Post('backup/create')
  async createProductionBackup(@Res() res: Response) {
    try {
      const data = await this.backupService.createProductionBackup();
      return res.status(HttpStatus.OK).json({ success: true, data });
    } catch (error: unknown) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to create backup',
        error: getErrorMessage(error),
      });
    }
  }

  @Permissions('backup.create')
  @Post('backups/full')
  async createLegacyFull(@Body() body: BackupCreateBody, @Req() req: Request, @Res() res: Response) {
    return this.createFullSystemBackup(body, req, res);
  }

  @Permissions('backup.create')
  @Post('backups/incremental')
  async createLegacyIncremental(@Body() body: BackupCreateBody, @Req() req: Request, @Res() res: Response) {
    return this.createInventoryBackup(body, req, res);
  }

  @Permissions('backup.view')
  @Get('backups/restore-points')
  async getLegacyRestorePoints(@Res() res: Response) {
    return this.listBackups(undefined, undefined, res);
  }
}
