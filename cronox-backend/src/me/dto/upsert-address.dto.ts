import { Transform, TransformFnParams } from 'class-transformer';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

const trim = ({ value }: TransformFnParams) =>
  typeof value === 'string' ? value.trim() : value;
const PHONE_REGEX = /^[\d+\s-]+$/;

export class UpsertAddressDto {
  @IsString()
  @Length(1, 120)
  @Transform(trim)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 40)
  @Matches(PHONE_REGEX, { message: 'El teléfono solo puede contener números, espacios o +' })
  @Transform(trim)
  phone?: string;

  @IsString()
  @Length(1, 160)
  @Transform(trim)
  line1!: string;

  @IsOptional()
  @IsString()
  @Length(0, 160)
  @Transform(trim)
  line2?: string;

  @IsString()
  @Length(1, 120)
  @Transform(trim)
  city!: string;

  @IsOptional()
  @IsString()
  @Length(0, 120)
  @Transform(trim)
  state?: string;

  @IsString()
  @Length(1, 20)
  @Transform(trim)
  zip!: string;

  @IsString()
  @Length(2, 2)
  @Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  country!: string;
}
