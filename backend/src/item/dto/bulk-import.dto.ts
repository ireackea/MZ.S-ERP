import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_BULK_IMPORT_ROWS } from '../import-limits';

/**
 * The row shape the Excel import accepts.
 *
 * Every field here is a field an operator can put in a spreadsheet, so the DTO is
 * the only thing standing between a file and a catalogue. It was missing three
 * guarantees that the single-item routes already had, and each one was reachable
 * from an ordinary spreadsheet.
 *
 * Length limits. `CreateItemDto` caps `name` at 120, `code` and `barcode` at 64,
 * `category` at 80 and `description` at 1000. This DTO capped nothing, so a 600 kB
 * `name` was accepted and written to a TEXT column, and then flowed into every
 * list response, every Excel export, the HTML report template, and the backup
 * archive. The catalogue could hold rows the ordinary endpoints could never
 * create.
 *
 * `packageWeight` as a number, not an integer. The product's own item form offers
 * it with `step="0.001"`, so `1.5` is a legitimate weight — and `@IsInt()` here
 * rejected it. One decimal point in one cell of a fifteen-thousand-row file lost
 * the whole import, with a validation array rendered into a toast.
 *
 * `@ArrayMinSize(1)`. An empty list passed every rule, produced no rows, wrote no
 * audit record, and answered 201 with zeros — a refusal reported as a success.
 *
 * The numeric bounds below are deliberately per-row only. The service reports
 * problems one row at a time into `errors[]`, and a rule that can only fail the
 * whole request is a rule the operator cannot act on; anything that must be
 * checked against the catalogue (duplicate codes, existing barcodes) belongs in
 * the service, which has the database in front of it.
 */
export class BulkImportItemDto {
  @IsOptional()
  // When the client has matched this row to an item it already knows — which is what
  // the studio does for rows whose name matches an archived or active item — this is
  // that item's publicId, and the row updates it instead of creating a second one.
  //
  // Optional rather than required, and refused if it names an item that does not
  // exist: a stale id must not silently become an insert, which is the same duplicate
  // this whole path exists to prevent.
  @IsString()
  @MaxLength(64)
  publicId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsInt()
  @Min(1)
  sourceRow?: number;

  @IsString()
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
  @MaxLength(80)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  unit?: string;

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
  @IsString()
  @MaxLength(1000)
  englishName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  // A weight in kilograms, not a count. `@IsInt()` is deliberately absent: the item
  // form in the same product accepts 1.5, and a legitimate weight was failing the
  // entire import.
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(999999999.999)
  packageWeight?: number;
}

export class BulkImportDto {
  @IsArray()
  // An empty import is a refusal, not a success that created nothing. Without this
  // the service received `[]`, looped zero times, wrote no audit row, and the
  // caller was told 0 succeeded and 0 failed.
  @ArrayMinSize(1)
  // From the shared limit rather than a second literal, which had drifted into two
  // places with no shared source and no shared owner.
  @ArrayMaxSize(MAX_BULK_IMPORT_ROWS)
  @ValidateNested({ each: true })
  @Type(() => BulkImportItemDto)
  items!: BulkImportItemDto[];

  // `partial` is the default and keeps the behaviour the studio already relies on:
  // valid rows land, refused rows are reported, the response is 201. `strict` imports
  // nothing at all if any row is refused, in one transaction, so a catalogue load
  // that half-succeeded cannot be mistaken for one that worked.
  //
  // Opt-in rather than default. Flipping it would be defensible for a catalogue and is
  // a product decision, not a refactor: an operator who fixes one bad row and
  // re-imports the same file depends on the two hundred good rows landing again.
  @IsOptional()
  @IsIn(['strict', 'partial'])
  mode?: 'strict' | 'partial';

  // Display text for the batch record, so an operator looking at the history later can
  // tell which of six imports was "الأصناف.xlsx" and which was an export of the same
  // name. Never used to build a path, so an odd value here cannot escape anywhere.
  @IsOptional()
  @IsString()
  @MaxLength(255)
  sourceFileName?: string;
}
