import {
  CircleUpgradeRequestStatus,
  CircleUpgradeSocialNetwork,
  OrderStatus,
  Role,
  UserAccountState,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class AdminExportQueryDto {
  @IsIn(['filtered', 'all'])
  scope: 'filtered' | 'all' = 'filtered';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  @Transform(trim)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Transform(trim)
  phone?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsEnum(UserAccountState)
  accountState?: UserAccountState;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  circle?: number;

  @IsOptional()
  @IsIn([
    ...Object.values(OrderStatus),
    ...Object.values(CircleUpgradeRequestStatus),
  ])
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  category?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoryId?: number;

  @IsOptional()
  @IsIn(['true', 'false'])
  isActive?: string;

  @IsOptional()
  @IsIn(['in_stock', 'low', 'out_of_stock'])
  stockStatus?: 'in_stock' | 'low' | 'out_of_stock';

  @IsOptional()
  @IsIn(['in_stock', 'low', 'out_of_stock'])
  stockState?: 'in_stock' | 'low' | 'out_of_stock';

  @IsOptional()
  @IsIn(['2-3', '3-4'])
  requestType?: '2-3' | '3-4';

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
  @IsEnum(CircleUpgradeSocialNetwork)
  socialNetwork?: CircleUpgradeSocialNetwork;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userCircle?: number;

  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @IsOptional()
  @IsNumberString()
  userId?: string;

  @IsOptional()
  @IsNumberString()
  minTotal?: string;

  @IsOptional()
  @IsNumberString()
  maxTotal?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  actionType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  targetType?: string;

  @IsOptional()
  @IsIn(['createdAt', 'updatedAt', 'email', 'id', 'total', 'status', 'name'])
  sort?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

  @IsOptional()
  @IsIn(['createdAt', 'stock', 'attempts'])
  sortBy?: 'createdAt' | 'stock' | 'attempts';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';
}
