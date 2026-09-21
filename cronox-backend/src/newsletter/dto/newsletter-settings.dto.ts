import { MediaFitMode } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
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

export class NewsletterFrameDto {
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

export class UpdateNewsletterSettingsDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  mediaAssetId?: string | null;

  @ValidateNested()
  @Type(() => NewsletterFrameDto)
  desktop!: NewsletterFrameDto;

  @ValidateNested()
  @Type(() => NewsletterFrameDto)
  mobile!: NewsletterFrameDto;

  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  @Max(1)
  mediaOpacity?: number;

  @IsBoolean()
  asciiEnabled!: boolean;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  @Max(1)
  asciiOpacity!: number;

  @IsInt()
  @Min(0)
  expectedRevision!: number;
}
