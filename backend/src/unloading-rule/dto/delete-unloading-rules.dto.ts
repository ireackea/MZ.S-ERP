import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';

export class DeleteUnloadingRulesDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  ids!: string[];
}