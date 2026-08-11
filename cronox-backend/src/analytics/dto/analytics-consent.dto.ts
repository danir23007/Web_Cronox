import { IsBoolean, IsString, Length } from 'class-validator';

export class AnalyticsConsentDto {
  @IsBoolean()
  granted!: boolean;

  @IsString()
  @Length(1, 20)
  version!: string;
}
