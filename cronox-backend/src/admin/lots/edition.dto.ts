import { IsArray, ArrayMaxSize, ValidateNested, IsBoolean, IsInt, IsOptional, IsString, IsDateString, Min, Max, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { UpdateProductDto } from '../../products/dto/update-product.dto';
export class EditionStockBaseline {
  @IsString() @MaxLength(30) size: string;
  @IsInt() @Min(0) available: number;
}
export class WebOfferDto {
  @IsBoolean() enabled: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(1000000000) priceCents?: number;
  @IsOptional() @IsInt() @Min(1) @Max(1000000000) previousCents?: number;
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsDateString() endsAt?: string;
  @IsOptional() @IsBoolean() previousConfirmed?: boolean;
}
export class SaveEditionDto extends UpdateProductDto {
  @IsOptional() @ValidateNested() @Type(() => WebOfferDto) webOffer?: WebOfferDto;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({each:true}) @Type(()=>EditionStockBaseline) expectedStocks?: EditionStockBaseline[];
  @IsInt() @Min(1) revision: number;
  @IsOptional() @IsString() receivedAt?: string | null;
  @IsOptional() @IsString() receiptReceivedAt?: string;
  @IsOptional() @IsBoolean() expectedVisibility?: boolean;
  // Compatibility with older editor clients: a nonzero separate transport
  // amount is rejected. New editor receipts always use transport = 0.
  @IsOptional() @IsInt() @Min(0) @Max(1000000000) freightTotalCents?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(1000000000) otherTotalCents?: number | null;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
export class DuplicateEditionDto {
  @IsInt() @Min(1) revision: number;
}
