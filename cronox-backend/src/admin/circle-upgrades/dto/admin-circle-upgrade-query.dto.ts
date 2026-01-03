import { CircleUpgradeRequestStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class AdminCircleUpgradeQueryDto {
  @IsOptional()
  @IsEnum(CircleUpgradeRequestStatus)
  status?: CircleUpgradeRequestStatus;
}
