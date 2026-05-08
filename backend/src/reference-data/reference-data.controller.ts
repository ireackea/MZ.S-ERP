import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { RbacGuard } from '../auth/rbac.guard';
import { SaveReferenceDataValueDto } from './dto/save-reference-data-value.dto';
import { ReferenceDataService } from './reference-data.service';

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('reference-data')
export class ReferenceDataController {
  constructor(private readonly referenceDataService: ReferenceDataService) {}

  @Permissions('settings.view.general')
  @Get()
  async findAll() {
    return { data: await this.referenceDataService.findAll() };
  }

  @Permissions('settings.update.system')
  @Post('categories')
  @HttpCode(HttpStatus.OK)
  async createCategory(@Body() dto: SaveReferenceDataValueDto, @Req() req: any) {
    return { data: await this.referenceDataService.createValue('category', dto, this.actorFromRequest(req)) };
  }

  @Permissions('settings.update.system')
  @Post('units')
  @HttpCode(HttpStatus.OK)
  async createUnit(@Body() dto: SaveReferenceDataValueDto, @Req() req: any) {
    return { data: await this.referenceDataService.createValue('unit', dto, this.actorFromRequest(req)) };
  }

  @Permissions('settings.update.system')
  @Post('categories/delete')
  @HttpCode(HttpStatus.OK)
  async deleteCategory(@Body() dto: SaveReferenceDataValueDto, @Req() req: any) {
    return { data: await this.referenceDataService.deleteValue('category', dto.value, this.actorFromRequest(req)) };
  }

  @Permissions('settings.update.system')
  @Post('units/delete')
  @HttpCode(HttpStatus.OK)
  async deleteUnit(@Body() dto: SaveReferenceDataValueDto, @Req() req: any) {
    return { data: await this.referenceDataService.deleteValue('unit', dto.value, this.actorFromRequest(req)) };
  }

  private actorFromRequest(req: any) {
    return {
      userId: req.user?.sub || req.user?.id,
      actorUsername: req.user?.username,
    };
  }
}