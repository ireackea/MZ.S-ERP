import { IsString, IsNotEmpty } from 'class-validator';

export class SystemResetDto {
  @IsString()
  @IsNotEmpty()
  confirmationCode: string;

  @IsString()
  auditReason?: string;

  @IsString()
  timestamp?: string;
}
