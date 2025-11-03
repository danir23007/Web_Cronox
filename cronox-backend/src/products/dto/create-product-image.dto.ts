import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
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
}
