import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { CircleUpgradeRequestStatus } from '@prisma/client';

export class AdminUserRequestsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number;

  @IsOptional()
  @IsEnum(CircleUpgradeRequestStatus)
  status?: CircleUpgradeRequestStatus;

  @IsOptional()
  @IsIn(['2-3', '3-4'])
  kind?: '2-3' | '3-4';

  @IsOptional()
  @IsIn(['createdAt', 'status'])
  sort?: 'createdAt' | 'status';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}
