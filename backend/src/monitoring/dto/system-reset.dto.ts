// ENTERPRISE FIX: Phase 7 - Advanced System Reset Module with Multi-Layer Security - 2026-04-29
import { IsString, IsNotEmpty, IsOptional, IsIn, MinLength, MaxLength, IsBoolean } from 'class-validator';

export type SystemResetScope = 'full' | 'data' | 'inventory' | 'audit';

export const SYSTEM_RESET_SCOPES: SystemResetScope[] = ['full', 'data', 'inventory', 'audit'];

export class SystemResetDto {
  // FC-SEC-003: the acting SuperAdmin re-enters their own password. The backend
  // verifies it against the stored bcrypt hash, so no shared secret is ever
  // typed into or held by the browser. Acts as the "knowledge" factor.
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(128)
  confirmationCode!: string;

  // Per-session one-time challenge code returned by /admin/reset-system/challenge.
  // Required as a second factor; protects against accidental token leakage.
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  @MaxLength(64)
  challengeCode!: string;

  // Identifier paired with the challenge code; binds the request to a single issued challenge.
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(64)
  challengeId!: string;

  // Mandatory human-written justification persisted in AuditLog.
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;

  // Scope of the reset.
  @IsString()
  @IsIn(SYSTEM_RESET_SCOPES)
  scope!: SystemResetScope;

  // When true, the backend takes a safety backup BEFORE truncation.
  @IsBoolean()
  @IsOptional()
  createBackup?: boolean;

  // Legacy / informational fields kept for backward compatibility.
  @IsString()
  @IsOptional()
  auditReason?: string;

  @IsString()
  @IsOptional()
  timestamp?: string;
}

export class ResetPreviewDto {
  @IsString()
  @IsIn(SYSTEM_RESET_SCOPES)
  scope!: SystemResetScope;
}

export class ResetChallengeDto {
  @IsString()
  @IsOptional()
  @IsIn(SYSTEM_RESET_SCOPES)
  scope?: SystemResetScope;
}
