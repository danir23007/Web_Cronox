import { Transform, TransformFnParams } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Length, Matches } from 'class-validator';

const trim = ({ value }: TransformFnParams) =>
  typeof value === 'string' ? value.trim() : value;
const NAME_REGEX = /^[A-Za-zÁÉÍÓÚáéíóúÑñÜü\s]+$/;
const PHONE_REGEX = /^[\d+\s-]+$/;

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  @Matches(NAME_REGEX, { message: 'El nombre solo puede contener letras y espacios' })
  @Transform(trim)
  firstName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  @Matches(NAME_REGEX, { message: 'El apellido solo puede contener letras y espacios' })
  @Transform(trim)
  lastName?: string;

  @IsOptional()
  @IsEmail()
  @Transform(trim)
  email?: string;

  @IsOptional()
  @IsString()
  @Matches(PHONE_REGEX, { message: 'El teléfono solo puede contener números, espacios o +' })
  phone?: string;
}
