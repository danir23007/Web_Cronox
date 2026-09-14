import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  ArrayMaxSize,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CreateProductImageDto } from './create-product-image.dto';
import { CreateVariantDto } from './create-variant.dto';

export class CreateProductDto {
  @ApiProperty({ example: 'Camiseta Cronox Negra' })
  @IsString()
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ example: 'camiseta-cronox-negra' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+$/)
  @MaxLength(140)
  slug?: string;

  // precio en céntimos (ej: 34,95€ -> 3495)
  @ApiProperty({ example: 3495, description: 'Precio en céntimos (34,95€)' })
  @IsInt()
  @IsPositive()
  price: number;

  @ApiPropertyOptional({ example: 'EUR' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string; // default: 'EUR'

  @ApiPropertyOptional({ example: 'Descripción del producto' })
  @IsOptional()
  @IsString()
  @MaxLength(800)
  description?: string;

  @ApiPropertyOptional({ example: 'drop-01' })
  @IsOptional()
  @IsString()
  @MaxLength(140)
  collection?: string;

  @ApiPropertyOptional({
    description: 'Palabras internas para mejorar la búsqueda del producto',
    example: ['azul', 'blue', 'camiseta', 'tee', 'washed'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  searchKeywords?: string[];

  @ApiPropertyOptional({ example: 50, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  cardImagePositionX?: number;

  @ApiPropertyOptional({ example: 50, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  cardImagePositionY?: number;

  @ApiPropertyOptional({ example: 1, minimum: 0.5, maximum: 3 })
  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(3)
  cardImageZoom?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ type: [CreateProductImageDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateProductImageDto)
  images?: CreateProductImageDto[];

  @ApiPropertyOptional({
    description: 'URLs directas de las imágenes a asociar al producto',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageUrls?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateVariantDto)
  variants?: CreateVariantDto[];
}
