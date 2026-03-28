// ENTERPRISE FIX: Phase 0.3 – Final Arabic Encoding Fix & 10/10 Declaration - 2026-03-13
// ENTERPRISE FIX: Arabic Encoding Auto-Fixed - 2026-03-13
// ENTERPRISE FIX: Phase 0.1 – Final Encoding & Lock Fix - 2026-03-13
import { IsBoolean, IsEmail, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @MinLength(3)
  username!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsOptional()
  @IsUUID('4')  // UUID v4 validation compatible with Prisma identifiers
  roleId?: string;

  @IsOptional()
  @IsString()
  roleName?: string;  // Fallback

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
