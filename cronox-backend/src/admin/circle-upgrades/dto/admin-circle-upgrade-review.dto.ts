import { IsOptional, IsString } from 'class-validator';

export class AdminCircleUpgradeReviewDto {
  @IsOptional()
  @IsString()
  reviewedBy?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
