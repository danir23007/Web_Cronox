import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { IsISO31661Alpha2 } from 'class-validator';

export class CreateShippingMethodDto {
  @ApiProperty({ description: 'Nombre del método de envío', maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ description: 'Precio fijo en céntimos (790 => 7,90€)' })
  @IsInt()
  @Min(0)
  priceCents!: number;

  @ApiPropertyOptional({
    description: 'Lista de países (ISO 3166-1 alpha-2) en los que está disponible. Vacío => todos',
    type: [String],
    example: ['ES', 'FR'],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ValidateIf((_, value) => Array.isArray(value))
  @IsISO31661Alpha2({}, { each: true })
  @Transform(({ value }) => (Array.isArray(value) ? value.map((code: string) => code?.toUpperCase?.() ?? code) : value))
  countries?: string[];

  @ApiPropertyOptional({ description: 'Permite activar o desactivar el método', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
