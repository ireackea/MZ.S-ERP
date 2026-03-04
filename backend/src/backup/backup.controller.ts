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
    const user = (request as any)?.user;
    if (user && (user.id || user.username)) {
      return {
        type: 'user' as const,
        mode: 'manual' as const,
        userId: user.id ? String(user.id) : undefined,
        username: String(user.username || user.name || 'user'),
        role: String(user.role || 'user'),
      };
    }

    const backupActor = (request as any)?.backupActor;
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
  async createFullSystemBackup(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    try {
      const data = await this.backupService.createBackup({
        type: 'full',
        actor: this.actorFromRequest(req),
        encryptionPassword: body?.encryptionPassword,
      });
      return res.status(HttpStatus.OK).json({ success: true, data });
    } catch (error: any) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to create full backup',
        error: error?.message || 'unknown_error',
      });
    }
  }

  @Permissions('backup.create')
  @Post('backup/inventory')
  async createInventoryBackup(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    try {
      const data = await this.backupService.createBackup({
        type: 'inventory',
        actor: this.actorFromRequest(req),
        encryptionPassword: body?.encryptionPassword,
      });
      return res.status(HttpStatus.OK).json({ success: true, data });
    } catch (error: any) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to create inventory backup',
        error: error?.message || 'unknown_error',
      });
    }
  }

  @Permissions('backup.create')
  @Post('backup/config')
  async createConfigBackup(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    try {
      const data = await this.backupService.createBackup({
        type: 'config',
        actor: this.actorFromRequest(req),
        encryptionPassword: body?.encryptionPassword,
      });
      return res.status(HttpStatus.OK).json({ success: true, data });
    } catch (error: any) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to create config backup',
        error: error?.message || 'unknown_error',
      });
    }
  }

  @Permissions('backup.view')
  @Get('backup/list')
  async listBackups(@Query('type') type: string | undefined, @Res() res: Response) {
    try {
      const data = await this.backupService.listBackups(this.resolveListType(type));
      return res.status(HttpStatus.OK).json({ success: true, data });
    } catch (error: any) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to list backups',
        error: error?.message || 'unknown_error',
      });
    }
  }

  @Permissions('backup.restore')
  @Roles('Admin', 'SuperAdmin')
  @UseGuards(JwtAuthGuard)
  @Post('backup/restore')
  async restoreBackup(@Body() body: any, @Req() req: Request, @Res() res: Response) {
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
    } catch (error: any) {
      const message = error?.message || 'unknown_error';
      const status = error?.status || HttpStatus.BAD_REQUEST;
      return res.status(status).json({ success: false, message, error: message });
    }
  }

  @Permissions('backup.schedule')
  @Roles('Admin', 'SuperAdmin')
  @Post('backup/schedule')
  async updateBackupSchedule(@Body() body: any, @Res() res: Response) {
    try {
      const data = await this.backupService.updateSchedule(body || {});
      return res.status(HttpStatus.OK).json({ success: true, data });
    } catch (error: any) {
      const message = error?.message || 'unknown_error';
      const status = error?.status || HttpStatus.BAD_REQUEST;
      return res.status(status).json({ success: false, message, error: message });
    }
  }

  @Permissions('backup.view')
  @Get('backup/storage-stats')
  async getStorageStats(@Res() res: Response) {
    try {
      const data = await this.backupService.getStorageStats();
      return res.status(HttpStatus.OK).json({ success: true, data });
    } catch (error: any) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to read storage stats',
        error: error?.message || 'unknown_error',
      });
    }
  }

  @Permissions('backup.download')
  @Get('backup/download/:id')
  async downloadBackup(@Param('id') id: string, @Res() res: Response) {
    try {
      const file = await this.backupService.downloadBackup(id);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
      res.setHeader('X-Backup-Checksum', file.checksumSha256);
      return res.sendFile(file.filePath);
    } catch (error: any) {
      const message = error?.message || 'unknown_error';
      const status = error?.status || HttpStatus.BAD_REQUEST;
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
    } catch (error: any) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to delete backup',
        error: error?.message || 'unknown_error',
      });
    }
  }

  // Legacy routes kept for backward compatibility.
  @Permissions('backup.create')
  @Post('backup/create')
  async createProductionBackup(@Res() res: Response) {
    try {
      const data = await this.backupService.createProductionBackup();
      return res.status(HttpStatus.OK).json({ success: true, data });
    } catch (error: any) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to create backup',
        error: error?.message || 'unknown_error',
      });
    }
  }

  @Permissions('backup.create')
  @Post('api/backups/full')
  async createLegacyFull(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    return this.createFullSystemBackup(body, req, res);
  }

  @Permissions('backup.create')
  @Post('api/backups/incremental')
  async createLegacyIncremental(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    return this.createInventoryBackup(body, req, res);
  }

  @Permissions('backup.view')
  @Get('api/backups/restore-points')
  async getLegacyRestorePoints(@Res() res: Response) {
    return this.listBackups(undefined, res);
  }
}
