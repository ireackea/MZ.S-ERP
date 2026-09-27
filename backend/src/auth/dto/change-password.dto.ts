import { IsString, MinLength } from 'class-validator';

/**
 * FC-SEC-010 — self-service password change.
 *
 * The current password is required so an unattended or borrowed session cannot
 * take the account over silently. The new password is only length-checked here;
 * the full policy lives in `common/password-policy.ts` and is enforced by the
 * service so one rule set serves the bootstrap admin, this endpoint and the
 * admin reset alike.
 */
export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}
