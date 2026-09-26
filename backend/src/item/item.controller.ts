// ENTERPRISE FIX: Phase 5 Bulk Import + Barcode + Attachments + Audit Viewer - Archive Only - 2026-03-27
// ENTERPRISE FIX: Phase 4 Audit Logging + Soft Delete Backend + Pagination - Archive Only - 2026-03-27
import { Body, Controller, Post, UseGuards, Get, Query, Req, Res, UseInterceptors, UploadedFile, Put, Param } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import {
  LIMITS,
  buildAttachmentName,
  isAllowedDocumentMime,
  isImageMime,
} from './attachment-safety';
import { extname } from 'path';
import { BulkSyncDto } from './dto/sync-items.dto';
import { BulkImportDto } from './dto/bulk-import.dto';
import { CreateItemDto, ListItemsQueryDto, UpdateItemDto } from './dto/item.dto';
import { ItemService } from './item.service';
import { DeleteItemsDto } from './dto/delete-items.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RbacGuard } from '../auth/rbac.guard';

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('items')
export class ItemController {
  constructor(private readonly itemService: ItemService) {}

  @Permissions('items.create')
  @Post()
  async create(@Body() dto: CreateItemDto, @Req() req: any) {
    return this.itemService.create(dto, req.user?.sub || req.user?.id, req.user?.username);
  }

  @Permissions('items.update')
  @Put(':publicId')
  async update(@Param('publicId') publicId: string, @Body() dto: UpdateItemDto, @Req() req: any) {
    return this.itemService.update(publicId, dto, req.user?.sub || req.user?.id, req.user?.username);
  }

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
  async archive(@Body() dto: DeleteItemsDto, @Req() req: any) {
    const userId = req.user?.sub || req.user?.id;
    const actorUsername = req.user?.username;
    return this.itemService.archiveItems(dto.publicIds, userId, actorUsername);
  }

  @Permissions('items.restore')
  @Post('restore')
  async restore(@Body() dto: DeleteItemsDto, @Req() req: any) {
    const userId = req.user?.sub || req.user?.id;
    const actorUsername = req.user?.username;
    return this.itemService.restoreItems(dto.publicIds, userId, actorUsername);
  }

  @Permissions('items.delete')
  @Roles('Admin', 'SuperAdmin')
  @Post('delete-permanent')
  async deletePermanent(@Body() dto: DeleteItemsDto, @Req() req: any) {
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
  async list(@Query() query: ListItemsQueryDto) {
    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;
    const isArchivedBool = query.isArchived === 'true';

    return this.itemService.findAll({
      skip,
      take: limit,
      search: query.search,
      category: query.category,
      isArchived: isArchivedBool,
    });
  }

  @Permissions('items.view')
  @Get(':publicId')
  async getByPublicId(@Param('publicId') publicId: string) {
    return this.itemService.getByPublicId(publicId);
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
  // FC-ITEM-001 — the generated name is produced once, here, and is the only
  // identity the service persists. The original name never becomes a path.
  @Permissions('items.upload')
  @Post(':publicId/upload-image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads/items',
        filename: (req, file, callback) => {
          const built = buildAttachmentName({
            publicId: req.params.publicId,
            originalName: file.originalname,
            mimetype: file.mimetype,
            // multer has not finished writing, so size is unknown here; the
            // service re-validates the real size before persisting.
            size: Number(file.size) > 0 ? Number(file.size) : 1,
            kind: 'image',
          });
          if (built.ok === false) return callback(new Error(built.error), '');
          // Carried forward so the service persists exactly this name.
          (req as any).generatedAttachmentName = built.value.storedName;
          (req as any).generatedAttachment = built.value;
          callback(null, built.value.storedName);
        },
      }),
      fileFilter: (req, file, callback) => {
        if (!isImageMime(file.mimetype)) {
          return callback(new Error('Only image files are allowed'), false);
        }
        callback(null, true);
      },
      limits: { fileSize: LIMITS.image.bytes },
    }),
  )
  async uploadImage(@Req() req: any, @UploadedFile() file: any) {
    const userId = req.user?.sub || req.user?.id;
    const actorUsername = req.user?.username;
    const publicId = req.params.publicId;
    return this.itemService.uploadAttachment(publicId, file, 'image', userId, actorUsername, {
      prebuilt: (req as any).generatedAttachment,
    });
  }

  // Phase 5: Upload File Attachment
  @Permissions('items.upload')
  @Post(':publicId/upload-file')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads/items',
        filename: (req, file, callback) => {
          const built = buildAttachmentName({
            publicId: req.params.publicId,
            originalName: file.originalname,
            mimetype: file.mimetype,
            size: Number(file.size) > 0 ? Number(file.size) : 1,
            kind: 'file',
          });
          if (built.ok === false) return callback(new Error(built.error), '');
          (req as any).generatedAttachmentName = built.value.storedName;
          (req as any).generatedAttachment = built.value;
          callback(null, built.value.storedName);
        },
      }),
      fileFilter: (req, file, callback) => {
        // A file attachment may be an image or a document, but never an
        // executable or a script the browser could be tricked into running.
        if (isImageMime(file.mimetype)) return callback(null, true);
        if (isAllowedDocumentMime(file.mimetype)) return callback(null, true);
        return callback(new Error('Unsupported file type'), false);
      },
      limits: { fileSize: LIMITS.file.bytes },
    }),
  )
  async uploadFile(@Req() req: any, @UploadedFile() file: any) {
    const userId = req.user?.sub || req.user?.id;
    const actorUsername = req.user?.username;
    const publicId = req.params.publicId;
    return this.itemService.uploadAttachment(publicId, file, 'file', userId, actorUsername, {
      prebuilt: (req as any).generatedAttachment,
    });
  }

  // FC-ITEM-001 — serving is path-derived from the generated name only, and a
  // traversal attempt cannot escape the upload root.
  @Permissions('items.view')
  @Get('attachments/:storedName')
  async getAttachment(@Param('storedName') storedName: string, @Res() res: any) {
    return this.itemService.serveAttachment(storedName, res);
  }
}
