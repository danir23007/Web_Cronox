import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { MediaFitMode } from '@prisma/client';

export class MediaFrameDto {
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  @Max(100)
  focalX!: number;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  @Max(100)
  focalY!: number;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(1)
  @Max(3)
  zoom!: number;

  @IsEnum(MediaFitMode)
  fit!: MediaFitMode;
}

export class UpdateMediaFramingDto {
  @ValidateNested()
  @Type(() => MediaFrameDto)
  desktop!: MediaFrameDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => MediaFrameDto)
  tablet?: MediaFrameDto | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => MediaFrameDto)
  mobile?: MediaFrameDto | null;

  @IsInt()
  @Min(0)
  expectedRevision!: number;
}

export class ResetMediaFramingDto {
  @IsInt()
  @Min(0)
  expectedRevision!: number;
}

export class SelectWebsiteMediaAssetDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  assetId?: string | null;

  @IsInt()
  @Min(0)
  expectedRevision!: number;
}
