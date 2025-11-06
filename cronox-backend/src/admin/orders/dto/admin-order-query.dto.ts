import { OrderStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumberString,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

const toArray = (value: unknown): string[] | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : String(item)))
      .filter((item) => item.length > 0);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  }

  return [String(value)];
};

const normalizeStatuses = (value: unknown): OrderStatus[] | undefined => {
  const values = toArray(value);

  if (!values) {
    return undefined;
  }

  return values.map((item) => item.toUpperCase() as OrderStatus);
};

export class AdminOrdersQueryDto {
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
  pageSize?: number;

  @IsOptional()
  @Transform(({ value }) => normalizeStatuses(value), { toClassOnly: true })
  @IsArray()
  @IsEnum(OrderStatus, { each: true })
  status?: OrderStatus[];

  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsNumberString()
  minTotal?: string;

  @IsOptional()
  @IsNumberString()
  maxTotal?: string;

  @IsOptional()
  @IsIn(['createdAt', 'total', 'status'])
  sort?: 'createdAt' | 'total' | 'status';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}
