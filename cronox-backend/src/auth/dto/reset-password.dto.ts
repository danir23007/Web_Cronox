import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

const PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*\d).{8,}$/;

export class ResetPasswordDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsString()
  @Matches(PASSWORD_REGEX, {
    message: 'La contraseña debe tener al menos 8 caracteres, una mayúscula y un número',
  })
  password!: string;
}
