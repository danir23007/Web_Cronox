import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateVariantDto {
  @IsIn(['XS', 'S', 'M', 'L', 'XL', 'XXL'])
  size: 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL';

  @IsString()
  sku: string;

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
