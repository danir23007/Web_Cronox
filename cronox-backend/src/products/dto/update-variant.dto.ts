import { PartialType } from '@nestjs/swagger';
import { CreateVariantDto } from './create-variant.dto';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateVariantDto extends PartialType(CreateVariantDto) {}

export class AdjustStockDto {
  @IsInt()
  @Min(-2_147_483_647)
  @Max(2_147_483_647)
  delta: number;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  reason?: string;
}
