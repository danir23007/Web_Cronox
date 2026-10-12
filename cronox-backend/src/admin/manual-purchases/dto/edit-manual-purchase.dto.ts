import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { OrderPaymentMethod } from '@prisma/client';

export class EditManualPurchaseItemDto {
  @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(1)
  itemId?: number;

  @Type(() => Number) @IsInt() @Min(1)
  variantId!: number;

  @Type(() => Number) @IsInt() @Min(1) @Max(100)
  quantity!: number;

  @IsInt() @Min(0) @Max(999_999_999_999)
  unitPriceCents!: number;
}

export class EditManualPurchaseDto {
  @IsString() @Matches(/^[a-f0-9]{64}$/)
  expectedVersion!: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50)
  @ValidateNested({ each: true }) @Type(() => EditManualPurchaseItemDto)
  items!: EditManualPurchaseItemDto[];

  @IsIn([OrderPaymentMethod.CASH, OrderPaymentMethod.EXTERNAL_CARD, OrderPaymentMethod.BANK_TRANSFER, OrderPaymentMethod.OTHER])
  paymentMethod!: OrderPaymentMethod;

  @IsISO8601({ strict: true })
  purchasedAt!: string;

  @IsBoolean()
  excludedFromStatistics!: boolean;

  @IsOptional() @IsString() @MaxLength(500)
  note?: string;
}
