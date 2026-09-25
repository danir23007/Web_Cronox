import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ManualStockHandling, OrderPaymentMethod } from '@prisma/client';

export class ManualPurchaseItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  variantId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  quantity!: number;
}

export class CreateManualPurchaseDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ManualPurchaseItemDto)
  items!: ManualPurchaseItemDto[];

  @IsEnum(OrderPaymentMethod)
  paymentMethod!: OrderPaymentMethod;

  @IsEnum(ManualStockHandling)
  stockHandling!: ManualStockHandling;

  @IsOptional()
  @IsISO8601({ strict: true })
  purchasedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
