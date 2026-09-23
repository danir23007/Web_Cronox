import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsHexColor,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Matches,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  KeyScreenControlStyle,
  KeyScreenHorizontalAlign,
  KeyScreenMode,
  KeyScreenVerticalAlign,
  MediaFitMode,
} from '@prisma/client';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateKeyScreenDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  internalName!: string;
}

export class UpdateKeyScreenDto {
  @IsInt() @Min(1) expectedRevision!: number;
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(120)
  internalName?: string;
  @IsOptional() @IsEnum(KeyScreenMode) mode?: KeyScreenMode;
  @IsOptional() @IsString() @MaxLength(64) mediaAssetId?: string | null;
  @IsOptional() @Type(() => Number) @Min(0) @Max(100) desktopFocalX?: number;
  @IsOptional() @Type(() => Number) @Min(0) @Max(100) desktopFocalY?: number;
  @IsOptional() @Type(() => Number) @Min(1) @Max(3) desktopZoom?: number;
  @IsOptional() @IsEnum(MediaFitMode) desktopFit?: MediaFitMode;
  @IsOptional() @Type(() => Number) @Min(0) @Max(100) mobileFocalX?:
    | number
    | null;
  @IsOptional() @Type(() => Number) @Min(0) @Max(100) mobileFocalY?:
    | number
    | null;
  @IsOptional() @Type(() => Number) @Min(1) @Max(3) mobileZoom?: number | null;
  @IsOptional() @IsEnum(MediaFitMode) mobileFit?: MediaFitMode | null;
  @IsOptional() @IsString() @MaxLength(140) title?: string;
  @IsOptional() @IsString() @MaxLength(400) subtitle?: string;
  @IsOptional() @IsString() @MaxLength(100) placeholder?: string;
  @IsOptional() @IsString() @MaxLength(60) buttonText?: string;
  @IsOptional() @IsString() @MaxLength(140) successTitle?: string;
  @IsOptional() @IsString() @MaxLength(400) successMessage?: string;
  @IsOptional() @IsString() @MaxLength(100) privacyLabel?: string;
  @IsOptional() @IsHexColor() textColor?: string;
  @IsOptional()
  @IsEnum(KeyScreenControlStyle)
  inputStyle?: KeyScreenControlStyle;
  @IsOptional()
  @IsEnum(KeyScreenControlStyle)
  buttonStyle?: KeyScreenControlStyle;
  @IsOptional()
  @IsEnum(KeyScreenHorizontalAlign)
  horizontalAlign?: KeyScreenHorizontalAlign;
  @IsOptional()
  @IsEnum(KeyScreenVerticalAlign)
  verticalAlign?: KeyScreenVerticalAlign;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-400)
  @Max(400)
  offsetX?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-400)
  @Max(400)
  offsetY?: number;
  @IsOptional()
  @IsEnum(KeyScreenHorizontalAlign)
  desktopHorizontalAlign?: KeyScreenHorizontalAlign;
  @IsOptional()
  @IsEnum(KeyScreenVerticalAlign)
  desktopVerticalAlign?: KeyScreenVerticalAlign;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-400)
  @Max(400)
  desktopOffsetX?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-400)
  @Max(400)
  desktopOffsetY?: number;
  @IsOptional()
  @IsEnum(KeyScreenHorizontalAlign)
  mobileHorizontalAlign?: KeyScreenHorizontalAlign;
  @IsOptional()
  @IsEnum(KeyScreenVerticalAlign)
  mobileVerticalAlign?: KeyScreenVerticalAlign;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-400)
  @Max(400)
  mobileOffsetX?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-400)
  @Max(400)
  mobileOffsetY?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-400)
  @Max(400)
  desktopFormOffsetX?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-400)
  @Max(400)
  desktopFormOffsetY?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-400)
  @Max(400)
  desktopPrivacyOffsetX?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-400)
  @Max(400)
  desktopPrivacyOffsetY?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-400)
  @Max(400)
  mobileFormOffsetX?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-400)
  @Max(400)
  mobileFormOffsetY?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-400)
  @Max(400)
  mobilePrivacyOffsetX?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-400)
  @Max(400)
  mobilePrivacyOffsetY?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(90)
  overlayStrength?: number;
}

export class SelectKeyScreenDto {
  @IsString() @MaxLength(64) screenId!: string;
}

export class SetKeyScreenEnabledDto {
  @IsBoolean() enabled!: boolean;
}

export class SetKeyScreenExpirationDto {
  @ValidateIf((_object, value) => value !== null)
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/, {
    message: 'expiresAt debe incluir una zona horaria explícita',
  })
  expiresAt!: string | null;
}

export class PreRegisterDto {
  @Transform(trimmed)
  @IsEmail()
  @MaxLength(254)
  email!: string;
}
