import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateFooterSettingsDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Matches(/^[^<>]*$/)
  supportTitle!: string;
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Matches(/^[^<>]*$/)
  supportFaqLabel!: string;
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Matches(/^[^<>]*$/)
  supportShippingLabel!: string;
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Matches(/^[^<>]*$/)
  supportReturnsLabel!: string;
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Matches(/^[^<>]*$/)
  collabTitle!: string;
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Matches(/^[^<>]*$/)
  collabDevelopLabel!: string;
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Matches(/^[^<>]*$/)
  collabEventsLabel!: string;
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Matches(/^[^<>]*$/)
  legalTitle!: string;
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Matches(/^[^<>]*$/)
  legalPrivacyLabel!: string;
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Matches(/^[^<>]*$/)
  legalCookiesLabel!: string;
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Matches(/^[^<>]*$/)
  legalTermsLabel!: string;
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Matches(/^[^<>]*$/)
  legalNoticeLabel!: string;

  @Transform(trim)
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
    require_valid_protocol: true,
  })
  @MaxLength(2048)
  instagramUrl!: string;
  @Transform(trim)
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
    require_valid_protocol: true,
  })
  @MaxLength(2048)
  tiktokUrl!: string;
  @Transform(trim)
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
    require_valid_protocol: true,
  })
  @MaxLength(2048)
  youtubeUrl!: string;

  @IsInt()
  @Min(0)
  expectedRevision!: number;
}
