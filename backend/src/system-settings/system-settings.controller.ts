import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { Allow, IsArray, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { SystemSettingsService, SETTING_CATALOGUE, SETTING_VALUE_TYPES, SettingValueType } from './system-settings.service';

/**
 * Gate 2.1 — company settings on the server.
 *
 * The "general settings" screen used to write into a Zustand store and nowhere
 * else: `saveSettings` in storage.ts had zero call sites and there was no settings
 * module in the backend, so an administrator changed the company name, was told it
 * was saved, and found the defaults back after a reload — on a value printed at
 * the top of every stock card, statement and daily-operations print.
 *
 * The catalogue lives in the service, not here, because the service is what both
 * the HTTP layer and any future job need. One key, one owner, one read path.
 */
export class SettingValueDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Matches(/^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)*$/, {
    message: 'key must be a dotted identifier such as company.name',
  })
  key!: string;

  /**
   * Validated against the catalogue's declared type in the service, not here.
   *
   * A value's type depends on which key it is, so a DTO cannot express it without
   * duplicating the catalogue — and a duplicated catalogue is a second authority,
   * which is the problem this change exists to remove.
   *
   * `@Allow` is required, not decorative: the global ValidationPipe runs with
   * `forbidNonWhitelisted`, and a property with no validation decorator is treated
   * as not belonging to the DTO. Without it the request is rejected with
   * "property value should not exist" — which is what it did.
   */
  @Allow()
  value!: unknown;

  @IsOptional() @IsIn(SETTING_VALUE_TYPES) valueType?: SettingValueType;

  /**
   * The `updatedAt` the client read for this key.
   *
   * Compare-and-set rather than a blind write: two administrators with the screen open
   * would otherwise have the second save erase the first one's company name, and the
   * audit log would show two correct saves with the wrong final value. Declared with a
   * validator because the global pipe runs `forbidNonWhitelisted` and would otherwise
   * reject the request with "property expectedUpdatedAt should not exist".
   */
  @IsOptional() @IsString() @MaxLength(40) expectedUpdatedAt?: string;

  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class UpdateSystemSettingsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SettingValueDto)
  settings!: SettingValueDto[];

  /** One justification for the batch, written to every row it touches. */
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

/**
 * `JwtAuthGuard, RbacGuard` on the class, the way every other controller here does
 * it — there is no global guard in this application, so a controller that omits
 * this is not merely unguarded, it is unauthenticated.
 *
 * Caught by testing rather than by reading: the first version of this controller
 * had only `@Permissions`, and `GET /system-settings` and `PUT /system-settings`
 * both answered 200 with no session at all. A `@Permissions` decorator is metadata;
 * nothing reads it unless a guard does.
 */
@Controller('system-settings')
@UseGuards(JwtAuthGuard, RbacGuard)
export class SystemSettingsController {
  constructor(private readonly service: SystemSettingsService) {}

  /** Merged over the catalogue, so a new setting needs no frontend change. */
  @Permissions('settings.view.general')
  @Get()
  async getAll() {
    return this.service.getAll();
  }

  @Permissions('settings.update.system')
  @Put()
  async update(@Body() dto: UpdateSystemSettingsDto, @Req() req: any) {
    return this.service.update(dto, String(req?.user?.id || '').trim() || null);
  }
}

export { SETTING_CATALOGUE, SETTING_VALUE_TYPES };
