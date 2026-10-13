import { PasswordPolicy } from '../../common/password-policy';
import {
  ACCOUNT_FIRST_NAME_MAX,
  ACCOUNT_LAST_NAME_MAX,
} from '../../common/account-name-policy';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const NAME_REGEX = /^[A-Za-zÁÉÍÓÚáéíóúÑñÜü\s]+$/;

export class RegisterDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(ACCOUNT_FIRST_NAME_MAX, {
    message: 'El nombre admite como máximo 25 caracteres.',
  })
  @Matches(NAME_REGEX, {
    message: 'El nombre solo puede contener letras y espacios',
  })
  firstName!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(ACCOUNT_LAST_NAME_MAX, {
    message: 'El apellido admite como máximo 30 caracteres.',
  })
  @Matches(NAME_REGEX, {
    message: 'El apellido solo puede contener letras y espacios',
  })
  lastName!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail()
  email!: string;

  @IsString()
  @PasswordPolicy()
  password!: string;
}
