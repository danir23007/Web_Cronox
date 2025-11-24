import { Transform } from 'class-transformer';
import { IsEmail } from 'class-validator';

export class ForgotPasswordDto {
  @Transform(({ value }) => value?.trim())
  @IsEmail()
  email!: string;
}
