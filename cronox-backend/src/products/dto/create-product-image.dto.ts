import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateProductImageDto {
  @ApiProperty({
    example: 'https://supabase.co/storage/...jpg',
    description: 'URL pública de la imagen del producto',
  })
  @IsUrl()
  url: string;

  @ApiPropertyOptional({ example: 'Vista frontal del producto' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  alt?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @ApiPropertyOptional({ example: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  galleryPositionX?: number;

  @ApiPropertyOptional({ example: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  galleryPositionY?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.5)
  @Max(3)
  galleryZoom?: number;

  @ApiPropertyOptional({ enum: ['CONTAIN', 'COVER'] })
  @IsOptional()
  @IsIn(['CONTAIN', 'COVER'])
  galleryFit?: 'CONTAIN' | 'COVER';
}
