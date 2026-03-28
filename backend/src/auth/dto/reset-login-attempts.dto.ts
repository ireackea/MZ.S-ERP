import { IsString, MinLength } from 'class-validator';

export class ResetLoginAttemptsDto {
  @IsString()
  @MinLength(1)
  username!: string;
}