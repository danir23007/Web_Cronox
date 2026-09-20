import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import type { VariantSize } from '@prisma/client';
import { VARIANT_SIZE_VALUES } from '../product-size-system';

export class CreateVariantDto {
  @IsEnum(VARIANT_SIZE_VALUES)
  size: VariantSize;

  @IsOptional()
  @IsString()
  @Matches(/\S/, {
    message: 'sku must contain at least one non-whitespace character',
  })
  sku?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  stock?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  stockQty?: number; // [STOCK]

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
