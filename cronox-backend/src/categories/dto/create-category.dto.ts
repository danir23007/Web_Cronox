import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateCategoryDto {
  @ApiProperty({ example: 'Colección Essentials' })
  @IsString()
  @MaxLength(120)
  name: string;

  @ApiProperty({ example: 'coleccion-essentials' })
  @IsString()
  @Matches(/^[a-z0-9-]+$/)
  @MaxLength(140)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  slug: string;

  @ApiPropertyOptional({ example: 'Prendas básicas para el día a día' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
