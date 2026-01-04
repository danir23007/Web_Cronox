import { PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsBooleanString,
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PromoCodeType } from '@prisma/client';

const sanitizeCode = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  return value.replace(/\s+/g, '').toUpperCase();
};

export class AdminPromoCodeQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsBooleanString()
  isActive?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class AdminCreatePromoCodeDto {
  @Transform(sanitizeCode)
  @IsString()
  @MaxLength(80)
  code!: string;

  @IsEnum(PromoCodeType)
  type!: PromoCodeType;

  @Type(() => Number)
  @IsInt()
  value!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  minCartValue?: number;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  startsAt?: Date;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  expiresAt?: Date;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  usageLimit?: number;
}

export class AdminUpdatePromoCodeDto extends PartialType(AdminCreatePromoCodeDto) {}
