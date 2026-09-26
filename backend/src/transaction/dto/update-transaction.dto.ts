import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { IsDecimalString } from '../../common/decimal-validation';
import type { DecimalString } from '../../common/decimal';

export class UpdateTransactionDto {
  @IsOptional()
  @IsString()
  itemId?: string;

  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsDecimalString()
  quantity?: DecimalString;

  @IsOptional()
  @IsString()
  supplierOrReceiver?: string;

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
