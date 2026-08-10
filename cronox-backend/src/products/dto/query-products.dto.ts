import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, TransformFnParams, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  Min,
  Max,
  IsEnum,
} from 'class-validator';
import { VariantSize } from '@prisma/client';

const normalizeQueryText = (value: unknown, lowerCase = false): unknown => {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().replace(/\s+/g, ' ');
  return lowerCase ? normalized.toLowerCase() : normalized;
};

export class QueryProductsDto {
  @ApiPropertyOptional({
    description: 'Búsqueda pública por producto, categoría o palabras clave',
    example: 'camiseta azul',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: TransformFnParams) => normalizeQueryText(value))
  search?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @Max(100)
  limit?: number = 10;

  @ApiPropertyOptional({
    enum: ['createdAt', 'price', 'name', 'id'],
    default: 'id',
  })
  @IsOptional()
  @IsString()
  @IsIn(['createdAt', 'price', 'name', 'id'])
  sortBy?: 'createdAt' | 'price' | 'name' | 'id' = 'id';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsString()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'asc';

  @ApiPropertyOptional({ description: 'Filtra por slug de categoría' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+$/)
  @Transform(({ value }: TransformFnParams) => normalizeQueryText(value, true))
  categorySlug?: string;

  @ApiPropertyOptional({
    description: 'Precio mínimo en céntimos',
    example: 1000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({
    description: 'Precio máximo en céntimos',
    example: 10000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({
    description: 'Filtra por talla disponible con stock',
    enum: VariantSize,
  })
  @IsOptional()
  @IsEnum(VariantSize)
  size?: VariantSize;
}
