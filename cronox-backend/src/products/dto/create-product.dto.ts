import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsPositive, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { CreateProductImageDto } from './create-product-image.dto';

export class CreateProductDto {
  @IsString()
  @MaxLength(120)
  name: string;

  @IsString()
  @Matches(/^[a-z0-9-]+$/)
  @MaxLength(140)
  slug: string;

  // precio en céntimos (ej: 34,95€ -> 3495)
  @IsInt()
  @IsPositive()
  price: number;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string; // default: 'EUR'

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateProductImageDto)
  images?: CreateProductImageDto[];
}
