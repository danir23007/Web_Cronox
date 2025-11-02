import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsPositive, ValidateNested } from 'class-validator';
import { CreateProductDto } from './create-product.dto';
import { CreateProductImageDto } from './create-product-image.dto';

export class UpdateProductDto extends PartialType(CreateProductDto) {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateProductImageDto)
  imagesToCreate?: CreateProductImageDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateImageItem)
  imagesToUpdate?: UpdateImageItem[];

  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  @IsPositive({ each: true })
  imagesToDeleteIds?: number[];
}

export class UpdateImageItem {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  id: number;

  @IsOptional()
  url?: string;

  @IsOptional()
  alt?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  isPrimary?: boolean;
}
