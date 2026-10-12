import { IsBoolean } from 'class-validator';

export class ManualStatisticsDto {
  @IsBoolean()
  excludedFromStatistics!: boolean;
}
