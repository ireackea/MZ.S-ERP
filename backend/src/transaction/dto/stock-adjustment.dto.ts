import { IsDateString, IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { IsDecimalString } from '../../common/decimal-validation';
import type { DecimalString } from '../../common/decimal';

export const STOCK_ADJUSTMENT_DIRECTIONS = ['INCREASE', 'DECREASE'] as const;
export type StockAdjustmentDirection = (typeof STOCK_ADJUSTMENT_DIRECTIONS)[number];

export class StockAdjustmentDto {
  @IsString()
  itemId!: string;

  @IsDateString()
  date!: string;

  // FC-DATA-001 — the same decimal boundary as a movement. The magnitude is not
  // allowed to be a bare float, because a float that has already lost precision
  // cannot be recovered by the server.
  @IsDecimalString()
  quantity!: DecimalString;

  @IsIn(STOCK_ADJUSTMENT_DIRECTIONS)
  adjustmentDirection!: StockAdjustmentDirection;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  sourceReference!: string;
}
