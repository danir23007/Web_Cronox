import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches } from 'class-validator';

const PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*\d).{8,}$/;

export class LoginDto {
  @Transform(({ value }) => value?.trim())
  @IsEmail()
  email!: string;

  @IsString()
  @Matches(PASSWORD_REGEX, {
    message:
      'La contraseña debe tener al menos 8 caracteres, una mayúscula y un número',
  })
  password!: string;
}
