import {
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
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RbacGuard } from '../auth/rbac.guard';
import { BackupGuard } from './backup.guard';
import { BackupService, BackupType } from './backup.service';

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
  constructor(private readonly backupService: BackupService) {}

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
  @Roles('Admin', 'SuperAdmin')
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
  @Roles('Admin', 'SuperAdmin')
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
  @Roles('Admin', 'SuperAdmin')
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

  @Permissions('backup.view')
  @Roles('Admin', 'SuperAdmin')
  @Get('backup/list')
  async listBackups(@Query('type') type: string | undefined, @Res() res: Response) {
    try {
      const data = await this.backupService.listBackups(this.resolveListType(type));
      return res.status(HttpStatus.OK).json({ success: true, data });
    } catch (error: unknown) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to list backups',
        error: getErrorMessage(error),
      });
    }
  }

  @Permissions('backup.restore')
  @Roles('Admin', 'SuperAdmin')
  @UseGuards(JwtAuthGuard)
  @Post('backup/restore')
  async restoreBackup(@Body() body: RestoreBackupBody, @Req() req: Request, @Res() res: Response) {
    try {
      const actor = this.actorFromRequest(req);
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
      return res.status(status).json({ success: false, message, error: message });
    }
  }

  @Permissions('backup.schedule')
  @Roles('Admin', 'SuperAdmin')
  @Post('backup/schedule')
  async updateBackupSchedule(@Body() body: Record<string, unknown>, @Res() res: Response) {
    try {
      const data = await this.backupService.updateSchedule(body || {});
      return res.status(HttpStatus.OK).json({ success: true, data });
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      const status = getErrorStatus(error, HttpStatus.BAD_REQUEST);
      return res.status(status).json({ success: false, message, error: message });
    }
  }

  @Permissions('backup.view')
  @Roles('Admin', 'SuperAdmin')
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
  @Roles('Admin', 'SuperAdmin')
  @Get('backup/download/:id')
  async downloadBackup(@Param('id') id: string, @Res() res: Response) {
    try {
      const file = await this.backupService.downloadBackup(id);
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

  @Permissions('backup.delete')
  @Roles('Admin', 'SuperAdmin')
  @Delete('backup/:id')
  async deleteBackup(@Param('id') id: string, @Res() res: Response) {
    try {
      const data = await this.backupService.deleteBackup(id);
      return res.status(HttpStatus.OK).json({ success: true, data });
    } catch (error: unknown) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to delete backup',
        error: getErrorMessage(error),
      });
    }
  }

  // Legacy routes kept for backward compatibility.
  @Permissions('backup.create')
  @Roles('Admin', 'SuperAdmin')
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
  @Roles('Admin', 'SuperAdmin')
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
    return this.listBackups(undefined, res);
  }
}
