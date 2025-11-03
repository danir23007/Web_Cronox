import { IsString, Matches } from 'class-validator';

const PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*\d).{8,}$/;

export class ResetDto {
  @IsString()
  token!: string;

  @IsString()
  @Matches(PASSWORD_REGEX, {
    message:
      'La contraseña debe tener al menos 8 caracteres, una mayúscula y un número',
  })
  newPassword!: string;
}
