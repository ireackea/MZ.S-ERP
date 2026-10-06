import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * The catalog order, as the client currently displays it.
 *
 * `publicId` rather than the internal `id`, for two reasons: it is the currency
 * every other item endpoint already speaks, and it is the one identifier an
 * imported catalog is guaranteed to have.
 */
export class ReorderItemsDto {
  @IsArray()
  // Bounded because the endpoint writes one row per entry inside a single
  // transaction. An unbounded array is an unbounded transaction.
  @ArrayMaxSize(5000, {
    message: 'the catalog order cannot exceed 5000 items',
  })
  // A duplicated id would assign two different ranks to the same row and leave
  // the last write to win, which is an order nobody chose.
  @ArrayUnique({ message: 'the catalog order contains the same item more than once' })
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  orderedPublicIds!: string[];
}

export class ListItemsQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit = 100;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  isArchived?: string;
}

export class CreateItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  publicId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  unit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(999999999.999)
  minLimit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(999999999.999)
  maxLimit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(999999999.999)
  orderLimit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(999999999.999)
  packageWeight?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  // The English name. Stored since migration 20260929110000; until then the column
  // did not exist, so the studio's field, the template's column and the payload's key
  // all described something the database had nowhere to put.
  @IsOptional()
  @IsString()
  @MaxLength(255)
  englishName?: string;
}

export class UpdateItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  unit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(999999999.999)
  minLimit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(999999999.999)
  maxLimit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(999999999.999)
  orderLimit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(999999999.999)
  packageWeight?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  // The English name. Stored since migration 20260929110000; until then the column
  // did not exist, so the studio's field, the template's column and the payload's key
  // all described something the database had nowhere to put.
  @IsOptional()
  @IsString()
  @MaxLength(255)
  englishName?: string;
}
