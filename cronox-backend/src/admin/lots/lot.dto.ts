import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export class LotLineDto {
  @IsInt() @Min(1) variantId: number;
  @IsInt() @Min(1) @Max(100000) quantity: number;
  @IsOptional() @IsInt() @Min(0) @Max(1000000000) productionCents: number | null = null;
}
export class CreateLotDto {
  @IsString() @MinLength(1) @MaxLength(160) name: string;
  @IsString() receivedAt: string;
  @IsOptional() @IsString() @MaxLength(2000) notes = '';
  @IsOptional() @IsInt() @Min(0) @Max(1000000000) referencePriceCents: number | null = null;
  @IsOptional() @IsInt() @Min(0) @Max(1000000000) freightTotalCents: number | null = null;
  @IsOptional() @IsInt() @Min(0) @Max(1000000000) otherTotalCents: number | null = null;
  @IsIn(['CONFIRMED', 'ESTIMATED', 'UNKNOWN']) costQuality: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => LotLineDto) lines: LotLineDto[];
}
export class EditLotDto {
  @IsOptional() @IsString() receivedAt?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(1000000000) referencePriceCents?: number | null;
  @IsInt() @Min(1) revision: number;
  @IsString() @MinLength(1) @MaxLength(160) name: string;
  @IsString() @MaxLength(2000) notes: string;
  @IsBoolean() archived: boolean;
  @IsString() @MinLength(1) @MaxLength(500) reason: string;
}
export class ActivateLotsDto {
  @IsString() @MinLength(64) @MaxLength(64) previewHash: string;
}
export class CorrectLotCostsDto {
  @IsOptional() @IsInt() @Min(0) @Max(1000000000) freightTotalCents: number | null = null;
  @IsOptional() @IsInt() @Min(0) @Max(1000000000) otherTotalCents: number | null = null;
  @IsIn(['CONFIRMED', 'ESTIMATED', 'UNKNOWN']) costQuality: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => LotLineDto) lines: LotLineDto[];
  @IsInt() @Min(1) revision: number;
  @IsString() @MinLength(1) @MaxLength(500) reason: string;
}
export class HistoricalLotCostDto {
  @IsOptional() @IsString() @MaxLength(200) adjustmentSourceKey?: string;
  @IsString() @MaxLength(100) lotId: string;
  @IsInt() @Min(1) @Max(100000) quantity: number;
  @IsInt() @Min(0) @Max(1000000000) productionCents: number;
  @IsInt() @Min(0) @Max(1000000000) freightCents: number;
  @IsInt() @Min(0) @Max(1000000000) otherCents: number;
  @IsIn(['CONFIRMED', 'ESTIMATED']) quality: string;
}
export class ReconcileHistoricalLotDto {
  @IsInt() @Min(1) orderId: number;
  @IsInt() @Min(1) itemId: number;
  @IsInt() @Min(1) revision: number;
  @IsString() @MinLength(1) @MaxLength(500) reason: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => HistoricalLotCostDto) parts: HistoricalLotCostDto[];
}
export class ReconcilePointLotDto {
  @IsString() @MaxLength(100) entryId: string;
  @IsInt() @Min(0) @Max(1000) lineIndex: number;
  @IsInt() @Min(0) revision: number;
  @IsString() @MinLength(1) @MaxLength(500) reason: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => HistoricalLotCostDto) parts: HistoricalLotCostDto[];
}
