import { IsEmail } from 'class-validator';
import { Transform } from 'class-transformer';

export class NewsletterSubscribeDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsEmail()
  email!: string;
}
