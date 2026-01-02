import { CircleUpgradeRequestStatus, CircleUpgradeSocialNetwork } from '@prisma/client';
import { IsEnum, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateCircleUpgradeDto {
  @IsEnum(CircleUpgradeSocialNetwork)
  socialNetwork!: CircleUpgradeSocialNetwork;

  @IsString()
  @IsNotEmpty()
  username!: string;
}

export class UpdateCircleUpgradeStatusDto {
  @IsEnum(CircleUpgradeRequestStatus)
  @IsIn([CircleUpgradeRequestStatus.APPROVED, CircleUpgradeRequestStatus.DENIED])
  status!: CircleUpgradeRequestStatus;

  @IsOptional()
  @IsString()
  reviewedBy?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
