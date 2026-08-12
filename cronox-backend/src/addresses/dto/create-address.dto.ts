import { Transform, TransformFnParams } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  normalizeCountry,
  SPAIN_COUNTRY_NAME,
  UNSUPPORTED_COUNTRY_MESSAGE,
} from '../../common/country';

const trim = ({ value }: TransformFnParams) =>
  typeof value === 'string' ? value.trim() : value;

const normalizeSupportedCountry = ({ value }: TransformFnParams) => {
  if (typeof value !== 'string') {
    return value;
  }

  return normalizeCountry(value) ?? value.trim();
};

export class CreateAddressDto {
  @IsString()
  @Length(2, 80)
  @Transform(trim)
  name: string;

  @IsOptional()
  @IsString()
  @Matches(/^[+0-9\-()\s]{6,20}$/)
  @Transform(trim)
  phone?: string;

  @IsString()
  @Length(3, 120)
  @Transform(trim)
  line1: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  line2?: string;

  @IsString()
  @Length(2, 80)
  @Transform(trim)
  city: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(trim)
  state?: string;

  @IsString()
  @Length(2, 20)
  @Transform(trim)
  zip: string;

  @IsString()
  @IsIn([SPAIN_COUNTRY_NAME], { message: UNSUPPORTED_COUNTRY_MESSAGE })
  @Transform(normalizeSupportedCountry)
  country: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
