import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateCategoryDto {
  @ApiProperty({ example: 'Colección Essentials' })
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value)
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ApiProperty({ enum: ['GARMENT', 'DROP'] })
  @IsIn(['GARMENT', 'DROP'])
  group: 'GARMENT' | 'DROP';

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  showInStoreFilters?: boolean;

  @ApiPropertyOptional({ example: 'coleccion-essentials' })
  @IsString()
  @IsOptional()
  @Matches(/^[a-z0-9-]+$/)
  @MaxLength(140)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  slug?: string;

  @ApiPropertyOptional({ example: 'Prendas básicas para el día a día' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
