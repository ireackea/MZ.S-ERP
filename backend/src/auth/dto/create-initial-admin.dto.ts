import { IsEmail, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

/**
 * FC-SEC-003 — one-time first-run bootstrap.
 *
 * Replaces the client-side admin provisioning that used to write a password
 * hash straight into localStorage. The password is only ever seen by the
 * backend, which hashes it with bcrypt and stores it in Postgres.
 */
export class CreateInitialAdminDto {
  @IsString()
  @Length(3, 60)
  firstName: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  lastName?: string;

  @IsEmail({}, { message: 'email must be a valid address' })
  email: string;

  @IsString()
  @Length(1, 60)
  @Matches(/^[A-Za-z0-9._-]+$/, { message: 'username may only contain letters, digits, dot, underscore or dash' })
  username: string;

  @IsString()
  @Length(12, 128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message: 'password must contain a lowercase letter, an uppercase letter and a digit',
  })
  password: string;
}
