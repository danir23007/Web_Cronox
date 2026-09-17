import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsBoolean,
  IsIn,
  Matches,
  MaxLength,
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

export class HeroTextDto {
  @IsBoolean()
  enabled!: boolean;

  @IsString()
  @MaxLength(160)
  content!: string;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  @Max(100)
  x!: number;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  @Max(100)
  y!: number;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  @Max(100)
  mobileX!: number;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  @Max(100)
  mobileY!: number;

  @IsString()
  @IsIn(['LEFT', 'CENTER', 'RIGHT'])
  align!: 'LEFT' | 'CENTER' | 'RIGHT';

  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  color!: string;

  @IsInt()
  @Min(12)
  @Max(120)
  fontSize!: number;

  @IsInt()
  @Min(12)
  @Max(120)
  mobileFontSize!: number;

  @IsInt()
  @IsIn([300, 400, 500, 600, 700, 800, 900])
  fontWeight!: number;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(-2)
  @Max(20)
  letterSpacing!: number;

  @IsBoolean()
  uppercase!: boolean;

  @IsInt()
  @Min(10)
  @Max(100)
  maxWidth!: number;
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

  @IsOptional()
  @ValidateNested()
  @Type(() => HeroTextDto)
  heroText?: HeroTextDto;

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
