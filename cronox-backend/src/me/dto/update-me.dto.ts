import { Transform, TransformFnParams } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Length } from 'class-validator';

const trim = ({ value }: TransformFnParams) =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  @Transform(trim)
  firstName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  @Transform(trim)
  lastName?: string;

  @IsOptional()
  @IsEmail()
  @Transform(trim)
  email?: string;
}
