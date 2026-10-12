import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Role } from '@prisma/client';

export class AdminUserQueryDto {
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
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsString()
  // Legacy clients may send this field; listing/bulk selection ignore it.
  accountState?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  circle?: number;

  @IsOptional()
  @IsIn(['id', 'revenue', 'orders', 'distinctProducts'])
  sort?: 'id' | 'revenue' | 'orders' | 'distinctProducts';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}
