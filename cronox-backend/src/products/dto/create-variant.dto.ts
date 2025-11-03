import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
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
  stock?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
