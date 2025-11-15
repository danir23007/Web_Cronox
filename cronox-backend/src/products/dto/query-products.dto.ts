import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Min,
  IsEnum,
} from 'class-validator';
import { VariantSize } from '@prisma/client';

export class QueryProductsDto {
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
  limit?: number = 10;

  @ApiPropertyOptional({ enum: ['createdAt', 'price', 'name', 'id'], default: 'id' })
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
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  categorySlug?: string;

  @ApiPropertyOptional({ description: 'Precio mínimo en céntimos', example: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ description: 'Precio máximo en céntimos', example: 10000 })
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
