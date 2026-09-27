import { Body, Controller, Delete, Get, Headers, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { CreatePartnerDto, UpdatePartnerDto } from './dto/partner.dto';
import { PartnersService } from './partners.service';

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('partners')
export class PartnersController {
  constructor(private readonly partnersService: PartnersService) {}

  @Permissions('partners.view')
  @Get()
  list() {
    return this.partnersService.list();
  }

  @Permissions('partners.create')
  @Post()
  create(@Body() dto: CreatePartnerDto, @Headers('idempotency-key') key: string | undefined, @Req() req: any) {
    return this.partnersService.create(dto, req.user?.sub || req.user?.id, req.user?.username, key);
  }

  @Permissions('partners.update')
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePartnerDto, @Headers('idempotency-key') key: string | undefined, @Req() req: any) {
    return this.partnersService.update(id, dto, req.user?.sub || req.user?.id, req.user?.username, key);
  }

  @Permissions('partners.delete')
  @Delete(':id')
  remove(@Param('id') id: string, @Headers('idempotency-key') key: string | undefined, @Req() req: any) {
    return this.partnersService.remove(id, req.user?.sub || req.user?.id, req.user?.username, key);
  }
}
