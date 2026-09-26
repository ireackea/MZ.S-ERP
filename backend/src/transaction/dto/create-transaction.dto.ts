import { Type } from 'class-transformer';
import { IsDecimalString } from '../../common/decimal-validation';
import type { DecimalString } from '../../common/decimal';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateTransactionDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  publicId?: string;

  @IsString()
  itemId!: string;

  @IsString()
  date!: string;

  @IsString()
  type!: string;

  @IsDecimalString()
  quantity!: DecimalString;

  @IsString()
  supplierOrReceiver!: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  warehouseInvoice?: string;

  @IsOptional()
  @IsString()
  supplierInvoice?: string;

  @IsOptional()
  @IsDecimalString()
  supplierNet?: DecimalString;

  @IsOptional()
  @IsDecimalString()
  difference?: DecimalString;

  @IsOptional()
  @IsDecimalString()
  packageCount?: DecimalString;

  @IsOptional()
  @IsString()
  weightSlip?: string;

  @IsOptional()
  @IsDecimalString()
  salaryOfWorker?: DecimalString;

  @IsOptional()
  @IsString()
  truckNumber?: string;

  @IsOptional()
  @IsString()
  trailerNumber?: string;

  @IsOptional()
  @IsString()
  driverName?: string;

  @IsOptional()
  @IsString()
  entryTime?: string;

  @IsOptional()
  @IsString()
  exitTime?: string;

  @IsOptional()
  @IsString()
  unloadingRuleId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  unloadingDuration?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  delayDuration?: number;

  @IsOptional()
  @IsDecimalString()
  delayPenalty?: DecimalString;

  @IsOptional()
  @IsDecimalString()
  calculatedFine?: DecimalString;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  attachmentData?: string;

  @IsOptional()
  @IsString()
  attachmentName?: string;

  @IsOptional()
  @IsString()
  attachmentType?: string;

  @IsOptional()
  @IsString()
  googleDriveLink?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  timestamp?: number;

  @IsOptional()
  @IsIn(['INCREASE', 'DECREASE'])
  adjustmentDirection?: 'INCREASE' | 'DECREASE';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  adjustmentReason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  adjustmentSourceReference?: string;
}

export class BulkCreateTransactionsDto {
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => CreateTransactionDto)
  transactions!: CreateTransactionDto[];
}
