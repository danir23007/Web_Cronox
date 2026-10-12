import { Equals } from 'class-validator';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class PointDto {
  @IsString() @MaxLength(160) name: string;
  @IsIn(['STORE', 'EVENT', 'OTHER']) type: string;
  @IsOptional() @IsString() @MaxLength(160) city = '';
  @IsOptional() @IsString() @MaxLength(300) venue = '';
  @IsOptional() @IsString() startsOn?: string;
  @IsOptional() @IsString() endsOn?: string;
  @IsOptional() @IsString() @MaxLength(4000) notes = '';
  @IsInt() @Min(0) @Max(10000) commissionBp: number;
  @IsOptional() @IsBoolean() archived = false;
  @IsOptional() @IsInt() @Min(1) revision?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1000000000) participationCents?: number;
  @IsOptional() @IsString() expenseDate?: string;
}
export class SaleLineDto {
  @IsOptional() @IsUUID() id?: string;
  @IsInt() @Min(1) variantId: number;
  @IsInt() @Min(0) @Max(1000) quantity: number;
  @IsInt() @Min(0) @Max(10000000) unitPriceCents: number;
  @IsInt() @Min(0) @Max(10000) commissionBp: number;
}
export class SaleDto {
  @Equals(undefined, { message: "Statistics exclusion is only available for customer manual purchases" })
  excludedFromStatistics?: never;
  @IsOptional() @IsIn(['DEDUCT_NOW', 'ALREADY_ADJUSTED'])
  stockHandling?: 'DEDUCT_NOW' | 'ALREADY_ADJUSTED';
  @IsString() occurredAt: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SaleLineDto)
  lines: SaleLineDto[];
  @IsOptional() @IsString() @MaxLength(2000) note = '';
  @IsOptional()
  @IsIn(['', 'CASH', 'EXTERNAL_CARD', 'BANK_TRANSFER', 'OTHER'])
  paymentMethod = '';
  @IsOptional() @IsInt() @Min(1) revision?: number;
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}
export class SaleDateDto {
  @IsString() occurredAt: string;
  @IsInt() @Min(1) revision: number;
  @IsString() @MaxLength(1000) reason: string;
}
export class ReturnLineDto {
  @IsUUID() id: string;
  @IsInt() @Min(1) @Max(1000) quantity: number;
  @IsBoolean() restock: boolean;
  @IsInt() @Min(0) @Max(1000000000) recoveredCommissionCents: number;
}
export class ReturnDto {
  @IsString() occurredAt: string;
  @IsInt() @Min(1) revision: number;
  @IsString() @MaxLength(1000) reason: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ReturnLineDto)
  lines: ReturnLineDto[];
}
export class ExpenseDto {
  @IsString() occurredAt: string;
  @IsString() @MaxLength(1000) description: string;
  @IsInt() @Min(0) @Max(1000000000) amountCents: number;
  @IsOptional() @IsUUID() reversesId?: string;
}
