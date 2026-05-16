import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
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
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @IsOptional()
  @Transform(trimOrUndefined)
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(80)
  trackingNumber?: string;

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
