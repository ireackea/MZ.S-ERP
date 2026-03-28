// ENTERPRISE FIX: Phase 2 - Multi-User Sync - Final Completion Pass - 2026-03-02
import { IsEmail, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class InviteUserDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsUUID('4')
  roleId?: string;

  @IsOptional()
  @IsString()
  roleName?: string;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(60 * 24 * 14)
  expiresInMinutes?: number;
}
