import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  IsInt,
  IsBoolean,
  Min,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { OrderStatus } from '@prisma/client';

const trimOrUndefined = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
};

export class UpdateOrderFulfillmentDto {
  @IsOptional()
  @IsBoolean()
  replaceTracking?: boolean;
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() || null : value)
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(80)
  trackingNumber?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  trackingRevision?: number;

  @IsOptional()
  @Transform(trimOrUndefined)
  @ValidateIf((_, value) => value !== undefined)
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  trackingUrl?: string;

  @IsOptional()
  @Transform(trimOrUndefined)
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(80)
  shippingCarrier?: string;

  @IsOptional()
  @Transform(trimOrUndefined)
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(500)
  internalNote?: string;
}
