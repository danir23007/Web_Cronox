import { Transform, TransformFnParams } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: TransformFnParams) =>
  typeof value === 'string' ? value.trim() : value;

const trimUppercase = ({ value }: TransformFnParams) => {
  if (typeof value !== 'string') {
    return value;
  }

  return value.trim().toUpperCase();
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
  @Length(2, 2)
  @Matches(/^[A-Z]{2}$/)
  @Transform(trimUppercase)
  country: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
