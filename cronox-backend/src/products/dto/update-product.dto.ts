import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CreateProductDto } from './create-product.dto';
import { CreateProductImageDto } from './create-product-image.dto';
import { CreateVariantDto } from './create-variant.dto';
import { UpdateVariantDto } from './update-variant.dto';

export class UpdateProductDto extends PartialType(CreateProductDto) {
  @IsOptional()
  @IsDateString()
  expectedUpdatedAt?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GalleryImageItemDto)
  galleryImages?: GalleryImageItemDto[];
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

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateVariantDto)
  variantsToCreate?: CreateVariantDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateVariantDto)
  variantsToUpdate?: (UpdateVariantDto & { id: number })[];

  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  variantIdsToDelete?: number[];
}

export class GalleryImageItemDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  id?: number;

  @IsUrl()
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  alt?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder: number;

  @IsBoolean()
  isPrimary: boolean;

  @IsBoolean()
  isActive: boolean;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  galleryPositionX: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  galleryPositionY: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.5)
  @Max(3)
  galleryZoom: number;

  @IsIn(['CONTAIN', 'COVER'])
  galleryFit: 'CONTAIN' | 'COVER';
}

export class DeleteProductImageDto {
  @IsDateString()
  expectedUpdatedAt: string;
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
