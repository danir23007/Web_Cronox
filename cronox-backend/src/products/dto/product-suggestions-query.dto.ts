import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, TransformFnParams, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const normalizeQueryText = (value: unknown, lowerCase = false): unknown => {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().replace(/\s+/g, ' ');
  return lowerCase ? normalized.toLowerCase() : normalized;
};

export class ProductSuggestionsQueryDto {
  @ApiProperty({ example: 'camiseta azul', minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Transform(({ value }: TransformFnParams) => normalizeQueryText(value))
  search: string;

  @ApiPropertyOptional({ example: 8, minimum: 1, maximum: 8 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8)
  limit?: number = 8;

  @ApiPropertyOptional({
    description: 'Limita las sugerencias a una categoría',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+$/)
  @Transform(({ value }: TransformFnParams) => normalizeQueryText(value, true))
  categorySlug?: string;
}
