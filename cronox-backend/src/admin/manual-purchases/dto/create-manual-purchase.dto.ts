import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
import { ManualStockHandling, OrderPaymentMethod } from '@prisma/client';

export class ManualPurchaseItemDto {
  // Integer cents, VAT included. Omission is accepted only for legacy replay;
  // the service requires the paid price for every newly registered purchase.
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(999_999_999_999)
  unitPriceCents?: number;

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
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  excludedFromStatistics?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ManualPurchaseItemDto)
  items!: ManualPurchaseItemDto[];

  @IsEnum(OrderPaymentMethod)
  paymentMethod!: OrderPaymentMethod;

  @IsEnum(ManualStockHandling, { message: 'Selecciona cómo se debe tratar el stock' })
  stockHandling!: ManualStockHandling;

  @IsOptional()
  @IsISO8601({ strict: true })
  purchasedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
