import { PartialType } from '@nestjs/swagger';
import { CreateVariantDto } from './create-variant.dto';
import { IsInt, IsOptional } from 'class-validator';

export class UpdateVariantDto extends PartialType(CreateVariantDto) {}

export class AdjustStockDto {
  @IsInt()
  delta: number;

  @IsOptional()
  reason?: string;
}
