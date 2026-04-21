import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { RbacGuard } from '../auth/rbac.guard';
import { FormulationService } from './formulation.service';
import { SaveFormulationDto } from './dto/save-formulation.dto';
import { DeleteFormulationsDto } from './dto/delete-formulations.dto';

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('formulations')
export class FormulationController {
  constructor(private readonly formulationService: FormulationService) {}

  @Permissions('formulation.view')
  @Get()
  async findAll() {
    return { data: await this.formulationService.findAll() };
  }

  @Permissions('formulation.create')
  @Post()
  @HttpCode(HttpStatus.OK)
  async create(@Body() dto: SaveFormulationDto, @Req() req: any) {
    const userId = req.user?.sub || req.user?.id;
    const actorUsername = req.user?.username;
    return { data: await this.formulationService.create(dto, { userId, actorUsername }) };
  }

  @Permissions('formulation.update')
  @Put(':id')
  @HttpCode(HttpStatus.OK)
  async update(@Param('id') id: string, @Body() dto: SaveFormulationDto, @Req() req: any) {
    const userId = req.user?.sub || req.user?.id;
    const actorUsername = req.user?.username;
    return { data: await this.formulationService.update(id, dto, { userId, actorUsername }) };
  }

  @Permissions('formulation.delete')
  @Post('delete')
  @HttpCode(HttpStatus.OK)
  async deleteMany(@Body() dto: DeleteFormulationsDto, @Req() req: any) {
    const userId = req.user?.sub || req.user?.id;
    const actorUsername = req.user?.username;
    return this.formulationService.deleteMany(dto.ids, { userId, actorUsername });
  }
}