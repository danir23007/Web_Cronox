import { Type } from 'class-transformer';
import { CircleUpgradeRequestStatus } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class AdminCircleUpgradeQueryDto {
  @IsOptional()
  @IsEnum(CircleUpgradeRequestStatus)
  status?: CircleUpgradeRequestStatus;

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
  @IsIn(['createdAt', 'attempts'])
  sortBy?: 'createdAt' | 'attempts';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';

  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  attemptsMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  attemptsMax?: number;

  @IsOptional()
  @IsString()
  socialNetwork?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userCircle?: number;
}
