import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class ClientLogDto {
  @IsOptional()
  @IsIn(['info', 'warn', 'error'])
  level?: 'info' | 'warn' | 'error';

  @IsString()
  @MaxLength(500)
  message!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  source?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
