// ENTERPRISE FIX: Phase 5 Bulk Import + Barcode + Attachments + Audit Viewer - Archive Only - 2026-03-27
// ENTERPRISE FIX: Phase 4 Audit Logging + Soft Delete Backend + Pagination - Archive Only - 2026-03-27
import { Body, Controller, Post, UseGuards, Get, Query, Req, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { BulkSyncDto } from './dto/sync-items.dto';
import { ItemService } from './item.service';
import { DeleteItemsDto } from './dto/delete-items.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RbacGuard } from '../auth/rbac.guard';

export class BulkImportDto {
  items!: Array<{
    name: string;
    code?: string;
    barcode?: string;
    category?: string;
    unit?: string;
    minLimit?: number;
    maxLimit?: number;
    orderLimit?: number;
    currentStock?: number;
    description?: string;
  }>;
}

export class ArchiveItemsDto {
  publicIds!: string[];
  userId?: string;
  actorUsername?: string;
}

export class RestoreItemsDto {
  publicIds!: string[];
  userId?: string;
  actorUsername?: string;
}

export class DeleteItemsPermanentDto {
  publicIds!: string[];
  userId?: string;
  actorUsername?: string;
}

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('items')
export class ItemController {
  constructor(private readonly itemService: ItemService) {}

  @Permissions('items.sync')
  @Post('sync')
  async sync(@Body() dto: BulkSyncDto, @Req() req: any) {
    const userId = req.user?.sub || req.user?.id;
    const actorUsername = req.user?.username;
    return this.itemService.syncItems(dto.items, userId, actorUsername);
  }

  @Permissions('items.delete')
  @Roles('Admin', 'SuperAdmin')
  @Post('delete')
  async deleteMany(@Body() dto: DeleteItemsDto) {
    return this.itemService.deleteByPublicIds(dto.publicIds);
  }

  @Permissions('items.archive')
  @Post('archive')
  async archive(@Body() dto: ArchiveItemsDto, @Req() req: any) {
    const userId = req.user?.sub || req.user?.id;
    const actorUsername = req.user?.username;
    return this.itemService.archiveItems(dto.publicIds, userId, actorUsername);
  }

  @Permissions('items.restore')
  @Post('restore')
  async restore(@Body() dto: RestoreItemsDto, @Req() req: any) {
    const userId = req.user?.sub || req.user?.id;
    const actorUsername = req.user?.username;
    return this.itemService.restoreItems(dto.publicIds, userId, actorUsername);
  }

  @Permissions('items.delete')
  @Roles('Admin', 'SuperAdmin')
  @Post('delete-permanent')
  async deletePermanent(@Body() dto: DeleteItemsPermanentDto, @Req() req: any) {
    const userId = req.user?.sub || req.user?.id;
    const actorUsername = req.user?.username;
    return this.itemService.deletePermanently(dto.publicIds, userId, actorUsername);
  }

  @Permissions('items.generate_codes')
  @Post('generate-codes')
  async generateMissingCodes(@Req() req: any) {
    const userId = req.user?.sub || req.user?.id;
    const actorUsername = req.user?.username;
    return this.itemService.generateMissingCodes(userId, actorUsername);
  }

  @Permissions('items.view')
  @Get()
  async list(
    @Query('page') page = 1,
    @Query('limit') limit = 100,
    @Query('search') search?: string,
    @Query('category') category?: string,
    @Query('isArchived') isArchived?: string,
  ) {
    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);
    const isArchivedBool = isArchived === 'true';

    return this.itemService.findAll({
      skip,
      take,
      search,
      category,
      isArchived: isArchivedBool,
    });
  }

  // Phase 5: Bulk Import from Excel (JSON payload)
  @Permissions('items.import')
  @Post('import-excel')
  async importExcel(@Body() dto: BulkImportDto, @Req() req: any) {
    const userId = req.user?.sub || req.user?.id;
    const actorUsername = req.user?.username;
    return this.itemService.bulkImportFromExcel(dto.items, userId, actorUsername);
  }

  // Phase 5: Upload Image Attachment
  @Permissions('items.upload')
  @Post(':publicId/upload-image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads/items',
        filename: (req, file, callback) => {
          const publicId = req.params.publicId;
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
          const ext = extname(file.originalname);
          callback(null, `${publicId}-${uniqueSuffix}${ext}`);
        },
      }),
      fileFilter: (req, file, callback) => {
        if (!file.mimetype.startsWith('image/')) {
          return callback(new Error('Only image files are allowed'), false);
        }
        callback(null, true);
      },
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    }),
  )
  async uploadImage(@Req() req: any, @UploadedFile() file: any) {
    const userId = req.user?.sub || req.user?.id;
    const actorUsername = req.user?.username;
    const publicId = req.params.publicId;
    return this.itemService.uploadAttachment(publicId, file, 'image', userId, actorUsername);
  }

  // Phase 5: Upload File Attachment
  @Permissions('items.upload')
  @Post(':publicId/upload-file')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads/items',
        filename: (req, file, callback) => {
          const publicId = req.params.publicId;
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
          const ext = extname(file.originalname);
          callback(null, `${publicId}-${uniqueSuffix}${ext}`);
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    }),
  )
  async uploadFile(@Req() req: any, @UploadedFile() file: any) {
    const userId = req.user?.sub || req.user?.id;
    const actorUsername = req.user?.username;
    const publicId = req.params.publicId;
    return this.itemService.uploadAttachment(publicId, file, 'file', userId, actorUsername);
  }
}
