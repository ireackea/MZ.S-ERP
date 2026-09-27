import { IsString, MinLength } from 'class-validator';

/** FC-SEC-010 — administrator-issued temporary password. */
export class ResetPasswordDto {
  @IsString()
  @MinLength(8)
  newPassword!: string;
}
