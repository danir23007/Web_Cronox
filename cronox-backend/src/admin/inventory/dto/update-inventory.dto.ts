import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { INVENTORY_MAX_STOCK } from '../inventory.constants';

export class InventoryVariantUpdateDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  variantId: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(INVENTORY_MAX_STOCK)
  stock: number;

  /** Compare-and-set value read from the server. Prevents lost updates. */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(INVENTORY_MAX_STOCK)
  expectedStock: number;
}

export class UpdateInventoryDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => InventoryVariantUpdateDto)
  updates: InventoryVariantUpdateDto[];

  @IsOptional()
  @IsString()
  @MaxLength(240)
  reason?: string;
}
