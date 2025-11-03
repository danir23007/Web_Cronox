import { Transform } from 'class-transformer';
import { IsEmail } from 'class-validator';

export class ForgotDto {
  @Transform(({ value }) => value?.trim())
  @IsEmail()
  email!: string;
}
