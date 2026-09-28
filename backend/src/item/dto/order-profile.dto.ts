import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Naming a saved catalogue order. */
export class CreateOrderProfileDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  /** A note is for the operator; nothing reads it but the list that shows it. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class RenameOrderProfileDto {
  @IsString()
  @MaxLength(120)
  name!: string;
}
