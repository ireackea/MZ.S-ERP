import { IsArray, IsString } from 'class-validator';

export class DeleteTransactionsDto {
  @IsArray()
  @IsString({ each: true })
  ids!: string[];
}
